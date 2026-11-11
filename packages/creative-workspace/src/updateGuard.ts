import { textChatRuntime } from "../upstream/packages/drawnix/src/services/text-chat/runtime";
import { hasActiveLLMTasks } from "../upstream/packages/drawnix/src/utils/active-tasks";
import { workspaceService } from "../upstream/packages/drawnix/src/services/workspace-service";
let runtimeReady = false;
export function setCreativeRuntimeReady(ready: boolean) {
  runtimeReady = ready;
}
const editorGuards = new Set<() => Promise<void>>();
export function registerEditorUpdateGuard(guard: () => Promise<void>) {
  editorGuards.add(guard);
  return () => {
    editorGuards.delete(guard);
  };
}
export async function prepareCreativeUpdate() {
  if (!runtimeReady) throw Error("创作任务仍在恢复，请稍后重试更新。");
  if (textChatRuntime.getSnapshot().running.size || (await hasActiveLLMTasks()))
    throw Error("还有生成任务正在运行或排队，请完成任务后再重启更新。");
  for (const guard of [...editorGuards]) await guard();
  await textChatRuntime.flush();
  await workspaceService.flushForAppUpdate();
  if (textChatRuntime.getSnapshot().running.size || (await hasActiveLLMTasks()))
    throw Error("还有生成任务正在运行，请稍后重试。");
}
