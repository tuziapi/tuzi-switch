import { afterEach, describe, expect, it, vi } from "vitest";
import { setAssistantAccount } from "../upstream/packages/drawnix/src/services/assistant-account";
import { unifiedCacheService } from "../upstream/packages/drawnix/src/services/unified-cache-service";
import {
  readCanvasImage,
  runCanvasImageAction,
  copyImagePrompt,
} from "../upstream/packages/drawnix/src/utils/canvas-image-actions";
import {
  smartDownload,
  downloadMediaFile,
} from "../upstream/packages/drawnix/src/utils/download-utils";
import type { CreativeAccountBridge } from "../src/bridge-types";

const url = "/__aitu_cache__/synthetic-original.png";
function setup(result = "saved") {
  const original = new Blob(["synthetic-original-bytes"], {
    type: "image/png",
  });
  const cache = vi
    .spyOn(unifiedCacheService, "getCachedBlob")
    .mockResolvedValue(original);
  const imageAction = vi.fn().mockResolvedValue(result);
  const copyText = vi.fn().mockResolvedValue(undefined);
  setAssistantAccount({
    state: { status: "disconnected" },
    imageAction,
    copyText,
  } as unknown as CreativeAccountBridge);
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  return { original, cache, imageAction, copyText, network };
}
afterEach(() => {
  setAssistantAccount(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("incoming creative features preserve host image actions", () => {
  it("exports the original cache bytes through the native capability without account login", async () => {
    const host = setup("revealed");
    expect(await runCanvasImageAction("reveal", url, "image.png")).toBe(
      "revealed",
    );
    expect(host.imageAction).toHaveBeenCalledWith(
      "reveal",
      host.original,
      "image.png",
    );
    expect(host.cache).toHaveBeenCalledWith(url, { allowNetwork: false });
    expect(host.network).not.toHaveBeenCalled();
  });
  it("single-image toolbar/task download preserves native cancellation", async () => {
    const host = setup("cancelled");
    expect(
      await smartDownload([{ type: "image", url, filename: "result.png" }]),
    ).toEqual({ downloadedCount: 0, openedCount: 0, failedCount: 0 });
    expect(host.imageAction).toHaveBeenCalledWith(
      "save",
      host.original,
      "result.png",
    );
    expect(host.network).not.toHaveBeenCalled();
  });
  it("media image download reports success only after native save resolves", async () => {
    const host = setup();
    expect(
      (await downloadMediaFile(url, "synthetic", "png")).downloadedCount,
    ).toBe(1);
    host.imageAction.mockResolvedValue("cancelled");
    expect(
      (await downloadMediaFile(url, "synthetic", "png")).downloadedCount,
    ).toBe(0);
  });
  it("missing virtual original never fetches, exports a thumbnail or generates again", async () => {
    const host = setup();
    host.cache.mockResolvedValue(null);
    await expect(runCanvasImageAction("copy", url)).rejects.toThrow("原图缓存");
    expect(host.imageAction).not.toHaveBeenCalled();
    expect(host.network).not.toHaveBeenCalled();
  });
  it("rejects oversized cached input before native dispatch", async () => {
    const host = setup();
    host.cache.mockResolvedValue({ size: 64 * 1024 * 1024 + 1 } as Blob);
    await expect(readCanvasImage(url)).rejects.toThrow("64 MB");
    expect(host.imageAction).not.toHaveBeenCalled();
  });
  it("retains native prompt copy without a model request", async () => {
    const host = setup();
    await copyImagePrompt("synthetic prompt");
    expect(host.copyText).toHaveBeenCalledWith("synthetic prompt");
    expect(host.network).not.toHaveBeenCalled();
  });
});
