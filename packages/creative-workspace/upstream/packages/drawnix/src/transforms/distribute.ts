/**
 * 元素间距分布 Transform
 * Element Distribution Transforms
 */

import {
  PlaitBoard,
  PlaitElement,
  getSelectedElements,
  getRectangleByElements,
} from '@plait/core';
import {
  getFrameAwareSelection,
  moveElementWithFrameRelations,
} from './frame-aware';

export type DistributeType = 'horizontal' | 'vertical' | 'auto';

/**
 * 获取元素的边界矩形
 */
const getElementRect = (board: PlaitBoard, element: PlaitElement) => {
  return getRectangleByElements(board, [element], false);
};

/**
 * 水平等间距分布
 * 将元素按水平方向等间距排列
 */
const distributeHorizontal = (board: PlaitBoard) => {
  const selectedElements = getSelectedElements(board);

  // 至少需要选中3个元素才能等间距分布
  if (selectedElements.length < 3) {
    return;
  }

  const { primaryElements, relatedByFrameId } = getFrameAwareSelection(
    board,
    selectedElements
  );
  if (primaryElements.length < 3) {
    return;
  }

  // 获取每个元素的矩形信息，并按 x 坐标排序
  const elementsWithRect = primaryElements.map((element) => ({
    element,
    rect: getElementRect(board, element),
  }));

  elementsWithRect.sort((a, b) => a.rect.x - b.rect.x);

  // 计算总宽度和元素总宽度
  const firstRect = elementsWithRect[0].rect;
  const lastRect = elementsWithRect[elementsWithRect.length - 1].rect;
  const totalSpan = lastRect.x + lastRect.width - firstRect.x;
  const totalElementWidth = elementsWithRect.reduce(
    (sum, item) => sum + item.rect.width,
    0
  );

  // 计算间距
  const totalGap = totalSpan - totalElementWidth;
  const gapCount = elementsWithRect.length - 1;
  const gap = gapCount > 0 ? totalGap / gapCount : 0;

  // 从第二个元素开始调整位置（第一个和最后一个保持不动）
  let currentX = firstRect.x + firstRect.width + gap;
  const movedElementIds = new Set<string>();

  for (let i = 1; i < elementsWithRect.length - 1; i++) {
    const { element, rect } = elementsWithRect[i];
    const deltaX = currentX - rect.x;

    if (Math.abs(deltaX) > 0.01) {
      moveElementWithFrameRelations(
        board,
        element,
        deltaX,
        0,
        relatedByFrameId,
        movedElementIds
      );
    }

    currentX += rect.width + gap;
  }
};

/**
 * 垂直等间距分布
 * 将元素按垂直方向等间距排列
 */
const distributeVertical = (board: PlaitBoard) => {
  const selectedElements = getSelectedElements(board);

  // 至少需要选中3个元素才能等间距分布
  if (selectedElements.length < 3) {
    return;
  }

  const { primaryElements, relatedByFrameId } = getFrameAwareSelection(
    board,
    selectedElements
  );
  if (primaryElements.length < 3) {
    return;
  }

  // 获取每个元素的矩形信息，并按 y 坐标排序
  const elementsWithRect = primaryElements.map((element) => ({
    element,
    rect: getElementRect(board, element),
  }));

  elementsWithRect.sort((a, b) => a.rect.y - b.rect.y);

  // 计算总高度和元素总高度
  const firstRect = elementsWithRect[0].rect;
  const lastRect = elementsWithRect[elementsWithRect.length - 1].rect;
  const totalSpan = lastRect.y + lastRect.height - firstRect.y;
  const totalElementHeight = elementsWithRect.reduce(
    (sum, item) => sum + item.rect.height,
    0
  );

  // 计算间距
  const totalGap = totalSpan - totalElementHeight;
  const gapCount = elementsWithRect.length - 1;
  const gap = gapCount > 0 ? totalGap / gapCount : 0;

  // 从第二个元素开始调整位置（第一个和最后一个保持不动）
  let currentY = firstRect.y + firstRect.height + gap;
  const movedElementIds = new Set<string>();

  for (let i = 1; i < elementsWithRect.length - 1; i++) {
    const { element, rect } = elementsWithRect[i];
    const deltaY = currentY - rect.y;

    if (Math.abs(deltaY) > 0.01) {
      moveElementWithFrameRelations(
        board,
        element,
        0,
        deltaY,
        relatedByFrameId,
        movedElementIds
      );
    }

    currentY += rect.height + gap;
  }
};

