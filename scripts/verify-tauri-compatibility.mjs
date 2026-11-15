import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTauriVersions, checkWorkspace } from './tauri-compatibility.mjs';

const npm = { '@tauri-apps/cli': '2.10.1', '@tauri-apps/api': '2.10.1', '@tauri-apps/plugin-dialog': '2.6.0', '@tauri-apps/plugin-updater': '2.10.0' };
const crates = { tauri: '2.10.3', 'tauri-plugin-dialog': '2.6.0', 'tauri-plugin-updater': '2.10.0' };
test('permits patch differences but rejects the previously mismatched JS APIs', () => {
  validateTauriVersions(npm, crates);
  for (const [name, old] of [['@tauri-apps/api', '2.8.0'], ['@tauri-apps/plugin-dialog', '2.4.0'], ['@tauri-apps/plugin-updater', '2.9.0']])
    assert.throws(() => validateTauriVersions({ ...npm, [name]: old }, crates), /must match/);
});
test('rejects the old bundler and missing native plugins', () => {
  assert.throws(() => validateTauriVersions({ ...npm, '@tauri-apps/cli': '2.8.1' }, crates), /bundle marker/);
  assert.throws(() => validateTauriVersions(npm, { ...crates, 'tauri-plugin-updater': undefined }), /missing/);
});
test('checks installed host packages against the actual lockfile', () => {
  checkWorkspace(process.cwd());
});
