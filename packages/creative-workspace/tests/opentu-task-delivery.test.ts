import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  complete: vi.fn(),
  token: vi.fn(),
  current: vi.fn(),
  all: vi.fn(),
  cached: vi.fn(),
  fetch: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../upstream/packages/drawnix/src/services/task-queue-service", () => ({
  taskQueueService: { getTask: mocks.get, getAllTasks: mocks.all, getCompleteTask: mocks.complete, getTaskExecutionToken: mocks.token, isTaskExecutionTokenCurrent: mocks.current },
}));
vi.mock(
  "../upstream/packages/drawnix/src/services/unified-cache-service",
  () => ({ unifiedCacheService: { getCachedBlob: mocks.cached } }),
);
vi.mock("../upstream/packages/drawnix/src/services/assistant-account", () => ({
  fetchOutputMedia: mocks.fetch,
}));
import {
  deliverTaskResult,
  listTasks,
  publicTask,
  queryTask,
} from "../src/opentuTaskDelivery";

const task = (overrides = {}): any => ({
  id: "synthetic-task",
  type: "video",
  status: "completed",
  createdAt: 12,
  updatedAt: 15,
  params: {
    model: "MiniMax-H3",
    prompt: "synthetic",
    duration: 4,
    size: "768P",
    apiKey: "SYNTHETIC-SECRET",
  },
  result: {
    url: "/__aitu_cache__/synthetic.mp4",
    format: "mp4",
    size: 4,
    duration: 4,
  },
  invocationRoute: { token: "SYNTHETIC-SECRET" },
  insertedToCanvas: true,
  ...overrides,
});
const data = (value: any) => JSON.parse(value.content[0].text);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockReturnValue(task());
  mocks.all.mockReturnValue([task()]);
  mocks.complete.mockResolvedValue(undefined);
  mocks.token.mockReturnValue(Symbol('synthetic-execution'));
  mocks.current.mockReturnValue(true);
  mocks.cached.mockResolvedValue({
    size: 4,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  });
  mocks.invoke.mockResolvedValue({
    path: "/synthetic/results/video.mp4",
    mimeType: "video/mp4",
    bytes: 4,
  });
});
afterEach(() => {
  vi.useRealTimers();
});

it("projects task state separately from insertion and omits route credentials", () => {
  const result = publicTask(
    task({
      insertedToCanvas: false,
      error: { code: "TEST", message: "SYNTHETIC-SECRET" },
    }),
  );
  expect(result).toMatchObject({
    status: "completed",
    insertedToCanvas: false,
    requested: { duration: 4 },
    nextAction: "opentu_get_task_result",
  });
  expect(JSON.stringify(result)).not.toContain("SYNTHETIC-SECRET");
});

it("exposes a recoverable remote task ID but excludes malformed or oversized values", () => {
  expect(publicTask(task({ remoteId: "task_existing" })).remoteId).toBe("task_existing");
  expect(publicTask(task({ remoteId: "https://example.invalid/private?token=synthetic" })).remoteId).toBeUndefined();
  expect(publicTask(task({ remoteId: "x".repeat(201) })).remoteId).toBeUndefined();
});

it("recovers most recent matching visible tasks with a bounded limit", () => {
  mocks.all.mockReturnValue([
    task(),
    task({ id: "new", createdAt: 20 }),
    task({ id: "internal", params: { resultVisibility: "internal" } }),
  ]);
  expect(
    data(listTasks({ type: "video", limit: 1 })).tasks.map((t: any) => t.id),
  ).toEqual(["new"]);
  expect(() => listTasks({ limit: 51 })).toThrow();
  expect(() => listTasks({ status: "unknown" })).toThrow();
});

it("reports persisted video acceptance before polling completes without replacing live status", async () => {
  mocks.get.mockReturnValue(task({ status: "processing", progress: 10, result: undefined }));
  mocks.complete.mockResolvedValue(task({ remoteId: "task_accepted", status: "completed" }));
  const result = data(await queryTask({ taskId: "synthetic-task" }, () => {}));
  expect(result).toMatchObject({ remoteId: "task_accepted", status: "processing", progress: 10 });
  expect(result.result).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("SYNTHETIC-SECRET");
});

it("does not attach an older persisted remote ID after the execution changes", async () => {
  mocks.get.mockReturnValue(task({ status: "processing", result: undefined }));
  mocks.complete.mockResolvedValue(task({ remoteId: "task_old" }));
  mocks.current.mockReturnValue(false);
  expect(data(await queryTask({ taskId: "synthetic-task" }, () => {})).remoteId).toBeUndefined();
});

