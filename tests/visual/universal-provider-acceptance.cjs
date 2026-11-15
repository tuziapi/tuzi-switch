const assert = require('node:assert/strict');
const fs = require('node:fs');
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.QA_BROWSER || 'chromium';
const out = process.env.QA_OUTPUT || `/tmp/tuzi-universal-${engine}`;
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await pw[engine].launch({ headless: true,
    ...(engine === 'chromium' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [], checks = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  try {
    await page.goto('http://127.0.0.1:5197/ui04.html?canvas=1&page=universal&universal-qa=1');
    await page.getByText('还没有统一供应商', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '添加统一供应商', exact: true }).count(), 2);
    await page.screenshot({ path: `${out}/empty.png` });
    await page.getByRole('button', { name: '添加统一供应商', exact: true }).last().click();
    await page.getByLabel('名称', { exact: true }).fill('合成测试网关');
    await page.getByLabel('API 地址', { exact: true }).fill('https://gateway.example.invalid');
    await page.getByLabel('API Key', { exact: true }).fill('synthetic-test-only');
    await page.evaluate(() => window.__universalFixture.failSave = true);
    await page.getByRole('button', { name: '添加并同步', exact: true }).click();
    await page.getByText('保存统一供应商失败', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('API Key', { exact: true }).inputValue(), 'synthetic-test-only');
    checks.push('standalone add entries and failed save retains draft');
    await page.evaluate(() => { window.__universalFixture.failSave = false; window.__universalFixture.failSync = true; });
    await page.getByRole('button', { name: '添加并同步', exact: true }).click();
    await page.getByText(/统一供应商已保存，但部分工具未同步/).waitFor();
    const id = await page.evaluate(() => Object.keys(window.__universalFixture.providers)[0]);
    await page.evaluate(() => window.__universalFixture.failSync = false);
    await page.getByRole('button', { name: '添加并同步', exact: true }).click();
    await page.getByLabel('API Key', { exact: true }).waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => Object.keys(window.__universalFixture.providers)), [id]);
    checks.push('partial sync failure retries same ID without duplicate');
    await page.getByRole('heading', { name: '合成测试网关' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: '合成测试网关' }).waitFor();
    await page.screenshot({ path: `${out}/saved.png` });
    checks.push('saved synthetic record reloads');
    await page.getByRole('heading', { name: '合成测试网关' }).hover();
    await page.getByTitle('编辑', { exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill('合成网关已修改');
    await page.getByRole('button', { name: '保存并同步', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '保存并同步', exact: true }).click();
    await page.getByLabel('API Key', { exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: '合成网关已修改' }).waitFor();
    checks.push('edit confirmation saves and closes');
    for (const [width, height, dark] of [[900,700,false],[1300,900,true]]) {
      await page.setViewportSize({width,height});
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
      const button = page.getByRole('button', { name: '添加统一供应商', exact: true });
      const box = await button.boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= width && box.y + box.height <= height);
      await page.screenshot({ path: `${out}/${dark ? 'dark' : 'compact'}.png` });
    }
    checks.push('compact and dark layouts keep add action visible');
    await page.getByRole('heading', { name: '合成网关已修改' }).hover();
    await page.getByTitle('同步到应用', { exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '同步', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state:'hidden' });
    await page.getByRole('heading', { name: '合成网关已修改' }).hover();
    await page.getByTitle('删除', { exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click();
    await page.getByText('还没有统一供应商', { exact: true }).waitFor();
    checks.push('manual sync and delete confirmations');
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${out}/result.json`, JSON.stringify({engine, checks, errors}, null, 2));
    console.log(JSON.stringify({engine, passed:checks.length, errors}));
  } catch (error) {
    await page.screenshot({ path:`${out}/failure.png` });
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
