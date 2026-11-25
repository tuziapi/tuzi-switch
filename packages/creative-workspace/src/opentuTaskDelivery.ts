import { invoke } from "@tauri-apps/api/core";
import { taskQueueService } from "../upstream/packages/drawnix/src/services/task-queue-service";
import { unifiedCacheService } from "../upstream/packages/drawnix/src/services/unified-cache-service";
import { fetchOutputMedia } from "../upstream/packages/drawnix/src/services/assistant-account";
import { isPublicHttpMediaUrl } from "../upstream/packages/drawnix/src/utils/virtual-media-url";
import {
  isUserVisibleTask,
  type Task,
} from "../upstream/packages/drawnix/src/types/shared/core.types";

export const jsonResult = (data: unknown) => ({
  isError: false,
  content: [{ type: "text", text: JSON.stringify(data) }],
  structuredContent: { data },
});

export function publicTask(task: Task, includeText = true) {
  const terminal = ["completed", "failed", "cancelled"].includes(task.status);
  const result = task.result;
  // Inline data URLs and unbounded provider arrays must not exceed the 4 MiB
  // connector response budget. Originals are available through result export.
  const publicUrl = (url: string | undefined) =>
    url && url.length <= 1024 && !url.startsWith("data:") ? url : undefined;
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    progress: task.progress,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    remoteId: typeof task.remoteId === "string" && /^[A-Za-z0-9_.-]{1,200}$/.test(task.remoteId) ? task.remoteId : undefined,
    model: task.params.model,
    prompt: task.params.prompt?.slice(0, 1000),
    requested: {
      size: task.params.size,
      duration: task.params.duration,
      insertToCanvas: task.params.autoInsertToCanvas,
    },
    insertedToCanvas: task.insertedToCanvas === true,
    error: task.error
      ? {
          code: task.error.code,
          message: "任务失败，请在助手任务详情查看原因；不会自动重新生成。",
        }
      : undefined,
    result: result
      ? {
          url: publicUrl(result.url),
          urls: result.urls?.slice(0, 5).map(publicUrl).filter(Boolean),
          outputCount: result.urls?.length || (result.url ? 1 : 0),
          format: result.format,
          width: result.width,
          height: result.height,
          duration: result.duration,
          size: result.size,
          chatResponse: includeText
            ? result.chatResponse?.slice(0, 20000)
            : undefined,
          lyricsText: includeText
            ? result.lyricsText?.slice(0, 20000)
            : undefined,
          resultKind: result.resultKind,
        }
      : undefined,
    pollAfterMs: terminal ? null : 5000,
    nextAction:
      task.status === "completed" &&
      ["image", "video", "audio"].includes(task.type)
        ? "opentu_get_task_result"
        : task.status === "completed"
          ? "read_result"
          : terminal
            ? "inspect_in_assistant"
            : "opentu_get_task",
  };
}

export function visibleTask(id: unknown): Task {
  if (typeof id !== "string" || !id || id.length > 200)
    throw new Error("taskId 无效");
  const task = taskQueueService.getTask(id);
  if (!task || !isUserVisibleTask(task))
    throw new Error("找不到该 OpenTu 任务");
  return task;
}

export async function queryTask(
  args: Record<string, unknown>,
  assertActive: () => void,
) {
  const waitMs = args.waitMs ?? 0;
  if (!Number.isInteger(waitMs) || Number(waitMs) < 0 || Number(waitMs) > 20000)
    throw new Error("waitMs 必须为 0–20000 毫秒");
  const deadline = Date.now() + Number(waitMs);
  let task = visibleTask(args.taskId);
  while (
    ["pending", "processing"].includes(task.status) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(500, deadline - Date.now())),
    );
    assertActive();
    task = visibleTask(args.taskId);
  }
  // Video executors persist acceptance before their long-running poll resolves;
  // the live queue may not yet contain that remote ID. Read acceptance metadata
  // without replacing live status or exposing the persisted invocation route.
  if (task.type === "video" && task.status === "processing" && !task.remoteId) {
    const token = taskQueueService.getTaskExecutionToken(task.id);
    const stored = await taskQueueService.getCompleteTask(task.id);
    assertActive();
    task = visibleTask(args.taskId);
    if (stored?.remoteId && token && taskQueueService.isTaskExecutionTokenCurrent(task.id, token)) {
      return jsonResult(publicTask({ ...task, remoteId: task.remoteId || stored.remoteId }));
    }
  }
  return jsonResult(publicTask(task));
}

