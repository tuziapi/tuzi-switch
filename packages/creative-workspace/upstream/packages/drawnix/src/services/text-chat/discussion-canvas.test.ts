import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ board: { children: [] as any[], viewport: { zoom: 1 } }, current: 'board', tasks: [] as any[], binding: true }));
vi.mock('@plait/core', () => ({ BoardTransforms: { updateViewport: vi.fn() }, getViewportOrigination: () => [0, 0] }));
vi.mock('../canvas-operations', () => ({ getCanvasBoardBinding: () => m.binding ? { board: m.board, boardId: 'board' } : null }));
vi.mock('../workspace-service', () => ({ workspaceService: { getState: () => ({ currentBoardId: m.current }) } }));
vi.mock('../task-queue', () => ({ taskQueueService: { getAllTasks: () => m.tasks } }));
vi.mock('../../utils/image-generation-anchor-placement', () => ({ resolveImageGenerationBatchAnchorPositions: (_b: any, _o: any, _s: any, n: number) => Array.from({length:n},(_,i)=>[i*460,80]) }));
vi.mock('../../plugins/with-image-generation-anchor', () => ({ ImageGenerationAnchorTransforms: {
  insertAnchor: (_b: any, options: any) => { const a = { ...options, id: `slot-${m.board.children.length}` }; m.board.children.push(a); return a; },
  updateAnchor: (_b: any, id: string, patch: any) => Object.assign(m.board.children.find(a=>a.id===id), patch),
  removeAnchor: (_b: any, id: string) => { m.board.children = m.board.children.filter(a=>a.id!==id); },
} }));
import { reserveDiscussionCanvas } from './discussion-canvas';
const plan = { steps: [{type:'image', count:2, prompt:'cat'}, {type:'video',count:1,prompt:'sea',size:'1280x720'}, {type:'text',count:1,prompt:'copy'}] } as any;
beforeEach(()=>{m.board.children=[];m.tasks=[];m.current='board';m.binding=true;});
it('reserves each media item before submission, leaves text in discussion, binds exact task IDs',()=>{
 const canvas=reserveDiscussionCanvas(plan,'board','run');
 expect(canvas.ids).toEqual(['slot-0','slot-1','slot-2',undefined]);
 expect(m.board.children.map(a=>a.batchIndex)).toEqual([1,2,3]);
 expect(m.board.children[2]).toMatchObject({ title:'视频生成 · 3/4', size:{width:400,height:225}, expectedInsertPosition:[920,80] });
 canvas.bind(2,['video-task']);expect(m.board.children[2].primaryTaskId).toBe('video-task');
});
it('cleans only never-submitted slots on interruption, preserving failed/active tasks',()=>{
 const canvas=reserveDiscussionCanvas(plan,'board','run');
 m.tasks=[{params:{anchorId:canvas.ids[0]},status:'failed'}];
 canvas.finish();expect(m.board.children.map(a=>a.id)).toEqual([canvas.ids[0]]);
});
it('blocks wrong board and stops remaining submissions on a board switch',()=>{
 expect(()=>reserveDiscussionCanvas(plan,'other','run')).toThrow('画板');
 expect(m.board.children).toEqual([]);
 const canvas=reserveDiscussionCanvas(plan,'board','run');m.current='other';
 expect(()=>canvas.assertCurrent()).toThrow('画板');
});
