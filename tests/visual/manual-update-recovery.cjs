// Synthetic release metadata and IPC; no installers or external pages are opened.
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.UPDATE_QA_URL || 'http://127.0.0.1:5271';
const out = process.env.UPDATE_QA_OUTPUT || '/tmp/tuzi-manual-update-recovery';
const repo = 'tuziapi/tuzi-switch';
const release = {
  tag_name:'v1.6.0',html_url:`https://github.com/${repo}/releases/tag/v1.6.0`,
  published_at:'2026-11-11T07:36:27Z',draft:false,prerelease:false,
  body:'Synthetic manual update recovery. No real installation.',
  assets:['macos-arm64.dmg','macos-x64.dmg','windows-x64.exe','linux-x64.AppImage'].map(suffix=>({
    name:`tuzi-assistant-${suffix}`,browser_download_url:`https://github.com/${repo}/releases/download/v1.6.0/tuzi-assistant-${suffix}`,
    size:123,state:'uploaded',digest:`sha256:${'a'.repeat(64)}`
  }))
};
(async()=>{
 fs.mkdirSync(out,{recursive:true}); const results=[];
 for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true,...(name==='chromium'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
  try{
   for(const [platform,assetIndex] of [['macos',0],['macos-intel',1],['windows',2],['linux',3]]) for(const failure of ['', 'opener']){
    const page=await browser.newPage({viewport:{width:820,height:760}});const errors=[];let requests=0;
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{
     const url=new URL(route.request().url());
     if(url.hostname==='127.0.0.1')return route.continue();
     if(url.href===`https://api.github.com/repos/${repo}/releases/latest`){
      requests++;
      if(requests>1)return route.abort('failed');
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(release)});
     }
     return route.abort();
    });
    await page.goto(`${base}/update-notification.html?channel=stable&platform=${platform}&theme=dark&failure=${failure}`);
    await page.getByRole('button',{name:'查看更新',exact:true}).click();const dialog=page.getByRole('dialog');
    await dialog.getByRole('button',{name:'下载安装包',exact:true}).click();
    if(failure){
      await dialog.getByRole('alert').waitFor();assert.match(await dialog.getByRole('alert').innerText(),/synthetic OS error 1155/);
      await page.screenshot({path:`${out}/${name}-${platform}-opening-error.png`});
      await dialog.getByRole('button',{name:'复制下载链接',exact:true}).click();
      assert.equal(await page.locator('output').innerText(),`copied: ${release.assets[assetIndex].browser_download_url}`);
      await dialog.getByRole('button',{name:'打开版本下载页',exact:true}).click();
      await page.waitForFunction(expected=>document.querySelector('output').textContent===expected,release.html_url);
      assert.equal(await dialog.getByRole('alert').count(),0);
    }else{
      await page.waitForFunction(expected=>document.querySelector('output').textContent===expected,release.assets[assetIndex].browser_download_url);
    }
    assert.equal(requests,1,'Download must not repeat the API lookup');assert.deepEqual(errors,[]);
    assert.equal(await dialog.getByRole('button',{name:'重启并更新'}).count(),0);
    await page.screenshot({path:`${out}/${name}-${platform}-${failure||'direct'}-success.png`});
    results.push({engine:name,platform,scenario:failure||'second-api-unavailable',requests,passed:true});await page.close();
   }
  }finally{await browser.close();}
 }
 fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1;});
