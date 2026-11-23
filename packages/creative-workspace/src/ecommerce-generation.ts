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
import { getVideoModelConfig } from "../upstream/packages/drawnix/src/constants/video-model-config";
import { isSeedance2ModelId } from "../upstream/packages/drawnix/src/utils/seedance-model";
import { submitSeedance2Request } from "../upstream/packages/drawnix/src/services/model-adapters/seedance2-adapter";
import { pollVideoUntilComplete } from "../upstream/packages/drawnix/src/services/media-api/video-api";
import {
  extractInlineVideoUrl,
  downloadVideoContentToLocalUrl,
  shouldDownloadVideoContent,
} from "../upstream/packages/drawnix/src/services/video-binding-utils";
import { matchesEcommerceModelType } from "./ecommerce-model-capabilities";
import { isPublicHttpMediaUrl } from "../upstream/packages/drawnix/src/utils/virtual-media-url";

export type EcommerceMediaReference = {
  value: string;
  name?: string;
};

export function supportsEcommerceVideoReference(
  modelId: string | null,
  referenceVideo?: string,
) {
  return (
    (isSeedance2ModelId(modelId) &&
      Boolean(referenceVideo && isPublicHttpMediaUrl(referenceVideo))) ||
    ["gemini-omni-1.2-flash", "minimax-h3"].includes(
      modelId?.toLowerCase() || "",
    )
  );
}

