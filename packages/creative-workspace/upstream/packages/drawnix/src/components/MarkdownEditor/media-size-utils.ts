export interface AspectResizeBounds {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
}

export interface MediaSize {
  width: number;
  height: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeDimension(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.round(value);
}

export function clampSizeByWidth(
  targetWidth: number,
  aspectRatio: number,
  bounds: AspectResizeBounds
): MediaSize {
  let width = clamp(targetWidth, bounds.minWidth, bounds.maxWidth);
  let height = width / aspectRatio;

  if (height < bounds.minHeight || height > bounds.maxHeight) {
    height = clamp(height, bounds.minHeight, bounds.maxHeight);
    width = height * aspectRatio;
  }

  return {
    width: clamp(width, bounds.minWidth, bounds.maxWidth),
    height: clamp(height, bounds.minHeight, bounds.maxHeight),
  };
}

export function clampSizeByHeight(
  targetHeight: number,
  aspectRatio: number,
  bounds: AspectResizeBounds
): MediaSize {
  let height = clamp(targetHeight, bounds.minHeight, bounds.maxHeight);
  let width = height * aspectRatio;

  if (width < bounds.minWidth || width > bounds.maxWidth) {
    width = clamp(width, bounds.minWidth, bounds.maxWidth);
    height = width / aspectRatio;
  }

  return {
    width: clamp(width, bounds.minWidth, bounds.maxWidth),
    height: clamp(height, bounds.minHeight, bounds.maxHeight),
  };
}
