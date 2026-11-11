// Compiled production UI with synthetic transport only; all remote networking blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.TEXT_CHAT_BROWSER || 'chromium';
const base = process.env.TEXT_CHAT_URL || 'http://127.0.0.1:5212/ui04.html?canvas=1&page=creative';
const output = process.env.TEXT_CHAT_OUTPUT || '/tmp/tuzi-cross-media-workflows';
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
          })).concat([{id:'MiniMax-H3',supported_endpoint_types:['openai-video']},{id:'suno/music',supported_endpoint_types:['suno-v2'],endpoints:{'suno-v2':{path:'/suno/v2/music',method:'POST'}}},{id:'gpt-image-2.5-sunburst',object:'model',supported_endpoint_types:['image-generation'],endpoints:{'image-generation':{path:'/v1/images/generations',method:'POST'}}}]),
        },
      };
    });
    await p.getByRole("button", { name: "创作配置", exact: true }).click();
    const d = p.getByTestId("settings-dialog");
    await d.getByRole("button", { name: "兔子账户", exact: true }).click();
    await d.getByText("合成开发密钥", { exact: true }).click();
    await d.getByRole("button", { name: /^(保存并)?获取模型$/ }).click();
    await p.getByRole("button", { name: "全选", exact: true }).click();
    await p.getByRole("button", { name: "添加模型", exact: true }).click();
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
await selected('image');
await p.locator('.discussion-strip__open').click();
await p.getByTestId('discussion-routing').waitFor();
assert.equal(await p.locator('.generation-type-dropdown__label').innerText(),'图片');
await p.getByTestId('discussion-routing').getByRole('button',{name:'选择模型',exact:true}).click();
await p.locator('.model-selector__search input').fill('claude-sonnet');
await p.locator('.model-selector__item').first().click();
assert((await p.getByTestId('discussion-routing').innerText()).toLowerCase().includes('claude'));
checks.push('opening discussion retains the image model; planner uses an independent configured text model');
await p.evaluate(()=>{
const base=location.origin;
Object.assign(window.__creativeRequestFixture.responses,{
'POST /v2/video_generation':{body:{task_id:'synthetic-video-1',base_resp:{status_code:0}}},
'GET /v2/query/video_generation/synthetic-video-1':{body:{task_id:'synthetic-video-1',task:{status:'succeeded',content:{url:base+'/synthetic-media.mp4'}}}},
'POST /suno/v2/music':{body:{code:'success',data:{task_id:'synthetic-audio-1'}}},
'GET /suno/v2/fetch/synthetic-audio-1':{body:{code:'success',data:{task_id:'synthetic-audio-1',action:'music',status:'SUCCESS',data:{musics:[{music_id:'synthetic-music-1',audio_url:base+'/synthetic-media.wav',title:'SYNTHETIC MUSIC'}]}}}}
});});
// Regression: the model previously repeated a batch-level wallpaper prompt five times.
await mock('将生成5张不同场景的壁纸',70,[{mcp:'generate_image',args:{prompt:'生成 5 张高质量动漫壁纸，每张呈现不同场景：校园、城市、森林、海边、星空。',count:5}}]);
await p.getByTestId('ai-input-textarea').fill('帮我批量生成5张好看的动漫壁纸吧');
await p.locator('.ai-input-bar__send-btn').click();
await p.locator('.text-chat-error').filter({hasText:'整批要求'}).waitFor();
assert.equal((await records(p,'aitu-app','tasks')).length,0);
assert.equal(await p.getByTestId('discussion-plan').count(),0);
await shot('batch-command-rejected');
checks.push('observed multi-image prompt is rejected before preview and any media request');
const wallpaperPrompts=['樱花校园','霓虹街道','奇幻森林','海边日落','星空山巅'].map(scene=>`${scene}的动漫壁纸，细腻日系风格，单幅完整画面，不分屏、不拼贴、无分镜。`);
for(const kind of ['image','video','audio','text']) {
await selected(kind);
assert(await p.getByTestId('attached-discussion-panel').isVisible(),'changing media preserves discussion');
const count=kind==='image'?5:1;
const prior=(await records(p,'aitu-app','tasks')).length;
await mock(kind==='image'?'已拆成5张独立动漫壁纸，每张一个场景。请逐项确认后生成。':`已为你整理${count}个${labels[kind]}任务，请预览后执行。`,70,Array.from({length:count},(_,i)=>({mcp:`generate_${kind}`,args:{prompt:kind==='image'?wallpaperPrompts[i]:`SYNTHETIC ${kind} prompt ${i+1}`,count:1}})));
await p.getByTestId('ai-input-textarea').fill(kind==='image'?'按每张独立提示词重新规划5张动漫壁纸':`请按这些提示词批量生成${labels[kind]}：春日茶饮、夏日果汁、秋日咖啡`);
await p.locator('.ai-input-bar__send-btn').click();
const button=p.getByRole('button',{name:`执行 ${count} 个任务`,exact:true});await button.waitFor();
assert.equal((await records(p,'aitu-app','tasks')).length,prior);
const sessions=await records(p,'aitu-chat','sessions');
const answer=sessions.find(s=>s.textChat?.executionMode==='agent').textChat.messages.at(-1);
assert.equal(answer.model,'claude-sonnet-4-5');
assert(answer.discussion.plan.steps.every(s=>s.model===models[kind] && s.type===kind));
if(kind==='image') {
  await p.getByRole('button',{name:'展开阅读',exact:true}).click();
  await p.getByTestId('attached-discussion-modal').waitFor();
  assert.equal(await p.getByTestId('discussion-plan').last().locator('li').count(),5);
  assert.deepEqual(await p.getByTestId('discussion-plan').last().locator('li p').allTextContents(),wallpaperPrompts);
}
await shot(`${kind}-preview`);
if(kind==='text') await p.evaluate(()=>{
window.__creativeRequestFixture.responses['POST /v1/chat/completions']={body:{id:'synthetic-text',choices:[{message:{role:'assistant',content:'SYNTHETIC TEXT RESULT — 这是独立执行模型生成的作品。'},finish_reason:'stop'}]}};
});
await button.dblclick();
await until(async()=>{const all=await records(p,'aitu-app','tasks');return all.length===prior+count && all.filter(t=>t.params.conversationLink?.runId===answer.discussion.runId).every(t=>t.status==='completed');},`${kind} completed`);
const tasks=(await records(p,'aitu-app','tasks')).filter(t=>t.params.conversationLink?.runId===answer.discussion.runId);
assert.equal(tasks.length,count);
assert(tasks.every(t=>t.params.model===models[kind]));
if(kind==='image') {
  assert.deepEqual(tasks.sort((a,b)=>a.params.batchIndex-b.params.batchIndex).map(t=>t.params.prompt),wallpaperPrompts);
  const posts=await p.evaluate(()=>window.__creativeRequestFixture.requests.filter(r=>r.method==='POST'&&r.path==='/v1/images/generations'));
  const bodies=posts.map(r=>typeof r.body==='string'?JSON.parse(Buffer.from(r.body,'base64').toString()):r.body);
  assert.equal(bodies.length,5);
  assert.deepEqual(bodies.map(b=>b.prompt).sort(),[...wallpaperPrompts].sort());
  assert(bodies.every(b=>b.model===models.image && (b.n??1)===1));
  fs.writeFileSync(`${output}/${engine}-single-image-requests.json`,JSON.stringify(bodies.map(({model,prompt,n})=>({model,prompt,n})),null,2));
  checks.push('five preview rows preserve five distinct prompts through actual image request serialization');
}
if(kind==='text') {
assert(tasks.every(t=>!t.insertedToCanvas && t.params.autoInsertToCanvas===false));
await p.getByText('SYNTHETIC TEXT RESULT — 这是独立执行模型生成的作品。',{exact:true}).waitFor();
await p.getByRole('button',{name:'放入画布',exact:true}).click();
} 
await until(async()=> (await records(p,'aitu-app','tasks')).filter(t=>t.params.conversationLink?.runId===answer.discussion.runId).every(t=>t.insertedToCanvas),`${kind} canvas`);
if(kind==='video') assert(await p.locator('.discussion-result-media video').count()>0);
if(kind==='audio') assert(await p.locator('.discussion-result-media audio').count()>0);
checks.push(`${kind}: preview, correct planner/execution models, single dispatch, result and canvas placement`);
await shot(`${kind}-result`);
if(kind==='image') await p.getByRole('button',{name:'缩小讨论',exact:true}).click();
}
await selected('image');
await mock('取消测试',70,[{mcp:'generate_image',args:{prompt:'cancel me',count:1}}]);
await p.getByTestId('ai-input-textarea').fill('做一张图，先让我确认');await p.locator('.ai-input-bar__send-btn').click();
await p.getByRole('button',{name:'执行 1 个任务',exact:true}).waitFor();
const beforeCancel=(await records(p,'aitu-app','tasks')).length;
await p.reload();await p.getByTestId('discussion-strip').waitFor();await p.locator('.discussion-strip__open').click();
await p.getByRole('button',{name:'取消计划',exact:true}).click();
await p.getByText('计划已取消',{exact:true}).waitFor();
assert.equal((await records(p,'aitu-app','tasks')).length,beforeCancel);
checks.push('ready plan survives reload; cancellation creates no tasks');
await p.getByRole('button',{name:'直接生成',exact:true}).click();
await p.getByTestId('attached-discussion-panel').waitFor({state:'hidden'});
checks.push('explicit exit restores direct generation and closes discussion');
assert.deepEqual(errors,[]);
fs.writeFileSync(`${output}/${engine}-results.json`,JSON.stringify({checks,errors,requests:'synthetic only'},null,2));
console.log(engine,checks.length,'cross-media workflows passed');
} catch(e){await shot('failure');console.error(e);console.error(errors);console.error((await records(p,'aitu-app','tasks').catch(()=>[])).map(t=>({status:t.status,error:t.error,model:t.params?.model})));console.error((await p.locator('body').innerText()).slice(-7000));process.exitCode=1;}
finally {await context.close();if(browser)await browser.close();if(profile)fs.rmSync(profile,{recursive:true,force:true});}
})();
