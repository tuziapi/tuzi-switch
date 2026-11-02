import type { PlaitBoard, PlaitElement, Point } from '@plait/core';
import {
  RectangleClient,
  Transforms,
  getRectangleByElements,
} from '@plait/core';
import { PlaitDrawElement } from '@plait/draw';
import { isFrameElement, type PlaitFrame } from '../types/frame.types';

type RectLike = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PPTMediaFitResult = {
  fittedCount: number;
  skippedCount: number;
};

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isLegacyAudioImageElement(element: PlaitElement): boolean {
  const item = element as PlaitElement & {
    isAudio?: boolean;
    audioType?: string;
    audioUrl?: string;
  };
  return (
    item.isAudio === true ||
    item.audioType === 'music-card' ||
    (typeof item.audioUrl === 'string' && item.audioUrl.length > 0)
  );
}

export function isPPTFitMediaElement(element: PlaitElement): boolean {
  return (
    PlaitDrawElement.isDrawElement(element) &&
    PlaitDrawElement.isImage(element) &&
    typeof (element as PlaitElement & { url?: string }).url === 'string' &&
    !isLegacyAudioImageElement(element) &&
    !(element as PlaitElement & { pptImagePlaceholder?: boolean })
      .pptImagePlaceholder
  );
}

function getElementRect(
  board: PlaitBoard,
  element: PlaitElement
): RectLike | null {
  const points = (element as PlaitElement & { points?: Point[] }).points;
  if (points && points.length >= 2) {
    return RectangleClient.getRectangleByPoints(points);
  }

  try {
    return getRectangleByElements(board, [element], false);
  } catch {
    return null;
  }
}

function getIntersectionArea(left: RectLike, right: RectLike): number {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function findFrameById(board: PlaitBoard, frameId?: string): PlaitFrame | null {
  if (!frameId) return null;
  const frame = board.children.find(
    (element) => element.id === frameId && isFrameElement(element)
  );
  return frame && isFrameElement(frame) ? frame : null;
}

function findBestFrameForMedia(
  board: PlaitBoard,
  element: PlaitElement
): PlaitFrame | null {
  const boundFrame = findFrameById(
    board,
    (element as PlaitElement & { frameId?: string }).frameId
  );
  if (boundFrame) return boundFrame;

  const mediaRect = getElementRect(board, element);
  if (!mediaRect) return null;

  let bestFrame: PlaitFrame | null = null;
  let bestArea = 0;

  for (const candidate of board.children) {
    if (!isFrameElement(candidate)) continue;

    const frameRect = RectangleClient.getRectangleByPoints(candidate.points);
    const area = getIntersectionArea(mediaRect, frameRect);
    if (area > bestArea) {
      bestArea = area;
      bestFrame = candidate;
    }
  }

  return bestArea > 0 ? bestFrame : null;
}

function getFrameMediaElements(
  board: PlaitBoard,
  frame: PlaitFrame
): PlaitElement[] {
  return board.children.filter((element) => {
    if (element.id === frame.id || isFrameElement(element)) return false;
    if (!isPPTFitMediaElement(element)) return false;

    const frameId = (element as PlaitElement & { frameId?: string }).frameId;
    if (frameId === frame.id) return true;

    return findBestFrameForMedia(board, element)?.id === frame.id;
  });
}

function getMediaAspectRatio(element: PlaitElement, currentRect: RectLike) {
  const media = element as PlaitElement & {
    width?: number;
    height?: number;
  };
  if (isPositiveNumber(media.width) && isPositiveNumber(media.height)) {
    return media.width / media.height;
  }
  if (
    isPositiveNumber(currentRect.width) &&
    isPositiveNumber(currentRect.height)
  ) {
    return currentRect.width / currentRect.height;
  }
  return null;
}

function isLikelyVideoUrl(url: string): boolean {
  const normalizedUrl = url.toLowerCase();
  return (
    normalizedUrl.includes('#video') ||
    normalizedUrl.includes('#merged-video-') ||
    ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv'].some((ext) =>
      normalizedUrl.includes(ext)
    )
  );
}

function loadImageAspectRatio(url: string): Promise<number | null> {
  if (typeof Image === 'undefined' || isLikelyVideoUrl(url)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const image = new Image();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      image.onload = null;
      image.onerror = null;
    };

    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      cleanup();
      resolve(
        isPositiveNumber(width) && isPositiveNumber(height)
          ? width / height
          : null
      );
    };
    image.onerror = () => {
      cleanup();
      resolve(null);
    };
    timeoutId = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 3000);
    image.src = url;
  });
}

