import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { accountQueryKey } from "./account";
import { desktopRequest, type AccountState } from "../api/account";
export function useDesktop<T>(
  state: AccountState,
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
  staleTime = 30000,
  poll = false,
) {
  const client = useQueryClient();
  const key = accountQueryKey(state, path, query);
  useEffect(() => {
    if (document.visibilityState === "hidden")
      void client.cancelQueries({ queryKey: key, exact: true });
  }, [client, key]);
  const [visible, setVisible] = useState(document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => {
      setVisible(document.visibilityState !== "hidden");
      if (document.visibilityState === "hidden")
        void client.cancelQueries({
          queryKey: accountQueryKey(state, path, query),
          exact: true,
        });
    };
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [client, state.generation, path, JSON.stringify(query)]);
  return useQuery({
    queryKey: accountQueryKey(state, path, query),
    queryFn: async ({ signal }) => {
      const result = await desktopRequest<T>(
        {
          method: "GET",
          path,
          query: Object.entries(query)
            .filter(([, v]) => v !== undefined && v !== "")
            .map(([k, v]) => [k, String(v)]),
          generation: state.generation,
        },
        signal,
      );
      if (signal.aborted) throw new Error("cancelled");
      return result;
    },
    enabled:
      visible &&
      !!state.identity &&
      ["connected", "refreshing"].includes(state.status),
    staleTime,
    gcTime: 300000,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: poll && visible ? 60000 : false,
  });
}
