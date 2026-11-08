import { setAssistantAccount } from '../../services/assistant-account';
import React from 'react';
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaitBoard } from '@plait/core';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import {
  IMAGE_GENERATION_ANCHOR_RETRY_EVENT,
  type PlaitImageGenerationAnchor,
} from '../../types/image-generation-anchor.types';
import { workflowCompletionService } from '../../services/workflow-completion-service';
import { ImageGenerationAnchorContent } from './ImageGenerationAnchorContent';
import { ImageGenerationAnchorGenerator } from './image-generation-anchor.generator';
import { registerCanvasImage } from '../../services/canvas-image-readiness';

const mocks = vi.hoisted(() => ({
  tasks: [] as Task[],
  retryTask: vi.fn(),
  updateAnchor: vi.fn(),
}));

vi.mock('../../services/task-queue', () => ({
  taskQueueService: {
    getAllTasks: () => mocks.tasks,
    retryTask: mocks.retryTask,
    observeTaskUpdates: () => ({
      subscribe: () => ({ unsubscribe: () => undefined }),
    }),
  },
}));

vi.mock('./image-generation-anchor.transforms', () => ({
  ImageGenerationAnchorTransforms: { updateAnchor: mocks.updateAnchor },
}));

vi.mock('../retry-image', () => ({ RetryImage: () => null }));
vi.mock('tdesign-react', () => ({
  MessagePlugin: { success: vi.fn(), error: vi.fn() },
}));

function createAnchor(): PlaitImageGenerationAnchor {
  return {
    id: 'anchor-1',
    type: 'generation-anchor',
    points: [
      [0, 0],
      [320, 320],
    ],
    angle: 0,
    anchorType: 'ratio',
    phase: 'failed',
    title: '图片生成',
    subtitle: '生成失败，请重试',
    error: '插入失败：图片加载失败',
    transitionMode: 'hold',
    createdAt: 1,
    workflowId: 'workflow-1',
    taskIds: ['task-1'],
    primaryTaskId: 'task-1',
    requestedCount: 1,
    zoom: 1,
  };
}

