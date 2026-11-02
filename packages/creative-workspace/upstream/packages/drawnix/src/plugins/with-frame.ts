/**
 * Frame 容器插件
 *
 * 功能：
 * 1. 注册 Frame 元素渲染组件
 * 2. 处理元素命中检测
 * 3. 管理 Frame-子元素绑定关系（通过 frameId）
 * 4. Frame 移动时同步移动子元素
 * 5. 拖拽元素进出 Frame 时绑定/解绑
 */
import {
  PlaitBoard,
  PlaitPlugin,
  PlaitPluginElementContext,
  Point,
  Transforms,
  RectangleClient,
  PlaitElement,
  Selection,
  getSelectedElements,
  PlaitPointerType,
  BoardTransforms,
  clearSelectedElement,
  addSelectedElement,
  toHostPoint,
  toViewBoxPoint,
  createG,
} from '@plait/core';
import {
  PlaitFrame,
  getFrameDisplayName,
  isFrameElement,
} from '../types/frame.types';
import { FrameComponent } from '../components/frame-element/frame.component';
import {
  FRAME_STROKE_COLOR,
  FRAME_FILL_COLOR,
} from '../components/frame-element/frame.generator';
import {
  getFrameTitleRect,
  isPointInRect,
  createFrameTitleEditor,
} from '../utils/frame-title-utils';
import {
  getPPTFrameGridPosition,
  loadPPTFrameLayoutColumns,
  sanitizePPTFrameLayoutColumns,
} from '../services/ppt/ppt-frame-layout';
import type { PPTFrameMeta } from '../services/ppt/ppt.types';
/** Frame 指针类型 */
export const FramePointerType = 'frame' as const;

