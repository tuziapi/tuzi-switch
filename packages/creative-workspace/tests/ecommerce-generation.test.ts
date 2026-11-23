import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  protocol: "openai.images",
  generate: vi.fn(),
  direct: vi.fn(),
  asyncGenerate: vi.fn(),
  videoSubmit: vi.fn(),
  videoPoll: vi.fn(),
  modelId: "synthetic-image",
}));
vi.mock("../upstream/packages/drawnix/src/services/provider-routing", () => ({
  resolveInvocationPlanFromRoute: () => ({
    modelRef: { modelId: mocks.modelId },
    provider: {
      apiKey: "synthetic-key",
      baseUrl: "https://example.invalid/v1",
    },
    binding: { protocol: mocks.protocol, requestSchema: "openai.image.form" },
  }),
}));
vi.mock("../upstream/packages/drawnix/src/services/model-adapters", () => ({
  getAdapterContextFromSettings: () => ({}),
  resolveAdapterForInvocation: () => ({
    kind: "image",
    generateImage: mocks.generate,
  }),
}));
vi.mock("../upstream/packages/drawnix/src/utils/gemini-api/services", () => ({
  generateImageDirect: mocks.direct,
}));
vi.mock(
  "../upstream/packages/drawnix/src/services/async-image-api-service",
  () => ({
    asyncImageAPIService: {
      generateWithPolling: mocks.asyncGenerate,
      extractUrlAndFormat: () => ({ url: "synthetic-result" }),
    },
  }),
);
vi.mock("../upstream/packages/drawnix/src/services/video-api-service", () => ({
  videoAPIService: {
    submitVideoGeneration: mocks.videoSubmit,
    resumePolling: mocks.videoPoll,
  },
}));
import {
  generateEcommerceImage,
  generateEcommerceVideo,
} from "../src/ecommerce-generation";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.protocol = "openai.images";
  mocks.modelId = "synthetic-image";
});

describe("ecommerce video routing", () => {
  const params = () => ({
    modelRef: { modelId: mocks.modelId },
    prompt: "synthetic product",
    size: "720p",
    seconds: "3",
    aspectRatio: "16:9",
    referenceImages: [] as string[],
  });
  beforeEach(() => {
    mocks.modelId = "gemini-omni-1.2-flash";
    mocks.videoSubmit.mockResolvedValue({ id: "synthetic-video-task" });
    mocks.videoPoll.mockResolvedValue({
      video_url: "https://example.invalid/result.mp4",
    });
  });
  it("passes actual video media, size, duration and persists task ID before polling", async () => {
    let saved = false;
    mocks.videoPoll.mockImplementationOnce(async () => {
      expect(saved).toBe(true);
      return { video_url: "https://example.invalid/result.mp4" };
    });
    await generateEcommerceVideo({
      ...params(),
      referenceVideo: "data:video/mp4;base64,AAAA",
      onSubmitted: async (id) => {
        expect(id).toBe("synthetic-video-task");
        saved = true;
      },
    });
    expect(mocks.videoSubmit.mock.calls[0][0]).toMatchObject({
      size: "720p",
      seconds: "3",
      params: {
        aspect_ratio: "16:9",
        video_media: [{ type: "video", url: "data:video/mp4;base64,AAAA" }],
      },
    });
  });
  it("resume queries the existing remote task without paid submission", async () => {
    await generateEcommerceVideo({ ...params(), taskId: "existing-task" });
    expect(mocks.videoSubmit).not.toHaveBeenCalled();
    expect(mocks.videoPoll.mock.calls[0][0]).toBe("existing-task");
  });
  it("routes MiniMax-H3 local video references through its actual video field", async () => {
    mocks.modelId = "MiniMax-H3";
    await generateEcommerceVideo({
      ...params(),
      referenceVideo: "data:video/mp4;base64,AAAA",
    });
    expect(mocks.videoSubmit.mock.calls[0][0].params.input_videos).toEqual([
      "data:video/mp4;base64,AAAA",
    ]);
    expect(
      mocks.videoSubmit.mock.calls[0][0].params.video_media,
    ).toBeUndefined();
  });
  it("rejects unsupported video references before submitting", async () => {
    mocks.modelId = "happyhorse-1.1-t2v";
    await expect(
      generateEcommerceVideo({
        ...params(),
        referenceVideo: "data:video/mp4;base64,AAAA",
      }),
    ).rejects.toThrow("尚未接入本地参考视频");
    expect(mocks.videoSubmit).not.toHaveBeenCalled();
  });
  it("keeps late submission ID after cancellation and does not start polling", async () => {
    const controller = new AbortController();
    mocks.videoSubmit.mockImplementationOnce(async () => {
      controller.abort();
      return { id: "late-task" };
    });
    const onSubmitted = vi.fn();
    await expect(
      generateEcommerceVideo({
        ...params(),
        signal: controller.signal,
        onSubmitted,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(onSubmitted).toHaveBeenCalledWith("late-task");
    expect(mocks.videoPoll).not.toHaveBeenCalled();
  });
});
describe("ecommerce image cancellation routing", () => {
  it.each(["openai.images", "google.generateContent", "openai.async.media"])(
    "forwards abort to %s without replay",
    async (protocol) => {
      mocks.protocol = protocol;
      mocks.generate.mockResolvedValue({ url: "synthetic-result" });
      mocks.direct.mockResolvedValue({ url: "synthetic-result" });
      mocks.asyncGenerate.mockResolvedValue({});
      const signal = new AbortController().signal;
      const result = await generateEcommerceImage({
        modelRef: { modelId: "synthetic-image" },
        prompt: "synthetic",
        size: "1024x1024",
        referenceImages: [],
        signal,
      });
      expect(result).toEqual(["synthetic-result"]);
      const called =
        protocol === "openai.images"
          ? mocks.generate
          : protocol === "google.generateContent"
            ? mocks.direct
            : mocks.asyncGenerate;
      expect(called).toHaveBeenCalledTimes(1);
      expect(
        called.mock.calls[0][protocol === "openai.images" ? 0 : 1].signal,
      ).toBe(signal);
    },
  );
  it("does not submit an already aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateEcommerceImage({
        modelRef: { modelId: "synthetic-image" },
        prompt: "synthetic",
        size: "1024x1024",
        referenceImages: [],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
