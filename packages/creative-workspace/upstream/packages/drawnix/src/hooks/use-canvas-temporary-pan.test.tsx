import { renderHook, act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaitPointerType, type PlaitBoard } from '@plait/core';
import { useCanvasTemporaryPan } from './use-canvas-temporary-pan';

vi.mock('@plait/core', () => ({
  PlaitPointerType: { hand: 'hand', selection: 'selection' },
  BoardTransforms: { updatePointerType: (board: { pointer: string }, pointer: string) => { board.pointer = pointer; } },
  PlaitBoard: {
    isFocus: () => true,
    hasBeenTextEditing: () => false,
    getBoardContainer: () => document.body,
  },
}));
afterEach(() => { cleanup(); document.body.classList.remove('viewport-moving'); });
const create = () => ({ pointer: PlaitPointerType.selection, options: { readonly: false } } as PlaitBoard);
const key = (type: string, target: EventTarget = window) => act(() => {
  target.dispatchEvent(new KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
});

describe('temporary pan lifecycle', () => {
  it('temporarily uses hand and restores editing on release, including repeated keydown', () => {
    const board = create();
    renderHook(() => useCanvasTemporaryPan(board, PlaitPointerType.selection));
    key('keydown'); key('keydown');
    expect(board.pointer).toBe('hand');
    key('keyup');
    expect(board.pointer).toBe('selection');
    expect(document.body.classList.contains('viewport-moving')).toBe(false);
  });
  it('restores on window blur when the keyup was lost', () => {
    const board = create();
    renderHook(() => useCanvasTemporaryPan(board, PlaitPointerType.selection));
    key('keydown'); act(() => window.dispatchEvent(new Event('blur')));
    expect(board.pointer).toBe('selection');
  });
  it('leaves typing alone and cancels a held pan on input focus', () => {
    const board = create();
    renderHook(() => useCanvasTemporaryPan(board, PlaitPointerType.selection));
    const input = document.createElement('textarea'); document.body.append(input);
    key('keydown', input); expect(board.pointer).toBe('selection');
    key('keydown'); act(() => input.focus()); expect(board.pointer).toBe('selection');
    input.remove();
  });
  it('does not undo a deliberate switch to browsing while Space was held', () => {
    const board = create();
    const { rerender } = renderHook(({ pointer }) => useCanvasTemporaryPan(board, pointer), {initialProps:{pointer:PlaitPointerType.selection}});
    key('keydown'); rerender({pointer:PlaitPointerType.hand}); key('keyup');
    expect(board.pointer).toBe('hand');
  });
  it('restores and unregisters when the workspace unmounts', () => {
    const board = create();
    const { unmount } = renderHook(() => useCanvasTemporaryPan(board, PlaitPointerType.selection));
    key('keydown'); unmount();
    expect(board.pointer).toBe('selection');
    key('keydown'); expect(board.pointer).toBe('selection');
  });
});
