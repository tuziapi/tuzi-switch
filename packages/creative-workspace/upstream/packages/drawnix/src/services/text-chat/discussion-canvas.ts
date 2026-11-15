import { BoardTransforms, getViewportOrigination } from '@plait/core';
import { getCanvasBoardBinding } from '../canvas-operations';
import { workspaceService } from '../workspace-service';
import { ImageGenerationAnchorTransforms as anchors } from '../../plugins/with-image-generation-anchor';
import { resolveImageGenerationBatchAnchorPositions } from '../../utils/image-generation-anchor-placement';
import { parseSizeToPixels } from '../../utils/size-ratio';
import { taskQueueService } from '../task-queue';
import { discussionTargetLabels, type DiscussionPlan } from './discussion-plan';

/** Reserve all media slots before submitting any request. Text stays in discussion. */
export function reserveDiscussionCanvas(plan: DiscussionPlan, boardId: string, runId: string) {
  const binding = getCanvasBoardBinding();
  const items = plan.steps.flatMap(step => Array.from({ length: step.count }, () => step));
  if (!binding || binding.boardId !== boardId || workspaceService.getState().currentBoardId !== boardId)
    throw new Error('请先返回这段讨论所属的画板再执行。');
  const board = binding.board;
  const zoom = board.viewport?.zoom || 1;
  const origin = getViewportOrigination(board) || [0, 0];
  const media = items.filter(step => step.type !== 'text');
  const sizes = media.map(step => {
    const raw = parseSizeToPixels(step.size || (step.type === 'video' ? '1280x720' : '1024x1024'));
    const ratio = raw.width / raw.height;
    return step.type === 'audio' ? { width: 400, height: 180 }
      : { width: ratio >= 1 ? 400 : Math.round(400 * ratio), height: ratio >= 1 ? Math.round(400 / ratio) : 400 };
  });
  const reserved = { width: 420, height: 620 };
  const positions = resolveImageGenerationBatchAnchorPositions(board,
    [origin[0] + 40 / zoom, origin[1] + 80 / zoom], reserved, media.length);
  let mediaIndex = 0;
  const ids: Array<string | undefined> = [];
  try {
    items.forEach((step, index) => {
      if (step.type === 'text') { ids.push(undefined); return; }
      const slot = mediaIndex++;
      const anchor = anchors.insertAnchor(board, {
        workflowId: runId, batchId: runId, batchIndex: index + 1, batchTotal: items.length,
        position: positions[slot], expectedInsertPosition: positions[slot],
        size: sizes[slot], reservedInsertSize: reserved, anchorType: 'ratio',
        requestedSize: step.size, requestedCount: 1, zoom, prompt: step.prompt,
        title: `${discussionTargetLabels[step.type]}生成 · ${index + 1}/${items.length}`,
        subtitle: '准备提交',
      });
      ids.push(anchor.id);
    });
  } catch (error) {
    ids.forEach(id => { if (id) anchors.removeAnchor(board, id); });
    throw error;
  }
  // Reveal the newly submitted batch once; completion never steals the viewport.
  if (positions.length) {
    const start: [number, number] = [positions[0][0] - 80 / zoom, positions[0][1] - 80 / zoom];
    BoardTransforms.updateViewport(board, start, zoom);
  }
  return {
    ids,
    assertCurrent() {
      if (getCanvasBoardBinding()?.board !== board || workspaceService.getState().currentBoardId !== boardId)
        throw new Error('画板已切换，未提交的任务已停止。');
    },
    bind(index: number, taskIds: string[]) {
      const id = ids[index];
      if (id) anchors.updateAnchor(board, id, { taskIds, primaryTaskId: taskIds[0] });
    },
    finish() {
      // Keep submitted/failed tasks, remove only slots that never entered the queue.
      const tasks = taskQueueService.getAllTasks();
      ids.forEach(id => {
        if (id && !tasks.some(task => task.params.anchorId === id)) anchors.removeAnchor(board, id);
      });
    },
  };
}
