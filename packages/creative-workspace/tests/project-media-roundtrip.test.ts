import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeAsJSONAsync } from "../upstream/packages/drawnix/src/data/json";
import { loadFromBlob } from "../upstream/packages/drawnix/src/data/blob";
import {
  collectEmbeddedMediaFromElements,
  restoreEmbeddedMedia,
} from "../upstream/packages/drawnix/src/data/embedded-media";

const state = vi.hoisted(() => ({
  cache: new Map<string, Blob>(),
  write: vi.fn(),
}));
vi.mock(
  "../upstream/packages/drawnix/src/services/unified-cache-service",
  () => ({
    unifiedCacheService: {
      getCachedBlob: async (url: string) => state.cache.get(url) ?? null,
      getCacheInfo: async () => ({ cachedAt: 123, lastUsed: 456 }),
      isCached: async (url: string) => state.cache.has(url),
      cacheMediaFromBlob: async (url: string, blob: Blob) => {
        await state.write(url, blob);
        state.cache.set(url, blob);
        return url;
      },
    },
  }),
);

const image = "/__aitu_cache__/image/synthetic.png";
const video = "/asset-library/synthetic.mp4";
const mask = "/__aitu_cache__/image/mask.png";
const readBytes = (blob: Blob) =>
  new Promise<number[]>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () =>
      resolve([...new Uint8Array(reader.result as ArrayBuffer)]);
    reader.readAsArrayBuffer(blob);
  });

beforeEach(() => {
  state.cache.clear();
  state.write.mockReset();
});

describe("portable canvas files", () => {
  it("restores image/video bytes, references, masks, viewport and draft into an empty cache", async () => {
    state.cache.set(
      image,
      new Blob([new Uint8Array([0, 1, 2, 255])], { type: "image/png" }),
    );
    state.cache.set(
      video,
      new Blob([new Uint8Array([7, 8, 9, 0])], { type: "video/mp4" }),
    );
    state.cache.set(mask, new Blob(["synthetic-mask"], { type: "image/png" }));
    const board = {
      children: [
        {
          id: "image",
          type: "image",
          url: image,
          points: [
            [0, 0],
            [10, 10],
          ],
        },
        { id: "video", type: "video", url: video, poster: image },
        {
          id: "draft",
          type: "geometry",
          generationNode: {
            prompt: "未提交的合成草稿",
            references: [{ url: image, maskImage: mask }],
          },
        },
      ],
      viewport: { zoom: 1.25, origination: [11, 22] },
    };
    const saved = await serializeAsJSONAsync(board as any);
    expect(JSON.parse(saved).embeddedMedia).toHaveLength(3);
    state.cache.clear();
    const opened = await loadFromBlob({} as any, new Blob([saved]));
    expect(opened.elements).toEqual(board.children);
    expect(opened.viewport).toEqual(board.viewport);
    expect(await readBytes(state.cache.get(image)!)).toEqual([0, 1, 2, 255]);
    expect(await readBytes(state.cache.get(video)!)).toEqual([7, 8, 9, 0]);
    expect(state.cache.get(video)!.type).toBe("video/mp4");
    expect(state.write).toHaveBeenCalledTimes(3);
  });

  it("refuses a successful-looking export when required cached media is missing", async () => {
    await expect(
      collectEmbeddedMediaFromElements([{ id: "missing", url: image }] as any),
    ).rejects.toThrow(/媒体/);
  });

  it("does not report successful restoration when the cache write fails", async () => {
    state.write.mockRejectedValueOnce(new Error("synthetic quota exceeded"));
    await expect(
      restoreEmbeddedMedia([
        { url: image, type: "image", mimeType: "image/png", data: "AQID" },
      ]),
    ).rejects.toThrow(/媒体/);
  });

  it("validates every embedded payload before writing any media", async () => {
    await expect(
      restoreEmbeddedMedia([
        { url: image, type: "image", mimeType: "image/png", data: "AQID" },
        {
          url: video,
          type: "video",
          mimeType: "video/mp4",
          data: "***invalid***",
        },
      ]),
    ).rejects.toThrow(/媒体/);
    expect(state.write).not.toHaveBeenCalled();
  });

  it("keeps old files without embedded media readable", async () => {
    const data = { type: "drawnix", elements: [], viewport: { zoom: 1 } };
    expect(
      await loadFromBlob({} as any, new Blob([JSON.stringify(data)])),
    ).toEqual(data);
    expect(state.write).not.toHaveBeenCalled();
  });
});
