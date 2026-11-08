/** Pure text protocol adapters. Never execute tool calls returned in a reply. */
export type TextProtocol = "chat" | "responses" | "anthropic" | "gemini";
export interface TextTurn {
  role: "user" | "assistant" | "system";
  content: string;
}
export interface TextUsage {
  input?: number;
  output?: number;
}
export interface TextSnapshot {
  content: string;
  reasoning: string;
  finishReason?: string;
  usage?: TextUsage;
}

export function textProtocol(protocol: string, path: string): TextProtocol {
  if (protocol === "anthropic.messages" || /\/messages\/?$/.test(path))
    return "anthropic";
  if (protocol === "openai.responses" || /\/responses\/?$/.test(path))
    return "responses";
  if (protocol === "google.generateContent") return "gemini";
  if (protocol === "openai.chat.completions") return "chat";
  throw new Error(
    "该文本模型尚未声明可用的对话协议，请检查创作配置中的文本模型。",
  );
}

export function textBody(
  protocol: TextProtocol,
  model: string,
  turns: TextTurn[],
  maxOutput?: number,
): Record<string, unknown> {
  if (
    maxOutput !== undefined &&
    (!Number.isInteger(maxOutput) || maxOutput < 1 || maxOutput > 131072)
  ) {
    throw new Error("最大输出长度应为 1–131072 的整数。");
  }
  const system = turns
    .filter((t) => t.role === "system")
    .map((t) => t.content)
    .join("\n\n");
  const messages = turns.filter((t) => t.role !== "system");
  if (protocol === "anthropic")
    return {
      model,
      stream: true,
      max_tokens: maxOutput ?? 4096,
      ...(system ? { system } : {}),
      messages: messages.map((t) => ({ ...t })),
    };
  if (protocol === "responses")
    return {
      model,
      stream: true,
      store: false,
      ...(maxOutput ? { max_output_tokens: maxOutput } : {}),
      ...(system ? { instructions: system } : {}),
      input: messages.map((t) => ({ role: t.role, content: t.content })),
    };
  if (protocol === "gemini")
    return {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: messages.map((t) => ({
        role: t.role === "assistant" ? "model" : "user",
        parts: [{ text: t.content }],
      })),
      ...(maxOutput
        ? { generationConfig: { maxOutputTokens: maxOutput } }
        : {}),
    };
  // Omit sampling parameters: some reasoning models reject temperature/top_p.
  const outputField = /^(o[1-9](?:-|$)|gpt-[5-9](?:[.-]|$))/i.test(model)
    ? "max_completion_tokens"
    : "max_tokens";
  return {
    model,
    messages: turns,
    stream: true,
    ...(maxOutput ? { [outputField]: maxOutput } : {}),
  };
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/** SSE parsing includes split UTF-8, CRLF, multi-line data and final unterminated records. */
export async function readTextStream(
  response: Response,
  protocol: TextProtocol,
  onUpdate: (snapshot: TextSnapshot) => void,
  signal?: AbortSignal,
): Promise<TextSnapshot> {
  const state: TextSnapshot = { content: "", reasoning: "" };
  let terminal = false;
  const update = () =>
    onUpdate({ ...state, usage: state.usage && { ...state.usage } });
  const usage = (value: any) => {
    if (!value) return;
    state.usage = {
      input:
        numeric(
          value.prompt_tokens ?? value.input_tokens ?? value.promptTokenCount,
        ) ?? state.usage?.input,
      output:
        numeric(
          value.completion_tokens ??
            value.output_tokens ??
            value.candidatesTokenCount,
        ) ?? state.usage?.output,
    };
  };
  const finish = (reason?: string) => {
    state.finishReason = reason || "stop";
    terminal = true;
  };
  const accept = (data: any, nonStream = false) => {
    if (!data || typeof data !== "object")
      throw new Error("文本接口返回了无效数据。");
    if (data.error || data.type === "error")
      throw new Error(
        typeof data.error === "string"
          ? data.error
          : data.error?.message || data.message || "模型服务返回错误。",
      );
    usage(data.usage ?? data.usageMetadata ?? data.message?.usage);
    if (protocol === "chat") {
      const choice = data.choices?.[0];
      const part = choice?.delta ?? choice?.message;
      if (typeof part?.content === "string") state.content += part.content;
      if (typeof part?.refusal === "string") state.content += part.refusal;
      if (typeof part?.reasoning_content === "string")
        state.reasoning += part.reasoning_content;
      if (typeof part?.reasoning === "string")
        state.reasoning += part.reasoning;
      if (choice?.finish_reason) state.finishReason = choice.finish_reason;
      if (nonStream && part) finish(choice.finish_reason);
    } else if (protocol === "responses") {
      if (
        data.type === "response.output_text.delta" ||
        data.type === "response.refusal.delta"
      )
        state.content += data.delta || "";
      if (data.type === "response.reasoning_summary_text.delta")
        state.reasoning += data.delta || "";
      const result = data.response ?? data;
      if (
        ["response.failed", "response.cancelled"].includes(data.type) ||
        ["failed", "cancelled"].includes(result.status)
      )
        throw new Error(result.error?.message || "模型未能完成此次回复。");
      if (
        ["response.completed", "response.incomplete"].includes(data.type) ||
        nonStream
      ) {
        if (!state.content)
          state.content =
            result.output_text ||
            (result.output || [])
              .filter((v: any) => v.type === "message")
              .flatMap((v: any) => v.content || [])
              .map((v: any) => v.text || v.refusal || "")
              .join("");
        usage(result.usage);
        finish(
          result.status === "incomplete"
            ? result.incomplete_details?.reason || "incomplete"
            : "stop",
        );
      }
    } else if (protocol === "anthropic") {
      if (data.type === "content_block_delta") {
        if (data.delta?.type === "text_delta")
          state.content += data.delta.text || "";
        if (data.delta?.type === "thinking_delta")
          state.reasoning += data.delta.thinking || "";
      }
      if (
        data.type === "content_block_start" &&
        data.content_block?.type === "text"
      )
        state.content += data.content_block.text || "";
      if (data.type === "message_delta" && data.delta?.stop_reason)
        state.finishReason = data.delta.stop_reason;
      if (data.type === "message_stop") finish(state.finishReason);
      if (nonStream) {
        state.content = (data.content || [])
          .filter((v: any) => v.type === "text")
          .map((v: any) => v.text || "")
          .join("");
        state.reasoning = (data.content || [])
          .filter((v: any) => v.type === "thinking")
          .map((v: any) => v.thinking || "")
          .join("");
        finish(data.stop_reason);
      }
    } else {
      const candidate = data.candidates?.[0];
      for (const part of candidate?.content?.parts || []) {
        if (typeof part.text !== "string") continue;
        if (part.thought) state.reasoning += part.text;
        else state.content += part.text;
      }
      if (data.promptFeedback?.blockReason)
        throw new Error(`模型拒绝此请求：${data.promptFeedback.blockReason}`);
      if (candidate?.finishReason) finish(candidate.finishReason);
      if (nonStream) finish(candidate?.finishReason);
    }
    update();
  };
  signal?.throwIfAborted();
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("文本接口没有返回响应。");
    const abort = () => {
      void reader.cancel().catch(() => {});
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const decoder = new TextDecoder();
      let text = "",
        bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        bytes += value?.byteLength || 0;
        if (bytes > 32 * 1024 * 1024)
          throw new Error("文本回复超过 32 MiB，请缩小本次请求。");
        text += done
          ? decoder.decode()
          : decoder.decode(value, { stream: true });
        if (done) break;
      }
      accept(JSON.parse(text), true);
    } finally {
      signal?.removeEventListener("abort", abort);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } else {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("文本接口没有返回响应流。");
    const decoder = new TextDecoder();
    let buffer = "",
      fields: string[] = [],
      bytes = 0;
    const flush = () => {
      if (!fields.length) return;
      const value = fields.join("\n");
      fields = [];
      if (value.trim() === "[DONE]") {
        finish(state.finishReason);
        return;
      }
      let json: unknown;
      try {
        json = JSON.parse(value);
      } catch {
        throw new Error("文本流数据不完整或格式错误，已保留收到的内容。");
      }
      accept(json);
    };
    const line = (value: string) => {
      if (!value) {
        flush();
        return;
      }
      if (value.startsWith("data:"))
        fields.push(value.slice(5).replace(/^ /, ""));
    };
    const abort = () => {
      void reader.cancel().catch(() => {});
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      while (true) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        bytes += value?.byteLength || 0;
        if (bytes > 32 * 1024 * 1024)
          throw new Error("文本回复超过 32 MiB，请缩小本次请求。");
        buffer += done
          ? decoder.decode()
          : decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf("\n")) !== -1) {
          line(buffer.slice(0, boundary).replace(/\r$/, ""));
          buffer = buffer.slice(boundary + 1);
        }
        if (done) {
          if (buffer) line(buffer.replace(/\r$/, ""));
          flush();
          if (protocol === "chat" && state.finishReason) terminal = true;
          break;
        }
        // Terminal events end consumption even if the provider keeps the connection open.
        if (terminal) {
          await reader.cancel().catch(() => {});
          break;
        }
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  if (!terminal)
    throw new Error(
      "连接已结束，但未收到完成标记。已保留部分回复，可手动重试。",
    );
  if (!state.content.trim() && !state.reasoning.trim())
    throw new Error("模型未返回可显示的文本，请检查所选模型及接口。");
  update();
  return { ...state };
}
