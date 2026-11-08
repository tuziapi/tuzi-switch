import { describe, expect, it } from "vitest";
import { readTextStream, textBody, textProtocol } from "./protocol";

function sse(text: string, split = 3) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += split)
          c.enqueue(bytes.slice(i, i + split));
        c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
const event = (v: unknown) => `data: ${JSON.stringify(v)}\r\n\r\n`;
describe("text protocol decoding", () => {
  it("preserves split Chinese and handles optional spaces, CRLF and final unterminated data", async () => {
    const text =
      "data:" +
      JSON.stringify({ choices: [{ delta: { content: "你好 🌿" } }] }) +
      "\r\n\r\ndata: [DONE]";
    expect((await readTextStream(sse(text, 1), "chat", () => {})).content).toBe(
      "你好 🌿",
    );
  });
  it("separates DeepSeek reasoning from the answer and captures usage", async () => {
    const result = await readTextStream(
      sse(
        event({ choices: [{ delta: { reasoning_content: "分析" } }] }) +
          event({
            choices: [{ delta: { content: "答案" } }],
            usage: { prompt_tokens: 12, completion_tokens: 9 },
          }) +
          event({ choices: [{ delta: {}, finish_reason: "length" }] }),
      ),
      "chat",
      () => {},
    );
    expect(result).toMatchObject({
      content: "答案",
      reasoning: "分析",
      finishReason: "length",
      usage: { input: 12, output: 9 },
    });
  });
  it("reads usage arriving in a separate chunk after finish_reason", async () => {
    const result = await readTextStream(
      sse(
        event({
          choices: [{ delta: { content: "done" }, finish_reason: "stop" }],
        }) +
          event({
            choices: [],
            usage: { prompt_tokens: 14, completion_tokens: 7 },
          }) +
          "data: [DONE]\n\n",
        1,
      ),
      "chat",
      () => {},
    );
    expect(result.usage).toEqual({ input: 14, output: 7 });
  });
  it("decodes Responses deltas and incomplete token limit", async () => {
    const result = await readTextStream(
      sse(
        event({
          type: "response.reasoning_summary_text.delta",
          delta: "摘要",
        }) +
          event({ type: "response.output_text.delta", delta: "正文" }) +
          event({
            type: "response.incomplete",
            response: {
              status: "incomplete",
              incomplete_details: { reason: "max_output_tokens" },
              usage: { output_tokens: 20 },
            },
          }),
      ),
      "responses",
      () => {},
    );
    expect(result).toMatchObject({
      content: "正文",
      reasoning: "摘要",
      finishReason: "max_output_tokens",
      usage: { output: 20 },
    });
  });
  it("decodes Anthropic thinking, text and message_stop", async () => {
    const text =
      event({
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "思考" },
      }) +
      event({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "完成" },
      }) +
      event({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 3 },
      }) +
      event({ type: "message_stop" });
    expect(
      await readTextStream(sse(text), "anthropic", () => {}),
    ).toMatchObject({
      content: "完成",
      reasoning: "思考",
      finishReason: "end_turn",
    });
  });
  it("decodes Gemini thought parts independently", async () => {
    const result = await readTextStream(
      sse(
        event({
          candidates: [
            {
              content: {
                parts: [{ text: "摘要", thought: true }, { text: "结果" }],
              },
              finishReason: "STOP",
            },
          ],
        }),
      ),
      "gemini",
      () => {},
    );
    expect(result).toMatchObject({ content: "结果", reasoning: "摘要" });
  });
  it("accepts multiline SSE data", async () => {
    expect(
      (
        await readTextStream(
          sse(
            'data: {"choices":\ndata: [{"delta":{"content":"yes"},"finish_reason":"stop"}]}\n\n',
          ),
          "chat",
          () => {},
        )
      ).content,
    ).toBe("yes");
  });
  it("accepts a non-stream JSON reply when a provider ignores stream=true", async () => {
    expect(
      (
        await readTextStream(
          new Response(
            JSON.stringify({
              content: [{ type: "text", text: "你好" }],
              stop_reason: "end_turn",
            }),
            { headers: { "content-type": "application/json" } },
          ),
          "anthropic",
          () => {},
        )
      ).content,
    ).toBe("你好");
  });
  it("rejects EOF without a completion signal while preserving updates", async () => {
    let partial = "";
    await expect(
      readTextStream(
        sse(event({ choices: [{ delta: { content: "partial" } }] })),
        "chat",
        (s) => {
          partial = s.content;
        },
      ),
    ).rejects.toThrow("完成标记");
    expect(partial).toBe("partial");
  });
  it("reports stream errors and malformed data", async () => {
    await expect(
      readTextStream(
        sse(event({ error: { message: "quota unavailable" } })),
        "chat",
        () => {},
      ),
    ).rejects.toThrow("quota");
    await expect(
      readTextStream(sse("data: {bad}\n\n"), "chat", () => {}),
    ).rejects.toThrow("格式错误");
  });
  it("reports failed Responses and Gemini blocked requests", async () => {
    await expect(
      readTextStream(
        sse(
          event({
            type: "response.failed",
            response: { error: { message: "failed" } },
          }),
        ),
        "responses",
        () => {},
      ),
    ).rejects.toThrow("failed");
    await expect(
      readTextStream(
        sse(event({ promptFeedback: { blockReason: "SAFETY" } })),
        "gemini",
        () => {},
      ),
    ).rejects.toThrow("SAFETY");
  });
  it("cancels an idle stream promptly", async () => {
    const controller = new AbortController();
    const promise = readTextStream(
      new Response(new ReadableStream({ start() {} })),
      "chat",
      () => {},
      controller.signal,
    );
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
  it("rejects empty completion instead of claiming success", async () => {
    await expect(
      readTextStream(sse("data: [DONE]\n\n"), "chat", () => {}),
    ).rejects.toThrow("可显示");
  });
});
describe("text request formats", () => {
  const turns = [
    { role: "system" as const, content: "系统" },
    { role: "user" as const, content: "问题" },
    { role: "assistant" as const, content: "回答" },
  ];
  it("does not inject unsupported sampling parameters", () => {
    const body = textBody("chat", "synthetic-model", turns);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body.messages).toEqual(turns);
  });
  it("uses compatible output limits for DeepSeek and OpenAI reasoning models", () => {
    expect(textBody("chat", "deepseek-chat", turns, 100)).toHaveProperty(
      "max_tokens",
      100,
    );
    expect(textBody("chat", "gpt-5", turns, 100)).toHaveProperty(
      "max_completion_tokens",
      100,
    );
    expect(textBody("chat", "o3-mini", turns, 100)).toHaveProperty(
      "max_completion_tokens",
      100,
    );
  });
  it("maps Responses system, assistant history and output length", () => {
    expect(textBody("responses", "synthetic-model", turns, 800)).toMatchObject({
      instructions: "系统",
      max_output_tokens: 800,
      store: false,
      input: [
        { role: "user", content: "问题" },
        { role: "assistant", content: "回答" },
      ],
    });
  });
  it("uses required Anthropic max_tokens and top-level system", () => {
    expect(textBody("anthropic", "synthetic-model", turns)).toMatchObject({
      system: "系统",
      max_tokens: 4096,
      messages: turns.slice(1),
    });
  });
  it("maps Gemini roles", () => {
    expect(textBody("gemini", "synthetic-model", turns)).toMatchObject({
      systemInstruction: { parts: [{ text: "系统" }] },
      contents: [{ role: "user" }, { role: "model" }],
    });
  });
  it("rejects invalid output lengths and unknown protocols", () => {
    for (const max of [0, -1, NaN, 3.5, 200000])
      expect(() => textBody("chat", "m", turns, max)).toThrow();
    expect(() => textProtocol("unknown", "/custom")).toThrow("协议");
    expect(textProtocol("openai.responses", "/responses")).toBe("responses");
    expect(textProtocol("anthropic.messages", "/messages")).toBe("anthropic");
  });
});
