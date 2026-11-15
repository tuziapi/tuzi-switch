// Real canvas/DOM and local synthetic media; native save/clipboard are fixture IPC.
// No account, paid model, or external network access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.CREATIVE_QA_BROWSER || 'chromium';
const base = process.env.CREATIVE_QA_BASE_URL || 'http://127.0.0.1:5197';
const out = process.env.CREATIVE_QA_OUTPUT || `/tmp/tuzi-canvas-media-menu-${engine}`;
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await pw[engine].launch({ headless: true,
    ...(engine === 'chromium' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [], checks = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.__mediaMenuEvents = [];
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'contextmenu', 'focusin', 'focusout', 'scroll', 'resize']) {
      window.addEventListener(type, event => {
        const entry = { type, time: performance.now(), button: event.button,
          target: event.target?.nodeName + ':' + (event.target?.getAttribute?.('class') || ''),
          menu: !!document.querySelector('.canvas-image-menu') };
        window.__mediaMenuEvents.push(entry);
        if (window.__mediaMenuEvents.length > 100) window.__mediaMenuEvents.shift();
      }, true);
    }
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort();
  });
  const menu = page.locator('.canvas-image-menu');
  async function frames() {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  function media(id) { return page.locator(`[plait-data-id="${id}"] foreignObject`).first(); }
  async function point(id, fx = .25, fy = .25) {
    const r = await media(id).boundingBox(); assert(r, `visible media ${id}`);
    return { x: r.x + r.width * fx, y: r.y + r.height * fy };
  }
  async function openAt(id, fx = .25, fy = .25) {
    const p = await point(id, fx, fy);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await menu.waitFor(); await frames();
    assert(await menu.isVisible(), `menu remains open: ${id}`);
    return p;
  }
  async function dismiss() { await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' }); }
  async function checkMenu(id, labels, fx, fy) {
    const before = await page.evaluate(() => JSON.stringify(window.__drawnixBoard.children));
    await openAt(id, fx, fy);
    assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), labels);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__drawnixBoard.children)), before, 'right-click must not move or modify elements');
    await dismiss();
  }
  const imageLabels = ['复制图片', '图片另存为…', '显示图片文件', '预览原图', '复制提示词'];
  const videoLabels = ['视频另存为…', '预览视频', '复制提示词'];
  try {
    await page.goto(`${base}/ui04.html?canvas=1&page=creative`);
    await page.getByRole('navigation', { name: '创作导航' }).getByRole('button', { name: '自由画布', exact: true }).click();
    await page.waitForFunction(() => window.__drawnixBoard);
    if (await page.getByText('不再提示', { exact: true }).isVisible()) await page.getByText('不再提示', { exact: true }).click();
    const videoBase64 = fs.readFileSync(path.join(__dirname, 'fixtures/synthetic-video.mp4')).toString('base64');
    await page.evaluate(videoBase64 => {
      const b = window.__drawnixBoard;
      const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 160;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#28b4cd'; ctx.fillRect(0, 0, 240, 160);
      ctx.fillStyle = '#f34d72'; ctx.fillRect(120, 0, 120, 160);
      const image = canvas.toDataURL();
      const bytes = Uint8Array.from(atob(videoBase64), c => c.charCodeAt(0));
      const videoUrl = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' })) + '#video';
      for (const [id, x, video] of [['synthetic-picture', -400, false], ['synthetic-video', -80, true]]) {
        b.apply({ type: 'insert_node', path: [b.children.length], node: {
          id, type: 'image', points: [[x, -220], [x + 240, -60]],
          url: video ? videoUrl : image,
          ...(video ? { isVideo: true, poster: image } : {}), generationPrompt: `${id} prompt`,
        } });
      }
    }, videoBase64);
    await page.locator('[data-native-media-overlay]').waitFor(); await frames();
    for (const [id, labels] of [['synthetic-picture', imageLabels], ['synthetic-video', videoLabels]]) {
      for (const fraction of [.05, .25, .9]) await checkMenu(id, labels, fraction, fraction);
      const p = await point(id); await page.mouse.click(p.x, p.y); await frames();
      await checkMenu(id, labels);
      checks.push(`${id}: unselected/selected, edge/center/bottom, right-click does not mutate canvas`);
    }
    await openAt('synthetic-picture');
    await menu.getByRole('menuitem', { name: '复制图片', exact: true }).click();
    await page.waitForFunction(() => window.__creativeImageFixture?.calls.some(x => x.args.request?.name === 'image-synthetic-picture'));
    checks.push('image copy uses clicked original');
    await openAt('synthetic-picture'); await openAt('synthetic-video');
    assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), videoLabels);
    await menu.getByRole('menuitem', { name: '复制提示词', exact: true }).click();
    await page.waitForFunction(() => window.__creativeImageFixture.calls.some(x => x.command === 'copy_text_to_clipboard' && x.args.text === 'synthetic-video prompt'));
    checks.push('second right-click retargets image menu to video; video prompt copied');
    await openAt('synthetic-video');
    await menu.getByRole('menuitem', { name: '视频另存为…', exact: true }).click();
    await page.waitForFunction(() => window.__creativeMediaFixture?.sizes.length === 1);
    assert((await page.evaluate(() => window.__creativeMediaFixture.sizes[0])) > 1000);
    assert.equal((await page.evaluate(() => window.__creativeImageFixture.calls.filter(x => x.command === 'creative_image_action'))).length, 1);
    checks.push('video original reaches native media save, never image decoder');
    await openAt('synthetic-video');
    await menu.getByRole('menuitem', { name: '预览视频', exact: true }).click();
    await page.locator('.unified-viewer').waitFor();
    await page.keyboard.press('Escape'); await page.locator('.unified-viewer').waitFor({ state: 'hidden' });
    checks.push('video preview opens and dismisses');
    const layer = page.locator('[data-canvas-media-id="synthetic-video"]');
    await layer.getByRole('button', { name: '播放视频', exact: true }).click();
    // WebKit's metadata-only preload may require the player control after the
    // poster activates the video. Assert real playback, never synthesize play.
    await layer.locator('video').waitFor();
    if (engine === 'webkit') {
      await page.waitForFunction(() => document.querySelector('[data-canvas-media-id="synthetic-video"] video')?.readyState >= 1);
      if (await layer.locator('video').evaluate(v => v.paused))
        await layer.getByRole('button', { name: '播放视频', exact: true }).click();
    }
    await page.waitForFunction(() => { const v = document.querySelector('[data-canvas-media-id="synthetic-video"] video'); return v && !v.paused && v.currentTime > 0; });
    await checkMenu('synthetic-video', videoLabels, .3, .3);
    await checkMenu('synthetic-video', videoLabels, .5, .94);
    await layer.locator('video').evaluate(v => v.pause());
    checks.push('playing video and native player controls have media menu; playback preserved');
    const before = await point('synthetic-video');
    await page.mouse.move(before.x, before.y); await page.mouse.down();
    await page.mouse.move(before.x + 60, before.y + 35, { steps: 8 }); await frames(); await page.mouse.up(); await frames();
    await page.waitForFunction(() => {const e=window.__drawnixBoard.children.find(e=>e.id==='synthetic-video');return Math.abs(e.points[0][0]+20)<3 && Math.abs(e.points[0][1]+185)<3;});
    await checkMenu('synthetic-video', videoLabels); checks.push('left drag still moves video 60×35; menu works after drag');
    // Overlap a second picture; menu actions must resolve the top element.
    await page.evaluate(() => {const b=window.__drawnixBoard;const e=b.children.find(e=>e.id==='synthetic-picture');b.apply({type:'insert_node',path:[b.children.length],node:{...structuredClone(e),id:'synthetic-top',generationPrompt:'TOP'}});});
    await frames(); await openAt('synthetic-picture');
    await menu.getByRole('menuitem', {name:'复制提示词',exact:true}).click();
    await page.waitForFunction(()=>window.__creativeImageFixture.calls.at(-1).args.text==='TOP');
    checks.push('overlapping pictures target topmost element');
    // A native video occupies the actual DOM surface above an image inserted later.
    await page.evaluate(() => {const b=window.__drawnixBoard;const e=b.children.find(e=>e.id==='synthetic-picture');const v=b.children.find(e=>e.id==='synthetic-video');b.apply({type:'insert_node',path:[b.children.length],node:{...structuredClone(e),id:'synthetic-behind-video',points:structuredClone(v.points)}});});
    await frames(); await checkMenu('synthetic-video', videoLabels);
    checks.push('native overlay targets visible video, not geometrically overlapping image');
    for (const zoom of [.65, 1.35]) {
      await page.evaluate(zoom => {const b=window.__drawnixBoard;b.apply({type:'set_viewport',properties:b.viewport,newProperties:{...b.viewport,zoom}});}, zoom);
      await frames(); await page.waitForTimeout(120);
      await checkMenu('synthetic-picture', imageLabels); await checkMenu('synthetic-video', videoLabels);
    }
    checks.push('image and video menus survive zoom changes');
    await page.evaluate(() => {const b=window.__drawnixBoard;b.apply({type:'set_viewport',properties:b.viewport,newProperties:{...b.viewport,zoom:1}});});
    await frames();
    const canvasPoint = await point('synthetic-picture');
    await page.mouse.move(canvasPoint.x, canvasPoint.y); await page.mouse.wheel(45, 50); await page.waitForTimeout(300);
    await checkMenu('synthetic-picture', imageLabels); await checkMenu('synthetic-video', videoLabels);
    checks.push('menus survive canvas panning');
    await page.getByTestId('ai-input-textarea').click({button:'right'}); assert(!await menu.isVisible());
    await page.mouse.click(1100, 180, {button:'right'}); assert(!await menu.isVisible());
    checks.push('text input and blank canvas do not receive stale media menu');
    await openAt('synthetic-picture'); await page.screenshot({path:`${out}/image-menu.png`}); await dismiss();
    await openAt('synthetic-video'); await page.screenshot({path:`${out}/video-menu.png`}); await dismiss();
    await page.getByRole('button',{name:'兔子助手导航',exact:true}).click();
    const header=page.getByRole('complementary',{name:'应用导航'}).getByText('Assistant workspace').locator('..').locator('..');
    assert(await header.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0));
    await page.screenshot({path:`${out}/rabbit-brand.png`});
    checks.push('navigation header uses loaded rabbit brand');
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${out}/result.json`,JSON.stringify({engine,checks,errors},null,2));
    console.log(JSON.stringify({engine,checks,errors},null,2));
  } catch(error) {
    await page.screenshot({path:`${out}/failure.png`});
    fs.writeFileSync(`${out}/failure.json`,JSON.stringify({checks,errors,message:String(error),events:await page.evaluate(()=>window.__mediaMenuEvents),media:await page.evaluate(()=>[...document.querySelectorAll('[data-native-media-overlay]')].map(el=>({buttons:[...el.querySelectorAll('button')].map(b=>b.getAttribute('aria-label')),video:[...el.querySelectorAll('video')].map(v=>({paused:v.paused,currentTime:v.currentTime,readyState:v.readyState,error:v.error?.message,source:v.currentSrc.slice(0,60)}))}))),board:await page.evaluate(()=>window.__drawnixBoard?.children.map(({url,poster,...rest})=>rest))},null,2));
    throw error;
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
