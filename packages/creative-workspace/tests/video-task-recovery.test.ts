import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ all: vi.fn(), active: vi.fn(), subscribe: vi.fn(), update: vi.fn(), token: vi.fn(), current: vi.fn(), resume: vi.fn(), cancel: vi.fn(), settings: vi.fn(), route: vi.fn(), account: vi.fn() }));
vi.mock("../upstream/packages/drawnix/src/services/task-queue-service", () => ({ taskQueueService: { getAllTasks: m.all, isTaskExecutionActive: m.active, observeTaskUpdates: () => ({ subscribe: m.subscribe }), updateTaskStatus: m.update, getTaskExecutionToken: m.token, isTaskExecutionTokenCurrent: m.current } }));
vi.mock("../upstream/packages/drawnix/src/services/media-executor/fallback-executor", () => ({ fallbackMediaExecutor: { resumePendingTasks: m.resume, cancelPendingTask: m.cancel } }));
vi.mock("../upstream/packages/drawnix/src/utils/settings-manager", () => ({ settingsManager: { waitForInitialization: m.settings }, resolveInvocationRoute: m.route }));
vi.mock("../upstream/packages/drawnix/src/services/task-invocation-route", () => ({ resolveLegacyTaskInvocationRouteModel: () => "MiniMax-H3" }));
vi.mock("../upstream/packages/drawnix/src/services/ppt-explainer/validation", () => ({ isPptExplainerTask: (task: any) => task.ppt === true }));
vi.mock("../upstream/packages/drawnix/src/services/assistant-account", () => ({ ASSISTANT_ACCOUNT_CHANGED: "account-ready", getAssistantAccount: m.account, isAccountReference: (value: string) => value?.startsWith("tuzi-account:") }));
import { startVideoTaskRecovery } from "../src/videoTaskRecovery";
let stop: (() => void) | undefined;
let event: (value: any) => void;
const task = (props = {}): any => ({ id: "existing", type: "video", status: "processing", remoteId: "task_existing", params: {}, ...props });
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  vi.resetAllMocks();
  m.all.mockReturnValue([task()]); m.active.mockReturnValue(false);
  m.settings.mockResolvedValue(undefined); m.resume.mockResolvedValue(undefined);
  m.route.mockReturnValue({ apiKey: "synthetic" }); m.token.mockReturnValue(Symbol("execution")); m.current.mockReturnValue(true);
  m.subscribe.mockImplementation(callback => { event = callback; return { unsubscribe: vi.fn() }; });
});
afterEach(() => { stop?.(); stop = undefined; });
it("recovers existing video without waiting for a canvas mount", async () => {
  stop = startVideoTaskRecovery(); await tick();
  expect(m.resume).toHaveBeenCalledTimes(1);
  expect(m.resume.mock.calls[0][1]).toEqual([task()]);
  m.resume.mock.calls[0][0]("existing", "completed", { result: { url: "synthetic.mp4" } });
  expect(m.update).toHaveBeenCalledWith("existing", "completed", { result: { url: "synthetic.mp4" } });
});
it("scans all restored tasks when a batch event names an image", async () => {
  m.all.mockReturnValue([]); stop = startVideoTaskRecovery(); await tick();
  m.all.mockReturnValue([task({ id: "image", type: "image" }), task()]);
  event({ type: "taskCreated", task: { id: "image", type: "image" } });
  expect(m.resume.mock.calls[0][1]).toEqual([task()]);
});
it("leaves live execution, completed/cancelled jobs, missing IDs and PPT to their owners", async () => {
  m.all.mockReturnValue([task({ id: "active" }), task({ status: "completed" }), task({ status: "cancelled" }), task({ remoteId: undefined }), task({ ppt: true })]);
  m.active.mockImplementation(id => id === "active"); stop = startVideoTaskRecovery(); await tick();
  expect(m.resume).not.toHaveBeenCalled();
});
it("waits for account readiness and decrypted settings", async () => {
  let ready!: () => void; m.settings.mockReturnValue(new Promise<void>(resolve => { ready = resolve; }));
  m.route.mockReturnValue({ apiKey: "tuzi-account:synthetic" }); m.account.mockReturnValue({ state: { status: "loading" } });
  stop = startVideoTaskRecovery(); await tick(); expect(m.resume).not.toHaveBeenCalled();
  ready(); await tick(); expect(m.resume).not.toHaveBeenCalled();
  m.account.mockReturnValue({ state: { status: "connected" } }); window.dispatchEvent(new Event("account-ready"));
  expect(m.resume).toHaveBeenCalledTimes(1);
});
it("invalidates stale callbacks and only cancels managed polling on shutdown", async () => {
  stop = startVideoTaskRecovery(); await tick();
  const [update, , guard] = m.resume.mock.calls[0]; const current = guard("existing");
  expect(current()).toBe(true); stop(); stop = undefined;
  expect(current()).toBe(false); update("existing", "completed", {});
  expect(m.update).not.toHaveBeenCalled(); expect(m.cancel).toHaveBeenCalledWith("existing");
});
it("cancels a deleted recovery without creating another task", async () => {
  stop = startVideoTaskRecovery(); await tick(); event({ type: "taskDeleted", task: task() });
  expect(m.cancel).toHaveBeenCalledWith("existing"); expect(m.resume).toHaveBeenCalledTimes(1);
});
