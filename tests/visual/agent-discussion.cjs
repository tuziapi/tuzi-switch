// Compiled production UI with synthetic transport only; all remote networking blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.TEXT_CHAT_BROWSER || 'chromium';
const base = process.env.TEXT_CHAT_URL || 'http://127.0.0.1:5212/ui04.html?canvas=1&page=creative';
const output = process.env.TEXT_CHAT_OUTPUT || '/tmp/tuzi-agent-discussion';
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
await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'||/^(data:|blob:)/.test(r.request().url())?r.continue():r.abort());
const shot=name=>p.screenshot({path:`${output}/${engine}-${name}.png`});
async function mock(content, delay=80, next=[]) { await p.evaluate(({content,delay,next})=>{const event=x=>'data: '+JSON.stringify(x)+'\n\n'; window.__creativeRequestFixture.responses['POST /v1/chat/completions']={body:'',contentType:'text/event-stream',delayMs:delay,chunks:[event({choices:[{delta:{reasoning_content:'先确认画面主题，再安排生成任务。'}}]}),event({choices:[{delta:{content:JSON.stringify({content,next})}}]}),event({choices:[{delta:{},finish_reason:'stop'}]}),'data: [DONE]\n\n']};},{content,delay,next}); }
try {
    await p.goto(base);
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
          })).concat([{id:'gpt-image-2.5-sunburst',object:'model',supported_endpoint_types:['image-generation'],endpoints:{'image-generation':{path:'/v1/images/generations',method:'POST'}}}]),
        },
      };
    });
    await p.getByRole("button", { name: "创作配置", exact: true }).click();
    const d = p.getByTestId("settings-dialog");
    await d.getByRole("button", { name: "手动配置", exact: true }).click();
    await d.locator("input[type=password]").fill("sk-SYNTHETIC-TEXT");
    await d
      .locator(".settings-dialog__field")
      .filter({ has: p.locator("label").filter({ hasText: /^API 地址$/ }) })
      .locator("input")
      .first()
      .fill("https://creative.synthetic.invalid/v1");
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
if(await p.getByText('不再提示',{exact:true}).isVisible()) await p.getByText('不再提示',{exact:true}).click();
const box=await p.getByTestId('discussion-strip').boundingBox();
const composer=await p.getByTestId('ai-input-composer-shell-canvas').boundingBox();
fs.writeFileSync(`${output}/${engine}-initial-layout.json`,JSON.stringify({box,composer}));
await shot('initial');
assert(Math.abs(box.height-30)<1, 'strip height');
assert(Math.abs(box.y-composer.y)<=2,'strip must be attached at top');
assert(Math.abs(box.x-composer.x)<=2 && Math.abs(box.width-composer.width)<=3,'strip must align with input edges');
checks.push('30px strip attached to the main composer');
await p.locator('.discussion-strip__open').click();
await p.getByTestId('attached-discussion-panel').waitFor();
await p.getByTestId('attached-discussion-panel').getByText('创作讨论',{exact:true}).waitFor();
assert.equal(await p.locator('.ai-input-bar__discuss').count(),0);
assert.equal(await p.getByLabel('文本消息',{exact:true}).count(),0);
assert.equal(await p.locator('.chat-drawer--open').count(),0);
const attached=await p.getByTestId('attached-discussion-panel').boundingBox();
const openComposer=await p.getByTestId('ai-input-composer-shell-canvas').boundingBox();
assert(Math.abs(attached.x-openComposer.x)<3 && Math.abs(attached.width-openComposer.width)<3,'panel shares composer edges');
assert(Math.abs(attached.y+attached.height-openComposer.y)<3,'panel directly attached');
assert(Math.abs(composer.width-openComposer.width)<3,'opening does not squeeze canvas/input');
await shot('attached-empty');
await p.locator('.discussion-strip__open').click();
assert.equal(await p.getByTestId('attached-discussion-panel').count(),0,'same strip closes');
await p.locator('.discussion-strip__open').click();
await p.getByTestId('attached-discussion-panel').getByText('创作讨论',{exact:true}).waitFor();
await p.getByTestId('ai-input-textarea').fill('尚未发送的讨论草稿');
await p.evaluate(()=>{window.__modalComposer=document.querySelector('[data-testid="ai-input-textarea"]');window.__modalTranscript=document.querySelector('[data-testid="text-chat-workspace"]');});
await p.getByRole('button',{name:'展开阅读',exact:true}).click();
await p.getByTestId('attached-discussion-modal').waitFor();
const reading=await p.getByTestId('attached-discussion-modal').boundingBox();
const modalViewport=await p.evaluate(() => ({ width: innerWidth, height: innerHeight }));
assert(reading.width>attached.width && reading.height>attached.height,'reading opens as a larger modal');
assert(reading.x>0 && reading.y>0 && reading.x+reading.width<modalViewport.width && reading.y+reading.height<modalViewport.height,'reading modal stays within viewport');
assert.equal(await p.getByTestId('attached-discussion-modal').getByTestId('ai-input-textarea').inputValue(),'尚未发送的讨论草稿');
assert(await p.evaluate(()=>window.__modalComposer===document.querySelector('[data-testid="ai-input-textarea"]')&&window.__modalTranscript===document.querySelector('[data-testid="text-chat-workspace"]')),'expanding moves the same composer and transcript without remount');
assert.equal(await p.getByTestId('ai-input-textarea').count(),1);
await p.getByTestId('ai-input-textarea').fill('在弹窗继续编辑');
await shot('large-dialog');
await p.mouse.click(reading.x-8,reading.y+20);
await p.getByTestId('attached-discussion-modal').waitFor({state:'hidden'});
assert.equal(await p.getByTestId('ai-input-textarea').inputValue(),'在弹窗继续编辑','backdrop dismissal keeps draft');
await p.locator('.discussion-strip__open').click();
await p.getByRole('button',{name:'展开阅读',exact:true}).click();
await p.getByTestId('attached-discussion-modal').waitFor();
await p.getByRole('button',{name:'缩小讨论',exact:true}).click();
await p.getByTestId('attached-discussion-panel').waitFor();
await p.getByTestId('attached-discussion-modal').waitFor({state:'hidden'});
assert.equal(await p.getByTestId('ai-input-textarea').inputValue(),'在弹窗继续编辑');
await p.getByTestId('ai-input-textarea').fill('');
await p.getByRole('button',{name:'文本会话列表',exact:true}).click();
await p.getByRole('textbox',{name:'搜索文本对话',exact:true}).press('Escape');
assert(await p.getByTestId('attached-discussion-panel').isVisible(),'first Escape only closes history');
await p.locator('.discussion-strip__open').focus();
await p.keyboard.press('Escape');
assert.equal(await p.getByTestId('attached-discussion-panel').count(),0);
await p.locator('.discussion-strip__open').click();
checks.push('single input; attached edges; no sidebar; strip toggles; reading mode and scoped Escape');
await p.getByRole('button',{name:'展开阅读',exact:true}).click();
await p.getByTestId('attached-discussion-modal').waitFor();
await p.getByRole('button',{name:'文本会话列表',exact:true}).click();
await p.getByRole('textbox',{name:'搜索文本对话',exact:true}).press('Escape');
assert(await p.getByTestId('attached-discussion-modal').isVisible(),'history Escape preserves modal');
await p.locator('.discussion-routing .model-selector__trigger').click();
await p.locator('.model-selector__dropdown').waitFor();
await p.keyboard.press('Escape');
assert(await p.getByTestId('attached-discussion-modal').isVisible(),'model menu Escape preserves modal');
await p.getByTestId('ai-input-textarea').focus();
for(let i=0;i<35;i++) {
 await p.keyboard.press('Tab');
 await p.waitForFunction(()=>Boolean(document.activeElement?.closest('[data-testid="attached-discussion-modal"]')),null,{timeout:1000}).catch(async e=>{throw Error(`Tab ${i} escaped dialog: ${await p.evaluate(()=>document.activeElement?.outerHTML)}; ${e.message}`)});
}
await mock('我们可以先讨论构图，再生成图片。',600);
await p.getByTestId('ai-input-textarea').fill('先聊聊海报的设计方向');
await p.locator('.ai-input-bar__send-btn').click();
await until(async()=> (await p.getByTestId('discussion-strip').innerText()).includes('正在思考'),'real reasoning status');
if(await p.getByText('不再提示',{exact:true}).isVisible()) await p.getByText('不再提示',{exact:true}).click();
await shot('thinking');
await p.getByRole('button',{name:'收起讨论',exact:true}).click();
await p.getByTestId('attached-discussion-modal').waitFor({state:'hidden'});
assert.equal(await p.getByTestId('attached-discussion-panel').count(),0);
await until(async()=> (await records(p,'aitu-chat','sessions')).some(s=>s.textChat?.messages.some(m=>m.role==='assistant'&&m.status==='complete')),'reply completes while closed');
await p.locator('.discussion-strip__open').click();
checks.push('closing unmounts transcript without cancelling the running request');
await until(async()=>await p.locator('.text-chat-answer[data-status="complete"]').count()===1,'main input reply');

