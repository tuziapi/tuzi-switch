import {
  GPT_IMAGE_26_SIZE_OPTIONS,
  isGPTImage26ModelId,
} from '../../constants/model-config';
import type { ImageGenerationRequest } from './types';

const supportedSizes = new Set(GPT_IMAGE_26_SIZE_OPTIONS.map(({ value }) => value));
const ratioSizes: Record<string, string> = {
  '1x1': '1024x1024',
  '2x3': '1024x1536',
  '3x2': '1536x1024',
};

export function resolveGPTImage26Size(size: unknown): string {
  const normalized = typeof size === 'string'
    ? size.trim().toLowerCase().replace(/[:×]/g, 'x')
    : '';
  const resolved = ratioSizes[normalized] || normalized;
  return supportedSizes.has(resolved) ? resolved : 'auto';
}

/** The channel returns original media. Stale format/quality options can suppress GIF output. */
export function normalizeGPTImage26Request(
  request: ImageGenerationRequest,
  modelId = request.model
): ImageGenerationRequest {
  if (!modelId || !isGPTImage26ModelId(modelId)) return request;

  const formats = [request.outputFormat, request.params?.output_format];
  if (formats.some((value) => typeof value === 'string' && ['gif', 'svg'].includes(value.trim().toLowerCase()))) {
    throw new Error('当前基础接入暂不支持 GIF/SVG 输出参数。default/Codex 分组生成 GIF 请移除格式参数，并在提示词写“生成 GIF 图”；官方分组专用格式暂未接入。');
  }

  const requestedSize = typeof request.params?.size === 'string' && request.params.size.trim()
    ? request.params.size
    : request.size;
  const size = resolveGPTImage26Size(requestedSize);

  return {
    ...request,
    model: modelId,
    modelRef: request.modelRef
      ? { ...request.modelRef, modelId }
      : request.modelRef,
    size,
    background: undefined,
    outputFormat: undefined,
    outputCompression: undefined,
    inputFidelity: undefined,
    params: {
      size,
      n: 1,
      response_format: 'b64_json',
      // Keep edit intent even when it came from a saved task.
      maskImage: request.params?.maskImage,
      mask_image: request.params?.mask_image,
    },
  };
}
