import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  request: vi.fn(), codex: vi.fn(), image: vi.fn(), video: vi.fn(), audio: vi.fn(), text: vi.fn(), cancel: vi.fn(), attachment: vi.fn(),
  tasks: [] as any[], listeners: new Set<(e: any) => void>(),
}));
vi.mock('./discussion-canvas', () => ({ reserveDiscussionCanvas: () => ({ ids: [], assertCurrent() {}, bind() {}, finish() {} }) }));
vi.mock('./request', () => ({ requestTextChat: mocks.request }));
vi.mock('./local-codex', () => ({ requestCodexDiscussion: mocks.codex }));
vi.mock('../../utils/gemini-api', () => ({ defaultGeminiClient: { sendChat: vi.fn() } }));
vi.mock('../../utils/umami-analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('../../utils/settings-manager', () => ({
  geminiSettings: { get: () => ({ textModelName: 'synthetic-text' }) },
  resolveInvocationRoute: (kind: string) => ({ apiKey: 'SYNTHETIC', profileId: 'synthetic', modelId: `synthetic-${kind}` }),
  createModelRef: (profileId: string, modelId: string) => ({ profileId, modelId }),
}));
vi.mock('../provider-routing', () => ({
  resolveInvocationPlanFromRoute: () => ({ binding: {} }),
  supportsTextBindingImageInput: () => true, getTextBindingMaxImageCount: () => 6,
}));
vi.mock('../agent/system-prompts', () => ({
  generateSystemPrompt: () => 'Synthetic system', generateReferenceImagesPrompt: (n: number) => `References: ${n}`,
}));
vi.mock('../generation-context-service', () => ({ buildKnowledgeContextBlock: async () => ({ contextBlock: 'knowledge' }) }));
vi.mock('./attachments', () => ({ readTextAttachment: mocks.attachment }));
vi.mock('../../mcp/tools/image-generation', () => ({ imageGenerationTool: { execute: mocks.image } }));
vi.mock('../../mcp/tools/audio-generation', () => ({ audioGenerationTool: { execute: mocks.audio } }));
vi.mock('../../mcp/tools/text-generation', () => ({ textGenerationTool: { execute: mocks.text } }));
vi.mock('../../mcp/tools/video-generation', () => ({ videoGenerationTool: { execute: mocks.video } }));
vi.mock('../task-queue', () => ({ taskQueueService: {
  getAllTasks: () => mocks.tasks, getTask: (id: string) => mocks.tasks.find(t => t.id === id),
  cancelTask: mocks.cancel,
  observeTaskUpdates: () => ({ subscribe: (fn: any) => {
    mocks.listeners.add(fn); return { unsubscribe: () => mocks.listeners.delete(fn) };
  } }),
} }));
import { discussionProse, requestDiscussion as planDiscussion, executeDiscussionPlan, validateDiscussionTools, waitForDiscussionTasks } from './discussion';
import { validateDiscussionImagePrompt, validateDiscussionPlan } from './discussion-plan';
const model = { profileId: 'synthetic', modelId: 'synthetic-text' };
function request() { return { sessionId: 'session', messageId: 'message', model,
  link: { boardId: 'original-board', runId: 'run', taskIds: [] },
  turns: [{ role: 'user' as const, content: '生成两张图片' }],
  onPlan: vi.fn(async (_plan: any) => {}), signal: new AbortController().signal, onUpdate: vi.fn(), onTasks: vi.fn(async () => {}), onBeforeSubmit: vi.fn(async () => {}),
}; }
async function requestDiscussion(r: ReturnType<typeof request>) {
  const result = await planDiscussion(r);
  const plan = r.onPlan.mock.calls.at(-1)?.[0];
  if (plan) await executeDiscussionPlan(r, plan);
  return result;
}
function reply(content: string, finishReason = 'stop') {
  mocks.request.mockImplementation(async (r: any) => {
    r.onUpdate({ content: content.slice(0, 26), reasoning: '供应商返回的思考' });
    return { content, reasoning: '供应商返回的思考', finishReason };
  });
}
const step = (count = 1) => ({ mcp: 'generate_image', args: { prompt: 'synthetic cat', count } });
beforeEach(() => {
  vi.clearAllMocks(); mocks.tasks.length = 0; mocks.listeners.clear();
  mocks.image.mockImplementation(async (a: any) => {
    const ids = Array.from({ length: a.count }, (_, i) => `task-${mocks.tasks.length + i}`);
    for (const id of ids) mocks.tasks.push({ id, status: 'completed', params: a });
    return { success: true, data: { taskIds: ids } };
  });
  for (const mock of [mocks.video, mocks.audio, mocks.text]) mock.mockImplementation(mocks.image.getMockImplementation()!);
});
it('streams prose and actual reasoning without leaking tool JSON', async () => {
  reply(JSON.stringify({ content: '这是建议，不会生成图片。', next: [] }));
  const r = request();
  const result = await requestDiscussion(r);
  expect(result.content).toBe('这是建议，不会生成图片。');
  expect(result.reasoning).toBe('供应商返回的思考');
  expect(r.onUpdate.mock.calls.every(([s]) => !s.content.startsWith('{'))).toBe(true);
  expect(mocks.image).not.toHaveBeenCalled();
  expect(discussionProse('{"next":[')).toBe('');
  expect(discussionProse('{"content":"hello\\nworld",')).toBe('hello\nworld');
});
it('dispatches the batch once with original-board identity before any queue call', async () => {
  reply(JSON.stringify({ content: '开始生成', next: [step(2)] }));
  const r = request(); await requestDiscussion(r);
  expect(mocks.image).toHaveBeenCalledTimes(2);
  expect(mocks.image.mock.calls[0][0]).toMatchObject({ count: 1, autoInsertToCanvas: true,
    conversationLink: { sessionId: 'session', messageId: 'message', runId: 'run', boardId: 'original-board' },
    modelRef: { profileId: 'synthetic', modelId: 'synthetic-image' },
  });
  expect(r.onTasks).toHaveBeenCalledWith(['task-0', 'task-1']);
  expect(mocks.listeners.size).toBe(0);
});
it.each([
  ['truncated', '{"content":"ok","next":[{"mcp":"generate_image","args":{"prompt":"x"}}', 'stop'],
  ['unfinished', JSON.stringify({ content: 'ok', next: [step()] }), 'length'],
  ['embedded plan', 'prefix ' + JSON.stringify({ content: 'ok', next: [step()] }), 'stop'],
  ['unknown tool', JSON.stringify({ content: 'ok', next: [{ ...step(), mcp: 'delete_board' }] }), 'stop'],
  ['invalid count', JSON.stringify({ content: 'ok', next: [step(0)] }), 'stop'],
  ['oversized batch', JSON.stringify({ content: 'ok', next: [step(6), step(5)] }), 'stop'],
  ['untrusted reference in second call', JSON.stringify({ content: 'ok', next: [step(), { ...step(), args: { prompt: 'x', referenceImages: ['https://unknown.invalid/a.png'] } }] }), 'stop'],
])('rejects %s before media submission', async (_label, content, reason) => {
  reply(content, reason);
  await expect(requestDiscussion(request())).rejects.toThrow();
  expect(mocks.image).not.toHaveBeenCalled(); expect(mocks.video).not.toHaveBeenCalled();
});
it('uses uploaded references without duplicating them in the text request', async () => {
  const ref = { id: 'attachment', kind: 'image', name: 'synthetic.png', size: 12, mimeType: 'image/png' };
  mocks.attachment.mockResolvedValue({ sessionId: 'session', dataUrl: 'data:image/png;base64,synthetic' });
  reply(JSON.stringify({ content: '修改图片', next: [{ mcp: 'generate_image', args: { prompt: '修改', referenceImages: ['[图片1]'] } }] }));
  const r = request(); (r.turns[0] as any).attachments = [ref];
  await requestDiscussion(r);
  expect(mocks.image.mock.calls[0][0].referenceImages).toEqual(['data:image/png;base64,synthetic']);
  expect(mocks.request.mock.calls[0][0].turns.at(-1)).toMatchObject({ attachments: [ref], images: [] });
});
it('rejects another session attachment before requesting text', async () => {
  mocks.attachment.mockResolvedValue({ sessionId: 'other', dataUrl: 'data:image/png;base64,synthetic' });
  const r = request(); (r.turns[0] as any).attachments = [{ id: 'x', kind: 'image' }];
  await expect(requestDiscussion(r)).rejects.toThrow('附件'); expect(mocks.request).not.toHaveBeenCalled();
});
it('video shares queue dispatch and selected model route', async () => {
  reply(JSON.stringify({ content: '生成视频', next: [{ mcp: 'generate_video', args: { prompt: 'sunset', count: 1, seconds: 5 } }] }));
  await requestDiscussion(request());
  expect(mocks.video.mock.calls[0][0]).toMatchObject({ model: 'synthetic-video', seconds: 5 });
  expect(mocks.image).not.toHaveBeenCalled();
});
it('stops active tasks and cleans subscriptions', async () => {
  mocks.tasks.push({ id: 'one', status: 'processing' }, { id: 'two', status: 'completed' });
  const controller = new AbortController();
  const promise = waitForDiscussionTasks(['one', 'two'], controller.signal);
  controller.abort();
  await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith('one'); expect(mocks.listeners.size).toBe(0);
});
it('keeps successes when a batch partially fails', async () => {
  mocks.tasks.push({ id: 'one', status: 'completed' }, { id: 'two', status: 'failed' });
  await expect(waitForDiscussionTasks(['one', 'two'], new AbortController().signal)).rejects.toThrow('1 个生成任务未完成');
  expect(mocks.cancel).not.toHaveBeenCalled(); expect(mocks.tasks[0].status).toBe('completed');
});
it('does not accept fractional or negative batch count', () => {
  for (const count of [-1, 1.2, '2']) expect(() => validateDiscussionTools([{ name: 'generate_image', arguments: { prompt: 'x', count } } as any])).toThrow();
});

