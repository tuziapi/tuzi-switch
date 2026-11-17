import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { mcpRegistry, initializeMCP } from '../upstream/packages/drawnix/src/mcp';
import { getCanvasBoardBinding } from '../upstream/packages/drawnix/src/services/canvas-operations/canvas-board-ref';
import {
  executeCanvasEdits,
  snapshotCanvas,
} from '../upstream/packages/drawnix/src/services/text-chat/canvas-control';
import { workspaceService } from '../upstream/packages/drawnix/src/services/workspace-service';
import { taskQueueService } from '../upstream/packages/drawnix/src/services/task-queue-service';
import type { MCPResult } from '../upstream/packages/drawnix/src/mcp/types';

interface McpCallPayload {
  requestId: string;
  name: string;
  arguments?: Record<string, unknown>;
}

let unlisten: UnlistenFn | null = null;
let starting: Promise<void> | null = null;

function resultToMcp(result: MCPResult): Record<string, unknown> {
  const text = result.success
    ? typeof result.data === 'string'
      ? result.data
      : JSON.stringify(result.data ?? { success: true })
    : result.error || 'OpenTu 工具执行失败';
  return {
    isError: !result.success,
    content: [{ type: 'text', text }],
    ...(result.type ? { structuredContent: { type: result.type, data: result.data } } : {}),
  };
}

function errorResult(error: unknown): Record<string, unknown> {
  return {
    isError: true,
    content: [{
      type: 'text',
      text: error instanceof Error ? error.message : String(error || 'OpenTu 处理失败'),
    }],
  };
}

async function handleCall(payload: McpCallPayload): Promise<Record<string, unknown>> {
  const args = payload.arguments || {};
  initializeMCP();

  if (payload.name === 'opentu_list_models') {
    return {
      isError: false,
      content: [{
        type: 'text',
        text: JSON.stringify({
          providerCredentials: '由 OpenTu 本地配置管理，未返回密钥',
          registeredTools: mcpRegistry.getToolNames(),
          currentBoardId: workspaceService.getState().currentBoardId,
        }),
      }],
    };
  }

  if (payload.name === 'opentu_get_canvas') {
    const boardId = workspaceService.getState().currentBoardId;
    if (!boardId || !getCanvasBoardBinding()) {
      return errorResult(new Error('当前没有打开画布'));
    }
    const snapshot = snapshotCanvas(boardId);
    return {
      isError: false,
      content: [{ type: 'text', text: JSON.stringify({ boardId, revision: snapshot.revision, elements: snapshot.elements }) }],
    };
  }

  if (payload.name === 'opentu_get_task') {
    const taskId = typeof args.taskId === 'string' ? args.taskId : '';
    const task = taskId ? taskQueueService.getTask(taskId) : undefined;
    if (!task) return errorResult(new Error('找不到该 OpenTu 任务'));
    return {
      isError: false,
      content: [{ type: 'text', text: JSON.stringify({
        id: task.id,
        type: task.type,
        status: task.status,
        progress: task.progress,
        error: task.error,
        result: task.result,
      }) }],
    };
  }

  if (payload.name === 'opentu_apply_canvas_edit') {
    const plan = args.plan;
    if (!plan || typeof plan !== 'object') return errorResult(new Error('缺少画布编辑计划'));
    const confirmed = args.confirmed === true;
    const actions = Array.isArray((plan as Record<string, unknown>).actions)
      ? (plan as Record<string, unknown>).actions as Array<Record<string, unknown>>
      : [];
    if (actions.some((action) => action.op === 'delete' || action.op === 'replace') && !confirmed) {
      return errorResult(new Error('删除或替换操作需要明确确认后才能执行'));
    }
    executeCanvasEdits(plan as never);
    return {
      isError: false,
      content: [{ type: 'text', text: '画布编辑已执行，可使用画布撤销恢复。' }],
    };
  }

  const toolName = {
    opentu_create_image: 'generate_image',
    opentu_create_video: 'generate_video',
    opentu_create_audio: 'generate_audio',
    opentu_create_text: 'generate_text',
  }[payload.name];
  if (toolName) {
    const toolArgs = { ...args, ...(typeof args.insertToCanvas === 'boolean' ? { autoInsertToCanvas: args.insertToCanvas } : {}) };
    delete toolArgs.insertToCanvas;
    const result = await mcpRegistry.executeTool({ name: toolName, arguments: toolArgs }, { mode: 'queue' });
    return resultToMcp(result);
  }

  if (payload.name === 'opentu_insert_to_canvas') {
    return resultToMcp(await mcpRegistry.executeTool({ name: 'insert_to_canvas', arguments: args }));
  }
  return errorResult(new Error(`未支持的 OpenTu 工具：${payload.name}`));
}

export async function startOpenTuMcpBridge(): Promise<void> {
  if (unlisten || starting) return starting || Promise.resolve();
  if (!(window as any).__TUZI_CREATIVE_NATIVE__) return;
  starting = listen<McpCallPayload>('opentu-mcp-call', async (event) => {
    let result: Record<string, unknown>;
    try {
      result = await handleCall(event.payload);
    } catch (error) {
      result = errorResult(error);
    }
    try {
      await invoke('opentu_mcp_respond', { requestId: event.payload.requestId, result });
    } catch (error) {
      console.error('[OpenTu MCP] failed to respond to request', error);
    }
  }).then((off) => {
    unlisten = off;
  }).finally(() => {
    starting = null;
  });
  return starting;
}

export async function stopOpenTuMcpBridge(): Promise<void> {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}
