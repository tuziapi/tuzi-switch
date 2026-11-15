import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  flush: vi.fn(),
  textFlush: vi.fn(),
  running: new Set<string>(),
}));
vi.mock("../upstream/packages/drawnix/src/utils/active-tasks", () => ({
  hasActiveLLMTasks: mocks.active,
}));
vi.mock("../upstream/packages/drawnix/src/services/workspace-service", () => ({
  workspaceService: { flushForAppUpdate: mocks.flush },
}));
vi.mock("../upstream/packages/drawnix/src/services/text-chat/runtime", () => ({
  textChatRuntime: {
    getSnapshot: () => ({ running: mocks.running }),
    flush: mocks.textFlush,
  },
}));
import {
  prepareCreativeUpdate,
  registerEditorUpdateGuard,
  setCreativeRuntimeReady,
} from "../src/updateGuard";
describe("creative update safety", () => {
  it("blocks text generation and unsaved conversation failures", async () => {
    setCreativeRuntimeReady(true);
    mocks.running.add("synthetic");
    await expect(prepareCreativeUpdate()).rejects.toThrow("生成任务");
    mocks.running.clear();
    mocks.active.mockResolvedValue(false);
    mocks.textFlush.mockRejectedValueOnce(Error("text unsaved"));
    await expect(prepareCreativeUpdate()).rejects.toThrow("text unsaved");
  });
  it("refuses while task restoration is incomplete", async () => {
    setCreativeRuntimeReady(false);
    await expect(prepareCreativeUpdate()).rejects.toThrow("恢复");
  });
  it("refuses active tasks and rechecks after saving", async () => {
    setCreativeRuntimeReady(true);
    mocks.active.mockResolvedValueOnce(true);
    await expect(prepareCreativeUpdate()).rejects.toThrow("生成任务");
    mocks.active.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(prepareCreativeUpdate()).rejects.toThrow("生成任务");
  });
  it("awaits editor saving and fails closed on errors", async () => {
    setCreativeRuntimeReady(true);
    mocks.active.mockResolvedValue(false);
    const remove = registerEditorUpdateGuard(async () => {
      throw Error("unsaved");
    });
    await expect(prepareCreativeUpdate()).rejects.toThrow("unsaved");
    remove();
    await expect(prepareCreativeUpdate()).resolves.toBeUndefined();
  });
});