it("waits for the existing task without creating or retrying it", async () => {
  vi.useFakeTimers();
  mocks.get
    .mockReturnValueOnce(task({ status: "processing", result: undefined }))
    .mockReturnValue(task());
  const result = queryTask(
    { taskId: "synthetic-task", waitMs: 1000 },
    () => {},
  );
  await vi.advanceTimersByTimeAsync(500);
  expect(data(await result).status).toBe("completed");
});

it("honors request expiry during bounded waiting", async () => {
  vi.useFakeTimers();
  mocks.get.mockReturnValue(task({ status: "processing" }));
  const result = queryTask({ taskId: "synthetic-task", waitMs: 1000 }, () => {
    throw new Error("expired");
  });
  const rejection = expect(result).rejects.toThrow("expired");
  await vi.advanceTimersByTimeAsync(500);
  await rejection;
});

it("exports only a completed task cache to native bytes and returns the original local path", async () => {
  const result = await deliverTaskResult(
    { taskId: "synthetic-task" },
    () => {},
  );
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledWith(
    "creative_export_mcp_media",
    new Uint8Array([1, 2, 3, 4]),
    { headers: { "x-media-kind": "video" } },
  );
  expect(data(result)).toMatchObject({
    path: "/synthetic/results/video.mp4",
    insertedToCanvas: true,
    outputCount: 1,
  });
});

it("returns a bounded native image preview plus the original image path", async () => {
  mocks.get.mockReturnValue(task({ type: "image" }));
  mocks.invoke.mockResolvedValue({
    path: "/synthetic/image.png",
    mimeType: "image/png",
    bytes: 4,
    preview: "synthetic-jpeg",
  });
  const result = await deliverTaskResult(
    { taskId: "synthetic-task" },
    () => {},
  );
  expect(result.content[1]).toEqual({
    type: "image",
    data: "synthetic-jpeg",
    mimeType: "image/jpeg",
  });
});

it("reports multiple provider outputs and exports only the explicitly selected output", async () => {
  mocks.get.mockReturnValue(task({ result: { urls: ["/a", "/b"] } }));
  expect(
    data(
      await deliverTaskResult({ taskId: "synthetic-task", index: 1 }, () => {}),
    ).outputCount,
  ).toBe(2);
  expect(mocks.cached).toHaveBeenCalledWith("/b", { allowNetwork: false });
  await expect(
    deliverTaskResult({ taskId: "synthetic-task", index: 2 }, () => {}),
  ).rejects.toThrow("索引");
});

it("never falls back to fetching a missing virtual cache or arbitrary filesystem path", async () => {
  mocks.cached.mockResolvedValue(null);
  await expect(
    deliverTaskResult({ taskId: "synthetic-task" }, () => {}),
  ).rejects.toThrow("缓存");
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("does not export pending, internal or oversize results", async () => {
  mocks.get.mockReturnValue(task({ status: "processing" }));
  await expect(
    deliverTaskResult({ taskId: "synthetic-task" }, () => {}),
  ).rejects.toThrow("尚未完成");
  mocks.get.mockReturnValue(task({ params: { resultVisibility: "internal" } }));
  await expect(
    deliverTaskResult({ taskId: "synthetic-task" }, () => {}),
  ).rejects.toThrow("找不到");
  mocks.get.mockReturnValue(task());
  mocks.cached.mockResolvedValue({ size: 129 * 1024 * 1024 });
  await expect(
    deliverTaskResult({ taskId: "synthetic-task" }, () => {}),
  ).rejects.toThrow("128 MB");
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("keeps text results readable and maps the public text filter to chat tasks", async () => {
  mocks.get.mockReturnValue(
    task({ type: "chat", result: { chatResponse: "synthetic response" } }),
  );
  mocks.all.mockReturnValue([mocks.get()]);
  expect(data(listTasks({ type: "text" })).tasks).toHaveLength(1);
  expect(
    data(await queryTask({ taskId: "synthetic-task" }, () => {})),
  ).toMatchObject({
    result: { chatResponse: "synthetic response" },
    nextAction: "read_result",
  });
});

it("bounds long inline provider results and large recent-task projections", () => {
  const result = {
    url: `data:image/png;base64,${"A".repeat(5000000)}`,
    urls: Array.from(
      { length: 100 },
      () => "https://example.com/" + "图".repeat(900),
    ),
    chatResponse: "文".repeat(1000000),
  };
  mocks.all.mockReturnValue(
    Array.from({ length: 50 }, (_, index) =>
      task({ id: String(index), result }),
    ),
  );
  const response = listTasks({ limit: 50 });
  expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(
    4 * 1024 * 1024,
  );
  expect(data(response).tasks[0].result).toMatchObject({ outputCount: 100 });
  expect(data(response).tasks[0].result.url).toBeUndefined();
});
