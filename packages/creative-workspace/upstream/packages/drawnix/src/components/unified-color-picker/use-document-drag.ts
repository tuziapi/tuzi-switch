import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export type DragPoint = {
  clientX: number;
  clientY: number;
};

type UseDocumentDragOptions = {
  disabled?: boolean;
  onDrag: (point: DragPoint) => void;
};

export function useDocumentDrag({
  disabled = false,
  onDrag,
}: UseDocumentDragOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const onDragRef = useRef(onDrag);

  useEffect(() => {
    onDragRef.current = onDrag;
  }, [onDrag]);

  const startDrag = useCallback((point: DragPoint) => {
    if (disabled) return;

    setIsDragging(true);
    onDragRef.current(point);
  }, [disabled]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled) return;

    e.preventDefault();
    startDrag({
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }, [disabled, startDrag]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled) return;

    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;

    startDrag({
      clientX: touch.clientX,
      clientY: touch.clientY,
    });
  }, [disabled, startDrag]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      onDragRef.current({
        clientX: e.clientX,
        clientY: e.clientY,
      });
    };

    const stopDrag = () => {
      setIsDragging(false);
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;

      onDragRef.current({
        clientX: touch.clientX,
        clientY: touch.clientY,
      });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', stopDrag);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', stopDrag);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', stopDrag);
    };
  }, [isDragging]);

  return {
    onMouseDown: handleMouseDown,
    onTouchStart: handleTouchStart,
  };
}
