/**
 * 色相/饱和度面板组件
 * 二维选择面板，X轴为饱和度，Y轴为明度
 */

import React, { useRef, useCallback } from 'react';
import type { HSPanelProps } from './types';
import { hsvToHex } from './utils';
import { useDocumentDrag } from './use-document-drag';
import type { DragPoint } from './use-document-drag';

export const HSPanel: React.FC<HSPanelProps> = ({
  hue,
  saturation,
  value,
  onChange,
  disabled = false,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  // 计算指示器位置
  const indicatorStyle = {
    left: `${saturation}%`,
    top: `${100 - value}%`,
  };

  // 计算面板背景色（纯色相）
  const panelBackground = hsvToHex({ h: hue, s: 100, v: 100 });

  // 从鼠标/触摸位置计算饱和度和明度
  const calculateSV = useCallback((clientX: number, clientY: number) => {
    if (!panelRef.current) return;

    const rect = panelRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(clientY - rect.top, rect.height));

    const newSaturation = Math.round((x / rect.width) * 100);
    const newValue = Math.round(100 - (y / rect.height) * 100);

    onChange(newSaturation, newValue);
  }, [onChange]);

  const handleDrag = useCallback(({ clientX, clientY }: DragPoint) => {
    calculateSV(clientX, clientY);
  }, [calculateSV]);

  const dragHandlers = useDocumentDrag({
    disabled,
    onDrag: handleDrag,
  });

  return (
    <div
      ref={panelRef}
      className="ucp-hs-panel"
      style={{ backgroundColor: panelBackground }}
      onMouseDown={dragHandlers.onMouseDown}
      onTouchStart={dragHandlers.onTouchStart}
    >
      {/* 白色渐变层（从左到右） */}
      <div className="ucp-hs-panel__white-gradient" />
      {/* 黑色渐变层（从下到上） */}
      <div className="ucp-hs-panel__black-gradient" />
      {/* 选择指示器 */}
      <div
        className="ucp-hs-panel__indicator"
        style={indicatorStyle}
      />
    </div>
  );
};

export default HSPanel;
