import type { ModelRef } from "../upstream/packages/drawnix/src/utils/settings-manager";
import {
  resolveInvocationPlanFromRoute,
  type ResolvedProviderContext,
} from "../upstream/packages/drawnix/src/services/provider-routing";
import { generateImageDirect } from "../upstream/packages/drawnix/src/utils/gemini-api/services";
import { asyncImageAPIService } from "../upstream/packages/drawnix/src/services/async-image-api-service";
import { videoAPIService } from "../upstream/packages/drawnix/src/services/video-api-service";
import {
  getAdapterContextFromSettings,
  resolveAdapterForInvocation,
} from "../upstream/packages/drawnix/src/services/model-adapters";

export type EcommerceMediaReference = {
  value: string;
  name?: string;
};

export function resolveEcommerceModelRef(
  modelId: string,
  presetModelRef?: ModelRef | null,
  sourceProfileId?: string | null,
): ModelRef {
  const normalizedModelId = modelId.trim();
  if (presetModelRef?.modelId === normalizedModelId) {
    return {
      profileId: presetModelRef.profileId || null,
      modelId: normalizedModelId,
    };
  }
  return {
    profileId: sourceProfileId?.trim() || presetModelRef?.profileId || null,
    modelId: normalizedModelId,
  };
}

function withAccountReference(
  provider: ResolvedProviderContext,
  accountReference?: string,
): ResolvedProviderContext {
  return accountReference?.trim()
    ? { ...provider, apiKey: accountReference.trim() }
    : provider;
}

function normalizeImageResult(result: any): string[] {
  const values = Array.isArray(result?.data)
    ? result.data
        .map((item: any) => item?.url || item?.b64_json)
        .filter((value: unknown): value is string => Boolean(value))
    : [];
  if (values.length) return values;
  if (typeof result?.url === "string" && result.url) return [result.url];
  if (Array.isArray(result?.urls)) {
    return result.urls.filter(
      (value: unknown): value is string => typeof value === "string" && value,
    );
  }
  return [];
}

export async function generateEcommerceImage(params: {
  modelRef: ModelRef;
  prompt: string;
  size: string;
  referenceImages: string[];
  accountReference?: string;
  count?: number;
  signal?: AbortSignal;
}): Promise<string[]> {
  params.signal?.throwIfAborted();
  const plan = resolveInvocationPlanFromRoute("image", params.modelRef);
  if (!plan) {
    throw new Error(
      `创作配置中没有找到模型 ${params.modelRef.modelId} 的可用接口绑定，请刷新模型列表或重新保存模型配置。`,
    );
  }

  const provider = withAccountReference(plan.provider, params.accountReference);
  const model = plan.modelRef.modelId;
  const request = {
    model,
    modelRef: plan.modelRef,
    prompt: params.prompt,
    size: params.size,
    referenceImages: params.referenceImages,
    generationMode: params.referenceImages.length
      ? ("image_edit" as const)
      : ("text_to_image" as const),
    params: { n: params.count || 1 },
  };

  if (
    plan.binding.protocol === "openai.async.media" ||
    plan.binding.requestSchema === "openai.async.image.form"
  ) {
    const result = await asyncImageAPIService.generateWithPolling(
      {
        model,
        modelRef: plan.modelRef,
        prompt: params.prompt,
        size: params.size,
        referenceImages: params.referenceImages,
      },
      {
        signal: params.signal,
        requestContext: {
          providerContext: provider,
          binding: plan.binding,
        },
      },
    );
    const extracted = asyncImageAPIService.extractUrlAndFormat(result);
    return extracted.url ? [extracted.url] : [];
  }

  if (plan.binding.protocol === "google.generateContent") {
    const result = await generateImageDirect(
      params.prompt,
      {
        image: params.referenceImages,
        size: params.size,
        count: params.count,
        model,
        modelRef: plan.modelRef,
        signal: params.signal,
      },
      model,
      plan.modelRef,
      {
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        modelName: model,
        authType: provider.authType,
        providerType: provider.providerType,
        extraHeaders: provider.extraHeaders,
        provider,
        binding: plan.binding,
      },
    );
    const urls = normalizeImageResult(result);
    if (!urls.length) throw new Error("模型未返回可展示的图片结果。");
    return urls;
  }

  const adapter = resolveAdapterForInvocation("image", model, plan.modelRef);
  if (!adapter || adapter.kind !== "image") {
    throw new Error(
      `模型 ${model} 的协议 ${plan.binding.requestSchema} 暂未接入电商工作台，请在创作配置中选择可用的图片模型。`,
    );
  }

  const baseContext = getAdapterContextFromSettings("image", plan.modelRef);
  const result = await adapter.generateImage(
    {
      ...baseContext,
      signal: params.signal,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      provider,
      binding: plan.binding,
    },
    request,
  );
  const urls = [result.url, ...(result.urls || [])].filter(
    (value, index, all): value is string =>
      Boolean(value) && all.indexOf(value) === index,
  );
  if (!urls.length) throw new Error("模型未返回可展示的图片结果。");
  return urls;
}

export async function generateEcommerceVideo(params: {
  modelRef: ModelRef;
  prompt: string;
  size: string;
  referenceImages: string[];
  accountReference?: string;
  onProgress?: (progress: number) => void;
}): Promise<string[]> {
  const plan = resolveInvocationPlanFromRoute("video", params.modelRef);
  if (!plan) {
    throw new Error(
      `创作配置中没有找到模型 ${params.modelRef.modelId} 的可用视频接口绑定，请刷新模型列表或重新保存模型配置。`,
    );
  }
  const provider = withAccountReference(plan.provider, params.accountReference);
  const result = await videoAPIService.generateVideoWithPolling(
    {
      model: plan.modelRef.modelId as any,
      modelRef: plan.modelRef,
      prompt: params.prompt,
      size: params.size,
      inputReferences: params.referenceImages.map((value, slot) => ({
        value,
        slot,
        url: value,
        name: `reference-${slot + 1}.png`,
      })) as any,
    },
    {
      interval: 1500,
      onProgress: (progress) => params.onProgress?.(progress),
      providerContext: provider,
      binding: plan.binding,
    },
  );
  const url = result.video_url || result.url;
  if (!url) throw new Error("模型未返回可展示的视频结果。");
  return [url];
}
