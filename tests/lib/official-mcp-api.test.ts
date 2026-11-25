import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { officialMcpApi } from "@/lib/api/officialMcp";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

it("uses the explicit desktop target and carries the displayed path through native IPC", async () => {
  await officialMcpApi.status();
  expect(invoke).toHaveBeenLastCalledWith("tuzi_mcp_status", {
    connectLocal: true,
  });
  for (const action of ["connect", "check"] as const) {
    await officialMcpApi.start(action, "/synthetic/desktop/.codex/config.toml");
    expect(invoke).toHaveBeenLastCalledWith("tuzi_mcp_start", {
      action,
      connectLocal: true,
      expectedConfigPath: "/synthetic/desktop/.codex/config.toml",
    });
  }
});
