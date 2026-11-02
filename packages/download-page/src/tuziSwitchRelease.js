/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

const releaseBase = 'https://github.com/tuziapi/tuzi-switch/releases/';
const fallbackTag = 'v1.3.0';

export const TUZI_SWITCH_FALLBACK_RELEASE = {
  tag: fallbackTag,
  command: `curl -fsSL ${releaseBase}download/${fallbackTag}/install_tuzi_switch.sh | TUZI_SWITCH_REPO=tuziapi/tuzi-switch TUZI_SWITCH_TAG=${fallbackTag} bash`,
  sourceUrl: `${releaseBase}tag/${fallbackTag}`,
  stale: true,
  downloads: [
    ['macos', 'macOS', 'Apple Silicon · .dmg', 'tuzi-switch-macos-aarch64.dmg'],
    ['windows', 'Windows', 'x86_64 · .msi', 'tuzi-switch-windows-x86_64.msi'],
    [
      'rpm',
      'Linux · RPM',
      'x86_64 · Fedora / RHEL / openSUSE',
      'tuzi-switch-linux-x86_64.rpm',
    ],
    [
      'deb',
      'Linux · DEB',
      'x86_64 · Debian / Ubuntu',
      'tuzi-switch-linux-x86_64.deb',
    ],
    [
      'appimage',
      'Linux · AppImage',
      'x86_64 · .AppImage',
      'tuzi-switch-linux-x86_64.AppImage',
    ],
  ].map(([id, title, subtitle, file]) => ({
    id,
    title,
    subtitle,
    href: `${releaseBase}download/${fallbackTag}/${file}`,
  })),
};

const packageFiles = {
  macos: ['tuzi-switch-macos-aarch64.dmg'],
  windows: [
    'tuzi-switch-windows-x86_64.msi',
    'tuzi-switch-windows-x86_64-setup.exe',
  ],
  deb: ['tuzi-switch-linux-x86_64.deb'],
  rpm: ['tuzi-switch-linux-x86_64.rpm'],
  appimage: ['tuzi-switch-linux-x86_64.AppImage'],
};

export const isTuziSwitchRelease = (payload) => {
  if (!payload?.success || !/^v\d+\.\d+\.\d+$/.test(payload.tag || ''))
    return false;
  const base = `${releaseBase}download/${payload.tag}/`;
  return (
    payload.sourceUrl === `${releaseBase}tag/${payload.tag}` &&
    (payload.command === '' ||
      payload.command ===
        `curl -fsSL ${base}install_tuzi_switch.sh | TUZI_SWITCH_REPO=tuziapi/tuzi-switch TUZI_SWITCH_TAG=${payload.tag} bash`) &&
    Array.isArray(payload.downloads) &&
    payload.downloads.length > 0 &&
    new Set(payload.downloads.map((item) => item?.id)).size ===
      payload.downloads.length &&
    payload.downloads.every(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        Object.hasOwn(packageFiles, item.id) &&
        typeof item.title === 'string' &&
        typeof item.subtitle === 'string' &&
        typeof item.href === 'string' &&
        packageFiles[item.id].some((file) => item.href === base + file),
    )
  );
};
