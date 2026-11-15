// Regression for the API Key prompt rendered outside the scoped creative styles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.CREATIVE_QA_OUTPUT || '/tmp/creative-key-dialog-qa';
fs.mkdirSync(out, {recursive:true});
(async () => {
 const browser = await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const context = await browser.newContext({viewport:{width:1180,height:800}});
 const page = await context.newPage(); const errors=[];
 page.on('pageerror', error => errors.push(error.message));
 await context.route('**/*', route => new URL(route.request().url()).hostname==='127.0.0.1' ? route.continue() : route.abort());
 try {
  await page.goto('http://127.0.0.1:5197/ui04.html?canvas=1&page=creative');
  await page.getByRole('button',{name:'创作配置',exact:true}).click();
  const settings=page.getByTestId('settings-dialog');await settings.waitFor();
  assert.equal(await settings.evaluate(el => !!el.closest('.creative-root')),true,'cold-open settings must stay in the creative portal');
  // Default Tuzi guide must also load both bundled QR images, without network.
  for (const [theme,width,height] of [['light',1180,800],['light',900,650],['dark',1180,800]]) {
   await page.setViewportSize({width,height});
   await page.evaluate(theme => document.documentElement.classList.toggle('dark',theme==='dark'),theme);
   await settings.getByRole('button',{name:/^(保存并)?获取模型$/}).click();
   const guide=page.locator('.api-key-dialog');await guide.waitFor();
   await page.waitForFunction(()=>[...document.querySelectorAll('.api-key-dialog img')].length===2 && [...document.querySelectorAll('.api-key-dialog img')].every(img=>img.complete && img.naturalWidth>0));
   const images=await guide.locator('img').evaluateAll(items=>items.map(img=>({width:img.naturalWidth,height:img.naturalHeight,bundled:img.src.startsWith('data:image/png;base64,')})));
   assert(images.every(img=>img.width>100 && img.height>100 && img.bundled),JSON.stringify(images));
   const box=await guide.boundingBox();assert(box.x>=0 && box.y>=0 && box.x+box.width<=width && box.y+box.height<=height);
   await guide.getByRole('button',{name:'确认',exact:true}).scrollIntoViewIfNeeded();
   assert.equal(await guide.getByRole('button',{name:'确认',exact:true}).isVisible(),true);
   await page.screenshot({path:out+`/tuzi-guide-${theme}-${width}.png`});
   await page.keyboard.press('Escape');await guide.waitFor({state:'detached'});
  }
  await settings.getByRole('button',{name:'新增供应商',exact:true}).click();
  await settings.getByRole('button',{name:'手动配置',exact:true}).click();
  for (const [theme,width,height] of [['light',1180,800],['light',900,650],['dark',1180,800]]) {
   await page.setViewportSize({width,height});
   await page.evaluate(theme => document.documentElement.classList.toggle('dark',theme==='dark'),theme);
   await settings.getByRole('button',{name:/^(保存并)?获取模型$/}).click();
   const dialog=page.locator('.api-key-dialog');await dialog.waitFor();await page.waitForTimeout(150);
   const result=await dialog.evaluate(el => {
    const root=el.closest('.creative-root'), overlay=el.parentElement;
    const r=el.getBoundingClientRect(), host=root?.getBoundingClientRect();
    const input=el.querySelector('input'), i=input.getBoundingClientRect();
    return {scoped:!!root,position:getComputedStyle(overlay).position,display:getComputedStyle(overlay).display,
     background:getComputedStyle(el).backgroundColor,
     inside:!!host && r.left>=host.left && r.right<=host.right && r.top>=host.top && r.bottom<=host.bottom,
     centered:!!host && Math.abs(r.left+r.width/2-host.left-host.width/2)<2 && Math.abs(r.top+r.height/2-host.top-host.height/2)<2,
     onTop:document.elementFromPoint(i.left+i.width/2,i.top+i.height/2)===input,
     focused:document.activeElement===input};
   });
   assert.deepEqual({...result,background:undefined},{scoped:true,position:'fixed',display:'flex',background:undefined,inside:true,centered:true,onTop:true,focused:true});
   assert.equal(result.background,theme==='dark'?'rgb(41, 41, 37)':'rgb(255, 255, 255)');
   await page.keyboard.press('Shift+Tab');
   assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)),true);
   await page.keyboard.press('Tab');
   await page.screenshot({path:out+`/key-dialog-${theme}-${width}.png`});
   await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
   assert.equal(await settings.isVisible(),true);
   assert.equal(await settings.evaluate(el => el.contains(document.activeElement)),true);
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(out+'/results.json',JSON.stringify({passed:true,errors,checks:['bundled-qr-images-decoded','default-guide-light-dark-narrow','scoped-styles','centered','above-settings','light-dark','narrow-window','focus-trap','escape-return']},null,2));
  console.log('creative nested key prompt passed');
 } catch(error) {await page.screenshot({path:out+'/failure.png'});throw error;}
 finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
