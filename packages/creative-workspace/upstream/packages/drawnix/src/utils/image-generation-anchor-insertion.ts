import type { Point } from '@plait/core';
import type { PlaitImageGenerationAnchor } from '../types/image-generation-anchor.types';

function isPoint(value: unknown): value is Point {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

export function isSamePoint(left?: Point, right?: Point): boolean {
  if (!left || !right) {
    return left === right;
  }

  return left[0] === right[0] && left[1] === right[1];
}

export function getAnchorCurrentPosition(
  anchor?: Pick<PlaitImageGenerationAnchor, 'points'> | null
): Point | undefined {
  return isPoint(anchor?.points?.[0]) ? anchor.points[0] : undefined;
}

export function resolveImageAnchorInsertionPoint(options: {
  anchor?: Pick<PlaitImageGenerationAnchor, 'points' | 'expectedInsertPosition'> | null;
  workzoneExpectedInsertPosition?: Point;
}): Point | undefined {
  const { anchor, workzoneExpectedInsertPosition } = options;
  const anchorCurrentPosition = getAnchorCurrentPosition(anchor);

  if (anchorCurrentPosition) {
    return anchorCurrentPosition;
  }

  if (isPoint(workzoneExpectedInsertPosition)) {
    return workzoneExpectedInsertPosition;
  }

  if (isPoint(anchor?.expectedInsertPosition)) {
    return anchor.expectedInsertPosition;
  }

  return undefined;
}