describe('ImageGenerationAnchorContent result recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tasks = [
      {
        id: 'task-1',
        type: TaskType.IMAGE,
        status: TaskStatus.COMPLETED,
        params: { prompt: '生成图片', workflowId: 'workflow-1' },
        result: {
          url: 'https://cdn.example.com/result.png',
          format: 'png',
          size: 0,
        },
        createdAt: 1,
        updatedAt: 2,
      },
    ];
  });

  afterEach(() => {
    cleanup();
    workflowCompletionService.clear();
  });

  it('keeps the loading label without a ring until the actual canvas result has loaded', () => {
    mocks.tasks[0].insertedToCanvas = true;
    const anchor = {
      ...createAnchor(), phase: 'inserting' as const, error: undefined,
      resultElementId: 'image-1',
    };
    const board = {
      children: [anchor, {
        id: 'image-1', type: 'image', url: '/__aitu_cache__/image/result.png',
        generationTaskId: 'task-1',
      }],
    } as unknown as PlaitBoard;
    render(<ImageGenerationAnchorContent board={board} element={anchor} selected={false} />);
    expect(screen.getByText('正在加载图片')).toBeTruthy();
    expect(document.querySelector('.image-generation-progress-display__ring')).toBeNull();

    act(() => {
      registerCanvasImage(board, 'image-1', '/__aitu_cache__/image/result.png').setReady(true);
    });
    expect(screen.queryByText('正在加载图片')).toBeNull();
    expect(document.querySelector('.image-generation-anchor--phase-completed')).not.toBeNull();
  });

  it('does not miss a cached image load between rendering and subscribing', () => {
    mocks.tasks[0].insertedToCanvas = true;
    const anchor = {
      ...createAnchor(),
      phase: 'inserting' as const,
      resultElementId: 'image-1',
    };
    const url = '/__aitu_cache__/image/result.png';
    const board = {
      children: [{ id: 'image-1', type: 'image', url }],
    } as unknown as PlaitBoard;
    function CachedResult() {
      React.useLayoutEffect(() => {
        const image = registerCanvasImage(board, 'image-1', url);
        image.setReady(true);
        return () => image.dispose();
      }, []);
      return <ImageGenerationAnchorContent board={board} element={anchor} selected={false} />;
    }
    render(<CachedResult />);
    expect(screen.queryByText('正在加载图片')).toBeNull();
  });

  it('shows successful generation and retries insertion without regenerating', async () => {
    workflowCompletionService.failPostProcessing('task-1', '图片加载失败');
    const onRetryInsertion = vi.fn();
    window.addEventListener(
      IMAGE_GENERATION_ANCHOR_RETRY_EVENT,
      onRetryInsertion
    );
    try {
      render(
        <ImageGenerationAnchorContent
          board={{ children: [] } as unknown as PlaitBoard}
          element={createAnchor()}
          selected={false}
        />
      );

      expect(screen.getByText('已生成，插入失败')).toBeTruthy();
      expect(screen.queryByText('生成失败')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '重试插入' }));

      await waitFor(() => expect(onRetryInsertion).toHaveBeenCalledTimes(1));
      expect(onRetryInsertion.mock.calls[0][0].detail).toEqual({
        taskId: 'task-1',
        anchorId: 'anchor-1',
      });
      expect(mocks.retryTask).not.toHaveBeenCalled();
      expect(mocks.tasks[0].status).toBe(TaskStatus.COMPLETED);
      expect(mocks.tasks[0].result?.url).toBe(
        'https://cdn.example.com/result.png'
      );
    } finally {
      window.removeEventListener(
        IMAGE_GENERATION_ANCHOR_RETRY_EVENT,
        onRetryInsertion
      );
    }
  });

  it('continues to offer generation retry when the provider task failed', async () => {
    mocks.tasks[0] = {
      ...mocks.tasks[0],
      status: TaskStatus.FAILED,
      result: undefined,
    };
    render(
      <ImageGenerationAnchorContent
        board={{ children: [] } as unknown as PlaitBoard}
        element={createAnchor()}
        selected={false}
      />
    );

    expect(screen.getByText('生成失败')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重试插入' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() =>
      expect(mocks.retryTask).toHaveBeenCalledExactlyOnceWith('task-1')
    );
  });

  it('retries a failed mounted result without regenerating or inserting a duplicate', async () => {
    mocks.tasks[0].insertedToCanvas = true;
    const anchor = { ...createAnchor(), resultElementId: 'image-1' };
    const url = '/__aitu_cache__/image/result.png';
    const board = { children: [anchor, { id: 'image-1', type: 'image', url, generationTaskId: 'task-1' }] } as unknown as PlaitBoard;
    const reload = vi.fn();
    const image = registerCanvasImage(board, 'image-1', url, reload);
    image.setError('图片加载超时，可重试加载已有结果');
    const retryInsertion = vi.fn();
    window.addEventListener(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, retryInsertion);
    try {
      render(<ImageGenerationAnchorContent board={board} element={anchor} selected={false} />);
      expect(screen.getByText('已生成，加载失败')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
      await waitFor(() => expect(reload).toHaveBeenCalledOnce());
      expect(mocks.retryTask).not.toHaveBeenCalled();
      expect(retryInsertion).not.toHaveBeenCalled();
      expect(board.children).toHaveLength(2);
      expect(screen.getByText('正在加载图片')).toBeTruthy();
      act(() => image.setReady(true));
      expect(screen.queryByText('正在加载图片')).toBeNull();
      expect(screen.queryByText('图片加载超时，可重试加载已有结果')).toBeNull();
    } finally {
      window.removeEventListener(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, retryInsertion);
    }
  });
});


