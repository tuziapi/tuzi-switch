/**
 * With Pen Resize Plugin
 *
 * 实现钢笔路径元素的拖拽缩放功能
 * 使用 Plait 的 withResize API
 */

import {
  PlaitBoard,
  Point,
  getSelectedElements,
  Transforms,
} from '@plait/core';
import { withResize, ResizeRef, ResizeState } from '@plait/common';
import { PenPath, PenAnchor } from './type';
import { getPenPathRectangle } from './utils';
import {
  ResizeHandle,
  calculateResizedRect,
  getHitRectangleResizeHandleRef,
  getShiftKeyState,
} from '../../utils/resize-utils';

/**
 * 获取选中的单个 PenPath 元素
 */
function getSelectedPenPath(board: PlaitBoard): PenPath | null {
  const selectedElements = getSelectedElements(board);
  if (selectedElements.length === 1 && PenPath.isPenPath(selectedElements[0])) {
    return selectedElements[0] as PenPath;
  }
  return null;
}

/**
 * 判断当前选中的元素是否可以缩放
 */
function canResize(board: PlaitBoard): boolean {
  return getSelectedPenPath(board) !== null;
}

/**
 * 命中测试 - 检测鼠标是否点击到缩放手柄
 */
function hitTest(board: PlaitBoard, point: Point) {
  const penPath = getSelectedPenPath(board);
  if (!penPath) {
    return null;
  }

  const rectangle = getPenPathRectangle(penPath);
  const angle = penPath.angle || 0;

  const handleRef = getHitRectangleResizeHandleRef(rectangle, point, angle);

  if (handleRef) {
    return {
      element: penPath,
      rectangle,
      handle: handleRef.handle,
      cursorClass: handleRef.cursorClass,
    };
  }

  return null;
}

/**
 * 缩放锚点
 */
function scaleAnchors(
  anchors: PenAnchor[],
  scaleX: number,
  scaleY: number
): PenAnchor[] {
  return anchors.map((anchor) => ({
    ...anchor,
    point: [anchor.point[0] * scaleX, anchor.point[1] * scaleY] as Point,
    handleIn: anchor.handleIn
      ? [anchor.handleIn[0] * scaleX, anchor.handleIn[1] * scaleY] as Point
      : undefined,
    handleOut: anchor.handleOut
      ? [anchor.handleOut[0] * scaleX, anchor.handleOut[1] * scaleY] as Point
      : undefined,
  }));
}

/**
 * 缩放回调 - 当用户拖拽缩放手柄时调用
 */
function onResize(
  board: PlaitBoard,
  resizeRef: ResizeRef<PenPath, ResizeHandle>,
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

  // 计算缩放比例
  const scaleX = newRect.width / startRectangle.width;
  const scaleY = newRect.height / startRectangle.height;

  // 缩放锚点（相对坐标）
  const scaledAnchors = scaleAnchors(element.anchors, scaleX, scaleY);

  // 计算新的 points（边界框）
  const newBasePoint: Point = [newRect.x, newRect.y];
  const newPoints: [Point, Point] = [
    newBasePoint,
    [newRect.x + newRect.width, newRect.y + newRect.height],
  ];

  // 查找元素路径
  const path = board.children.findIndex((el: any) => el.id === element.id);

  if (path >= 0) {
    // 更新元素的 points 和 anchors
    Transforms.setNode(
      board,
      {
        points: newPoints,
        anchors: scaledAnchors,
      } as Partial<PenPath>,
      [path]
    );
  }
}

/**
 * 钢笔路径缩放插件
 */
export const withPenResize = (board: PlaitBoard) => {
  return withResize<PenPath, ResizeHandle>(board, {
    key: 'pen-path',
    canResize: () => canResize(board),
    hitTest: ((point: Point) => hitTest(board, point)) as any,
    onResize: (resizeRef, resizeState) => onResize(board, resizeRef, resizeState),
  });
};
