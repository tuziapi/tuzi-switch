import { describe, expect, it, vi } from 'vitest';
import { createTestingBoard, fakeNodeWeakMap, IS_BOARD_ALIVE, RectangleClient, withHistory, type PlaitElement } from '@plait/core';
import { insertLayerDecomposition } from '../upstream/packages/drawnix/src/services/layer-decomposition/canvas';
import { registerCanvasImage } from '../upstream/packages/drawnix/src/services/canvas-image-readiness';
import { areImageGenerationResultsReady } from '../upstream/packages/drawnix/src/utils/image-generation-anchor-readiness';
import { TaskStatus, TaskType, type Task } from '../upstream/packages/drawnix/src/types/task.types';
import type { PlaitImageGenerationAnchor } from '../upstream/packages/drawnix/src/types/image-generation-anchor.types';
import type { LayerArtifact } from '../upstream/packages/drawnix/src/services/layer-decomposition/types';

vi.mock('../upstream/packages/drawnix/src/data/image', () => ({
  loadImageElementForCanvas: vi.fn(async () => ({ naturalWidth: 64, naturalHeight: 64 })),
}));
vi.mock('../upstream/packages/drawnix/src/services/media-executor/fallback-utils', () => ({
  cacheRemoteUrl: vi.fn(async (url: string) => url),
}));

function boardWith(children: PlaitElement[]) {
  const board = createTestingBoard([withHistory, b => {
    b.getRectangle = element => RectangleClient.getRectangleByPoints(element.points || []);
    return b;
  }], children);
  IS_BOARD_ALIVE.set(board, true); fakeNodeWeakMap(board);
  return board;
}
function artifact(zIndex: number): LayerArtifact {
  return { groupId: 'SYNTHETIC-layers', zIndex, url: `/__aitu_cache__/image/layer-${zIndex}.png`,
    name: `layer-${zIndex}`, description: 'SYNTHETIC',
    boundingBox: { absolute: [0, 0, 64, 64], normalized: [0, 0, 1000, 1000] } };
}
const response = { groupId: 'SYNTHETIC-layers', width: 64, height: 64, background: artifact(0), layers: [artifact(1), artifact(2)] };
const source = { id: 'source', type: 'image', url: '/__aitu_cache__/image/source.png', points: [[0, 0], [64, 64]],
  generationTaskId: 'task-1', generationAnchorId: 'anchor-1' } as PlaitElement;
const anchor = { id: 'anchor-1', resultElementId: 'source', taskIds: ['task-1'], primaryTaskId: 'task-1' } as PlaitImageGenerationAnchor;
const task = { id: 'task-1', type: TaskType.IMAGE, status: TaskStatus.COMPLETED,
  params: { prompt: 'SYNTHETIC' }, createdAt: 1, updatedAt: 1, insertedToCanvas: true } as Task;

describe('decomposing a result before its generation placeholder disappears', () => {
  it('finishes the existing handoff only after all replacement layers paint, including after reload', async () => {
    const board = boardWith([source]);
    await insertLayerDecomposition(board, source.id, response);
    expect(board.children.some(e => e.id === source.id)).toBe(false);
    const layers = board.children.filter(e => e.type === 'image');
    expect(layers).toHaveLength(3);
    const renders = layers.map(e => registerCanvasImage(board, e.id, e.url));
    renders[0].setReady(true); renders[1].setReady(true);
    expect(areImageGenerationResultsReady(board, anchor, [task])).toBe(false);
    renders[2].setReady(true);
    expect(areImageGenerationResultsReady(board, anchor, [task])).toBe(true);
    const reloaded = boardWith(JSON.parse(JSON.stringify(board.children)));
    for (const e of reloaded.children.filter(e => e.type === 'image')) registerCanvasImage(reloaded, e.id, e.url).setReady(true);
    expect(areImageGenerationResultsReady(reloaded, anchor, [task])).toBe(true);
  });

  it('does not associate an imported image with a generation task', async () => {
    const imported = { ...source }; delete imported.generationTaskId; delete imported.generationAnchorId;
    const board = boardWith([imported]);
    await insertLayerDecomposition(board, imported.id, response);
    for (const e of board.children) {
      expect(e.generationTaskId).toBeUndefined(); expect(e.generationAnchorId).toBeUndefined();
    }
  });
});
