/**
 * 透明度条滑块组件
 * 支持 0-100% 透明度调节，显示棋盘格背景
 */

import React, { useRef, useCallback } from 'react';
import type { AlphaSliderProps } from './types';
import { removeAlphaFromHex } from './utils';
import { useDocumentDrag } from './use-document-drag';
import type { DragPoint } from './use-document-drag';

export const AlphaSlider: React.FC<AlphaSliderProps> = ({
  alpha,
  color,
  onChange,
  disabled = false,
}) => {
  const sliderRef = useRef<HTMLDivElement>(null);

  // 计算指示器位置
  const indicatorPosition = alpha;

  // 获取不带透明度的颜色
  const baseColor = removeAlphaFromHex(color);

  // 渐变背景样式
  const gradientStyle = {
    background: `linear-gradient(to right, transparent 0%, ${baseColor} 100%)`,
  };

  // 从位置计算透明度值
  const calculateAlpha = useCallback((clientX: number) => {
    if (!sliderRef.current) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const newAlpha = Math.round((x / rect.width) * 100);

    onChange(newAlpha);
  }, [onChange]);

  const handleDrag = useCallback(({ clientX }: DragPoint) => {
    calculateAlpha(clientX);
  }, [calculateAlpha]);

  const dragHandlers = useDocumentDrag({
    disabled,
    onDrag: handleDrag,
  });

  return (
    <div
      ref={sliderRef}
      className="ucp-alpha-slider"
      onMouseDown={dragHandlers.onMouseDown}
      onTouchStart={dragHandlers.onTouchStart}
    >
      {/* 棋盘格背景 */}
      <div className="ucp-alpha-slider__checkerboard" />
      {/* 透明度渐变 */}
      <div className="ucp-alpha-slider__gradient" style={gradientStyle} />
      {/* 选择指示器 */}
      <div
        className="ucp-alpha-slider__indicator"
        style={{ left: `${indicatorPosition}%` }}
      />
    </div>
  );
};

export default AlphaSlider;
