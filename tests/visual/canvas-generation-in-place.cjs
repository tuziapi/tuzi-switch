// Actual desktop renderer/queue/IndexedDB. Synthetic native transport only; no paid requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.CREATIVE_QA_BROWSER || 'chromium';
const base = process.env.CREATIVE_QA_BASE_URL || 'http://127.0.0.1:5221';
const failing = process.env.CREATIVE_QA_FAILURE === '1';
const output = process.env.CREATIVE_QA_OUTPUT || '/tmp/opentu-in-place-' + engine + (failing ? '-failure' : '');
fs.mkdirSync(output, {recursive:true});
async function boards(p) { return p.evaluate(() => new Promise((resolve,reject) => {
  const req=indexedDB.open('aitu-workspace');req.onerror=()=>reject(req.error);req.onsuccess=()=>{
    const db=req.result, r=db.transaction('boards').objectStore('boards').getAll();
    r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=()=>reject(r.error);
  };
})); }
async function until(fn, message) { const end=Date.now()+25000; while(Date.now()<end) { const value=await fn(); if(value)return value;await new Promise(r=>setTimeout(r,150)); }throw Error(message); }
async function canvas(p) { const nav=p.getByRole('navigation',{name:'创作导航'}); await nav.getByRole('button',{name:'自由画布',exact:true}).click();await p.locator('.plait-board-container').waitFor();const intro=p.getByText('不再提示',{exact:true});if(await intro.isVisible())await intro.click(); }
(async()=>{
  const browser = engine==='webkit' ? null : await pw.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context = engine==='webkit' ? await pw.webkit.launchPersistentContext(fs.mkdtempSync('/tmp/opentu-inplace-webkit-'),{headless:true,viewport:{width:1400,height:1000}}) : await browser.newContext({viewport:{width:1400,height:1000}});
  const p=await context.newPage();p.setDefaultTimeout(20000);const errors=[],results=[];p.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'||/^(data|blob):/.test(r.request().url())?r.continue():r.abort());
  const timeout=setTimeout(()=>{console.error('UI deadline exceeded');void p.screenshot({path:output+'/timeout.png'}).finally(()=>context.close());},120000);
  try {
    console.log('loading');
    await p.goto(base+'/ui04.html?canvas=1&page=creative');
    console.log('configuring');
    await p.getByRole('button',{name:'创作配置',exact:true}).click();const dialog=p.getByTestId('settings-dialog');await dialog.waitFor();
    await dialog.getByRole('button',{name:'手动配置',exact:true}).click();await dialog.locator('input[type=password]').fill('sk-SYNTHETIC-INPLACE');
    await dialog.locator('.settings-dialog__field').filter({has:p.locator('label').filter({hasText:/^API 地址$/})}).locator('input').first().fill('https://creative.synthetic.invalid/v1');
    await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.waitFor({state:'hidden'});await canvas(p);
    console.log('canvas-ready');
    await until(async()=> (await boards(p)).length, 'board must persist');
    const original=(await boards(p))[0];
    await p.getByRole('navigation',{name:'创作导航'}).getByRole('button',{name:'我的项目',exact:true}).click();
    await p.locator('.plait-board-container').waitFor({state:'hidden'});
    // Seed only this fresh isolated fixture board; never read or alter user profiles.
    console.log('seeding',original.id);
    await p.evaluate(({id})=>new Promise((resolve,reject)=>{
      const req=indexedDB.open('aitu-workspace');req.onsuccess=()=>{const db=req.result;const tx=db.transaction('boards','readwrite');const store=tx.objectStore('boards');const get=store.get(id);get.onsuccess=()=>{
        const board=get.result;board.elements=[{id:'fixture-draft',type:'geometry',shape:'roundRectangle',points:[[200,150],[544,374]],fill:'#fff',strokeColor:'#dcdbe5',strokeWidth:1,angle:0,text:{children:[{text:''}]},generationNode:{version:1,generationType:'image',prompt:'SYNTHETIC in-place fixture',model:'gpt-image-2',params:{},count:1,references:[]}}];board.viewport={origination:[0,0],zoom:1};store.put(board,id);
      };tx.oncomplete=()=>{db.close();resolve();};tx.onerror=tx.onabort=()=>reject(tx.error);};
    }),{id:original.id});
    console.log('seeded');
    await p.reload();await canvas(p);
    console.log('reloaded');
    const draft=p.locator('[plait-data-id="fixture-draft"]');await draft.waitFor();const rect=await draft.boundingBox();assert(rect);await p.mouse.dblclick(rect.x+rect.width/2,rect.y+rect.height/2);
    await p.locator('.ai-input-bar__input').first().waitFor();
    await p.locator('.model-dropdown__trigger:visible').first().click();
    await p.getByPlaceholder('搜索模型名 / 展示名 / 供应商').fill('gpt-image-2');
    await p.locator('.model-dropdown__item').filter({hasText:'gpt-image-2'}).first().click();
    await p.locator('.ai-input-bar__input').first().fill('SYNTHETIC in-place fixture');
    await p.waitForTimeout(500);
    console.log('draft-open');
    await p.evaluate(()=>{window.__creativeRequestFixture.responses['POST /v1/images/generations']={body:{created:1,data:[{b64_json:'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAXklEQVR4nO3QMQ0AMAwDwbAogdIqyOIokcIIhgzeTvrdOtffJ9q6L1oBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIwB6YH0QQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4xqp5OFaPsrjbQAAAABJRU5ErkJggg=='}]},delayMs:4000};});
    if (failing) await p.evaluate(()=>{window.__creativeRequestFixture.responses['POST /v1/images/generations']={status:400,body:{error:{message:'SYNTHETIC deliberate rejection'}},delayMs:4000};});
    await p.locator('[data-track="ai_input_click_send"]').first().click();
    await p.waitForFunction(()=>window.__creativeRequestFixture.requests.some(r=>r.method==='POST'));
    console.log('request-sent');
    const progress=await until(async()=>{const b=(await boards(p)).find(b=>b.id===original.id);return b?.elements.find(e=>e.type==='generation-anchor'&&e.generationOrigin);},'draft must become progress');
    assert.deepEqual(progress.points[0],[200,150]);
    assert(!(await boards(p))[0].elements.some(e=>e.generationNode));results.push('draft consumed into progress at original position');
    await p.evaluate(()=>window.__creativeRequestFixture.release());
    if (failing) {
      await p.getByRole('button',{name:'恢复编辑',exact:true}).waitFor();
      await p.getByRole('button',{name:'恢复编辑',exact:true}).click();
      const restored=await until(async()=> (await boards(p))[0].elements.find(e=>e.generationNode), 'restore failed input draft');
      assert.deepEqual(restored.points[0],[200,150]);assert.equal(restored.generationNode.prompt,'SYNTHETIC in-place fixture');
      assert.equal(await p.evaluate(()=>window.__creativeRequestFixture.requests.filter(r=>r.method==='POST').length),1);
      results.push('native failed card restores editable input without resubmission');
      await p.reload();await canvas(p);
      assert((await boards(p))[0].elements.some(e=>e.generationNode));
      assert.equal(await p.evaluate(()=>window.__creativeRequestFixture.requests.filter(r=>r.method==='POST').length),0);
      results.push('restored draft persists through reload without generation');
    } else {
    const result=await until(async()=>{const b=(await boards(p)).find(b=>b.id===original.id);return b?.elements.find(e=>e.type==='image'&&e.generationOrigin);},'result must inherit original input');
    assert.deepEqual(result.points[0],[200,150]);assert.equal(result.generationOrigin.draft.generationNode.prompt,'SYNTHETIC in-place fixture');
    await until(async()=>!(await boards(p))[0].elements.some(e=>e.type==='generation-anchor'),'completed progress must clear');results.push('result replaces progress and keeps original input');
    const count=await p.evaluate(()=>window.__creativeRequestFixture.requests.filter(r=>r.method==='POST').length);assert.equal(count,1);
    await p.reload();await canvas(p);assert.equal((await boards(p))[0].elements.filter(e=>e.generationOrigin).length,1);assert.equal(await p.evaluate(()=>window.__creativeRequestFixture.requests.filter(r=>r.method==='POST').length),0);results.push('reload preserves result without new generation');
    }
    await p.screenshot({path:output+'/result.png'});
    assert.deepEqual(errors,[]);fs.writeFileSync(output+'/report.json',JSON.stringify({engine,results,errors,paid:false},null,2));console.log(JSON.stringify({engine,results,errors}));
  } catch(e) { console.log('fixture-state',await p.evaluate(()=>window.__creativeRequestFixture.requests).catch(()=>[]),errors);await p.screenshot({path:output+'/failure.png'}).catch(()=>{});fs.writeFileSync(output+'/failure.txt',String(e)+'\n'+await p.locator('body').innerText());throw e; }
  finally {clearTimeout(timeout);await context.close();if(browser)await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
