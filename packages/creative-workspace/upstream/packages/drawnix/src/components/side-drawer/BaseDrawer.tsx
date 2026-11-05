import React, { useState, useCallback, useEffect } from 'react';
import { SideDrawer, SideDrawerProps } from './SideDrawer';
import {
  getDrawerPinned,
  setDrawerPinned,
  type DrawerPinKey,
} from '../../utils/drawer-pin';

export interface BaseDrawerProps
  extends Omit<
    SideDrawerProps,
    'customWidth' | 'onWidthChange' | 'pinned' | 'onPinnedChange'
  > {
  /** 存储宽度的 localStorage key */
  storageKey?: string;
  /** 固定状态的 localStorage key；传入后显示固定按钮 */
  pinStorageKey?: DrawerPinKey;
  /** 默认宽度 */
  defaultWidth?: number;
  /** 测试标识 */
  'data-testid'?: string;
}

/**
 * BaseDrawer Component
 * 
 * 在 SideDrawer 基础上增加了宽度持久化存储功能。
 * 可以通过 storageKey 独立控制每个抽屉的宽度。
 */
export const BaseDrawer: React.FC<BaseDrawerProps> = ({
  storageKey,
  pinStorageKey,
  defaultWidth,
  minWidth = 300,
  maxWidth = 1024,
  resizable = true,
  pinnable,
  ...props
}) => {
  // 抽屉宽度状态
  const [drawerWidth, setDrawerWidth] = useState<number | undefined>(() => {
    if (!storageKey) return undefined;
    try {
      const cached = localStorage.getItem(storageKey);
      if (cached) {
        const width = parseInt(cached, 10);
        if (!isNaN(width) && width >= minWidth && width <= maxWidth) {
          return width;
        }
      }
    } catch {
      // 忽略 localStorage 错误
    }
    return undefined;
  });
  const [pinned, setPinned] = useState<boolean>(() =>
    pinStorageKey ? getDrawerPinned(pinStorageKey) : false
  );

  // 宽度变化处理
  const handleWidthChange = useCallback((width: number) => {
    setDrawerWidth(width);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, String(width));
      } catch {
        // 忽略 localStorage 错误
      }
    }
  }, [storageKey]);

  // 如果 storageKey 变化，重新加载宽度（虽然通常不会变化）
  useEffect(() => {
    if (!storageKey) return;
    try {
      const cached = localStorage.getItem(storageKey);
      if (cached) {
        const width = parseInt(cached, 10);
        if (!isNaN(width) && width >= minWidth && width <= maxWidth) {
          setDrawerWidth(width);
        }
      }
    } catch {
      // 忽略 localStorage 错误
    }
  }, [storageKey, minWidth, maxWidth]);

  useEffect(() => {
    if (!pinStorageKey) return;
    setPinned(getDrawerPinned(pinStorageKey));
  }, [pinStorageKey]);

  const handlePinnedChange = useCallback(
    (nextPinned: boolean) => {
      setPinned(nextPinned);
      if (pinStorageKey) {
        setDrawerPinned(pinStorageKey, nextPinned);
      }
    },
    [pinStorageKey]
  );

  return (
    <SideDrawer
      {...props}
      pinnable={pinnable || Boolean(pinStorageKey)}
      pinned={pinned}
      onPinnedChange={handlePinnedChange}
      resizable={resizable}
      minWidth={minWidth}
      maxWidth={maxWidth}
      customWidth={drawerWidth || defaultWidth}
      onWidthChange={handleWidthChange}
    />
  );
};

export default BaseDrawer;
