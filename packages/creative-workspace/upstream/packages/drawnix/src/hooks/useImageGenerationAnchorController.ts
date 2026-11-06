import { useEffect, useMemo, useState, useRef } from 'react';
import type { PlaitBoard } from '@plait/core';
import { taskQueueService } from '../services/task-queue';
import { workflowCompletionService } from '../services/workflow-completion-service';
import {
  getImageGenerationAnchorControllerResult,
  type ImageGenerationAnchorControllerOptions,
  type ImageGenerationAnchorControllerResult,
} from '../utils/image-generation-anchor-controller';
import {
  doesTaskBelongToImageGenerationAnchor,
  getTasksForImageGenerationAnchor,
  selectPrimaryImageGenerationAnchorTask,
} from '../utils/image-generation-anchor-task';
import { TaskStatus, type Task } from '../types/task.types';
import { useImageTaskProgress } from './useImageTaskProgress';
import { hasResolvedImageGenerationBatchCount } from '../utils/image-generation-anchor-batch';
import {
  areImageGenerationResultsReady,
  isAnchorImageReadinessRelevant,
  getImageGenerationResultLoadError,
} from '../utils/image-generation-anchor-readiness';
import { subscribeCanvasImageReadiness } from '../services/canvas-image-readiness';

interface UseImageGenerationAnchorControllerOptions
  extends ImageGenerationAnchorControllerOptions {
  board: PlaitBoard;
}

export function useImageGenerationAnchorController(
  options: UseImageGenerationAnchorControllerOptions
): ImageGenerationAnchorControllerResult {
  const { anchor, board, task: providedTask } = options;
  const [taskRevision, setTaskRevision] = useState(0);
  const taskIdsKey = anchor.taskIds.join('|');

  const current = useRef({ anchor, providedTask, relatedTasks: [] as Task[] });
  current.current.anchor = anchor;
  current.current.providedTask = providedTask;

  useEffect(() => {
    const updateRevision = () => setTaskRevision((value) => value + 1);
    const unsubscribe = subscribeCanvasImageReadiness(board, (elementId) => {
      const value = current.current;
      if (isAnchorImageReadinessRelevant(board, value.anchor, elementId, value.relatedTasks)) updateRevision();
    });
    const completionSubscription = workflowCompletionService.observeCompletionEvents().subscribe((event) => {
      const { anchor, relatedTasks } = current.current;
      if (anchor.primaryTaskId === event.taskId || anchor.taskIds.includes(event.taskId) || relatedTasks.some((task) => task.id === event.taskId)) updateRevision();
    });
    const taskSubscription = taskQueueService.observeTaskUpdates().subscribe((event) => {
      const { anchor, providedTask } = current.current;
      if (!providedTask && doesTaskBelongToImageGenerationAnchor(anchor, event.task)) updateRevision();
    });
    // Catch cached readiness that changes between rendering and subscribing.
    updateRevision();
    return () => { unsubscribe(); completionSubscription.unsubscribe(); taskSubscription.unsubscribe(); };
  }, [board]);

  const relatedTasks = useMemo(() => {
    const allTasks = taskQueueService.getAllTasks();
    return getTasksForImageGenerationAnchor(anchor, allTasks);
  }, [anchor, taskIdsKey, taskRevision]);

  current.current.relatedTasks = relatedTasks;

  const resolvedTask = useMemo(() => {
    if (providedTask) {
      return providedTask;
    }

    return selectPrimaryImageGenerationAnchorTask(anchor, relatedTasks);
  }, [anchor, providedTask, taskIdsKey, taskRevision]);

  const { displayProgress } = useImageTaskProgress({
    taskType: resolvedTask?.type,
    taskStatus: resolvedTask?.status,
    startedAt: resolvedTask?.startedAt,
    fallbackProgress: resolvedTask?.progress ?? anchor.progress,
  });

  const derivedPostProcessingStatus = useMemo(() => {
    if (relatedTasks.length === 0) {
      return options.postProcessingStatus;
    }

    const postProcessingResults = relatedTasks
      .map((relatedTask) =>
        workflowCompletionService.getPostProcessingStatus(relatedTask.id)
      )
      .filter((result): result is NonNullable<typeof result> =>
        Boolean(result)
      );
    const hasFailure = postProcessingResults.some(
      (result) => result.status === 'failed'
    );
    const hasNonFailedTask = relatedTasks.some((relatedTask) => {
      const postProcessing = workflowCompletionService.getPostProcessingStatus(
        relatedTask.id
      );

      return (
        relatedTask.status !== TaskStatus.FAILED &&
        postProcessing?.status !== 'failed'
      );
    });

    if (hasFailure && !hasNonFailedTask) {
      return 'failed' as const;
    }

    if (
      postProcessingResults.some((result) => result.status === 'processing')
    ) {
      return 'processing' as const;
    }

    const allInserted =
      hasResolvedImageGenerationBatchCount(anchor, relatedTasks) &&
      relatedTasks.every(
        (relatedTask) =>
          Boolean(relatedTask.insertedToCanvas) ||
          workflowCompletionService.getPostProcessingStatus(relatedTask.id)
            ?.status === 'completed'
      );

    if (allInserted) {
      return 'completed' as const;
    }

    return options.postProcessingStatus;
  }, [anchor, options.postProcessingStatus, relatedTasks, taskRevision]);

  const derivedHasInserted = useMemo(() => {
    if (relatedTasks.length === 0) {
      return options.hasInserted;
    }

    return (
      hasResolvedImageGenerationBatchCount(anchor, relatedTasks) &&
      relatedTasks.every(
        (relatedTask) =>
          Boolean(relatedTask.insertedToCanvas) ||
          workflowCompletionService.getPostProcessingStatus(relatedTask.id)
            ?.status === 'completed'
      )
    );
  }, [anchor, options.hasInserted, relatedTasks, taskRevision]);

  return useMemo(
    () =>
      getImageGenerationAnchorControllerResult({
        ...options,
        task: resolvedTask ?? providedTask,
        tasks: relatedTasks,
        postProcessingStatus: derivedPostProcessingStatus,
        hasInserted: derivedHasInserted,
        canvasReady: areImageGenerationResultsReady(board, anchor, relatedTasks),
        canvasError: getImageGenerationResultLoadError(board, anchor, relatedTasks),
        taskDisplayProgress: displayProgress,
      }),
    [
      derivedHasInserted,
      board,
      anchor,
      derivedPostProcessingStatus,
      displayProgress,
      options,
      providedTask,
      relatedTasks,
      resolvedTask,
    ]
  );
}
