import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BoardTransforms, clearSelectedElement, PlaitPointerType } from '@plait/core';
import { Hand, MousePointer2 } from 'lucide-react';
import { useDrawnix } from '../hooks/use-drawnix';
import { useCanvasTemporaryPan } from '../hooks/use-canvas-temporary-pan';
import { canvasModePointer, saveCanvasInteractionMode, type CanvasInteractionMode } from '../utils/canvas-interaction-mode';

/** Uses the existing tools. No pointer-move listeners or per-frame state. */
export function CanvasInteractionModeControl() {
  const { board, appState, setAppState } = useDrawnix();
  useCanvasTemporaryPan(board, appState.pointer);
  const mode: CanvasInteractionMode = appState.pointer === PlaitPointerType.hand ? 'browse' : 'edit';
  useEffect(() => {
    if (board) saveCanvasInteractionMode(mode);
  }, [board, mode]);

  const target = document.getElementById('creative-canvas-mode-entry');
  if (!target || !board) return null;

  const choose = (next: CanvasInteractionMode) => {
    const pointer = canvasModePointer(next);
    if (next === 'browse') clearSelectedElement(board);
    BoardTransforms.updatePointerType(board, pointer);
    setAppState(previous => ({ ...previous, pointer }));
  };

  return createPortal(
    <div className="creative-canvas-mode" role="group" aria-label="画布操作模式">
      <button type="button" aria-label="浏览画布" aria-pressed={mode === 'browse'} title="浏览：拖动任意画布区域平移（H）" onClick={() => choose('browse')}>
        <Hand size={14} /><span>浏览</span><kbd>H</kbd>
      </button>
      <button type="button" aria-label="编辑画布" aria-pressed={mode === 'edit'} title="编辑：选择、移动图片和排版（V）；按住空格可临时平移" onClick={() => choose('edit')}>
        <MousePointer2 size={14} /><span>编辑</span><kbd>V</kbd>
      </button>
    </div>, target
  );
}
