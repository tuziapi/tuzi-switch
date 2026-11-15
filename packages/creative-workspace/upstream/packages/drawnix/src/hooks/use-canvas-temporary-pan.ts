import { useEffect, useRef } from 'react';
import { BoardTransforms, PlaitBoard, PlaitPointerType } from '@plait/core';
import type { DrawnixPointerType } from './use-drawnix';

/** Space must win over image movement, without changing the remembered tool. */
export function useCanvasTemporaryPan(board: PlaitBoard | null, appPointer: DrawnixPointerType) {
  const currentPointer = useRef(appPointer);
  currentPointer.current = appPointer;
  useEffect(() => {
    if (!board) return;
    let previous: { pointer: typeof board.pointer; appPointer: DrawnixPointerType } | null = null;
    const restore = () => {
      if (!previous) return;
      if (board.pointer === PlaitPointerType.hand && currentPointer.current === previous.appPointer) {
        BoardTransforms.updatePointerType(board, previous.pointer);
      }
      previous = null;
      PlaitBoard.getBoardContainer(board)?.classList.remove('viewport-moving');
    };
    const down = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.code !== 'Space' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
          target?.closest('input, textarea, select, button, [contenteditable="true"], [role="dialog"]') ||
          document.querySelector('.unified-viewer') || board.options.readonly ||
          !PlaitBoard.isFocus(board) || PlaitBoard.hasBeenTextEditing(board)) return;
      if (!previous && board.pointer !== PlaitPointerType.hand) {
        previous = { pointer: board.pointer, appPointer: currentPointer.current };
        BoardTransforms.updatePointerType(board, PlaitPointerType.hand);
        PlaitBoard.getBoardContainer(board)?.classList.add('viewport-moving');
      }
      event.preventDefault();
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') restore(); };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, button, [contenteditable="true"]')) restore();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', restore);
    window.addEventListener('focusin', focus);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', restore);
      window.removeEventListener('focusin', focus);
      restore();
    };
  }, [board]);
}
