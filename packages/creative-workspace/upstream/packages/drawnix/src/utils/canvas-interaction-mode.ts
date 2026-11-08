import { PlaitPointerType } from '@plait/core';

export type CanvasInteractionMode = 'browse' | 'edit';
// Device preference only: excluded from project documents, exports and sync.
export const CANVAS_INTERACTION_MODE_KEY = 'tuzi-canvas-interaction-mode-v1';

export function readCanvasInteractionMode(): CanvasInteractionMode {
  try {
    return localStorage.getItem(CANVAS_INTERACTION_MODE_KEY) === 'edit' ? 'edit' : 'browse';
  } catch {
    return 'browse';
  }
}

export function saveCanvasInteractionMode(mode: CanvasInteractionMode): void {
  try {
    if (localStorage.getItem(CANVAS_INTERACTION_MODE_KEY) !== mode) {
      localStorage.setItem(CANVAS_INTERACTION_MODE_KEY, mode);
    }
  } catch {
    // Storage can be unavailable; the current canvas remains usable.
  }
}

export function canvasModePointer(mode: CanvasInteractionMode): PlaitPointerType {
  return mode === 'browse' ? PlaitPointerType.hand : PlaitPointerType.selection;
}
