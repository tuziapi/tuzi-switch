const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const out = '/tmp/tuzi-update-visual'; fs.mkdirSync(out, { recursive: true });
(async () => {
 const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
 const results = [];
 try {
  for (const [width, theme, platform] of [[1200, 'light', 'macos'], [680, 'dark', 'macos-intel']]) {
   const context = await browser.newContext({ viewport: { width, height: 780 } });
   const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
   const sourceUrl = 'https://github.com/AiW520/tuzi-switch/actions/runs/999';
   const metadata = { schemaVersion: 1, success: true, repository: 'AiW520/tuzi-switch', channel: 'acceptance', runNumber: 11, runId: '999', commit: 'b'.repeat(40), tag: 'test-bbbbbbbb', sourceUrl, publishedAt: new Date().toISOString(), downloads: ['macos', 'macos-intel', 'windows', 'linux'].map((id, i) => ({id, artifactId: String(100+i), href: sourceUrl+'/artifacts/'+(100+i), expiresAt: new Date(Date.now()+86400000).toISOString()})) };
   await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.href === 'https://raw.githubusercontent.com/AiW520/tuzi-switch/codex/download-pages/release.json') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metadata) });
    return route.abort();
   });
   await page.goto(`http://127.0.0.1:5201/update-notification.html?theme=${theme}&platform=${platform}`);
   await page.getByRole('button', { name: '下载更新', exact: true }).waitFor();
   assert.equal(await page.locator('output').innerText(), '');
   await page.screenshot({path: `${out}/${theme}-notice.png`});
   await page.getByRole('button', { name: '稍后提醒', exact: true }).click();
   await page.reload();
   await page.getByRole('button', { name: '检测到新版本：test-bbbbbbbb (#11)' }).waitFor();
   assert.equal(await page.getByRole('button', { name: '稍后提醒', exact: true }).count(), 0);
   await page.getByRole('button', { name: '检测到新版本：test-bbbbbbbb (#11)' }).click();
   await page.getByRole('dialog').waitFor();
   await page.screenshot({path: `${out}/${theme}-dialog.png`});
   await page.getByRole('dialog').getByRole('button', { name: '下载更新', exact: true }).click();
   await page.waitForFunction(() => document.querySelector('output').textContent.includes('/artifacts/'));
   assert.equal(await page.locator('output').innerText(), metadata.downloads.find(d => d.id === platform).href);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   assert.deepEqual(errors, []); results.push({width, theme, platform, passed:true}); await context.close();
  }
  fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2)); console.log(results);
 } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode=1});
