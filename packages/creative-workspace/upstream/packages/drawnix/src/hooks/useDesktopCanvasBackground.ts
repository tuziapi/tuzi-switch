import { useEffect } from 'react';
import { PlaitBoard, toHostPointFromViewBoxPoint } from '@plait/core';
import { isTauriEnvironment } from '../utils/tauri-env';

/** Paint only the HTML viewport, so dots never become document/export content. */
export function useDesktopCanvasBackground(board: PlaitBoard | null) {
  useEffect(() => {
    if (!board || (!isTauriEnvironment() && import.meta.env.VITE_TUZI_ASSISTANT !== 'true')) return;
    const container = PlaitBoard.getBoardContainer(board);
    const host = PlaitBoard.getHost(board);
    const viewport = PlaitBoard.getViewportContainer(board);
    // Returning from workflow briefly retains the previous board instance.
    // Its DOM has already been removed; afterInit supplies the new board next.
    if (!container || !host || !viewport) return;
    let frame = 0;

    const paint = () => {
      frame = 0;
      if (!container.isConnected || !host.isConnected) return;
      const zoom = board.viewport.zoom;
      // Subsample the same world grid at distant zooms instead of forming a solid texture.
      const step = 24 * 2 ** Math.max(0, Math.ceil(Math.log2(0.5 / zoom)));
      const gap = step * zoom;
      const origin = toHostPointFromViewBoxPoint(board, [0, 0]);
      const hostRect = host.getBoundingClientRect();
      const rect = container.getBoundingClientRect();
      container.style.setProperty('--desktop-dot-size', `${Math.min(1.1, 0.7 * zoom)}px`);
      container.style.setProperty('--desktop-dot-gap', `${gap}px`);
      container.style.setProperty('--desktop-dot-position',
        `${(origin[0] + hostRect.x - rect.x - gap / 2) % gap}px ${(origin[1] + hostRect.y - rect.y - gap / 2) % gap}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(host, { attributes: true, attributeFilter: ['viewBox', 'width', 'height'] });
    viewport.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      viewport.removeEventListener('scroll', schedule);
      for (const property of ['--desktop-dot-size', '--desktop-dot-gap', '--desktop-dot-position']) {
        container.style.removeProperty(property);
      }
    };
  }, [board]);
}
