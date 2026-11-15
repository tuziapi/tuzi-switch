import { useEffect } from 'react';
import { taskQueueService } from '../../../services/task-queue';
import { TaskStatus, type Task } from '../../../types/task.types';
import type {
  WorkflowRecordBase,
  WorkflowSyncRecordResult,
} from './useWorkflowRecords';

export interface UseWorkflowTaskSyncOptions<
  TRecord extends WorkflowRecordBase,
  TTask extends Task = Task
> {
  syncTask: (
    task: TTask
  ) => Promise<WorkflowSyncRecordResult<TRecord> | null | undefined>;
  applySyncedRecord: (synced: WorkflowSyncRecordResult<TRecord>) => void;
  shouldHandleTask?: (task: Task) => task is TTask;
  logPrefix?: string;
}

function isCompletedTask(task: Task): task is Task {
  return task.status === TaskStatus.COMPLETED;
}

export function useWorkflowTaskSync<
  TRecord extends WorkflowRecordBase,
  TTask extends Task = Task
>({
  syncTask,
  applySyncedRecord,
  shouldHandleTask = isCompletedTask as (task: Task) => task is TTask,
  logPrefix = '[WorkflowTaskSync]',
}: UseWorkflowTaskSyncOptions<TRecord, TTask>): void {
  useEffect(() => {
    let disposed = false;
    const syncingTaskIds = new Set<string>();

    const runSync = async (task: Task) => {
      if (!shouldHandleTask(task) || syncingTaskIds.has(task.id)) {
        return;
      }

      syncingTaskIds.add(task.id);
      try {
        const synced = await syncTask(task);
        if (!synced || disposed) {
          return;
        }
        applySyncedRecord(synced);
      } catch (error) {
        console.error(`${logPrefix} Failed to sync task result:`, error);
      } finally {
        syncingTaskIds.delete(task.id);
      }
    };

    taskQueueService.getAllTasks().forEach((task) => {
      void runSync(task);
    });

    const subscription = taskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
        void runSync(event.task);
      });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, [applySyncedRecord, logPrefix, shouldHandleTask, syncTask]);
}
