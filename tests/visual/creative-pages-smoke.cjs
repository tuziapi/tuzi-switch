// Display audit of the integrated pages. Synthetic state, no external traffic.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out=process.env.CREATIVE_QA_OUTPUT || '/tmp/creative-pages-qa';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage({viewport:{width:1180,height:800}});
 const errors=[],missing=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(new URL(r.url()).hostname==='127.0.0.1' && r.status()>=400) missing.push(r.url());});
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'|| /^(data|blob):/.test(r.request().url())?r.continue():r.abort());
 async function audit(name){
  await page.waitForTimeout(200);
  const result=await page.evaluate(()=>({
   overflow:document.documentElement.scrollWidth>innerWidth,
   footerHeight:document.querySelector('.settings-dialog__assistant-footer')?.getBoundingClientRect().height || 0,
   broken:[...document.images].filter(i=>i.getBoundingClientRect().width>0 && i.complete && !i.naturalWidth).map(i=>i.alt),
   dialogs:[...document.querySelectorAll('.winbox-settings-window,.model-discovery-dialog,.api-key-dialog')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect();return {scoped:!!e.closest('.creative-root'),inside:r.x>=0 && r.y>=0 && r.right<=innerWidth+2 && r.bottom<=innerHeight+2};})
  }));
  assert(!result.overflow,name+' overflow');assert(result.footerHeight<100,name+' footer squeezed content: '+result.footerHeight);assert.deepEqual(result.broken,[],name+' broken images');assert(result.dialogs.every(d=>d.scoped && d.inside),name+' dialog bounds '+JSON.stringify(result));
  checks.push(name);await page.screenshot({path:out+'/'+name+'.png'});
 }
 try{
  for(const [theme,width,height] of [['light',1180,800],['light',900,650],['dark',1180,800]]){
   await page.setViewportSize({width,height});
   await page.goto('http://127.0.0.1:5197/ui04.html?canvas=1&page=creative&theme='+theme);
   await page.getByRole('button',{name:'创作配置',exact:true}).click();
   const dialog=page.getByTestId('settings-dialog');await dialog.waitFor();
   for(const [i,name] of ['供应商','模型预设','画布显示','语音播放'].entries()){
    await dialog.getByRole('button',{name,exact:true}).click();await audit(`config-${i}-${theme}-${width}`);
    if(name==='模型预设') {
     assert(!/4\/3 已配置/.test(await dialog.innerText()),'preset count must match visible routes');
     if(theme==='dark') assert.equal(await dialog.locator('.settings-dialog__route-card').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(52, 52, 47)');
    }
    if(name==='语音播放' && theme==='dark') assert.notEqual(await dialog.locator('.t-input').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
    if(name==='供应商') {
     await dialog.getByRole('button',{name:'获取模型',exact:true}).scrollIntoViewIfNeeded();
     await audit(`provider-fields-${theme}-${width}`);
     if(theme==='dark') assert.equal(await dialog.locator('.settings-dialog__endpoint-panel').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(52, 52, 47)');
    }
   }
   await dialog.getByRole('button',{name:'关闭',exact:true}).click();
   await page.getByRole('navigation',{name:'创作导航'}).getByRole('button',{name:'我的项目',exact:true}).click();
   await audit(`projects-${theme}-${width}`);
   await page.getByRole('navigation',{name:'创作导航'}).getByRole('button',{name:'自由画布',exact:true}).click();await page.locator('.plait-board-container').waitFor();
   await audit(`canvas-${theme}-${width}`);
   const expand=page.getByRole('button',{name:'展开工具栏',exact:true});if(await expand.isVisible())await expand.click();
   await page.locator('[data-track="toolbar_click_menu"]').click();await audit(`canvas-menu-${theme}-${width}`);
   await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  fs.writeFileSync(out+'/results.json',JSON.stringify({passed:true,checks,errors,missing},null,2));console.log('creative pages display audit passed',checks.length);
 }catch(e){await page.screenshot({path:out+'/failure.png'});console.log((await page.locator('body').innerText()).slice(-3000));throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
