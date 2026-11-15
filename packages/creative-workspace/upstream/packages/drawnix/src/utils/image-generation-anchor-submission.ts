import type { Point } from '@plait/core';
import {
  DEFAULT_IMAGE_GENERATION_ANCHOR_SIZE,
  GHOST_IMAGE_GENERATION_ANCHOR_SIZE,
  type ImageGenerationAnchorCreateOptions,
  type ImageGenerationAnchorSubmissionContext,
  type ImageGenerationAnchorType,
} from '../types/image-generation-anchor.types';
import { parseSizeToPixels } from './size-ratio';

type AnchorTypeInput = Pick<
  ImageGenerationAnchorSubmissionContext,
  'targetFrameId' | 'targetFrameDimensions' | 'requestedSize' | 'requestedCount'
>;

type AnchorSizeInput = Pick<
  ImageGenerationAnchorCreateOptions,
  'size' | 'anchorType' | 'targetFrameDimensions' | 'requestedSize' | 'requestedCount'
>;

export interface BuildImageGenerationAnchorCreateOptionsInput
  extends Omit<ImageGenerationAnchorCreateOptions, 'position'> {
  expectedInsertPosition: Point;
}

export function inferImageGenerationAnchorType(
  input: AnchorTypeInput
): ImageGenerationAnchorType {
  if ((input.requestedCount ?? 1) > 1) {
    return 'stack';
  }

  if (input.targetFrameId && input.targetFrameDimensions) {
    return 'frame';
  }

  if (input.requestedSize) {
    return 'ratio';
  }

  return 'ghost';
}

export function resolveImageGenerationAnchorSize(
  input: AnchorSizeInput
): { width: number; height: number } {
  if (input.size) {
    return input.size;
  }

  if (input.targetFrameDimensions) {
    return input.targetFrameDimensions;
  }

  const anchorType =
    input.anchorType ??
    inferImageGenerationAnchorType({
      targetFrameId: undefined,
      targetFrameDimensions: input.targetFrameDimensions,
      requestedSize: input.requestedSize,
      requestedCount: input.requestedCount,
    });

  if (anchorType === 'ratio' && input.requestedSize) {
    return parseSizeToPixels(input.requestedSize);
  }

  if (anchorType === 'ghost') {
    return GHOST_IMAGE_GENERATION_ANCHOR_SIZE;
  }

  return DEFAULT_IMAGE_GENERATION_ANCHOR_SIZE;
}

export function buildImageGenerationAnchorCreateOptions(
  input: BuildImageGenerationAnchorCreateOptionsInput
): ImageGenerationAnchorCreateOptions {
  const anchorType = input.anchorType ?? inferImageGenerationAnchorType(input);
  const size = resolveImageGenerationAnchorSize({
    size: input.size,
    anchorType,
    targetFrameDimensions: input.targetFrameDimensions,
    requestedSize: input.requestedSize,
    requestedCount: input.requestedCount,
  });

  return {
    ...input,
    position: input.expectedInsertPosition,
    expectedInsertPosition: input.expectedInsertPosition,
    anchorType,
    size,
  };
}
