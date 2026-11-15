import {
  BoardTransforms,
  PlaitBoard,
  PlaitElement,
  Point,
  clampZoomLevel,
  getViewBox,
  getSelectedElements,
  getViewportOrigination,
} from '@plait/core';
import type { PlaitCommonElementRef } from '@plait/common';

const IGNORED_VIEWPORT_SCROLL_COUNT = new WeakMap<PlaitBoard, number>();
const IGNORED_VIEWPORT_SCROLL_TIMEOUT = new WeakMap<
  PlaitBoard,
  ReturnType<typeof setTimeout>
>();
const ACTIVE_SECTION_REFRESH_PENDING = new WeakMap<PlaitBoard, boolean>();

export const getCurrentViewportOrigination = (board: PlaitBoard): Point => {
  const originFromScroll = getViewportOriginationFromScroll(board);
  if (originFromScroll) {
    return originFromScroll;
  }

  return getViewportOrigination(board) || board.viewport.origination || [0, 0];
};

export const updateZoomFromCurrentViewport = (
  board: PlaitBoard,
  newZoom: number,
  center?: Point
) => {
  const zoom = board.viewport.zoom;
  const origination = getCurrentViewportOrigination(board);
  const boardContainerRect = PlaitBoard.getBoardContainer(
    board
  ).getBoundingClientRect();
  const focusPoint = getFocusPoint(boardContainerRect, center);
  const nextZoom = clampZoomLevel(newZoom);
  const centerX = origination[0] + focusPoint[0] / zoom;
  const centerY = origination[1] + focusPoint[1] / zoom;

  BoardTransforms.updateViewport(
    board,
    [
      centerX - focusPoint[0] / nextZoom,
      centerY - focusPoint[1] / nextZoom,
    ],
    nextZoom
  );
};

export const ignoreUpcomingViewportScroll = (
  board: PlaitBoard,
  count = 1,
  timeout = 120
) => {
  IGNORED_VIEWPORT_SCROLL_COUNT.set(board, count);
  const pendingTimeout = IGNORED_VIEWPORT_SCROLL_TIMEOUT.get(board);
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
  }
  IGNORED_VIEWPORT_SCROLL_TIMEOUT.set(
    board,
    setTimeout(() => {
      IGNORED_VIEWPORT_SCROLL_COUNT.delete(board);
      IGNORED_VIEWPORT_SCROLL_TIMEOUT.delete(board);
    }, timeout)
  );
};

export const consumeIgnoredViewportScroll = (board: PlaitBoard) => {
  const count = IGNORED_VIEWPORT_SCROLL_COUNT.get(board) ?? 0;
  if (count <= 0) {
    return false;
  }

  if (count === 1) {
    IGNORED_VIEWPORT_SCROLL_COUNT.delete(board);
    const pendingTimeout = IGNORED_VIEWPORT_SCROLL_TIMEOUT.get(board);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      IGNORED_VIEWPORT_SCROLL_TIMEOUT.delete(board);
    }
  } else {
    IGNORED_VIEWPORT_SCROLL_COUNT.set(board, count - 1);
  }

  return true;
};

export const refreshSelectedElementActiveSections = (board: PlaitBoard) => {
  const selectedElements = getSelectedElements(board);
  selectedElements.forEach((element) => {
    const elementRef =
      PlaitElement.getElementRef<PlaitCommonElementRef>(element);
    elementRef?.updateActiveSection();
  });
  return selectedElements.length;
};

export const scheduleSelectedElementActiveSectionRefresh = (
  board: PlaitBoard
) => {
  if (ACTIVE_SECTION_REFRESH_PENDING.get(board)) {
    return false;
  }

  if (getSelectedElements(board).length === 0) {
    return false;
  }

  ACTIVE_SECTION_REFRESH_PENDING.set(board, true);
  scheduleFrame(() => {
    ACTIVE_SECTION_REFRESH_PENDING.delete(board);
    refreshSelectedElementActiveSections(board);
  });
  return true;
};

export const refreshSelectedElementActiveSectionsForViewportChange = (
  board: PlaitBoard
) => {
  const count = refreshSelectedElementActiveSections(board);
  if (count > 0) {
    scheduleSelectedElementActiveSectionRefresh(board);
  }
  return count;
};

const getViewportOriginationFromScroll = (board: PlaitBoard): Point | null => {
  const zoom = board.viewport.zoom;
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return null;
  }

  try {
    const viewportContainer = PlaitBoard.getViewportContainer(board);
    const viewBox = getViewBox(board);
    if (
      !viewBox ||
      !Number.isFinite(viewBox.x) ||
      !Number.isFinite(viewBox.y) ||
      !Number.isFinite(viewBox.width) ||
      !Number.isFinite(viewBox.height) ||
      viewBox.width <= 0 ||
      viewBox.height <= 0
    ) {
      return null;
    }

    return [
      viewportContainer.scrollLeft / zoom + viewBox.x,
      viewportContainer.scrollTop / zoom + viewBox.y,
    ];
  } catch {
    return null;
  }
};

const getFocusPoint = (boardContainerRect: DOMRect, center?: Point): Point => {
  if (center && isPointInRect(center, boardContainerRect)) {
    return [center[0] - boardContainerRect.x, center[1] - boardContainerRect.y];
  }

  return [boardContainerRect.width / 2, boardContainerRect.height / 2];
};

const isPointInRect = (point: Point, rect: DOMRect) => {
  return (
    point[0] >= rect.left &&
    point[0] <= rect.right &&
    point[1] >= rect.top &&
    point[1] <= rect.bottom
  );
};

const scheduleFrame = (callback: () => void) => {
  if (
    typeof window !== 'undefined' &&
    typeof window.requestAnimationFrame === 'function'
  ) {
    window.requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
};