describe('native SVG anchor readiness', () => {
  it('receives real readiness events and never paints a loading placeholder image', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    const task = { id: 'task-1', type: TaskType.IMAGE, status: TaskStatus.COMPLETED,
      params: {}, createdAt: 1, insertedToCanvas: true, result: { url: '/__aitu_cache__/image/result.png' } } as Task;
    mocks.tasks = [task];
    const anchor = { ...createAnchor(), phase: 'inserting' as const, error: undefined,
      resultElementId: 'image-1', previewImageUrl: 'data:image/png;base64,synthetic-invalid-preview' };
    const board = { children: [{ id: 'image-1', type: 'image', url: task.result!.url, generationTaskId: task.id }] } as unknown as PlaitBoard;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const host = document.createElementNS(svg.namespaceURI, 'g') as SVGGElement;
    svg.appendChild(host); document.body.appendChild(svg);
    const generator = new ImageGenerationAnchorGenerator(board);
    try {
      await act(async () => { generator.processDrawing(anchor, host, false); });
      expect(host.textContent).toContain('正在加载图片');
      expect(host.querySelector('image')).toBeNull();
      await act(async () => { registerCanvasImage(board, 'image-1', task.result!.url).setReady(true); });
      expect(host.textContent).toContain('已完成');
      expect(host.textContent).not.toContain('正在加载图片');
    } finally {
      generator.destroy();
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      svg.remove(); vi.unstubAllGlobals(); mocks.tasks = [];
    }
  });
});


describe('native SVG failure diagnostics', () => {
  it('shows and copies full diagnostics through the native bridge and expands selection bounds', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    const copyText = vi.fn().mockResolvedValue(undefined);
    setAssistantAccount({ state: { status: 'disconnected' }, copyText } as unknown as NonNullable<Parameters<typeof setAssistantAccount>[0]>);
    mocks.tasks = [{ id: 'task-1', type: TaskType.IMAGE, status: TaskStatus.FAILED,
      params: { model: 'gpt-image-2.6-1k' }, createdAt: 1,
      error: { code: 'FAILED', message: '合成失败', details: { requestId: 'provider-126', modelId: 'gpt-image-2.6-1k', httpStatus: 400 } },
    } as Task];
    const anchor = createAnchor();
    const board = { children: [anchor], deleteFragment: vi.fn() } as unknown as PlaitBoard;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const host = document.createElementNS(svg.namespaceURI, 'g') as SVGGElement;
    svg.appendChild(host); document.body.appendChild(svg);
    const generator = new ImageGenerationAnchorGenerator(board);
    const onSizeChange = vi.fn(); generator.onSizeChange = onSizeChange;
    try {
      await act(async () => { generator.processDrawing(anchor, host, false); });
      expect(host.textContent).toContain('provider-126');
      expect(host.textContent).toContain('gpt-image-2.6-1k');
      expect(host.querySelector('foreignObject')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '复制 全部错误信息' }));
      await waitFor(() => expect(copyText).toHaveBeenCalledWith(expect.stringContaining('Request ID：provider-126')));
      expect(copyText.mock.calls[0][0]).toContain('本地任务：task-1');
      expect(onSizeChange.mock.lastCall?.[0].height).toBeGreaterThan(320);
      const close = screen.getByRole('button', { name: '关闭' });
      const bubbled = vi.fn();
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) host.addEventListener(type, bubbled);
      fireEvent.pointerDown(close);
      fireEvent.mouseDown(close);
      const current = { ...anchor, title: 'updated live node' };
      board.children = [current];
      await act(async () => { generator.updateDrawing(current, host, true); });
      expect(screen.getByRole('button', { name: '关闭' })).toBe(close);
      expect(host.textContent).toContain('已复制');
      fireEvent.pointerUp(close);
      fireEvent.mouseUp(close);
      expect(bubbled).not.toHaveBeenCalled();
      fireEvent.click(close);
      expect(vi.mocked(board.deleteFragment).mock.lastCall?.[0][0]).toBe(current);
      board.children = [];
      fireEvent.click(close);
      expect(board.deleteFragment).toHaveBeenCalledTimes(1);
    } finally {
      generator.destroy();
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      svg.remove(); setAssistantAccount(undefined); vi.unstubAllGlobals(); mocks.tasks = [];
    }
  });
});

