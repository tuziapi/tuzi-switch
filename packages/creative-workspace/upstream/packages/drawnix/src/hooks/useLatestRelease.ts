import { useEffect, useState } from 'react';

const RELEASE_REPO = 'AITU-Copilot/opentu';
const RELEASE_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
const RELEASE_PAGE = `https://github.com/${RELEASE_REPO}/releases/latest`;
const CACHE_KEY = 'opentu.latestReleaseCheck';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface LatestReleaseInfo {
  tag: string;
  url: string;
}

interface CachedCheck {
  fetchedAt: number;
  tag: string;
  url: string;
}

function parseSemver(value: string): number[] | null {
  const cleaned = value.replace(/^v/i, '').trim();
  if (!cleaned) return null;
  const parts = cleaned.split(/[.-]/);
  const numbers: number[] = [];
  for (const part of parts) {
    const num = Number.parseInt(part, 10);
    if (!Number.isFinite(num)) break;
    numbers.push(num);
  }
  return numbers.length > 0 ? numbers : null;
}

function isNewer(remote: string, current: string): boolean {
  const r = parseSemver(remote);
  const c = parseSemver(current);
  if (!r || !c) return false;
  const len = Math.max(r.length, c.length);
  for (let i = 0; i < len; i += 1) {
    const a = r[i] ?? 0;
    const b = c[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

function readCache(): CachedCheck | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedCheck;
    if (
      typeof parsed?.fetchedAt === 'number' &&
      typeof parsed?.tag === 'string' &&
      typeof parsed?.url === 'string'
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function writeCache(entry: CachedCheck) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore
  }
}

async function fetchLatestRelease(): Promise<CachedCheck | null> {
  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      tag_name?: string;
      html_url?: string;
    };
    if (!data.tag_name) return null;
    return {
      fetchedAt: Date.now(),
      tag: data.tag_name,
      url: data.html_url || RELEASE_PAGE,
    };
  } catch {
    return null;
  }
}

/**
 * 检查 GitHub 最新 release 是否比当前版本新。
 * 结果缓存 6 小时，避免每次打开菜单都打 API。
 * 仅在桌面端使用（Web 端走 SW 版本机制）。
 */
export function useLatestRelease(currentVersion: string, enabled = true): LatestReleaseInfo | null {
  const [latest, setLatest] = useState<LatestReleaseInfo | null>(null);

  useEffect(() => {
    if (!enabled || !currentVersion || currentVersion === '0.0.0') return;
    let cancelled = false;

    const apply = (entry: CachedCheck | null) => {
      if (cancelled || !entry) return;
      if (isNewer(entry.tag, currentVersion)) {
        setLatest({ tag: entry.tag, url: entry.url });
      } else {
        setLatest(null);
      }
    };

    const cached = readCache();
    if (cached) apply(cached);

    const stale = !cached || Date.now() - cached.fetchedAt > CHECK_INTERVAL_MS;
    if (!stale) return () => {
      cancelled = true;
    };

    const idle = (window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;

    const run = async () => {
      const fresh = await fetchLatestRelease();
      if (!fresh) return;
      writeCache(fresh);
      apply(fresh);
    };

    if (typeof idle === 'function') {
      idle(() => void run(), { timeout: 5000 });
    } else {
      setTimeout(() => void run(), 1500);
    }

    return () => {
      cancelled = true;
    };
  }, [currentVersion, enabled]);

  return latest;
}
