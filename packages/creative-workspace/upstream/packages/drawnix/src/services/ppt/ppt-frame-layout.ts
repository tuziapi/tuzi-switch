import type { PlaitBoard, Point } from '@plait/core';
import {
  PlaitBoard as PlaitBoardUtils,
  RectangleClient,
} from '@plait/core';
import { isFrameElement } from '../../types/frame.types';
import { PPT_FRAME_HEIGHT, PPT_FRAME_WIDTH } from './ppt-layout-engine';

export const PPT_FRAME_LAYOUT_COLUMNS_STORAGE_KEY =
  'ppt-frame-layout-columns';
export const DEFAULT_PPT_FRAME_LAYOUT_COLUMNS = 3;
export const MIN_PPT_FRAME_LAYOUT_COLUMNS = 1;
export const MAX_PPT_FRAME_LAYOUT_COLUMNS = 10;
export const PPT_FRAME_GRID_GAP = 60;

export function sanitizePPTFrameLayoutColumns(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : DEFAULT_PPT_FRAME_LAYOUT_COLUMNS;

  if (!Number.isFinite(parsed)) {
    return DEFAULT_PPT_FRAME_LAYOUT_COLUMNS;
  }

  return Math.min(
    MAX_PPT_FRAME_LAYOUT_COLUMNS,
    Math.max(MIN_PPT_FRAME_LAYOUT_COLUMNS, Math.round(parsed))
  );
}

export function loadPPTFrameLayoutColumns(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_PPT_FRAME_LAYOUT_COLUMNS;
  }

  try {
    return sanitizePPTFrameLayoutColumns(
      window.localStorage.getItem(PPT_FRAME_LAYOUT_COLUMNS_STORAGE_KEY)
    );
  } catch {
    return DEFAULT_PPT_FRAME_LAYOUT_COLUMNS;
  }
}

export function savePPTFrameLayoutColumns(columns: number): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      PPT_FRAME_LAYOUT_COLUMNS_STORAGE_KEY,
      String(sanitizePPTFrameLayoutColumns(columns))
    );
  } catch {
    return;
  }
}

export function getPPTFrameGridPosition(
  startPosition: Point,
  index: number,
  columns: number,
  gap = PPT_FRAME_GRID_GAP
): Point {
  const safeColumns = sanitizePPTFrameLayoutColumns(columns);
  const column = index % safeColumns;
  const row = Math.floor(index / safeColumns);

  return [
    startPosition[0] + column * (PPT_FRAME_WIDTH + gap),
    startPosition[1] + row * (PPT_FRAME_HEIGHT + gap),
  ];
}

export function getPPTFrameGridPositions(
  count: number,
  startPosition: Point,
  columns: number,
  gap = PPT_FRAME_GRID_GAP
): Point[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) =>
    getPPTFrameGridPosition(startPosition, index, columns, gap)
  );
}

export function calcPPTFrameInsertionStartPosition(
  board: PlaitBoard,
  gap = PPT_FRAME_GRID_GAP
): Point {
  const existingFrames: RectangleClient[] = [];

  for (const element of board.children) {
    if (isFrameElement(element)) {
      existingFrames.push(RectangleClient.getRectangleByPoints(element.points));
    }
  }

  if (existingFrames.length === 0) {
    const zoom = board.viewport?.zoom ?? 1;
    const origination = board.viewport?.origination;
    const originX = origination ? origination[0] : 0;
    const originY = origination ? origination[1] : 0;
    const container = PlaitBoardUtils.getBoardContainer(board);
    const viewportWidth = container?.clientWidth ?? 1920;
    const viewportHeight = container?.clientHeight ?? 1080;
    const centerX = originX + viewportWidth / 2 / zoom;
    const centerY = originY + viewportHeight / 2 / zoom;

    return [
      centerX - PPT_FRAME_WIDTH / 2,
      centerY - PPT_FRAME_HEIGHT / 2,
    ];
  }

  let maxRight = -Infinity;
  let referenceY = 0;
  for (const rect of existingFrames) {
    const right = rect.x + rect.width;
    if (right > maxRight) {
      maxRight = right;
      referenceY = rect.y;
    }
  }

  return [maxRight + gap, referenceY];
}
