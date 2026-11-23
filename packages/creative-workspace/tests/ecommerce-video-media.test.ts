import { Blob as NodeBlob } from "node:buffer";
import { describe, expect, it, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ cache: vi.fn(), fetch: vi.fn() }));
vi.mock("../upstream/packages/drawnix/src/services/assistant-account", () => ({
  fetchOutputMedia: mocks.fetch,
}));
vi.mock(
  "../upstream/packages/drawnix/src/services/unified-cache-service",
  () => ({ unifiedCacheService: { getCachedBlob: mocks.cache } }),
);
import { downloadEcommerceVideo } from "../src/ecommerce-video-media";
beforeEach(() => vi.clearAllMocks());
describe("native ecommerce video cache", () => {
  it("reads a generated virtual video from persistent cache instead of fetching app HTML", async () => {
    const blob = new NodeBlob(["\0\0\0 ftypisom", new Uint8Array(32)], {
      type: "video/mp4",
    });
    mocks.cache.mockResolvedValue(blob);
    const result = await downloadEcommerceVideo(
      "/__aitu_cache__/video/synthetic-task.mp4",
      new AbortController().signal,
    );
    expect(mocks.cache).toHaveBeenCalledWith(
      "/__aitu_cache__/video/synthetic-task.mp4",
      { allowNetwork: false },
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(result.type).toBe("video/mp4");
    expect(await result.arrayBuffer()).toEqual(await blob.arrayBuffer());
  });
  it("fails explicitly on missing local media without submitting or fetching a relative URL", async () => {
    mocks.cache.mockResolvedValue(null);
    await expect(
      downloadEcommerceVideo(
        "/__aitu_cache__/video/missing.mp4",
        new AbortController().signal,
      ),
    ).rejects.toThrow("本地视频缓存");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
