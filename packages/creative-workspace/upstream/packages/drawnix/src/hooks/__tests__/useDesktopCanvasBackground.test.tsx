import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaitBoard } from '@plait/core';

const mocks = vi.hoisted(() => ({
  container: vi.fn(), host: vi.fn(), viewport: vi.fn(), native: vi.fn(),
}));
vi.mock('@plait/core', () => ({
  PlaitBoard: {
    getBoardContainer: mocks.container,
    getHost: mocks.host,
    getViewportContainer: mocks.viewport,
  },
  toHostPointFromViewBoxPoint: () => [0, 0],
}));
vi.mock('../../utils/tauri-env', () => ({ isTauriEnvironment: mocks.native }));
import { useDesktopCanvasBackground } from '../useDesktopCanvasBackground';

const createBoard = () => ({ viewport: { zoom: 1 } }) as PlaitBoard;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.native.mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('desktop canvas background lifecycle', () => {
  it('ignores the detached board during workflow return and paints the newly initialized board', async () => {
    mocks.container.mockReturnValue(undefined);
    mocks.host.mockReturnValue(undefined);
    mocks.viewport.mockReturnValue(undefined);
    const { rerender, unmount } = renderHook(({ board }) => useDesktopCanvasBackground(board), {
      initialProps: { board: createBoard() },
    });
    const container = document.createElement('div');
    const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const viewport = document.createElement('div');
    container.append(host, viewport);
    document.body.append(container);
    mocks.container.mockReturnValue(container);
    mocks.host.mockReturnValue(host);
    mocks.viewport.mockReturnValue(viewport);
    rerender({ board: createBoard() });
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(container.style.getPropertyValue('--desktop-dot-gap')).toBe('24px');
    expect(container.style.getPropertyValue('--desktop-dot-size')).toBe('0.7px');
    unmount();
    expect(container.style.getPropertyValue('--desktop-dot-gap')).toBe('');
  });

  it('does not paint a node removed before its scheduled frame', async () => {
    const container = document.createElement('div');
    const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const viewport = document.createElement('div');
    mocks.container.mockReturnValue(container);
    mocks.host.mockReturnValue(host);
    mocks.viewport.mockReturnValue(viewport);
    renderHook(() => useDesktopCanvasBackground(createBoard()));
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(container.style.getPropertyValue('--desktop-dot-gap')).toBe('');
  });
});
