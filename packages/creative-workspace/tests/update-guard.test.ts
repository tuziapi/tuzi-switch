import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ active:vi.fn(), flush:vi.fn() }));
vi.mock('../upstream/packages/drawnix/src/utils/active-tasks',()=>({hasActiveLLMTasks:mocks.active}));
vi.mock('../upstream/packages/drawnix/src/services/workspace-service',()=>({workspaceService:{flushForAppUpdate:mocks.flush}}));
import { prepareCreativeUpdate, registerEditorUpdateGuard, setCreativeRuntimeReady } from '../src/updateGuard';
describe('creative update safety',()=>{
 it('refuses while task restoration is incomplete',async()=>{setCreativeRuntimeReady(false);await expect(prepareCreativeUpdate()).rejects.toThrow('恢复');});
 it('refuses active tasks and rechecks after saving',async()=>{setCreativeRuntimeReady(true);mocks.active.mockResolvedValueOnce(true);await expect(prepareCreativeUpdate()).rejects.toThrow('生成任务');mocks.active.mockResolvedValueOnce(false).mockResolvedValueOnce(true);await expect(prepareCreativeUpdate()).rejects.toThrow('生成任务');});
 it('awaits editor saving and fails closed on errors',async()=>{setCreativeRuntimeReady(true);mocks.active.mockResolvedValue(false);const remove=registerEditorUpdateGuard(async()=>{throw Error('unsaved');});await expect(prepareCreativeUpdate()).rejects.toThrow('unsaved');remove();await expect(prepareCreativeUpdate()).resolves.toBeUndefined();});
});
