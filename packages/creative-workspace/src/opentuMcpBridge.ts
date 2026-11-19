import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  mcpRegistry,
  initializeMCP,
} from "../upstream/packages/drawnix/src/mcp";
import { getCanvasBoardBinding } from "../upstream/packages/drawnix/src/services/canvas-operations/canvas-board-ref";
import {
  executeCanvasEdits,
  snapshotCanvas,
  validateCanvasPlan,
} from "../upstream/packages/drawnix/src/services/text-chat/canvas-control";
import { getConfiguredSelectableModels } from "../upstream/packages/drawnix/src/utils/runtime-model-discovery";
import type { ModelType } from "../upstream/packages/drawnix/src/constants/model-config";
import { workspaceService } from "../upstream/packages/drawnix/src/services/workspace-service";
import { taskQueueService } from "../upstream/packages/drawnix/src/services/task-queue-service";
import type { MCPResult } from "../upstream/packages/drawnix/src/mcp/types";

interface McpCallPayload {
  requestId: string;
  name: string;
  arguments?: Record<string, unknown>;
  expiresAt: number;
}

let unlisten: UnlistenFn | null = null;
let starting: Promise<void> | null = null;

function resultToMcp(result: MCPResult): Record<string, unknown> {
  const text = result.success
    ? typeof result.data === "string"
      ? result.data
      : JSON.stringify(result.data ?? { success: true })
    : result.error || "OpenTu 工具执行失败";
  return {
    isError: !result.success,
    content: [{ type: "text", text }],
    ...(result.type
      ? { structuredContent: { type: result.type, data: result.data } }
      : {}),
  };
}

function errorResult(error: unknown): Record<string, unknown> {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text:
          error instanceof Error
            ? error.message
            : String(error || "OpenTu 处理失败"),
      },
    ],
  };
}

