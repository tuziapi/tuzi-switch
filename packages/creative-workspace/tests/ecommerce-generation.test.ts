import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  protocol: "openai.images",
  generate: vi.fn(),
  direct: vi.fn(),
  asyncGenerate: vi.fn(),
}));
vi.mock("../upstream/packages/drawnix/src/services/provider-routing", () => ({
  resolveInvocationPlanFromRoute: () => ({
    modelRef: { modelId: "synthetic-image" },
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
  videoAPIService: {},
}));
import { generateEcommerceImage } from "../src/ecommerce-generation";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.protocol = "openai.images";
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
