import type { CreativeAccountBridge } from "./bridge-types";
import { generateEcommerceImage } from "./ecommerce-generation";
import {
  readEcommerceImage,
  resolveEcommerceAccountReference,
} from "./ecommerce-request";
import type { BatchExecutor, EcommerceBatch } from "./ecommerce-jobs";
import { resolveInvocationPlanFromRoute } from "../upstream/packages/drawnix/src/services/provider-routing";
import { fetchOutputMedia } from "../upstream/packages/drawnix/src/services/assistant-account";

function safeId(value: string | null | undefined) {
  return value && /^[a-zA-Z0-9_.-]{1,200}$/.test(value) ? value : undefined;
}

export function createEcommerceExecutor(
  bridge?: CreativeAccountBridge,
): BatchExecutor {
  // The selected route/credential is frozen in memory for a run. It is never
  // stored with job records, and is resolved afresh for explicit resume/retry.
  let prepared:
    | Promise<{
        plan: NonNullable<ReturnType<typeof resolveInvocationPlanFromRoute>>;
        accountReference?: string;
        references: string[];
      }>
    | undefined;
  const prepare = (batch: EcommerceBatch, signal: AbortSignal) =>
    (prepared ||= (async () => {
      const plan = resolveInvocationPlanFromRoute("image", batch.modelRef);
      if (!plan) throw new Error("请检查任务使用的模型配置。");
      const accountReference = await resolveEcommerceAccountReference(
        plan.provider.apiKey,
        bridge,
      );
      const references = await Promise.all(
        batch.references.map((file) => readEcommerceImage(file, signal)),
      );
      return { plan, accountReference, references };
    })());
  return {
    async generate(batch, item, signal, report) {
      const prepared = await prepare(batch, signal);
      signal.throwIfAborted();
      const requestId = item.attempts.at(-1)!.requestId;
      const onTransport = (event: Event) => {
        const data = (event as CustomEvent).detail;
        if (data?.requestId !== requestId || signal.aborted) return;
        if (data.stage === "sending")
          void report({ stage: "sending" }).catch(() => {});
        if (data.stage === "receiving")
          void report({
            stage: "receiving",
            httpStatus: data.status,
            upstreamId: safeId(data.upstreamId),
          }).catch(() => {});
      };
      window.addEventListener("tuzi:creative-request-status", onTransport);
      try {
        const urls = await generateEcommerceImage({
          modelRef: batch.modelRef,
          invocationPlan: prepared.plan,
          prompt: item.prompt,
          size: batch.size,
          generationParams: batch.generationParams,
          count: 1,
          referenceImages: prepared.references,
          accountReference: prepared.accountReference,
          signal,
          requestId,
          onSubmissionAttempt: () => report({ stage: "submitting" }),
          onResponse: (response) =>
            report({
              stage: "receiving",
              httpStatus: response.status,
              upstreamId: safeId(
                response.headers.get("x-oneapi-request-id") ||
                  response.headers.get("x-request-id"),
              ),
            }),
          onSubmitted: (taskId) =>
            report({ stage: "receiving", taskId: safeId(taskId) }),
        });
        if (!urls[0]) throw new Error("模型没有返回图片。");
        return urls[0];
      } finally {
        window.removeEventListener("tuzi:creative-request-status", onTransport);
      }
    },
    async download(url, signal) {
      const response = await fetchOutputMedia(url, signal, "image/*");
      if (!response.ok) throw new Error("图片下载失败。");
      const blob = await response.blob();
      if (!blob.size || !blob.type.startsWith("image/"))
        throw new Error("返回内容不是图片。");
      return blob;
    },
  };
}
