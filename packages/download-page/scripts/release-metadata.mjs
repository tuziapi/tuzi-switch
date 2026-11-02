// Build a verified public-release snapshot. No invented package URLs or stale fallback.
import {writeFile, readFile, copyFile} from 'node:fs/promises';
import {isTuziSwitchRelease} from '../src/tuziSwitchRelease.js';
const repository = 'tuziapi/tuzi-switch';
const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
  headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'tuzi-download-build'},
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error(`Public release lookup failed: ${response.status}`);
const release = await response.json();
if (release.draft || release.prerelease) throw new Error('Expected a public stable release');
const definitions = [
  ['macos', 'macOS', 'Apple Silicon · .dmg', ['tuzi-switch-macos-aarch64.dmg']],
  ['windows', 'Windows', 'x86_64', ['tuzi-switch-windows-x86_64.msi', 'tuzi-switch-windows-x86_64-setup.exe']],
  ['deb', 'Linux · DEB', 'x86_64 · Debian / Ubuntu', ['tuzi-switch-linux-x86_64.deb']],
  ['rpm', 'Linux · RPM', 'x86_64 · Fedora / RHEL / openSUSE', ['tuzi-switch-linux-x86_64.rpm']],
  ['appimage', 'Linux · AppImage', 'x86_64 · .AppImage', ['tuzi-switch-linux-x86_64.AppImage']],
];
const downloads = definitions.flatMap(([id, title, subtitle, names]) => {
  const asset = names.map(name => release.assets.find(asset => asset.name === name && asset.state === 'uploaded' && asset.size > 0)).find(Boolean);
  return asset ? [{id, title, subtitle, href: asset.browser_download_url}] : [];
});
const metadata = {success: true, tag: release.tag_name, sourceUrl: release.html_url, command: '', stale: true, downloads};
if (!isTuziSwitchRelease(metadata)) throw new Error('Release did not match the allowed repository/package contract');
await writeFile('public/release.json', JSON.stringify(metadata, null, 2) + '\n');
await copyFile('LICENSE', 'public/LICENSE.txt');
console.log(`Verified ${metadata.tag}: ${downloads.length} packages`);
