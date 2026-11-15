import { useDrawnix } from '../hooks/use-drawnix';
import { useCanvasTemporaryPan } from '../hooks/use-canvas-temporary-pan';

/** Uses the existing tools. No pointer-move listeners or per-frame state. */
export function CanvasTemporaryPanSupport() {
  const { board, appState } = useDrawnix();
  useCanvasTemporaryPan(board, appState.pointer);
  return null;
}
