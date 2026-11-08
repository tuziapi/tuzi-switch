import { useEffect } from 'react';
import { PlaitPointerType } from '@plait/core';
import { useDrawnix } from '../hooks/use-drawnix';
import { useCanvasTemporaryPan } from '../hooks/use-canvas-temporary-pan';
import { saveCanvasInteractionMode, type CanvasInteractionMode } from '../utils/canvas-interaction-mode';

/** Uses the existing tools. No pointer-move listeners or per-frame state. */
export function CanvasInteractionModeSync() {
  const { board, appState } = useDrawnix();
  useCanvasTemporaryPan(board, appState.pointer);
  const mode: CanvasInteractionMode = appState.pointer === PlaitPointerType.hand ? 'browse' : 'edit';
  useEffect(() => {
    if (board) saveCanvasInteractionMode(mode);
  }, [board, mode]);

  return null;
}
