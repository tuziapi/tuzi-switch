/**
 * FrameSlideshow Component
 *
 * 全屏幻灯片播放 Frame：
 * - 操纵画布 viewport 对准 Frame
 * - 全屏黑色蒙层遮住非 Frame 区域，只露出 Frame 内容
 * - 支持 PPT 通用快捷键
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  PlaitBoard,
  PlaitPointerType,
  BoardTransforms,
  RectangleClient,
} from '@plait/core';
import { BoardCreationMode, setCreationMode } from '@plait/common';
import {
  PlaitFrame,
  getFrameDisplayName,
  isFrameElement,
} from '../../types/frame.types';
import { Z_INDEX } from '../../constants/z-index';
import { FreehandShape } from '../../plugins/freehand/type';
import { useSetPointer } from '../../hooks/use-drawnix';
import {
  HandIcon,
  FeltTipPenIcon,
  EraseIcon,
  LaserPointerIcon,
  StrokeStyleNormalIcon,
  StrokeStyleDashedIcon,
  StrokeStyleDotedIcon,
  StrokeStyleDoubleIcon,
} from '../icons';
import { HoverTip } from '../shared';
import {
  getFreehandSettings,
  setFreehandStrokeColor,
  setFreehandStrokeWidth,
  setFreehandStrokeStyle,
  FreehandStrokeStyle,
} from '../../plugins/freehand/freehand-settings';
import {
  getPPTSlideTransition,
  type PPTSlideTransition,
} from '../../services/ppt';
import {
  exitFullscreenIfActive,
  requestFullscreenIfAllowed,
} from '../../utils/runtime-helpers';

interface FrameSlideshowProps {
  visible: boolean;
  board: PlaitBoard;
  onClose: () => void;
  /** 初始播放的 Frame ID（如画布有选中的 Frame），缺省从第一帧开始 */
  initialFrameId?: string;
}

/** Frame 在屏幕上的位置信息 */
interface FrameScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SlideshowTransitionState {
  key: number;
  rect: FrameScreenRect;
  type: Exclude<PPTSlideTransition['type'], 'none'>;
  durationMs: number;
}

const PADDING = 60;
const SLIDESHOW_CLASS = 'slideshow-active';

/** 添加/移除 slideshow class，用于 CSS 隐藏所有 UI 覆盖层 */
function setSlideshowMode(active: boolean) {
  if (active) {
    document.documentElement.classList.add(SLIDESHOW_CLASS);
  } else {
    document.documentElement.classList.remove(SLIDESHOW_CLASS);
  }
}

function getFrames(board: PlaitBoard): PlaitFrame[] {
  const frames: PlaitFrame[] = [];
  for (const el of board.children) {
    if (isFrameElement(el)) {
      frames.push(el as PlaitFrame);
    }
  }
  return frames;
}

