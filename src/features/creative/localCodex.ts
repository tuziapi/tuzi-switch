import { Channel, invoke } from "@tauri-apps/api/core";
import type { CreativeCodexBridge } from "@tuzi/creative-workspace";

const errors: Record<string, string> = {
  codex_not_found: "未找到本地 Codex CLI，请先安装并在终端完成登录。",
  codex_no_models: "Codex 未返回可用模型，请检查本地 CLI 的配置和登录。",
  codex_connection_lost:
    "Codex 连接已中断，请重新连接后再发送。未切换到其他文本模型。",
  codex_request_rejected:
    "Codex 未接受请求，请检查 CLI 版本、模型配置和登录状态。",
  codex_turn_failed: "Codex 本轮回复失败，请检查额度、模型或登录状态后重试。",
  codex_timeout: "等待 Codex 超时，本次已停止。请检查本地 CLI 后重试。",
  codex_model_unavailable:
    "所选 Codex 模型或思考强度已不可用，请重新连接并选择。",
  codex_images_unsupported:
    "当前 Codex 模型未声明支持图片，请移除引用或选择支持图片的模型。",
  codex_invalid_input: "讨论内容或图片超出限制，请缩短内容并减少图片。",
  codex_invalid_protocol: "Codex 返回了不兼容的数据，请检查 CLI 版本。",
  codex_tools_unavailable:
    "此连接用于文本讨论，请让 Codex 返回生成计划，由兔子助手确认执行。",
  codex_output_too_large: "Codex 回复过长，本次已停止，请拆分问题。",
  codex_empty_response: "Codex 没有返回有效回复，请重试。",
  codex_busy: "Codex 正在处理其他请求，请稍后再试。",
};
export function codexError(error: unknown): Error {
  return new Error(
    errors[String(error)] || "本地 Codex 暂不可用，请检查 CLI 后重新连接。",
  );
}
type Event =
  | { type: "ready" }
  | { type: "delta" | "complete"; content: string; reasoning: string };
export const nativeLocalCodex: CreativeCodexBridge = {
  probe: () =>
    invoke<Awaited<ReturnType<CreativeCodexBridge["probe"]>>>(
      "creative_codex_probe",
    ).catch((e) => {
      throw codexError(e);
    }),
  request: ({ signal, onUpdate, ...input }) => {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      let settled = false;
      let aborted = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let snapshot = { content: "", reasoning: "" };
      const cancel = () => {
        void invoke("creative_codex_cancel", { requestId }).catch(() => {});
      };
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        clearTimeout(timer);
      };
      const fail = (e: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        cancel();
        reject(
          signal.aborted
            ? new DOMException("已停止", "AbortError")
            : codexError(e),
        );
      };
      const abort = () => {
        aborted = true;
        fail("codex_cancelled");
      };
      const onEvent = new Channel<Event>();
      onEvent.onmessage = (event) => {
        if (event.type === "ready") {
          if (aborted) cancel();
          return;
        }
        if (settled) return;
        if (event.type === "delta") {
          snapshot = {
            content: snapshot.content + event.content,
            reasoning: snapshot.reasoning + event.reasoning,
          };
          onUpdate(snapshot);
        } else {
          settled = true;
          cleanup();
          resolve({ content: event.content, reasoning: event.reasoning });
        }
      };
      signal.addEventListener("abort", abort, { once: true });
      void invoke("creative_codex_chat", {
        request: { ...input, requestId },
        onEvent,
      })
        .then(() => {
          // Channel delivery can lag command completion. Only the explicit event completes a reply.
          if (!settled)
            timer = setTimeout(() => fail("codex_connection_lost"), 30_000);
        })
        .catch(fail);
    });
  },
};
