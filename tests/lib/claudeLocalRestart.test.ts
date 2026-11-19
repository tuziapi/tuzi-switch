import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { relaunchApp } from "@/lib/updater";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it("routes update restart through the guarded native command", async () => {
  vi.mocked(invoke).mockResolvedValue(true);
  await relaunchApp();
  expect(invoke).toHaveBeenCalledWith("restart_app");
});
it("propagates the native active-session block", async () => {
  vi.mocked(invoke).mockRejectedValue("session active");
  await expect(relaunchApp()).rejects.toBe("session active");
});
