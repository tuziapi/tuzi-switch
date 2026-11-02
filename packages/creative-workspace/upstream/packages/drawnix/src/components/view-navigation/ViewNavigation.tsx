/**
 * ViewNavigation Component
 *
 * 视图导航组件 - 整合缩放按钮和小地图
 * 放置在画布右上角，与 ChatDrawer 联动
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  ATTACHED_ELEMENT_CLASS_NAME,
  PlaitBoard,
  BoardTransforms,
  getViewportOrigination,
} from '@plait/core';
import { MinusIcon, AddIcon, ChevronDownIcon } from 'tdesign-icons-react';
import { useBoard } from '@plait-board/react-board';
import { Minimap } from '../minimap/Minimap';
import { useChatDrawerControl } from '../../contexts/ChatDrawerContext';
import { Popover, PopoverContent, PopoverTrigger } from '../popover/popover';
import { Z_INDEX } from '../../constants/z-index';
import { useI18n } from '../../i18n';
import { fitAllPPTFrames, fitFrame } from '../../utils/fit-frame';
import { HoverTip } from '../shared/hover';
import { isFrameElement } from '../../types/frame.types';
import { requestOpenPPTEditor } from '../../services/ppt/ppt-ui-events';
import './view-navigation.scss';

export interface ViewNavigationProps {
  /** 是否显示 minimap */
  showMinimap?: boolean;
  /** 容器元素 */
  container?: HTMLElement | null;
}

// 边距
const EDGE_MARGIN = 10;
// 自动隐藏延迟（毫秒）
const AUTO_HIDE_DELAY = 3000;

const getViewportSnapshot = (board?: PlaitBoard) => {
  const origination = board
    ? getViewportOrigination(board) || board.viewport.origination
    : undefined;

  return {
    zoom: board?.viewport?.zoom || 1,
    originX: origination?.[0] || 0,
    originY: origination?.[1] || 0,
  };
};

