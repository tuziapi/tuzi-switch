import type { PlaitImageGenerationAnchor } from '../types/image-generation-anchor.types';

export type ImageGenerationAnchorPresentationState =
  | 'submitted'
  | 'accepted'
  | 'handoff'
  | 'retrying'
  | 'inserting'
  | 'completed'
  | 'failed';

interface BuildImageGenerationAnchorPresentationPatchOptions {
  error?: string;
  subtitle?: string;
}

export function buildImageGenerationAnchorPresentationPatch(
  state: ImageGenerationAnchorPresentationState,
  options: BuildImageGenerationAnchorPresentationPatchOptions = {}
): Pick<
  PlaitImageGenerationAnchor,
  'phase' | 'subtitle' | 'progress' | 'error'
> {
  switch (state) {
    case 'submitted':
      return {
        phase: 'submitted',
        subtitle: options.subtitle ?? '已提交，等待执行',
        progress: null,
        error: undefined,
      };
    case 'accepted':
      return {
        phase: 'queued',
        subtitle: options.subtitle ?? '请求已受理，等待执行',
        progress: null,
        error: undefined,
      };
    case 'handoff':
      return {
        phase: 'queued',
        subtitle: options.subtitle ?? '请求已受理，正在转入本地执行',
        progress: null,
        error: undefined,
      };
    case 'retrying':
      return {
        phase: 'queued',
        subtitle: options.subtitle ?? '正在重新触发，请稍候',
        progress: null,
        error: undefined,
      };
    case 'inserting':
      return {
        phase: 'inserting',
        subtitle: options.subtitle ?? '正在放入画布',
        progress: null,
        error: undefined,
      };
    case 'completed':
      return {
        phase: 'completed',
        subtitle: options.subtitle ?? '图片已稳定落位',
        progress: null,
        error: undefined,
      };
    case 'failed':
      return {
        phase: 'failed',
        subtitle: options.subtitle ?? '生成失败，请重试',
        progress: null,
        error: options.error,
      };
  }
}
