// Compiled production UI with synthetic transport only; all remote networking blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.TEXT_CHAT_BROWSER || 'chromium';
const largeDialog = process.env.TEXT_CHAT_LARGE_DIALOG === '1';
const base = process.env.TEXT_CHAT_URL || 'http://127.0.0.1:5212/ui04.html?canvas=1&page=creative';
const output = process.env.TEXT_CHAT_OUTPUT || `/tmp/tuzi-discussion-canvas-${engine}`;
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

const frameVideo=fs.readFileSync(require('node:path').join(__dirname,'fixtures/discussion-sampled-video.mp4'));
await p.evaluate(()=>{
 const b=window.__drawnixBoard;
 const canvas=document.createElement('canvas');canvas.width=200;canvas.height=140;
 const ctx=canvas.getContext('2d');ctx.fillStyle='#cc2255';ctx.fillRect(0,0,200,140);const image=canvas.toDataURL();
 for(const [id,x] of [['picture-a',-450],['picture-b',-200]]) b.apply({type:'insert_node',path:[b.children.length],node:{id,type:'image',url:image,points:[[x,-200],[x+200,-60]]}});
 b.apply({type:'insert_node',path:[b.children.length],node:{id:'text-note',type:'geometry',shape:'text',points:[[-450,0],[-200,50]],text:{children:[{text:'UNSELECTED CANVAS NOTE'}]}}});
});
const rawBoard=()=>p.evaluate(()=>JSON.stringify(window.__drawnixBoard.children));
const original=await rawBoard();
await p.locator('input[type=file][accept="image/*,video/*"]').setInputFiles(Array.from({length:4},(_,i)=>({name:`reference-${i+1}.mp4`,mimeType:'video/mp4',buffer:i===0?frameVideo:fs.readFileSync(require('node:path').join(__dirname,`fixtures/discussion-sampled-video-${i+1}.mp4`))})));
await p.waitForFunction(()=>document.querySelectorAll('.selected-content-preview video').length>=4 || document.querySelectorAll('.selected-content-preview__item').length>=4).catch(async()=>{ await p.waitForTimeout(2000); });
const setReply=async actions=>p.evaluate(actions=>window.__localCodexFixture.content=JSON.stringify({content:'已整理，请查看实际操作结果。',next:[],canvasActions:actions}),actions);
await setReply([]);
await send('请描述这些参考视频和当前画布中的文字');
await p.waitForFunction(()=>window.__localCodexFixture.calls.length===1);
await p.getByRole('button',{name:'停止讨论任务',exact:true}).waitFor({state:'hidden'});
let call=await p.evaluate(()=>window.__localCodexFixture.calls.at(-1));
assert.equal(call.images.length,5,'picture sheet and four real video frame sheets');
assert(call.images.every(v=>v.startsWith('data:image/jpeg;base64,')&&v.length>1000));
assert(call.prompt.includes('UNSELECTED CANVAS NOTE')&&call.prompt.includes('picture-b'));
assert(call.prompt.includes('3.90s')&&call.prompt.includes('不含声音'));
const colors=await p.evaluate(async data=>{
 const im=new Image();im.src=data;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const x=c.getContext('2d');x.drawImage(im,0,0);
 return [0,1,2,3,4].map(i=>Array.from(x.getImageData((i%3)*480+80,Math.floor(i/3)*310+100,260,140).data).reduce((n,v,j)=>n+v*(j%13),0));
},call.images[1]);
assert(new Set(colors).size>=4,'sampled images contain different decoded video frames');
checks.push('four uploaded videos reach Codex as five timestamped frames each; unselected canvas text and pictures included');
assert((await p.locator('.text-chat-canvas-context').last().innerText()).includes('4/4 段视频'));
await shot('video-context');
await setReply([{op:'move',ids:['picture-a'],dx:40,dy:25},{op:'set_text',ids:['text-note'],text:'CHANGED BY DISCUSSION'}]);
await send('把第一张图片向右移动40、向下移动25，并把文字改成 CHANGED BY DISCUSSION');
await p.waitForFunction(()=>window.__drawnixBoard.children.find(e=>e.id==='picture-a').points[0][0]===-410);
await p.getByRole('button',{name:'停止讨论任务',exact:true}).waitFor({state:'hidden'});
call=await p.evaluate(()=>window.__localCodexFixture.calls.at(-1));assert.equal(call.images.length,5,'follow-up retains uploaded videos');
assert.equal(await p.evaluate(()=>window.__drawnixBoard.children.find(e=>e.id==='text-note').text.children[0].text),'CHANGED BY DISCUSSION');
await p.evaluate(()=>window.__drawnixBoard.undo());assert.equal(await rawBoard(),original);
checks.push('follow-up keeps detached references; direct move/text edit works and one real undo restores exact board');
await setReply([{op:'delete',ids:['picture-b']}]);await send('删除第二张图片');
await p.getByRole('button',{name:'确认修改画布',exact:true}).waitFor();assert.equal(await rawBoard(),original);
await shot('delete-confirmation');await p.getByTestId('ai-input-textarea').focus();await p.getByRole('button',{name:'确认修改画布',exact:true}).click();
await p.waitForFunction(()=>!window.__drawnixBoard.children.some(e=>e.id==='picture-b'));
await p.evaluate(()=>window.__drawnixBoard.undo());assert.equal(await rawBoard(),original);
checks.push('delete waits for explicit confirmation; click from focused composer works and undo restores media');
await setReply([{op:'move',ids:['picture-a'],dx:10,dy:0}]);
await p.evaluate(()=>window.__localCodexFixture.hold=true);await send('移动第一张图片10');
await p.waitForFunction(()=>window.__localCodexFixture.calls.length===4);
await p.evaluate(()=>{const b=window.__drawnixBoard;const e=b.children.find(e=>e.id==='picture-a');b.apply({type:'set_node',path:[b.children.indexOf(e)],properties:{points:e.points},newProperties:{points:[[-420,-200],[-220,-60]]}});window.__localCodexFixture.hold=false;});
await p.locator('.text-chat-error').filter({hasText:'画布内容已变化'}).waitFor();
assert.equal(await p.evaluate(()=>window.__drawnixBoard.children.find(e=>e.id==='picture-a').points[0][0]),-420);
checks.push('stale model reply cannot overwrite intervening canvas edit');
const stored=await records(p,'aitu-chat','sessions');
assert(stored.find(s=>s.textChat?.executionMode==='agent').textChat.messages.some(m=>m.canvasContext?.images.length===5));
await p.reload();await p.getByRole('navigation',{name:'创作导航'}).getByRole('button',{name:'自由画布',exact:true}).click();await p.waitForFunction(()=>window.__drawnixBoard);
await p.locator('.discussion-strip__open').click();await p.getByTestId('discussion-routing').waitFor();
await p.getByRole('button',{name:'连接本地 Codex',exact:true}).click();await p.getByLabel('Codex 文本模型',{exact:true}).waitFor();
await setReply([]);await send('继续讨论前面的参考视频');
await p.waitForFunction(()=>window.__localCodexFixture.calls.length===1);
assert.equal(await p.evaluate(()=>window.__localCodexFixture.calls[0].images.length),5);
checks.push('saved video references survive reload and are decoded again on follow-up');
await p.getByRole('button',{name:'停止讨论任务',exact:true}).waitFor({state:'hidden'});
await p.getByRole('button',{name:'断开',exact:true}).click();await mock('普通模型也收到画布与参考视频',80,[]);
await send('使用配置模型继续比较视频');
await p.waitForFunction(()=>window.__creativeRequestFixture.requests.some(r=>r.path==='/v1/chat/completions'));
await p.getByRole('button',{name:'停止讨论任务',exact:true}).waitFor({state:'hidden'});
const posted=await p.evaluate(()=>window.__creativeRequestFixture.requests.filter(r=>r.path==='/v1/chat/completions').at(-1));
const body=typeof posted.body==='string'?JSON.parse(Buffer.from(posted.body,'base64').toString()):posted.body;
const parts=body.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]);
assert.equal(parts.filter(c=>c.type==='image_url').length,5);assert(JSON.stringify(body).includes('text-note'));
checks.push('configured text provider receives the same five actual image parts after disconnecting Codex');
assert.equal(errors.length,0,errors.join('\n'));
fs.writeFileSync(`${output}/result.json`,JSON.stringify({engine,checks,errors},null,2));console.log(JSON.stringify({engine,checks},null,2));
} catch(e) { await shot('failure').catch(()=>{});console.error(await p.locator('body').innerText().catch(()=>''));console.error(errors);throw e; }
finally { await context.close();if(browser)await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1);});
