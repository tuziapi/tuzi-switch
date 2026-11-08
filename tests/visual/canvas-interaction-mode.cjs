// Actual compiled workspace with synthetic local image data; no model calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.CANVAS_QA_BROWSER || 'chromium';
const output = process.env.CANVAS_QA_OUTPUT || '/tmp/canvas-mode-' + engine;
fs.mkdirSync(output, {recursive:true});
const base = process.env.CANVAS_QA_URL || 'http://127.0.0.1:5211/ui04.html?canvas=1&page=creative';
const preference = 'tuzi-canvas-interaction-mode-v1';
(async () => {
  const browser = await pw[engine].launch({headless:true, ...(engine === 'chromium' ? {executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'} : {})});
  const c = await browser.newContext({viewport:{width:1360,height:900}});
  const p = await c.newPage();
  p.setDefaultTimeout(15000);
  const errors=[], checks=[];
  p.on('pageerror', e => errors.push(e.message));
  await c.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' || /^(blob:|data:)/.test(r.request().url()) ? r.continue() : r.abort());
  const browse = () => p.getByRole('radio',{name:/手形工具 — H/}).locator('..');
  const edit = () => p.getByRole('radio',{name:/选择 — V/}).locator('..');
  const image = () => p.locator('[plait-data-id="SYNTHETIC-pan-image"]');
  const snapshot = () => p.evaluate(() => {
    const b=window.__drawnixBoard;
    return {pointer:b.pointer, points:b.children.find(e=>e.id==='SYNTHETIC-pan-image').points, viewport:JSON.stringify(b.viewport), stored:localStorage.getItem('tuzi-canvas-interaction-mode-v1')};
  });
  async function mode(name) {
    await p.waitForFunction(pointer => window.__drawnixBoard?.pointer === pointer, name === '浏览' ? 'hand' : 'selection');
  }
  async function dragImage(dx=100,dy=60) {
    const b=await image().boundingBox(); assert(b,'image visible');
    const x=b.x+b.width/2,y=b.y+b.height/2;
    assert(x>80 && x+dx<1200 && y>170 && y+dy<700,JSON.stringify(b));
    await p.mouse.move(x,y); await p.mouse.down();
    for(let i=1;i<=12;i++){await p.mouse.move(x+dx*i/12,y+dy*i/12);await p.waitForTimeout(16);}
    await p.mouse.up(); await p.waitForTimeout(200);
  }
  try {
    await p.goto(base);
    await p.getByRole('navigation',{name:'创作导航'}).getByRole('button',{name:'自由画布',exact:true}).click();
    await p.locator('.plait-board-container').waitFor();
    const intro=p.getByText('不再提示',{exact:true});if(await intro.isVisible())await intro.click();
    await mode('浏览');
    assert.equal(await p.evaluate(()=>window.__drawnixBoard.pointer),'hand');
    assert.equal(await p.getByRole('group',{name:'画布操作模式'}).count(),0);
    assert.equal(await p.locator('#creative-canvas-mode-entry').count(),0);
    checks.push('no extra browse/edit controls; actual canvas defaults to hand');
    await p.waitForTimeout(1000);
    await p.evaluate(()=>new Promise((resolve,reject)=>{
      const o=indexedDB.open('aitu-workspace');o.onerror=()=>reject(o.error);o.onsuccess=()=>{
        const db=o.result,tx=db.transaction('boards','readwrite'),store=tx.objectStore('boards'),r=store.getAll();
        r.onsuccess=()=>{const b=r.result[0];if(!b){reject(Error('no synthetic board'));return;}
          const url='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#97ad7b"/><circle cx="100" cy="100" r="55" fill="#eee9da"/></svg>');
          b.elements=[{id:'SYNTHETIC-pan-image',type:'image',url,points:[[100,100],[300,300]],angle:0}];
          b.viewport={zoom:1,origination:[-100,-50]};store.put(b,b.id);};
        tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
      };
    }));
    await p.reload();await image().waitFor();await mode('浏览');await p.waitForTimeout(600);
    let before=await snapshot();await dragImage();let after=await snapshot();
    assert.deepEqual(after.points,before.points);assert.notEqual(after.viewport,before.viewport);
    checks.push('dragging directly over an image pans viewport without changing image coordinates');
    for (const [dx,dy] of [[0,100],[80,40]]) {
      before=await snapshot();await p.mouse.move(200,350);await p.mouse.wheel(dx,dy);await p.waitForTimeout(250);after=await snapshot();
      assert.deepEqual(after.points,before.points);assert.notEqual(after.viewport,before.viewport);
      await p.mouse.wheel(-dx,-dy);await p.waitForTimeout(250);
    }
    checks.push('vertical wheel and two-axis trackpad-like deltas pan without moving image');
    await edit().click();await mode('编辑');
    before=await snapshot();await dragImage(70,40);after=await snapshot();
    assert.notDeepEqual(after.points,before.points);assert.equal(after.viewport,before.viewport);
    checks.push('edit dragging moves image while viewport remains fixed');
    await p.waitForTimeout(600);await p.reload();await image().waitFor();await mode('编辑');
    assert.equal((await snapshot()).pointer,'selection');
    checks.push('edit preference and edited image restore after reload');
    await browse().click();await mode('浏览');
    await p.reload();await image().waitFor();await mode('浏览');
    assert.equal((await snapshot()).pointer,'hand');
    checks.push('browse preference restores after reload');
    await p.getByRole('radio',{name:/选择 — V/}).locator('..').click();await mode('编辑');
    await p.getByRole('radio',{name:/手形工具 — H/}).locator('..').click();await mode('浏览');
    await p.mouse.click(130,400);await p.keyboard.press('v');await mode('编辑');
    await p.keyboard.press('h');await mode('浏览');
    checks.push('existing hand/selection tools and H/V stay synchronized');
    await edit().click();await mode('编辑');await p.mouse.click(130,400);
    before=await snapshot();await p.keyboard.down('Space');await dragImage(-70,-40);await p.keyboard.up('Space');after=await snapshot();
    assert.deepEqual(after.points,before.points);assert.notEqual(after.viewport,before.viewport);assert.equal(after.stored,'edit');
    checks.push('temporary Space pan does not move image or overwrite edit preference');
    await browse().click();
    const chat=p.getByRole('button',{name:'对话',exact:true});if(await chat.getAttribute('aria-expanded')!=='true')await chat.click();
    await p.getByRole('button',{name:'文本对话',exact:true}).click();
    await p.getByLabel('文本消息',{exact:true}).pressSequentially('hv hv ');
    await mode('浏览');assert.equal((await snapshot()).pointer,'hand');
    assert.equal(await p.getByLabel('文本消息',{exact:true}).inputValue(),'hv hv ');
    await p.getByLabel('文本消息',{exact:true}).fill('');
    checks.push('typing H/V/Space in chat leaves browse mode intact');
    await p.screenshot({path:output+'/wide.png'});
    await p.setViewportSize({width:700,height:650});
    for(const label of ['对话']){
      const b=await p.getByRole('button',{name:label,exact:true}).boundingBox();assert(b && b.x>=0 && b.x+b.width<=700,label+' must fit');
    }
    await p.screenshot({path:output+'/narrow.png'});
    await p.evaluate(()=>document.documentElement.classList.add('dark'));
    await p.screenshot({path:output+'/dark.png'});
    checks.push('700px toolbar controls fit; dark appearance captured');
    assert.equal(await p.evaluate(()=>window.__creativeRequestFixture.requests.filter(r=>r.method==='POST').length),0);
    assert.deepEqual(errors,[]);
    fs.writeFileSync(output+'/results.json',JSON.stringify({engine,status:'passed',checks,errors,realProvider:false},null,2));
    console.log(JSON.stringify({engine,checks,errors}));
  } catch(e){await p.screenshot({path:output+'/failure.png'}).catch(()=>{});console.error(e);process.exitCode=1;}
  finally{await browser.close();}
})();
