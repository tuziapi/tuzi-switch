import type { WorkflowMessageData } from '../types/chat.types';
import { extractTaskIdFromStepResult } from './workflow-task-linking';

export type WorkflowBubbleStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

export interface WorkflowBubbleStatusResult {
  status: WorkflowBubbleStatus;
  totalSteps: number;
  completedSteps: number;
}

export function normalizeWorkflowStepsForDisplay(
  steps: WorkflowMessageData['steps']
): WorkflowMessageData['steps'] {
  return steps.map((step) => {
    const hasPendingTask = Boolean(extractTaskIdFromStepResult(step.result));
    const hasCompletedResult = step.result !== undefined && step.result !== null;
    const hasDuration = step.duration !== undefined;

    if (
      (step.status === 'running' || step.status === 'pending') &&
      !hasPendingTask
    ) {
      if (step.error) {
        return { ...step, status: 'failed' as const };
      }
      if (hasCompletedResult || hasDuration) {
        return { ...step, status: 'completed' as const };
      }
    }

    return step;
  });
}

export function getWorkflowBubbleStatus(
  steps: WorkflowMessageData['steps']
): WorkflowBubbleStatusResult {
  const totalSteps = steps.length;
  const completedSteps = steps.filter(
    (step) => step.status === 'completed'
  ).length;
  const failedSteps = steps.filter((step) => step.status === 'failed').length;
  const runningSteps = steps.filter((step) => step.status === 'running').length;

  let status: WorkflowBubbleStatus = 'pending';
  if (failedSteps > 0) {
    status = 'failed';
  } else if (completedSteps === totalSteps && totalSteps > 0) {
    status = 'completed';
  } else if (runningSteps > 0 || completedSteps > 0) {
    status = 'running';
  }

  return { status, totalSteps, completedSteps };
}
