import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  cache: vi.fn(),
  fetch: vi.fn(),
  read: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("../unified-cache-service", () => ({
  unifiedCacheService: { getCachedBlob: mocks.cache },
}));
vi.mock("../assistant-account", () => ({ fetchOutputMedia: mocks.fetch }));
vi.mock("../../utils/canvas-image-actions", () => ({
  readCanvasImage: mocks.read,
}));
vi.mock("./canvas-control", () => ({ snapshotCanvas: mocks.snapshot }));
vi.mock("../../data/audio", () => ({
  isAudioElement: (e: any) => e.type === "audio",
}));
vi.mock("../../plugins/with-video", () => ({
  isVideoElement: (e: any) => e.isVideo === true,
}));
import {
  prepareCanvasContext,
  sampleDiscussionVideo,
  videoSampleTimes,
} from "./canvas-context";
let media: HTMLVideoElement[],
  labels: string[],
  noEvents = false;
beforeEach(() => {
  vi.clearAllMocks();
  media = [];
  labels = [];
  noEvents = false;
  mocks.cache.mockResolvedValue(
    new Blob(["synthetic video"], { type: "video/mp4" }),
  );
  mocks.snapshot.mockReturnValue({
    revision: "a".repeat(64),
    board: { children: [] },
    elements: [{ id: "unselected", selected: false, text: "visible text" }],
  });
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(
    (tag: any, ...args: any[]) => {
      const element = create(tag, ...args);
      if (tag === "video") {
        const v = element as HTMLVideoElement;
        media.push(v);
        let time = 0;
        Object.defineProperties(v, {
          duration: { value: 4 },
          videoWidth: { value: 160 },
          videoHeight: { value: 90 },
          currentTime: {
            get: () => time,
            set: (t) => {
              time = t;
              if (!noEvents)
                queueMicrotask(() => v.dispatchEvent(new Event("seeked")));
            },
          },
        });
        v.load = vi.fn(() => {
          if (v.getAttribute("src") && !noEvents)
            queueMicrotask(() => v.dispatchEvent(new Event("loadeddata")));
        });
        v.pause = vi.fn();
      }
      if (tag === "canvas") {
        Object.assign(element, {
          getContext: () => ({
            fillRect() {},
            drawImage() {},
            fillText(t: string) {
              labels.push(t);
            },
          }),
          toDataURL: () => "data:image/jpeg;base64,YQ==",
        });
      }
      return element;
    },
  );
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:synthetic");
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("samples deterministic timestamps and cleans the media URL after use", async () => {
  expect(videoSampleTimes(4)).toEqual([0, 0.975, 1.95, 2.925, 3.9]);
  const result = await sampleDiscussionVideo(
    "/asset-library/video",
    "video1",
    new AbortController().signal,
  );
  expect(result.times).toHaveLength(5);
  expect(labels).toContain("video1 · 3.90s");
  expect(media[0].pause).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  expect(media[0].hasAttribute("src")).toBe(false);
});
it("four references produce four actual image parts and retain IDs and range", async () => {
  const refs = {
    videos: [
      "/asset-library/1",
      "/asset-library/2",
      "/asset-library/3",
      "/asset-library/4",
    ],
  };
  const result = await prepareCanvasContext(
    "board",
    refs,
    new AbortController().signal,
  );
  expect(result.images).toHaveLength(4);
  expect(result.notice).toContain("4/4 段视频");
  expect(result.notice).toContain("不含声音");
  expect(result.summary).toContain("unselected");
  expect(result.references?.videos).toEqual(refs.videos);
  expect(mocks.cache).toHaveBeenCalledWith("/asset-library/1", {
    allowNetwork: false,
  });
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("missing virtual reference fails without a network fallback", async () => {
  mocks.cache.mockResolvedValue(null);
  await expect(
    prepareCanvasContext(
      "board",
      { videos: ["/asset-library/missing"] },
      new AbortController().signal,
    ),
  ).rejects.toThrow("缓存缺失");
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(media).toHaveLength(0);
});
it("cancellation releases the decoder and never returns a context", async () => {
  noEvents = true;
  const controller = new AbortController();
  const pending = sampleDiscussionVideo(
    "/asset-library/1",
    "video",
    controller.signal,
  );
  const assertion = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.waitFor(() => expect(media).toHaveLength(1));
  controller.abort();
  await assertion;
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  expect(media[0].hasAttribute("src")).toBe(false);
});
it("decoder timeout is bounded and cleans up", async () => {
  vi.useFakeTimers();
  noEvents = true;
  const pending = sampleDiscussionVideo(
    "/asset-library/1",
    "video",
    new AbortController().signal,
  );
  const assertion = expect(pending).rejects.toThrow("超时");
  await vi.advanceTimersByTimeAsync(20001);
  await assertion;
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
});
it("rejects over-limit explicit videos before decoding and stale capture after decoding", async () => {
  await expect(
    prepareCanvasContext(
      "board",
      { videos: ["1", "2", "3", "4", "5"] },
      new AbortController().signal,
    ),
  ).rejects.toThrow("最多");
  expect(media).toHaveLength(0);
  mocks.snapshot
    .mockReturnValueOnce({
      revision: "a".repeat(64),
      board: { children: [] },
      elements: [],
    })
    .mockReturnValueOnce({
      revision: "b".repeat(64),
      board: { children: [] },
      elements: [],
    });
  await expect(
    prepareCanvasContext(
      "board",
      { videos: ["/asset-library/1"] },
      new AbortController().signal,
    ),
  ).rejects.toThrow("画布已变化");
});
it("reports unreadable unselected video without claiming a frame preview", async () => {
  mocks.snapshot.mockReturnValue({
    revision: "a".repeat(64),
    board: {
      children: [
        {
          id: "broken",
          type: "image",
          isVideo: true,
          url: "/asset-library/missing",
        },
      ],
    },
    elements: [{ id: "broken" }],
  });
  mocks.cache.mockResolvedValue(null);
  const result = await prepareCanvasContext(
    "board",
    {},
    new AbortController().signal,
  );
  expect(result.images).toEqual([]);
  expect(result.notice).toContain("无法抽帧");
  expect(result.notice).toContain("0/1 段视频");
});