// The public generator path includes the native controller's extra readiness tick.
// Retaining the spinner identity is important: replacing it restarts its animation.
describe('native SVG progress rendering', () => {
  it('reuses the entire SVG structure for progress, unchanged updates and subtitle changes', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    mocks.tasks = [{ id: 'task-1', type: TaskType.IMAGE, status: TaskStatus.PROCESSING,
      params: {}, createdAt: 1, progress: 10 } as Task];
    let anchor = { ...createAnchor(), phase: 'generating' as const, error: undefined, progress: 10 };
    const board = { children: [] } as unknown as PlaitBoard;
    const host = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    document.body.appendChild(host);
    const generator = new ImageGenerationAnchorGenerator(board);
    try {
      await act(async () => { generator.processDrawing(anchor, host, false); });
      const fallback = host.querySelector('.image-generation-anchor-desktop-fallback')!;
      const spinner = host.querySelector('animateTransform')!;
      const background = fallback.firstChild;
      const replace = vi.spyOn(fallback, 'replaceChildren');
      const bar = [...host.querySelectorAll('rect')].find(node => node.getAttribute('height') === '3' && node.getAttribute('fill') === '#25755e')!;
      expect(bar.getAttribute('width')).toBe('18');
      for (const progress of [10, 20, 40, 60, 90, 90]) {
        mocks.tasks[0] = { ...mocks.tasks[0], progress };
        anchor = { ...anchor, progress, subtitle: `synthetic progress ${progress}` };
        await act(async () => { generator.updateDrawing(anchor, host, false); });
        expect(bar.getAttribute('width')).toBe(String(180 * progress / 100));
        expect(fallback.firstChild).toBe(background);
        expect(host.querySelector('animateTransform')).toBe(spinner);
      }
      expect(replace).not.toHaveBeenCalled();
      expect(host.textContent).toContain('synthetic progress');
      expect(fallback.getAttribute('aria-label')).toContain('synthetic progress 90');
    } finally {
      generator.destroy();
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      host.remove(); vi.unstubAllGlobals(); mocks.tasks = [];
    }
  });

  it('refreshes geometry and batch labels, and paints the latest failure and retry target', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    mocks.tasks = [{ id: 'task-1', type: TaskType.IMAGE, status: TaskStatus.PROCESSING,
      params: {}, createdAt: 1, progress: 40 } as Task];
    let anchor: PlaitImageGenerationAnchor = { ...createAnchor(), phase: 'generating', error: undefined, progress: 40 };
    const board = { children: [anchor], deleteFragment: vi.fn() } as unknown as PlaitBoard;
    const host = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    document.body.appendChild(host);
    const generator = new ImageGenerationAnchorGenerator(board);
    const onRetry = vi.fn(); window.addEventListener(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, onRetry);
    try {
      await act(async () => { generator.processDrawing(anchor, host, false); });
      const originalSpinner = host.querySelector('animateTransform');
      anchor = { ...anchor, points: [[100, 200], [500, 600]], batchTotal: 20 };
      await act(async () => { generator.updateDrawing(anchor, host, false); });
      expect(host.querySelector('animateTransform')).not.toBe(originalSpinner);
      const background = host.querySelector('.image-generation-anchor-desktop-fallback > rect')!;
      expect(background.getAttribute('x')).toBe('100');
      expect(background.getAttribute('y')).toBe('200');
      expect(background.getAttribute('width')).toBe('400');
      expect(host.textContent).toContain('20 张');
      anchor = { ...anchor, batchIndex: 4 };
      await act(async () => { generator.updateDrawing(anchor, host, false); });
      expect(host.textContent).toContain('4/20');
      expect(host.textContent).not.toContain('20 张');
      mocks.tasks = [{ ...mocks.tasks[0], id: 'task-retry', status: TaskStatus.FAILED,
        error: { code: 'FAILED', message: 'synthetic new failure', details: { requestId: 'request-new' } } }];
      anchor = { ...anchor, phase: 'failed', taskIds: ['task-retry'], primaryTaskId: 'task-retry' };
      board.children = [anchor];
      await act(async () => { generator.updateDrawing(anchor, host, false); });
      expect(host.textContent).toContain('request-new');
      expect(host.querySelector('animateTransform')).toBeNull();
      fireEvent.click(host.querySelector('[aria-label="重试"]')!);
      expect(onRetry.mock.lastCall?.[0].detail).toEqual({ taskId: 'task-retry', anchorId: anchor.id });
      fireEvent.click(host.querySelector('[aria-label="关闭"]')!);
      expect(vi.mocked(board.deleteFragment).mock.lastCall?.[0][0]).toBe(anchor);
    } finally {
      window.removeEventListener(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, onRetry);
      generator.destroy();
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      host.remove(); vi.unstubAllGlobals(); mocks.tasks = [];
    }
  });
});
