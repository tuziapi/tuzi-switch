import { settingsApi } from "@/lib/api/settings";
import { invoke } from "@tauri-apps/api/core";
import { desktopRequest, type AccountState } from "@/lib/api/account";
import type {
  CreativeAccountBinding,
  CreativeAccountBridge,
  CreativeAccountKey,
} from "@tuzi/creative-workspace";

import {
  encodeCreativeBytes as encode,
  nativeCreativeResponse,
} from "./nativeStream";
import { requestCreativeManual } from "./manualTransport";
import { nativeImageAction } from "./imageActions";
import { selectCreativeMediaAction } from "./mediaActions";

const PREFIX = "tuzi-account:";
const messages: Record<string, string> = {
  creative_account_unavailable: "兔子账户未连接或已切换，请重新连接后再试。",
  creative_binding_not_found: "当前账户没有此关联，请重新选择 API Key。",
  stale_account: "账户已切换，请重新选择 API Key。",
  creative_action_unsupported: "此接口暂未接入账户关联，可使用手动供应商配置。",
  model_not_qualified:
    "当前 Key 未开放此模型或未声明对应接口，请刷新模型列表或使用手动配置。",
  provider_selection_not_qualified: "此 Key 已停用、过期或额度不足。",
  network_uncertain:
    "账户或模型权限检查网络失败，尚未提交生成请求，请检查连接后重试。",
  model_list_unavailable:
    "当前 Key 的模型列表无法读取，尚未提交生成请求，请重新获取模型。",
  rate_limited: "账户校验请求过于频繁，尚未提交生成请求，请稍后重试。",
  invalid_token: "兔子账户系统令牌已失效，请重新连接账户。",
  insufficient_scope: "兔子账户没有读取此 Key 的权限，请检查账户权限。",
  account_disabled: "兔子账户已停用，请检查账户状态。",
  identity_mismatch: "兔子账户身份不匹配，请重新连接账户。",
  not_found: "关联的账户 Key 已不存在，请重新选择 API Key。",
  dependency_unavailable:
    "账户校验服务暂时不可用，尚未提交生成请求，请稍后重试。",
  server_error: "账户校验服务返回错误，尚未提交生成请求，请稍后重试。",
  business_error:
    "账户拒绝了 Key 校验，尚未提交生成请求，请检查账户和 Key 状态。",
  invalid_response: "账户校验响应格式异常，尚未提交生成请求，请重新检查连接。",
  invalid_model: "生成请求未包含有效模型，请重新选择模型。",
  missing_body: "生成请求缺少内容，请重新填写提示词。",
  invalid_body: "生成请求格式无效，请检查模型配置。",
  invalid_request_id: "生成请求编号无效，请重新打开创作工作区。",
  body_too_large: "上传内容超过 64 MB，请缩小文件后重试。",
  response_too_large:
    "模型响应超过 64 MB，无法在客户端接收；请先查询已有任务结果。",
  creative_outcome_unknown: "请求结果待确认，请先查询任务结果，避免重复提交。",
  creative_cancelled_outcome_unknown:
    "请求已停止等待；已提交的任务可能仍在运行，请先查询结果。",
};
export function creativeError(error: unknown): Error {
  const code =
    typeof error === "string" ? error : (error as { code?: string })?.code;
  const errorMessage =
    messages[code || ""] ||
    (code?.startsWith("creative_upstream_")
      ? "模型服务拒绝了请求，请检查 Key 状态、模型权限或额度。"
      : "配置操作失败，请稍后重试。");
  return new Error(errorMessage);
}
function actionFor(url: string, method: string) {
  const parsed = new URL(url);
  if (
    parsed.origin !== "https://api.tu-zi.com" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  )
    throw new Error("账户关联仅支持兔子账户的受管地址。");
  const path = parsed.pathname.replace(/\/$/, "");
  const actions: Record<string, string> = {
    "GET /v1/models": "models",
    "POST /v1/images/generations": "image.generate",
    "POST /v1/images/edits": "image.edit",
    "POST /v1/chat/completions": "chat",
    "POST /v1/responses": "responses",
    "POST /v1/videos": "video.create",
    "POST /v1/audio/speech": "audio.speech",
    "POST /v1/audio/transcriptions": "audio.transcribe",
  };
  const action = actions[method + " " + path];
  const mediaAction = selectCreativeMediaAction(parsed, method);
  if (mediaAction) return mediaAction;
  const allowedQuery = [
    "ch",
    "tuzi_client",
    "client_channel",
    "channel",
    "request_id",
    "id",
    "alt",
  ];
  if (
    [...parsed.searchParams.keys()].some((key) => !allowedQuery.includes(key))
  )
    throw new Error("账户关联不支持此请求参数。");
  if (action) return { action };
  if (method === "GET" && path === "/log/get-request")
    return {
      action: "image.result",
      taskId: parsed.searchParams.get("id") || "",
    };
  const video = path.match(/^\/v1\/videos\/([\w.-]+)(\/content)?$/);
  if (method === "GET" && video)
    return {
      action: video[2] ? "video.content" : "video.poll",
      taskId: video[1],
    };
  if (method === "GET" && path === "/v1/images/generations/result")
    return {
      action: "image.result",
      taskId: parsed.searchParams.get("request_id") || "",
    };
  const gemini = path.match(
    /^\/v1beta\/models\/([\w.-]+):(generateContent|streamGenerateContent)$/,
  );
  if (method === "POST" && gemini)
    return {
      action:
        gemini[2] === "generateContent" ? "gemini.generate" : "gemini.stream",
      model: gemini[1],
    };
  throw creativeError("creative_action_unsupported");
}
async function bodyFor(body: BodyInit | null | undefined) {
  if (body == null) return {};
  if (body instanceof FormData) {
    const parts = [];
    for (const [name, value] of body.entries()) {
      parts.push(
        typeof value === "string"
          ? { name, value }
          : {
              name,
              data: encode(new Uint8Array(await value.arrayBuffer())),
              mime: value.type || "application/octet-stream",
            },
      );
    }
    return { parts };
  }
  if (typeof body === "string") return { body: JSON.parse(body) };
  throw new Error("账户关联暂不支持这种请求格式。");
}
export function createCreativeAccountBridge(
  state: AccountState,
  manageAccount: () => void,
  selectedKeyId?: string,
): CreativeAccountBridge {
  const generation = state.generation;
  return {
    state,
    manageAccount,
    selectedKeyId,
    imageAction:
      typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
        ? nativeImageAction
        : undefined,
    copyText:
      typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
        ? async (text) => {
            await invoke("copy_text_to_clipboard", { text });
          }
        : undefined,
    async openExternalTool(toolId) {
      const urls: Record<string, string> = {
        "chat-mj": "https://vercel.ddaiai.com/",
        "banana-prompt": "https://www.aiwind.org/",
        "pose-library": "https://www.posemaniacs.com/zh-Hans/poses",
      };
      if (!Object.prototype.hasOwnProperty.call(urls, toolId))
        throw new Error("不支持的外部工具");
      await settingsApi.openExternal(urls[toolId]);
    },
    requestManual:
      typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
        ? requestCreativeManual
        : undefined,
    async listKeys(page, search) {
      const response = await desktopRequest<{
        items: CreativeAccountKey[];
        has_more: boolean;
      }>({
        method: "GET",
        path: "/account/keys",
        generation,
        query: [
          ["page", String(page)],
          ["page_size", "20"],
          ...(search ? [["keyword", search] as [string, string]] : []),
        ],
      });
      if (
        selectedKeyId &&
        page === 1 &&
        !search &&
        !response.data.items.some((key) => key.id === selectedKeyId)
      ) {
        const selected = await desktopRequest<CreativeAccountKey>({
          method: "GET",
          path: `/account/keys/${encodeURIComponent(selectedKeyId)}`,
          generation,
        });
        return {
          ...response.data,
          items: [selected.data, ...response.data.items],
        };
      }
      return response.data;
    },
    listBindings: () =>
      invoke<CreativeAccountBinding[]>("creative_account_bindings", {
        generation,
      }).catch((e) => {
        throw creativeError(e);
      }),
    bindKey: (tokenId) =>
      invoke<CreativeAccountBinding>("creative_account_bind", {
        request: { generation, tokenId },
      }).catch((e) => {
        throw creativeError(e);
      }),
    async request(reference, url, init) {
      if (state.status !== "connected")
        throw creativeError("creative_account_unavailable");
      if (!reference.startsWith(PREFIX) || !reference.slice(PREFIX.length))
        throw creativeError("creative_binding_not_found");
      init.signal?.throwIfAborted();
      const selection = actionFor(url, (init.method || "GET").toUpperCase());
      const payload = await bodyFor(init.body);
      init.signal?.throwIfAborted();
      const requestId = crypto.randomUUID();
      const bindingId = reference.slice(PREFIX.length);
      return nativeCreativeResponse(
        "creative_account_request",
        "account_cancel_request",
        {
          generation,
          bindingId,
          requestId,
          upstreamRequestId: new Headers(init.headers).get("x-request-id"),
          ...selection,
          ...payload,
        },
        init.signal,
        creativeError,
      );
    },
  };
}
