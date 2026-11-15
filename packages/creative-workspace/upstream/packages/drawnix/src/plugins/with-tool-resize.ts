/**
 * With Tool Resize Plugin
 *
 * 实现工具元素的拖拽缩放功能
 * 使用 Plait 的 withResize API
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
import { PlaitTool } from '../types/toolbox.types';
import { isToolElement } from './with-tool';
import {
  ResizeHandle,
  calculateResizedRect,
  getHitRectangleResizeHandleRef,
  getShiftKeyState,
} from '../utils/resize-utils';

/**
 * 判断当前选中的元素是否可以缩放
 */
function canResize(board: PlaitBoard): boolean {
  const selectedElements = getSelectedElements(board);

  // 只有当选中单个工具元素时才能缩放
  if (selectedElements.length !== 1) {
    return false;
  }

  return isToolElement(selectedElements[0]);
}

/**
 * 命中测试 - 检测鼠标是否点击到缩放手柄
 */
function hitTest(board: PlaitBoard, point: Point) {
  const selectedElements = getSelectedElements(board);

  if (selectedElements.length !== 1 || !isToolElement(selectedElements[0])) {
    return null;
  }

  const toolElement = selectedElements[0] as PlaitTool;
  const rectangle = RectangleClient.getRectangleByPoints(toolElement.points);
  const angle = toolElement.angle || 0;

  // 检测是否点击到缩放手柄
  const handleRef = getHitRectangleResizeHandleRef(rectangle, point, angle);

  if (handleRef) {
    return {
      element: toolElement,
      rectangle,
      handle: handleRef.handle,
      cursorClass: handleRef.cursorClass,
    };
  }

  return null;
}

/**
 * 缩放回调 - 当用户拖拽缩放手柄时调用
 */
function onResize(
  board: PlaitBoard,
  resizeRef: ResizeRef<PlaitTool, ResizeHandle>,
  resizeState: ResizeState
): void {
  const { element, rectangle: startRectangle, handle } = resizeRef;
  const { startPoint, endPoint } = resizeState;

  if (!startRectangle) {
    console.warn('startRectangle is undefined');
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
    100 // 最小尺寸
  );

  // 计算新的 points
  const newPoints: [Point, Point] = [
    [newRect.x, newRect.y],
    [newRect.x + newRect.width, newRect.y + newRect.height],
  ];

  // 查找元素路径
  const path = board.children.findIndex((el: any) => el.id === element.id);

  if (path >= 0) {
    // 更新元素的 points
    Transforms.setNode(
      board,
      {
        points: newPoints,
      } as Partial<PlaitTool>,
      [path]
    );
  }
}

/**
 * 工具缩放插件
 *
 * 使用 Plait 的 withResize 高阶函数实现缩放功能
 */
export const withToolResize: PlaitPlugin = (board: PlaitBoard) => {
  // 使用 Plait 的 withResize 高阶函数
  // 它会自动处理:
  // 1. 鼠标悬停时显示对应方向的光标
  // 2. 拖拽时显示缩放预览
  // 3. 缩放过程中的所有交互逻辑
  return withResize<PlaitTool, ResizeHandle>(board, {
    key: 'tool-elements',
    canResize: () => canResize(board),
    hitTest: ((point: Point) => hitTest(board, point)) as any,
    onResize: (resizeRef, resizeState) => onResize(board, resizeRef, resizeState),
  });
};
