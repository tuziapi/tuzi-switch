// Real settings and IndexedDB, synthetic account IPC, no external traffic.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out=process.env.CREATIVE_QA_OUTPUT || '/tmp/creative-account-qa';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const context=await browser.newContext({viewport:{width:1360,height:950}});
 const page=await context.newPage(); const errors=[]; const managedNetwork=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>{
  const req=route.request(); const url=new URL(req.url());
  if(JSON.stringify(req.headers()).includes('tuzi-account:')) managedNetwork.push(url.origin+url.pathname);
  return url.hostname==='127.0.0.1' || ['data:','blob:'].includes(url.protocol) ? route.continue():route.abort();
 });
 const url='http://127.0.0.1:5197/ui04.html?canvas=1&page=creative';
 const dialog=()=>page.getByTestId('settings-dialog');
 const open=async()=>{await page.getByRole('button',{name:'创作配置',exact:true}).click();await dialog().waitFor();await page.waitForTimeout(250);};
 const field=(label)=>dialog().locator('.settings-dialog__field').filter({has:page.locator('label').filter({hasText:new RegExp('^'+label+'$')})}).locator('input').first();
 const close=async()=>{await dialog().getByRole('button',{name:'关闭',exact:true}).click();await dialog().waitFor({state:'hidden'});};
 try {
  await page.goto(url);await open();
  await dialog().getByRole('button',{name:'兔子账户',exact:true}).click();
  await dialog().getByRole('button',{name:/合成开发密钥/}).click();
  assert.equal(await field('API 地址').inputValue(),'https://api.tu-zi.com/v1');
  assert.equal(await field('API 地址').getAttribute('readonly'),'');
  await dialog().getByRole('button',{name:'保存',exact:true}).click();await dialog().waitFor({state:'hidden'});
  await page.reload();await open();
  await dialog().getByText('sk-•••• DEMO · default',{exact:true}).waitFor();
  await dialog().getByRole('button',{name:'获取模型',exact:true}).click();
  await page.getByRole('button',{name:'添加模型',exact:true}).waitFor();
  assert.match(await page.locator('.model-discovery-dialog').innerText(),/gpt-image-2/);
  await page.getByRole('button',{name:'全选',exact:true}).click();
  await page.getByRole('button',{name:'添加模型',exact:true}).click();
  await page.waitForTimeout(300);
  await dialog().getByRole('button',{name:'保存',exact:true}).click();await dialog().waitFor({state:'hidden'});
  await page.reload();await open();
  assert.match(await dialog().innerText(),/gpt-image-2/);
  // Changing to manual then cancelling must keep the original association.
  await dialog().getByRole('button',{name:'手动配置',exact:true}).click();
  await dialog().locator('input[type="password"]').fill('sk-SYNTHETIC-CANCELLED');
  await dialog().getByRole('button',{name:'取消',exact:true}).click();await open();
  await dialog().getByText('sk-•••• DEMO · default',{exact:true}).waitFor();
  await page.screenshot({path:out+'/account-linked.png'});
  // Manual providers reuse the very same form and persist independently.
  await dialog().getByRole('button',{name:'新增供应商',exact:true}).click();
  await dialog().getByRole('button',{name:'手动配置',exact:true}).click();
  await field('名称').fill('合成手动供应商');
  await field('API 地址').fill('https://manual.invalid/v1');
  await dialog().locator('input[type="password"]').fill('sk-SYNTHETIC-MANUAL');
  await dialog().getByRole('button',{name:'保存',exact:true}).click();await dialog().waitFor({state:'hidden'});
  await page.reload();await open();
  await dialog().getByRole('button',{name:/合成手动供应商/}).click();
  assert.equal(await dialog().locator('input[type="password"]').inputValue(),'sk-SYNTHETIC-MANUAL');
  assert.equal(await field('API 地址').inputValue(),'https://manual.invalid/v1');
  await page.screenshot({path:out+'/manual.png'});
  await close();
  // Reopening at different sizes must leave the footer inside the creative viewport.
  for(const [width,height] of [[1360,900],[1024,800],[900,750]]) {
   await page.setViewportSize({width,height});await open();
   const bounds=await page.locator('.winbox-settings-window').boundingBox();
   assert(bounds && bounds.y>=0 && bounds.y+bounds.height<=height+2,JSON.stringify(bounds));
   await page.screenshot({path:out+`/settings-${width}.png`});await close();
  }
  await page.setViewportSize({width:1360,height:950});
  await page.evaluate(()=>{localStorage.setItem('vite-ui-theme','dark');document.documentElement.classList.add('dark');});await open();
  assert.equal(await dialog().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(41, 41, 37)');
  await page.screenshot({path:out+'/settings-dark.png'});await close();
  // Canvas menu reuses the same settings without remounting the board.
  await page.getByRole('navigation',{name:'创作导航'}).getByRole('button',{name:'自由画布',exact:true}).click();
  await page.locator('.plait-board-container').waitFor();
  const board = await page.locator('.plait-board-container').elementHandle();
  await page.locator('[data-track="toolbar_click_menu"]').click();
  await page.locator('[data-track="toolbar_click_menu_settings"]').click();
  await dialog().waitFor();assert.equal(await dialog().count(),1);await close();
  assert.equal(await board.evaluate(el=>el.isConnected),true);
  // Account-side Key configuration opens the same form with the selected Key indicated.
  await page.goto('http://127.0.0.1:5197/ui04.html?canvas=1&page=account');
  await page.getByRole('row').filter({hasText:'合成工作项目'}).getByRole('button',{name:'配置',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:/opentu 创作/}).isDisabled(),true);
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('row').filter({hasText:'合成开发密钥'}).getByRole('button',{name:'配置',exact:true}).click();
  await page.getByRole('button',{name:/opentu 创作/}).click();
  await dialog().waitFor();
  await dialog().getByRole('button',{name:/合成开发密钥 · 当前选择/}).waitFor();
  await page.screenshot({path:out+'/account-entry.png'});await close();
  // Disconnected association remains visible while manual credentials are retained.
  await page.goto(url+'&account=disconnected');await open();
  await dialog().getByRole('button',{name:/合成开发密钥/}).click();
  await dialog().getByRole('button',{name:'连接兔子账户',exact:true}).waitFor();
  await dialog().getByRole('button',{name:/合成手动供应商/}).click();
  assert.equal(await dialog().locator('input[type="password"]').inputValue(),'sk-SYNTHETIC-MANUAL');
  assert.equal(managedNetwork.length,0,managedNetwork.join('\n'));
  assert.deepEqual(errors,[]);
  fs.writeFileSync(out+'/results.json',JSON.stringify({passed:true,errors,managedNetwork,checks:['binding-save-reload','model-discovery-import-reload','cancel-draft','manual-save-reload','responsive-footer','dark','disconnect-manual-retained','original-canvas-menu','account-entry-selected-key']},null,2));
  console.log('creative account smoke passed');
 } catch(error) {await page.screenshot({path:out+'/failure.png'});console.log('pageerrors',errors);console.log((await page.locator('body').innerText()).slice(-3000));throw error;}
 finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
