// Inventory-based UI acceptance. Isolated contexts; external traffic is blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.CREATIVE_QA_OUTPUT || '/tmp/creative-tools-acceptance';
fs.mkdirSync(output, { recursive: true });
const tools = ['comic-creator','video-analyzer','mv-creator','batch-image','music-analyzer','chat-mj','image-inspection','model-benchmark','prompt-history','banana-prompt','pose-library','knowledge-base','music-player'];
const external = new Set(['chat-mj','banana-prompt','pose-library']);
(async () => {
 const browser = await chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const results = [];
 try {
  for (const [theme,width,height] of [['light',1180,800],['dark',1180,800],['light',900,600],['dark',900,600]]) {
   for (const id of tools) {
    if(process.env.CREATIVE_QA_TOOLS && !process.env.CREATIVE_QA_TOOLS.split(',').includes(id)) continue;
    const context = await browser.newContext({viewport:{width,height}});
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = [], missing = [], blocked = new Set();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(new URL(r.url()).hostname==='127.0.0.1' && r.status()>=400)missing.push(r.url());});
    await context.route('**/*',r=>{
     const u=new URL(r.request().url());
     if(u.hostname==='127.0.0.1'||['data:','blob:'].includes(u.protocol))return r.continue();
     blocked.add(u.origin+u.pathname);return r.abort();
    });
    const result = {id,theme,width,height,external:external.has(id),errors,missing};
    try {
     await page.goto('http://127.0.0.1:5197/ui04.html?canvas=1&page=creative&theme='+theme);
     await page.getByRole('navigation',{name:'创作导航'}).getByRole('button',{name:'自由画布',exact:true}).click();
     await page.locator('.plait-board-container').waitFor();
     const expand=page.getByRole('button',{name:'展开工具栏',exact:true});if(await expand.isVisible())await expand.click();
     await page.locator('[data-testid="toolbar-toolbox"]').click();
     const card=page.locator(`[data-tool-id="${id}"]`).first();await card.scrollIntoViewIfNeeded();
     await card.locator('[data-track="toolbox_click_open_window_tool"]').click();
     if (external.has(id)) {
      const expected = {'chat-mj':'https://vercel.ddaiai.com/','banana-prompt':'https://www.aiwind.org/','pose-library':'https://www.posemaniacs.com/zh-Hans/poses'}[id];
      await page.waitForFunction(url => window.__creativeOpenedTools?.includes(url), expected);
      assert.deepEqual(await page.evaluate(()=>window.__creativeOpenedTools),[expected]);
      assert.equal(await page.locator('.winbox-tool-window,.winbox-settings-window').count(),0);
      assert.equal(await page.locator('iframe').count(),0);
      assert.deepEqual(errors,[]);
      result.status='browser-handoff-passed'; result.url=expected;
      await page.screenshot({path:`${output}/${id}-${theme}-${width}.png`});
      results.push(result);fs.writeFileSync(output+'/results.json',JSON.stringify(results,null,2));
      await context.close();continue;
     }
     const win=page.locator('.winbox-tool-window').last();await win.waitFor();
     await page.waitForTimeout(1000);
     await page.waitForFunction(()=>{const e=document.querySelector('.winbox-tool-window .wb-body');return e && !/^加载(中|知识库|工具)/.test(e.textContent.trim());});
     result.geometry=await win.evaluate(e=>{const r=e.getBoundingClientRect(),h=e.closest('.creative-root')?.getBoundingClientRect();return {rect:r.toJSON(),host:h?.toJSON(),inside:!!h&&r.x>=h.x-2&&r.y>=h.y-2&&r.right<=h.right+2&&r.bottom<=h.bottom+2};});
     result.title=await win.locator('.wb-title').innerText();
     result.text=(await win.locator('.wb-body').innerText()).slice(0,5000);
     result.controls=await win.locator('button,input,textarea,[role="tab"]').evaluateAll(els=>els.filter(e=>e.getBoundingClientRect().width>0).map(e=>({tag:e.tagName,label:e.getAttribute('aria-label')||e.getAttribute('placeholder')||e.textContent.trim().slice(0,60)})));
     result.blocked=[...blocked];
     result.overflow=await win.locator('.wb-body').evaluate(e=>e.scrollWidth>e.clientWidth+2);
     assert(result.geometry.inside,`${id} window outside host`);
     assert(!result.overflow,`${id} horizontal content overflow`);
     assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
     result.status=external.has(id)?'external-not-validated':'opened';
    } catch(e){result.status='failed';result.failure=e.message;console.error(id,theme,width,e.message);}
    await page.screenshot({path:`${output}/${id}-${theme}-${width}.png`});
    results.push(result);fs.writeFileSync(output+'/results.json',JSON.stringify(results,null,2));
    await context.close();
   }
  }
  console.log(JSON.stringify({states:results.length,failed:results.filter(r=>r.status==='failed').map(r=>({id:r.id,theme:r.theme,width:r.width,error:r.failure})),externalHandoffs:results.filter(r=>r.status==='browser-handoff-passed').length},null,2));
  if(results.some(r=>r.status==='failed'))process.exitCode=1;
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
