import { useCallback, useEffect, useRef, useState } from 'react';

interface DraggablePosition {
  x: number;
  y: number;
}

interface UseDraggablePositionOptions {
  storageKey: string;
  enabled?: boolean;
}

const DRAG_THRESHOLD = 5;

function clampToViewport(pos: DraggablePosition, elWidth: number, elHeight: number): DraggablePosition {
  const maxX = Math.max(0, window.innerWidth - elWidth);
  const maxY = Math.max(0, window.innerHeight - elHeight);
  return {
    x: Math.max(0, Math.min(pos.x, maxX)),
    y: Math.max(0, Math.min(pos.y, maxY)),
  };
}

function readPosition(key: string): DraggablePosition | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function writePosition(key: string, pos: DraggablePosition) {
  try {
    localStorage.setItem(key, JSON.stringify(pos));
  } catch {
    // ignore
  }
}

export function useDraggablePosition(options: UseDraggablePositionOptions) {
  const { storageKey, enabled = true } = options;
  const [position, setPosition] = useState<DraggablePosition | null>(() =>
    enabled ? readPosition(storageKey) : null
  );
  const [isDragging, setIsDragging] = useState(false);
  const wasDraggedRef = useRef(false);
  const dragStateRef = useRef<{
    startPointerX: number;
    startPointerY: number;
    startElX: number;
    startElY: number;
    activated: boolean;
    frameId: number;
  } | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return;
      // Only left button
      if (e.button !== 0) return;
      const el = elementRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      dragStateRef.current = {
        startPointerX: e.clientX,
        startPointerY: e.clientY,
        startElX: rect.left,
        startElY: rect.top,
        activated: false,
        frameId: 0,
      };
    },
    [enabled]
  );

  useEffect(() => {
    if (!enabled) return;

    const handlePointerMove = (e: PointerEvent) => {
      const state = dragStateRef.current;
      if (!state) return;

      const dx = e.clientX - state.startPointerX;
      const dy = e.clientY - state.startPointerY;

      if (!state.activated) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
          return;
        }
        state.activated = true;
        setIsDragging(true);
      }

      cancelAnimationFrame(state.frameId);
      state.frameId = requestAnimationFrame(() => {
        const el = elementRef.current;
        if (!el) return;
        const newPos = clampToViewport(
          { x: state.startElX + dx, y: state.startElY + dy },
          el.offsetWidth,
          el.offsetHeight
        );
        setPosition(newPos);
      });
    };

    const handlePointerUp = () => {
      const state = dragStateRef.current;
      if (!state) return;
      cancelAnimationFrame(state.frameId);
      const wasDragging = state.activated;
      dragStateRef.current = null;
      setIsDragging(false);

      if (wasDragging) {
        // Keep wasDragged true briefly so click handler can check it
        wasDraggedRef.current = true;
        requestAnimationFrame(() => {
          wasDraggedRef.current = false;
        });
        setPosition((pos) => {
          if (pos) writePosition(storageKey, pos);
          return pos;
        });
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [enabled, storageKey]);

  // Clamp on resize
  useEffect(() => {
    if (!enabled || !position) return;
    const handleResize = () => {
      const el = elementRef.current;
      if (!el) return;
      setPosition((prev) => {
        if (!prev) return prev;
        return clampToViewport(prev, el.offsetWidth, el.offsetHeight);
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [enabled, !!position]);

  const resetPosition = useCallback(() => {
    setPosition(null);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }, [storageKey]);

  return {
    position,
    isDragging,
    wasDraggedRef,
    elementRef,
    handlePointerDown,
    resetPosition,
  };
}
