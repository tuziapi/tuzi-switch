/**
 * Virtual Asset Grid
 * 虚拟滚动网格组件 - 使用 @tanstack/react-virtual 实现窗口式渲染
 * 只渲染可见区域的元素，大幅提升大数据量场景的性能
 */

import { useRef, useMemo, useCallback, useState, useEffect, type PointerEvent as ReactPointerEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AssetItem } from './AssetItem';
import type { Asset, ViewMode } from '../../types/asset.types';

// 视图模式配置 - 使用固定最大尺寸，列数自动计算
const VIEW_CONFIG: Record<ViewMode, {
  maxItemSize: number;  // 最大项目尺寸
  minItemSize: number;  // 最小项目尺寸
  gap: number;
  padding: number;
}> = {
  grid: {
    maxItemSize: 180,   // 最大 180px
    minItemSize: 120,   // 最小 120px
    gap: 16,
    padding: 20,
  },
  compact: {
    maxItemSize: 80,
    minItemSize: 60,
    gap: 4,
    padding: 12,
  },
  list: {
    maxItemSize: 76,    // 增加高度以包含间距
    minItemSize: 76,
    gap: 0,             // 间距由 AssetItem margin 控制
    padding: 16,
  },
};

interface VirtualAssetGridProps {
  assets: Asset[];
  viewMode: ViewMode;
  gridSize?: number;
  selectedAssetId?: string;
  isAssetSelected: (asset: Asset) => boolean;
  isSelectionMode: boolean;
  marqueeEnabled?: boolean;
  onSelectAsset: (assetId: string, event?: React.MouseEvent) => void;
  onMarqueeSelect?: (assetIds: string[]) => void;
  onDoubleClick?: (asset: Asset) => void;
  onPreview?: (asset: Asset) => void;
  onContextMenu?: (asset: Asset, event: React.MouseEvent) => void;
  isFavorite?: (assetId: string) => boolean;
  onToggleFavorite?: (asset: Asset, event: React.MouseEvent) => void;
  syncedUrls?: Set<string>; // 已同步到 Gist 的 URL 集合
}

interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface MarqueeDragState {
  startX: number;
  startY: number;
  active: boolean;
}

function shouldIgnoreMarqueeTarget(target: HTMLElement): boolean {
  return Boolean(
    target.closest(
      'button, input, textarea, select, option, label, video, audio, a, .t-checkbox, [data-marquee-ignore="true"]'
    )
  );
}

function intersectsMarquee(rect: DOMRect, marquee: DOMRect): boolean {
  return !(
    rect.right < marquee.left ||
    rect.left > marquee.right ||
    rect.bottom < marquee.top ||
    rect.top > marquee.bottom
  );
}

