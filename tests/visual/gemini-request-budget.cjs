// Real browser image encoding against desktop source; synthetic media, no model calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.CREATIVE_QA_BROWSER || 'chromium';
const base = process.env.CREATIVE_QA_BASE_URL || 'http://127.0.0.1:5221';
const output = process.env.CREATIVE_QA_OUTPUT || '/tmp/opentu-budget-' + engine;

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await pw[engine].launch(engine === 'chromium'
    ? { headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }
    : { headless: true });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname === '127.0.0.1' || /^(data|blob):/.test(url.protocol)
        ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    // Same-origin empty response keeps app startup out of this encoder check.
    await context.route(base + '/budget-fixture', route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>Synthetic request budget</title>',
    }));
    await page.goto(base + '/budget-fixture');
    const services = '/@fs' + path.resolve(__dirname,
      '../../packages/creative-workspace/upstream/packages/drawnix/src/services');
    const report = await page.evaluate(async ({ services }) => {
      const { fitGeminiOmniRequest, GEMINI_OMNI_REQUEST_MAX_BYTES: limit } =
        await import(services + '/gemini-omni-request-budget.ts');
      const { persistKeepOriginalImageEnabled } =
        await import(services + '/reference-image-settings.ts');
      persistKeepOriginalImageEnabled(false);
      const bytes = body => new TextEncoder().encode(JSON.stringify(body)).length;
      const canvas = document.createElement('canvas');
      canvas.width = 1200; canvas.height = 800;
      const ctx = canvas.getContext('2d');
      const pixels = ctx.createImageData(canvas.width, canvas.height);
      let seed = 1117;
      for (let i = 0; i < pixels.data.length; i += 4) {
        for (let channel = 0; channel < 3; channel++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          pixels.data[i + channel] = seed >>> 24;
        }
        pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      const png = canvas.toDataURL('image/png').split(',')[1];
      const original = {
        model: 'gemini-omni-1.2-flash', seconds: '8', size: '1280x720',
        input: [{ type: 'text', text: 'SYNTHETIC 保留参考顺序' },
          { type: 'image', mime_type: 'image/png', data: png }],
      };
      const originalBytes = bytes(original);
      const results = [];
      for (const fallback of [false, true]) {
        const bitmap = window.createImageBitmap;
        const offscreen = window.OffscreenCanvas;
        if (fallback) {
          window.createImageBitmap = undefined;
          window.OffscreenCanvas = undefined;
        }
        try {
          for (const count of [1, 2]) {
            const body = structuredClone(original);
            if (count === 2) body.input.push({ ...body.input[1] });
            const before = JSON.stringify(body);
            const fitted = await fitGeminiOmniRequest(body);
            const images = [];
            for (const part of fitted.input.filter(part => part.type === 'image')) {
              const image = new Image();
              image.src = `data:${part.mime_type};base64,${part.data}`;
              await image.decode();
              images.push([image.naturalWidth, image.naturalHeight]);
            }
            results.push({ fallback, count, inputBytes: bytes(body), outputBytes: bytes(fitted),
              unchanged: JSON.stringify(body) === before, images,
              textUnchanged: fitted.input[0].text === body.input[0].text });
          }
        } finally {
          window.createImageBitmap = bitmap;
          window.OffscreenCanvas = offscreen;
        }
      }
      persistKeepOriginalImageEnabled(true);
      let keepOriginalRejected = false;
      try { await fitGeminiOmniRequest(original); }
      catch (error) { keepOriginalRejected = error.message.includes('保留原图'); }
      return { limit, originalBytes, results, keepOriginalRejected, paidRequests: 0 };
    }, { services });
    assert(report.originalBytes > report.limit);
    assert(report.keepOriginalRejected);
    for (const result of report.results) {
      assert(result.outputBytes <= report.limit);
      assert(result.unchanged && result.textUnchanged);
      assert.equal(result.images.length, result.count);
      for (const [width, height] of result.images) {
        assert(Math.abs(width / height - 1.5) < 0.01);
      }
    }
    fs.writeFileSync(output + '/report.json', JSON.stringify({ engine, ...report }, null, 2) + '\n');
    console.log(JSON.stringify({ engine, passed: report.results.length, output }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
