import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  accountApi,
  disconnectedAccount,
  type AccountState,
} from "@/lib/api/account";
import { useAccount } from "@/lib/query/account";
const listener = vi.hoisted(() => ({
  handler: undefined as
    | undefined
    | ((event: { payload: AccountState }) => void),
}));
vi.mock("@/lib/api/account", async (original) => ({
  ...(await original<typeof import("@/lib/api/account")>()),
  accountApi: {
    getState: vi.fn(),
    connect: vi.fn(),
    openTokenPage: vi.fn(),
    logout: vi.fn(),
    retry: vi.fn(),
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name, handler) => {
    listener.handler = handler;
    return () => {};
  }),
}));
const connected: AccountState = {
  ...disconnectedAccount,
  generation: 3,
  revision: 3,
  status: "connected",
  localCleared: false,
  identity: {
    userId: "9007199254740993",
    username: "synthetic",
    displayName: "Synthetic",
    connectionId: "synthetic-connection",
  },
};
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const result = renderHook(() => useAccount(), { wrapper });
  return { client, ...result };
}
beforeEach(() => {
  vi.clearAllMocks();
  listener.handler = undefined;
});
describe("account native state and cache isolation", () => {
  it("late initial reads cannot overwrite a same-generation native event", async () => {
    const finishes: Array<(state: AccountState) => void> = [];
    vi.mocked(accountApi.getState).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve);
        }),
    );
    const { result } = setup();
    await waitFor(() => expect(listener.handler).toBeDefined());
    act(() => listener.handler!({ payload: connected }));
    await act(async () =>
      finishes.forEach((finish) =>
        finish({ ...connected, status: "authorizing", revision: 1 }),
      ),
    );
    await waitFor(() => expect(result.current.state.status).toBe("connected"));
  });
  it("logout clears account caches while retaining tool caches and ignores old events", async () => {
    vi.mocked(accountApi.getState).mockResolvedValue(connected);
    const { result, client } = setup();
    await waitFor(() => expect(result.current.state.status).toBe("connected"));
    client.setQueryData(["account", "synthetic"], { synthetic: true });
    client.setQueryData(["providers"], { keep: true });
    act(() =>
      listener.handler!({
        payload: { ...disconnectedAccount, generation: 4, revision: 4 },
      }),
    );
    expect(client.getQueryData(["account", "synthetic"])).toBeUndefined();
    expect(client.getQueryData(["providers"])).toEqual({ keep: true });
    act(() => listener.handler!({ payload: connected }));
    await waitFor(() => expect(result.current.state.identity).toBeNull());
  });
  it("loss of identity clears private cache even in the same generation", async () => {
    vi.mocked(accountApi.getState).mockResolvedValue(connected);
    const { result, client } = setup();
    await waitFor(() => expect(result.current.state.status).toBe("connected"));
    client.setQueryData(["account", "data"], ["synthetic"]);
    act(() =>
      listener.handler!({
        payload: {
          ...connected,
          identity: null,
          status: "invalid",
          revision: 4,
        },
      }),
    );
    expect(client.getQueryData(["account", "data"])).toBeUndefined();
  });
  it("native IPC errors are visible and do not trigger a login loop", async () => {
    vi.mocked(accountApi.getState).mockRejectedValue(
      new Error("synthetic failure"),
    );
    const { result } = setup();
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.code).toBe("native_unavailable");
    expect(accountApi.connect).not.toHaveBeenCalled();
  });
  it("connects without caching input and invalidates the previous account data", async () => {
    vi.mocked(accountApi.getState).mockResolvedValue(connected);
    const next = {
      ...connected,
      generation: 4,
      identity: { ...connected.identity!, connectionId: "synthetic-second" },
    };
    vi.mocked(accountApi.connect).mockResolvedValue(next);
    const { result, client } = setup();
    await waitFor(() => expect(result.current.state.status).toBe("connected"));
    client.setQueryData(["account", "private"], { previous: true });
    await act(() => result.current.connect("synthetic-system-token"));
    await waitFor(() =>
      expect(result.current.state.identity?.connectionId).toBe(
        "synthetic-second",
      ),
    );
    expect(accountApi.connect).toHaveBeenCalledWith("synthetic-system-token");
    expect(client.getQueryData(["account", "private"])).toBeUndefined();
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain("synthetic-system-token");
  });
  it("ignores a late successful connection after the user disconnects", async () => {
    vi.mocked(accountApi.getState).mockResolvedValue(disconnectedAccount);
    let finish!: (state: AccountState) => void;
    vi.mocked(accountApi.connect).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = setup();
    await waitFor(() => expect(listener.handler).toBeDefined());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.connect("synthetic-system-token");
    });
    act(() =>
      listener.handler!({ payload: { ...disconnectedAccount, generation: 4 } }),
    );
    await act(async () => {
      finish(connected);
      await pending;
    });
    await waitFor(() => expect(result.current.state.generation).toBe(4));
    expect(result.current.state.identity).toBeNull();
  });
});

it("returns reconciled retry state after a newer disconnect event", async () => {
  vi.mocked(accountApi.getState).mockResolvedValue(connected);
  let finish!: (state: AccountState) => void;
  vi.mocked(accountApi.retry).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = setup();
  await waitFor(() => expect(result.current.state.status).toBe("connected"));
  const pending = result.current.retry();
  const loggedOut = {
    ...disconnectedAccount,
    generation: connected.generation + 1,
  };
  act(() => listener.handler!({ payload: loggedOut }));
  let returned: AccountState | undefined;
  await act(async () => {
    finish(connected);
    returned = await pending;
  });
  expect(returned).toEqual(loggedOut);
});
