import {
  getSelectedElements,
  PlaitBoard,
  PlaitPlugin,
  Point,
  RectangleClient,
  Transforms,
} from '@plait/core';
import {
  ResizeRef,
  ResizeState,
  withResize,
} from '@plait/common';
import { isAudioNodeElement, type PlaitAudioNode } from '../types/audio-node.types';
import {
  getHitRectangleResizeHandleRef,
  type ResizeHandle,
} from '../utils/resize-utils';

const AUDIO_NODE_MIN_WIDTH = 240;
const AUDIO_NODE_EDGE_HANDLES = new Set(['5', '7']);

function canResize(board: PlaitBoard): boolean {
  const selectedElements = getSelectedElements(board);
  return selectedElements.length === 1 && isAudioNodeElement(selectedElements[0]);
}

function hitTest(board: PlaitBoard, point: Point) {
  const selectedElements = getSelectedElements(board);

  if (selectedElements.length !== 1 || !isAudioNodeElement(selectedElements[0])) {
    return null;
  }

  const audioNode = selectedElements[0] as PlaitAudioNode;
  const rectangle = RectangleClient.getRectangleByPoints(audioNode.points);
  const handleRef = getHitRectangleResizeHandleRef(
    rectangle,
    point,
    0,
    AUDIO_NODE_EDGE_HANDLES
  );

  if (!handleRef) {
    return null;
  }

  return {
    element: audioNode,
    rectangle,
    handle: handleRef.handle,
    cursorClass: handleRef.cursorClass,
  };
}

function calculateAudioNodeRect(
  startRectangle: RectangleClient,
  handle: ResizeHandle,
  dx: number,
  dy: number
): RectangleClient {
  const aspectRatio = startRectangle.width / startRectangle.height;
  const isLeftHandle = handle === '7';
  const horizontalDelta = isLeftHandle ? -dx : dx;
  const nextWidth = Math.max(AUDIO_NODE_MIN_WIDTH, startRectangle.width + horizontalDelta);
  const nextHeight = nextWidth / aspectRatio;
  const yOffset = (startRectangle.height - nextHeight) / 2;

  return {
    x: isLeftHandle
      ? startRectangle.x + (startRectangle.width - nextWidth)
      : startRectangle.x,
    y: startRectangle.y + yOffset,
    width: nextWidth,
    height: nextHeight,
  };
}

function onResize(
  board: PlaitBoard,
  resizeRef: ResizeRef<PlaitAudioNode, ResizeHandle>,
  resizeState: ResizeState
): void {
  const { element, rectangle: startRectangle, handle } = resizeRef;
  const { startPoint, endPoint } = resizeState;

  if (!startRectangle) {
    return;
  }

  const dx = endPoint[0] - startPoint[0];
  const dy = endPoint[1] - startPoint[1];
  const nextRect = calculateAudioNodeRect(startRectangle, handle, dx, dy);

  const nextPoints: [Point, Point] = [
    [nextRect.x, nextRect.y],
    [nextRect.x + nextRect.width, nextRect.y + nextRect.height],
  ];

  const path = board.children.findIndex((child: any) => child.id === element.id);
  if (path >= 0) {
    Transforms.setNode(board, { points: nextPoints } as Partial<PlaitAudioNode>, [
      path,
    ]);
  }
}

export const withAudioNodeResize: PlaitPlugin = (board: PlaitBoard) => {
  return withResize<PlaitAudioNode, ResizeHandle>(board, {
    key: 'audio-nodes',
    canResize: () => canResize(board),
    hitTest: ((point: Point) => hitTest(board, point)) as any,
    onResize: (resizeRef, resizeState) => onResize(board, resizeRef, resizeState),
  });
};