it('does not submit media after planning transport failure and explains the stage', async () => {
  mocks.request.mockRejectedValueOnce(new Error('文本模型连接中断'));
  const r = request();
  await expect(requestDiscussion(r)).rejects.toThrow('尚未提交生成任务');
  expect(r.onBeforeSubmit).not.toHaveBeenCalled();
  expect(mocks.image).not.toHaveBeenCalled();
});
it('requires durable dispatch marker before the first tool; save failure submits nothing', async () => {
  reply(JSON.stringify({content:'生成',next:[step()]}));
  const r=request(); r.onBeforeSubmit.mockRejectedValueOnce(new Error('disk full'));
  await expect(requestDiscussion(r)).rejects.toThrow('disk full');
  expect(mocks.image).not.toHaveBeenCalled();
});
it('marks dispatch before any media request exactly once per batch', async () => {
  reply(JSON.stringify({content:'生成',next:[step(),step()]}));
  const r=request(); await requestDiscussion(r);
  expect(r.onBeforeSubmit).toHaveBeenCalledTimes(1);
  expect(r.onBeforeSubmit.mock.invocationCallOrder[0]).toBeLessThan(mocks.image.mock.invocationCallOrder[0]);
});

it('saves a preview without creating any execution task', async () => {
  reply(JSON.stringify({ content: '确认后执行', next: [step(3)] }));
  const r = request(); await planDiscussion(r);
  expect(r.onPlan.mock.calls[0][0]).toMatchObject({ status: 'ready', steps: [{ count: 3, model: 'synthetic-image' }] });
  expect(mocks.image).not.toHaveBeenCalled(); expect(r.onBeforeSubmit).not.toHaveBeenCalled();
});
it.each(['image', 'video', 'audio', 'text'] as const)('pins %s execution to the user model and ignores model-supplied routing', async kind => {
  reply(JSON.stringify({ content: '计划', next: [{mcp: `generate_${kind}`, args:{prompt:'one',count:2,model:'wrong',modelRef:{profileId:'wrong',modelId:'wrong'},autoInsertToCanvas:true,params:{apiKey:'wrong'}}}] }));
  const r = {...request(), context:{targetType:kind,targetModelRef:{profileId:'chosen-provider',modelId:'chosen-model'},executionParams:{quality:'high'}}};
  await requestDiscussion(r);
  const mock = mocks[kind]; expect(mock).toHaveBeenCalledTimes(2);
  expect(mock.mock.calls[0][0]).toMatchObject({model:'chosen-model',modelRef:{profileId:'chosen-provider',modelId:'chosen-model'},params:{quality:'high'},autoInsertToCanvas:kind!=='text'});
  expect(mock.mock.calls[1][0]).toMatchObject({batchIndex:2,batchTotal:2});
});
it('rejects a different task type before preview or submission', async () => {
  reply(JSON.stringify({content:'video',next:[{mcp:'generate_video',args:{prompt:'x'}}]}));
  const r={...request(),context:{targetType:'image' as const,targetModelRef:{profileId:'synthetic',modelId:'image'}}};
  await expect(planDiscussion(r)).rejects.toThrow('类型'); expect(r.onPlan).not.toHaveBeenCalled();
});
it('never resubmits a consumed or cancelled plan', async () => {
  reply(JSON.stringify({content:'x',next:[step()]})); const r=request(); await planDiscussion(r);
  for(const status of ['started','cancelled']) await expect(executeDiscussionPlan(r,{...r.onPlan.mock.calls[0][0],status})).rejects.toThrow('已经');
  expect(mocks.image).not.toHaveBeenCalled();
});

