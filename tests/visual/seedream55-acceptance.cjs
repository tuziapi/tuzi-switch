// Real queue, canvas, IndexedDB and cache. Only the native HTTP boundary is synthetic.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.env.CREATIVE_QA_BROWSER || "chromium";
const output =
  process.env.CREATIVE_QA_OUTPUT || "/tmp/creative-generation-acceptance";
fs.mkdirSync(output, { recursive: true });
const url = (process.env.CREATIVE_QA_BASE_URL || 'http://127.0.0.1:5197') + '/ui04.html?canvas=1&page=creative';
async function records(page, db, store) {
  return page.evaluate(
    ({ db, store }) =>
      new Promise((resolve, reject) => {
        const o = indexedDB.open(db);
        o.onerror = () => reject(o.error);
        o.onsuccess = () => {
          const d = o.result,
            q = d.transaction(store).objectStore(store).getAll();
          q.onsuccess = () => {
            resolve(q.result);
            d.close();
          };
          q.onerror = () => reject(q.error);
        };
      }),
    { db, store },
  );
}
async function until(fn, description) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error(description);
}
async function canvas(p) {
  await p
    .getByRole("navigation", { name: "创作导航" })
    .getByRole("button", { name: "自由画布", exact: true })
    .click();
  await p.locator(".plait-board-container").waitFor();
  const intro = p.getByText("不再提示", { exact: true });
  if (await intro.isVisible()) await intro.click();
}
async function configure(p) {
  await p.getByRole("button", { name: "创作配置", exact: true }).click();
  const d = p.getByTestId("settings-dialog");
  await d.waitFor();
  await d.getByRole("button", { name: "手动配置", exact: true }).click();
  await d.locator("input[type=password]").fill("sk-SYNTHETIC-GENERATION");
  await d
    .locator(".settings-dialog__field")
    .filter({ has: p.locator("label").filter({ hasText: /^API 地址$/ }) })
    .locator("input")
    .first()
    .fill("https://creative.synthetic.invalid/v1");
  await d.getByRole("button", { name: "保存", exact: true }).click();
  await d.waitFor({ state: "hidden" });
}(async()=>{
  const browser=await playwright[engine].launch(engine==='chromium'?{headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.route('**/*', r=>new URL(r.request().url()).hostname==='127.0.0.1'||/^(data:|blob:)/.test(r.request().url())?r.continue():r.abort());
  const p=await context.newPage();p.setDefaultTimeout(20000);
  try {
    await p.goto(url);
    await p.waitForFunction(()=>!!window.__creativeRequestFixture);
    await p.evaluate(()=>{
      window.__creativeRequestFixture.responses['GET /v1/models']={body:{data:[{id:'doubao-seedream-5-5-261028',supported_endpoint_types:['image-generation'],endpoints:{'image-generation':{path:'/v1/images/generations',method:'POST'}}}]}};
    });
    await configure(p);await canvas(p);
    await p.locator('.model-dropdown__trigger').first().click();
    await p.getByText('豆包',{exact:true}).click();
    await p.locator('.model-dropdown__item').filter({hasText:/Seedream 5.5|doubao-seedream-5-5/}).first().click();
    await p.locator('.parameters-dropdown__trigger').first().click();
    await p.getByText('透明（PNG）',{exact:true}).click();
    await p.locator('.ai-input-bar__input').first().fill('SYNTHETIC Seedream 5.5');
    await p.locator('[data-track="ai_input_click_send"]').first().click();
    await until(async()=>(await records(p,'aitu-app','tasks')).some(t=>t.insertedToCanvas),'generation not inserted');
    const generation=await p.evaluate(()=>JSON.parse(atob(window.__creativeRequestFixture.requests.find(r=>r.method==='POST').body)));
    assert.equal(generation.model,'doubao-seedream-5-5-261028');
    assert.equal(generation.background,'transparent');
    assert.equal(generation.output_format,'png');
    const boards=await records(p,'aitu-workspace','boards');const original=boards.find(b=>b.elements.some(e=>e.type==='image'));
    const element=original.elements.find(e=>e.type==='image');

    await p.getByRole('button',{name:'Seedream 5.5 分层 / OCR',exact:true}).click();
    const dialog=p.locator('.layer-decomposition-dialog');await dialog.waitFor();
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('slider').fill('29');
    await dialog.getByRole('combobox').selectOption('1.5K');
    await p.evaluate(()=>{
      const png='iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAXklEQVR4nO3QMQ0AMAwDwbAogdIqyOIokcIIhgzeTvrdOtffJ9q6L1oBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIwB6YH0QQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4xqp5OFaPsrjbQAAAABJRU5ErkJggg==';
      window.__creativeRequestFixture.responses['POST /v1/images/generations']={body:{data:[0,1,2].map(z=>({url:'data:image/png;base64,'+png,z_index:z,name:z?'标题'+z:'底图',description:'SYNTHETIC',size:'64x64',bounding_box:{absolute:[0,0,64,64],normalized:[0,0,1000,1000]},background:z?'transparent':'opaque',...(z?{text_recognition:{text:'你好 '+z,lines:[{font:{family:'Synthetic'},styles:[{bold:true}]}]}}:{}),future_extension:{preserve:true}}))}};
    });
    await dialog.getByRole('button',{name:'开始分层',exact:true}).click();
    await dialog.getByText('分层已就绪',{exact:true}).waitFor();
    const request=await p.evaluate(()=>JSON.parse(atob(window.__creativeRequestFixture.requests.filter(r=>r.method==='POST').at(-1).body)));
    assert.deepEqual(request.layer_decomposition_options,{max_images:30,text_recognition:true});
    assert.equal(request.size,'1.5K');assert.equal(request.background,undefined);
    await dialog.getByText('标题1 · OCR',{exact:true}).click();
    await dialog.getByText('你好 1',{exact:true}).waitFor();
    await p.screenshot({path:output+'/seedream55-ocr.png'});
    await dialog.getByRole('button',{name:/应用|插入/}).click();
    await until(async()=>(await records(p,'aitu-workspace','boards')).find(b=>b.id===original.id)?.elements.filter(e=>e.metadata?.semanticLayer).length===3,'layer metadata not saved');
    await until(async()=>(await records(p,'aitu-workspace','boards')).find(b=>b.id===original.id)?.elements.every(e=>e.type!=='generation-anchor'),'completed generation placeholder remains after source replacement');
    await p.reload();await p.locator('.plait-board-container').waitFor();
    const restored=(await records(p,'aitu-workspace','boards')).find(b=>b.id===original.id);
    const layers=restored.elements.filter(e=>e.metadata?.semanticLayer);
    assert.equal(layers.length,3);
    assert.equal(layers[1].metadata.semanticLayer.textRecognition.text,'你好 1');
    assert.equal(layers[2].metadata.semanticLayer.providerMetadata.future_extension.preserve,true);
    const manifest=restored.elements.find(e=>e.metadata?.semanticLayerGroup)?.metadata.semanticLayerGroup.manifest;
    assert.equal(manifest.layers.length,3);assert.equal(manifest.layers[1].textRecognition.text,'你好 1');
    assert.ok(restored.elements.every(e=>e.type!=='generation-anchor'),'completed placeholder must not reappear after reload');
    await p.screenshot({path:output+'/seedream55-reloaded.png'});
    fs.writeFileSync(output+'/seedream55-results.json',JSON.stringify({kind:'synthetic-transport-browser',engine,generation:true,transparentPngRequest:true,layers:3,ocr:true,ocrTextVisible:true,duplicateUrlLayers:true,reloadPreserved:true,completedPlaceholderRemoved:true,liveProvider:false},null,2));
    console.log('Seedream 5.5 real UI + generation + layer/OCR + canvas reload passed (synthetic HTTP boundary)');
  } catch(error){await p.screenshot({path:output+'/seedream55-failure.png'});fs.writeFileSync(output+'/failure-dom.txt',await p.locator('body').innerText());throw error;} finally {await browser.close();}
})();
