import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { opentuMcpApi } from "@/lib/api/opentuMcp";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

it("explicitly requests the local client and pins mutations to the displayed path", async () => {
  await opentuMcpApi.connectorStatus();
  expect(invoke).toHaveBeenLastCalledWith("opentu_connector_status", {
    connectLocal: true,
  });
  const path = "/synthetic/user/.codex/config.toml";
  await opentuMcpApi.installConnector(path);
  expect(invoke).toHaveBeenLastCalledWith("opentu_connector_install", {
    connectLocal: true,
    expectedConfigPath: path,
  });
  await opentuMcpApi.removeConnector(path);
  expect(invoke).toHaveBeenLastCalledWith("opentu_connector_remove", {
    connectLocal: true,
    expectedConfigPath: path,
  });
});
