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

export interface TextChatRequest {
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
        textBody(
          protocol,
          plan.modelRef.modelId,
          request.turns,
          request.maxOutput,
        ),
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
    throw safeTextError(error, [route.apiKey]);
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", cancel);
  }
}
