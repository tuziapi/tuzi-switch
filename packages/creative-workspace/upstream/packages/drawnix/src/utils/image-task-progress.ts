export const IMAGE_GENERATION_ESTIMATE_MS = 5 * 60 * 1000;
export const IMAGE_GENERATION_MAX_PROGRESS = 90;

const clampProgress = (value: number): number => {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
};

const easeOutCubic = (t: number): number => {
  return 1 - Math.pow(1 - t, 3);
};

export function calculateSimulatedImageProgress(
  startedAt: number,
  estimatedDuration: number = IMAGE_GENERATION_ESTIMATE_MS,
  maxProgress: number = IMAGE_GENERATION_MAX_PROGRESS
): number {
  const elapsed = Math.max(0, Date.now() - startedAt);
  const rawProgress = Math.min(elapsed / estimatedDuration, 1);
  const easedProgress = easeOutCubic(rawProgress);
  return Math.floor(easedProgress * maxProgress);
}

interface ResolveImageTaskDisplayProgressOptions {
  startedAt?: number;
  fallbackProgress?: number | null;
  mediaUrl?: string;
  isImageLoading?: boolean;
  imageLoadProgress?: number;
  estimatedDuration?: number;
}

export function resolveImageTaskDisplayProgress(
  options: ResolveImageTaskDisplayProgressOptions
): number | null {
  const {
    startedAt,
    fallbackProgress,
    mediaUrl,
    isImageLoading = false,
    imageLoadProgress = 0,
    estimatedDuration = IMAGE_GENERATION_ESTIMATE_MS,
  } = options;

  if (mediaUrl && isImageLoading) {
    return clampProgress(
      IMAGE_GENERATION_MAX_PROGRESS +
        Math.floor((Math.max(0, imageLoadProgress) * 10) / 100)
    );
  }

  if (typeof startedAt === 'number') {
    return calculateSimulatedImageProgress(startedAt, estimatedDuration);
  }

  if (typeof fallbackProgress === 'number') {
    return clampProgress(fallbackProgress);
  }

  return null;
}

export function getImageTaskProgressStatusText(
  progress: number,
  hasMediaUrl = false,
  isImageLoading = false
): string {
  if (hasMediaUrl && isImageLoading) {
    return '加载图片...';
  }

  if (progress < 30) return '分析提示词...';
  if (progress < 60) return '生成中...';
  if (progress < 90) return '优化细节...';
  return '即将完成...';
}