/** 生成唯一的 Frame ID（避免同毫秒批量创建冲突） */
const generateFrameId = () => {
  return `frame-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
};

type RectLike = { x: number; y: number; width: number; height: number };
type PPTFrameDeletionReflowSnapshot = {
  remainingFrameIds: string[];
  startPosition: Point;
  columns: number;
};
const DEFAULT_FRAME_NAME_REGEXP = /^(?:Frame|Slide|PPT\s*页面)\s*\d+$/i;

function getElementRect(element: PlaitElement): RectLike | null {
  const points = (element as PlaitElement & { points?: Point[] }).points;
  if (points && points.length >= 2) {
    return RectangleClient.getRectangleByPoints(points);
  }

  const elementWithBounds = element as PlaitElement & {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  if (
    typeof elementWithBounds.x === 'number' &&
    typeof elementWithBounds.y === 'number'
  ) {
    return {
      x: elementWithBounds.x,
      y: elementWithBounds.y,
      width: elementWithBounds.width ?? 0,
      height: elementWithBounds.height ?? 0,
    };
  }

  return null;
}

function getIntersectionArea(rect1: RectLike, rect2: RectLike): number {
  const left = Math.max(rect1.x, rect2.x);
  const right = Math.min(rect1.x + rect1.width, rect2.x + rect2.width);
  const top = Math.max(rect1.y, rect2.y);
  const bottom = Math.min(rect1.y + rect1.height, rect2.y + rect2.height);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return width * height;
}

function getAssociatedFrameIdByMaxIntersection(
  board: PlaitBoard,
  element: PlaitElement
): string | null {
  if (isFrameElement(element)) return null;

  const currentFrameId = (element as PlaitElement & { frameId?: string })
    .frameId;
  const elementRect = getElementRect(element);
  if (!elementRect) {
    return currentFrameId ?? null;
  }

  let bestFrameId: string | null = null;
  let bestArea = 0;

  for (const candidate of board.children) {
    if (!isFrameElement(candidate)) continue;

    const frameRect = RectangleClient.getRectangleByPoints(candidate.points);
    const area = getIntersectionArea(elementRect, frameRect);
    if (
      area > bestArea ||
      (area > 0 && area === bestArea && candidate.id === currentFrameId)
    ) {
      bestArea = area;
      bestFrameId = candidate.id;
    }
  }

  return bestArea > 0 ? bestFrameId : null;
}

/**
 * 判断两个矩形是否相交
 */
function isRectIntersect(
  rect1: { x: number; y: number; width: number; height: number },
  rect2: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    rect1.x < rect2.x + rect2.width &&
    rect1.x + rect1.width > rect2.x &&
    rect1.y < rect2.y + rect2.height &&
    rect1.y + rect1.height > rect2.y
  );
}

function isDefaultFrameName(name?: string): boolean {
  return DEFAULT_FRAME_NAME_REGEXP.test((name || '').trim());
}

function getPPTPageFrameName(pageIndex: number): string {
  return `PPT 页面 ${pageIndex}`;
}

function getOrderedPPTFrames(frames: PlaitFrame[]): PlaitFrame[] {
  const sourceOrder = new Map(frames.map((frame, index) => [frame.id, index]));

  return [...frames].sort((left, right) => {
    const leftIndex = (left as PlaitFrame & { pptMeta?: PPTFrameMeta }).pptMeta
      ?.pageIndex;
    const rightIndex = (right as PlaitFrame & { pptMeta?: PPTFrameMeta })
      .pptMeta?.pageIndex;
    const hasLeftIndex =
      typeof leftIndex === 'number' && !Number.isNaN(leftIndex);
    const hasRightIndex =
      typeof rightIndex === 'number' && !Number.isNaN(rightIndex);

    if (hasLeftIndex && hasRightIndex && leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    if (hasLeftIndex !== hasRightIndex) {
      return hasLeftIndex ? -1 : 1;
    }
    return (sourceOrder.get(left.id) ?? 0) - (sourceOrder.get(right.id) ?? 0);
  });
}

function moveElementByDelta(
  board: PlaitBoard,
  element: PlaitElement,
  deltaX: number,
  deltaY: number
): void {
  if (deltaX === 0 && deltaY === 0) {
    return;
  }

  const elementIndex = board.children.findIndex((child) => child.id === element.id);
  if (elementIndex === -1) {
    return;
  }

  const currentElement = board.children[elementIndex] as PlaitElement & {
    points?: Point[];
    x?: number;
    y?: number;
  };

  if (currentElement.points && Array.isArray(currentElement.points)) {
    const nextPoints = currentElement.points.map(
      (point) => [point[0] + deltaX, point[1] + deltaY] as Point
    );
    Transforms.setNode(board, { points: nextPoints } as any, [elementIndex]);
    return;
  }

  if (
    typeof currentElement.x === 'number' &&
    typeof currentElement.y === 'number'
  ) {
    Transforms.setNode(
      board,
      {
        x: currentElement.x + deltaX,
        y: currentElement.y + deltaY,
      } as any,
      [elementIndex]
    );
  }
}

function collectRelatedElementsByFrameId(
  board: PlaitBoard,
  frameIds: Set<string>
): Map<string, PlaitElement[]> {
  const relatedByFrameId = new Map<string, PlaitElement[]>();

  for (const element of board.children) {
    if (isFrameElement(element)) {
      continue;
    }

    const associatedFrameId = getAssociatedFrameIdByMaxIntersection(
      board,
      element
    );
    if (!associatedFrameId || !frameIds.has(associatedFrameId)) {
      continue;
    }

    const relatedElements = relatedByFrameId.get(associatedFrameId) ?? [];
    relatedElements.push(element);
    relatedByFrameId.set(associatedFrameId, relatedElements);
  }

  return relatedByFrameId;
}

function moveElementWithFrameRelations(
  board: PlaitBoard,
  element: PlaitElement,
  deltaX: number,
  deltaY: number,
  relatedByFrameId: Map<string, PlaitElement[]>,
  movedElementIds: Set<string>
): void {
  if (movedElementIds.has(element.id)) {
    return;
  }

  moveElementByDelta(board, element, deltaX, deltaY);
  movedElementIds.add(element.id);

  if (!isFrameElement(element)) {
    return;
  }

  const relatedElements = relatedByFrameId.get(element.id) ?? [];
  for (const relatedElement of relatedElements) {
    if (movedElementIds.has(relatedElement.id)) {
      continue;
    }
    moveElementByDelta(board, relatedElement, deltaX, deltaY);
    movedElementIds.add(relatedElement.id);
  }
}

function collectPPTFrameDeletionReflowSnapshot(
  board: PlaitBoard,
  deletedElements: PlaitElement[]
): PPTFrameDeletionReflowSnapshot | null {
  const rootFrames = board.children.filter(isFrameElement) as PlaitFrame[];
  if (rootFrames.length === 0) {
    return null;
  }

  const rootFrameIds = new Set(rootFrames.map((frame) => frame.id));
  const deletedRootFrameIds = new Set(
    deletedElements
      .filter((element) => rootFrameIds.has(element.id))
      .map((element) => element.id)
  );
  if (deletedRootFrameIds.size === 0) {
    return null;
  }

  const remainingFrameIds = getOrderedPPTFrames(rootFrames)
    .map((frame) => frame.id)
    .filter((frameId) => !deletedRootFrameIds.has(frameId));
  if (remainingFrameIds.length === 0) {
    return null;
  }

  const frameRects = rootFrames.map((frame) =>
    RectangleClient.getRectangleByPoints(frame.points)
  );

  return {
    remainingFrameIds,
    startPosition: [
      Math.min(...frameRects.map((rect) => rect.x)),
      Math.min(...frameRects.map((rect) => rect.y)),
    ],
    columns: loadPPTFrameLayoutColumns(),
  };
}

function reorderRootFramesByIds(
  board: PlaitBoard,
  orderedFrameIds: string[]
): void {
  const framePositions: number[] = [];
  const frameById = new Map<string, PlaitFrame>();
  const existingFrameIds: string[] = [];

  board.children.forEach((element, index) => {
    if (!isFrameElement(element)) {
      return;
    }
    framePositions.push(index);
    frameById.set(element.id, element as PlaitFrame);
    existingFrameIds.push(element.id);
  });

  if (framePositions.length <= 1) {
    return;
  }

  const orderedIdSet = new Set(orderedFrameIds);
  const nextFrames: PlaitFrame[] = [];
  for (const id of orderedFrameIds) {
    const frame = frameById.get(id);
    if (frame) {
      nextFrames.push(frame);
    }
  }
  for (const id of existingFrameIds) {
    if (orderedIdSet.has(id)) {
      continue;
    }
    const frame = frameById.get(id);
    if (frame) {
      nextFrames.push(frame);
    }
  }

  if (nextFrames.length !== framePositions.length) {
    return;
  }

  for (let i = framePositions.length - 1; i >= 0; i -= 1) {
    Transforms.removeNode(board, [framePositions[i]]);
  }
  for (let i = 0; i < framePositions.length; i += 1) {
    Transforms.insertNode(board, nextFrames[i], [framePositions[i]]);
  }
}

function renumberPPTFrames(
  board: PlaitBoard,
  orderedFrameIds: string[]
): void {
  orderedFrameIds.forEach((frameId, index) => {
    const frameIndex = board.children.findIndex(
      (element) => element.id === frameId && isFrameElement(element)
    );
    if (frameIndex === -1) {
      return;
    }

    const pageIndex = index + 1;
    const frame = board.children[frameIndex] as PlaitFrame & {
      pptMeta?: PPTFrameMeta;
    };

    Transforms.setNode(
      board,
      {
        pptMeta: {
          ...(frame.pptMeta || {}),
          pageIndex,
          ...(!frame.pptMeta ? { slideImageStatus: 'placeholder' as const } : {}),
        },
      } as any,
      [frameIndex]
    );

    if (isDefaultFrameName(frame.name)) {
      Transforms.setNode(
        board,
        { name: getPPTPageFrameName(pageIndex) } as any,
        [frameIndex]
      );
    }
  });
}

function arrangePPTFramesByIds(
  board: PlaitBoard,
  orderedFrameIds: string[],
  startPosition: Point,
  columns: number
): void {
  const orderedFrames: PlaitFrame[] = [];
  for (const frameId of orderedFrameIds) {
    const frame = board.children.find(
      (element) => element.id === frameId && isFrameElement(element)
    );
    if (frame && isFrameElement(frame)) {
      orderedFrames.push(frame);
    }
  }

  if (orderedFrames.length === 0) {
    return;
  }

  const safeColumns = sanitizePPTFrameLayoutColumns(columns);
  const frameIds = new Set(orderedFrames.map((frame) => frame.id));
  const relatedByFrameId = collectRelatedElementsByFrameId(board, frameIds);
  const movedElementIds = new Set<string>();

  orderedFrames.forEach((frame, index) => {
    const currentFrame = board.children.find(
      (element) => element.id === frame.id && isFrameElement(element)
    );
    if (!currentFrame || !isFrameElement(currentFrame)) {
      return;
    }

    const rect = RectangleClient.getRectangleByPoints(currentFrame.points);
    const targetPosition = getPPTFrameGridPosition(
      startPosition,
      index,
      safeColumns
    );
    moveElementWithFrameRelations(
      board,
      currentFrame,
      targetPosition[0] - rect.x,
      targetPosition[1] - rect.y,
      relatedByFrameId,
      movedElementIds
    );
  });

  orderedFrameIds.forEach((frameId) => {
    const frame = board.children.find(
      (element) => element.id === frameId && isFrameElement(element)
    );
    if (frame && isFrameElement(frame)) {
      FrameTransforms.updateFrameMembers(board, frame);
    }
  });
}

function reflowPPTFramesAfterDeletion(
  board: PlaitBoard,
  snapshot: PPTFrameDeletionReflowSnapshot | null
): void {
  if (!snapshot) {
    return;
  }

  reorderRootFramesByIds(board, snapshot.remainingFrameIds);
  renumberPPTFrames(board, snapshot.remainingFrameIds);
  arrangePPTFramesByIds(
    board,
    snapshot.remainingFrameIds,
    snapshot.startPosition,
    snapshot.columns
  );
}

/**
 * Frame 操作变换集
 */
export const FrameTransforms = {
  /**
   * 插入一个新 Frame（始终追加到已有 Frame 列表末尾）
   */
  insertFrame(
    board: PlaitBoard,
    points: [Point, Point],
    name?: string
  ): PlaitFrame {
    const nextFrameIndex =
      board.children.filter((element) => isFrameElement(element)).length + 1;
    const frame: PlaitFrame = {
      id: generateFrameId(),
      type: 'frame',
      name: name || getFrameDisplayName(undefined, nextFrameIndex),
      points,
      children: [],
    };

    let lastFrameIndex = -1;
    for (let i = 0; i < board.children.length; i++) {
      if (isFrameElement(board.children[i])) {
        lastFrameIndex = i;
      }
    }
    const insertIndex = lastFrameIndex + 1;
    Transforms.insertNode(board, frame, [insertIndex]);

    return frame;
  },

  /**
   * 获取 Frame 的所有子元素
   */
  getFrameChildren(board: PlaitBoard, frame: PlaitFrame): PlaitElement[] {
    return board.children.filter(
      (el) => (el as PlaitElement & { frameId?: string }).frameId === frame.id
    );
  },

  /**
   * 获取元素当前归属的 Frame。
   * 优先按与各 Frame 的最大相交面积判断；无几何信息时回退到已有 frameId。
   * 有几何信息但未与任何 Frame 相交时视为无归属，避免旧 frameId 误关联。
   */
  getAssociatedFrameId(
    board: PlaitBoard,
    element: PlaitElement
  ): string | null {
    return getAssociatedFrameIdByMaxIntersection(board, element);
  },

  /**
   * 获取指定 Frame 及其绑定内容
   */
  getFrameContents(board: PlaitBoard, frameIds: Set<string>): PlaitElement[] {
    const contents: PlaitElement[] = [];
    const seenIds = new Set<string>();

    const walk = (elements: PlaitElement[]) => {
      for (const element of elements) {
        const boundFrameId = (element as PlaitElement & { frameId?: string })
          .frameId;
        const shouldDelete =
          frameIds.has(element.id) ||
          (!!boundFrameId && frameIds.has(boundFrameId));

        if (shouldDelete && !seenIds.has(element.id)) {
          contents.push(element);
          seenIds.add(element.id);
        }

        if (element.children && element.children.length > 0) {
          walk(element.children as PlaitElement[]);
        }
      }
    };

    walk(board.children as PlaitElement[]);
    return contents;
  },

  /**
   * 绑定元素到 Frame
   */
  bindToFrame(board: PlaitBoard, element: PlaitElement, frame: PlaitFrame): void {
    const index = board.children.findIndex((el) => el.id === element.id);
    if (index !== -1) {
      Transforms.setNode(board, { frameId: frame.id } as any, [index]);
    }
  },

  /**
   * 解除元素与 Frame 的绑定
   */
  unbindFromFrame(board: PlaitBoard, element: PlaitElement): void {
    const index = board.children.findIndex((el) => el.id === element.id);
    if (index !== -1) {
      Transforms.setNode(board, { frameId: undefined } as any, [index]);
    }
  },

  /**
   * 重命名 Frame
   */
  renameFrame(board: PlaitBoard, frame: PlaitFrame, newName: string): void {
    const index = board.children.findIndex((el) => el.id === frame.id);
    if (index !== -1) {
      Transforms.setNode(board, { name: newName } as any, [index]);
    }
  },

  /**
   * 更新 Frame 的子元素绑定（按最大相交面积归属）
   */
  updateFrameMembers(board: PlaitBoard, frame: PlaitFrame): void {
    for (let index = 0; index < board.children.length; index += 1) {
      const element = board.children[index];
      if (element.id === frame.id) continue;
      if (isFrameElement(element)) continue;

      const currentFrameId = (element as PlaitElement & { frameId?: string }).frameId;
      const associatedFrameId = getAssociatedFrameIdByMaxIntersection(
        board,
        element
      );

      if (
        associatedFrameId !== currentFrameId &&
        (associatedFrameId === frame.id || currentFrameId === frame.id)
      ) {
        Transforms.setNode(
          board,
          { frameId: associatedFrameId ?? undefined } as any,
          [index]
        );
      }
    }
  },
};

/**
 * Frame 插件
 */
export const withFrame: PlaitPlugin = (board: PlaitBoard) => {
  const {
    drawElement,
    getRectangle,
    isHit,
    isRectangleHit,
    isMovable,
    isAlign,
    afterChange,
    pointerDown,
    pointerMove,
    pointerUp,
    dblClick,
    getDeletedFragment,
    deleteFragment,
  } = board;

  // 跟踪 Frame 移动
  let movingFrameId: string | null = null;
  let lastFramePoints: [Point, Point] | null = null;
  const movingElementIds: Set<string> = new Set(); // 记录拖动开始时与 Frame 相交的元素 ID

  // 跟踪 Frame 创建
  let isCreatingFrame = false;
  let createStartPoint: Point | null = null;
  let previewG: SVGGElement | null = null;

  // 注册 getDeletedFragment：删除选中的 Frame 时一并删除绑定内容
  board.getDeletedFragment = (data: PlaitElement[]) => {
    const selectedElements = getSelectedElements(board);
    const selectedFrames = selectedElements.filter(isFrameElement) as PlaitFrame[];
    if (selectedFrames.length) {
      const frameIds = new Set(selectedFrames.map((frame) => frame.id));
      const existingIds = new Set(data.map((element) => element.id));
      const contents = FrameTransforms.getFrameContents(board, frameIds);
      for (const element of contents) {
        if (!existingIds.has(element.id)) {
          data.push(element);
          existingIds.add(element.id);
        }
      }
    }
    return getDeletedFragment(data);
  };

  board.deleteFragment = (data: PlaitElement[]) => {
    const reflowSnapshot = collectPPTFrameDeletionReflowSnapshot(board, data);
    deleteFragment(data);
    reflowPPTFramesAfterDeletion(board, reflowSnapshot);
  };

  // 注册 Frame 元素渲染组件
  board.drawElement = (context: PlaitPluginElementContext) => {
    if (isFrameElement(context.element)) {
      return FrameComponent;
    }
    return drawElement(context);
  };

  // 注册 getRectangle 方法
  board.getRectangle = (element: PlaitElement) => {
    if (isFrameElement(element)) {
      return RectangleClient.getRectangleByPoints(element.points);
    }
    return getRectangle(element);
  };

  // 注册 isHit 方法
  board.isHit = (element: PlaitElement, point: Point, isStrict?: boolean) => {
    if (isFrameElement(element)) {
      const rect = RectangleClient.getRectangleByPoints(element.points);

      // 检查标题区域命中
      const titleRect = getFrameTitleRect(element);
      if (isPointInRect(point, titleRect)) {
        return true;
      }

      // Frame 只在边框区域可点击（内部不拦截点击）
      const borderWidth = 8;
      const outerRect = {
        x: rect.x - borderWidth,
        y: rect.y - borderWidth,
        width: rect.width + borderWidth * 2,
        height: rect.height + borderWidth * 2,
      };
      const innerRect = {
        x: rect.x + borderWidth,
        y: rect.y + borderWidth,
        width: Math.max(0, rect.width - borderWidth * 2),
        height: Math.max(0, rect.height - borderWidth * 2),
      };

      const inOuter = isPointInRect(point, outerRect);
      const inInner = isPointInRect(point, innerRect);

      // 在边框区域内（外矩形内但内矩形外）
      return inOuter && !inInner;
    }
    return isHit(element, point, isStrict);
  };

  // 注册 isRectangleHit 方法（框选命中）
  board.isRectangleHit = (element: PlaitElement, selection: Selection) => {
    if (isFrameElement(element)) {
      const rect = RectangleClient.getRectangleByPoints(element.points);
      const selectionRect = RectangleClient.getRectangleByPoints([
        selection.anchor,
        selection.focus
      ]);
      return isRectIntersect(rect, selectionRect);
    }
    return isRectangleHit(element, selection);
  };

  // Frame 可移动
  board.isMovable = (element: PlaitElement) => {
    if (isFrameElement(element)) {
      return true;
    }
    return isMovable(element);
  };

  // Frame 可对齐
  board.isAlign = (element: PlaitElement) => {
    if (isFrameElement(element)) {
      return true;
    }
    return isAlign(element);
  };

  // 双击 Frame 或标题：进入标题编辑模式
  board.dblClick = (event: MouseEvent) => {
    const viewBoxPoint = toViewBoxPoint(
      board,
      toHostPoint(board, event.x, event.y)
    ) as Point;

    // 查找是否双击了某个 Frame（标题区域或边框区域）
    for (const element of board.children) {
      if (!isFrameElement(element)) continue;
      const frame = element as PlaitFrame;

      // 检查标题区域
      const titleRect = getFrameTitleRect(frame);
      if (isPointInRect(viewBoxPoint, titleRect)) {
        createFrameTitleEditor(board, frame);
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      // 检查边框区域（同 isHit 逻辑）
      const rect = RectangleClient.getRectangleByPoints(frame.points);
      const borderWidth = 8;
      const outerRect = {
        x: rect.x - borderWidth,
        y: rect.y - borderWidth,
        width: rect.width + borderWidth * 2,
        height: rect.height + borderWidth * 2,
      };
      const innerRect = {
        x: rect.x + borderWidth,
        y: rect.y + borderWidth,
        width: Math.max(0, rect.width - borderWidth * 2),
        height: Math.max(0, rect.height - borderWidth * 2),
      };
      if (isPointInRect(viewBoxPoint, outerRect) && !isPointInRect(viewBoxPoint, innerRect)) {
        createFrameTitleEditor(board, frame);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    dblClick(event);
  };

  const getFrameAtPoint = (point: Point): PlaitFrame | null => {
    for (let i = board.children.length - 1; i >= 0; i -= 1) {
      const element = board.children[i];
      if (isFrameElement(element) && board.isHit(element, point)) {
        return element as PlaitFrame;
      }
    }
    return null;
  };

  const startTrackingFrameMove = (frame: PlaitFrame) => {
    movingFrameId = frame.id;
    lastFramePoints = [...frame.points] as [Point, Point];

    // 记录拖动开始时与 Frame 关联的元素 ID，避免移动过程中“吸附”路过的元素
    movingElementIds.clear();
    board.children.forEach((element) => {
      if (element.id === movingFrameId) return;
      if (isFrameElement(element)) return;

      const associatedFrameId = getAssociatedFrameIdByMaxIntersection(
        board,
        element
      );
      if (associatedFrameId === movingFrameId) {
        movingElementIds.add(element.id);
      }
    });
  };

  // Frame 创建：指针按下
  board.pointerDown = (event: PointerEvent) => {
    if (board.pointer === FramePointerType) {
      isCreatingFrame = true;
      // 转换坐标到画布坐标系（viewBox 坐标）
      const point = toViewBoxPoint(board, toHostPoint(board, event.x, event.y)) as Point;
      createStartPoint = point;
      return;
    }

    // 记录 Frame 移动前的位置
    const viewBoxPoint = toViewBoxPoint(
      board,
      toHostPoint(board, event.x, event.y)
    ) as Point;
    const pressedFrame = getFrameAtPoint(viewBoxPoint);
    const selected = getSelectedElements(board);
    if (pressedFrame) {
      startTrackingFrameMove(pressedFrame);
    } else if (selected.length === 1 && isFrameElement(selected[0])) {
      startTrackingFrameMove(selected[0] as PlaitFrame);
    }

    pointerDown(event);
  };

  // Frame 创建：指针移动 — 绘制实时预览
  board.pointerMove = (event: PointerEvent) => {
    if (isCreatingFrame && createStartPoint) {
      const currentPoint = toViewBoxPoint(
        board,
        toHostPoint(board, event.x, event.y)
      ) as Point;

      const x1 = Math.min(createStartPoint[0], currentPoint[0]);
      const y1 = Math.min(createStartPoint[1], currentPoint[1]);
      const width = Math.abs(currentPoint[0] - createStartPoint[0]);
      const height = Math.abs(currentPoint[1] - createStartPoint[1]);

      const host = PlaitBoard.getElementHost(board);

      if (!previewG) {
        previewG = createG();
        previewG.classList.add('frame-creating-preview');
        host.appendChild(previewG);
      }

      // 清除旧内容并重绘
      previewG.innerHTML = '';

      const rectEl = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'rect'
      );
      rectEl.setAttribute('x', String(x1));
      rectEl.setAttribute('y', String(y1));
      rectEl.setAttribute('width', String(width));
      rectEl.setAttribute('height', String(height));
      rectEl.setAttribute('rx', '8');
      rectEl.setAttribute('ry', '8');
      rectEl.setAttribute('fill', FRAME_FILL_COLOR);
      rectEl.setAttribute('stroke', FRAME_STROKE_COLOR);
      rectEl.setAttribute('stroke-width', '1.5');
      rectEl.setAttribute('stroke-dasharray', '8 4');
      previewG.appendChild(rectEl);

      return;
    }
    pointerMove(event);
  };

  // Frame 创建：指针松开
  board.pointerUp = (event: PointerEvent) => {
    if (isCreatingFrame && createStartPoint) {
      // 移除预览
      if (previewG) {
        previewG.remove();
        previewG = null;
      }

      const endPoint = toViewBoxPoint(board, toHostPoint(board, event.x, event.y)) as Point;
      if (endPoint) {
        const width = Math.abs(endPoint[0] - createStartPoint[0]);
        const height = Math.abs(endPoint[1] - createStartPoint[1]);

        // 只在拖拽了一定距离时创建 Frame
        if (width > 20 && height > 20) {
          const x1 = Math.min(createStartPoint[0], endPoint[0]);
          const y1 = Math.min(createStartPoint[1], endPoint[1]);
          const x2 = Math.max(createStartPoint[0], endPoint[0]);
          const y2 = Math.max(createStartPoint[1], endPoint[1]);

          const frame = FrameTransforms.insertFrame(board, [
            [x1, y1],
            [x2, y2],
          ]);

          // 自动绑定已在 Frame 区域内的元素
          FrameTransforms.updateFrameMembers(board, frame);

          // 选中新创建的 Frame
          setTimeout(() => {
            const inserted = board.children.find((el) => el.id === frame.id);
            if (inserted) {
              clearSelectedElement(board);
              addSelectedElement(board, inserted);
            }
          }, 50);
        }
      }

      isCreatingFrame = false;
      createStartPoint = null;
      BoardTransforms.updatePointerType(board, PlaitPointerType.selection);
      return;
    }

    pointerUp(event);
  };

  // 监听变化：Frame 移动时同步移动相交的元素
  board.afterChange = () => {
    if (movingFrameId) {
      const frame = board.children.find((el) => el.id === movingFrameId) as PlaitFrame | undefined;
      if (frame && lastFramePoints) {
        const currentPoints = frame.points;
        const deltaX = currentPoints[0][0] - lastFramePoints[0][0];
        const deltaY = currentPoints[0][1] - lastFramePoints[0][1];

        if (deltaX !== 0 || deltaY !== 0) {
          // 只移动拖动开始时就与 Frame 相交的元素（避免移动过程中"吸附"路过的元素）
          const elementsToMove = board.children.filter((el) => {
            return movingElementIds.has(el.id);
          });

          // 移动预先记录的元素
          for (const element of elementsToMove) {
            const elementIndex = board.children.findIndex((el) => el.id === element.id);
            if (elementIndex !== -1) {
              if ((element as any).points) {
                // 有 points 属性的元素
                const newPoints = (element as any).points.map((p: Point) => [
                  p[0] + deltaX,
                  p[1] + deltaY,
                ] as Point);
                Transforms.setNode(board, { points: newPoints } as any, [elementIndex]);
              } else if ((element as any).x !== undefined && (element as any).y !== undefined) {
                // 有 x, y 属性的元素
                Transforms.setNode(
                  board,
                  {
                    x: (element as any).x + deltaX,
                    y: (element as any).y + deltaY,
                  } as any,
                  [elementIndex]
                );
              }
            }
          }

          lastFramePoints = [...currentPoints] as [Point, Point];
        }
      }
    }

    afterChange();
  };

  // 重写 globalPointerUp 来清理移动状态
  const { globalPointerUp } = board;
  board.globalPointerUp = (event: PointerEvent) => {
    if (movingFrameId) {
      // 移动结束后更新成员关系
      const frame = board.children.find((el) => el.id === movingFrameId) as PlaitFrame | undefined;
      if (frame) {
        FrameTransforms.updateFrameMembers(board, frame);
      }
      movingFrameId = null;
      lastFramePoints = null;
      movingElementIds.clear(); // 清理记录的元素 ID
    }

    globalPointerUp(event);
  };

  return board;
};
