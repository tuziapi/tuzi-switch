// Exercise unchanged official-channel installers on a disposable Windows runner.
// Synthetic discovery/TLS is local; payload bytes and updater signatures are real.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { verifySignature } from './updater-assets.mjs';

assert.equal(process.platform, 'win32');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REPOSITORY, 'AiW520/tuzi-switch');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
const [baseDir, nextDir, output, installer] = process.argv.slice(2);
assert.ok(['nsis', 'msi'].includes(installer));
const root = path.resolve(output);
fs.mkdirSync(root, { recursive: true });
assert.ok(!fs.existsSync(path.join(process.env.USERPROFILE, '.tuzi-switch')), 'A clean runner profile is required');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const publicKey = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json')).plugins.updater.pubkey;
function candidate(dir, run, commit, version) {
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'candidate.json')));
  assert.equal(c.repository, 'AiW520/tuzi-switch');
  assert.equal(c.releaseRepository, 'tuziapi/tuzi-switch');
  assert.equal(c.runId, run); assert.equal(c.commit, commit); assert.equal(c.tag, `v${version}`);
  assert.equal(c.publicKeySha256, sha(publicKey.trim()));
  for (const [name, hash] of Object.entries(c.files)) {
    assert.equal(path.basename(name), name);
    assert.equal(sha(fs.readFileSync(path.join(dir, name))), hash, `Candidate bytes changed: ${name}`);
  }
  for (const ext of ['exe', 'msi']) {
    const file = path.join(dir, `tuzi-assistant-windows-x64.${ext}`);
    verifySignature(fs.readFileSync(file), fs.readFileSync(`${file}.sig`, 'utf8'), publicKey);
  }
  return c;
}
const base = candidate(baseDir, '43680220045', '11b8e308ef77708df3526a7701d106fc04b15f57', '1.6.2');
const next = candidate(nextDir, '43689683759', '695f4e933d797b39f7a61aad7804800a01eddc96', '1.6.3');
const executable = path.join(root, 'installed', 'tu-zi-switch.exe');
const env = { ...process.env, TUZI_SIGNED_LAB_ROOT: root, TUZI_SIGNED_LAB_EXE: executable };
// No build/repository token is passed to the installed desktop process.
const appEnv = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1' };
for (const key of Object.keys(appEnv)) if (/TOKEN|SECRET|PASSWORD|PRIVATE_KEY/i.test(key)) delete appEnv[key];
delete appEnv.CC_SWITCH_TEST_HOME; delete appEnv.TUZI_UPDATER_QA_ROOT;
function powershell(script) {
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env, encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr || `PowerShell exited ${result.status}`);
  return result.stdout.trim();
}
const report = {
  kind: 'real-installed-app-subset', platform: 'windows-x64', installerType: installer,
  officialAcceptance: false, discovery: 'synthetic-local-https', signingKey: 'new-official-channel-key',
  fromVersion: '1.6.2', toVersion: '1.6.3', base, target: next, checks: {}, requests: [],
  remaining: ['older-official-manual-transition', 'installer-failure', 'full-creative-project-migration', 'business-attribution', 'reviewed-cross-platform-acceptance'],
};
let server, browser;
let mode = 'normal';
const assetName = `tuzi-assistant-windows-x64.${installer === 'msi' ? 'msi' : 'exe'}`;
const release = {
  tag_name: next.tag, html_url: `https://github.com/tuziapi/tuzi-switch/releases/tag/${next.tag}`,
  draft: false, prerelease: false, published_at: '2026-11-15T00:00:00Z', body: 'SYNTHETIC local discovery for real signed candidate verification.',
  assets: Object.entries(next.files).map(([name, digest]) => ({ name, state: 'uploaded', size: fs.statSync(path.join(nextDir, name)).size,
    digest: `sha256:${digest}`, browser_download_url: `https://github.com/tuziapi/tuzi-switch/releases/download/${next.tag}/${name}` })),
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(version, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const b = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 3000 });
      report.cdpPages = b.contexts().flatMap(c => c.pages()).map(p => p.url());
      const p = b.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url()));
      if (p) {
        const v = await p.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|version'));
        if (v === version) { browser = b; p.setDefaultTimeout(30000); return p; }
      }
      await b.close();
    } catch (error) { report.lastConnectError = String(error); }
    await delay(1000);
  }
  throw Error(`No automatically running application at version ${version}`);
}
async function identity(page, version, commit) {
  const value = await page.evaluate(async () => ({
    version: await window.__TAURI_INTERNALS__.invoke('plugin:app|version'),
    identifier: await window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'),
    build: await window.__TAURI_INTERNALS__.invoke('get_update_build_info'),
  }));
  assert.equal(value.version, version); assert.equal(value.identifier, 'com.tuziswitch.desktop');
  assert.equal(value.build.channel, 'stable'); assert.equal(value.build.repository, 'tuziapi/tuzi-switch');
  assert.equal(value.build.commit, commit);
  return value;
}
try {
  powershell(String.raw`
$ErrorActionPreference='Stop'
Import-Module Microsoft.PowerShell.Security
$root=$env:TUZI_SIGNED_LAB_ROOT
$hosts=Join-Path $env:SystemRoot 'System32/drivers/etc/hosts'
Copy-Item $hosts (Join-Path $root 'hosts.original')
[Environment]::GetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS','User') | Set-Content (Join-Path $root 'webview-env.original')
$cert=New-SelfSignedCertificate -DnsName 'github.com','api.github.com' -CertStoreLocation Cert:\CurrentUser\My -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(1) -FriendlyName 'SYNTHETIC Tuzi updater lab'
$cert.Thumbprint | Set-Content (Join-Path $root 'tls-thumbprint.txt')
$password=ConvertTo-SecureString 'SYNTHETIC-LAB-ONLY' -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath (Join-Path $root 'synthetic-tls.pfx') -Password $password | Out-Null
Export-Certificate -Cert $cert -FilePath (Join-Path $root 'synthetic-tls.cer') | Out-Null
Import-Certificate -FilePath (Join-Path $root 'synthetic-tls.cer') -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
[Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS','--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1','User')
Add-Content -Path $hosts -Value @('','127.0.0.1 github.com api.github.com')
Clear-DnsClientCache
$webviewGlob=Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Microsoft/EdgeWebView/Application/*/msedgewebview2.exe'
$programs=@($env:TUZI_SIGNED_LAB_EXE)+@(Get-ChildItem $webviewGlob | ForEach-Object FullName)
if ($programs.Count -lt 2) { throw 'Preinstalled WebView2 runtime required' }
foreach ($program in $programs) {
 New-NetFirewallRule -DisplayName 'SYNTHETIC Tuzi signed updater lab' -Direction Outbound -Action Block -Program $program -RemoteAddress '0.0.0.1-126.255.255.255','128.0.0.0-255.255.255.254','::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff' | Out-Null
}
`);
  server = https.createServer({ pfx: fs.readFileSync(path.join(root, 'synthetic-tls.pfx')), passphrase: 'SYNTHETIC-LAB-ONLY' }, (req, res) => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    report.requests.push({ host: url.hostname, path: url.pathname, mode });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Accept,Content-Type,Cache-Control');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (url.hostname === 'api.github.com' && url.pathname === '/repos/tuziapi/tuzi-switch/releases/latest') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(release)); return;
    }
    if (url.hostname === 'github.com' && url.pathname === '/tuziapi/tuzi-switch/releases/latest/download/latest.json') {
      res.setHeader('Content-Type', 'application/json'); res.end(fs.readFileSync(path.join(nextDir, 'latest.json'))); return;
    }
    if (url.hostname === 'github.com' && url.pathname === `/tuziapi/tuzi-switch/releases/download/${next.tag}/${assetName}`) {
      if (mode === 'missing') { res.writeHead(404); res.end(); return; }
      const payload = fs.readFileSync(path.join(nextDir, assetName));
      if (mode === 'interrupted') {
        res.writeHead(200, { 'Content-Length': payload.length, Connection: 'close' });
        res.write(payload.subarray(0, 1024), () => res.destroy()); return;
      }
      const bytes = mode === 'corrupt' ? Buffer.concat([payload, Buffer.from('SYNTHETIC TAMPER')]) : payload;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length }); res.end(bytes); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(443, '127.0.0.1', resolve); });
  const installArgs = installer === 'msi' ? ['msiexec', '/i', path.resolve(baseDir, assetName), '/qn', '/norestart', `INSTALLDIR=${path.dirname(executable)}`]
    : [path.resolve(baseDir, assetName), '/S', `/D=${path.dirname(executable)}`];
  const installed = spawnSync(installArgs[0], installArgs.slice(1), { env: appEnv, encoding: 'utf8', timeout: 180000 });
  assert.equal(installed.status, 0, `Initial installer failed: ${installed.stderr}`);
  assert.ok(fs.existsSync(executable));
  const beforeHash = sha(fs.readFileSync(executable));
  report.initialExecutableSha256 = beforeHash;
  const initial = spawn(executable, [], { env: appEnv, stdio: 'ignore', detached: true });
  report.initialPid = initial.pid;
  initial.on('exit', (code, signal) => { report.initialExit = { code, signal }; });
  initial.unref();
  let page = await connect('1.6.2');
  report.baseIdentity = await identity(page, '1.6.2', base.commit);
  const fixture = { id: 'SYNTHETIC-SIGNED-UPGRADE', name: 'SYNTHETIC signed upgrade preservation', settingsConfig: { env: { ANTHROPIC_AUTH_TOKEN: 'SYNTHETIC-NO-REAL-CREDENTIAL', ANTHROPIC_BASE_URL: 'https://synthetic.invalid' } } };
  await page.evaluate(async provider => {
    await window.__TAURI_INTERNALS__.invoke('add_provider', { app: 'claude', provider, addToLive: false });
    localStorage.setItem('SYNTHETIC-SIGNED-UPGRADE', 'preserve-me');
    localStorage.setItem('i18nextLng', 'zh');
  }, fixture);
  await page.reload();
  await page.getByRole('button', { name: /查看更新|View update/i }).first().click({ timeout: 60000 });
  const dialog = page.getByRole('dialog').filter({ hasText: '1.6.3' });
  await dialog.waitFor();
  await page.screenshot({ path: path.join(root, '01-real-update-dialog.png') });
  for (const failure of ['corrupt', 'interrupted', 'missing']) {
    mode = failure;
    await dialog.getByRole('button', { name: /下载更新|重新下载/, exact: true }).click();
    await dialog.getByRole('button', { name: '重新下载', exact: true }).waitFor({ timeout: 90000 });
    assert.ok(report.requests.some(r => r.path.endsWith(assetName) && r.mode === failure), 'Failure must reach the actual native payload request');
    assert.equal(sha(fs.readFileSync(executable)), beforeHash);
    await identity(page, '1.6.2', base.commit);
    assert.equal(await dialog.getByRole('button', { name: '重启并更新', exact: true }).count(), 0);
    report.checks[failure] = 'passed';
    await page.screenshot({ path: path.join(root, `02-${failure}-rejected.png`) });
  }
  mode = 'normal';
  await dialog.getByRole('button', { name: '重新下载', exact: true }).click();
  await dialog.getByRole('button', { name: '重启并更新', exact: true }).waitFor({ timeout: 120000 });
  await page.screenshot({ path: path.join(root, '03-native-signature-verified.png') });
  await dialog.getByRole('button', { name: '重启并更新', exact: true }).click();
  // No manual launch here: the native updater/installer must restart the app.
  page = await connect('1.6.3');
  report.targetIdentity = await identity(page, '1.6.3', next.commit);
  const preserved = await page.evaluate(async () => ({
    providers: await window.__TAURI_INTERNALS__.invoke('get_providers', { app: 'claude' }),
    preference: localStorage.getItem('SYNTHETIC-SIGNED-UPGRADE'),
  }));
  assert.deepEqual(preserved.providers[fixture.id].settingsConfig, fixture.settingsConfig);
  assert.equal(preserved.providers[fixture.id].name, fixture.name);
  assert.equal(preserved.preference, 'preserve-me');
  report.finalExecutableSha256 = sha(fs.readFileSync(executable));
  assert.notEqual(report.finalExecutableSha256, beforeHash);
  assert.ok(report.requests.some(r => r.path.endsWith(assetName) && r.mode === 'normal'));
  Object.assign(report.checks, { download: 'passed', nativeSignature: 'passed', install: 'passed', automaticRestart: 'passed', version: 'passed', sqliteProviderAndWebviewPreference: 'passed', sameInstallationRetry: 'passed' });
  await page.screenshot({ path: path.join(root, '04-real-restarted-application.png') });
  report.subsetStatus = 'passed';
} catch (error) {
  report.subsetStatus = 'failed'; report.error = String(error);
  try {
    report.processDiagnostics = JSON.parse(powershell(String.raw`
@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:TUZI_SIGNED_LAB_EXE -or $_.Name -eq 'msedgewebview2.exe' } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath) | ConvertTo-Json -Compress
`));
  } catch (diagnosticError) { report.diagnosticError = String(diagnosticError); }
  const log = path.join(process.env.USERPROFILE, '.tuzi-switch', 'logs', 'tuzi-switch.log');
  if (fs.existsSync(log)) report.startupLogTail = fs.readFileSync(log, 'utf8').split(/\r?\n/).slice(-80);

  try { await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: path.join(root, 'failure.png') }); } catch {}
  throw error;
} finally {
  try {
    powershell(String.raw`
$ErrorActionPreference='Stop'
Import-Module Microsoft.PowerShell.Security
$root=$env:TUZI_SIGNED_LAB_ROOT
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:TUZI_SIGNED_LAB_EXE } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if (Test-Path (Join-Path $root 'hosts.original')) { Copy-Item (Join-Path $root 'hosts.original') (Join-Path $env:SystemRoot 'System32/drivers/etc/hosts') -Force; Clear-DnsClientCache }
if (Test-Path (Join-Path $root 'webview-env.original')) {
 $previous=Get-Content (Join-Path $root 'webview-env.original') -Raw
 [Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS',([string]$previous).Trim(),'User')
}
Get-NetFirewallRule -DisplayName 'SYNTHETIC Tuzi signed updater lab' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if (Test-Path (Join-Path $root 'tls-thumbprint.txt')) {
 $thumb=(Get-Content (Join-Path $root 'tls-thumbprint.txt') -Raw).Trim()
 Remove-Item "Cert:\CurrentUser\My\$thumb","Cert:\LocalMachine\Root\$thumb" -Force -ErrorAction SilentlyContinue
}
`);
  } catch (error) {
    report.cleanupError = String(error);
    report.subsetStatus = 'failed';
    process.exitCode = 1;
  } finally {
    try { await browser?.close(); } catch {}
    server?.closeAllConnections(); server?.close();
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(report, null, 2));
  }
}