assert.equal(await p.getByTestId('ai-input-textarea').inputValue(),'');
const sessions=await records(p,'aitu-chat','sessions');
const discussion=sessions.find(s=>s.textChat?.executionMode==='agent');
assert(discussion.textChat.linkedBoardId); assert.equal(discussion.textChat.messages[0].origin,'canvas');
checks.push('main input streams model reasoning and reply into attached discussion');
await mock('好的，采用简洁的橙色主题。');
await p.getByTestId('ai-input-textarea').fill('换成简洁的橙色主题');
await p.locator('.ai-input-bar__send-btn').click();
await until(async()=>await p.locator('.text-chat-answer[data-status="complete"]').count()===2,'sidebar reply');
const posts=await p.evaluate(()=>window.__creativeRequestFixture.requests.filter(r=>r.method==='POST'));
const body=typeof posts.at(-1).body==='string'?JSON.parse(Buffer.from(posts.at(-1).body,'base64').toString()):posts.at(-1).body;
assert(body.messages.some(m=>m.content==='先聊聊海报的设计方向'));
checks.push('main input continues the same discussion context');
await shot('complete');
await p.evaluate(()=>{window.__creativeRequestFixture.responses['POST /v1/chat/completions']={body:'',errorCode:'creative_connection_failed'};});
await p.getByTestId('ai-input-textarea').fill('开始生成吧');
await p.locator('.ai-input-bar__send-btn').click();
await until(async()=>await p.locator('.text-chat-answer[data-status="error"]').count()===1,'planning failure');
await until(async()=>(await p.locator('.text-chat-error').innerText()).includes('尚未提交生成任务'),'planning error detail');
assert.equal((await records(p,'aitu-app','tasks')).length,0);
const retryButton=p.locator('.text-chat-answer[data-status="error"]').getByRole('button',{name:'重试',exact:true});
assert(await retryButton.isDisabled(),'canvas context is resent only from main composer');
await mock('已安排两张海报。',80,[{mcp:'generate_image',args:{prompt:'synthetic orange poster',count:2,size:'1x1'}}]);
await p.getByTestId('ai-input-textarea').fill('开始生成吧');
await p.locator('.ai-input-bar__send-btn').click();
checks.push('planning failure creates no media tasks; explicit main-input resend succeeds');
await p.getByRole('button',{name:'展开阅读',exact:true}).click();
await p.getByTestId('attached-discussion-modal').waitFor();
await p.getByRole('button',{name:'执行 2 个任务',exact:true}).waitFor();
assert.equal((await records(p,'aitu-app','tasks')).length,0,'preview must not dispatch tasks');
await shot('plan-preview');
await p.getByRole('button',{name:'执行 2 个任务',exact:true}).click();
checks.push('durable preview requires explicit confirmation before media dispatch');
await until(async()=>{ const tasks=await records(p,'aitu-app','tasks'); return tasks.length===2 && tasks.every(t=>t.status==='completed' && t.insertedToCanvas); },'two generated images on canvas');
await until(async()=>await p.locator('.discussion-result-media img').evaluateAll(imgs=>imgs.length===2 && imgs.every(i=>i.complete&&i.naturalWidth>0)),'desktop cached previews decoded');
const mediaTasks=await records(p,'aitu-app','tasks');
assert(mediaTasks.every(t=>t.params.conversationLink.boardId===discussion.textChat.linkedBoardId));
await until(async()=> (await records(p,'aitu-workspace','boards')).find(b=>b.id===discussion.textChat.linkedBoardId)?.elements.filter(e=>e.generationTaskId).length===2,'two saved canvas results');
assert.equal(await p.evaluate(()=>window.__creativeRequestFixture.requests.filter(r=>r.path==='/v1/images/generations'&&r.method==='POST').length),2);
await shot('large-dialog-results');
await p.getByRole('button',{name:'定位画布',exact:true}).first().click();
await p.getByTestId('attached-discussion-modal').waitFor({state:'hidden'});
checks.push('one batch expands to exactly two image requests; cached chat previews and original canvas receive both results');
await p.waitForTimeout(900);
assert.equal(await p.getByTestId('attached-discussion-panel').count(),0,'locate collapses discussion');
await p.locator('.discussion-strip__open').click();
await p.getByTestId('text-chat-workspace').waitFor();
await until(async()=>await p.locator('.text-chat-answer[data-status="complete"]').count()===3,'discussion persisted after tools');
await shot('generated');
await p.setViewportSize({width:980,height:760});
await p.waitForTimeout(500);
await shot('narrow');
const narrowComposer=await p.getByTestId('ai-input-composer-shell-canvas').boundingBox();
const narrowPanel=await p.getByTestId('attached-discussion-panel').boundingBox();
assert(narrowComposer.x>=56 && narrowComposer.x+narrowComposer.width<=980,'composer fits canvas');
assert(Math.abs(narrowPanel.width-narrowComposer.width)<3 && narrowPanel.y>=63);
assert.equal(await p.getByTestId('text-chat-workspace').evaluate(el=>el.scrollWidth>el.clientWidth+2),false);
await p.setViewportSize({width:760,height:640});
await p.waitForTimeout(350);
const small=await p.getByTestId('attached-discussion-panel').boundingBox();
assert(small.y>=63 && small.x>=0 && small.x+small.width<=760,'small window panel fits');
await shot('small');
checks.push('980px and 760px windows: attached panel remains within viewport without horizontal overflow');
await p.getByRole('button',{name:'展开阅读',exact:true}).click();
await p.getByTestId('attached-discussion-modal').waitFor();
const smallModal=await p.getByTestId('attached-discussion-modal').boundingBox();
assert(smallModal.x>=0&&smallModal.y>=120&&smallModal.x+smallModal.width<=760&&smallModal.y+smallModal.height<=640,'small modal fits creative viewport');
await shot('small-modal');
await p.getByTestId('ai-input-textarea').press('Escape');
await p.getByTestId('attached-discussion-modal').waitFor({state:'hidden'});
assert.equal(await p.getByTestId('attached-discussion-panel').count(),0,'Escape returns to collapsed strip');
await p.locator('.discussion-strip__open').click();
await p.getByRole('button',{name:'展开阅读',exact:true}).click();
await p.getByTestId('attached-discussion-modal').waitFor();
await mock('迟到的回复',1500);
await p.getByTestId('ai-input-textarea').fill('长时间讨论');
await p.locator('.ai-input-bar__send-btn').click();
await p.getByTestId('attached-discussion-modal').getByRole('button',{name:'停止讨论任务',exact:true}).click();
await until(async()=>await p.locator('.text-chat-answer[data-status="stopped"]').count()===1,'stop discussion');
checks.push('large dialog: preserved draft/DOM, model menu, history, focus trap, responsive size, Escape, send, media confirmation/location and stop');
await p.reload();
await p.getByTestId('discussion-strip').waitFor();
await p.locator('.discussion-strip__open').click();
await p.getByTestId('attached-discussion-panel').waitFor();
await until(async()=>await p.locator('.text-chat-answer[data-status="complete"]').count()===3,'recovered discussion');
checks.push('reload recovers board-linked discussion and messages');
await p.getByRole('button',{name:'新建画板讨论',exact:true}).click();
await until(async()=>await p.locator('.text-chat-answer').count()===0,'new discussion empty');
await p.getByRole('button',{name:'文本会话列表',exact:true}).click();
assert.equal(await p.locator('.text-chat-session').count(),2,'new discussion stays on same board');
await p.locator('.text-chat-session').filter({hasText:'先聊聊海报的设计方向'}).getByRole('button').first().click();
await until(async()=>await p.locator('.text-chat-answer[data-status="complete"]').count()===3,'history restores original');
checks.push('new discussion and history retain current-board association');
await p.setViewportSize({width:1360,height:900});
await p.waitForTimeout(400);
const viewport=()=>p.evaluate(()=>JSON.stringify(window.__drawnixBoard.viewport));
const beforePan=await viewport();
await p.mouse.move(180,300); await p.mouse.wheel(90,140);
await until(async()=>await viewport()!==beforePan,'canvas wheel pans while discussion is open');
const beforeScroll=await viewport();
const panelRect=await p.getByTestId('attached-discussion-panel').boundingBox();
await p.mouse.move(panelRect.x+panelRect.width/2,panelRect.y+panelRect.height/2);
await p.mouse.wheel(0,-200); await p.waitForTimeout(300);
assert.equal(await viewport(),beforeScroll,'transcript scrolling does not pan canvas');
const pointsBefore=await p.evaluate(()=>JSON.stringify(window.__drawnixBoard.children.map(e=>e.points)));
await p.mouse.click(180,300); await p.keyboard.down('Space');
await p.mouse.move(180,300); await p.mouse.down(); await p.mouse.move(230,350,{steps:10}); await p.mouse.up(); await p.keyboard.up('Space');
await until(async()=>await viewport()!==beforeScroll,'canvas Space drag pans outside transcript');
assert.equal(await p.evaluate(()=>JSON.stringify(window.__drawnixBoard.children.map(e=>e.points))),pointsBefore);
assert.equal(await p.evaluate(()=>window.__drawnixBoard.pointer),'selection');
checks.push('canvas wheel and Space drag work outside panel; panel scroll stays isolated; images do not move');
await shot('final-attached');
assert.deepEqual(errors,[]);
fs.writeFileSync(`${output}/${engine}-results.json`,JSON.stringify({checks,errors,requests:'synthetic only'},null,2));
console.log(engine, checks.length,'checks passed');
} catch(e){ await shot('failure'); console.error(e); console.error(errors); console.error(await p.evaluate(()=>window.__discussionStorageErrors)); console.error((await records(p,'aitu-app','tasks').catch(()=>[])).map(t=>({status:t.status,error:t.error,model:t.params?.model}))); console.error((await p.locator('body').innerText()).slice(-6000)); process.exitCode=1; }
finally {await context.close(); if(browser) await browser.close(); if(profile) fs.rmSync(profile,{recursive:true,force:true});}
})();