/**
 * 自动排列
 * 根据元素的位置分布自动决定是水平还是垂直排列
 * 如果宽度大于高度，则按水平网格排列；否则按垂直网格排列
 */
const autoArrange = (board: PlaitBoard) => {
  const selectedElements = getSelectedElements(board);

  if (selectedElements.length < 2) {
    return;
  }

  const { primaryElements, relatedByFrameId } = getFrameAwareSelection(
    board,
    selectedElements
  );
  if (primaryElements.length < 2) {
    return;
  }

  // 获取整体边界
  const boundingRect = getRectangleByElements(board, primaryElements, false);

  // 获取每个元素的矩形信息
  const elementsWithRect = primaryElements.map((element) => ({
    element,
    rect: getElementRect(board, element),
  }));

  // 计算平均元素尺寸
  const avgWidth =
    elementsWithRect.reduce((sum, item) => sum + item.rect.width, 0) /
    elementsWithRect.length;
  const avgHeight =
    elementsWithRect.reduce((sum, item) => sum + item.rect.height, 0) /
    elementsWithRect.length;

  // 计算网格布局
  const count = elementsWithRect.length;
  const aspectRatio = boundingRect.width / boundingRect.height;

  // 根据整体边界的宽高比决定列数
  let cols: number;
  if (aspectRatio > 1.5) {
    // 宽度明显大于高度，优先水平排列
    cols = Math.ceil(Math.sqrt(count * aspectRatio));
  } else if (aspectRatio < 0.67) {
    // 高度明显大于宽度，优先垂直排列
    cols = Math.ceil(Math.sqrt(count / aspectRatio));
  } else {
    // 接近正方形，使用平方根
    cols = Math.ceil(Math.sqrt(count));
  }

  cols = Math.max(1, Math.min(cols, count));
  const rows = Math.ceil(count / cols);

  // 计算网格间距
  const gapX = avgWidth * 0.2; // 20% 宽度作为水平间距
  const gapY = avgHeight * 0.2; // 20% 高度作为垂直间距

  // 按当前位置排序元素（从左到右，从上到下）
  elementsWithRect.sort((a, b) => {
    const rowA = Math.floor(a.rect.y / (avgHeight + gapY));
    const rowB = Math.floor(b.rect.y / (avgHeight + gapY));
    if (rowA !== rowB) return rowA - rowB;
    return a.rect.x - b.rect.x;
  });

  // 重新排列元素
  const startX = boundingRect.x;
  const startY = boundingRect.y;
  const movedElementIds = new Set<string>();

  elementsWithRect.forEach((item, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);

    const targetX = startX + col * (avgWidth + gapX);
    const targetY = startY + row * (avgHeight + gapY);

    const deltaX = targetX - item.rect.x;
    const deltaY = targetY - item.rect.y;

    if (Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01) {
      moveElementWithFrameRelations(
        board,
        item.element,
        deltaX,
        deltaY,
        relatedByFrameId,
        movedElementIds
      );
    }
  });
};

/**
 * 间距分布 Transforms 命名空间
 */
export const DistributeTransforms = {
  /**
   * 水平等间距分布
   */
  distributeHorizontal,

  /**
   * 垂直等间距分布
   */
  distributeVertical,

  /**
   * 自动排列
   */
  autoArrange,
};