export const ViewNavigation: React.FC<ViewNavigationProps> = ({
  showMinimap = true,
  container,
}) => {
  const board = useBoard() as PlaitBoard;
  const { t } = useI18n();
  const { isDrawerOpen, drawerWidth } = useChatDrawerControl();
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  // 首次进入页面时默认展示 minimap
  const [minimapExpanded, setMinimapExpanded] = useState(true);
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // 用于检测 viewport 变化
  const lastViewportRef = useRef<
    ReturnType<typeof getViewportSnapshot> | null
  >(null);
  const autoHideTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 计算右侧偏移量
  const rightOffset = useMemo(() => {
    if (isDrawerOpen) {
      return `calc(var(--aitu-toolbar-right-dock-width, 0px) + ${
        drawerWidth + EDGE_MARGIN
      }px)`;
    }

    const toolbarAvoidance = 'var(--aitu-toolbar-right-avoidance, 0px)';
    if (typeof CSS !== 'undefined' && CSS.supports('right', 'max(1px, 2px)')) {
      return `max(${EDGE_MARGIN}px, ${toolbarAvoidance})`;
    }

    return EDGE_MARGIN;
  }, [isDrawerOpen, drawerWidth]);

  // 缩放操作
  const handleZoomOut = useCallback(() => {
    BoardTransforms.updateZoom(board, board.viewport.zoom - 0.1);
  }, [board]);

  const handleZoomIn = useCallback(() => {
    BoardTransforms.updateZoom(board, board.viewport.zoom + 0.1);
  }, [board]);

  const handleFitViewport = useCallback(() => {
    BoardTransforms.fitViewport(board);
    setZoomMenuOpen(false);
  }, [board]);

  const handleZoom100 = useCallback(() => {
    BoardTransforms.updateZoom(board, 1);
    setZoomMenuOpen(false);
  }, [board]);

  const openPPTEditorIfNoFrame = useCallback((): boolean => {
    const hasFrame = board.children.some(isFrameElement);
    if (hasFrame) {
      return false;
    }

    requestOpenPPTEditor({ viewMode: 'slides' });
    return true;
  }, [board]);

  // 自适应 Frame：将选中的 Frame（或第一个 Frame）缩放到可视区域完整显示
  const handleFitFrame = useCallback(() => {
    setZoomMenuOpen(false);
    if (openPPTEditorIfNoFrame()) {
      return;
    }
    fitFrame(board);
  }, [board, openPPTEditorIfNoFrame]);

  const handleFitPPTGlobal = useCallback(() => {
    setZoomMenuOpen(false);
    if (openPPTEditorIfNoFrame()) {
      return;
    }
    fitAllPPTFrames(board);
  }, [board, openPPTEditorIfNoFrame]);

  // 手动切换 minimap 展开状态
  const toggleMinimap = useCallback(() => {
    setMinimapExpanded((prev) => {
      const newValue = !prev;
      setManuallyExpanded(newValue); // 标记为手动操作
      return newValue;
    });
  }, []);

  // 点击画布时收起 minimap
  useEffect(() => {
    if (!minimapExpanded || !board) return;

    const boardContainer = PlaitBoard.getBoardContainer(board);
    if (!boardContainer) return;

    const handleCanvasClick = (e: MouseEvent) => {
      // 检查点击是否在 view-navigation 内部
      const target = e.target as HTMLElement;
      if (containerRef.current?.contains(target)) {
        return; // 点击在导航组件内部，不处理
      }
      
      // 点击画布，收起 minimap
      setMinimapExpanded(false);
      setManuallyExpanded(false);
    };

    boardContainer.addEventListener('mousedown', handleCanvasClick);
    
    return () => {
      boardContainer.removeEventListener('mousedown', handleCanvasClick);
    };
  }, [minimapExpanded, board]);

  // 自动展开 minimap（检测 viewport 变化）
  useEffect(() => {
    if (!showMinimap || !board) return;

    const checkInterval = setInterval(() => {
      const current = getViewportSnapshot(board);
      const last = lastViewportRef.current;
      if (!last) {
        lastViewportRef.current = current;
        return;
      }

      const hasZoomChanged = Math.abs(current.zoom - last.zoom) > 0.001;
      const hasOriginChanged =
        Math.abs(current.originX - last.originX) > 0.5 ||
        Math.abs(current.originY - last.originY) > 0.5;

      const hasInteraction = hasZoomChanged || hasOriginChanged;

      if (hasInteraction) {
        // 更新记录
        lastViewportRef.current = current;

        // 有交互时自动展开小地图
        if (!minimapExpanded) {
          setMinimapExpanded(true);
          setManuallyExpanded(false); // 标记为自动触发
        }

        // 清除之前的自动隐藏定时器
        if (autoHideTimerRef.current) {
          clearTimeout(autoHideTimerRef.current);
        }
      }
    }, 100);

    return () => {
      clearInterval(checkInterval);
    };
  }, [showMinimap, board, minimapExpanded]);

  // 自动隐藏 minimap（非手动展开时）
  useEffect(() => {
    if (!minimapExpanded || manuallyExpanded) return;

    // 设置自动隐藏定时器
    autoHideTimerRef.current = setTimeout(() => {
      setMinimapExpanded(false);
    }, AUTO_HIDE_DELAY);

    return () => {
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
      }
    };
  }, [minimapExpanded, manuallyExpanded]);

  // 处理百分比按钮点击
  const handleZoomPercentClick = useCallback(() => {
    setZoomMenuOpen((prev) => !prev);
  }, []);

  // 当前缩放百分比
  const zoomPercentage = Math.round((board?.viewport?.zoom || 1) * 100);

  return (
    <div
      className={`view-navigation ${ATTACHED_ELEMENT_CLASS_NAME}`}
      style={{
        right: rightOffset,
        zIndex: Z_INDEX.VIEW_NAVIGATION,
      }}
      ref={containerRef}
      data-testid="view-navigation"
    >
      {/* 缩放控制区域 */}
      <div className="view-navigation__zoom">
        <HoverTip content={t('zoom.out')} showArrow={false}>
          <button
            className="view-navigation__zoom-btn"
            onClick={handleZoomOut}
            aria-label={t('zoom.out')}
            data-track="view_nav_zoom_out"
            data-testid="zoom-out"
          >
            <MinusIcon />
          </button>
        </HoverTip>

        <Popover
          sideOffset={8}
          open={zoomMenuOpen}
          onOpenChange={setZoomMenuOpen}
          placement="bottom"
        >
          <HoverTip content={t('zoom.fit')} showArrow={false}>
            <PopoverTrigger asChild>
              <button
                className="view-navigation__zoom-percent"
                onClick={handleZoomPercentClick}
                aria-label={t('zoom.fit')}
                data-track="view_nav_zoom_menu"
                data-testid="zoom-display"
              >
                {zoomPercentage}%
              </button>
            </PopoverTrigger>
          </HoverTip>
          <PopoverContent
            className={ATTACHED_ELEMENT_CLASS_NAME}
            container={container}
            style={{ zIndex: Z_INDEX.POPOVER }}
          >
            <div className="view-navigation-zoom-menu">
              <button
                className="zoom-menu-item"
                onClick={handleFitViewport}
                data-track="view_nav_zoom_fit"
              >
                <span className="zoom-menu-item__label">{t('zoom.fit')}</span>
                <span className="zoom-menu-item__shortcut">⌘⇧=</span>
              </button>
              <button
                className="zoom-menu-item"
                onClick={handleFitFrame}
                data-track="view_nav_zoom_fit_frame"
              >
                <span className="zoom-menu-item__label">{t('zoom.fitFrame')}</span>
              </button>
              <button
                className="zoom-menu-item"
                onClick={handleFitPPTGlobal}
                data-track="view_nav_zoom_fit_ppt_global"
              >
                <span className="zoom-menu-item__label">{t('zoom.fitPPTGlobal')}</span>
              </button>
              <button
                className="zoom-menu-item"
                onClick={handleZoom100}
                data-track="view_nav_zoom_100"
              >
                <span className="zoom-menu-item__label">{t('zoom.100')}</span>
                <span className="zoom-menu-item__shortcut">⌘0</span>
              </button>
            </div>
          </PopoverContent>
        </Popover>

        <HoverTip content={t('zoom.in')} showArrow={false}>
          <button
            className="view-navigation__zoom-btn"
            onClick={handleZoomIn}
            aria-label={t('zoom.in')}
            data-track="view_nav_zoom_in"
            data-testid="zoom-in"
          >
            <AddIcon />
          </button>
        </HoverTip>

        {/* Minimap 展开按钮 */}
        {showMinimap && (
          <HoverTip
            content={minimapExpanded ? '折叠小地图' : '展开小地图'}
            showArrow={false}
          >
            <button
              className={`view-navigation__minimap-toggle ${minimapExpanded ? 'view-navigation__minimap-toggle--expanded' : ''}`}
              onClick={toggleMinimap}
              aria-label={minimapExpanded ? '折叠小地图' : '展开小地图'}
              data-track="view_nav_minimap_toggle"
            >
              <ChevronDownIcon />
            </button>
          </HoverTip>
        )}
      </div>

      {/* Minimap - 展开时显示 */}
      {showMinimap && minimapExpanded && (
        <div className="view-navigation__minimap">
          <Minimap
            board={board}
            displayMode="always"
            config={{
              width: 180,
              height: 120,
              position: 'top-right',
              margin: 0,
              collapsible: false,
              defaultExpanded: true,
            }}
          />
        </div>
      )}
    </div>
  );
};

export default ViewNavigation;
