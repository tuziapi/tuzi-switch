import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  nativeSaveMedia,
  nativeVideoAction,
} from "@/features/creative/mediaSave";
import { createCreativeAccountBridge } from "@/features/creative/accountBridge";
import { disconnectedAccount } from "@/lib/api/account";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));
beforeEach(() => invoke.mockReset());

describe("native media export", () => {
  it("passes original binary bytes and UTF-8 filename, without a destination path", async () => {
    invoke.mockResolvedValue("saved");
    expect(
      await nativeSaveMedia(
        new Blob(["synthetic-video"]),
        "蓝色兔子.mp4",
        "video",
      ),
    ).toBe("saved");
    const [command, bytes, options] = invoke.mock.calls[0];
    expect(command).toBe("creative_save_media");
    expect(new TextDecoder().decode(bytes)).toBe("synthetic-video");
    expect(options.headers["x-media-kind"]).toBe("video");
    expect(
      new TextDecoder().decode(
        Uint8Array.from(atob(options.headers["x-media-name"]), (c) =>
          c.charCodeAt(0),
        ),
      ),
    ).toBe("蓝色兔子.mp4");
  });
  it("rejects oversized inputs before reading or invoking native", async () => {
    await expect(
      nativeSaveMedia(new Blob(), "empty.mp4", "video"),
    ).rejects.toThrow("128 MB");
    await expect(
      nativeSaveMedia(
        { size: 128 * 1024 * 1024 + 1 } as Blob,
        "big.mp4",
        "video",
      ),
    ).rejects.toThrow("128 MB");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("preserves cancellation and failure", async () => {
    invoke
      .mockResolvedValueOnce("cancelled")
      .mockRejectedValueOnce("磁盘空间不足");
    expect(
      await nativeSaveMedia(new Blob(["fixture"]), "audio.mp3", "audio"),
    ).toBe("cancelled");
    await expect(
      nativeSaveMedia(new Blob(["fixture"]), "audio.mp3", "audio"),
    ).rejects.toThrow("磁盘空间不足");
  });
  it.each([
    ["copy", "copied"],
    ["copy-path", "path-copied"],
    ["reveal", "revealed"],
  ] as const)(
    "sends bounded original bytes for %s without an arbitrary path",
    async (action, result) => {
      invoke.mockResolvedValue(result);
      expect(
        await nativeVideoAction(action, new Blob(["original-video"])),
      ).toBe(result);
      const [command, bytes, options] = invoke.mock.calls[0];
      expect(command).toBe("creative_video_action");
      expect(new TextDecoder().decode(bytes)).toBe("original-video");
      expect(options.headers).toEqual({ "x-media-action": action });
    },
  );
  it("rejects empty/oversized video files and propagates native errors", async () => {
    await expect(nativeVideoAction("copy", new Blob())).rejects.toThrow(
      "128 MB",
    );
    await expect(
      nativeVideoAction("reveal", { size: 128 * 1024 * 1024 + 1 } as Blob),
    ).rejects.toThrow("128 MB");
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockRejectedValueOnce("无法访问系统剪贴板");
    await expect(
      nativeVideoAction("copy", new Blob(["fixture"])),
    ).rejects.toThrow("无法访问系统剪贴板");
  });
  it("does not require account login", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    try {
      expect(
        createCreativeAccountBridge(disconnectedAccount, () => {}).saveMedia,
      ).toBe(nativeSaveMedia);
      expect(
        createCreativeAccountBridge(disconnectedAccount, () => {}).videoAction,
      ).toBe(nativeVideoAction);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
