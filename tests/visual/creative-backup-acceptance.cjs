// UI-driven ZIP roundtrip in disposable browser contexts, with synthetic credentials.
const assert=require('node:assert/strict');const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const JSZip=require('../../packages/creative-workspace/node_modules/jszip');
const out=process.env.CREATIVE_QA_OUTPUT||'/tmp/creative-backup-acceptance';fs.mkdirSync(out,{recursive:true});
const url='http://127.0.0.1:5197/ui04.html?canvas=1&page=creative';
const key='sk-SYNTHETIC-BACKUP-MUST-NOT-EXPORT';
async function boards(p){return p.evaluate(()=>new Promise(resolve=>{const o=indexedDB.open('aitu-workspace');o.onsuccess=()=>{const d=o.result,q=d.transaction('boards').objectStore('boards').getAll();q.onsuccess=()=>{resolve(q.result);d.close();};};}));}
async function backupDialog(p){const expand=p.getByRole('button',{name:'展开工具栏',exact:true});if(await expand.isVisible())await expand.click();await p.locator('[data-track="toolbar_click_menu"]').click();await p.locator('[data-track="toolbar_click_menu_backup"]').click();const d=p.locator('.backup-restore-dialog');await d.waitFor();return d;}
(async()=>{const b=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const results=[];
 const make=async()=>{const c=await b.newContext({viewport:{width:1180,height:800}});await c.route('**/*',r=>{const u=new URL(r.request().url());return u.hostname==='127.0.0.1'||['data:','blob:'].includes(u.protocol)?r.continue():r.abort();});const p=await c.newPage();p.setDefaultTimeout(15000);await p.goto(url);return {c,p};};
 try{
  const {c,p}=await make();await p.getByRole('button',{name:'创作配置',exact:true}).click();const settings=p.getByTestId('settings-dialog');await settings.waitFor();await settings.getByRole('button',{name:'手动配置',exact:true}).click();await settings.locator('input[type=password]').fill(key);await settings.getByRole('button',{name:'保存',exact:true}).click();await settings.waitFor({state:'hidden'});
  await p.getByRole('button',{name:'新建项目',exact:true}).click();await p.locator('.plait-board-container').waitFor();await p.getByRole('navigation',{name:'创作导航'}).getByRole('button',{name:'我的项目',exact:true}).click();await p.locator('.creative-rename').first().click();await p.getByRole('textbox',{name:'项目名称'}).fill('SYNTHETIC backup project');await p.getByRole('button',{name:'保存',exact:true}).click();await p.getByText('SYNTHETIC backup project',{exact:true}).click();await p.locator('.plait-board-container').waitFor();await p.waitForTimeout(1000);
  const d=await backupDialog(p);const wait=p.waitForEvent('download');await d.getByRole('button',{name:'开始备份',exact:true}).click();const download=await wait;await download.saveAs(out+'/valid.zip');await d.waitFor({state:'hidden'});
  const original=(await boards(p)).find(x=>x.name==='SYNTHETIC backup project');assert(original);const zip=await JSZip.loadAsync(fs.readFileSync(out+'/valid.zip'),{checkCRC32:true});for(const entry of Object.values(zip.files)){if(entry.dir)continue;assert(!(await entry.async('string')).includes(key),'secret leaked into unencrypted backup');}results.push({scenario:'export-no-plaintext-key',status:'passed'});await c.close();
  const broken=await JSZip.loadAsync(fs.readFileSync(out+'/valid.zip'));broken.file(Object.keys(broken.files).find(n=>n.endsWith('.drawnix')),'{invalid-json');fs.writeFileSync(out+'/corrupt.zip',await broken.generateAsync({type:'nodebuffer'}));
  for(const scenario of ['merge-twice','corrupt-replace']){
   const {c,p}=await make();try{
    await p.getByRole('button',{name:'新建项目',exact:true}).click();await p.locator('.plait-board-container').waitFor();await p.waitForTimeout(1000);const initial=await boards(p);const d=await backupDialog(p);await d.getByRole('button',{name:'恢复',exact:true}).click();
    if(scenario==='corrupt-replace')await d.getByRole('button',{name:/覆盖恢复/}).click();
    const importFile=async()=>{await d.locator('input[type=file]').setInputFiles(out+(scenario==='corrupt-replace'?'/corrupt.zip':'/valid.zip'));if(scenario==='corrupt-replace')await p.locator('.confirm-dialog').getByRole('button',{name:'覆盖恢复',exact:true}).click();await d.getByText(/导入完成/).waitFor();};
    await importFile();
    if(scenario==='corrupt-replace'){
     assert.match(await d.innerText(),/备份文件损坏/);const after=await boards(p);assert.deepEqual(after.map(x=>x.id),initial.map(x=>x.id));assert.deepEqual(after.map(x=>x.elements),initial.map(x=>x.elements));
    }else{
     assert(!/有错误|错误信息/.test(await d.innerText()));let after=await boards(p);assert(after.some(x=>x.id===original.id&&x.name===original.name));const count=after.length;await importFile();await p.waitForTimeout(600);after=await boards(p);assert.equal(after.length,count);assert.equal(after.filter(x=>x.id===original.id).length,1);
    }
    results.push({scenario,status:'passed'});await p.screenshot({path:out+'/'+scenario+'.png'});
   }catch(e){results.push({scenario,status:'failed',error:e.message});process.exitCode=1;}finally{await c.close();}
  }
 }finally{await b.close();fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});