export function VirtualAssetGrid({
  assets,
  viewMode,
  gridSize = 180,
  selectedAssetId,
  isAssetSelected,
  isSelectionMode,
  marqueeEnabled = false,
  onSelectAsset,
  onMarqueeSelect,
  onDoubleClick,
  onPreview,
  onContextMenu,
  isFavorite,
  onToggleFavorite,
  syncedUrls,
}: VirtualAssetGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const marqueeDragRef = useRef<MarqueeDragState | null>(null);
  const suppressClickRef = useRef(false);
  const config = useMemo(() => {
    const baseConfig = VIEW_CONFIG[viewMode];
    // 如果是网格或紧凑模式，允许通过 gridSize 覆盖尺寸
    if (viewMode === 'grid' || viewMode === 'compact') {
      return {
        ...baseConfig,
        maxItemSize: gridSize,
        minItemSize: Math.min(gridSize, baseConfig.minItemSize)
      };
    }
    return baseConfig;
  }, [viewMode, gridSize]);

  const [containerWidth, setContainerWidth] = useState(800);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);

  // 监听容器尺寸变化
  useEffect(() => {
    const container = parentRef.current;
    if (!container) return;

    const updateWidth = () => {
      setContainerWidth(container.clientWidth);
    };

    // 初始化
    updateWidth();

    // 监听 resize
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // 计算布局（列数和尺寸）
  const layout = useMemo(() => {
    if (viewMode === 'list') {
      return { columns: 1, itemSize: config.maxItemSize };
    }
    const availableWidth = containerWidth - config.padding * 2;
    // 计算能容纳的最大列数
    const columns = Math.max(1, Math.floor((availableWidth + config.gap) / (config.maxItemSize + config.gap)));
    // 实际尺寸计算（不再进行 Max 钳位，让其在当前列数下撑满）
    const itemSize = Math.floor((availableWidth - config.gap * (columns - 1)) / columns);
    return { columns, itemSize };
  }, [viewMode, containerWidth, config]);

  const columns = layout.columns;

  // 计算每个 item 的尺寸
  const itemSize = useMemo(() => {
    if (viewMode === 'list') {
      return { width: containerWidth - config.padding * 2, height: layout.itemSize };
    }
    // 网格模式：正方形
    return { width: layout.itemSize, height: layout.itemSize };
  }, [viewMode, containerWidth, config.padding, layout.itemSize]);

  // 计算行数
  const rowCount = useMemo(() => {
    return Math.ceil(assets.length / columns);
  }, [assets.length, columns]);

  // 计算行高（包含 gap）
  const getRowHeight = useCallback(() => {
    return itemSize.height + config.gap;
  }, [itemSize.height, config.gap]);

  // 虚拟化器
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: getRowHeight,
    overscan: 3, // 预渲染上下各3行
  });

  // 当容器尺寸或布局变化时，重新测量虚拟滚动
  useEffect(() => {
    rowVirtualizer.measure();
  }, [containerWidth, rowCount, columns, rowVirtualizer]);

  // 渲染单行
  const renderRow = useCallback((rowIndex: number) => {
    const startIndex = rowIndex * columns;
    const rowAssets = assets.slice(startIndex, startIndex + columns);

    return rowAssets.map((asset) => {
      // 检查素材是否已同步（通过 URL 匹配）
      const isSynced = syncedUrls ? syncedUrls.has(asset.url) : false;
      
      return (
        <div
          key={asset.id}
          data-asset-cell="true"
          data-asset-id={asset.id}
          style={{
            width: '100%', // 在 Grid 下设为 100% 自动填充单元格
            height: itemSize.height,
          }}
        >
          <AssetItem
            asset={asset}
            viewMode={viewMode}
            isSelected={isSelectionMode ? isAssetSelected(asset) : selectedAssetId === asset.id}
            onSelect={onSelectAsset}
            onDoubleClick={onDoubleClick}
            onPreview={onPreview}
            onContextMenu={onContextMenu}
            isInSelectionMode={isSelectionMode}
            isSynced={isSynced}
            isFavorite={isFavorite?.(asset.id)}
            onToggleFavorite={onToggleFavorite}
          />
        </div>
      );
    });
  }, [assets, columns, viewMode, selectedAssetId, isAssetSelected, isSelectionMode, onSelectAsset, onDoubleClick, onPreview, onContextMenu, isFavorite, onToggleFavorite, itemSize.height, syncedUrls]);

  const virtualItems = rowVirtualizer.getVirtualItems();

  const stopMarqueeDrag = useCallback(() => {
    marqueeDragRef.current = null;
    setMarqueeRect(null);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, []);

  useEffect(() => {
    if (!marqueeEnabled) {
      marqueeDragRef.current = null;
      setMarqueeRect(null);
      suppressClickRef.current = false;
    }
  }, [marqueeEnabled]);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const dragState = marqueeDragRef.current;
    const container = parentRef.current;
    if (!dragState || !container || !marqueeEnabled || !onMarqueeSelect) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const currentX = Math.min(Math.max(event.clientX, containerRect.left), containerRect.right);
    const currentY = Math.min(Math.max(event.clientY, containerRect.top), containerRect.bottom);
    const deltaX = currentX - dragState.startX;
    const deltaY = currentY - dragState.startY;

    if (!dragState.active && Math.hypot(deltaX, deltaY) < 6) {
      return;
    }

    if (!dragState.active) {
      dragState.active = true;
      suppressClickRef.current = true;
    }

    const left = Math.min(dragState.startX, currentX) - containerRect.left;
    const top = Math.min(dragState.startY, currentY) - containerRect.top;
    const width = Math.abs(currentX - dragState.startX);
    const height = Math.abs(currentY - dragState.startY);
    const nextRect = { left, top, width, height };
    setMarqueeRect(nextRect);

    const marqueeViewportRect = new DOMRect(
      containerRect.left + nextRect.left,
      containerRect.top + nextRect.top,
      nextRect.width,
      nextRect.height
    );

    const hitIds = Array.from(
      container.querySelectorAll<HTMLElement>('[data-asset-cell="true"][data-asset-id]')
    )
      .filter((element) => intersectsMarquee(element.getBoundingClientRect(), marqueeViewportRect))
      .map((element) => element.dataset.assetId)
      .filter((assetId): assetId is string => Boolean(assetId));

    onMarqueeSelect(hitIds);
  }, [marqueeEnabled, onMarqueeSelect]);

  const handlePointerUp = useCallback(() => {
    stopMarqueeDrag();
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerUp);
  }, [handlePointerMove, stopMarqueeDrag]);

  const handlePointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!marqueeEnabled || !onMarqueeSelect || event.button !== 0) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement) || shouldIgnoreMarqueeTarget(target)) {
      return;
    }

    marqueeDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    suppressClickRef.current = false;

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  }, [handlePointerMove, handlePointerUp, marqueeEnabled, onMarqueeSelect]);

  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  useEffect(() => {
    return () => {
      marqueeDragRef.current = null;
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  return (
    <div
      ref={parentRef}
      className={`virtual-asset-grid virtual-asset-grid--${viewMode} ${marqueeRect ? 'virtual-asset-grid--marquee-active' : ''}`}
      onPointerDownCapture={handlePointerDownCapture}
      onClickCapture={handleClickCapture}
      style={{
        height: '100%',
        overflow: 'auto',
        position: 'relative',
      }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => (
            <div
              key={virtualRow.key}
              className={`virtual-asset-grid__row virtual-asset-grid__row--${viewMode}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${itemSize.height}px`,
                transform: `translateY(${virtualRow.start}px)`,
                display: viewMode === 'list' ? 'block' : 'grid',
                gridTemplateColumns: viewMode === 'list' ? 'none' : `repeat(${columns}, 1fr)`,
                gap: `${config.gap}px`,
                padding: `0 ${config.padding}px`,
              }}
            >
              {renderRow(virtualRow.index)}
            </div>
        ))}
      </div>
      {marqueeRect && (
        <div
          className="virtual-asset-grid__marquee"
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
          }}
        />
      )}
    </div>
  );
}
