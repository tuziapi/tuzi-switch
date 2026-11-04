// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  prepareAccountTarget,
  prepareCreativeRequest,
} from "@/features/creative/requestTransport";

const origin = "https://api.tu-zi.com";
const reference = "tuzi-account:synthetic-binding";

describe("one creative adapter request for both credential sources", () => {
  it.each([
    ["POST", "/v1/images/generations", '{"model":"synthetic-image","n":2}'],
    ["POST", "/v1/videos", '{"model":"synthetic-video","seconds":6}'],
    [
      "POST",
      "/kling/v1/videos/text2video",
      '{"model_name":"synthetic-kling","prompt":"test"}',
    ],
    [
      "POST",
      "/v2/video_generation",
      '{"model":"synthetic-minimax","prompt":"test"}',
    ],
    ["GET", "/v1/videos/synthetic-task/content", undefined],
    ["GET", "/kling/v1/videos/text2video/synthetic-task", undefined],
    ["POST", "/suno/submit/music", '{"mv":"synthetic-suno","prompt":"test"}'],
    [
      "POST",
      "/suno/api/v1/generate",
      '{"model":"synthetic-suno","instrumental":true}',
    ],
    [
      "GET",
      "/suno/api/v1/generate/record-info?taskId=synthetic&channel=desktop",
      undefined,
    ],
    ["GET", "/suno/v2/fetch/synthetic-task", undefined],
    [
      "POST",
      "/v1/chat/completions",
      '{"model":"synthetic-text","stream":true}',
    ],
    ["POST", "/v1/responses", '{"model":"synthetic-text","input":"test"}'],
    ["POST", "/v1/messages", '{"model":"synthetic-text","max_tokens":12}'],
    [
      "POST",
      "/v1beta/models/synthetic:streamGenerateContent?alt=sse",
      '{"contents":[]}',
    ],
    ["GET", "/log/get-request?id=synthetic-request", undefined],
    ["POST", "/mj/submit/imagine", '{"prompt":"test"}'],
    ["GET", "/flux/v1/get_result?id=synthetic-task", undefined],
  ])(
    "preserves %s %s without action/model reinterpretation",
    async (method, path, body) => {
      const init = {
        method,
        body,
        headers: {
          "content-type": "application/json",
          "x-request-id": "synthetic-id",
        },
      };
      const manual = await prepareCreativeRequest(origin + path, init);
      const target = prepareAccountTarget(reference, origin + path, init);
      const account = await prepareCreativeRequest(target.url, target.init);
      expect({ ...account, requestId: "ignored" }).toEqual({
        ...manual,
        requestId: "ignored",
      });
      expect(account).not.toHaveProperty("action");
    },
  );

  it("preserves multipart filenames, MIME types and binary bytes", async () => {
    const form = new FormData();
    form.set("model", "synthetic");
    form.set(
      "image",
      new Blob([new Uint8Array([0, 255, 128, 1])], { type: "image/png" }),
      "original.png",
    );
    for (const source of ["manual", "account"]) {
      const input = { method: "POST", body: form };
      const target =
        source === "account"
          ? prepareAccountTarget(reference, origin + "/v1/images/edits", input)
          : { url: origin + "/v1/images/edits", init: input };
      const result = await prepareCreativeRequest(target.url, target.init);
      const bytes = Uint8Array.from(atob(result.body!), (c) => c.charCodeAt(0));
      const decoded = await new Response(bytes, {
        headers: result.headers,
      }).formData();
      const file = decoded.get("image") as File;
      expect(file.name).toBe("original.png");
      expect(file.type).toBe("image/png");
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(
        new Uint8Array([0, 255, 128, 1]),
      );
      expect(decoded.get("model")).toBe("synthetic");
    }
  });

  it("removes credential placeholders while preserving protocol headers and polling parameters", async () => {
    const target = prepareAccountTarget(
      reference,
      origin +
        "/v1beta/models/synthetic:generateContent?key=" +
        encodeURIComponent(reference) +
        "&alt=sse",
      {
        headers: {
          authorization: `Bearer ${reference}`,
          "x-api-key": reference,
          "x-goog-api-key": reference,
          "new-api-user": "another-user",
          "anthropic-version": "2023-06-01",
        },
      },
    );
    const result = await prepareCreativeRequest(target.url, target.init);
    expect(result.url).toBe(
      origin + "/v1beta/models/synthetic:generateContent?alt=sse",
    );
    expect(result.headers).toEqual({ "anthropic-version": "2023-06-01" });
    expect(JSON.stringify(result)).not.toContain(reference);
  });

  it.each([
    "/api/token/9",
    "/v1/../api/token/9",
    "/v1/%2e%2e/api/token/9",
    "/suno/%252e%252e/api/token/9",
    "/v1/models?api_key=unrelated",
  ])("rejects management and credential injection: %s", (path) => {
    expect(() => prepareAccountTarget(reference, origin + path, {})).toThrow();
  });
});
