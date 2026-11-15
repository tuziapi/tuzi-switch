// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ send: vi.fn(), cache: vi.fn(), compress: vi.fn(), keepOriginal: false }));
vi.mock('../provider-routing/provider-transport', () => ({ providerTransport: { send: mocks.send } }));
vi.mock('../unified-cache-service', () => ({ unifiedCacheService: { cacheMediaFromBlob: mocks.cache } }));
vi.mock('../reference-image-settings', () => ({ readKeepOriginalImageEnabled: () => mocks.keepOriginal }));
vi.mock('@aitu/utils', async original => ({ ...await original<any>(), compressImageBlob: mocks.compress }));
import { buildGeminiOmniVideoBody } from '../gemini-omni-video';
import { generateVideo, submitVideoGeneration, resumeVideoPolling } from '../media-api/video-api';
import { getModelConfig, getCompatibleParams, getSizeOptionsForModel } from '../../constants/model-config';
import { getVideoModelConfig } from '../../constants/video-model-config';
import { inferBindingsForProviderModel } from '../provider-routing/binding-inference';
import { GEMINI_OMNI_MODEL_ID as model } from '../../utils/gemini-omni-model';
import { appendVideoOutputParams, resolveVideoReferenceField, resolveVideoSubmission } from '../video-binding-utils';

const config = { defaultModel: model, baseUrl: 'https://synthetic.invalid/v1', apiKey: 'SYNTHETIC' };
const form = (seconds='4', size='1280x720') => {
  const f=new FormData(); f.set('model', model); f.set('prompt','合成山谷场景'); f.set('seconds',seconds); f.set('size',size); return f;
};
beforeEach(()=>{ vi.clearAllMocks(); mocks.send.mockReset(); mocks.keepOriginal=false; });

