import { beginOperation, errorOutcome, trackOperation } from "@/lib/analytics";
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  accountApi,
  disconnectedAccount,
  type AccountState,
} from "@/lib/api/account";

const stateKey = ["account-state"] as const;
export const accountQueryKey = (
  state: AccountState,
  feature: string,
  filters?: unknown,
) =>
  [
    "account",
    "https://api.tu-zi.com",
    "system-token-v1",
    state.identity?.userId,
    state.identity?.connectionId,
    state.generation,
    feature,
    filters,
    "system-token-v1",
  ] as const;

/** Mount once in App; route changes must never initiate a connection. */
export function useAccount() {
  const client = useQueryClient();
  const eventSequence = useRef(0);
  const reconcile = (next: AccountState): AccountState => {
    const previous = client.getQueryData<AccountState>(stateKey);
    if (
      previous &&
      (next.generation < previous.generation ||
        (next.generation === previous.generation &&
          (next.revision ?? 0) < (previous.revision ?? 0)))
    )
      return previous;
    if (
      previous &&
      (previous.generation !== next.generation ||
        previous.identity?.connectionId !== next.identity?.connectionId ||
        !next.identity)
    ) {
      void client.cancelQueries({ queryKey: ["account"] });
      client.removeQueries({ queryKey: ["account"] });
    }
    return next;
  };
  const accept = (next: AccountState) => {
    eventSequence.current++;
    client.setQueryData(stateKey, reconcile(next));
  };
  const read = async () => {
    const startedAt = eventSequence.current;
    const next = await accountApi.getState();
    const current = client.getQueryData<AccountState>(stateKey);
    // A native event received during this read wins, even within one generation.
    if (current && eventSequence.current !== startedAt) return current;
    return reconcile(next);
  };
  const query = useQuery({
    queryKey: stateKey,
    queryFn: read,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<AccountState>("account-state-changed", ({ payload }) => {
      if (!disposed) accept(payload);
    })
      .then((stop) => {
        if (disposed) stop();
        else {
          unlisten = stop;
          void read()
            .then((next) => {
              if (!disposed) client.setQueryData(stateKey, next);
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
  const action =
    (
      run: () => Promise<AccountState>,
      operation: "connect" | "check" | "disconnect",
    ) =>
    async () => {
      const startedAt = eventSequence.current;
      const finish = beginOperation("account", operation);
      let next: AccountState;
      try {
        next = await run();
        const success =
          operation === "disconnect"
            ? next.localCleared
            : next.status === "connected" && !!next.identity && !next.error;
        finish(success ? "success" : "failure", next.error);
      } catch (error) {
        finish(errorOutcome(error), error);
        throw error;
      }
      const current = client.getQueryData<AccountState>(stateKey);
      if (
        !current ||
        next.generation > current.generation ||
        eventSequence.current === startedAt
      )
        accept(next);
    };
  return {
    state:
      query.data ??
      (query.isError
        ? {
            ...disconnectedAccount,
            status: "error" as const,
            error: {
              code: "native_unavailable",
              message: "native_unavailable",
            },
          }
        : disconnectedAccount),
    isLoading: query.isLoading,
    connect: (token: string) =>
      action(() => accountApi.connect(token), "connect")(),
    openTokenPage: () =>
      trackOperation("account", "get_token", {}, accountApi.openTokenPage),
    logout: action(accountApi.logout, "disconnect"),
    retry: async () => {
      await action(accountApi.retry, "check")();
      // Return the reconciled state, never a stale IPC success after logout.
      return client.getQueryData<AccountState>(stateKey)!;
    },
  };
}
