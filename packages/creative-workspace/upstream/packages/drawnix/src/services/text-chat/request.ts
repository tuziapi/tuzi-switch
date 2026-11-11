import {
  settingsManager,
  resolveInvocationRoute,
  type ModelRef,
} from "../../utils/settings-manager";
import {
  providerTransport,
  resolveInvocationPlanFromRoute,
} from "../provider-routing";
import { safeTextError } from "../media-executor/text-response";
import { readGenerationApiError } from "../../utils/generation-error-details";
import {
  readTextStream,
  textBody,
  textProtocol,
  type TextSnapshot,
  type TextTurn,
} from "./protocol";
import { normalizeImageUrlForMultimodalInput } from "../../utils/gemini-api/message-utils";
import { readTextAttachment, validateAttachmentRefs } from "./attachments";

export interface TextChatRequest {
  codex?: import("./local-codex").CodexSelection;
  sessionId?: string;
  model: ModelRef | null;
  turns: TextTurn[];
  maxOutput?: number;
  signal: AbortSignal;
  onUpdate: (snapshot: TextSnapshot) => void;
}

/** Uses exactly the existing configured text route; no new credential/config store. */
export async function requestTextChat(
  request: TextChatRequest,
): Promise<TextSnapshot> {
  await settingsManager.waitForInitialization();
  request.signal.throwIfAborted();
  const route = resolveInvocationRoute("text", request.model);
  const plan = resolveInvocationPlanFromRoute("text", request.model, {
    preferredRequestSchema: ["anthropic.messages", "openai.responses.input"],
  });
  if (!route.apiKey || !plan)
    throw new Error("请先在创作配置中选择可用的文本模型和供应商。");
  if (
    request.model?.profileId &&
    plan.modelRef.profileId !== request.model.profileId
  )
    throw new Error("所选模型的供应商已不可用，请重新选择文本模型。");
  const protocol = textProtocol(plan.binding.protocol, plan.binding.submitPath);
  const turns: TextTurn[] = [];
  let imageCount = 0,
    imageBytes = 0,
    textChars = 0;
  for (const turn of request.turns) {
    request.signal.throwIfAborted();
    const refs = turn.attachments || [];
    validateAttachmentRefs(refs);
    const images: string[] = [],
      documents: string[] = [];
    for (const ref of refs) {
      const record = await readTextAttachment(ref);
      request.signal.throwIfAborted();
      if (request.sessionId && record.sessionId !== request.sessionId)
        throw new Error("附件不属于当前会话，请重新添加。");
      if (ref.kind === "image") {
        if (plan.binding.metadata?.text?.supportsImageInput === false)
          throw new Error(
            "当前模型配置不支持图片输入，请切换支持图片的文本模型后重试。",
          );
        imageCount++;
        imageBytes += record.dataUrl!.length;
        if (
          imageCount > (plan.binding.metadata?.text?.maxImageCount ?? 6) ||
          imageBytes > 12 * 1024 ** 2
        )
          throw new Error("当前对话的图片上下文过多，请新建对话后再发送。");
        images.push(record.dataUrl!);
      } else documents.push(`[附件：${ref.name}]\n${record.text}\n[附件结束]`);
    }
    if (turn.images?.length) {
      for (const url of turn.images) images.push(await normalizeImageUrlForMultimodalInput(url));
      if (plan.binding.metadata?.text?.supportsImageInput === false) throw new Error("当前文本模型不支持画布图片引用，请切换模型。");
      imageCount += turn.images.length;
      imageBytes += images.slice(-turn.images.length).reduce((n, url) => n + url.length, 0);
      if (imageCount > (plan.binding.metadata?.text?.maxImageCount ?? 6) || imageBytes > 12 * 1024 ** 2) throw new Error("图片上下文过多，请减少参考图。");
    }
    const content = [turn.content, ...documents].filter(Boolean).join("\n\n");
    textChars += content.length;
    if (textChars > 800000)
      throw new Error("包含附件的对话内容过长，请新建对话或拆分文档。");
    turns.push({
      role: turn.role,
      content,
      ...(images.length ? { images } : {}),
    });
  }
  let path = plan.binding.submitPath;
  if (protocol === "gemini") {
    path = path
      .replace(/\{model\}/g, encodeURIComponent(plan.modelRef.modelId))
      .replace(/:generateContent(?=\?|$)/, ":streamGenerateContent");
    path += `${path.includes("?") ? "&" : "?"}alt=sse`;
  }
  const provider = { ...plan.provider };
  // Anthropic native auth differs from OpenAI-compatible Claude routes.
  if (
    protocol === "anthropic" &&
    provider.authType === "bearer" &&
    !provider.apiKey.startsWith("tuzi-account:")
  )
    provider.authType = "header";
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) cancel();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 600000);
  try {
    const response = await providerTransport.send(provider, {
      path,
      baseUrlStrategy: plan.binding.baseUrlStrategy,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(protocol === "anthropic"
          ? { "anthropic-version": "2023-06-01" }
          : {}),
      },
      body: JSON.stringify(
        textBody(protocol, plan.modelRef.modelId, turns, request.maxOutput),
      ),
      signal: controller.signal,
    });
    if (!response.ok)
      throw await readGenerationApiError(
        response,
        `模型请求失败（${response.status}）`,
        { modelId: plan.modelRef.modelId },
      );
    return await readTextStream(
      response,
      protocol,
      request.onUpdate,
      controller.signal,
    );
  } catch (error) {
    if (timedOut) throw new Error("本次回复等待超过 10 分钟，已保留部分内容。");
    if (request.signal.aborted)
      throw new DOMException("已停止生成", "AbortError");
    const code = (error as { code?: string })?.code;
    if (code === "creative_outcome_unknown" || code === "creative_stream_interrupted")
      throw new Error("文本模型连接中断，未收到完整回复。请稍后手动重试或切换文本模型。");
    if (code === "creative_connection_failed")
      throw new Error("无法连接文本模型服务，请检查网络后手动重试。");
    if (code === "creative_request_timeout")
      throw new Error("文本模型请求超时，请稍后手动重试或切换文本模型。");
    throw safeTextError(error, [route.apiKey]);
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", cancel);
  }
}
