import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateTauriVersions(npm, crates) {
  const errors = [];
  for (const [name, version] of Object.entries(npm)) {
    const crate = name === '@tauri-apps/api' ? 'tauri'
      : name.startsWith('@tauri-apps/plugin-') ? name.replace('@tauri-apps/', 'tauri-') : null;
    if (!crate) continue;
    const minor = value => /^(\d+\.\d+)\.\d+$/.exec(value ?? '')?.[1];
    if (!minor(version) || minor(version) !== minor(crates[crate]))
      errors.push(`${name}@${version} must match ${crate}@${crates[crate] ?? 'missing'} major/minor`);
  }
  // tauri-utils 2.8.3 uses the new bundle marker format; the old 2.8 CLI
  // only warns and can produce installers with no usable update identity.
  const cli = /^(\d+)\.(\d+)\.(\d+)$/.exec(npm['@tauri-apps/cli'] ?? '');
  if (!cli || +cli[1] < 2 || (+cli[1] === 2 && (+cli[2] < 10 || (+cli[2] === 10 && +cli[3] < 1))))
    errors.push('Updater candidates require Tauri CLI 2.10.1 or newer for the current bundle marker');
  if (errors.length) throw Error(errors.join('\n'));
}

export function checkWorkspace(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const npm = {};
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (!name.startsWith('@tauri-apps/')) continue;
    npm[name] = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'))).version;
  }
  const crates = {};
  for (const section of fs.readFileSync(path.join(root, 'src-tauri/Cargo.lock'), 'utf8').split('[[package]]')) {
    const name = /^name = "([^"]+)"$/m.exec(section)?.[1];
    const version = /^version = "([^"]+)"$/m.exec(section)?.[1];
    if (name && version) crates[name] = version;
  }
  validateTauriVersions(npm, crates);
  return npm;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkWorkspace(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  console.log('Installed host Tauri packages match locked Rust major/minor and support bundle identity');
}
