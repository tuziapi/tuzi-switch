import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  ask: vi.fn(),
  execute: vi.fn(),
  edits: vi.fn(),
  models: vi.fn(),
  board: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mocks.ask }));
vi.mock("../upstream/packages/drawnix/src/mcp", () => ({
  initializeMCP: vi.fn(),
  mcpRegistry: {
    getToolNames: () => ["generate_image"],
    executeTool: mocks.execute,
  },
}));
vi.mock(
  "../upstream/packages/drawnix/src/utils/runtime-model-discovery",
  () => ({ getConfiguredSelectableModels: mocks.models }),
);
vi.mock(
  "../upstream/packages/drawnix/src/services/canvas-operations/canvas-board-ref",
  () => ({ getCanvasBoardBinding: mocks.board }),
);
vi.mock(
  "../upstream/packages/drawnix/src/services/text-chat/canvas-control",
  async () => ({
    ...(await import(
      "../upstream/packages/drawnix/src/services/text-chat/canvas-schema"
    )),
    snapshotCanvas: () => ({ revision: "a".repeat(64), elements: [] }),
    executeCanvasEdits: mocks.edits,
  }),
);
vi.mock("../upstream/packages/drawnix/src/services/workspace-service", () => ({
  workspaceService: { getState: () => ({ currentBoardId: "synthetic-board" }) },
}));
vi.mock("../upstream/packages/drawnix/src/services/task-queue-service", () => ({
  taskQueueService: { getTask: () => undefined },
}));

import {
  handleOpenTuMcpCall,
  startOpenTuMcpBridge,
  stopOpenTuMcpBridge,
} from "../src/opentuMcpBridge";

const call = (name: string, args = {}, expiresAt = Date.now() + 120000) =>
  handleOpenTuMcpCall({
    name,
    arguments: args,
    expiresAt,
    requestId: "synthetic-request",
  });
const plan = (op = "delete") => ({
  version: 1,
  boardId: "synthetic-board",
  revision: "a".repeat(64),
  status: "ready",
  actions: [{ op, ids: ["synthetic-element"], dx: 10, dy: 20 }],
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockResolvedValue(undefined);
  mocks.models.mockImplementation((type) =>
    type === "image"
      ? [
          {
            id: "synthetic-image",
            label: "测试模型",
            type,
            sourceProfileId: "source-a",
            apiKey: "SYNTHETIC-SECRET",
          },
        ]
      : [],
  );
  mocks.execute.mockResolvedValue({
    success: true,
    type: "image",
    data: { taskId: "synthetic-task" },
  });
  mocks.board.mockReturnValue({ boardId: "synthetic-board" });
  mocks.edits.mockReturnValue("已执行");
  mocks.ask.mockResolvedValue(false);
});

it("lists selectable models using an explicit public projection, without provider secrets", async () => {
  const result = await call("opentu_list_models");
  const data = JSON.parse((result.content as any[])[0].text);
  expect(data.models).toEqual([
    {
      id: "synthetic-image",
      label: "测试模型",
      type: "image",
      modelRef: { modelId: "synthetic-image", profileId: "source-a" },
    },
  ]);
  expect(JSON.stringify(result)).not.toContain("SYNTHETIC-SECRET");
});

it("routes a selected model to the exact provider and defaults to no canvas insertion", async () => {
  await call("opentu_create_image", {
    prompt: "synthetic",
    modelRef: { modelId: "synthetic-image", profileId: "source-a" },
  });
  expect(mocks.execute).toHaveBeenCalledWith(
    {
      name: "generate_image",
      arguments: {
        prompt: "synthetic",
        model: "synthetic-image",
        modelRef: { modelId: "synthetic-image", profileId: "source-a" },
        autoInsertToCanvas: false,
      },
    },
    { mode: "queue" },
  );
});

it("rejects ambiguous model IDs before creating any task", async () => {
  mocks.models.mockReturnValue([
    { id: "same", sourceProfileId: "a" },
    { id: "same", sourceProfileId: "b" },
  ]);
  await expect(
    call("opentu_create_image", { prompt: "synthetic", model: "same" }),
  ).rejects.toThrow("多个来源");
  expect(mocks.execute).not.toHaveBeenCalled();
});

it("refuses unavailable provider references and mismatched model IDs", async () => {
  await expect(
    call("opentu_create_image", {
      prompt: "synthetic",
      modelRef: { modelId: "synthetic-image", profileId: "missing" },
    }),
  ).rejects.toThrow("模型不可用");
  await expect(
    call("opentu_create_image", {
      prompt: "synthetic",
      model: "other",
      modelRef: { modelId: "synthetic-image", profileId: "source-a" },
    }),
  ).rejects.toThrow("不一致");
  expect(mocks.execute).not.toHaveBeenCalled();
});

