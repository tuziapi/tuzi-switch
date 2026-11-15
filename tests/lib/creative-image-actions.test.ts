import { beforeEach, describe, expect, it, vi } from "vitest";
import { nativeImageAction } from "@/features/creative/imageActions";
import { createCreativeAccountBridge } from "@/features/creative/accountBridge";
import { disconnectedAccount } from "@/lib/api/account";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));
beforeEach(() => {
  invoke.mockReset();
});

describe("native creative image boundary", () => {
  it("sends original bytes and a bounded filename, never a path or URL", async () => {
    invoke.mockResolvedValue("copied");
    expect(
      await nativeImageAction(
        "copy",
        new Blob(["synthetic-only"]),
        "x".repeat(200),
      ),
    ).toBe("copied");
    expect(invoke).toHaveBeenCalledWith("creative_image_action", {
      request: {
        action: "copy",
        data: btoa("synthetic-only"),
        name: "x".repeat(120),
      },
    });
  });
  it("rejects empty and oversized inputs without IPC", async () => {
    await expect(nativeImageAction("copy", new Blob())).rejects.toThrow(
      "64 MB",
    );
    await expect(
      nativeImageAction("save", { size: 64 * 1024 * 1024 + 1 } as Blob),
    ).rejects.toThrow("64 MB");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("preserves cancel and reports native failure without success", async () => {
    invoke
      .mockResolvedValueOnce("cancelled")
      .mockRejectedValueOnce("磁盘空间不足");
    expect(await nativeImageAction("save", new Blob(["fixture"]))).toBe(
      "cancelled",
    );
    await expect(
      nativeImageAction("reveal", new Blob(["fixture"])),
    ).rejects.toThrow("磁盘空间不足");
  });
  it("supports local image actions even when the account is disconnected", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    try {
      const bridge = createCreativeAccountBridge(disconnectedAccount, () => {});
      expect(bridge.imageAction).toBe(nativeImageAction);
      expect(bridge.copyText).toBeTypeOf("function");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