function prefersReducedMotion(): boolean {
  return Boolean(
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

function getFrameTransition(frame?: PlaitFrame): PPTSlideTransition {
  return getPPTSlideTransition(
    (frame as PlaitFrame & { pptMeta?: { transition?: PPTSlideTransition } })
      ?.pptMeta?.transition
  );
}

/**
 * 将 viewport 对准 Frame，返回 Frame 在屏幕上的矩形位置。
 *
 * 关键：不依赖 toHostPointFromViewBoxPoint（可能有时序问题），
 * 而是根据 viewport 居中算法直接计算 Frame 在屏幕上的位置。
 */
function focusFrameAndGetScreenRect(
  board: PlaitBoard,
  frame: PlaitFrame
): FrameScreenRect {
  const rect = RectangleClient.getRectangleByPoints(frame.points);
  const container = PlaitBoard.getBoardContainer(board);
  const vw = container.clientWidth;
  const vh = container.clientHeight;

  // 计算 zoom 使 Frame 适配视口（留 padding）
  const scaleX = (vw - PADDING * 2) / rect.width;
  const scaleY = (vh - PADDING * 2) / rect.height;
  const zoom = Math.min(scaleX, scaleY, 3);

  // 居中 Frame：origination 是视口左上角在世界坐标中的位置
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const origination: [number, number] = [
    cx - vw / 2 / zoom,
    cy - vh / 2 / zoom,
  ];
  BoardTransforms.updateViewport(board, origination, zoom);

  // 直接计算 Frame 在屏幕上的位置：
  // Frame 左上角在世界坐标中: (rect.x, rect.y)
  // 相对于视口左上角的偏移: (rect.x - origination[0], rect.y - origination[1])
  // 乘以 zoom 得到屏幕像素偏移
  const containerBounds = container.getBoundingClientRect();
  const screenLeft = containerBounds.left + (rect.x - origination[0]) * zoom;
  const screenTop = containerBounds.top + (rect.y - origination[1]) * zoom;
  const screenWidth = rect.width * zoom;
  const screenHeight = rect.height * zoom;

  return {
    left: screenLeft,
    top: screenTop,
    width: screenWidth,
    height: screenHeight,
  };
}

/**
 * 根据 Frame 屏幕矩形生成四块遮罩的内联样式
 */
function getMaskBlockStyles(r: FrameScreenRect): React.CSSProperties[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 上方
  const top: React.CSSProperties = {
    top: 0,
    left: 0,
    width: vw,
    height: Math.max(0, r.top),
  };
  // 下方
  const bottom: React.CSSProperties = {
    top: r.top + r.height,
    left: 0,
    width: vw,
    height: Math.max(0, vh - r.top - r.height),
  };
  // 左侧
  const left: React.CSSProperties = {
    top: r.top,
    left: 0,
    width: Math.max(0, r.left),
    height: r.height,
  };
  // 右侧
  const right: React.CSSProperties = {
    top: r.top,
    left: r.left + r.width,
    width: Math.max(0, vw - r.left - r.width),
    height: r.height,
  };

  return [top, bottom, left, right];
}

type ToolType = 'select' | 'pen' | 'eraser' | 'laser';

const PEN_COLORS = [
  '#000000',
  '#e91e63',
  '#f39c12',
  '#4caf50',
  '#2196f3',
  '#9c27b0',
  '#ffffff',
];

const STROKE_STYLES: { style: FreehandStrokeStyle; icon: React.ReactNode }[] = [
  { style: FreehandStrokeStyle.solid, icon: <StrokeStyleNormalIcon /> },
  { style: FreehandStrokeStyle.dashed, icon: <StrokeStyleDashedIcon /> },
  { style: FreehandStrokeStyle.dotted, icon: <StrokeStyleDotedIcon /> },
  { style: FreehandStrokeStyle.double, icon: <StrokeStyleDoubleIcon /> },
];

const STROKE_WIDTHS = [1, 2, 4, 8];

export const FrameSlideshow: React.FC<FrameSlideshowProps> = ({
  visible,
  board,
  onClose,
  initialFrameId,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [frameRect, setFrameRect] = useState<FrameScreenRect | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const setPointer = useSetPointer();
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const pendingFrameClickRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef(false);
  const savedViewportRef = useRef<{
    origination: [number, number] | null;
    zoom: number;
  } | null>(null);
  const savedPointerRef = useRef<string | null>(null);
  const framesRef = useRef<PlaitFrame[]>([]);
  const currentIndexRef = useRef(0);
  const transitionKeyRef = useRef(0);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [activeTransition, setActiveTransition] =
    useState<SlideshowTransitionState | null>(null);

  // 画笔设置状态（从 board 初始化）
  const initSettings = visible ? getFreehandSettings(board) : null;
  const [penColor, setPenColor] = useState(
    initSettings?.strokeColor ?? '#000000'
  );
  const [penStrokeStyle, setPenStrokeStyle] = useState<FreehandStrokeStyle>(
    initSettings?.strokeStyle ?? FreehandStrokeStyle.solid
  );
  const [penStrokeWidth, setPenStrokeWidth] = useState(
    initSettings?.strokeWidth ?? 2
  );

  const handlePenColorChange = useCallback(
    (color: string) => {
      setPenColor(color);
      setFreehandStrokeColor(board, color);
    },
    [board]
  );

  const handlePenStrokeStyleChange = useCallback(
    (style: FreehandStrokeStyle) => {
      setPenStrokeStyle(style);
      setFreehandStrokeStyle(board, style);
    },
    [board]
  );

  const handlePenStrokeWidthChange = useCallback(
    (width: number) => {
      setPenStrokeWidth(width);
      setFreehandStrokeWidth(board, width);
    },
    [board]
  );

  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
    }
    controlsTimerRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  }, []);

  /** 切换工具 */
  const switchTool = useCallback(
    (tool: ToolType) => {
      setActiveTool(tool);
      resetControlsTimer();

      if (tool === 'select') {
        BoardTransforms.updatePointerType(board, PlaitPointerType.selection);
        setPointer(PlaitPointerType.selection);
      } else {
        const pointerMap: Record<string, FreehandShape> = {
          pen: FreehandShape.feltTipPen,
          eraser: FreehandShape.eraser,
          laser: FreehandShape.laserPointer,
        };
        const pointer = pointerMap[tool];
        setCreationMode(board, BoardCreationMode.drawing);
        BoardTransforms.updatePointerType(board, pointer);
        setPointer(pointer);
      }
    },
    [board, resetControlsTimer, setPointer]
  );

  /** 切换到指定 Frame */
  const goToFrame = useCallback(
    (index: number, options: { animate?: boolean } = {}) => {
      const frames = framesRef.current;
      if (!board || index < 0 || index >= frames.length) return;

      const frame = frames[index];
      const rect = focusFrameAndGetScreenRect(board, frame);
      const transition = getFrameTransition(frame);
      const shouldAnimate =
        options.animate !== false &&
        currentIndexRef.current !== index &&
        transition.type !== 'none' &&
        !prefersReducedMotion();

      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
      }

      if (shouldAnimate && transition.type !== 'none') {
        const key = transitionKeyRef.current + 1;
        transitionKeyRef.current = key;
        const durationMs = transition.durationMs || 700;
        const transitionType = transition.type as Exclude<
          PPTSlideTransition['type'],
          'none'
        >;
        setActiveTransition({
          key,
          rect,
          type: transitionType,
          durationMs,
        });
        transitionTimerRef.current = setTimeout(() => {
          setActiveTransition((current) =>
            current?.key === key ? null : current
          );
        }, durationMs + 120);
      } else {
        setActiveTransition(null);
      }

      setFrameRect(rect);
      setCurrentIndex(index);
      currentIndexRef.current = index;
      resetControlsTimer();
    },
    [board, resetControlsTimer]
  );

  // 进入幻灯片：保存 viewport、pointer、对准第一个 Frame
  useEffect(() => {
    if (!visible) return;

    const frames = getFrames(board);
    if (frames.length === 0) {
      onClose();
      return;
    }
    framesRef.current = frames;

    // 保存当前 viewport 和 pointer
    const vp = board.viewport;
    savedViewportRef.current = {
      origination: vp?.origination
        ? [vp.origination[0], vp.origination[1]]
        : null,
      zoom: vp?.zoom ?? 1,
    };
    savedPointerRef.current = board.pointer;

    // 隐藏所有 UI 覆盖层
    setSlideshowMode(true);

    // 计算起始帧索引：如果指定了 initialFrameId，定位到该 Frame
    let startIndex = 0;
    if (initialFrameId) {
      const idx = frames.findIndex((f) => f.id === initialFrameId);
      if (idx >= 0) {
        startIndex = idx;
      }
    }

    // 先定位到起始帧
    goToFrame(startIndex, { animate: false });

    // 尝试请求全屏，成功后重新定位
    const fullscreenRequest = requestFullscreenIfAllowed(
      document.documentElement
    );
    fullscreenRequest
      ?.then(() => {
        setTimeout(() => goToFrame(startIndex, { animate: false }), 300);
      })
      .catch(() => undefined);

    return () => {
      setSlideshowMode(false);
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
      }
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 退出时恢复 viewport 和 pointer
  const handleClose = useCallback(() => {
    setSlideshowMode(false);
    const saved = savedViewportRef.current;
    if (saved && board) {
      const orig = saved.origination ?? [0, 0];
      BoardTransforms.updateViewport(
        board,
        orig as [number, number],
        saved.zoom
      );
    }
    // 恢复 pointer（同时更新 board 和 React context）
    if (savedPointerRef.current !== null) {
      BoardTransforms.updatePointerType(board, savedPointerRef.current);
      setPointer(savedPointerRef.current as Parameters<typeof setPointer>[0]);
    }
    exitFullscreenIfActive()?.catch(() => undefined);
    setFrameRect(null);
    setActiveTransition(null);
    setActiveTool('select');
    onClose();
  }, [board, onClose, setPointer]);

  const goToNextFrameOrClose = useCallback(() => {
    const frames = framesRef.current;
    if (currentIndex < frames.length - 1) {
      goToFrame(currentIndex + 1);
      return;
    }
    handleClose();
  }, [currentIndex, goToFrame, handleClose]);

  // 监听全屏退出 → 关闭幻灯片
  useEffect(() => {
    if (!visible) return;

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && visible) {
        setSlideshowMode(false);
        const saved = savedViewportRef.current;
        if (saved && board) {
          const orig = saved.origination ?? [0, 0];
          BoardTransforms.updateViewport(
            board,
            orig as [number, number],
            saved.zoom
          );
        }
        // 恢复 pointer（同时更新 board 和 React context）
        if (savedPointerRef.current !== null) {
          BoardTransforms.updatePointerType(board, savedPointerRef.current);
          setPointer(
            savedPointerRef.current as Parameters<typeof setPointer>[0]
          );
        }
        setFrameRect(null);
        setActiveTransition(null);
        setActiveTool('select');
        onClose();
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [visible, board, onClose, setPointer]);

  // 窗口 resize 时重新计算
  useEffect(() => {
    if (!visible) return;

    const handleResize = () => {
      goToFrame(currentIndex);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [visible, currentIndex, goToFrame]);

  // 键盘导航
  useEffect(() => {
    if (!visible) return;
    const frames = framesRef.current;
    if (frames.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      resetControlsTimer();

      switch (e.key) {
        case 'ArrowRight':
        case ' ':
        case 'Enter':
        case 'PageDown':
        case 'ArrowDown': {
          e.preventDefault();
          setCurrentIndex((prev) => {
            const next = Math.min(prev + 1, frames.length - 1);
            if (next !== prev) goToFrame(next);
            return next;
          });
          break;
        }
        case 'ArrowLeft':
        case 'Backspace':
        case 'PageUp':
        case 'ArrowUp': {
          e.preventDefault();
          setCurrentIndex((prev) => {
            const next = Math.max(prev - 1, 0);
            if (next !== prev) goToFrame(next);
            return next;
          });
          break;
        }
        case 'Escape': {
          e.preventDefault();
          handleClose();
          break;
        }
        case 'Home': {
          e.preventDefault();
          goToFrame(0);
          break;
        }
        case 'End': {
          e.preventDefault();
          goToFrame(frames.length - 1);
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, goToFrame, handleClose, resetControlsTimer]);

  // 鼠标点击切换下一页（仅在选择工具模式下生效）
  const handleSlideshowClick = useCallback(
    (e: React.MouseEvent) => {
      // 只在选择模式下点击才切换页面，画笔/橡皮擦/激光笔模式不处理
      if (activeTool !== 'select') return;

      // 忽略来自控制栏、导航按钮等交互元素的点击
      const target = e.target as HTMLElement;
      if (
        target.closest('.frame-slideshow__controls') ||
        target.closest('.frame-slideshow__nav')
      ) {
        return;
      }
      if (target.closest('[data-slideshow-media-control]')) {
        return;
      }

      goToNextFrameOrClose();
    },
    [activeTool, goToNextFrameOrClose]
  );

  // 选择模式下：Frame 内非媒体点击翻页；媒体控件保留原生播放能力。
  useEffect(() => {
    if (!visible || !frameRect || activeTool !== 'select') {
      pendingFrameClickRef.current = null;
      suppressNextClickRef.current = false;
      return;
    }

    const isInsideCurrentFrame = (event: MouseEvent | PointerEvent) => {
      return (
        event.clientX >= frameRect.left &&
        event.clientX <= frameRect.left + frameRect.width &&
        event.clientY >= frameRect.top &&
        event.clientY <= frameRect.top + frameRect.height
      );
    };

    const isSlideshowUiTarget = (target: EventTarget | null) => {
      return (
        target instanceof Element &&
        !!target.closest('.frame-slideshow__controls, .frame-slideshow__nav')
      );
    };

    const isMediaTarget = (target: EventTarget | null) => {
      return (
        target instanceof Element &&
        !!target.closest('[data-slideshow-media-control], video, audio')
      );
    };

    const isLegacyAudioTarget = (target: EventTarget | null) => {
      return (
        target instanceof Element &&
        !!target.closest('[data-slideshow-legacy-audio]')
      );
    };

    const shouldHandleFrameClick = (event: MouseEvent | PointerEvent) => {
      const target = event.target;
      return (
        isInsideCurrentFrame(event) &&
        !isSlideshowUiTarget(target) &&
        !isMediaTarget(target) &&
        !isLegacyAudioTarget(target)
      );
    };

    const stopCanvasInteraction = (event: MouseEvent | PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handlePointerDownCapture = (event: PointerEvent) => {
      if (
        event.button === 0 &&
        isInsideCurrentFrame(event) &&
        isLegacyAudioTarget(event.target)
      ) {
        pendingFrameClickRef.current = null;
        event.stopPropagation();
        return;
      }

      if (event.button !== 0 || !shouldHandleFrameClick(event)) {
        pendingFrameClickRef.current = null;
        return;
      }
      pendingFrameClickRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
      stopCanvasInteraction(event);
    };

    const handlePointerUpCapture = (event: PointerEvent) => {
      if (
        event.button === 0 &&
        isInsideCurrentFrame(event) &&
        isLegacyAudioTarget(event.target)
      ) {
        pendingFrameClickRef.current = null;
        event.stopPropagation();
        return;
      }

      const pending = pendingFrameClickRef.current;
      if (!pending) return;

      pendingFrameClickRef.current = null;
      if (!shouldHandleFrameClick(event)) return;

      stopCanvasInteraction(event);
      suppressNextClickRef.current = true;

      const movedDistance = Math.hypot(
        event.clientX - pending.x,
        event.clientY - pending.y
      );
      if (movedDistance > 5) return;

      goToNextFrameOrClose();
    };

    const handleClickCapture = (event: MouseEvent) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        stopCanvasInteraction(event);
        return;
      }

      if (!shouldHandleFrameClick(event)) return;
      stopCanvasInteraction(event);
    };

    document.addEventListener('pointerdown', handlePointerDownCapture, true);
    document.addEventListener('pointerup', handlePointerUpCapture, true);
    document.addEventListener('click', handleClickCapture, true);

    return () => {
      document.removeEventListener(
        'pointerdown',
        handlePointerDownCapture,
        true
      );
      document.removeEventListener('pointerup', handlePointerUpCapture, true);
      document.removeEventListener('click', handleClickCapture, true);
    };
  }, [activeTool, frameRect, goToNextFrameOrClose, visible]);

  // 鼠标移动显示控件
  useEffect(() => {
    if (!visible) return;
    const handleMouseMove = () => resetControlsTimer();
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [visible, resetControlsTimer]);

  if (!visible || !frameRect) return null;

  const frames = framesRef.current;
  const currentFrame = frames[currentIndex];
  const maskStyles = getMaskBlockStyles(frameRect);
  const transitionStyle = activeTransition
    ? ({
        left: activeTransition.rect.left,
        top: activeTransition.rect.top,
        width: activeTransition.rect.width,
        height: activeTransition.rect.height,
        animationDuration: `${activeTransition.durationMs}ms`,
      } as React.CSSProperties)
    : undefined;

  return createPortal(
    <div
      className="frame-slideshow"
      style={{ zIndex: Z_INDEX.SLIDESHOW }}
      onMouseMove={resetControlsTimer}
      onClick={handleSlideshowClick}
    >
      {/* 四块黑色遮罩围住 Frame 区域 */}
      <div className="frame-slideshow__mask">
        {maskStyles.map((style, i) => (
          <div key={i} className="frame-slideshow__mask-block" style={style} />
        ))}
      </div>

      {activeTransition ? (
        <div
          key={activeTransition.key}
          className={`frame-slideshow__transition frame-slideshow__transition--${activeTransition.type}`}
          style={transitionStyle}
        />
      ) : null}

      {/* 底部控制栏 */}
      <div
        className="frame-slideshow__controls"
        style={{ opacity: showControls ? 1 : 0 }}
      >
        {/* 左侧：标题 + ESC 提示 */}
        <div className="frame-slideshow__controls-left">
          {currentFrame && (
            <div className="frame-slideshow__title">
              {getFrameDisplayName(currentFrame, currentIndex + 1)}
            </div>
          )}
          <div className="frame-slideshow__esc-hint">
            按 <kbd>ESC</kbd> 退出
          </div>
        </div>

        {/* 中间：页码指示器 */}
        {frames.length > 0 && (
          <div className="frame-slideshow__indicator">
            <span className="frame-slideshow__indicator-current">
              {currentIndex + 1}
            </span>
            <span className="frame-slideshow__indicator-sep">/</span>
            <span className="frame-slideshow__indicator-total">
              {frames.length}
            </span>
          </div>
        )}

        {/* 右侧：工具按钮 */}
        <div className="frame-slideshow__controls-right">
          {/* 画笔设置面板 - 显示在工具按钮上方 */}
          {activeTool === 'pen' && (
            <div className="frame-slideshow__settings-panel">
              {/* 颜色选择 */}
              <div className="frame-slideshow__pen-colors">
                {PEN_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`frame-slideshow__pen-color ${
                      penColor === color
                        ? 'frame-slideshow__pen-color--active'
                        : ''
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => handlePenColorChange(color)}
                  />
                ))}
              </div>
              <div className="frame-slideshow__pen-divider" />
              {/* 线型选择 */}
              <div className="frame-slideshow__pen-styles">
                {STROKE_STYLES.map(({ style, icon }) => (
                  <button
                    key={style}
                    className={`frame-slideshow__pen-style ${
                      penStrokeStyle === style
                        ? 'frame-slideshow__pen-style--active'
                        : ''
                    }`}
                    onClick={() => handlePenStrokeStyleChange(style)}
                  >
                    {icon}
                  </button>
                ))}
              </div>
              <div className="frame-slideshow__pen-divider" />
              {/* 线宽选择 */}
              <div className="frame-slideshow__pen-widths">
                {STROKE_WIDTHS.map((w) => (
                  <button
                    key={w}
                    className={`frame-slideshow__pen-width ${
                      penStrokeWidth === w
                        ? 'frame-slideshow__pen-width--active'
                        : ''
                    }`}
                    onClick={() => handlePenStrokeWidthChange(w)}
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20">
                      <line
                        x1="3"
                        y1="10"
                        x2="17"
                        y2="10"
                        stroke="currentColor"
                        strokeWidth={w}
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}
          <HoverTip content="选择工具" showArrow={false}>
            <button
              className={`frame-slideshow__tool-btn ${
                activeTool === 'select'
                  ? 'frame-slideshow__tool-btn--active'
                  : ''
              }`}
              onClick={() => switchTool('select')}
            >
              <HandIcon size={20} />
            </button>
          </HoverTip>
          <HoverTip content="画笔" showArrow={false}>
            <button
              className={`frame-slideshow__tool-btn ${
                activeTool === 'pen' ? 'frame-slideshow__tool-btn--active' : ''
              }`}
              onClick={() => switchTool('pen')}
            >
              <FeltTipPenIcon size={20} />
            </button>
          </HoverTip>
          <HoverTip content="橡皮擦" showArrow={false}>
            <button
              className={`frame-slideshow__tool-btn ${
                activeTool === 'eraser'
                  ? 'frame-slideshow__tool-btn--active'
                  : ''
              }`}
              onClick={() => switchTool('eraser')}
            >
              <EraseIcon size={20} />
            </button>
          </HoverTip>
          <HoverTip content="激光笔" showArrow={false}>
            <button
              className={`frame-slideshow__tool-btn ${
                activeTool === 'laser'
                  ? 'frame-slideshow__tool-btn--active'
                  : ''
              }`}
              onClick={() => switchTool('laser')}
            >
              <LaserPointerIcon size={20} />
            </button>
          </HoverTip>
        </div>
      </div>

      {/* 导航按钮 */}
      {currentIndex > 0 && (
        <HoverTip content="上一页" showArrow={false}>
          <button
            className="frame-slideshow__nav frame-slideshow__nav--prev"
            style={{ opacity: showControls ? 1 : 0 }}
            onClick={() => goToFrame(currentIndex - 1)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M15 18l-6-6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </HoverTip>
      )}
      {currentIndex < frames.length - 1 && (
        <HoverTip content="下一页" showArrow={false}>
          <button
            className="frame-slideshow__nav frame-slideshow__nav--next"
            style={{ opacity: showControls ? 1 : 0 }}
            onClick={() => goToFrame(currentIndex + 1)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 18l6-6-6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </HoverTip>
      )}
    </div>,
    (document.getElementById('creative-portals') || document.body)
  );
};