it('exposes exact video classification, duration, sizes and references without Veo watermark controls',()=>{
  const m=getModelConfig(model)!;
  expect(m.type).toBe('video'); expect(m.videoDefaults?.duration).toBe('10');
  const v=getVideoModelConfig(model);
  expect(v.durationOptions.map(o=>o.value)).toEqual(['3','4','5','6','7','8','9','10','11','12','13','14','15']);
  expect(v.imageUpload.maxCount).toBe(10);
  expect(getSizeOptionsForModel(model).map((option) => option.value)).toEqual(
    ['360p', '720p', '1080p', '4k']
  );
  expect(getCompatibleParams(model).some(p=>p.id==='watermark')).toBe(false);
  const bindings=inferBindingsForProviderModel({id:'synthetic',name:'Synthetic',providerType:'openai-compatible',baseUrl:config.baseUrl,apiKey:'SYNTHETIC',authType:'bearer',enabled:true},m);
  expect(bindings[0]).toMatchObject({requestSchema:'tuzi.video.generation-json',submitPath:'/videos',metadata:{video:{defaultDuration:'10'}}});
  const stale=inferBindingsForProviderModel({id:'synthetic',name:'Synthetic',providerType:'custom',baseUrl:config.baseUrl,apiKey:'SYNTHETIC',authType:'bearer',enabled:true},{...m,type:'text'});
  expect(stale[0].operation).toBe('video'); expect(stale[0].requestSchema).toBe('tuzi.video.generation-json');
});
it('allowlists JSON fields even when old model parameters remain',async()=>{
  const f=form(); f.set('watermark','false'); f.set('seed','123'); f.set('background','true'); f.set('metadata','{}');
  expect(JSON.parse(await buildGeminiOmniVideoBody(f))).toEqual({model,prompt:'合成山谷场景',seconds:'4',size:'1280x720'});
});
it('keeps legacy Omni JSON headers, default duration and duration limit', async () => {
  const legacy = 'gemini-omni-1.1-flash';
  mocks.send.mockImplementation(async () => Response.json({ id: 'legacy-synthetic', status: 'queued' }));
  await submitVideoGeneration({ model: legacy, prompt: 'legacy prompt' }, { ...config, defaultModel: legacy });
  const request = mocks.send.mock.calls[0][1];
  expect(request.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(request.body)).toMatchObject({ model: legacy, seconds: '4' });
  await expect(submitVideoGeneration({ model: legacy, prompt: 'test', duration: '11' }, config)).rejects.toThrow();
  expect(mocks.send).toHaveBeenCalledTimes(1);
});
it.each(['2','16','4.5','abc'])('rejects unsupported duration %s before submitting',async seconds=>{
  await expect(submitVideoGeneration({model,prompt:'test',duration:seconds},config)).rejects.toThrow(); expect(mocks.send).not.toHaveBeenCalled();
});
it.each(['1024x1024','auto','720p@1:1'])('rejects unsupported size %s',async size=>{
  await expect(buildGeminiOmniVideoBody(form('4',size))).rejects.toThrow('尺寸');
});
it('encodes multiple local references as ordered input parts with raw base64 and no duplicate prompt',async()=>{
  const f=form(); f.append('input_reference',new Blob(['image one'],{type:'image/png'}),'one.png'); f.append('input_reference',new Blob(['image two'],{type:'image/webp'}),'two.webp');
  const b=JSON.parse(await buildGeminiOmniVideoBody(f));
  expect(b.prompt).toBeUndefined(); expect(b.input).toEqual([{type:'text',text:'合成山谷场景'},{type:'image',mime_type:'image/png',data:btoa('image one')},{type:'image',mime_type:'image/webp',data:btoa('image two')}]);
});
it('maps Wan and Kling 4 video parameters to their unified endpoint fields', () => {
  const wan = new FormData();
  appendVideoOutputParams(wan, 'wan3.0-video', '720P', { ratio: 'adaptive' });
  expect(wan.get('resolution')).toBe('720P');
  expect(wan.get('ratio')).toBe('adaptive');
  expect(resolveVideoSubmission('wan3.0-video', '30').durationField).toBe('duration');
  expect(resolveVideoReferenceField('wan3.0-video', 0)).toBe('first_frame');
  expect(resolveVideoReferenceField('wan3.0-video', 1)).toBe('last_frame');

  const kling = new FormData();
  appendVideoOutputParams(kling, 'kling-4.0', '1080p', { ratio: '21:9', watermark: false });
  expect(kling.get('size')).toBe('1080p');
  expect(kling.get('ratio')).toBe('21:9');
  expect(kling.get('watermark')).toBe('false');
  expect(resolveVideoSubmission('kling-4.0', '3').durationField).toBe('seconds');
});
it('submits Wan and Kling 4 as JSON instead of multipart form data', async () => {
  mocks.send.mockImplementation(async () => Response.json({ id: 'task-json', status: 'queued' }));

  await submitVideoGeneration({
    model: 'wan3.0-video',
    prompt: 'wan prompt',
    duration: '2',
    size: '480P',
    params: { ratio: '16:9', watermark: false },
  }, config);
  const wanRequest = mocks.send.mock.calls.at(-1)?.[1];
  expect(wanRequest.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(wanRequest.body)).toMatchObject({
    model: 'wan3.0-video',
    duration: 2,
    resolution: '480P',
    ratio: '16:9',
    watermark: false,
  });

  await submitVideoGeneration({
    model: 'kling-4.0',
    prompt: 'kling prompt',
    duration: '3',
    size: '720p',
    params: { ratio: '16:9', watermark: false },
  }, config);
  const klingRequest = mocks.send.mock.calls.at(-1)?.[1];
  expect(klingRequest.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(klingRequest.body)).toMatchObject({
    model: 'kling-4.0',
    contents: [{ type: 'prompt', text: 'kling prompt' }],
    settings: { duration: 3, resolution: '720p', aspect_ratio: '16:9' },
    options: { watermark_info: { enabled: false } },
  });
});
it('bounds references and never silently drops an image',async()=>{
  const f=form(); for(let i=0;i<11;i++) f.append('input_reference',new Blob(['x'],{type:'image/png'}));
  await expect(buildGeminiOmniVideoBody(f)).rejects.toThrow('10');
  const invalid=form(); invalid.append('input_reference','file:///private.png');
  await expect(buildGeminiOmniVideoBody(invalid)).rejects.toThrow('参考图无效');
});
it('compresses oversized references within snapshot budget and honors keep-original',async()=>{
  const f=form(); f.append('input_reference',new Blob([new Uint8Array(700*1024)],{type:'image/png'}));
  mocks.compress.mockResolvedValue(new Blob(['small'],{type:'image/jpeg'}));
  expect(JSON.parse(await buildGeminiOmniVideoBody(f)).input[1].mime_type).toBe('image/jpeg');
  mocks.keepOriginal=true; mocks.compress.mockClear();
  await expect(buildGeminiOmniVideoBody(f)).rejects.toThrow('参考图总量过大'); expect(mocks.compress).not.toHaveBeenCalled();
});
it('aborts preparation before network submission',async()=>{
  const c=new AbortController(); c.abort();
  await expect(submitVideoGeneration({model,prompt:'test'},config,c.signal)).rejects.toThrow(); expect(mocks.send).not.toHaveBeenCalled();
});
it('reports content download failure without submitting or exposing an expired result',async()=>{
  mocks.send.mockImplementation(async (_p,r)=>r.path.endsWith('/content')?new Response('expired',{status:404}):Response.json({model,status:'completed',video_url:'https://expired.invalid/video.mp4'}));
  await expect(resumeVideoPolling('task_synthetic',config,{interval:1})).rejects.toThrow('404');
  expect(mocks.send.mock.calls.every(([,r])=>r.method!=='POST')).toBe(true); expect(mocks.cache).not.toHaveBeenCalled();
});
it.each([false,true])('downloads authenticated content instead of untrusted inline URL; resume=%s',async resume=>{
  mocks.send.mockImplementation(async (_provider,r)=>{
    if(r.method==='POST') return Response.json({id:'task_synthetic',status:'queued'});
    if(r.path.endsWith('/content')) return new Response('synthetic video',{headers:{'Content-Type':'video/mp4'}});
    return Response.json({id:'task_synthetic',model,status:'completed',seconds:'4',video_url:'https://expired.invalid/video.mp4'});
  });
  const fetchImpl=vi.fn(); const c=new AbortController();
  const result=resume?await resumeVideoPolling('task_synthetic',{...config,fetchImpl},{signal:c.signal,interval:1}):await generateVideo({model,prompt:'test',duration:4},{...config,fetchImpl},{signal:c.signal,interval:1});
  expect(result.url).toBe('/__aitu_cache__/video/task_synthetic.mp4');
  expect(mocks.send.mock.calls.map(([,r])=>r.path)).toEqual(resume?['/videos/task_synthetic','/videos/task_synthetic/content']:['/videos','/videos/task_synthetic','/videos/task_synthetic/content']);
  const [,download]=mocks.send.mock.calls.at(-1)!;
  expect(download).toMatchObject({method:'GET',signal:c.signal,fetcher:fetchImpl}); expect(mocks.cache).toHaveBeenCalledTimes(1);
  if(!resume){ const req=mocks.send.mock.calls[0][1];expect(req.headers['Content-Type']).toBe('application/json');expect(JSON.parse(req.body)).toMatchObject({model,seconds:'4'}); }
});
