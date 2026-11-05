import { PlaitBoard, Point, Transforms } from '@plait/core';
import {
  AUDIO_NODE_DEFAULT_HEIGHT,
  AUDIO_NODE_DEFAULT_WIDTH,
  type AudioNodeCreateOptions,
  type PlaitAudioNode,
} from '../types/audio-node.types';

function generateAudioNodeId(): string {
  return `audio-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

export const AudioNodeTransforms = {
  insertAudioNode(
    board: PlaitBoard,
    options: AudioNodeCreateOptions
  ): PlaitAudioNode {
    const width = options.size?.width || AUDIO_NODE_DEFAULT_WIDTH;
    const height = options.size?.height || AUDIO_NODE_DEFAULT_HEIGHT;
    const metadata = options.metadata;

    const audioNode: PlaitAudioNode = {
      id: generateAudioNodeId(),
      type: 'audio',
      points: [
        options.position,
        [options.position[0] + width, options.position[1] + height] as Point,
      ],
      audioUrl: options.audioUrl,
      title: metadata?.title,
      duration: metadata?.duration,
      previewImageUrl: metadata?.previewImageUrl,
      tags: metadata?.tags,
      modelVersion: metadata?.mv,
      prompt: metadata?.prompt,
      providerTaskId: metadata?.providerTaskId,
      clipId: metadata?.clipId,
      clipIds: metadata?.clipIds ? [...metadata.clipIds] : undefined,
      createdAt: Date.now(),
      children: [],
    };

    Transforms.insertNode(board, audioNode, [board.children.length]);
    return audioNode;
  },
};
