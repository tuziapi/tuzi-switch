// Compiled production UI with synthetic transport only; all remote networking blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.TEXT_CHAT_BROWSER || 'chromium';
const largeDialog = process.env.TEXT_CHAT_LARGE_DIALOG === '1';
const base = process.env.TEXT_CHAT_URL || 'http://127.0.0.1:5212/ui04.html?canvas=1&page=creative';
const output = process.env.TEXT_CHAT_OUTPUT || '/tmp/tuzi-local-codex-browser';
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
if (largeDialog) {
  await p.getByRole('button',{name:'展开阅读',exact:true}).click();
  await p.getByTestId('attached-discussion-modal').waitFor();
  await selected('video');
  await selected('image');
  assert(await p.getByTestId('attached-discussion-modal').isVisible(),'media type/model popovers preserve dialog');
}
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

const textRequests=()=>p.evaluate(()=>window.__creativeRequestFixture.requests.filter(r=>r.path==='/v1/chat/completions').length);
const send=async text=>{await p.getByRole('button',{name:'停止讨论任务',exact:true}).waitFor({state:'hidden'});await p.getByTestId('ai-input-textarea').fill(text);await p.locator('.ai-input-bar__send-btn').click();};
await p.evaluate(()=>window.__localCodexFixture.probeFail=true);
await p.getByRole('button',{name:'连接本地 Codex',exact:true}).click();
await p.getByRole('alert').filter({hasText:'未找到本地 Codex'}).waitFor();
assert.equal(await p.getByLabel('Codex 文本模型',{exact:true}).count(),0);
checks.push('failed connection retains the configured text-model route');
await p.evaluate(()=>window.__localCodexFixture.probeFail=false);
await p.getByRole('button',{name:'连接本地 Codex',exact:true}).click();
await p.getByLabel('Codex 文本模型',{exact:true}).waitFor();
await p.getByLabel('Codex 文本模型',{exact:true}).selectOption('synthetic-codex-alt');
assert.equal(await p.getByLabel('Codex 思考强度',{exact:true}).inputValue(),'medium');
const originalRequests=await textRequests();
await send('请生成一张海报，先给我计划');
await p.getByRole('button',{name:'执行 1 个任务',exact:true}).waitFor();
assert.equal(await textRequests(),originalRequests,'connected discussion must not invoke configured text provider');
assert.equal((await records(p,'aitu-app','tasks')).length,0);
const sessions=await records(p,'aitu-chat','sessions');
assert.equal(sessions.find(s=>s.textChat?.executionMode==='agent').textChat.messages.at(-1).model,'Codex · synthetic-codex-alt');
assert((await p.evaluate(()=>window.__localCodexFixture.calls)).every(c=>c.model==='synthetic-codex-alt'));
await shot('connected-plan');
if (largeDialog) {
  // Exercise the real click from a focused composer: blur must not move the
  // execute button away between mousedown and mouseup (notably in WebKit).
  await p.getByTestId('ai-input-textarea').focus();
}
await p.getByRole('button',{name:'执行 1 个任务',exact:true}).click();
await until(async()=>{const tasks=await records(p,'aitu-app','tasks');return tasks.length===1 && tasks[0].status==='completed' && tasks[0].insertedToCanvas;},'Codex plan canvas result');
assert.equal((await records(p,'aitu-app','tasks'))[0].params.model,'gpt-image-2.5-sunburst');
checks.push('Codex model selection, streamed summary, preview, pinned image execution model and canvas placement');
await p.evaluate(()=>window.__localCodexFixture.content=JSON.stringify({content:'5张不同场景',next:[{mcp:'generate_image',args:{prompt:'生成 5 张动漫壁纸，每张不同场景',count:5}}]}));
await send('帮我批量生成5张好看的动漫壁纸吧');
await p.locator('.text-chat-error').filter({hasText:'整批要求'}).waitFor();
assert.equal((await records(p,'aitu-app','tasks')).length,1);
assert.equal(await p.getByRole('button',{name:'执行 5 个任务',exact:true}).count(),0);
const wallpaperPrompts=['樱花校园','霓虹街道','奇幻森林','海边日落','星空山巅'].map(scene=>`${scene}的动漫壁纸，细腻日系风格，单幅完整画面，不分屏、不拼贴、无分镜。`);
await p.evaluate(prompts=>window.__localCodexFixture.content=JSON.stringify({content:'已拆成5张独立壁纸，请确认。',next:prompts.map(prompt=>({mcp:'generate_image',args:{prompt,count:1}}))}),wallpaperPrompts);
await send('按每张独立提示词重新规划5张壁纸');
await p.getByRole('button',{name:'执行 5 个任务',exact:true}).waitFor();
const newest=p.getByTestId('discussion-plan').last();
assert.deepEqual(await newest.locator('li p').allTextContents(),wallpaperPrompts);
const codexCalls=await p.evaluate(()=>window.__localCodexFixture.calls);
assert(codexCalls.at(-1).prompt.includes('逐张展开为 N 个 generate_image 步骤'));
await shot('independent-wallpaper-preview');
await p.getByRole('button',{name:'执行 5 个任务',exact:true}).click();
await until(async()=>{const tasks=await records(p,'aitu-app','tasks');return tasks.length===6&&tasks.every(t=>t.status==='completed'&&t.insertedToCanvas);},'five Codex wallpapers on canvas');
const imagePosts=await p.evaluate(()=>window.__creativeRequestFixture.requests.filter(r=>r.method==='POST'&&r.path==='/v1/images/generations'));
const imageBodies=imagePosts.map(r=>typeof r.body==='string'?JSON.parse(Buffer.from(r.body,'base64').toString()):r.body);
assert.equal(imageBodies.length,6);
assert.deepEqual(imageBodies.slice(1).map(b=>b.prompt).sort(),[...wallpaperPrompts].sort());
assert.equal(await textRequests(),originalRequests);
checks.push('Codex rejects the observed batch prompt; explicit replan previews and sends five separate image prompts without fallback');
await p.evaluate(()=>{window.__localCodexFixture.hold=true;window.__localCodexFixture.content=JSON.stringify({content:'不应完成',next:[]});});
await send('讨论下一张图片，不要立即生成');
await until(async()=>await p.evaluate(()=>window.__localCodexFixture.calls.length===4),'held Codex turn started');
await p.getByRole('button',{name:'停止讨论任务',exact:true}).click();
await p.getByRole('button',{name:'发送到讨论',exact:true}).waitFor();
await p.evaluate(()=>{window.__localCodexFixture.hold=false;window.__localCodexFixture.fail=true;});
await send('连接失败测试');
await p.getByRole('alert').filter({hasText:'Codex 连接已中断'}).waitFor();
assert.equal(await textRequests(),originalRequests);
checks.push('stop cancels the local turn; failure remains on Codex with no silent fallback');
await p.getByRole('button',{name:'断开',exact:true}).click();
await p.getByRole('button',{name:'连接本地 Codex',exact:true}).waitFor();
assert((await p.getByTestId('discussion-routing').innerText()).includes('claude-sonnet-4-5'));
await mock('已恢复原文本模型',50,[]);
await send('现在用原来的文本模型讨论');
await p.getByText('已恢复原文本模型',{exact:true}).waitFor();
assert.equal(await textRequests(),originalRequests+1);
checks.push('disconnect restores the original configured text model and conversation context');
await p.setViewportSize({width:760,height:800});
await shot('disconnected-narrow');
if (largeDialog) await p.getByRole('button',{name:'收起讨论',exact:true}).click();
else await p.locator('.discussion-strip__open').click();
await p.getByTestId('attached-discussion-panel').waitFor({state:'hidden'});
await p.locator('.discussion-strip__open').click();
await p.getByTestId('attached-discussion-panel').waitFor();
checks.push('narrow layout and discussion toggle still work');
assert.deepEqual(errors,[]);
fs.writeFileSync(`${output}/${engine}-results.json`,JSON.stringify({checks,errors,requests:'synthetic only'},null,2));
console.log(engine,checks.length,'local Codex checks passed');
} catch(e){await shot('failure');console.error(e);console.error(errors);console.error('input:',await p.getByTestId('ai-input-textarea').inputValue());console.error('codex:',await p.evaluate(()=>window.__localCodexFixture.calls.map(c=>({model:c.model,length:c.prompt.length}))));console.error('sessions:',(await records(p,'aitu-chat','sessions')).map(s=>({id:s.id,model:s.sessionModel,messages:s.textChat?.messages.map(m=>({role:m.role,error:m.error,status:m.status,text:m.content.slice(0,60)}))})));console.error((await p.locator('body').innerText()).slice(-5500));process.exitCode=1;}
finally {await context.close();if(browser)await browser.close();if(profile)fs.rmSync(profile,{recursive:true,force:true});}
})();
