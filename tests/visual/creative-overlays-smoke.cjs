// Regression for embedded overlays, toolbar reachability and host theme inheritance.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out=process.env.CREATIVE_QA_OUTPUT || '/tmp/creative-overlays-qa';fs.mkdirSync(out,{recursive:true});
const cases=[
 ['toolbox','[data-testid="toolbar-toolbox"]','.side-drawer--open'],
 ['project','[data-testid="toolbar-project"]','.side-drawer--open'],
 ['tasks','[data-testid="toolbar-tasks"]','.side-drawer--open'],
 ['media','[aria-label="从素材库选择"]','.winbox-media-library'],
 ['model','.ai-input-bar .model-dropdown__trigger--minimal','.model-dropdown__menu'],
 ['parameters','.ai-input-bar .parameters-dropdown__trigger','.parameters-dropdown__menu'],
 ['chat','[aria-label="展开对话"]','.chat-drawer--open'],
 ['commands','[data-track="toolbar_click_menu_commands"]','.command-palette'],
 ['backup','[data-track="toolbar_click_menu_backup"]','.backup-restore-dialog'],
];
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const checks=[],failures=[];
 async function inspect(page,label,selector){
  await page.waitForTimeout(850);
  const result=await page.locator(selector).first().evaluate(el=>{
   const root=el.closest('.creative-root'),r=el.getBoundingClientRect(),h=root?.getBoundingClientRect();
   const cx=Math.min(r.right-2,Math.max(r.left+2,r.left+r.width/2)),cy=Math.min(r.bottom-2,Math.max(r.top+2,r.top+r.height/2));
   return {rect:r.toJSON(),host:h?.toJSON(),scoped:!!root,width:r.width,height:r.height,inside:!!h && r.left>=h.left-2 && r.right<=h.right+2 && r.top>=h.top-2 && r.bottom<=h.bottom+2,
    hit:el.contains(document.elementFromPoint(cx,cy)),background:getComputedStyle(el).backgroundColor};
  });
  await page.screenshot({path:out+'/'+label+'.png'});
  assert(result.scoped && result.inside && result.width>0 && result.height>0,label+' '+JSON.stringify(result));
  assert(result.hit,label+' covered by another layer');checks.push({label,...result});
 }
 try{
 for(const [theme,width,height] of [['light',1180,800],['dark',1180,800],['light',900,650],['dark',900,650]]){
  for(const [name,trigger,overlay] of cases){
   if(process.env.CREATIVE_QA_PANELS && !process.env.CREATIVE_QA_PANELS.split(',').includes(name))continue;
   const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.setDefaultTimeout(8000);
   const errors=[],missing=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(new URL(r.url()).hostname==='127.0.0.1'&&r.status()>=400)missing.push(r.url());});
   await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'||/^(data|blob):/.test(r.request().url())?r.continue():r.abort());
   const label=`${name}-${theme}-${width}`;
   try{
    await page.goto('http://127.0.0.1:5197/ui04.html?canvas=1&page=creative&theme='+theme);
    await page.getByRole('navigation',{name:'创作导航'}).getByRole('button',{name:'自由画布',exact:true}).click();await page.locator('.plait-board-container').waitFor();
    if(['toolbox','project','tasks','commands','backup'].includes(name)){
     const expand=page.getByRole('button',{name:'展开工具栏',exact:true});if(await expand.isVisible())await expand.click();
    }
    if(['commands','backup'].includes(name))await page.locator('[data-track="toolbar_click_menu"]').click();
    await page.locator(trigger).first().click();await page.locator(overlay).first().waitFor();
    await inspect(page,label,overlay);
    if(theme==='dark'){
     for(const selector of ['.inspiration-card__content','.chat-drawer','.enhanced-chat-input .ai-input-composer-shell--drawer','.media-library-modal .t-input','.backup-restore-dialog','.backup-restore-dialog__actions']){
      const element=page.locator(selector).first();if(await element.isVisible())assert.notEqual(await element.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)',label+' white '+selector);
     }
    }
    if(name==='backup'){
     const footer=await page.locator('.backup-restore-dialog__actions').boundingBox();
     const dialog=await page.locator(overlay).boundingBox();
     assert(footer.y+footer.height<=dialog.y+dialog.height,label+' footer clipped');
     await page.locator('.backup-restore-dialog').getByRole('button',{name:'恢复',exact:true}).click();
     await inspect(page,label+'-restore',overlay);
    }
    if(name==='media' && width===1180){
     await page.locator('.winbox-media-library .wb-max').click();await inspect(page,label+'-max',overlay);
     await page.setViewportSize({width:900,height:650});await inspect(page,label+'-resized',overlay);
     await page.locator('.winbox-media-library .wb-max').click();await inspect(page,label+'-restored',overlay);
     await page.locator('.winbox-media-library .wb-split').click();await inspect(page,label+'-split',overlay);
     const search=page.locator('.media-library-grid__search');
     assert((await search.boundingBox()).width>200,label+' split search squeezed');
     assert(await page.locator('.media-library-grid__filter-island').evaluate(e=>e.scrollWidth<=e.clientWidth+1),label+' split filters overlap');
     await page.locator('.winbox-media-library .wb-split').click();await inspect(page,label+'-split-left',overlay);
     await page.locator('.winbox-media-library .wb-split').click();await inspect(page,label+'-unsplit',overlay);
    }
    assert.deepEqual(errors,[],label+' JS errors');assert.deepEqual(missing,[],label+' local missing assets');
   }catch(e){await page.screenshot({path:out+'/'+label+'-failure.png'});failures.push({label,error:e.message});console.error(label,e.message);}
   finally{await context.close();}
  }
 }
 fs.writeFileSync(out+'/results.json',JSON.stringify({checks,failures},null,2));console.log(JSON.stringify({checks:checks.length,failures},null,2));assert.deepEqual(failures,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
