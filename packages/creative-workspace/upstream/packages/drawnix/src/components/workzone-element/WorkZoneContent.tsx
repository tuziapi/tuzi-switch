import { NativeGenerationFailureDetails, getNativeFailureLayout, type FailureRows } from '../shared/NativeGenerationFailureDetails';
/**
 * WorkZone 内容组件
 *
 * 在画布上显示工作流进度的 React 组件
 * 这是 WorkflowMessageBubble 的简化版本，适合在画布元素中使用
 */

import { GenerationFailureDetails } from '../shared/GenerationFailureDetails';
import { getWorkflowFailureDetails } from '../../utils/workflow-error-details';
import React, {
  useMemo,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import { Trash2, RotateCcw, EyeOff } from 'lucide-react';
import type { WorkflowMessageData } from '../../types/chat.types';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import { HoverTip } from '../shared/hover';
import './workzone-content.scss';
import { taskQueueService } from '../../services/task-queue';
import { findWorkflowStepForTask } from '../../utils/workflow-task-linking';
import { applyTaskUpdateToWorkflowMessage } from '../../utils/workflow-task-sync';
import { getTaskStatusText } from '../../utils/task-utils';
import { TaskStatus, TaskExecutionPhase } from '../../types/task.types';

// 状态图标映射
type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

const STATUS_ICONS: Record<StepStatus, string> = {
  pending: '○',
  running: '◉',
  completed: '✓',
  failed: '✗',
  skipped: '⊘',
};

// 全局记录已经 claim 过的工作流，避免重复请求
const claimedWorkflows = new Set<string>();

interface WorkZoneContentProps {
  workflow: WorkflowMessageData;
  nativeSize?: { width: number; height: number };
  className?: string;
  onSizeChange?: (size: { width: number; height: number }) => void;
  onDelete?: () => void;
  /** 当 SW 中找不到工作流或工作流状态变更时的回调 */
  onWorkflowStateChange?: (
    workflowId: string,
    status: 'completed' | 'failed' | 'cancelled',
    error?: string
  ) => void;
  /** 从失败步骤重试工作流 */
  onRetry?: (workflow: WorkflowMessageData, stepIndex: number) => Promise<void>;
  /** 永远不再显示 WorkZone 卡片 */
  onHideForever?: () => void;
}

export const WorkZoneContent: React.FC<WorkZoneContentProps> = ({
  workflow: sourceWorkflow,
  nativeSize,
  className = '',
  onSizeChange,
  onDelete,
  onWorkflowStateChange,
  onRetry,
  onHideForever,
}) => {
  const [taskRevision, setTaskRevision] = useState(0);
  useEffect(() => {
    const subscription = taskQueueService.observeTaskUpdates().subscribe(({ task }) => {
      if (findWorkflowStepForTask(sourceWorkflow, task)) setTaskRevision((n) => n + 1);
    });
    setTaskRevision((n) => n + 1);
    return () => subscription.unsubscribe();
  }, [sourceWorkflow]);
  const relatedTasks = useMemo(() => taskQueueService.getAllTasks().filter(
    (task) => findWorkflowStepForTask(sourceWorkflow, task)
  ), [sourceWorkflow, taskRevision]);
  const workflow = useMemo(() => relatedTasks.reduce(
    (current, task) => applyTaskUpdateToWorkflowMessage(current, task) || current,
    sourceWorkflow
  ), [sourceWorkflow, relatedTasks]);

  const rootRef = useRef<HTMLDivElement>(null);
  const failureDetails = useMemo(
    () => getWorkflowFailureDetails(workflow, taskQueueService.getAllTasks()),
    [workflow, taskRevision]
  );
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !onSizeChange) return;
    const measure = () =>
      onSizeChange({ width: root.offsetWidth, height: root.offsetHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.borderBoxSize?.[0];
      if (box) onSizeChange({ width: box.inlineSize, height: box.blockSize });
      else measure();
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [onSizeChange]);
  // 用于追踪是否已经尝试 claim
  const hasClaimedRef = useRef(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [showHideConfirm, setShowHideConfirm] = useState(false);

  // 页面刷新后，尝试接管工作流或同步状态
  // 注意：只对"旧"工作流执行 claim，新创建的工作流不需要 claim
  useEffect(() => {
    const workflowId = workflow.id;

    // 检查是否是新创建的工作流（60秒内创建的视为新工作流）
    // 新工作流不需要 claim，因为它们刚刚被提交到 SW
    // 60秒足以涵盖 submit 的超时和重试过程
    const isNewWorkflow =
      workflow.createdAt && Date.now() - workflow.createdAt < 60000;
    if (isNewWorkflow) {
      return;
    }

    // 检查 workflow.status 或 steps 中是否有活跃状态
    const hasRunningSteps = workflow.steps?.some(
      (s) => s.status === 'running' || s.status === 'pending'
    );
    const isTerminalStatus =
      workflow.status === 'completed' ||
      workflow.status === 'failed' ||
      workflow.status === 'cancelled';
    const isActiveByStatus =
      workflow.status === 'running' || workflow.status === 'pending';
    const isActiveBySteps = hasRunningSteps && !isTerminalStatus;
    // 不一致状态：终态但有运行中的步骤，需要从 SW 获取真实状态
    const isInconsistentState = isTerminalStatus && hasRunningSteps;
    const needsClaim =
      isActiveByStatus || isActiveBySteps || isInconsistentState;

    // 如果工作流已是终态但 steps 还在 running，这是不一致状态
    // 需要从 SW 获取真实状态，而不是直接标记为失败
    // 这种情况通常发生在页面刷新后，SW 端状态可能已经更新但 UI 还是旧状态

    // 避免重复 claim
    if (
      !needsClaim ||
      hasClaimedRef.current ||
      claimedWorkflows.has(workflowId)
    ) {
      return;
    }

    hasClaimedRef.current = true;
    claimedWorkflows.add(workflowId);

    // 异步 claim 工作流
    (async () => {
      try {
        const { workflowSubmissionService } = await import(
          '../../services/workflow-submission-service'
        );

        // 首先检查是否由降级引擎管理
        if (workflowSubmissionService.isWorkflowManagedByFallback(workflowId)) {
          // 降级模式：从降级引擎获取状态
          const fallbackWorkflow =
            workflowSubmissionService.getWorkflowFromFallback(workflowId);
          if (fallbackWorkflow) {
            const status = fallbackWorkflow.status;
            if (
              status === 'completed' ||
              status === 'failed' ||
              status === 'cancelled'
            ) {
              onWorkflowStateChange?.(
                workflowId,
                status,
                fallbackWorkflow.error
              );
            }
            // 降级模式下工作流正在运行，不需要额外操作
            return;
          }
        }

        const syncFromMainThreadWorkflow = async (
          missingMessage = '工作流已丢失，请重试'
        ): Promise<boolean> => {
          const resumed =
            await workflowSubmissionService.resumeWorkflowWithFallback(
              workflowId
            );
          if (resumed) {
            return true;
          }

          const localWorkflow =
            (await workflowSubmissionService.queryWorkflowStatus(workflowId)) ||
            workflowSubmissionService.getWorkflow(workflowId);
          if (localWorkflow) {
            const status = localWorkflow.status;
            if (
              status === 'completed' ||
              status === 'failed' ||
              status === 'cancelled'
            ) {
              onWorkflowStateChange?.(
                workflowId,
                status,
                localWorkflow.error
              );
              return true;
            }
            if (status === 'running' || status === 'pending') {
              return true;
            }
          }

          onWorkflowStateChange?.(workflowId, 'failed', missingMessage);
          return false;
        };

        // 尝试通过 SW claim
        const { swChannelClient } = await import(
          '../../services/sw-channel/client'
        );
        const claimWorkflow = (
          swChannelClient as typeof swChannelClient & {
            claimWorkflow?: (workflowId: string) => Promise<{
              success: boolean;
              workflow?: { status?: string; error?: string };
              error?: string;
            }>;
          }
        ).claimWorkflow;

        // 快速检查 SW 是否可用（不再等待 5 秒）
        if (
          !swChannelClient.isInitialized() ||
          typeof claimWorkflow !== 'function'
        ) {
          await syncFromMainThreadWorkflow();
          return;
        }

        const result = await claimWorkflow.call(swChannelClient, workflowId);

        if (result.success) {
          // 如果 SW 中的工作流已经是终态，通知 UI 更新
          const swStatus = result.workflow?.status;
          if (
            swStatus === 'completed' ||
            swStatus === 'failed' ||
            swStatus === 'cancelled'
          ) {
            onWorkflowStateChange?.(
              workflowId,
              swStatus === 'completed' ? 'completed' : 'failed',
              result.workflow?.error
            );
          }
          return;
        }

        // 工作流不存在或 claim 失败，回退到主线程恢复/本地状态查询
        const recovered = await syncFromMainThreadWorkflow(
          result.error || '工作流已丢失，请重试'
        );
        if (recovered) {
          return;
        }
      } catch (error) {
        claimedWorkflows.delete(workflowId);
        onWorkflowStateChange?.(workflowId, 'failed', '恢复工作流失败，请重试');
      }
    })();
  }, [workflow.id, workflow.status, workflow.createdAt, onWorkflowStateChange]);
  // 计算工作流状态
  const workflowStatus = useMemo(() => {
    const steps = workflow.steps;
    const totalSteps = steps.length;
    const completedSteps = steps.filter((s) => s.status === 'completed').length;
    const failedSteps = steps.filter((s) => s.status === 'failed').length;
    const runningSteps = steps.filter((s) => s.status === 'running').length;

    let status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' = 'pending';
    if (sourceWorkflow.status === 'cancelled' || (totalSteps > 0 && steps.every((s) => s.status === 'skipped'))) {
      status = 'cancelled';
    } else if (failedSteps > 0 || workflow.status === 'failed') {
      status = 'failed';
    } else if (completedSteps === totalSteps && totalSteps > 0) {
      status = 'completed';
    } else if (runningSteps > 0 || completedSteps > 0) {
      status = 'running';
    }

    return { status, totalSteps, completedSteps };
  }, [workflow.steps, workflow.status, sourceWorkflow.status]);

  // 计算进度百分比
  const progress =
    workflowStatus.totalSteps > 0
      ? (workflowStatus.completedSteps / workflowStatus.totalSteps) * 100
      : 0;

  // 状态标签
  const statusLabel = useMemo(() => {
    const labels: Record<typeof workflowStatus.status, string> = {
      pending: '待开始',
      running: '生成中',
      completed: '已完成',
      failed: '生成失败',
      cancelled: '已取消',
    };
    if (workflowStatus.status === 'running') {
      const active = relatedTasks.filter((task) => [TaskStatus.PENDING, TaskStatus.PROCESSING].includes(task.status));
      if (active.length && active.every((task) => task.status === TaskStatus.PENDING)) return getTaskStatusText(active[0]);
      if (active.length && active.every((task) => task.executionPhase === TaskExecutionPhase.SUBMITTING)) return getTaskStatusText(active[0]);
    }
    return labels[workflowStatus.status];
  }, [workflowStatus.status, relatedTasks]);

  // 获取当前执行步骤
  const currentStep = useMemo(() => {
    return workflow.steps.find((s) => s.status === 'running');
  }, [workflow.steps]);

  // 类型图标
  const typeIcon =
    workflow.generationType === 'image'
      ? '🖼️'
      : workflow.generationType === 'video'
      ? '🎬'
      : workflow.generationType === 'audio'
      ? '🎵'
      : '📝';

  // 找到第一个失败步骤的索引
  const firstFailedStepIndex = useMemo(() => {
    return workflow.steps.findIndex((s) => s.status === 'failed');
  }, [workflow.steps]);

  // 是否可以重试（有重试回调、有 retryContext、有失败步骤）
  const canRetry =
    workflowStatus.status === 'failed' &&
    onRetry &&
    workflow.retryContext &&
    firstFailedStepIndex >= 0;

  const handleRetry = useCallback(async () => {
    if (!onRetry || firstFailedStepIndex < 0 || isRetrying) return;
    setIsRetrying(true);
    try {
      await onRetry(workflow, firstFailedStepIndex);
    } finally {
      setIsRetrying(false);
    }
  }, [onRetry, workflow, firstFailedStepIndex, isRetrying]);

  const handleHideForeverClick = useCallback(() => {
    setShowHideConfirm(true);
  }, []);

  const handleHideConfirm = useCallback(() => {
    setShowHideConfirm(false);
    onHideForever?.();
  }, [onHideForever]);

  const stopWorkZonePressEvent = useCallback(
    (
      event:
        | React.PointerEvent<HTMLButtonElement>
        | React.MouseEvent<HTMLButtonElement>
    ) => {
      event.stopPropagation();
    },
    []
  );
  const handleWorkZoneButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
    },
    []
  );

  const nativeFailureRows: FailureRows = [
    ['Request ID', failureDetails.requestId || '未获取到'],
    ['错误', failureDetails.error || '执行失败'],
    ['模型', failureDetails.modelId || '未记录'],
    ...(failureDetails.remoteId ? [['任务 ID', failureDetails.remoteId] as const] : []),
  ];
  const nativeFailed = workflowStatus.status === 'failed';
  const nativeWidth = nativeSize ? Math.max(nativeSize.width, nativeFailed ? 320 : 0) : 0;
  const nativeHeight = nativeSize ? Math.max(nativeSize.height, nativeFailed ? 156 + getNativeFailureLayout(nativeFailureRows, nativeWidth).height : 0) : 0;
  useLayoutEffect(() => {
    if (nativeWidth && nativeHeight) onSizeChange?.({ width: nativeWidth, height: nativeHeight });
  }, [nativeWidth, nativeHeight, onSizeChange]);

  if (nativeSize) {
    const width = nativeWidth;
    const height = nativeHeight;
    const failed = workflowStatus.status === 'failed';
    const color = failed ? '#b42318' : '#475569';
    const clipId = `workzone-text-${workflow.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const action = (label: string, x: number, run: () => void, disabled = false) => (
      <g role="button" tabIndex={disabled ? -1 : 0} aria-label={label} aria-disabled={disabled}
        style={{ cursor: disabled ? 'default' : 'pointer' }}
        onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); if (!disabled) run(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (!disabled) run(); } }}>
        <rect x={x} y={height - 37} width={78} height={26} rx={5} fill="#f1f5f9" stroke="#cbd5e1" />
        <text x={x + 39} y={height - 20} textAnchor="middle" fontSize={11} fill="#334155">{label}</text>
      </g>
    );
    return <g className="workzone-native-card" role="group" aria-label={`${workflow.name}：${statusLabel}`}>
      <rect width={width} height={height} rx={10} fill={failed ? '#fff7f6' : '#ffffff'} stroke={failed ? '#fda29b' : '#cbd5e1'} />
      <defs><clipPath id={clipId}><rect x={14} y={12} width={width - 28} height={height - 57} /></clipPath></defs>
      <g clipPath={`url(#${clipId})`} fontFamily="system-ui, sans-serif" fill={color}>
        <text x={16} y={31} fontSize={12}>{typeIcon} {workflow.name}</text>
        <text x={16} y={65} fontSize={20} fontWeight={600}>{statusLabel}</text>
        <text x={16} y={89} fontSize={11}>{workflowStatus.completedSteps}/{workflowStatus.totalSteps} 步骤</text>
        {!failed && workflow.steps.slice(0, Math.max(1, Math.floor((height - 155) / 24))).map((step, i) =>
          <text key={step.id} x={16} y={116 + i * 24} fontSize={12}>{STATUS_ICONS[step.status]} {step.error || step.description}</text>
        )}
      </g>
      {failed && <g transform="translate(0 106)"><NativeGenerationFailureDetails rows={nativeFailureRows} width={width} /></g>}
      {onDelete && action('删除', width - 92, onDelete)}
      {canRetry && action(isRetrying ? '重试中' : '重试', 14, () => void handleRetry(), isRetrying)}
      {onHideForever && action('隐藏卡片', canRetry ? 98 : 14, handleHideForeverClick)}
      <ConfirmDialog open={showHideConfirm} title="隐藏进度卡片" description="确定不再显示进度卡片？任务仍会在后台执行，可在设置中恢复显示。"
        confirmText="确定" cancelText="取消" onOpenChange={setShowHideConfirm} onConfirm={handleHideConfirm} />
    </g>;
  }

  return (
    <div
      ref={rootRef}
      className={`workzone-content workzone-content--${workflowStatus.status} ${className}`}
    >
      {/* 头部 */}
      <div className="workzone-content__header">
        <span className="workzone-content__icon">{typeIcon}</span>
        <span className="workzone-content__title">{workflow.name}</span>
        <span
          className={`workzone-content__status workzone-content__status--${workflowStatus.status}`}
        >
          {statusLabel}
        </span>
        {/* 不再显示按钮 */}
        {onHideForever && (
          <HoverTip content="不再显示" showArrow={false}>
            <button
              type="button"
              aria-label="不再显示"
              className="workzone-content__hide-btn"
              onPointerDownCapture={stopWorkZonePressEvent}
              onPointerDown={stopWorkZonePressEvent}
              onPointerUp={stopWorkZonePressEvent}
              onMouseDownCapture={stopWorkZonePressEvent}
              onMouseDown={stopWorkZonePressEvent}
              onClick={(event) => {
                handleWorkZoneButtonClick(event);
                handleHideForeverClick();
              }}
            >
              <EyeOff size={14} />
            </button>
          </HoverTip>
        )}
        {/* 删除按钮 - 始终显示（如果有 onDelete 回调） */}
        {onDelete && (
          <HoverTip content="删除" showArrow={false}>
            <button
              type="button"
              aria-label="删除"
              className="workzone-content__delete-btn"
              onPointerDownCapture={stopWorkZonePressEvent}
              onPointerDown={stopWorkZonePressEvent}
              onPointerUp={stopWorkZonePressEvent}
              onMouseDownCapture={stopWorkZonePressEvent}
              onMouseDown={stopWorkZonePressEvent}
              onClick={(event) => {
                handleWorkZoneButtonClick(event);
                onDelete();
              }}
            >
              <Trash2 size={14} />
            </button>
          </HoverTip>
        )}
      </div>

      {/* 进度条 */}
      <div className="workzone-content__progress">
        <div
          className={`workzone-content__progress-bar workzone-content__progress-bar--${workflowStatus.status}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* 进度文本 */}
      <div className="workzone-content__progress-info">
        <span>
          {workflowStatus.completedSteps}/{workflowStatus.totalSteps} 步骤
        </span>
        {currentStep && (
          <span className="workzone-content__current-step">
            {currentStep.description}
          </span>
        )}
      </div>

      {/* 步骤列表（简化版） */}
      <div className="workzone-content__steps">
        {workflow.steps.map((step) => (
          <div
            key={step.id}
            className={`workzone-content__step workzone-content__step--${step.status}`}
          >
            <span className="workzone-content__step-status">
              {step.status === 'running' ? (
                <span className="workzone-content__spinner" />
              ) : (
                STATUS_ICONS[step.status]
              )}
            </span>
            <span className="workzone-content__step-desc">
              {step.description}
            </span>
          </div>
        ))}
      </div>

      {/* 失败提示 + 重试按钮 */}
      {workflowStatus.status === 'failed' && (
        <div className="workzone-content__error">
          <GenerationFailureDetails details={failureDetails} />
          {canRetry && (
            <button
              type="button"
              className="workzone-content__retry-btn"
              disabled={isRetrying}
              onPointerDownCapture={stopWorkZonePressEvent}
              onPointerDown={stopWorkZonePressEvent}
              onPointerUp={stopWorkZonePressEvent}
              onMouseDownCapture={stopWorkZonePressEvent}
              onMouseDown={stopWorkZonePressEvent}
              onClick={(event) => {
                handleWorkZoneButtonClick(event);
                void handleRetry();
              }}
            >
              <RotateCcw size={12} />
              <span>{isRetrying ? '重试中...' : '从失败步骤重试'}</span>
            </button>
          )}
        </div>
      )}

      {/* 完成提示 */}
      {workflowStatus.status === 'completed' && (
        <div className="workzone-content__success">✨ 已完成</div>
      )}

      <ConfirmDialog
        open={showHideConfirm}
        title="隐藏进度卡片"
        description="确定不再显示进度卡片？\n\n任务仍会在后台执行，可在设置中恢复显示。"
        confirmText="确定"
        cancelText="取消"
        onOpenChange={setShowHideConfirm}
        onConfirm={handleHideConfirm}
      />
    </div>
  );
};

export default WorkZoneContent;