export function resolveEcommerceModelRef(
  modelId: string,
  presetModelRef?: ModelRef | null,
  sourceProfileId?: string | null,
): ModelRef {
  const normalizedModelId = modelId.trim();
  if (sourceProfileId?.trim()) {
    return { profileId: sourceProfileId.trim(), modelId: normalizedModelId };
  }
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
  requestId?: string;
  onSubmissionAttempt?: () => void | Promise<void>;
  onResponse?: (response: Response) => void | Promise<void>;
  onSubmitted?: (taskId: string) => void | Promise<void>;
  invocationPlan?: ReturnType<typeof resolveInvocationPlanFromRoute>;
}): Promise<string[]> {
  params.signal?.throwIfAborted();
  const plan =
    params.invocationPlan ||
    resolveInvocationPlanFromRoute("image", params.modelRef);
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
        requestId: params.requestId,
        onSubmissionAttempt: params.onSubmissionAttempt,
        onSubmitted: params.onSubmitted,
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
        requestId: params.requestId,
        onSubmissionAttempt: params.onSubmissionAttempt,
        onResponse: params.onResponse,
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
      requestId: params.requestId,
      onSubmissionAttempt: params.onSubmissionAttempt,
      onResponse: params.onResponse,
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
  referenceVideo?: string;
  seconds?: string;
  aspectRatio?: string;
  signal?: AbortSignal;
  taskId?: string;
  onSubmitted?: (taskId: string) => Promise<void>;
  accountReference?: string;
  onProgress?: (progress: number) => void;
}): Promise<string[]> {
  params.signal?.throwIfAborted();
  const plan = resolveInvocationPlanFromRoute("video", params.modelRef);
  if (!plan) {
    throw new Error(
      `创作配置中没有找到模型 ${params.modelRef.modelId} 的可用视频接口绑定，请刷新模型列表或重新保存模型配置。`,
    );
  }
  const provider = withAccountReference(plan.provider, params.accountReference);
  const config = getVideoModelConfig(plan.modelRef.modelId as any);
  if (!matchesEcommerceModelType(plan.modelRef.modelId, "video"))
    throw new Error("所选模型不是视频模型，请在创作配置中选择视频模型。");
  if (
    !params.taskId &&
    params.referenceImages.length > config.imageUpload.maxCount
  )
    throw new Error(
      `当前模型最多支持 ${config.imageUpload.maxCount} 张商品图。`,
    );
  if (
    !params.taskId &&
    config.imageUpload.required &&
    !params.referenceImages.length
  )
    throw new Error("当前视频模型需要商品参考图。");
  if (
    !params.taskId &&
    params.referenceVideo &&
    !supportsEcommerceVideoReference(
      plan.modelRef.modelId,
      params.referenceVideo,
    )
  )
    throw new Error(
      "当前模型尚未接入本地参考视频，请选择 MiniMax-H3 或 Gemini Omni 1.2 Flash。Seedance 目前要求公网视频地址，尚未接入素材上传服务。不会忽略视频继续计费生成。",
    );
  const videoParams: Record<string, unknown> = {
    aspect_ratio: params.aspectRatio || "16:9",
    ratio: params.aspectRatio || "16:9",
    ...(params.referenceVideo
      ? plan.modelRef.modelId.toLowerCase() === "minimax-h3" ||
        isSeedance2ModelId(plan.modelRef.modelId)
        ? { input_videos: [params.referenceVideo] }
        : { video_media: [{ type: "video", url: params.referenceVideo }] }
      : {}),
  };
  const request = {
    model: plan.modelRef.modelId as any,
    modelRef: plan.modelRef,
    prompt: params.prompt,
    size: params.size,
    seconds: params.seconds || config.defaultDuration,
    params: videoParams,
    inputReferences: params.referenceImages.map((value, slot) => ({
      slot,
      url: value,
      name: `reference-${slot + 1}.png`,
    })),
  };
  const context = {
    providerContext: provider,
    binding: plan.binding,
  };
  // Persist the remote ID before polling. Resuming only queries this ID and
  // never repeats a paid submission, even after a desktop restart.
  let taskId = params.taskId;
  if (isSeedance2ModelId(plan.modelRef.modelId)) {
    // Seedance uses content JSON, not the legacy multipart video endpoint.
    if (!taskId) {
      const submitted = await submitSeedance2Request(
        {
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          provider,
          binding: plan.binding,
        },
        {
          model: plan.modelRef.modelId,
          modelRef: plan.modelRef,
          prompt: params.prompt,
          size: params.size,
          duration: Number(request.seconds),
          referenceImages: params.referenceImages,
          params: videoParams,
        },
      );
      taskId = submitted.taskId;
      if (!taskId)
        throw new Error("服务端未返回任务编号，请先核对调用记录，勿重复提交。");
      await params.onSubmitted?.(taskId);
    }
    params.signal?.throwIfAborted();
    const result = await pollVideoUntilComplete(
      taskId,
      {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey || "",
        provider,
        binding: plan.binding,
        defaultModel: plan.modelRef.modelId,
        params: videoParams,
      },
      { signal: params.signal, interval: 5000, onProgress: params.onProgress },
    );
    params.signal?.throwIfAborted();
    const content = (
      result as { content?: { url?: string; video_url?: string } }
    ).content;
    const inlineUrl =
      extractInlineVideoUrl(result) || content?.video_url || content?.url;
    const url =
      (inlineUrl &&
      !shouldDownloadVideoContent(plan.modelRef.modelId, plan.binding, {
        ...result,
        video_url: inlineUrl,
      })
        ? inlineUrl
        : undefined) ||
      (shouldDownloadVideoContent(plan.modelRef.modelId, plan.binding, {
        ...result,
        video_url: inlineUrl,
      })
        ? await downloadVideoContentToLocalUrl({
            videoId: taskId,
            provider,
            binding: plan.binding,
            modelId: plan.modelRef.modelId,
            cacheKey: taskId,
          })
        : undefined);
    params.signal?.throwIfAborted();
    if (!url) throw new Error("模型未返回可展示的视频结果。");
    return [url];
  }
  if (!taskId) {
    const submitted = await videoAPIService.submitVideoGeneration(
      request,
      context,
    );
    taskId = submitted.id;
    if (!taskId)
      throw new Error("服务端未返回任务编号，请先核对调用记录，勿重复提交。");
    await params.onSubmitted?.(taskId);
  }
  params.signal?.throwIfAborted();
  const result = await videoAPIService.resumePolling(taskId, {
    ...context,
    routeModel: plan.modelRef,
    params: videoParams,
    interval: 5000,
    assertAvailable: async () => {
      params.signal?.throwIfAborted();
    },
    onProgress: (progress) => params.onProgress?.(progress),
  });
  params.signal?.throwIfAborted();
  const url = result.video_url || result.url;
  if (!url) throw new Error("模型未返回可展示的视频结果。");
  return [url];
}
