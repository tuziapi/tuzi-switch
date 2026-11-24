import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), media: vi.fn() }));
vi.mock("../src/ecommerce-generation", () => ({
  generateEcommerceImage: mocks.generate,
}));
vi.mock("../upstream/packages/drawnix/src/services/provider-routing", () => ({
  resolveInvocationPlanFromRoute: () => ({
    provider: { apiKey: "synthetic-key", baseUrl: "https://example.invalid" },
    binding: {},
    modelRef: { modelId: "synthetic" },
  }),
}));
vi.mock("../upstream/packages/drawnix/src/services/assistant-account", () => ({
  fetchOutputMedia: mocks.media,
}));
import { createEcommerceExecutor } from "../src/ecommerce-executor";
import type { EcommerceBatch } from "../src/ecommerce-jobs";

describe("ecommerce model execution", () => {
  it("requests only one image with a per-item id and separates submitting from network acknowledgement", async () => {
    const batch: EcommerceBatch = {
      version: 1,
      id: "batch",
      createdAt: 1,
      title: "synthetic",
      tool: "product-set",
      modelRef: { modelId: "synthetic" },
      owner: null,
      references: [
        new File(["synthetic"], "reference.png", { type: "image/png" }),
      ],
      size: "1024x1024",
      items: [],
    };
    const item = {
      id: "item",
      label: "hero",
      prompt: "only hero",
      status: "running" as const,
      attempts: [
        {
          requestId: "synthetic-id",
          startedAt: 1,
          stage: "preparing" as const,
        },
      ],
    };
    const report = vi.fn(async () => {});
    mocks.generate.mockImplementation(async (params) => {
      expect(params.count).toBe(1);
      expect(params.requestId).toBe("synthetic-id");
      expect(params.prompt).toBe("only hero");
      expect(params.referenceImages).toEqual([
        "data:image/png;base64,c3ludGhldGlj",
      ]);
      await params.onSubmissionAttempt();
      expect(report.mock.calls.at(-1)?.[0]).toEqual({ stage: "submitting" });
      window.dispatchEvent(
        new CustomEvent("tuzi:creative-request-status", {
          detail: { requestId: "different", stage: "sending" },
        }),
      );
      expect(report).toHaveBeenCalledTimes(1);
      window.dispatchEvent(
        new CustomEvent("tuzi:creative-request-status", {
          detail: { requestId: "synthetic-id", stage: "sending" },
        }),
      );
      expect(report.mock.calls.at(-1)?.[0]).toEqual({ stage: "sending" });
      await params.onResponse(
        new Response("{}", {
          status: 200,
          headers: { "x-request-id": "synthetic-server-id" },
        }),
      );
      return ["data:image/png;base64,c3ludGhldGlj"];
    });
    const executor = createEcommerceExecutor();
    expect(
      await executor.generate(
        batch,
        item,
        new AbortController().signal,
        report,
      ),
    ).toContain("data:image/png");
    expect(report.mock.calls.at(-1)?.[0]).toMatchObject({
      stage: "receiving",
      httpStatus: 200,
      upstreamId: "synthetic-server-id",
    });
    const length = report.mock.calls.length;
    window.dispatchEvent(
      new CustomEvent("tuzi:creative-request-status", {
        detail: { requestId: "synthetic-id", stage: "sending" },
      }),
    );
    expect(report).toHaveBeenCalledTimes(length);
  });
  it("downloads result media through the credential-free output transport", async () => {
    mocks.media.mockResolvedValue(
      new Response("synthetic", { headers: { "content-type": "image/png" } }),
    );
    const signal = new AbortController().signal;
    const blob = await createEcommerceExecutor().download(
      "https://example.invalid/image.png",
      signal,
    );
    expect(blob.size).toBeGreaterThan(0);
    expect(mocks.media).toHaveBeenCalledWith(
      "https://example.invalid/image.png",
      signal,
      "image/*",
    );
  });
});
