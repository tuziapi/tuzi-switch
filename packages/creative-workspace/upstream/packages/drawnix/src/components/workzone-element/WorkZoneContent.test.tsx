import { setAssistantAccount } from '../../services/assistant-account';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { WorkZoneContent } from './WorkZoneContent';
import { TaskStatus, TaskExecutionPhase, TaskType, type Task } from '../../types/task.types';
import type { WorkflowMessageData } from '../../types/chat.types';
const mocks = vi.hoisted(() => ({ tasks: [] as Task[], subscribers: new Set<(e: { task: Task }) => void>() }));
vi.mock('../../services/task-queue', () => ({ taskQueueService: {
  getAllTasks: () => mocks.tasks,
  observeTaskUpdates: () => ({ subscribe: (f: (e: {task: Task}) => void) => { mocks.subscribers.add(f); return { unsubscribe: () => mocks.subscribers.delete(f) }; } }),
} }));
vi.mock('../shared/hover', () => ({ HoverTip: ({children}: {children: React.ReactNode}) => <>{children}</> }));
vi.mock('../dialog/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
beforeEach(() => { mocks.tasks = []; mocks.subscribers.clear(); });
afterEach(cleanup);
function workflow(type: WorkflowMessageData['generationType']): WorkflowMessageData {
  return { id: 'workflow-synthetic', name: '合成验收', prompt: 'synthetic', generationType: type,
    status: 'running', createdAt: Date.now(), steps: [{ id: 'step-1', mcp: 'generate_' + type, args: {}, description: '生成结果', status: 'running', result: { taskId: 'task-1' } }] };
}
function update(status: TaskStatus, executionPhase?: TaskExecutionPhase) {
  const task = { id: 'task-1', status, executionPhase, type: TaskType.VIDEO, params: { workflowId: 'workflow-synthetic' }, createdAt: Date.now(), error: status === TaskStatus.FAILED ? { code: 'synthetic', message: '合成失败' } : undefined } as Task;
  mocks.tasks = [task]; mocks.subscribers.forEach(f => f({ task }));
}
describe.each(['video', 'audio', 'text'] as const)('%s canvas task presentation', type => {
  it.each([false, true])('tracks queue events, failure, cancellation and retry (SVG=%s)', native => {
    const onDelete = vi.fn();
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const source = workflow(type);
    source.retryContext = { aiContext: {} as never, referenceImages: [] };
    const content = <WorkZoneContent workflow={source} onDelete={onDelete} onRetry={onRetry} {...(native ? {nativeSize: {width: 400, height: 260}} : {})} />;
    const view = render(native ? <svg>{content}</svg> : content);
    expect(screen.getByText('生成中')).toBeTruthy();
    act(() => update(TaskStatus.PENDING)); expect(screen.getByText('等待执行')).toBeTruthy();
    act(() => update(TaskStatus.PROCESSING, TaskExecutionPhase.SUBMITTING)); expect(screen.getByText('正在提交')).toBeTruthy();
    act(() => update(TaskStatus.PROCESSING)); expect(screen.getByText('生成中')).toBeTruthy();
    act(() => update(TaskStatus.FAILED)); expect(screen.getByText('生成失败')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /重试/ }));expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({id:source.id}),0);
    act(() => update(TaskStatus.CANCELLED)); expect(screen.getByText('已取消')).toBeTruthy();
    act(() => update(TaskStatus.PROCESSING)); expect(screen.getByText('生成中')).toBeTruthy();
    act(() => update(TaskStatus.COMPLETED)); expect(screen.getAllByText(/已完成/).length).toBeGreaterThan(0);
    if (native) expect(view.container.querySelector('foreignObject')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '删除' })); expect(onDelete).toHaveBeenCalledOnce();
    view.unmount(); expect(mocks.subscribers.size).toBe(0);
  });
});


it('keeps video API request IDs visible and copyable in the native SVG card', async () => {
  const copyText = vi.fn().mockResolvedValue(undefined);
  setAssistantAccount({ state: { status: 'disconnected' }, copyText } as unknown as NonNullable<Parameters<typeof setAssistantAccount>[0]>);
  const source = workflow('video');
  const onSizeChange = vi.fn();
  try {
    render(<svg><WorkZoneContent workflow={source} nativeSize={{ width: 400, height: 260 }} onSizeChange={onSizeChange} /></svg>);
    const task = { id: 'task-1', type: TaskType.VIDEO, status: TaskStatus.FAILED, apiRequestId: 'api-original-126',
      params: { workflowId: source.id, model: 'synthetic-video' }, createdAt: Date.now(),
      error: { code: 'FAILED', message: '合成失败', details: { requestId: 'upstream-other-id' } } } as Task;
    act(() => { mocks.tasks = [task]; mocks.subscribers.forEach(f => f({ task })); });
    expect(screen.getByText('api-original-126')).toBeTruthy();
    expect(screen.queryByText('upstream-other-id')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '复制 全部错误信息' })));
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining('Request ID：api-original-126'));
    expect(onSizeChange.mock.lastCall?.[0].height).toBeGreaterThan(260);
  } finally { setAssistantAccount(undefined); }
});
