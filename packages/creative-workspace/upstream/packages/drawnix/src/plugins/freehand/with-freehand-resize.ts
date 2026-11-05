/**
 * With Freehand Resize Plugin
 *
 * 实现手绘元素的拖拽缩放功能
 * 使用 Plait 的 withResize API
 */

import {
  PlaitBoard,
  Point,
  RectangleClient,
  getSelectedElements,
  Transforms,
} from '@plait/core';
import { withResize, ResizeRef, ResizeState } from '@plait/common';
import { Freehand } from './type';
import { getFreehandRectangle } from './utils';
import {
  ResizeHandle,
  calculateResizedRect,
  getHitRectangleResizeHandleRef,
  getShiftKeyState,
} from '../../utils/resize-utils';

/**
 * 获取选中的单个 Freehand 元素
 */
function getSelectedFreehand(board: PlaitBoard): Freehand | null {
  const selectedElements = getSelectedElements(board);
  if (selectedElements.length === 1 && Freehand.isFreehand(selectedElements[0])) {
    return selectedElements[0] as Freehand;
  }
  return null;
}

/**
 * 判断当前选中的元素是否可以缩放
 */
function canResize(board: PlaitBoard): boolean {
  return getSelectedFreehand(board) !== null;
}

/**
 * 命中测试 - 检测鼠标是否点击到缩放手柄
 */
function hitTest(board: PlaitBoard, point: Point) {
  const freehand = getSelectedFreehand(board);
  if (!freehand) {
    return null;
  }

  const rectangle = getFreehandRectangle(freehand);
  const angle = freehand.angle || 0;

  const handleRef = getHitRectangleResizeHandleRef(rectangle, point, angle);

  if (handleRef) {
    return {
      element: freehand,
      rectangle,
      handle: handleRef.handle,
      cursorClass: handleRef.cursorClass,
    };
  }

  return null;
}

/**
 * 缩放路径点
 */
function scalePoints(
  points: Point[],
  originalRect: RectangleClient,
  newRect: RectangleClient
): Point[] {
  const scaleX = newRect.width / originalRect.width;
  const scaleY = newRect.height / originalRect.height;
  
  return points.map((p) => {
    // 计算点相对于原始矩形左上角的相对位置
    const relX = p[0] - originalRect.x;
    const relY = p[1] - originalRect.y;
    // 缩放并移动到新位置
    return [
      newRect.x + relX * scaleX,
      newRect.y + relY * scaleY,
    ] as Point;
  });
}

/**
 * 缩放回调 - 当用户拖拽缩放手柄时调用
 */
function onResize(
  board: PlaitBoard,
  resizeRef: ResizeRef<Freehand, ResizeHandle>,
  resizeState: ResizeState
): void {
  const { element, rectangle: startRectangle, handle } = resizeRef;
  const { startPoint, endPoint } = resizeState;

  if (!startRectangle) {
    return;
  }

  // 计算拖拽偏移量
  const dx = endPoint[0] - startPoint[0];
  const dy = endPoint[1] - startPoint[1];

  // 使用公共函数计算新矩形，支持 Shift 锁定比例
  const newRect = calculateResizedRect(
    startRectangle,
    handle,
    dx,
    dy,
    getShiftKeyState(), // Shift 键锁定比例
    10 // 最小尺寸
  );

  // 缩放路径点
  const scaledPoints = scalePoints(element.points, startRectangle, newRect);

  // 查找元素路径
  const path = board.children.findIndex((el: any) => el.id === element.id);

  if (path >= 0) {
    // 更新元素的 points
    Transforms.setNode(
      board,
      {
        points: scaledPoints,
      } as Partial<Freehand>,
      [path]
    );
  }
}

/**
 * 手绘元素缩放插件
 */
export const withFreehandResize = (board: PlaitBoard) => {
  return withResize<Freehand, ResizeHandle>(board, {
    key: 'freehand',
    canResize: () => canResize(board),
    hitTest: ((point: Point) => hitTest(board, point)) as any,
    onResize: (resizeRef, resizeState) => onResize(board, resizeRef, resizeState),
  });
};
