// Read-only public verification. All network requests are anonymous.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const tag = process.argv[2];
assert(/^v\d+\.\d+\.\d+$/.test(tag || ''), 'Provide the accepted release tag');
const accepted = JSON.parse(fs.readFileSync(`docs/development/update-acceptance/${tag}.json`));
const repo = 'tuziapi/tuzi-switch';
assert.equal(accepted.releaseRepository, repo);
assert.equal(accepted.tag, tag);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function download(url, size = 0) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'tuzi-public-release-verification', ...(size ? { Range: 'bytes=0-63' } : {}) },
        signal: AbortSignal.timeout(45000),
      });
      assert.equal(response.status, size ? 206 : 200, `${url}: HTTP status`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (size) {
        assert.equal(response.headers.get('content-range'), `bytes 0-63/${size}`);
        assert.equal(bytes.length, 64);
      }
      return bytes;
    } catch (error) { last = error; }
  }
  throw last;
}
const release = JSON.parse(await download(`https://api.github.com/repos/${repo}/releases/latest`));
assert.equal(release.tag_name, tag);
assert.equal(release.draft, false);
assert.equal(release.prerelease, false);
assert.equal(release.assets.length, accepted.publicationFiles.length);
const source = JSON.parse(await download(`https://api.github.com/repos/${repo}/commits/${tag}`));
assert.equal(source.sha, accepted.commit);
const results = [];
for (const file of accepted.publicationFiles) {
  const matches = release.assets.filter(asset => asset.name === file);
  assert.equal(matches.length, 1, file);
  const asset = matches[0];
  assert.equal(asset.state, 'uploaded');
  assert.equal(asset.digest, `sha256:${accepted.files[file]}`);
  const url = `https://github.com/${repo}/releases/download/${tag}/${file}`;
  assert.equal(asset.browser_download_url, url);
  const range = asset.size >= 1024 * 1024;
  const bytes = await download(url, range ? asset.size : 0);
  if (!range) assert.equal(hash(bytes), accepted.files[file]);
  results.push({ file, url, size: asset.size, checkedBytes: bytes.length, sha256: accepted.files[file], method: range ? 'github-full-digest-and-anonymous-range-64' : 'anonymous-full-sha256', status: 'passed' });
}
const updaterUrl = `https://github.com/${repo}/releases/latest/download/latest.json`;
const updater = await download(updaterUrl);
assert.equal(hash(updater), accepted.files['latest.json']);
const distribution = JSON.parse(fs.readFileSync('download-SOURCE.json'));
assert.equal(distribution.currentDistribution.release, tag);
assert.equal(distribution.currentDistribution.clientSourceCommit, accepted.commit);
const html = fs.readFileSync('index.html', 'utf8');
const assets = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"?]+)"/g)].map(match => match[1]);
assert(assets.length >= 2);
const scripts = fs.readdirSync('.').filter(file => /^install-macos-v\d+\.\d+\.\d+\.sh$/.test(file));
assert(scripts.includes(`install-macos-${tag}.sh`));
const files = [...new Set(['index.html', 'tuzi-switch.html', 'release.json', 'install.sh', 'download-SOURCE.json', 'LICENSE.txt', 'tuzi-download-analytics.html', ...assets, ...scripts, ...['configuration', 'icon', 'projects', 'tools'].map(name => `tuzi-assistant-assets/${name}.png`)])];
const page = [];
for (const file of files) {
  const local = fs.readFileSync(file);
  const url = `https://tuziapi.github.io/tuzi-switch/${file}`;
  const bytes = await download(url);
  assert(bytes.equals(local), `Published page differs: ${file}`);
  page.push({ file, url, bytes: bytes.length, sha256: hash(bytes), status: 'passed' });
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), repository: repo, tag, releaseId: release.id, sourceCommit: accepted.commit, candidateRunId: accepted.runId, checkerCommit: process.env.GITHUB_SHA || null, pageSourceCommit: distribution.currentDistribution.pageSourceCommit, latestUpdater: { url: updaterUrl, sha256: hash(updater), status: 'passed' }, files: results, page }, null, 2));
