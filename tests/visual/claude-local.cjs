// Browser fixture only; no native IPC, certificates or paid calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.CLAUDE_LOCAL_QA_BASE_URL || 'http://127.0.0.1:5216';
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page = await browser.newPage({viewport:{width:1180,height:780}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(base + '/claude-local.html?configured=1');
  const button = name => page.getByRole('button',{name,exact:true});
  await button('准备环境').waitFor(); assert.equal(await button('启动 Claude').count(),0);
  await button('准备环境').click();
  await page.getByText(/已检测到 Claude Desktop/).waitFor();
  assert.equal(await button('授权并继续').count(), 0);
  const out=process.env.CLAUDE_LOCAL_QA_OUTPUT || '/tmp/tuzi-claude-local-ui';fs.mkdirSync(out,{recursive:true});
  await page.screenshot({path:`${out}/gateway.png`,fullPage:true});
  await page.goto(base + '/claude-local.html?recovery=1');
  await button('停止并恢复').click();
  await page.getByText('所选清理操作已完成。',{exact:true}).waitFor();
  await page.setViewportSize({width:620,height:800});
  await page.goto(base + '/claude-local.html?configured=1&lang=en&dark=1');
  await button('Prepare environment').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`${out}/english-narrow.png`,fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: installation detection, gateway setup, cleanup, narrow English layout.');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
