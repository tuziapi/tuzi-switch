/**
 * Frame 标题相关工具函数
 *
 * 标题区域命中检测和画布内编辑器
 */
import { PlaitBoard, RectangleClient, Point, Transforms } from '@plait/core';
import { PlaitFrame, getFrameDisplayName } from '../types/frame.types';
import {
  FRAME_TITLE_FONT_SIZE,
  FRAME_TITLE_PADDING,
  FRAME_TITLE_OFFSET_Y,
  FRAME_TITLE_HEIGHT,
  FRAME_TITLE_MIN_WIDTH,
} from '../components/frame-element/frame.generator';

function estimateTitleTextWidth(name: string): number {
  return Array.from(name).reduce((width, char) => {
    return (
      width +
      (char.charCodeAt(0) > 255
        ? FRAME_TITLE_FONT_SIZE
        : FRAME_TITLE_FONT_SIZE * 0.6)
    );
  }, 0);
}

/**
 * 获取 Frame 标题区域的矩形范围（估算，基于 name 字符数）
 */
export function getFrameTitleRect(
  frame: PlaitFrame
): { x: number; y: number; width: number; height: number } {
  const rect = RectangleClient.getRectangleByPoints(frame.points);
  const name = getFrameDisplayName(frame);
  const textWidth = estimateTitleTextWidth(name);
  return {
    x: rect.x,
    y: rect.y + FRAME_TITLE_OFFSET_Y - FRAME_TITLE_HEIGHT,
    width: Math.max(
      FRAME_TITLE_MIN_WIDTH,
      textWidth + FRAME_TITLE_PADDING * 2
    ),
    height: FRAME_TITLE_HEIGHT,
  };
}

/**
 * 判断点是否在矩形内
 */
export function isPointInRect(
  point: Point,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    point[0] >= rect.x &&
    point[0] <= rect.x + rect.width &&
    point[1] >= rect.y &&
    point[1] <= rect.y + rect.height
  );
}

/**
 * 在画布上创建 Frame 标题编辑器（HTML input overlay）
 */
export function createFrameTitleEditor(
  board: PlaitBoard,
  frame: PlaitFrame,
): void {
  const host = PlaitBoard.getHost(board);
  const boardContainer = host.closest('.plait-board-container') as HTMLElement;
  if (!boardContainer) return;

  const rect = RectangleClient.getRectangleByPoints(frame.points);
  const viewport = board.viewport;
  const zoom = viewport?.zoom ?? 1;

  // viewBox 坐标转为屏幕坐标
  const hostRect = host.getBoundingClientRect();
  const viewBox = host.viewBox?.baseVal;
  const viewBoxX = viewBox?.x ?? 0;
  const viewBoxY = viewBox?.y ?? 0;

  const screenX = (rect.x - viewBoxX) * zoom + hostRect.left;
  const screenY =
    (rect.y + FRAME_TITLE_OFFSET_Y - FRAME_TITLE_HEIGHT - viewBoxY) * zoom +
    hostRect.top;

  // 创建编辑容器
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    left: ${screenX}px;
    top: ${screenY}px;
    z-index: 10000;
  `;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = getFrameDisplayName(frame);
  input.style.cssText = `
    font-size: ${FRAME_TITLE_FONT_SIZE * zoom}px;
    font-family: system-ui, -apple-system, sans-serif;
    font-weight: 600;
    color: #fff;
    background: var(--td-brand-color, #F39C12);
    border: 2px solid var(--td-brand-color, #0052d9);
    border-radius: 8px;
    padding: 0 ${FRAME_TITLE_PADDING * zoom}px;
    height: ${FRAME_TITLE_HEIGHT * zoom}px;
    outline: none;
    min-width: 60px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  `;

  overlay.appendChild(input);
  document.body.appendChild(overlay);

  let cancelled = false;
  const commitAndClose = () => {
    if (cancelled) {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      return;
    }
    const newName = input.value.trim();
    if (newName && newName !== frame.name) {
      const index = board.children.findIndex((el) => el.id === frame.id);
      if (index !== -1) {
        Transforms.setNode(board, { name: newName } as any, [index]);
      }
    }
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  };

  input.addEventListener('blur', commitAndClose);
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      cancelled = true;
      input.blur();
    }
    e.stopPropagation();
  });
  // 防止输入事件冒泡到画布
  input.addEventListener('keyup', (e) => e.stopPropagation());
  input.addEventListener('input', (e) => e.stopPropagation());
  input.addEventListener('pointerdown', (e) => e.stopPropagation());

  // 聚焦并选中文本
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}