it.each(["replaceElementId", "count", "autoInsertToCanvas"])(
  "does not forward hidden %s arguments to the generation queue",
  async (field) => {
    await expect(
      call("opentu_create_image", {
        prompt: "synthetic",
        [field]: "unexpected",
      }),
    ).rejects.toThrow("未支持");
    expect(mocks.execute).not.toHaveBeenCalled();
  },
);

it("does not generate an auto-insert task without an open canvas", async () => {
  mocks.board.mockReturnValue(null);
  await expect(
    call("opentu_create_image", { prompt: "synthetic", insertToCanvas: true }),
  ).rejects.toThrow("打开目标画布");
  expect(mocks.execute).not.toHaveBeenCalled();
});

it("requires native human confirmation even if the external client claims confirmed=true", async () => {
  expect(
    await call("opentu_apply_canvas_edit", { plan: plan(), confirmed: true }),
  ).toMatchObject({ isError: true });
  expect(mocks.ask).toHaveBeenCalledOnce();
  expect(mocks.edits).not.toHaveBeenCalled();
});

it("only applies a destructive plan after native approval", async () => {
  mocks.ask.mockResolvedValue(true);
  expect(
    await call("opentu_apply_canvas_edit", { plan: plan(), confirmed: true }),
  ).toMatchObject({ isError: false });
  expect(mocks.edits).toHaveBeenCalledWith(plan());
});

it("does not execute a confirmation arriving after the MCP request expired", async () => {
  const expiresAt = Date.now() + 120000;
  mocks.ask.mockImplementation(async () => {
    vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1);
    return true;
  });
  try {
    await expect(
      call(
        "opentu_apply_canvas_edit",
        { plan: plan(), confirmed: true },
        expiresAt,
      ),
    ).rejects.toThrow("已过期");
    expect(mocks.edits).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});

it("validates complete edit plans and preserves non-destructive execution feedback", async () => {
  await expect(
    call("opentu_apply_canvas_edit", { plan: { actions: [] } }),
  ).rejects.toThrow("无效");
  mocks.edits.mockReturnValue("内容已完成；视口定位失败");
  expect(
    await call("opentu_apply_canvas_edit", { plan: plan("move") }),
  ).toMatchObject({ content: [{ text: "内容已完成；视口定位失败" }] });
  expect(mocks.ask).not.toHaveBeenCalled();
});

it("returns validation errors to the native request instead of letting them escape the event listener", async () => {
  (window as any).__TAURI_INTERNALS__ = {};
  let handler: any;
  mocks.listen.mockImplementation(async (_name, callback) => {
    handler = callback;
    return vi.fn();
  });
  await startOpenTuMcpBridge();
  try {
    expect(mocks.invoke).toHaveBeenCalledWith("opentu_mcp_set_ready", {
      ready: true,
    });
    await handler({
      payload: {
        requestId: "synthetic-expired",
        name: "opentu_create_image",
        arguments: { prompt: "synthetic" },
        expiresAt: 0,
      },
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "opentu_mcp_respond",
      expect.objectContaining({
        requestId: "synthetic-expired",
        result: expect.objectContaining({ isError: true }),
      }),
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  } finally {
    await stopOpenTuMcpBridge();
    expect(mocks.invoke).toHaveBeenCalledWith("opentu_mcp_set_ready", {
      ready: false,
    });
    delete (window as any).__TAURI_INTERNALS__;
  }
});

it("does not register a native listener in a browser-only workspace", async () => {
  delete (window as any).__TAURI_INTERNALS__;
  (window as any).__TUZI_CREATIVE_NATIVE__ = {};
  try {
    await startOpenTuMcpBridge();
    expect(mocks.listen).not.toHaveBeenCalled();
  } finally {
    delete (window as any).__TUZI_CREATIVE_NATIVE__;
  }
});

it("unregisters the listener if native readiness fails and can retry", async () => {
  (window as any).__TAURI_INTERNALS__ = {};
  const off = vi.fn();
  mocks.listen.mockResolvedValue(off);
  mocks.invoke.mockRejectedValueOnce(new Error("SYNTHETIC-not-ready"));
  try {
    await expect(startOpenTuMcpBridge()).rejects.toThrow("SYNTHETIC-not-ready");
    expect(off).toHaveBeenCalledOnce();
    await startOpenTuMcpBridge();
    expect(mocks.listen).toHaveBeenCalledTimes(2);
  } finally {
    await stopOpenTuMcpBridge();
    delete (window as any).__TAURI_INTERNALS__;
  }
});
