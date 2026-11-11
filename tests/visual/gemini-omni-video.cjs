// Compiled production UI with synthetic transport only; all remote networking blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.TEXT_CHAT_BROWSER || 'chromium';
const base = process.env.TEXT_CHAT_URL || 'http://127.0.0.1:5212/ui04.html?canvas=1&page=creative';
const output = process.env.TEXT_CHAT_OUTPUT || '/tmp/tuzi-omni-browser';
fs.mkdirSync(output, {recursive:true});
const checks = [];
async function until(fn, label) { const end=Date.now()+20000; while(Date.now()<end) { if(await fn()) return; await new Promise(r=>setTimeout(r,100)); } throw Error(label); }
async function records(p, db, store) { return p.evaluate(({db,store})=>new Promise((resolve,reject)=>{ const req=indexedDB.open(db); req.onerror=()=>reject(req.error); req.onsuccess=()=>{ const d=req.result; const get=d.transaction(store).objectStore(store).getAll(); get.onsuccess=()=>{resolve(get.result); d.close();}; get.onerror=()=>reject(get.error); }; }),{db,store}); }
(async()=>{
const profile = engine==='webkit' ? fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'discussion-webkit-')) : null;
const browser=engine==='webkit' ? null : await pw.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const context=profile ? await pw.webkit.launchPersistentContext(profile,{headless:true,viewport:{width:1360,height:900}}) : await browser.newContext({viewport:{width:1360,height:900}});
await context.addInitScript(()=>{
  if (!localStorage.getItem('chat-drawer-width')) localStorage.setItem('chat-drawer-width', '640');
  window.__discussionStorageErrors=[];
  const open=indexedDB.open.bind(indexedDB); indexedDB.open=function(...args){const r=open(...args);r.addEventListener('error',()=>window.__discussionStorageErrors.push({open:args,error:r.error?.message}));return r;};
  const transaction=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(...args){try{const t=transaction.apply(this,args);t.addEventListener('abort',()=>window.__discussionStorageErrors.push({db:this.name,abort:t.error?.message}));return t;}catch(e){window.__discussionStorageErrors.push({db:this.name,transaction:args,message:e.message});throw e;}};
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(...args){try{return put.apply(this,args);}catch(e){window.__discussionStorageErrors.push({store:this.name,message:e.message,keys:Object.keys(args[0]||{})});throw e;}};
});
const p=await context.newPage(); p.setDefaultTimeout(15000);
const errors=[]; p.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',r=> {
const u=new URL(r.request().url());
if(u.pathname==='/synthetic-media.mp4') return r.fulfill({contentType:'video/mp4',body:fs.readFileSync(require('node:path').join(__dirname,'fixtures/synthetic-video.mp4'))});
if(u.pathname==='/synthetic-media.wav') return r.fulfill({contentType:'audio/wav',body:fs.readFileSync(require('node:path').join(__dirname,'fixtures/synthetic-audio.wav'))});
return u.hostname==='127.0.0.1'||/^(data:|blob:)/.test(r.request().url())?r.continue():r.abort();
});
const shot=name=>p.screenshot({path:`${output}/${engine}-${name}.png`});
async function mock(content, delay=80, next=[]) { await p.evaluate(({content,delay,next})=>{const event=x=>'data: '+JSON.stringify(x)+'\n\n'; window.__creativeRequestFixture.responses['POST /v1/chat/completions']={body:'',contentType:'text/event-stream',delayMs:delay,chunks:[event({choices:[{delta:{reasoning_content:'先确认画面主题，再安排生成任务。'}}]}),event({choices:[{delta:{content:JSON.stringify({content,next})}}]}),event({choices:[{delta:{},finish_reason:'stop'}]}),'data: [DONE]\n\n']};},{content,delay,next}); }
try {
    await p.goto(base+'&media-qa=1');
    await p.evaluate(() => {
      window.__creativeRequestFixture.responses["GET /v1/models"] = {
        body: {
          data: [
            "gpt-4o",
            "claude-sonnet-4-5",
            "deepseek-chat",
            "gemini-2.5-flash",
            ...Array.from(
              { length: 14 },
              (_, index) => `gpt-5-qa-${index + 1}`,
            ),
          ].map((id) => ({
            id,
            object: "model",
            supported_endpoint_types: ["openai"],
            endpoints: {
              openai: { path: "/v1/chat/completions", method: "POST" },
            },
          })).concat([{id:'gemini-omni-1.1-flash',category:'文本,图像,视频',supported_endpoint_types:['openai-video'],endpoints:{'openai-video':{path:'/v1/videos',method:'POST'}}},{id:'MiniMax-H3',supported_endpoint_types:['openai-video']},{id:'suno/music',supported_endpoint_types:['suno-v2'],endpoints:{'suno-v2':{path:'/suno/v2/music',method:'POST'}}},{id:'gpt-image-2.5-sunburst',object:'model',supported_endpoint_types:['image-generation'],endpoints:{'image-generation':{path:'/v1/images/generations',method:'POST'}}}]),
        },
      };
    });
    await p.getByRole("button", { name: "创作配置", exact: true }).click();
    const d = p.getByTestId("settings-dialog");
    await d.getByRole("button", { name: "兔子账户", exact: true }).click();
    await d.getByText("合成开发密钥", { exact: true }).click();
    await d.getByRole("button", { name: /^(保存并)?获取模型$/ }).click();
    await p.getByRole("button", { name: "全选", exact: true }).click();
    await p.getByText(/已选 22 个/).waitFor();
    await p.getByRole("button", { name: "添加模型", exact: true }).click();
    await d.getByText("gemini-omni-1.1-flash", {exact:true}).first().waitFor();
    await d.getByRole("button", { name: "保存", exact: true }).click();
    await d.waitFor({ state: "hidden" });
    await p
      .getByRole("navigation", { name: "创作导航" })
      .getByRole("button", { name: "自由画布", exact: true })
      .click();
    await p.locator(".plait-board-container").waitFor();
    if (await p.getByText("不再提示", { exact: true }).isVisible())
      await p.getByText("不再提示", { exact: true }).click();


await p.getByTestId('discussion-strip').waitFor();
const labels={image:'图片',video:'视频',audio:'音频',text:'文本'};
const models={image:'gpt-image-2.5-sunburst',video:'MiniMax-H3',audio:'suno/music',text:'gpt-4o'};
const selected=async kind=> {
await p.locator('.generation-type-dropdown__trigger').click();
await p.locator('.generation-type-dropdown__item').filter({hasText:labels[kind]}).click();
await p.locator('.model-dropdown__trigger:visible').first().click();
await p.getByPlaceholder('搜索模型名 / 展示名 / 供应商').fill(models[kind]);
await p.getByText(models[kind],{exact:true}).last().click();
};

const omni='gemini-omni-1.1-flash';
models.video=omni;
await selected('video');
assert((await p.locator('.model-dropdown__trigger:visible').first().innerText()).includes('omni'));
const directPosts=()=>p.evaluate(()=>window.__creativeRequestFixture.requests.filter(r=>r.method==='POST'&&r.path==='/v1/videos'));
const readBody=r=>typeof r.body==='string'?JSON.parse(Buffer.from(r.body,'base64').toString()):r.body;
async function setVideo(id){
 await p.evaluate(({id,omni,video})=> {
  let sequence=0;
  const responses=window.__creativeRequestFixture.responses;
  responses['POST /v1/videos']={get body(){
   const taskId=`${id}-${++sequence}`;
   responses[`GET /v1/videos/${taskId}`]={body:{id:taskId,model:omni,status:'completed',seconds:'4',video_url:'https://expired.synthetic.invalid/video.mp4'}};
   responses[`GET /v1/videos/${taskId}/content`]={body:null,bodyBase64:video,contentType:'video/mp4'};
   return {id:taskId,model:omni,status:'queued'};
  }};
 },{id,omni,video:fs.readFileSync(require('node:path').join(__dirname,'fixtures/synthetic-video.mp4')).toString('base64')});
}
// Parameter menus must expose this model's own durations/sizes.
await p.locator('.parameters-dropdown__trigger').click();
const sizes=await p.locator('.parameters-dropdown__option').allTextContents();
assert(sizes.some(t=>t.includes('4K')&&t.includes('竖')));
assert(sizes.some(t=>t.includes('360P')));
await p.keyboard.press('Escape');
await shot('selected-video-model');
checks.push('exact Omni ID appears under video with dedicated resolution choices');
await setVideo('synthetic-omni-direct');
await p.getByTestId('ai-input-textarea').fill('SYNTHETIC：生成4秒山谷视频');
await p.locator('.ai-input-bar__send-btn').click();
await until(async()=>{const tasks=await records(p,'aitu-app','tasks');return tasks.length===1&&tasks[0].status==='completed'&&tasks[0].insertedToCanvas;},'direct Omni completes');
let bodies=(await directPosts()).map(readBody);
assert.equal(bodies.length,1);assert.equal(bodies[0].model,omni);assert.equal(bodies[0].seconds,'4');assert.equal(bodies[0].size,'1280x720');
assert.deepEqual(Object.keys(bodies[0]).sort(),['model','prompt','seconds','size']);
assert((await records(p,'aitu-app','tasks'))[0].result.url.includes('__aitu_cache__'));
checks.push('direct generation uses allowlisted JSON, authenticated content download and canvas cache');
await shot('direct-video-result');
await until(async()=> (await records(p,'aitu-workspace','boards')).some(b=>b.elements?.some(e=>e.url?.includes('__aitu_cache__'))),'video saved');
const boardBefore=(await records(p,'aitu-workspace','boards')).find(b=>b.elements?.some(e=>e.url?.includes('__aitu_cache__')));
const videoBefore=boardBefore.elements.find(e=>e.url?.includes('__aitu_cache__'));
const surface=p.locator('[data-native-media-overlay] [data-canvas-media-drag]').first();
await surface.waitFor();
const rect=await surface.boundingBox();
await p.mouse.move(rect.x+rect.width*.4,rect.y+35);await p.mouse.down();
await p.mouse.move(rect.x+rect.width*.4+100,rect.y+85,{steps:12});
await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
await p.mouse.up();
await until(async()=>{const b=(await records(p,'aitu-workspace','boards')).find(b=>b.id===boardBefore.id);const v=b.elements.find(e=>e.id===videoBefore.id);return Math.abs(v.points[0][0]-videoBefore.points[0][0]-100)<3&&Math.abs(v.points[0][1]-videoBefore.points[0][1]-50)<3;},'dragged video position saved');
await p.locator('[data-native-media-overlay] video').first().evaluate(async v=>{v.loop=true;await v.play();});
await until(async()=>p.locator('[data-native-media-overlay] video').first().evaluate(v=>!v.paused&&v.currentTime>0),'canvas video plays');
await p.locator('[data-native-media-overlay] video').first().evaluate(v=>v.pause());
checks.push('native media overlay forwards canvas dragging; 100×50 move persists and playback works');
await shot('video-dragged');

await p.mouse.click(1100,260);
// Image reference upload through the real composer, not injected task params.
const chooserPromise=p.waitForEvent('filechooser');
await p.getByRole('button',{name:'上传图片或视频',exact:true}).click();
const chooser=await chooserPromise;
await chooser.setFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAXklEQVR4nO3QMQ0AMAwDwbAogdIqyOIokcIIhgzeTvrdOtffJ9q6L1oBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIwB6YH0QQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4xqp5OFaPsrjbQAAAABJRU5ErkJggg==','base64')});
await p.locator('.selected-content-preview__item--image img').first().waitFor();
await until(async()=>p.locator('.selected-content-preview__item--image img').first().evaluate(img=>img.complete&&img.naturalWidth>0),'reference thumbnail ready');
await setVideo('synthetic-omni-reference');
await p.getByTestId('ai-input-textarea').fill('SYNTHETIC：根据参考图生成4秒视频');
await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
await p.locator('.ai-input-bar__send-btn').dispatchEvent('click');
await until(async()=>{const tasks=await records(p,'aitu-app','tasks');return tasks.length===2&&tasks.every(t=>t.status==='completed'&&t.insertedToCanvas);},'reference Omni completes');
bodies=(await directPosts()).map(readBody);
assert.equal(bodies.length,2);assert(!('prompt'in bodies[1]));assert.equal(bodies[1].input[0].type,'text');assert.equal(bodies[1].input[1].type,'image');assert(bodies[1].input[1].data&&!bodies[1].input[1].data.startsWith('data:'));
checks.push('uploaded reference becomes an ordered image input with raw base64');
await p.mouse.click(1100,260);
// A discussion batch must preserve the selected Omni video model and use text only for planning.
await p.locator('.discussion-strip__open').click();
await p.getByTestId('discussion-routing').waitFor();
await mock('两个4秒视频计划，请确认后生成',50,[{mcp:'generate_video',args:{prompt:'SYNTHETIC 山谷日出',seconds:4,count:1}},{mcp:'generate_video',args:{prompt:'SYNTHETIC 海边落日',seconds:4,count:1}}]);
await setVideo('synthetic-omni-batch');
await p.getByTestId('ai-input-textarea').fill('帮我规划两个4秒的视频，分别是山谷日出和海边落日');
await p.locator('.ai-input-bar__send-btn').click();
await p.getByRole('button',{name:'执行 2 个任务',exact:true}).waitFor();
assert.equal((await directPosts()).length,2,'preview must not generate');
const plan=(await records(p,'aitu-chat','sessions')).find(s=>s.textChat?.executionMode==='agent').textChat.messages.at(-1).discussion.plan;
assert(plan.steps.every(s=>s.model===omni&&s.type==='video'));
await p.getByRole('button',{name:'展开阅读',exact:true}).click();
await p.locator('.text-chat-scroll').evaluate(el=>{el.scrollTop=0;});
await shot('discussion-video-plan');
await p.getByRole('button',{name:'缩小讨论',exact:true}).click();
await p.evaluate(()=>{window.__creativeRequestFixture.holdPoll=true;});
await p.getByRole('button',{name:'执行 2 个任务',exact:true}).click();
await until(async()=> (await records(p,'aitu-app','tasks')).length===4,'both tasks queued');
await until(async()=> (await records(p,'aitu-workspace','boards')).some(b=>b.elements?.filter(e=>e.type==='generation-anchor').length===2),'canvas has both pending slots');
const pendingBoard=(await records(p,'aitu-workspace','boards')).find(b=>b.elements?.some(e=>e.type==='generation-anchor'));
const pendingSlots=pendingBoard.elements.filter(e=>e.type==='generation-anchor');
assert.notDeepEqual(pendingSlots[0].points,pendingSlots[1].points);
assert(pendingSlots.every(a=>a.primaryTaskId&&a.title.includes('视频')));
assert(await p.locator('.text-chat-avatar').first().evaluate(img=>img.complete&&img.naturalWidth>0));
await p.locator('.discussion-strip__open').click();
await shot('canvas-pending-video-slots');
checks.push('discussion creates two separate task slots before completion; rabbit avatar loads');
await p.evaluate(()=>window.__creativeRequestFixture.release());
await until(async()=>{const tasks=await records(p,'aitu-app','tasks');return tasks.length===4&&tasks.every(t=>t.status==='completed'&&t.insertedToCanvas);},'discussion batch completes');
assert.equal((await directPosts()).length,4);
await until(async()=>!(await records(p,'aitu-workspace','boards')).some(b=>b.elements?.some(e=>e.type==='generation-anchor')),'completed placeholders handed off');
const finalElements=(await records(p,'aitu-workspace','boards')).flatMap(b=>b.elements||[]);
for(const slot of pendingSlots){const result=finalElements.find(e=>e.generationTaskId===slot.primaryTaskId);assert(result,'each slot has a result');assert.deepEqual(result.points[0],slot.points[0]);}
checks.push('each completed video keeps its reserved slot; placeholders retire without duplicates');
await p.locator('.discussion-strip__open').click();
assert((await p.locator('.discussion-result-media video').count())>=2);
await until(async()=>p.locator('.discussion-result-media video').evaluateAll(videos=>videos.length===2&&videos.every(v=>v.getAttribute('src'))),'both cached video sources mounted');
// Cache resolution may replace the initial source while playback is starting.
await until(async()=>p.locator('.discussion-result-media video').evaluateAll(async videos=>{
  if(videos.length!==2||videos.some(v=>!v.getAttribute('src'))) return false;
  for(const v of videos){
    v.muted=true;
    try { await v.play(); v.pause(); }
    catch(error){ if(error.name==='AbortError') return false; throw error; }
  }
  return videos.every(v=>v.isConnected&&v.readyState>=1&&v.videoWidth>0);
}),'cached videos start playback');
await until(async()=>p.locator('.discussion-result-media video').evaluateAll(videos=>videos.length>=2&&videos.every(v=>v.readyState>=1&&v.videoWidth>0)),'video metadata decoded');
checks.push('discussion previews two video tasks with pinned Omni model; both videos decode and land on canvas');
await shot('discussion-video-results');
await p.reload();await p.getByTestId('discussion-strip').waitFor();await p.locator('.discussion-strip__open').click();
await until(async()=>p.locator('.discussion-result-media video').evaluateAll(videos=>videos.length===2&&videos.every(v=>v.getAttribute('src'))),'both cached video sources mounted');
// Cache resolution may replace the initial source while playback is starting.
await until(async()=>p.locator('.discussion-result-media video').evaluateAll(async videos=>{
  if(videos.length!==2||videos.some(v=>!v.getAttribute('src'))) return false;
  for(const v of videos){
    v.muted=true;
    try { await v.play(); v.pause(); }
    catch(error){ if(error.name==='AbortError') return false; throw error; }
  }
  return videos.every(v=>v.isConnected&&v.readyState>=1&&v.videoWidth>0);
}),'cached videos start playback');
await until(async()=>p.locator('.discussion-result-media video').evaluateAll(videos=>videos.length>=2&&videos.every(v=>v.readyState>=1&&v.videoWidth>0)),'cached playback after reload');
assert.equal((await directPosts()).length,0,'reload must not resubmit');
assert.equal((await records(p,'aitu-app','tasks')).length,4);
const restored=(await records(p,'aitu-workspace','boards')).flatMap(b=>b.elements||[]).find(e=>e.id===videoBefore.id);
assert(Math.abs(restored.points[0][0]-videoBefore.points[0][0]-100)<3);
assert(Math.abs(restored.points[0][1]-videoBefore.points[0][1]-50)<3);
checks.push('reload preserves cached video playback without new generation');
assert.deepEqual(errors,[]);
fs.writeFileSync(`${output}/${engine}-results.json`,JSON.stringify({checks,errors,requests:'synthetic only',directRequest:bodies[0],referenceRequest:{...bodies[1],input:bodies[1].input.map(part=>part.data?{...part,data:'SYNTHETIC_BASE64_OMITTED'}:part)}},null,2));
console.log(engine,checks.length,'Omni workflows passed');
} catch(e){await shot('failure');console.error(e);console.error(errors);console.error((await records(p,'aitu-app','tasks').catch(()=>[])).map(t=>({status:t.status,error:t.error,model:t.params?.model,refs:t.params?.referenceImages?.length,uploads:t.params?.uploadedImages?.length})));console.error((await p.locator('body').innerText()).slice(-6500));process.exitCode=1;}
finally {await context.close();if(browser)await browser.close();if(profile)fs.rmSync(profile,{recursive:true,force:true});}
})();
