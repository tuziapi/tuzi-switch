import {
  readGenerationOrigin,
  restoreGenerationDraft,
} from '../../services/generation-node-lifecycle';
import { ImageGenerationErrorDetails } from './ImageGenerationErrorDetails';
import React, {
  useCallback,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import classNames from 'classnames';
import type { PlaitBoard } from '@plait/core';
import { ImageGenerationCopyButton } from './ImageGenerationCopyButton';
import { useImageGenerationAnchorController } from '../../hooks/useImageGenerationAnchorController';
import { taskQueueService } from '../../services/task-queue';
import { workflowCompletionService } from '../../services/workflow-completion-service';
import { ImageGenerationAnchorTransforms } from './image-generation-anchor.transforms';
import {
  IMAGE_GENERATION_ANCHOR_RETRY_EVENT,
  type ImageGenerationAnchorActionType,
  type PlaitImageGenerationAnchor,
} from '../../types/image-generation-anchor.types';
import { TaskStatus } from '../../types/task.types';
import {
  ImageGenerationProgressDisplay,
  type ImageGenerationProgressTone,
} from '../shared/ImageGenerationProgressDisplay';
import { RetryImage } from '../retry-image';
import { getImageTaskProgressStatusText } from '../../utils/image-task-progress';
import { buildImageGenerationAnchorPresentationPatch } from '../../utils/image-generation-anchor-state';
import { retryImageGenerationResultLoads } from '../../utils/image-generation-anchor-readiness';
import {
  getTasksForImageGenerationAnchor,
  selectPrimaryImageGenerationAnchorTask,
} from '../../utils/image-generation-anchor-task';
import './image-generation-anchor.scss';

interface ImageGenerationAnchorContentProps {
  board: PlaitBoard;
  element: PlaitImageGenerationAnchor;
  selected: boolean;
  onSizeChange?: (size: { width: number; height: number }) => void;
}

const PHASE_CENTER_LABELS = {
  submitted: '等待执行',
  queued: '等待执行',
  generating: '生成中',
  developing: '正在加载图片',
  inserting: '正在加载图片',
  completed: '',
  failed: '生成失败',
} as const;

const STACK_SLOT_STATUS_LABELS = {
  pending: '待生成',
  generating: '生成中',
  ready: '已完成',
  failed: '失败',
} as const;

export const ImageGenerationAnchorContent: React.FC<
  ImageGenerationAnchorContentProps
> = ({ board, element, selected, onSizeChange }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !onSizeChange) return;
    const measure = () =>
      onSizeChange({ width: card.offsetWidth, height: card.offsetHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      // ResizeObserver reports layout pixels before the canvas zoom transform.
      const size = entry?.borderBoxSize?.[0];
      if (size)
        onSizeChange({ width: size.inlineSize, height: size.blockSize });
      else measure();
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, [onSizeChange]);
  const { viewModel } = useImageGenerationAnchorController({
    board,
    anchor: element,
  });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const relatedTasks = useMemo(
    () =>
      getTasksForImageGenerationAnchor(element, taskQueueService.getAllTasks()),
    [element]
  );
  const resolvedTask = useMemo(
    () => selectPrimaryImageGenerationAnchorTask(element, relatedTasks),
    [element, relatedTasks]
  );
  const isGhost = viewModel.anchorType === 'ghost';
  const batchPreview = viewModel.batchPreview;
  const isStack = Boolean(batchPreview);
  const isRenderingResult =
    viewModel.phase === 'developing' || viewModel.phase === 'inserting';
  const candidateCount =
    batchPreview?.totalCount ??
    Math.max(element.requestedCount ?? 0, element.taskIds.length, 1);
  const showActions = viewModel.phase === 'failed' || detailsOpen || selected;
  const showRing = viewModel.progressMode !== 'hidden';
  const showDeterminateProgress =
    viewModel.progressMode === 'determinate' && viewModel.progress != null;
  const progressValue = Math.round(viewModel.progress ?? 0);
  const showCenterLabel = viewModel.phase !== 'completed';
  const centerLabel = isRenderingResult
    ? '正在加载图片'
    : isStack
    ? batchPreview?.statusText || PHASE_CENTER_LABELS[viewModel.phase]
    : showDeterminateProgress
    ? getImageTaskProgressStatusText(progressValue)
    : viewModel.failureStage === 'post-processing'
    ? viewModel.phaseLabel
    : PHASE_CENTER_LABELS[viewModel.phase];
  const progressTone: ImageGenerationProgressTone =
    viewModel.phase === 'failed'
      ? 'danger'
      : viewModel.phase === 'completed'
      ? 'success'
      : isRenderingResult
      ? 'loading'
      : 'default';
  const stopEventPropagation = useCallback(
    (event: React.PointerEvent | React.MouseEvent) => {
      event.stopPropagation();
    },
    []
  );
  const stopInteractionStart = useCallback(
    (event: React.PointerEvent | React.MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
    },
    []
  );
  const failureIdentifier =
    resolvedTask?.id ||
    element.primaryTaskId ||
    element.taskIds[0] ||
    element.workflowId;
  const stopPointer = useCallback(
    (event: React.PointerEvent | React.MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
    },
    []
  );
  const handleAction = useCallback(
    (actionType: ImageGenerationAnchorActionType) => {
      if (actionType === 'none') {
        return;
      }

      if (actionType === 'details') {
        setDetailsOpen((value) => !value);
        return;
      }

      if (actionType === 'retry') {
        if (retryImageGenerationResultLoads(board, element, relatedTasks)) {
          ImageGenerationAnchorTransforms.updateAnchor(
            board,
            element.id,
            buildImageGenerationAnchorPresentationPatch('inserting', {
              subtitle: '正在重新加载已有图片',
            })
          );
          return;
        }
        const retryableTask =
          relatedTasks.find(
            (task) =>
              task.status === TaskStatus.FAILED ||
              task.status === TaskStatus.CANCELLED
          ) ||
          relatedTasks.find(
            (task) =>
              workflowCompletionService.getPostProcessingStatus(task.id)
                ?.status === 'failed'
          ) ||
          selectPrimaryImageGenerationAnchorTask(element, relatedTasks);
        const taskId =
          retryableTask?.id || element.primaryTaskId || element.taskIds[0];
        if (!taskId) {
          ImageGenerationAnchorTransforms.updateAnchor(
            board,
            element.id,
            buildImageGenerationAnchorPresentationPatch('failed', {
              error: '任务未绑定，无法重试',
            })
          );
          return;
        }

        if (
          retryableTask &&
          (retryableTask.status === TaskStatus.FAILED ||
            retryableTask.status === TaskStatus.CANCELLED)
        ) {
          ImageGenerationAnchorTransforms.updateAnchor(
            board,
            element.id,
            buildImageGenerationAnchorPresentationPatch('retrying')
          );

          taskQueueService.retryTask(retryableTask.id);
          return;
        }

        window.dispatchEvent(
          new CustomEvent(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, {
            detail: { taskId, anchorId: element.id },
          })
        );
        return;
      }

      if (actionType === 'dismiss') {
        const current = board.children.find((node) => node.id === element.id);
        if (current) board.deleteFragment([current]);
      }
    },
    [board, element, relatedTasks]
  );
  const runDeferredAction = useCallback(
    (actionType: ImageGenerationAnchorActionType) => {
      window.setTimeout(() => {
        handleAction(actionType);
      }, 0);
    },
    [handleAction]
  );

  const renderCore = () => {
    if (showFailureSummary) {
      return (
        <div className="image-generation-anchor__failure-summary">
          <div className="image-generation-anchor__failure-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="presentation">
              <path d="M8.5 8.5a4.8 4.8 0 0 1 7.7 1.1" />
              <path d="M15.5 15.5a4.8 4.8 0 0 1-7.7-1.1" />
              <path d="m16.5 7.5-.3 3.2-3.2-.3" />
              <path d="m7.5 16.5.3-3.2 3.2.3" />
            </svg>
          </div>
          <strong className="image-generation-anchor__failure-title">
            暂时没能生成图片
          </strong>
          <p className="image-generation-anchor__failure-copy">
            服务暂时繁忙，请稍后重试。
            <br />
            你的提示词和参数已保留。
          </p>
          <button
            type="button"
            className="image-generation-anchor__error-link"
            onPointerDown={stopInteractionStart}
            onMouseDown={stopInteractionStart}
            onPointerUp={stopEventPropagation}
            onMouseUp={stopEventPropagation}
            onClick={(event) => {
              stopPointer(event);
              runDeferredAction('details');
            }}
          >
            <span aria-hidden="true">›</span> 查看错误详情
          </button>
          <span className="image-generation-anchor__failure-status">生成失败</span>
        </div>
      );
    }

    return (
      <div className="image-generation-anchor__surface-core">
        {showCenterLabel ? (
          <ImageGenerationProgressDisplay
            progress={showDeterminateProgress ? progressValue : null}
            progressMode={viewModel.progressMode}
            tone={progressTone}
            statusText={centerLabel}
            compact
            showRing={!isRenderingResult && (showRing || viewModel.phase === 'failed')}
            className="image-generation-anchor__progress-display"
          />
        ) : null}
        {viewModel.phase === 'failed' && viewModel.error ? (
          <div className="image-generation-anchor__error">
            <span className="image-generation-anchor__error-raw">
              {viewModel.error}
            </span>
            {failureIdentifier ? (
              <span className="image-generation-anchor__error-id">
                <span className="image-generation-anchor__error-id-text">
                  ID: {failureIdentifier}
                </span>
                <ImageGenerationCopyButton
                  label="本地任务 ID"
                  value={failureIdentifier}
                />
              </span>
            ) : null}
            <button
              type="button"
              className="image-generation-anchor__error-link"
              onPointerDown={stopInteractionStart}
              onMouseDown={stopInteractionStart}
              onPointerUp={stopEventPropagation}
              onMouseUp={stopEventPropagation}
              onClick={(event) => {
                stopPointer(event);
                runDeferredAction('details');
              }}
            >
              {detailsOpen ? '收起详情' : '查看详情'}
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  const primaryActionLabel =
    detailsOpen && viewModel.primaryAction.type === 'details'
      ? '收起'
      : viewModel.primaryAction.label;
  const secondaryActionLabel =
    detailsOpen && viewModel.secondaryAction?.type === 'details'
      ? '收起'
      : viewModel.secondaryAction?.label;
  const secondaryActionType = viewModel.secondaryAction?.type;
  const headerTitle =
    viewModel.phase === 'failed'
      ? viewModel.failureDetails?.modelId || viewModel.title || '图片生成'
      : viewModel.title || '图片生成';
  const headerCount = `${candidateCount}/${candidateCount}`;
  const showFailureSummary =
    viewModel.phase === 'failed' &&
    viewModel.failureStage !== 'post-processing';
  const stackBadgeLabel =
    candidateCount > 1 ? `${candidateCount} 张` : String(candidateCount);
  const stackSummaryLabel =
    batchPreview && batchPreview.readySlotCount > 0
      ? `${batchPreview.readySlotCount}/${batchPreview.totalCount} 已完成`
      : batchPreview?.statusText;

  const renderSurfacePreview = () => {
    if (isStack && batchPreview) {
      const slots = batchPreview.slots.map((slot, index) => {
        return (
          <div
            key={slot.id}
            className={classNames(
              'image-generation-anchor__stack-slot',
              `image-generation-anchor__stack-slot--index-${index}`,
              `image-generation-anchor__stack-slot--${slot.status}`,
              {
                'image-generation-anchor__stack-slot--preview': Boolean(
                  slot.previewImageUrl
                ),
              }
            )}
          >
            <span className="image-generation-anchor__stack-slot-noise" />
            {slot.previewImageUrl ? (
              <RetryImage
                className="image-generation-anchor__stack-slot-image"
                src={slot.previewImageUrl}
                alt={`生成预览 ${index + 1}`}
                showSkeleton={false}
                eager
              />
            ) : null}
            <span className="image-generation-anchor__stack-slot-meta">
              <span className="image-generation-anchor__stack-slot-index">
                {index + 1}
              </span>
              <span className="image-generation-anchor__stack-slot-status">
                {slot.failureStage === 'post-processing'
                  ? '插入失败'
                  : STACK_SLOT_STATUS_LABELS[slot.status]}
              </span>
            </span>
            <span className="image-generation-anchor__stack-slot-sheen" />
          </div>
        );
      });

      return (
        <div
          className={classNames(
            'image-generation-anchor__surface-preview',
            'image-generation-anchor__surface-preview--stack'
          )}
        >
          <div
            className={classNames(
              'image-generation-anchor__stack-preview',
              `image-generation-anchor__stack-preview--count-${batchPreview.visibleSlotCount}`,
              {
                'image-generation-anchor__stack-preview--has-preview':
                  batchPreview.hasPreviewImage,
              }
            )}
          >
            {slots}
          </div>
        </div>
      );
    }

    return (
      <div className="image-generation-anchor__surface-preview">
        <div className="image-generation-anchor__surface-shell" />
        <div
          className={classNames('image-generation-anchor__surface-image', {
            'image-generation-anchor__surface-image--actual': Boolean(
              viewModel.previewImageUrl
            ),
          })}
        >
          <span className="image-generation-anchor__surface-image-noise" />
          {viewModel.previewImageUrl ? (
            <RetryImage
              className="image-generation-anchor__surface-image-actual"
              src={viewModel.previewImageUrl}
              alt="图片生成预览"
              showSkeleton={false}
              eager
            />
          ) : null}
          <span className="image-generation-anchor__surface-image-sheen" />
        </div>
      </div>
    );
  };

  return (
    <div
      ref={cardRef}
      className={classNames(
        'image-generation-anchor',
        `image-generation-anchor--${viewModel.anchorType}`,
        `image-generation-anchor--${viewModel.tone}`,
        `image-generation-anchor--phase-${viewModel.phase}`,
        `image-generation-anchor--progress-${viewModel.progressMode}`,
        `image-generation-anchor--transition-${viewModel.transitionMode}`,
        {
          'image-generation-anchor--selected': selected,
          'image-generation-anchor--terminal': viewModel.isTerminal,
          'image-generation-anchor--details-open': detailsOpen,
        }
      )}
    >
      <div className="image-generation-anchor__glow" />

      <div className="image-generation-anchor__header">
        <div className="image-generation-anchor__header-title">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <circle cx="9" cy="9" r="1.5" />
            <path d="m6.5 17 4.2-4.2 2.6 2.6 1.8-1.8 2.4 3.4" />
          </svg>
          <span>{headerTitle}</span>
        </div>
        {viewModel.phase === 'failed' ? (
          <button
            type="button"
            className="image-generation-anchor__header-close"
            aria-label="移除卡片"
            onPointerDown={stopInteractionStart}
            onMouseDown={stopInteractionStart}
            onPointerUp={stopEventPropagation}
            onMouseUp={stopEventPropagation}
            onClick={(event) => {
              stopPointer(event);
              runDeferredAction('dismiss');
            }}
          >
            ×
          </button>
        ) : (
          <span className="image-generation-anchor__header-count">
            {headerCount}
          </span>
        )}
      </div>

      <div
        className={classNames('image-generation-anchor__surface', {
          'image-generation-anchor__surface--compact': isGhost,
          'image-generation-anchor__surface--stack': isStack,
        })}
      >
        {!isStack ? (
          <div className="image-generation-anchor__surface-grid" />
        ) : null}
        <div className="image-generation-anchor__surface-refresh" />
        {isStack && batchPreview ? (
          <div className="image-generation-anchor__stack-header">
            <div className="image-generation-anchor__stack-badge">
              {stackBadgeLabel}
            </div>
            {stackSummaryLabel ? (
              <div className="image-generation-anchor__stack-summary">
                {stackSummaryLabel}
              </div>
            ) : null}
          </div>
        ) : null}
        {renderSurfacePreview()}

        {renderCore()}
      </div>

      {detailsOpen ? (
        <ImageGenerationErrorDetails
          phaseLabel={viewModel.phaseLabel}
          failure={viewModel.failureDetails}
          localTaskId={element.primaryTaskId || element.taskIds[0] || '待绑定'}
          workflowId={element.workflowId}
          anchorType={viewModel.anchorType}
          transitionMode={viewModel.transitionMode}
        />
      ) : null}

      {showActions ? (
        <div className="image-generation-anchor__actions">
          {viewModel.phase === 'failed' && readGenerationOrigin(element) && (
            <button
              type="button"
              className="image-generation-anchor__action"
              onPointerDown={stopInteractionStart}
              onPointerUp={stopEventPropagation}
              onClick={(event) => {
                stopPointer(event);
                restoreGenerationDraft(board, element.id);
              }}
            >
              恢复编辑
            </button>
          )}
          <button
            type="button"
            className="image-generation-anchor__action"
            onPointerDown={stopInteractionStart}
            onMouseDown={stopInteractionStart}
            onPointerUp={stopEventPropagation}
            onMouseUp={stopEventPropagation}
            onClick={(event) => {
              stopPointer(event);
              runDeferredAction(viewModel.primaryAction.type);
            }}
          >
            {primaryActionLabel}
          </button>
          {viewModel.secondaryAction ? (
            <button
              type="button"
              className="image-generation-anchor__action image-generation-anchor__action--secondary"
              onPointerDown={stopInteractionStart}
              onMouseDown={stopInteractionStart}
              onPointerUp={stopEventPropagation}
              onMouseUp={stopEventPropagation}
              onClick={(event) => {
                stopPointer(event);
                if (secondaryActionType) {
                  runDeferredAction(secondaryActionType);
                }
              }}
            >
              {secondaryActionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
