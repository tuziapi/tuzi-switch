/**
 * 色相条滑块组件
 * 水平色相选择条，覆盖 0-360 度色相范围
 */

import React, { useRef, useCallback } from 'react';
import type { HueSliderProps } from './types';
import { useDocumentDrag } from './use-document-drag';
import type { DragPoint } from './use-document-drag';

export const HueSlider: React.FC<HueSliderProps> = ({
  hue,
  onChange,
  disabled = false,
}) => {
  const sliderRef = useRef<HTMLDivElement>(null);

  // 计算指示器位置
  const indicatorPosition = (hue / 360) * 100;

  // 从位置计算色相值
  const calculateHue = useCallback((clientX: number) => {
    if (!sliderRef.current) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const newHue = Math.round((x / rect.width) * 360);

    onChange(newHue);
  }, [onChange]);

  const handleDrag = useCallback(({ clientX }: DragPoint) => {
    calculateHue(clientX);
  }, [calculateHue]);

  const dragHandlers = useDocumentDrag({
    disabled,
    onDrag: handleDrag,
  });

  return (
    <div
      ref={sliderRef}
      className="ucp-hue-slider"
      onMouseDown={dragHandlers.onMouseDown}
      onTouchStart={dragHandlers.onTouchStart}
    >
      {/* 色相渐变背景 */}
      <div className="ucp-hue-slider__track" />
      {/* 选择指示器 */}
      <div
        className="ucp-hue-slider__indicator"
        style={{ left: `${indicatorPosition}%` }}
      />
    </div>
  );
};

export default HueSlider;
