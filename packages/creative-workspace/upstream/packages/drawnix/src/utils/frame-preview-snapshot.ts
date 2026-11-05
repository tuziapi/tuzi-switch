import {
  getRectangleByElements,
  PlaitBoard,
  PlaitElement,
  RectangleClient,
} from '@plait/core';
import { isFrameElement, type PlaitFrame } from '../types/frame.types';
import { safeToImage } from './common';

const DEFAULT_FRAME_SNAPSHOT_MAX_DIMENSION = 320;
const DEFAULT_FRAME_SNAPSHOT_FILL = '#ffffff';
const DEFAULT_FRAME_SNAPSHOT_INLINE_STYLES = '.extend,.emojis,.text';
const MAX_SIGNATURE_STRING_LENGTH = 800;
const MAX_SIGNATURE_ARRAY_LENGTH = 80;
const MAX_SIGNATURE_OBJECT_KEYS = 80;
const MAX_SIGNATURE_DEPTH = 5;

export interface PPTFrameSnapshotOptions {
  maxDimension?: number;
  fillStyle?: string;
  inlineStyleClassNames?: string;
}

type RectLike = { x: number; y: number; width: number; height: number };

function getElementRect(
  board: PlaitBoard,
  element: PlaitElement
): RectLike | null {
  const points = (element as PlaitElement & {
    points?: [number, number][];
  }).points;
  if (Array.isArray(points) && points.length >= 2) {
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

  try {
    return board.getRectangle(element);
  } catch {
    return null;
  }
}

function isElementCenteredInFrame(
  board: PlaitBoard,
  element: PlaitElement,
  frameRect: RectLike
): boolean {
  const rect = getElementRect(board, element);
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return (
    centerX >= frameRect.x &&
    centerX <= frameRect.x + frameRect.width &&
    centerY >= frameRect.y &&
    centerY <= frameRect.y + frameRect.height
  );
}

export function getPPTFrameSnapshotElements(
  board: PlaitBoard,
  frame: PlaitFrame
): PlaitElement[] {
  const frameRect = RectangleClient.getRectangleByPoints(frame.points);
  const result: PlaitElement[] = [];
  const seenIds = new Set<string>();

  const pushElement = (element: PlaitElement) => {
    if (seenIds.has(element.id)) {
      return;
    }
    result.push(element);
    seenIds.add(element.id);
  };

  const walk = (elements: PlaitElement[]) => {
    for (const element of elements) {
      if (element.id === frame.id) {
        pushElement(element);
      } else if (!isFrameElement(element)) {
        const boundFrameId = (element as PlaitElement & { frameId?: string })
          .frameId;
        if (
          boundFrameId === frame.id ||
          (!boundFrameId && isElementCenteredInFrame(board, element, frameRect))
        ) {
          pushElement(element);
        }
      }

      const children = (element as PlaitElement & {
        children?: PlaitElement[];
      }).children;
      if (Array.isArray(children) && children.length > 0) {
        walk(children);
      }
    }
  };

  walk(board.children as PlaitElement[]);
  return result;
}

function normalizeSignatureValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  if (value == null) {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > MAX_SIGNATURE_STRING_LENGTH
      ? `${value.slice(0, MAX_SIGNATURE_STRING_LENGTH)}#${value.length}`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (depth >= MAX_SIGNATURE_DEPTH) {
    return '[depth]';
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_SIGNATURE_ARRAY_LENGTH)
      .map((item) => normalizeSignatureValue(item, depth + 1, seen));
    return value.length > MAX_SIGNATURE_ARRAY_LENGTH
      ? [...items, `#${value.length}`]
      : items;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[circular]';
    }
    seen.add(value);
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source)
      .filter((key) => typeof source[key] !== 'function')
      .sort()
      .slice(0, MAX_SIGNATURE_OBJECT_KEYS);
    const normalized: Record<string, unknown> = {};
    for (const key of keys) {
      normalized[key] = normalizeSignatureValue(source[key], depth + 1, seen);
    }
    if (Object.keys(source).length > MAX_SIGNATURE_OBJECT_KEYS) {
      normalized.__keyCount = Object.keys(source).length;
    }
    return normalized;
  }
  return String(value);
}

export function createPPTFrameSnapshotKey(elements: PlaitElement[]): string {
  return JSON.stringify(
    elements.map((element) => normalizeSignatureValue(element))
  );
}

export function resolvePPTFramePreviewUrl(
  snapshotUrl?: string,
  slideImageUrl?: string
): string | undefined {
  return snapshotUrl || slideImageUrl;
}

export async function createPPTFrameSnapshotDataUrl(
  board: PlaitBoard,
  frame: PlaitFrame,
  options: PPTFrameSnapshotOptions = {}
): Promise<string | undefined> {
  const elements = getPPTFrameSnapshotElements(board, frame);
  if (elements.length === 0) {
    return undefined;
  }

  const frameRect = RectangleClient.getRectangleByPoints(frame.points);
  const largestDimension = Math.max(frameRect.width, frameRect.height, 1);
  const maxDimension =
    options.maxDimension ?? DEFAULT_FRAME_SNAPSHOT_MAX_DIMENSION;
  const ratio = Math.min(1, Math.max(0.02, maxDimension / largestDimension));
  const sourceRect = getRectangleByElements(board, elements, false);

  const imageUrl = await safeToImage(board, {
    elements,
    fillStyle: options.fillStyle ?? DEFAULT_FRAME_SNAPSHOT_FILL,
    inlineStyleClassNames:
      options.inlineStyleClassNames ?? DEFAULT_FRAME_SNAPSHOT_INLINE_STYLES,
    padding: 0,
    ratio,
  });
  if (!imageUrl) {
    return undefined;
  }

  return cropSnapshotToFrame(imageUrl, sourceRect, frameRect);
}

function loadSnapshotImage(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Frame snapshot image load failed'));
    image.src = imageUrl;
  });
}

async function cropSnapshotToFrame(
  imageUrl: string,
  sourceRect: RectLike,
  frameRect: RectLike
): Promise<string | undefined> {
  if (
    sourceRect.width <= 0 ||
    sourceRect.height <= 0 ||
    frameRect.width <= 0 ||
    frameRect.height <= 0
  ) {
    return undefined;
  }

  const image = await loadSnapshotImage(imageUrl);
  const scaleX = image.naturalWidth / sourceRect.width;
  const scaleY = image.naturalHeight / sourceRect.height;
  const width = Math.max(1, Math.round(frameRect.width * scaleX));
  const height = Math.max(1, Math.round(frameRect.height * scaleY));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return undefined;
  }

  ctx.drawImage(
    image,
    (frameRect.x - sourceRect.x) * scaleX,
    (frameRect.y - sourceRect.y) * scaleY,
    frameRect.width * scaleX,
    frameRect.height * scaleY,
    0,
    0,
    width,
    height
  );

  return canvas.toDataURL('image/png');
}
