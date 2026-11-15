import {
  addOrCreateClipboardContext,
  addSelectedElement,
  clearSelectedElement,
  getSelectedElements,
  idCreator,
  PlaitBoard,
  PlaitElement,
  PlaitPlugin,
  PlaitPluginElementContext,
  Point,
  RectangleClient,
  Selection,
  Transforms,
  WritableClipboardOperationType,
  WritableClipboardType,
} from '@plait/core';
import { AudioNodeComponent } from '../components/audio-node-element/audio-node.component';
import {
  isAudioNodeElement,
  type PlaitAudioNode,
} from '../types/audio-node.types';
export { AudioNodeTransforms } from '../data/audio-node-transforms';

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

export const withAudioNode: PlaitPlugin = (board: PlaitBoard) => {
  const {
    drawElement,
    getRectangle,
    isHit,
    isRectangleHit,
    isMovable,
    isAlign,
    getDeletedFragment,
    buildFragment,
    insertFragment,
  } = board;

  board.drawElement = (context: PlaitPluginElementContext) => {
    if (isAudioNodeElement(context.element)) {
      return AudioNodeComponent;
    }

    return drawElement(context);
  };

  board.getRectangle = (element: PlaitElement) => {
    if (isAudioNodeElement(element)) {
      return RectangleClient.getRectangleByPoints(element.points);
    }

    return getRectangle(element);
  };

  board.isHit = (element: PlaitElement, point: Point, isStrict?: boolean) => {
    if (isAudioNodeElement(element)) {
      const rect = RectangleClient.getRectangleByPoints(element.points);
      return (
        point[0] >= rect.x &&
        point[0] <= rect.x + rect.width &&
        point[1] >= rect.y &&
        point[1] <= rect.y + rect.height
      );
    }

    return isHit(element, point, isStrict);
  };

  board.isRectangleHit = (element: PlaitElement, selection: Selection) => {
    if (isAudioNodeElement(element)) {
      const rect = RectangleClient.getRectangleByPoints(element.points);
      const selectionRect = RectangleClient.getRectangleByPoints([
        selection.anchor,
        selection.focus,
      ]);
      return isRectIntersect(rect, selectionRect);
    }

    return isRectangleHit(element, selection);
  };

  board.isMovable = (element: PlaitElement) => {
    if (isAudioNodeElement(element)) {
      return true;
    }

    return isMovable(element);
  };

  board.isAlign = (element: PlaitElement) => {
    if (isAudioNodeElement(element)) {
      return true;
    }

    return isAlign(element);
  };

  board.getDeletedFragment = (data: PlaitElement[]) => {
    const selectedAudioNodes = getSelectedElements(board).filter(isAudioNodeElement);
    if (selectedAudioNodes.length > 0) {
      data.push(...selectedAudioNodes);
    }

    return getDeletedFragment(data);
  };

  board.buildFragment = (
    clipboardContext: any,
    rectangle: any,
    operationType: WritableClipboardOperationType,
    originData?: PlaitElement[]
  ) => {
    const targetElements = originData?.length ? originData : getSelectedElements(board);
    const audioNodes = targetElements.filter(isAudioNodeElement) as PlaitAudioNode[];

    if (audioNodes.length > 0 && rectangle) {
      const relativeAudioNodes = audioNodes.map((audioNode) => ({
        ...audioNode,
        points: audioNode.points.map((point) => [
          point[0] - rectangle.x,
          point[1] - rectangle.y,
        ]) as [Point, Point],
      }));

      clipboardContext = addOrCreateClipboardContext(clipboardContext, {
        text: '',
        type: WritableClipboardType.elements,
        elements: relativeAudioNodes,
      });
    }

    return buildFragment(clipboardContext, rectangle, operationType, originData);
  };

  (board as any).insertFragment = (
    clipboardData: any,
    targetPoint: Point,
    operationType: WritableClipboardOperationType
  ) => {
    if (clipboardData?.elements?.length) {
      const audioNodes = clipboardData.elements.filter(isAudioNodeElement) as PlaitAudioNode[];

      if (audioNodes.length > 0) {
        const insertedAudioNodes: PlaitAudioNode[] = [];

        audioNodes.forEach((audioNode) => {
          const nextAudioNode: PlaitAudioNode = {
            ...audioNode,
            id: idCreator(),
            points: audioNode.points.map((point) => [
              targetPoint[0] + point[0],
              targetPoint[1] + point[1],
            ]) as [Point, Point],
          };

          Transforms.insertNode(board, nextAudioNode, [board.children.length]);
          insertedAudioNodes.push(nextAudioNode);
        });

        if (insertedAudioNodes.length > 0) {
          clearSelectedElement(board);
          insertedAudioNodes.forEach((audioNode) => addSelectedElement(board, audioNode));
        }
      }
    }

    const nonAudioClipboardData = clipboardData?.elements?.length
      ? {
          ...clipboardData,
          elements: clipboardData.elements.filter(
            (element: PlaitElement) => !isAudioNodeElement(element)
          ),
        }
      : clipboardData;

    insertFragment(nonAudioClipboardData, targetPoint, operationType);
  };

  return board;
};
