import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ get: vi.fn(), fallbacks: vi.fn() }));
vi.mock("../../packages/creative-workspace/node_modules/axios", () => ({ default: { get: mock.get } }));
vi.mock(
  "../../packages/creative-workspace/upstream/packages/drawnix/src/services/provider-routing/provider-transport",
  () => ({
    providerTransport: {
      prepareRequest: () => ({
        init: { headers: { authorization: "Bearer synthetic-test-only" } },
      }),
    },
  }),
);
vi.mock(
  "../../packages/creative-workspace/upstream/packages/drawnix/src/services/provider-routing/tuzi-api-endpoints",
  () => ({
    isTuziRequestRecoveryBaseUrl: (url) => url.endsWith(".test"),
    isTrustedTuziApiBaseUrl: (url) => url === "https://fallback.test",
    loadTuziApiEndpointBaseUrls: mock.fallbacks,
    normalizeTuziApiEndpointUrl: (url) => url,
  }),
);
vi.mock(
  "../../packages/creative-workspace/upstream/packages/drawnix/src/services/tuzi-client-attribution",
  () => ({ withTuziClientChannel: (url) => url }),
);
vi.mock(
  "../../packages/creative-workspace/upstream/packages/drawnix/src/services/image-generation-recovery-metadata",
  () => ({
    buildImageRecoveryUrl: (base, id) =>
      `${base}/log/get-request?request_id=${id}`,
  }),
);
vi.mock(
  "../../packages/creative-workspace/upstream/packages/drawnix/src/utils/tauri-env",
  () => ({ isTauriEnvironment: () => false }),
);

import { queryImageResult } from "../../packages/creative-workspace/upstream/packages/drawnix/src/services/query-image-result";

beforeEach(() => {
  vi.clearAllMocks();
  mock.get.mockReset();
  mock.fallbacks.mockResolvedValue([
    "https://untrusted.invalid",
    "https://fallback.test",
  ]);
});

describe("free canvas image recovery after workflow removal", () => {
  it("queries the original provider and accepts matching request IDs", async () => {
    const payload = { status: "succeeded", request_id: "request-1", data: [] };
    mock.get.mockResolvedValue({ data: payload });
    expect(
      await queryImageResult(
        "https://original.test",
        "synthetic-test-only",
        "request-1",
      ),
    ).toEqual(payload);
    expect(mock.get.mock.calls[0][0]).toBe(
      "https://original.test/log/get-request?request_id=request-1",
    );
    expect(mock.fallbacks).not.toHaveBeenCalled();
  });
  it("does not attach another request's result", async () => {
    mock.get.mockResolvedValue({
      data: { status: "succeeded", request_id: "other-request" },
    });
    expect(
      await queryImageResult(
        "https://original.test",
        "synthetic-test-only",
        "request-1",
      ),
    ).toEqual({ status: "processing_or_not_found" });
  });
  it("falls back only to trusted endpoints after a transport failure", async () => {
    mock.get
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        data: { status: "succeeded", requestId: "request-1" },
      });
    await queryImageResult(
      "https://original.test",
      "synthetic-test-only",
      "request-1",
    );
    expect(mock.get.mock.calls.map((call) => call[0])).toEqual([
      "https://original.test/log/get-request?request_id=request-1",
      "https://fallback.test/log/get-request?request_id=request-1",
    ]);
  });
  it("does not hide an authentication error by trying other providers", async () => {
    const error = { response: { status: 401 } };
    mock.get.mockRejectedValue(error);
    await expect(
      queryImageResult(
        "https://original.test",
        "synthetic-test-only",
        "request-1",
      ),
    ).rejects.toBe(error);
    expect(mock.fallbacks).not.toHaveBeenCalled();
  });
  it("rejects unsupported providers before sending a request", async () => {
    await expect(
      queryImageResult(
        "https://untrusted.invalid",
        "synthetic-test-only",
        "request-1",
      ),
    ).rejects.toThrow("不支持");
    expect(mock.get).not.toHaveBeenCalled();
  });
});
