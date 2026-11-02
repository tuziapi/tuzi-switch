/**
 * 元素对齐 Transform
 * Element Alignment Transforms
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

export type AlignmentType =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom';

/**
 * 获取元素的边界矩形
 */
const getElementRect = (board: PlaitBoard, element: PlaitElement) => {
  return getRectangleByElements(board, [element], false);
};

/**
 * 对齐选中的元素
 */
export const alignElements = (
  board: PlaitBoard,
  alignmentType: AlignmentType
) => {
  const selectedElements = getSelectedElements(board);

  // 至少需要选中2个元素才能对齐
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

  // 获取所有选中元素的整体边界
  const boundingRect = getRectangleByElements(board, primaryElements, false);
  const movedElementIds = new Set<string>();

  // 根据对齐类型计算每个元素的偏移量
  primaryElements.forEach((element) => {
    const elementRect = getElementRect(board, element);
    let deltaX = 0;
    let deltaY = 0;

    switch (alignmentType) {
      case 'left':
        // 左对齐：将元素左边缘对齐到边界框左边缘
        deltaX = boundingRect.x - elementRect.x;
        break;

      case 'center':
        // 水平居中：将元素中心对齐到边界框中心
        const targetCenterX = boundingRect.x + boundingRect.width / 2;
        const elementCenterX = elementRect.x + elementRect.width / 2;
        deltaX = targetCenterX - elementCenterX;
        break;

      case 'right':
        // 右对齐：将元素右边缘对齐到边界框右边缘
        const targetRight = boundingRect.x + boundingRect.width;
        const elementRight = elementRect.x + elementRect.width;
        deltaX = targetRight - elementRight;
        break;

      case 'top':
        // 顶部对齐：将元素顶边缘对齐到边界框顶边缘
        deltaY = boundingRect.y - elementRect.y;
        break;

      case 'middle':
        // 垂直居中：将元素中心对齐到边界框中心
        const targetCenterY = boundingRect.y + boundingRect.height / 2;
        const elementCenterY = elementRect.y + elementRect.height / 2;
        deltaY = targetCenterY - elementCenterY;
        break;

      case 'bottom':
        // 底部对齐：将元素底边缘对齐到边界框底边缘
        const targetBottom = boundingRect.y + boundingRect.height;
        const elementBottom = elementRect.y + elementRect.height;
        deltaY = targetBottom - elementBottom;
        break;
    }

    // 如果不需要移动，跳过
    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    moveElementWithFrameRelations(
      board,
      element,
      deltaX,
      deltaY,
      relatedByFrameId,
      movedElementIds
    );
  });
};

/**
 * 对齐 Transforms 命名空间
 */
export const AlignmentTransforms = {
  /**
   * 左对齐
   */
  alignLeft: (board: PlaitBoard) => {
    alignElements(board, 'left');
  },

  /**
   * 水平居中
   */
  alignCenter: (board: PlaitBoard) => {
    alignElements(board, 'center');
  },

  /**
   * 右对齐
   */
  alignRight: (board: PlaitBoard) => {
    alignElements(board, 'right');
  },

  /**
   * 顶部对齐
   */
  alignTop: (board: PlaitBoard) => {
    alignElements(board, 'top');
  },

  /**
   * 垂直居中
   */
  alignMiddle: (board: PlaitBoard) => {
    alignElements(board, 'middle');
  },

  /**
   * 底部对齐
   */
  alignBottom: (board: PlaitBoard) => {
    alignElements(board, 'bottom');
  },
};
