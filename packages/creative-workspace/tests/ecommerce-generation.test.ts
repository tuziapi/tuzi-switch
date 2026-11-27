import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  protocol: "openai.images",
  generate: vi.fn(),
  direct: vi.fn(),
  asyncGenerate: vi.fn(),
  videoSubmit: vi.fn(),
  videoPoll: vi.fn(),
  seedanceSubmit: vi.fn(),
  seedancePoll: vi.fn(),
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
vi.mock(
  "../upstream/packages/drawnix/src/services/model-adapters/seedance2-adapter",
  () => ({
    submitSeedance2Request: mocks.seedanceSubmit,
  }),
);
vi.mock(
  "../upstream/packages/drawnix/src/services/media-api/video-api",
  () => ({
    pollVideoUntilComplete: mocks.seedancePoll,
  }),
);
import {
  generateEcommerceImage,
  generateEcommerceVideo,
  supportsEcommerceVideoReference,
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
  it("carries Mix parameters into the shared request contract without provider fields", async () => {
    mocks.modelId = "viduq3-mix";
    await generateEcommerceVideo({
      ...params(),
      referenceImages: ["https://example.com/product.png"],
      aspectRatio: "3:4",
      generationParams: {
        vidu_sound_urls: "https://example.com/sound.mp3",
        seed: "42",
        watermark: "false",
        apiKey: "synthetic-do-not-forward",
      },
    });
    const request = mocks.videoSubmit.mock.calls[0][0];
    expect(request.params).toEqual({
      vidu_sound_urls: "https://example.com/sound.mp3",
      seed: "42",
      watermark: "false",
      aspect_ratio: "3:4",
      ratio: "3:4",
    });
    const { buildTuziVideoRequest } = await import(
      "../upstream/packages/drawnix/src/services/tuzi-video-request"
    );
    expect(
      await buildTuziVideoRequest({
        ...request,
        duration: request.seconds,
        referenceImages: request.inputReferences.map((r: any) => r.url),
      }),
    ).toMatchObject({
      model: "viduq3-mix",
      sounds: ["https://example.com/sound.mp3"],
      seed: 42,
      watermark: false,
      aspect_ratio: "3:4",
      metadata: { action: "referenceGenerate" },
    });
  });
  it("blocks mismatched Vidu actions before submit, but resumes an existing task without references", async () => {
    mocks.modelId = "viduq3-turbo";
    await expect(
      generateEcommerceVideo({
        ...params(),
        generationParams: { vidu_action: "firstTailGenerate" },
        referenceImages: ["https://example.com/one.png"],
      }),
    ).rejects.toThrow("需要 2 张");
    expect(mocks.videoSubmit).not.toHaveBeenCalled();
    await generateEcommerceVideo({
      ...params(),
      taskId: "task_existing",
      generationParams: { vidu_action: "firstTailGenerate" },
    });
    expect(mocks.videoSubmit).not.toHaveBeenCalled();
    expect(mocks.videoPoll.mock.calls[0][0]).toBe("task_existing");
  });
  it("resume queries the existing remote task without paid submission", async () => {
    await generateEcommerceVideo({ ...params(), taskId: "existing-task" });
    expect(mocks.videoSubmit).not.toHaveBeenCalled();
    expect(mocks.videoPoll.mock.calls[0][0]).toBe("existing-task");
  });
  it("submits Seedance reference videos through its content-JSON adapter and saves the ID before polling", async () => {
    mocks.modelId = "doubao-seedance-2-5-260628";
    mocks.seedanceSubmit.mockResolvedValue({ taskId: "synthetic-seedance" });
    let saved = false;
    mocks.seedancePoll.mockImplementationOnce(async () => {
      expect(saved).toBe(true);
      return {
        status: "succeeded",
        content: { video_url: "https://example.invalid/seedance.mp4" },
      };
    });
    const result = await generateEcommerceVideo({
      ...params(),
      seconds: "4",
      size: "720p",
      referenceVideo: "https://example.invalid/reference.mp4",
      onSubmitted: async () => {
        saved = true;
      },
    });
    expect(mocks.videoSubmit).not.toHaveBeenCalled();
    expect(mocks.seedanceSubmit.mock.calls[0][1]).toMatchObject({
      duration: 4,
      size: "720p",
      params: { input_videos: ["https://example.invalid/reference.mp4"] },
    });
    expect(result).toEqual(["https://example.invalid/seedance.mp4"]);
  });
  it("rejects local Seedance video before submission and does not advertise file-upload support", async () => {
    mocks.modelId = "doubao-seedance-2-5-260628";
    expect(supportsEcommerceVideoReference(mocks.modelId)).toBe(false);
    for (const referenceVideo of [
      "data:video/mp4;base64,AAAA",
      "blob:tauri://localhost/synthetic",
      "http://127.0.0.1/reference.mp4",
    ]) {
      await expect(
        generateEcommerceVideo({ ...params(), referenceVideo }),
      ).rejects.toThrow("尚未接入素材上传服务");
    }
    expect(mocks.seedanceSubmit).not.toHaveBeenCalled();
    expect(mocks.videoSubmit).not.toHaveBeenCalled();
  });
  it("resumes a Seedance task without new submission and rejects an image model before billing", async () => {
    mocks.modelId = "doubao-seedance-2-5-260628";
    mocks.seedancePoll.mockResolvedValue({
      status: "completed",
      url: "https://example.invalid/seedance.mp4",
    });
    await generateEcommerceVideo({ ...params(), taskId: "existing-seedance" });
    expect(mocks.seedanceSubmit).not.toHaveBeenCalled();
    expect(mocks.seedancePoll.mock.calls[0][0]).toBe("existing-seedance");
    mocks.modelId = "gpt-image-2";
    await expect(generateEcommerceVideo(params())).rejects.toThrow(
      "不是视频模型",
    );
    expect(mocks.videoSubmit).not.toHaveBeenCalled();
  });
  it("uses the first-frame ratio for MiniMax image generation, retaining ratios for video references and text", async () => {
    mocks.modelId = "MiniMax-H3";
    await generateEcommerceVideo({
      ...params(),
      referenceImages: ["data:image/png;base64,AAAA"],
    });
    expect(mocks.videoSubmit.mock.calls[0][0].params).toMatchObject({
      ratio: "adaptive",
      aspect_ratio: "adaptive",
    });
    await generateEcommerceVideo({
      ...params(),
      referenceImages: ["data:image/png;base64,AAAA"],
      referenceVideo: "data:video/mp4;base64,AAAA",
    });
    expect(mocks.videoSubmit.mock.calls[1][0].params.ratio).toBe("16:9");
    await generateEcommerceVideo(params());
    expect(mocks.videoSubmit.mock.calls[2][0].params.ratio).toBe("16:9");
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
  it("passes image parameters into the adapter request rather than only the prompt", async () => {
    mocks.generate.mockResolvedValue({ url: "synthetic-result" });
    await generateEcommerceImage({
      modelRef: { modelId: "synthetic-image" },
      prompt: "synthetic",
      size: "1x1",
      referenceImages: ["product", "style"],
      generationParams: {
        size: "1x1",
        resolution: "4k",
        quality: "xhigh",
        background: "opaque",
      },
      count: 1,
    });
    expect(mocks.generate.mock.calls[0][1]).toMatchObject({
      size: "1x1",
      referenceImages: ["product", "style"],
      params: {
        n: 1,
        resolution: "4k",
        quality: "xhigh",
        background: "opaque",
      },
    });
  });
  it("passes Gemini resolution quality and thinking to the direct request", async () => {
    mocks.protocol = "google.generateContent";
    mocks.direct.mockResolvedValue({ url: "synthetic-result" });
    await generateEcommerceImage({
      modelRef: { modelId: "synthetic-image" },
      prompt: "synthetic",
      size: "9x16",
      referenceImages: [],
      generationParams: { quality: "4k", thinking: "high" },
    });
    expect(mocks.direct.mock.calls[0][1]).toMatchObject({
      size: "9x16",
      quality: "4k",
      thinking: "high",
    });
  });
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
