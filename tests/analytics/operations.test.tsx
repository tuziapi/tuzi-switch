import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useAccount } from "@/lib/query/account";
import { disconnectedAccount } from "@/lib/api/account";
import { useWrite } from "@/components/account/BusinessShared";
import {
  useUpsertMcpServer,
  useAllMcpServers,
  useToggleMcpApp,
} from "@/hooks/useMcp";
import { useAddProviderMutation } from "@/lib/query/mutations";
import { useImportExport } from "@/hooks/useImportExport";
import { settingsApi } from "@/lib/api";
import { useProxyStatus } from "@/hooks/useProxyStatus";

const { invoke, track } = vi.hoisted(() => ({
  invoke: vi.fn(),
  track: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
const connected = {
  ...disconnectedAccount,
  status: "connected" as const,
  localCleared: false,
  identity: {
    userId: "synthetic-user",
    username: "synthetic-name",
    displayName: "synthetic-name",
    connectionId: "synthetic-connection",
  },
};
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
beforeEach(() => {
  invoke.mockReset();
  track.mockReset();
  vi.stubGlobal("umami", { track });
  vi.stubGlobal("__APP_VERSION__", "synthetic-version");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("real operation hooks with synthetic native responses", () => {
  it("refreshes MCP state after a failed native toggle and reports only its fixed tool", async () => {
    let reads = 0;
    invoke.mockImplementation(async (command: string) => {
      if (command === "get_mcp_servers") {
        reads++;
        return {};
      }
      throw { code: "write_failed", message: "synthetic-private-path" };
    });
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({ read: useAllMcpServers(), toggle: useToggleMcpApp() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.read.isSuccess).toBe(true));
    const initialReads = reads;
    await act(async () => {
      await expect(
        result.current.toggle.mutateAsync({
          serverId: "synthetic-private-id",
          app: "pi",
          enabled: false,
        }),
      ).rejects.toMatchObject({ code: "write_failed" });
    });
    await waitFor(() => expect(reads).toBeGreaterThan(initialReads));
    expect(track).toHaveBeenCalledTimes(2);
    expect(track.mock.lastCall?.[1]).toMatchObject({
      tool: "pi",
      action: "disable",
      outcome: "failure",
      error_category: "local_write",
    });
    expect(JSON.stringify(track.mock.calls)).not.toContain("synthetic-private");
  });

  it("does not count cancelling an export dialog as an attempted operation", async () => {
    vi.spyOn(settingsApi, "saveFileDialog").mockResolvedValue(null);
    const { result } = renderHook(() => useImportExport());
    await act(async () => {
      await result.current.exportConfig();
    });
    expect(track).not.toHaveBeenCalled();
  });

  it("does not count proxy status queries, and reports a rejected manual start", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "start_proxy_server")
        throw { code: "permission_denied", message: "synthetic-private-path" };
      return { running: false };
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useProxyStatus(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(track).not.toHaveBeenCalled();
    await act(async () => {
      await expect(result.current.startProxyServer()).rejects.toMatchObject({
        code: "permission_denied",
      });
    });
    expect(track).toHaveBeenCalledTimes(2);
    expect(track.mock.lastCall?.[1]).toMatchObject({
      action: "start",
      outcome: "failure",
      error_category: "permission",
    });
    expect(JSON.stringify(track.mock.calls)).not.toContain(
      "synthetic-private-path",
    );
  });

  it("does not report account reads; resolved invalid connection is a failure", async () => {
    invoke.mockImplementation(async (command: string) =>
      command === "account_connect"
        ? {
            ...disconnectedAccount,
            status: "invalid",
            error: { code: "invalid_token", message: "synthetic-secret" },
          }
        : disconnectedAccount,
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useAccount(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(track).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.connect("synthetic-secret");
    });
    expect(track).toHaveBeenCalledTimes(2);
    expect(track.mock.lastCall).toEqual([
      "连接兔子账户",
      expect.objectContaining({
        stage: "result",
        outcome: "failure",
        error_category: "permission",
      }),
    ]);
    expect(JSON.stringify(track.mock.calls)).not.toContain("synthetic-secret");
  });

  it("tracks key operations and preserves unknown write outcomes without leaking key DTOs", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useWrite(connected, true), { wrapper });
    expect(track).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce({
      data: { id: "synthetic-id", key: "synthetic-secret" },
    });
    await act(async () => {
      await result.current.write("POST", "/account/keys", {
        name: "synthetic-name",
      });
    });
    expect(track.mock.lastCall?.[1]).toMatchObject({
      action: "create",
      outcome: "success",
    });
    invoke.mockRejectedValueOnce({
      code: "timeout",
      outcomeUnknown: true,
      message: "synthetic-secret",
    });
    await act(async () => {
      await result.current.write("PATCH", "/account/keys/synthetic-id", {
        status: 2,
      });
    });
    expect(track.mock.lastCall?.[1]).toMatchObject({
      action: "disable",
      outcome: "unknown",
      error_category: "network",
    });
    expect(result.current.error?.outcomeUnknown).toBe(true);
    expect(JSON.stringify(track.mock.calls)).not.toMatch(
      /synthetic-id|synthetic-name|synthetic-secret/,
    );
  });

  it("distinguishes MCP add/edit while automatic list refreshes produce no events", async () => {
    invoke.mockImplementation(async (command: string) =>
      command === "get_mcp_servers" ? {} : true,
    );
    const { wrapper, client } = setup();
    const { result } = renderHook(
      () => ({ read: useAllMcpServers(), write: useUpsertMcpServer() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.read.isSuccess).toBe(true));
    expect(track).not.toHaveBeenCalled();
    const server = {
      id: "synthetic-server",
      name: "synthetic-name",
      server: { command: "synthetic-command" },
      apps: {},
    } as never;
    await act(async () => {
      await result.current.write.mutateAsync(server);
    });
    expect(track.mock.lastCall?.[0]).toBe("添加 MCP 服务");
    client.setQueryData(["mcp", "all"], { "synthetic-server": server });
    await act(async () => {
      await result.current.write.mutateAsync(server);
    });
    expect(track.mock.lastCall?.[0]).toBe("编辑 MCP 服务");
    expect(track).toHaveBeenCalledTimes(4);
  });

  it("records duplication once and never stores the analytics field in a provider", async () => {
    invoke.mockResolvedValue(true);
    const { wrapper } = setup();
    const { result } = renderHook(() => useAddProviderMutation("codex"), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        name: "synthetic-name",
        settingsConfig: { key: "synthetic-secret" },
        analyticsAction: "duplicate",
      });
    });
    expect(track.mock.calls.map((call) => call[0])).toEqual([
      "复制供应商",
      "复制供应商",
    ]);
    const native = invoke.mock.calls.find(
      (call) => call[0] === "add_provider",
    )!;
    expect(native[1].provider).not.toHaveProperty("analyticsAction");
    expect(JSON.stringify(track.mock.calls)).not.toMatch(
      /synthetic-name|synthetic-secret/,
    );
  });
});
