/**
 * With Card Resize Plugin
 *
 * 实现 Card 标签贴元素的拖拽缩放功能
 * 参考 with-tool-resize.ts 实现
 */

import {
  PlaitBoard,
  PlaitPlugin,
  Point,
  RectangleClient,
  getSelectedElements,
  Transforms,
} from '@plait/core';
import { withResize, ResizeRef, ResizeState } from '@plait/common';
import { PlaitCard, isCardElement } from '../types/card.types';
import {
  ResizeHandle,
  calculateResizedRect,
  getHitRectangleResizeHandleRef,
  getShiftKeyState,
} from '../utils/resize-utils';
import { CARD_TITLE_HEIGHT } from '../constants/card-colors';
import { measureCardBodyContentHeight } from '../components/card-element/CardElement';

/** Card 最小尺寸 */
const CARD_MIN_SIZE = 120;

/** 记录用户手动调整过尺寸的 Card ID */
const manuallyResizedCards = new Set<string>();

export function isCardManuallyResized(id: string): boolean {
  return manuallyResizedCards.has(id);
}

function canResize(board: PlaitBoard): boolean {
  const selectedElements = getSelectedElements(board);
  if (selectedElements.length !== 1) return false;
  return isCardElement(selectedElements[0]);
}

function hitTest(board: PlaitBoard, point: Point) {
  const selectedElements = getSelectedElements(board);
  if (selectedElements.length !== 1 || !isCardElement(selectedElements[0])) {
    return null;
  }

  const card = selectedElements[0] as PlaitCard;
  const rectangle = RectangleClient.getRectangleByPoints(card.points);
  const angle = 0; // Card 不支持旋转

  const handleRef = getHitRectangleResizeHandleRef(rectangle, point, angle);
  if (handleRef) {
    return {
      element: card,
      rectangle,
      handle: handleRef.handle,
      cursorClass: handleRef.cursorClass,
    };
  }
  return null;
}

function onResize(
  board: PlaitBoard,
  resizeRef: ResizeRef<PlaitCard, ResizeHandle>,
  resizeState: ResizeState
): void {
  const { element, rectangle: startRectangle, handle } = resizeRef;
  const { startPoint, endPoint } = resizeState;

  if (!startRectangle) return;

  manuallyResizedCards.add(element.id);

  const dx = endPoint[0] - startPoint[0];
  const dy = endPoint[1] - startPoint[1];

  const newRect = calculateResizedRect(
    startRectangle,
    handle,
    dx,
    dy,
    getShiftKeyState(),
    CARD_MIN_SIZE
  );

  const titleHeight = CARD_TITLE_HEIGHT;
  const bodyContentH = measureCardBodyContentHeight(element.id);
  const contentMaxHeight =
    bodyContentH != null ? titleHeight + bodyContentH : newRect.height;
  if (newRect.height > contentMaxHeight) {
    const isTopHandle = [ResizeHandle.nw, ResizeHandle.n, ResizeHandle.ne].includes(
      handle as ResizeHandle
    );
    if (isTopHandle) {
      newRect.y = newRect.y + newRect.height - contentMaxHeight;
    }
    newRect.height = contentMaxHeight;
  }

  const newPoints: [Point, Point] = [
    [newRect.x, newRect.y],
    [newRect.x + newRect.width, newRect.y + newRect.height],
  ];

  const path = board.children.findIndex((el: any) => el.id === element.id);
  if (path >= 0) {
    Transforms.setNode(
      board,
      { points: newPoints } as Partial<PlaitCard>,
      [path]
    );
  }
}

/**
 * Card 缩放插件
 */
export const withCardResize: PlaitPlugin = (board: PlaitBoard) => {
  return withResize<PlaitCard, ResizeHandle>(board, {
    key: 'card-elements',
    canResize: () => canResize(board),
    hitTest: ((point: Point) => hitTest(board, point)) as any,
    onResize: (resizeRef, resizeState) => onResize(board, resizeRef, resizeState),
  });
};
