// Verify both immutable candidates before an installed desktop UI experiment.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifySignature } from './updater-assets.mjs';
const root = process.argv[2];
const platform = process.argv[3] ?? 'linux';
assert.ok(['linux', 'macos'].includes(platform));
const key = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json')).plugins.updater.pubkey;
for (const [folder, runFile, id, sha, version] of [
  ['signed-base', 'base-run.json', '43699923173', '5bfee5f39b0b370093081227c6e19883f21280a0', '1.6.2'],
  ['signed-target', 'target-run.json', '43689683759', '695f4e933d797b39f7a61aad7804800a01eddc96', '1.6.3'],
]) {
  const dir = path.join(root, folder);
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'candidate.json')));
  const r = JSON.parse(fs.readFileSync(path.join(root, runFile)));
  assert.equal(r.conclusion, 'success'); assert.equal(r.head_sha, c.commit);
  assert.equal(r.path, '.github/workflows/unified-release.yml');
  assert.equal(c.commit, sha); assert.equal(c.repository, 'AiW520/tuzi-switch');
  assert.equal(c.releaseRepository, 'tuziapi/tuzi-switch');
  assert.equal(c.runId, id); assert.equal(c.tag, 'v' + version);
  assert.equal(createHash('sha256').update(key.trim()).digest('hex'), c.publicKeySha256);
  assert.equal(c.publicKeySha256, '8118379cd76c3f4be522498e732856efd5b1a56aed12f0e50a1155993e7d0fb5');
  assert.equal(Object.keys(c.files).length, 23);
  for (const [name, digest] of Object.entries(c.files)) {
    assert.equal(path.basename(name), name);
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex'), digest);
  }
  for (const name of platform === 'linux'
    ? ['deb', 'AppImage', 'rpm'].map(extension => 'tuzi-assistant-linux-x64.' + extension)
    : ['macos-arm64', 'macos-x64'].map(arch => 'tuzi-assistant-' + arch + '.app.tar.gz')) {
    const file = path.join(dir, name);
    verifySignature(fs.readFileSync(file), fs.readFileSync(file + '.sig', 'utf8'), key);
  }
}
console.log('Both signed desktop candidates match their approved runs, source, all bytes and signatures');
