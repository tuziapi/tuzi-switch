import { Path, PlaitBoard, PlaitElement, Transforms } from '@plait/core';
import { isFrameElement } from '../types/frame.types';
import { FrameTransforms } from '../plugins/with-frame';

export interface FrameAwareSelection {
  primaryElements: PlaitElement[];
  relatedByFrameId: Map<string, PlaitElement[]>;
}

export function getFrameAwareSelection(
  board: PlaitBoard,
  selectedElements: PlaitElement[]
): FrameAwareSelection {
  const selectedFrameIds = new Set(
    selectedElements.filter(isFrameElement).map((element) => element.id)
  );

  if (selectedFrameIds.size === 0) {
    return {
      primaryElements: selectedElements,
      relatedByFrameId: new Map(),
    };
  }

  const primaryElements = selectedElements.filter((element) => {
    if (isFrameElement(element)) {
      return true;
    }
    const associatedFrameId = FrameTransforms.getAssociatedFrameId(
      board,
      element
    );
    return !associatedFrameId || !selectedFrameIds.has(associatedFrameId);
  });
  const relatedByFrameId = new Map<string, PlaitElement[]>();

  for (const element of board.children) {
    if (isFrameElement(element)) continue;

    const associatedFrameId = FrameTransforms.getAssociatedFrameId(
      board,
      element
    );
    if (!associatedFrameId || !selectedFrameIds.has(associatedFrameId)) {
      continue;
    }

    const relatedElements = relatedByFrameId.get(associatedFrameId) ?? [];
    relatedElements.push(element);
    relatedByFrameId.set(associatedFrameId, relatedElements);
  }

  return {
    primaryElements,
    relatedByFrameId,
  };
}

export function moveElementByDelta(
  board: PlaitBoard,
  element: PlaitElement,
  deltaX: number,
  deltaY: number
): void {
  if (deltaX === 0 && deltaY === 0) {
    return;
  }

  const elementIndex = board.children.findIndex(
    (child) => child.id === element.id
  );
  if (elementIndex < 0) {
    return;
  }

  const currentElement = board.children[elementIndex] as PlaitElement & {
    points?: [number, number][];
    x?: number;
    y?: number;
  };
  const path: Path = [elementIndex];

  if (currentElement.points && Array.isArray(currentElement.points)) {
    const newPoints = currentElement.points.map((point) => [
      point[0] + deltaX,
      point[1] + deltaY,
    ]);
    Transforms.setNode(board, { points: newPoints } as any, path);
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
      path
    );
  }
}

export function moveElementWithFrameRelations(
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
