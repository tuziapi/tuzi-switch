const RELEASE_METADATA = 'https://aiw520.github.io/opentuAI/download-release.json';
const ASSET_PREFIX = 'https://github.com/AiW520/opentuAI/releases/download/';

// App packages use a numeric version even when the public release is a preview.
export function numericVersion(value: string): number[] {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview\.[1-9]\d*)?$/.exec(value);
  if (!match) throw new Error('Invalid desktop release version');
  const parts = match.slice(1, 4).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Invalid desktop release version');
  return parts;
}

export function isNewerDesktopVersion(remote: string, current: string): boolean {
  const a = numericVersion(remote);
  const b = numericVersion(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export function parseDesktopRelease(data: unknown, current: string): { version: string; changelog?: string[] } | null {
  const release = data as { tag_name?: unknown; draft?: unknown; assets?: unknown; body?: unknown } | null;
  if (!release || release.draft === true || typeof release.tag_name !== 'string' || !Array.isArray(release.assets)) {
    throw new Error('Invalid desktop release metadata');
  }
  const prefix = `${ASSET_PREFIX}${release.tag_name}/`;
  const installers = release.assets.filter((asset) => {
    return asset && typeof asset.name === 'string' && /\.(dmg|exe|AppImage)$/.test(asset.name)
      && typeof asset.browser_download_url === 'string'
      && asset.browser_download_url === prefix + asset.name
      && !/[/?#\\]/.test(asset.name);
  });
  if (!installers.length) throw new Error('No published desktop installers');
  return isNewerDesktopVersion(release.tag_name, current)
    ? { version: release.tag_name.replace(/^v/, ''), changelog: typeof release.body === 'string' ? release.body.split(/\r?\n/).filter(Boolean) : undefined }
    : null;
}

export async function fetchDesktopRelease(current: string) {
  const response = await fetch(RELEASE_METADATA, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Desktop release metadata HTTP ${response.status}`);
  return parseDesktopRelease(await response.json(), current);
}
