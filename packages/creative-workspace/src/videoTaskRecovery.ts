import { taskQueueService } from "../upstream/packages/drawnix/src/services/task-queue-service";
import { fallbackMediaExecutor } from "../upstream/packages/drawnix/src/services/media-executor/fallback-executor";
import { settingsManager, resolveInvocationRoute } from "../upstream/packages/drawnix/src/utils/settings-manager";
import { resolveLegacyTaskInvocationRouteModel } from "../upstream/packages/drawnix/src/services/task-invocation-route";
import { isPptExplainerTask } from "../upstream/packages/drawnix/src/services/ppt-explainer/validation";
import { ASSISTANT_ACCOUNT_CHANGED, getAssistantAccount, isAccountReference } from "../upstream/packages/drawnix/src/services/assistant-account";

/** Recover accepted jobs for the host lifetime, including late workflow restores. */
export function startVideoTaskRecovery(): () => void {
  let disposed = false;
  let ready = false;
  const managed = new Set<string>();
  const scan = () => {
    if (disposed || !ready) return;
    const tasks = taskQueueService.getAllTasks().filter(task => {
      if (task.type !== "video" || task.status !== "processing" || !task.remoteId ||
          isPptExplainerTask(task) || taskQueueService.isTaskExecutionActive(task.id)) return false;
      try {
        const route = resolveInvocationRoute("video", resolveLegacyTaskInvocationRouteModel("video", task));
        return !isAccountReference(route.apiKey) || getAssistantAccount()?.state.status === "connected";
      } catch { return false; }
    });
    if (!tasks.length) return;
    for (const task of tasks) managed.add(task.id);
    // This entry point only polls stored remote IDs. It never creates/retries jobs.
    void fallbackMediaExecutor.resumePendingTasks(
      (id, status, updates) => { if (!disposed) taskQueueService.updateTaskStatus(id, status, updates); },
      tasks,
      id => {
        const token = taskQueueService.getTaskExecutionToken(id);
        return () => !disposed && Boolean(token && taskQueueService.isTaskExecutionTokenCurrent(id, token));
      },
    ).catch(() => { /* The executor records per-task failures without resubmission. */ });
  };
  const subscription = taskQueueService.observeTaskUpdates().subscribe(event => {
    if (event.type === "taskDeleted") {
      if (managed.delete(event.task.id)) fallbackMediaExecutor.cancelPendingTask(event.task.id);
    } else {
      // restoreTasks emits one representative event for the entire batch; its
      // first task may be an image while later tasks are resumable videos.
      scan();
    }
  });
  window.addEventListener(ASSISTANT_ACCOUNT_CHANGED, scan);
  void settingsManager.waitForInitialization().then(() => { ready = true; scan(); }).catch(() => undefined);
  return () => {
    disposed = true;
    subscription.unsubscribe();
    window.removeEventListener(ASSISTANT_ACCOUNT_CHANGED, scan);
    for (const id of managed) fallbackMediaExecutor.cancelPendingTask(id);
  };
}
