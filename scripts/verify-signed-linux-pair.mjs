// Verify both immutable candidates before an installed desktop UI experiment.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifySignature } from './updater-assets.mjs';
import { pair, verifyRun, verifyCandidateIdentity } from './signed-candidate-pair.mjs';
const root = process.argv[2];
const platform = process.argv[3] ?? 'linux';
assert.ok(['linux', 'macos', 'windows'].includes(platform));
const key = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json')).plugins.updater.pubkey;
for (const [role, folder, runFile] of [
  ['base', 'signed-base', 'base-run.json'],
  ['target', 'signed-target', 'target-run.json'],
]) {
  const dir = path.join(root, folder);
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'candidate.json')));
  const r = JSON.parse(fs.readFileSync(path.join(root, runFile)));
  verifyRun(r, role);
  verifyCandidateIdentity(c, role);
  assert.equal(createHash('sha256').update(key.trim()).digest('hex'), pair.publicKeySha256);
  assert.equal(Object.keys(c.files).length, 23);
  for (const [name, digest] of Object.entries(c.files)) {
    assert.equal(path.basename(name), name);
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex'), digest);
  }
  for (const name of platform === 'linux'
    ? ['deb', 'AppImage', 'rpm'].map(extension => 'tuzi-assistant-linux-x64.' + extension)
    : platform === 'windows'
      ? ['exe', 'msi'].map(extension => 'tuzi-assistant-windows-x64.' + extension)
      : ['macos-arm64', 'macos-x64'].map(arch => 'tuzi-assistant-' + arch + '.app.tar.gz')) {
    const file = path.join(dir, name);
    verifySignature(fs.readFileSync(file), fs.readFileSync(file + '.sig', 'utf8'), key);
  }
}
console.log('Both signed desktop candidates match their approved runs, source, all bytes and signatures');
