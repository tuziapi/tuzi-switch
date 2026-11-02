/**
 * 自适应 Frame 工具函数
 *
 * 将视口缩放到选中的 Frame（或第一个 Frame），
 * 并考虑左侧工具栏/抽屉、右侧 ChatDrawer、底部输入栏等遮挡区域。
 */
import {
  PlaitBoard,
  BoardTransforms,
  RectangleClient,
  getSelectedElements,
} from '@plait/core';
import { isFrameElement, type PlaitFrame } from '../types/frame.types';

/** 工具栏右边界兜底值：默认贴边 + 58px 工具栏 */
const DEFAULT_TOOLBAR_RIGHT_EDGE = 58;
/** 底部 AI 输入栏高度 */
const BOTTOM_BAR_HEIGHT = 80;
/** 顶部导航控件高度 */
const TOP_BAR_HEIGHT = 50;
/** 四周留白 */
const FIT_PADDING = 40;

function getToolbarOcclusion(totalWidth: number): {
  left: number;
  right: number;
} {
  const toolbarEl = document.querySelector(
    '.unified-toolbar'
  ) as HTMLElement | null;
  const leftDrawerEl = document.querySelector(
    '.side-drawer--open.side-drawer--toolbar-right'
  ) as HTMLElement | null;
  const isDockRight = document.documentElement.classList.contains(
    'aitu-toolbar-dock-right'
  );
  let left = toolbarEl ? 0 : DEFAULT_TOOLBAR_RIGHT_EDGE;
  let right = 0;

  if (toolbarEl) {
    const rect = toolbarEl.getBoundingClientRect();
    if (isDockRight) {
      right = Math.max(right, totalWidth - rect.left);
    } else {
      left = Math.max(left, rect.right);
    }
  }

  if (leftDrawerEl) {
    const rect = leftDrawerEl.getBoundingClientRect();
    if (isDockRight) {
      right = Math.max(right, totalWidth - rect.left);
    } else {
      left = Math.max(left, rect.right);
    }
  }

  return {
    left: Math.max(0, Math.round(left)),
    right: Math.max(0, Math.round(right)),
  };
}

function fitRectInViewport(
  board: PlaitBoard,
  targetRect: RectangleClient
): boolean {
  if (targetRect.width <= 0 || targetRect.height <= 0) return false;

  const container = PlaitBoard.getBoardContainer(board);
  const totalWidth = container.clientWidth;
  const totalHeight = container.clientHeight;

  // 工具栏/抽屉遮挡：工具栏拖到右侧后，抽屉会改为向左展开
  const toolbarOcclusion = getToolbarOcclusion(totalWidth);
  const leftOccluded = toolbarOcclusion.left;

  // 右侧遮挡：ChatDrawer（如果打开）
  const chatDrawerEl = document.querySelector(
    '.chat-drawer--open'
  ) as HTMLElement | null;
  const rightOccluded = Math.max(
    toolbarOcclusion.right,
    chatDrawerEl ? chatDrawerEl.offsetWidth : 0
  );

  const availableWidth =
    totalWidth - leftOccluded - rightOccluded - FIT_PADDING * 2;
  const availableHeight =
    totalHeight - TOP_BAR_HEIGHT - BOTTOM_BAR_HEIGHT - FIT_PADDING * 2;

  if (availableWidth <= 0 || availableHeight <= 0) return false;

  const zoom = Math.min(
    availableWidth / targetRect.width,
    availableHeight / targetRect.height,
    3
  );

  const visibleCenterX = leftOccluded + FIT_PADDING + availableWidth / 2;
  const visibleCenterY = TOP_BAR_HEIGHT + FIT_PADDING + availableHeight / 2;
  const targetCenterX = targetRect.x + targetRect.width / 2;
  const targetCenterY = targetRect.y + targetRect.height / 2;
  const origination: [number, number] = [
    targetCenterX - visibleCenterX / zoom,
    targetCenterY - visibleCenterY / zoom,
  ];

  BoardTransforms.updateViewport(board, origination, zoom);
  return true;
}

function getAllFrameBounds(board: PlaitBoard): RectangleClient | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of board.children) {
    if (!isFrameElement(el)) continue;

    const rect = RectangleClient.getRectangleByPoints(el.points);
    if (rect.width <= 0 || rect.height <= 0) continue;

    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * 将视口自适应到指定 Frame 或自动选择一个 Frame
 * @returns 是否成功定位到 Frame
 */
export function fitFrame(board: PlaitBoard): boolean {
  // 1. 找到目标 Frame：优先选中的 Frame，否则用第一个 Frame
  const selectedElements = getSelectedElements(board);
  let targetFrame: PlaitFrame | null = null;

  for (const el of selectedElements) {
    if (isFrameElement(el)) {
      targetFrame = el;
      break;
    }
  }

  if (!targetFrame) {
    for (const el of board.children) {
      if (isFrameElement(el)) {
        targetFrame = el;
        break;
      }
    }
  }

  if (!targetFrame) return false;

  // 2. 计算 Frame 的世界坐标矩形
  const frameRect = RectangleClient.getRectangleByPoints(targetFrame.points);

  return fitRectInViewport(board, frameRect);
}

/**
 * 将视口自适应到所有 PPT 页面（Frame）的联合边界
 * @returns 是否成功定位到页面全局范围
 */
export function fitAllPPTFrames(board: PlaitBoard): boolean {
  const frameBounds = getAllFrameBounds(board);
  if (!frameBounds) return false;

  return fitRectInViewport(board, frameBounds);
}
