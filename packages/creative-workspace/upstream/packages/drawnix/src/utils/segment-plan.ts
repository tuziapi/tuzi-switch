/**
 * 视频分段时长计算算法
 *
 * 根据目标时长和模型可用的 duration 选项，计算最优分段方案。
 * 供 ScriptPage、GeneratePage、long-video.ts 三处复用。
 */

import type { DurationOption } from '../types/video.types';

/** 分段计划结果 */
export interface SegmentPlan {
  /** 每段的时长（秒）数组，长度等于段数 */
  segments: number[];
  /** 实际总时长 = sum(segments) */
  actualTotal: number;
  /** 是否为固定时长模型 */
  isFixed: boolean;
  /** 目标时长与实际时长的差值（actualTotal - targetDuration），≥ 0 */
  overflow: number;
}

/** 默认兜底时长 */
const FALLBACK_DURATION = 8;

/**
 * 计算分段方案
 *
 * 策略：
 * - 固定时长模型（options.length === 1）：
 *   segmentCount = ceil(targetDur / fixedDur)
 *   actualTotal = segmentCount × fixedDur
 *
 * - 可变时长模型（options.length > 1）：
 *   1. 若 targetDur ≤ maxDur → 单段，选 >= targetDur 的最小选项
 *   2. 否则用 maxDur 贪心填充，余数从 options 中选最近 ≥ 选项
 */
export function computeSegmentPlan(
  targetDuration: number,
  durationOptions: DurationOption[]
): SegmentPlan {
  const options = durationOptions
    .map(o => parseInt(o.value, 10))
    .filter(n => !isNaN(n) && n > 0)
    .sort((a, b) => a - b);

  // 兜底：无有效选项
  if (options.length === 0) {
    const count = Math.max(1, Math.ceil(targetDuration / FALLBACK_DURATION));
    const total = count * FALLBACK_DURATION;
    return {
      segments: Array(count).fill(FALLBACK_DURATION),
      actualTotal: total,
      isFixed: true,
      overflow: total - targetDuration,
    };
  }

  const isFixed = options.length === 1;
  const maxDur = options[options.length - 1];

  if (isFixed) {
    const fixedDur = options[0];
    const count = Math.max(1, Math.ceil(targetDuration / fixedDur));
    const total = count * fixedDur;
    return {
      segments: Array(count).fill(fixedDur),
      actualTotal: total,
      isFixed: true,
      overflow: total - targetDuration,
    };
  }

  // 可变时长：单段可覆盖
  if (targetDuration <= maxDur) {
    const best = options.find(d => d >= targetDuration) ?? maxDur;
    return {
      segments: [best],
      actualTotal: best,
      isFixed: false,
      overflow: best - targetDuration,
    };
  }

  // 可变时长：多段贪心
  const segments: number[] = [];
  let remaining = targetDuration;

  while (remaining > maxDur) {
    segments.push(maxDur);
    remaining -= maxDur;
  }

  // 余数：找最近的 >= remaining 选项
  const tail = options.find(d => d >= remaining) ?? maxDur;
  segments.push(tail);

  const actualTotal = segments.reduce((a, b) => a + b, 0);
  return {
    segments,
    actualTotal,
    isFixed: false,
    overflow: actualTotal - targetDuration,
  };
}

/**
 * 为单个 shot 选最合适的模型时长
 *
 * 找 >= targetDur 的最小选项，没有则取最大值
 */
export function findBestDuration(
  targetDur: number,
  durationOptions: DurationOption[]
): number {
  const options = durationOptions
    .map(o => parseInt(o.value, 10))
    .filter(n => !isNaN(n) && n > 0)
    .sort((a, b) => a - b);

  if (options.length === 0) {
    return Math.min(Math.max(targetDur, 5), 10);
  }

  return options.find(d => d >= targetDur) ?? options[options.length - 1];
}