async function getNaturalImageAspectRatio(
  element: PlaitElement
): Promise<number | null> {
  const url = (element as PlaitElement & { url?: string }).url;
  return typeof url === 'string' && url.length > 0
    ? loadImageAspectRatio(url)
    : null;
}

export function calculateContainedRect(
  sourceAspectRatio: number,
  targetRect: RectLike
): RectLike | null {
  if (
    !isPositiveNumber(sourceAspectRatio) ||
    !isPositiveNumber(targetRect.width) ||
    !isPositiveNumber(targetRect.height)
  ) {
    return null;
  }

  const targetAspectRatio = targetRect.width / targetRect.height;
  let width: number;
  let height: number;

  if (sourceAspectRatio > targetAspectRatio) {
    width = targetRect.width;
    height = width / sourceAspectRatio;
  } else {
    height = targetRect.height;
    width = height * sourceAspectRatio;
  }

  return {
    x: targetRect.x + (targetRect.width - width) / 2,
    y: targetRect.y + (targetRect.height - height) / 2,
    width,
    height,
  };
}

function fitMediaElementToFrame(
  board: PlaitBoard,
  element: PlaitElement,
  frame: PlaitFrame,
  sourceAspectRatioOverride?: number | null
): boolean {
  const elementIndex = board.children.findIndex(
    (child) => child.id === element.id
  );
  if (elementIndex === -1) return false;

  const currentRect = getElementRect(board, element);
  if (!currentRect) return false;

  const sourceAspectRatio =
    sourceAspectRatioOverride || getMediaAspectRatio(element, currentRect);
  if (!sourceAspectRatio) return false;

  const frameRect = RectangleClient.getRectangleByPoints(frame.points);
  const fittedRect = calculateContainedRect(sourceAspectRatio, frameRect);
  if (!fittedRect) return false;

  const nextPoints: [Point, Point] = [
    [fittedRect.x, fittedRect.y],
    [fittedRect.x + fittedRect.width, fittedRect.y + fittedRect.height],
  ];

  Transforms.setNode(
    board,
    {
      points: nextPoints,
      frameId: frame.id,
    } as Partial<PlaitElement>,
    [elementIndex]
  );
  return true;
}

async function fitMediaElementToFrameWithNaturalSize(
  board: PlaitBoard,
  element: PlaitElement,
  frame: PlaitFrame
): Promise<boolean> {
  return fitMediaElementToFrame(
    board,
    element,
    frame,
    await getNaturalImageAspectRatio(element)
  );
}

export function canFitSelectedMediaToPPTFrame(
  board: PlaitBoard,
  elements: PlaitElement[]
): boolean {
  return (
    elements.length > 0 &&
    elements.every(
      (element) =>
        isPPTFitMediaElement(element) && !!findBestFrameForMedia(board, element)
    )
  );
}

export function canFitPPTFrameMediaToFrame(
  board: PlaitBoard,
  frame?: PlaitElement
): frame is PlaitFrame {
  return (
    !!frame &&
    isFrameElement(frame) &&
    getFrameMediaElements(board, frame).length > 0
  );
}

export function fitSelectedMediaToPPTFrame(
  board: PlaitBoard,
  elements: PlaitElement[]
): PPTMediaFitResult {
  let fittedCount = 0;
  let skippedCount = 0;

  for (const element of elements) {
    if (!isPPTFitMediaElement(element)) {
      skippedCount += 1;
      continue;
    }

    const frame = findBestFrameForMedia(board, element);
    if (!frame || !fitMediaElementToFrame(board, element, frame)) {
      skippedCount += 1;
      continue;
    }

    fittedCount += 1;
  }

  return { fittedCount, skippedCount };
}

export function fitPPTFrameMediaToFrame(
  board: PlaitBoard,
  frame: PlaitFrame
): PPTMediaFitResult {
  return fitSelectedMediaToPPTFrame(board, getFrameMediaElements(board, frame));
}

export async function fitPPTFrameMediaToFrameWithNaturalSize(
  board: PlaitBoard,
  frame: PlaitFrame
): Promise<PPTMediaFitResult> {
  let fittedCount = 0;
  let skippedCount = 0;

  for (const element of getFrameMediaElements(board, frame)) {
    const targetFrame = findBestFrameForMedia(board, element);
    if (
      !targetFrame ||
      !(await fitMediaElementToFrameWithNaturalSize(
        board,
        element,
        targetFrame
      ))
    ) {
      skippedCount += 1;
      continue;
    }

    fittedCount += 1;
  }

  return { fittedCount, skippedCount };
}
