import { useEffect, useMemo, useState } from 'react';
import { TaskStatus, TaskType } from '../types/task.types';
import {
  IMAGE_GENERATION_ESTIMATE_MS,
  IMAGE_GENERATION_MAX_PROGRESS,
  calculateSimulatedImageProgress,
  resolveImageTaskDisplayProgress,
} from '../utils/image-task-progress';

const PROGRESS_UPDATE_INTERVAL = 1000;
const IMAGE_LOAD_PROGRESS_INTERVAL = 100;
const IMAGE_LOAD_DURATION_MS = 5000;

export interface UseImageTaskProgressOptions {
  taskType?: TaskType | null;
  taskStatus?: TaskStatus | null;
  startedAt?: number;
  fallbackProgress?: number | null;
  realProgress?: number;
  mediaUrl?: string;
  isImageLoading?: boolean;
  estimatedDuration?: number;
}

export interface UseImageTaskProgressResult {
  displayProgress: number | null;
  imageLoadProgress: number;
}

export function useImageTaskProgress({
  taskType,
  taskStatus,
  startedAt,
  fallbackProgress,
  realProgress,
  mediaUrl,
  isImageLoading = false,
  estimatedDuration = IMAGE_GENERATION_ESTIMATE_MS,
}: UseImageTaskProgressOptions): UseImageTaskProgressResult {
  const [progressTick, setProgressTick] = useState(0);
  const [imageLoadProgress, setImageLoadProgress] = useState(0);

  useEffect(() => {
    if (
      taskType !== TaskType.IMAGE ||
      taskStatus !== TaskStatus.PROCESSING ||
      typeof startedAt !== 'number' ||
      Boolean(mediaUrl)
    ) {
      return;
    }

    // Rendering already computes the current value. Wake React only when the
    // displayed integer changes, and stop the clock once the estimate is capped.
    let previous = calculateSimulatedImageProgress(startedAt, estimatedDuration);
    if (previous >= IMAGE_GENERATION_MAX_PROGRESS) return;
    const interval = setInterval(() => {
      const next = calculateSimulatedImageProgress(startedAt, estimatedDuration);
      if (next !== previous) {
        previous = next;
        setProgressTick((value) => value + 1);
      }
      if (next >= IMAGE_GENERATION_MAX_PROGRESS) clearInterval(interval);
    }, PROGRESS_UPDATE_INTERVAL);

    return () => {
      clearInterval(interval);
    };
  }, [estimatedDuration, mediaUrl, startedAt, taskStatus, taskType]);

  useEffect(() => {
    if (!mediaUrl || !isImageLoading || taskType !== TaskType.IMAGE) {
      setImageLoadProgress(0);
      return;
    }

    setImageLoadProgress(0);
    const loadStartedAt = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - loadStartedAt;
      const nextProgress = Math.min(elapsed / IMAGE_LOAD_DURATION_MS, 1) * 100;

      setImageLoadProgress(nextProgress);

      if (nextProgress >= 100) {
        clearInterval(interval);
      }
    }, IMAGE_LOAD_PROGRESS_INTERVAL);

    return () => {
      clearInterval(interval);
    };
  }, [isImageLoading, mediaUrl, taskType]);

  const displayProgress = useMemo(() => {
    if (taskType === TaskType.VIDEO || taskType === TaskType.AUDIO) {
      return realProgress ?? 0;
    }

    if (taskType !== TaskType.IMAGE) {
      return fallbackProgress ?? null;
    }

    return resolveImageTaskDisplayProgress({
      startedAt,
      fallbackProgress,
      mediaUrl,
      isImageLoading,
      imageLoadProgress,
      estimatedDuration,
    });
  }, [
    estimatedDuration,
    fallbackProgress,
    imageLoadProgress,
    isImageLoading,
    mediaUrl,
    progressTick,
    realProgress,
    startedAt,
    taskStatus,
    taskType,
  ]);

  return {
    displayProgress,
    imageLoadProgress,
  };
}