export function listTasks(args: Record<string, unknown>) {
  const limit = args.limit ?? 10;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50)
    throw new Error("limit 必须为 1–50");
  if (
    args.type !== undefined &&
    (typeof args.type !== "string" ||
      !["image", "video", "audio", "text"].includes(args.type))
  )
    throw new Error("任务类型无效");
  if (
    args.status !== undefined &&
    (typeof args.status !== "string" ||
      !["pending", "processing", "completed", "failed", "cancelled"].includes(
        args.status,
      ))
  )
    throw new Error("任务状态无效");
  return jsonResult({
    tasks: taskQueueService
      .getAllTasks()
      .filter(
        (task) =>
          isUserVisibleTask(task) &&
          (!args.type ||
            task.type === (args.type === "text" ? "chat" : args.type)) &&
          (!args.status || task.status === args.status),
      )
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
      .slice(0, Number(limit))
      .map((task) => publicTask(task, false)),
    instruction:
      "查到已有任务后使用 taskId 续查；不要因为等待或响应丢失而重新生成。",
  });
}

const MAX_BYTES = 128 * 1024 * 1024;
async function resultBytes(url: string): Promise<Uint8Array> {
  const cached = await unifiedCacheService.getCachedBlob(url, {
    allowNetwork: false,
  });
  if (cached) {
    if (!cached.size || cached.size > MAX_BYTES)
      throw new Error("结果为空或超过 128 MB");
    return new Uint8Array(await cached.arrayBuffer());
  }
  if (!isPublicHttpMediaUrl(url))
    throw new Error("本地媒体缓存暂不可用，请保留任务编号并稍后重试获取结果");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetchOutputMedia(url, controller.signal);
    if (!response.ok || !response.body)
      throw new Error("无法读取已生成的媒体，请稍后重试获取结果");
    if (Number(response.headers.get("content-length")) > MAX_BYTES) {
      await response.body.cancel();
      throw new Error("结果超过 128 MB");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BYTES) throw new Error("结果超过 128 MB");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

export async function deliverTaskResult(
  args: Record<string, unknown>,
  assertActive: () => void,
) {
  const task = visibleTask(args.taskId);
  if (task.status !== "completed" || !task.result)
    throw new Error("任务尚未完成，请继续查询原任务，不要重新生成");
  if (!["image", "video", "audio"].includes(task.type))
    throw new Error("该任务不是可导出的图片、视频或音频");
  const urls = task.result.urls?.length ? task.result.urls : [task.result.url];
  const index = args.index ?? 0;
  if (
    !Number.isInteger(index) ||
    Number(index) < 0 ||
    Number(index) >= urls.length
  )
    throw new Error("结果索引无效");
  const bytes = await resultBytes(urls[Number(index)]);
  assertActive();
  const exported = await invoke<{
    path: string;
    mimeType: string;
    bytes: number;
    preview?: string;
  }>("creative_export_mcp_media", bytes, {
    headers: { "x-media-kind": task.type },
  });
  const data = {
    taskId: task.id,
    index,
    outputCount: urls.length,
    path: exported.path,
    mimeType: exported.mimeType,
    bytes: exported.bytes,
    insertedToCanvas: task.insertedToCanvas === true,
    display:
      "在支持本机文件的客户端使用此绝对路径展示媒体。图片预览已随工具返回；原图/视频为本机文件。远程客户端不能访问本机路径。",
  };
  const response = jsonResult(data);
  return {
    ...response,
    content: [
      ...response.content,
      ...(exported.preview
        ? [{ type: "image", data: exported.preview, mimeType: "image/jpeg" }]
        : []),
    ],
  };
}
