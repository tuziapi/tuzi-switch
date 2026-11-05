import type { ModelType } from '../constants/model-config';

export type BenchmarkModality = ModelType;
export type BenchmarkRankingMode = 'speed' | 'cost' | 'balanced' | 'value-for-money';

export interface BenchmarkPromptPreset {
  id: string;
  modality: BenchmarkModality;
  label: string;
  prompt: string;
  size?: string;
  duration?: number;
  title?: string;
  tags?: string;
}

export interface BenchmarkRankableEntry {
  status: 'pending' | 'running' | 'completed' | 'failed';
  firstResponseMs: number | null;
  totalDurationMs: number | null;
  estimatedCost: number | null;
  userScore: number | null;
}

export interface ReconcileSelectionOptions {
  fallback?: 'all' | 'none' | 'first';
  limit?: number;
}

function uniqueSelection(items: string[]): string[] {
  return Array.from(new Set(items));
}

export const BENCHMARK_PROMPT_PRESETS: BenchmarkPromptPreset[] = [
  {
    id: 'text-fast-json',
    modality: 'text',
    label: '极速短问答',
    prompt:
      '请只输出一行 JSON：{"animal":"cat","emoji":"🐱","lang":"zh"}',
  },
  {
    id: 'image-single-object',
    modality: 'image',
    label: '单物体白底',
    prompt: '一个橙色陶瓷马克杯，白色背景，简洁产品图',
    size: '1024x1024',
  },
  {
    id: 'video-single-shot',
    modality: 'video',
    label: '单镜头短视频',
    prompt: '白色背景下，一个橙色马克杯缓慢旋转，单镜头，干净光线',
    size: '1280x720',
    duration: 5,
  },
  {
    id: 'audio-short-instrumental',
    modality: 'audio',
    label: '短音乐片段',
    prompt: '轻快 lo-fi 钢琴旋律，无人声，简洁温暖',
    title: 'Benchmark Sample',
    tags: 'lofi,piano,instrumental',
  },
];

function compareNullableNumber(
  left: number | null,
  right: number | null,
  fallback = Number.MAX_SAFE_INTEGER
): number {
  return (left ?? fallback) - (right ?? fallback);
}

export function getDefaultPromptPreset(
  modality: BenchmarkModality
): BenchmarkPromptPreset {
  const preset = BENCHMARK_PROMPT_PRESETS.find(
    (item) => item.modality === modality
  );
  if (!preset) {
    throw new Error(`缺少默认测试提示词：${modality}`);
  }
  return preset;
}

export function resolvePromptPreset(
  presetId: string | null | undefined,
  modality: BenchmarkModality
): BenchmarkPromptPreset {
  return (
    BENCHMARK_PROMPT_PRESETS.find((preset) => preset.id === presetId) ||
    getDefaultPromptPreset(modality)
  );
}

export function reconcileSelection(
  current: string[],
  available: string[],
  options: ReconcileSelectionOptions = {}
): string[] {
  if (available.length === 0) {
    return [];
  }

  const availableSet = new Set(available);
  const kept = current.filter((item) => availableSet.has(item));
  if (kept.length > 0) {
    return kept;
  }

  const fallback = options.fallback || 'all';
  if (fallback === 'none') {
    return [];
  }

  if (fallback === 'first') {
    const limit = Math.max(1, options.limit || 1);
    return available.slice(0, limit);
  }

  const limit =
    typeof options.limit === 'number' ? Math.max(1, options.limit) : undefined;
  return limit ? available.slice(0, limit) : available;
}

export function applyShiftRangeSelection(
  current: string[],
  ordered: string[],
  anchor: string | null | undefined,
  target: string,
  nextSelected: boolean
): string[] {
  const targetIndex = ordered.indexOf(target);
  const anchorIndex = anchor ? ordered.indexOf(anchor) : -1;
  if (targetIndex === -1 || anchorIndex === -1) {
    return nextSelected
      ? uniqueSelection([...current, target])
      : current.filter((item) => item !== target);
  }

  const [start, end] =
    anchorIndex < targetIndex
      ? [anchorIndex, targetIndex]
      : [targetIndex, anchorIndex];
  const range = ordered.slice(start, end + 1);
  if (nextSelected) {
    return uniqueSelection([...current, ...range]);
  }
  const rangeSet = new Set(range);
  return current.filter((item) => !rangeSet.has(item));
}

export function rankBenchmarkEntries<T extends BenchmarkRankableEntry>(
  entries: T[],
  rankingMode: BenchmarkRankingMode
): T[] {
  const ranked = [...entries];
  ranked.sort((left, right) => {
    if (left.status === 'completed' && right.status !== 'completed') return -1;
    if (left.status !== 'completed' && right.status === 'completed') return 1;

    if (rankingMode === 'value-for-money') {
      const leftScore = computeValueScore(left);
      const rightScore = computeValueScore(right);
      const delta = (rightScore ?? -1) - (leftScore ?? -1);
      if (delta !== 0) return delta;
    }

    if (rankingMode === 'cost') {
      const costDelta = compareNullableNumber(
        left.estimatedCost,
        right.estimatedCost
      );
      if (costDelta !== 0) return costDelta;
    }

    const speedDelta = compareNullableNumber(
      left.firstResponseMs ?? left.totalDurationMs,
      right.firstResponseMs ?? right.totalDurationMs
    );
    if (speedDelta !== 0) {
      return speedDelta;
    }

    if (rankingMode === 'balanced' || rankingMode === 'cost') {
      const scoreDelta = (right.userScore ?? -1) - (left.userScore ?? -1);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
    }

    return compareNullableNumber(left.totalDurationMs, right.totalDurationMs);
  });
  return ranked;
}

/**
 * 计算性价比分数（1-10）
 * 可用性 = userScore(默认3) × 20 + 速度加成(最多20)，上限100
 * 性价比 = 可用性 / (cost × 1000 + 1)，映射到 1-10
 */
export function computeValueScore(
  entry: BenchmarkRankableEntry,
  priceFallback?: number | null
): number | null {
  if (entry.status !== 'completed') return null;

  const userScore = entry.userScore ?? 3;
  const duration = entry.totalDurationMs;
  const speedBonus = duration != null
    ? Math.max(0, 1 - duration / 120000) * 20
    : 0;
  const usability = Math.min(100, userScore * 20 + speedBonus);

  const cost = entry.estimatedCost ?? priceFallback ?? null;
  if (cost === null) return null;

  const raw = usability / (cost * 1000 + 1);
  return Math.min(10, Math.max(1, Math.round(raw)));
}