const wallpapers = ['樱花校园', '霓虹街道', '奇幻森林', '海边日落', '星空山巅'].map(scene =>
  `${scene}的动漫壁纸，细腻日系风格，单幅完整画面，不分屏、不拼贴、无分镜。`);
const observedBadPrompt = '生成 5 张高质量动漫壁纸：电影感构图、细腻日系动漫画风，每张呈现不同场景与氛围（樱花校园、赛博朋克城市、奇幻森林、海边日落、星空山巅），画面干净，无文字。';

it.each(['configured', 'codex'])('%s previews and dispatches five distinct single-image prompts without extra planning', async backend => {
  reply(JSON.stringify({content:'5张独立壁纸，请确认后生成',next:wallpapers.map(prompt=>({mcp:'generate_image',args:{prompt,count:1}}))}));
  mocks.codex.mockImplementation(mocks.request.getMockImplementation()!);
  const r = {...request(), ...(backend==='codex' ? {codex:{model:'synthetic-codex',connectionId:1}} : {})};
  r.turns[0].content='帮我批量生成5张好看的动漫壁纸吧';
  await planDiscussion(r);
  const transport=backend==='codex'?mocks.codex:mocks.request;
  const unused=backend==='codex'?mocks.request:mocks.codex;
  expect(transport).toHaveBeenCalledTimes(1);
  expect(unused).not.toHaveBeenCalled();
  expect(transport.mock.calls[0][0].turns[0].content).toContain('逐张展开为 N 个 generate_image 步骤');
  expect(transport.mock.calls[0][0].turns[0].content).toContain('明确的用户数量优先于界面的默认数量');
  const plan=r.onPlan.mock.calls[0][0];
  expect(plan.steps.map((s:any)=>s.prompt)).toEqual(wallpapers);
  expect(plan.steps.every((s:any)=>s.count===1)).toBe(true);
  expect(mocks.image).not.toHaveBeenCalled();
  await executeDiscussionPlan(r,plan);
  expect(mocks.image.mock.calls.map(([a])=>a.prompt)).toEqual(wallpapers);
  expect(mocks.image.mock.calls.map(([a])=>[a.count,a.batchIndex,a.batchTotal])).toEqual([1,2,3,4,5].map(i=>[1,i,5]));
  expect(mocks.image.mock.calls.every(([a])=>a.model==='synthetic-image' && a.conversationLink.boardId==='original-board')).toBe(true);
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each(['configured','codex'])('%s rejects the observed collage-producing plan before preview and never retries automatically', async backend=>{
  reply(JSON.stringify({content:'5张不同场景',next:[{mcp:'generate_image',args:{prompt:observedBadPrompt,count:5}}]}));
  mocks.codex.mockImplementation(mocks.request.getMockImplementation()!);
  const r={...request(),...(backend==='codex'?{codex:{model:'synthetic-codex',connectionId:1}}:{})};
  await expect(planDiscussion(r)).rejects.toThrow('整批要求');
  expect(r.onPlan).not.toHaveBeenCalled();
  expect(mocks.image).not.toHaveBeenCalled();
  expect(backend==='codex'?mocks.codex:mocks.request).toHaveBeenCalledTimes(1);
});

it('can read old plans but blocks a bad saved prompt before dispatching even an earlier valid step', async()=>{
  reply(JSON.stringify({content:'计划',next:[step()]}));
  const r=request(); await planDiscussion(r);
  const plan=r.onPlan.mock.calls[0][0];
  plan.steps.push({...plan.steps[0],prompt:observedBadPrompt,count:5});
  expect(()=>validateDiscussionPlan(plan)).not.toThrow();
  await expect(executeDiscussionPlan(r,plan)).rejects.toThrow('整批要求');
  expect(r.onBeforeSubmit).not.toHaveBeenCalled();
  expect(mocks.image).not.toHaveBeenCalled();
});

it.each([
  '请批量生成五张动漫壁纸',
  '生成2张图',
  '先使用日系画风。生成 5 张壁纸。',
  'Create five different anime wallpapers',
  'Generate a set of 5 images of cats',
  '生成5张五格拼图',
])('rejects clear multi-file commands in a single image prompt: %s', prompt=>{
  expect(()=>validateDiscussionImagePrompt(prompt)).toThrow('整批要求');
});

it.each([
  '生成一张五格漫画，每格展现不同场景，保持统一画风',
  '一张拼图，包含樱花校园、霓虹街道、森林、海边、星空五个场景',
  'Create a collage with five anime scenes',
  '墙上挂着5张照片，桌上放着3幅画，暖光',
  '不要生成5张图片，只要一张完整画面',
  '一张海报，文字为“生成5张图片”',
  ...wallpapers,
])('preserves intentional collages, depicted objects and single-image descriptions: %s', prompt=>{
  expect(()=>validateDiscussionImagePrompt(prompt)).not.toThrow();
});

it('preserves explicit collage composition and same-prompt variations exactly', async()=>{
  const prompt='一张五格动漫拼图，每格不同季节，保留五格布局';
  reply(JSON.stringify({content:'同一拼图提示词的两张变体，待确认',next:[{mcp:'generate_image',args:{prompt,count:2}}]}));
  await requestDiscussion(request());
  expect(mocks.image.mock.calls.map(([a])=>a.prompt)).toEqual([prompt,prompt]);
  expect(mocks.image.mock.calls.every(([a])=>a.count===1)).toBe(true);
});