export async function handleOpenTuMcpCall(
  payload: McpCallPayload,
): Promise<Record<string, unknown>> {
  const assertActive = () => {
    if (
      !Number.isFinite(payload.expiresAt) ||
      Date.now() >= payload.expiresAt
    ) {
      throw new Error("OpenTu 请求已过期，请重新发起。");
    }
  };
  assertActive();
  const args = payload.arguments || {};
  if (typeof args !== "object" || Array.isArray(args))
    throw new Error("工具参数必须是对象");
  initializeMCP();

  if (payload.name === "opentu_list_models") {
    return {
      isError: false,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            providerCredentials: "由 OpenTu 本地配置管理，未返回密钥",
            registeredTools: mcpRegistry.getToolNames(),
            currentBoardId: workspaceService.getState().currentBoardId,
            models: (["image", "video", "audio", "text"] as const).flatMap(
              (type) =>
                getConfiguredSelectableModels(type).map((model) => ({
                  id: model.id,
                  label: model.label,
                  type,
                  modelRef: {
                    modelId: model.id,
                    profileId: model.sourceProfileId || null,
                  },
                })),
            ),
          }),
        },
      ],
    };
  }

  if (payload.name === "opentu_get_canvas") {
    const boardId = workspaceService.getState().currentBoardId;
    if (!boardId || !getCanvasBoardBinding()) {
      return errorResult(new Error("当前没有打开画布"));
    }
    const snapshot = snapshotCanvas(boardId);
    return {
      isError: false,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            boardId,
            revision: snapshot.revision,
            elements: snapshot.elements,
          }),
        },
      ],
    };
  }

  if (payload.name === "opentu_get_task") {
    const taskId = typeof args.taskId === "string" ? args.taskId : "";
    const task = taskId ? taskQueueService.getTask(taskId) : undefined;
    if (!task) return errorResult(new Error("找不到该 OpenTu 任务"));
    return {
      isError: false,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            id: task.id,
            type: task.type,
            status: task.status,
            progress: task.progress,
            error: task.error,
            result: task.result,
          }),
        },
      ],
    };
  }

  if (payload.name === "opentu_apply_canvas_edit") {
    const plan = args.plan;
    if (!plan || typeof plan !== "object")
      return errorResult(new Error("缺少画布编辑计划"));
    validateCanvasPlan(plan);
    const destructive = plan.actions.filter(
      (action) => action.op === "delete" || action.op === "replace",
    );
    if (destructive.length) {
      if (args.confirmed !== true)
        return errorResult(new Error("删除或替换操作需要明确确认后才能执行"));
      // A model-generated boolean is not evidence of human approval. Confirm
      // in the owning desktop application and recheck expiry/revision afterwards.
      const accepted = await ask(
        `外部 MCP 客户端请求修改画板 ${plan.boardId}：\n${destructive.map((action) => `${action.op === "delete" ? "删除" : "替换"}：${action.ids.join("、")}`).join("\n")}\n确认后执行整批 ${plan.actions.length} 项操作，可在画布撤销。`,
        {
          title: "确认 OpenTu 画布修改",
          kind: "warning",
          okLabel: "确认修改",
          cancelLabel: "取消",
        },
      );
      assertActive();
      if (!accepted)
        return errorResult(new Error("用户取消了画布修改，本次未执行"));
    }
    assertActive();
    const message = executeCanvasEdits(plan);
    return {
      isError: false,
      content: [{ type: "text", text: message }],
    };
  }

  const toolName = {
    opentu_create_image: "generate_image",
    opentu_create_video: "generate_video",
    opentu_create_audio: "generate_audio",
    opentu_create_text: "generate_text",
  }[payload.name];
  if (toolName) {
    const allowed = new Set([
      "prompt",
      "model",
      "modelRef",
      "size",
      "insertToCanvas",
    ]);
    if (Object.keys(args).some((key) => !allowed.has(key)))
      throw new Error("包含未支持的创作参数");
    if (
      typeof args.prompt !== "string" ||
      !args.prompt.trim() ||
      args.prompt.length > 20000
    )
      throw new Error("请提供有效的创作提示词");
    if (
      args.insertToCanvas !== undefined &&
      typeof args.insertToCanvas !== "boolean"
    )
      throw new Error("insertToCanvas 必须是布尔值");
    if (
      args.size !== undefined &&
      (payload.name !== "opentu_create_image" || typeof args.size !== "string")
    )
      throw new Error("尺寸参数无效");
    const type = payload.name.slice("opentu_create_".length) as ModelType;
    const toolArgs: Record<string, unknown> = {
      prompt: args.prompt,
      autoInsertToCanvas: args.insertToCanvas ?? false,
    };
    if (args.size !== undefined) toolArgs.size = args.size;
    if (args.model !== undefined || args.modelRef !== undefined) {
      const ref = args.modelRef as
        | { modelId?: unknown; profileId?: unknown }
        | undefined;
      if (
        ref !== undefined &&
        (!ref ||
          typeof ref !== "object" ||
          Array.isArray(ref) ||
          typeof ref.modelId !== "string" ||
          !(ref.profileId === null || typeof ref.profileId === "string"))
      )
        throw new Error("模型来源参数无效");
      const modelId = args.model ?? ref?.modelId;
      if (
        typeof modelId !== "string" ||
        !modelId ||
        (ref && ref.modelId !== modelId)
      )
        throw new Error("模型 ID 与来源不一致");
      const matches = getConfiguredSelectableModels(type).filter(
        (model) =>
          model.id === modelId &&
          (!ref || (model.sourceProfileId || null) === ref.profileId),
      );
      if (matches.length !== 1)
        throw new Error(
          "模型不可用或存在多个来源，请先列出模型并指定 modelRef",
        );
      toolArgs.model = matches[0].id;
      toolArgs.modelRef = {
        modelId: matches[0].id,
        profileId: matches[0].sourceProfileId || null,
      };
    }
    if (toolArgs.autoInsertToCanvas && !getCanvasBoardBinding())
      throw new Error("请先打开目标画布");
    assertActive();
    const result = await mcpRegistry.executeTool(
      { name: toolName, arguments: toolArgs },
      { mode: "queue" },
    );
    return resultToMcp(result);
  }

  if (payload.name === "opentu_insert_to_canvas") {
    return resultToMcp(
      await mcpRegistry.executeTool({
        name: "insert_to_canvas",
        arguments: args,
      }),
    );
  }
  return errorResult(new Error(`未支持的 OpenTu 工具：${payload.name}`));
}

export async function startOpenTuMcpBridge(): Promise<void> {
  if (unlisten || starting) return starting || Promise.resolve();
  if (!(window as any).__TAURI_INTERNALS__) return;
  starting = listen<McpCallPayload>("opentu-mcp-call", async (event) => {
    let result: Record<string, unknown>;
    try {
      result = await handleOpenTuMcpCall(event.payload);
    } catch (error) {
      result = errorResult(error);
    }
    try {
      await invoke("opentu_mcp_respond", {
        requestId: event.payload.requestId,
        result,
      });
    } catch (error) {
      console.error("[OpenTu MCP] failed to respond to request", error);
    }
  })
    .then((off) => {
      unlisten = off;
      return invoke("opentu_mcp_set_ready", { ready: true }).catch((error) => {
        off();
        unlisten = null;
        throw error;
      });
    })
    .finally(() => {
      starting = null;
    });
  return starting;
}

export async function stopOpenTuMcpBridge(): Promise<void> {
  if (starting) await starting.catch(() => undefined);
  if (unlisten) {
    await invoke("opentu_mcp_set_ready", { ready: false });
    unlisten();
    unlisten = null;
  }
}
