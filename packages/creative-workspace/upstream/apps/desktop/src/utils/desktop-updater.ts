import { isTauriEnvironment } from './tauri-api';
import {
  DESKTOP_DOWNLOAD_PAGE,
  publishDesktopUpdate,
  publishDesktopUpdateCheck,
  type DesktopUpdateState,
} from '../../../../packages/drawnix/src/utils/desktop-update-state';
import { fetchDesktopRelease } from './desktop-release';
import type { Update } from '@tauri-apps/plugin-updater';

let initialized = false;
let pendingCheck: Promise<void> | undefined;
let update: Update | null = null;
let available: DesktopUpdateState | undefined;
let busy = false;
let installed = false;
let downloaded = false;
let lastCheck = 0;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
// The native Update inherits check()'s timeout unless download() overrides it.
const DOWNLOAD_TIMEOUT = 30 * 60 * 1000;

function describeUpdateError(error: unknown, stage: string): string {
  // Tauri command failures can reject with a string instead of an Error instance.
  const detail = typeof error === 'string'
    ? error.trim()
    : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message.trim()
    : '';
  if (/read[- ]only|EROFS|只读/i.test(detail)) {
    return '应用所在位置为只读，无法安装更新。macOS 请先将应用拖入“应用程序”，从那里启动后重试；其他系统请安装到可写位置。';
  }
  if (/permission denied|access is denied|拒绝访问/i.test(detail)) {
    return '没有应用安装目录的写入权限，请安装到有权限的位置，或手动下载安装新版。';
  }
  return detail ? `${stage}：${detail}` : `${stage}，请重试或手动安装新版`;
}

async function install(): Promise<void> {
  if (pendingCheck) await pendingCheck;
  if (busy || !available) return;
  busy = true;
  let stage = '更新失败';
  try {
    if (available.downloadUrl) {
      stage = '下载页面打开失败';
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(available.downloadUrl);
      publishDesktopUpdate({ ...available, status: 'ready' });
      return;
    }
    if (!update) return;
    if (!installed && !downloaded) {
      stage = '更新包下载或校验失败';
      publishDesktopUpdate({ ...available, status: 'downloading' });
      let total: number | undefined;
      let received = 0;
      await update.download((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength;
          received = 0;
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength;
        } else if (event.event === 'Finished') {
          return;
        }
        publishDesktopUpdate({
          ...available!, status: 'downloading',
          progress: total ? Math.min(100, Math.floor(received / total * 100)) : undefined,
        });
      }, { timeout: DOWNLOAD_TIMEOUT });
      downloaded = true;
    }
    stage = installed ? '更新已安装，重启前准备失败' : '安装前准备失败';
    const prepare = window.__OPENTU_PREPARE_DESKTOP_UPDATE__;
    if (!prepare) throw new Error('画布尚未准备好，请稍后重试更新');
    await prepare();
    if (!installed) {
      stage = '更新安装失败';
      publishDesktopUpdate({ ...available, status: 'installing' });
      await update.install();
      installed = true;
      stage = '更新已安装，重启前准备失败';
      await prepare();
    }
    stage = '更新已安装，重启失败';
    publishDesktopUpdate({ ...available, status: 'restarting' });
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (error) {
    console.error('[Desktop Updater] 更新失败:', error);
    publishDesktopUpdate({ ...available, status: 'error', restartOnly: installed,
      errorMessage: describeUpdateError(error, stage) });
  } finally {
    busy = false;
  }
}

async function runCheck(): Promise<void> {
  publishDesktopUpdateCheck({ status: 'checking' });
  let candidate: Update | null = null;
  let signedCheckFailed = false;
  try {
    if (import.meta.env.VITE_OPENTU_SIGNED_UPDATER === 'true') {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        candidate = await check({ timeout: 15000 });
      } catch (error) {
        signedCheckFailed = true;
        console.info('[Desktop Updater] 签名更新检查失败，尝试发布信息:', error);
      }
    }
    let next: DesktopUpdateState | undefined;
    if (candidate) {
      next = { version: candidate.version, desktop: true, status: 'ready', changelog: candidate.body?.split(/\r?\n/).filter(Boolean) };
    } else {
      const version = document.querySelector('meta[name="app-version"]')?.getAttribute('content') || '0.0.0';
      const release = await fetchDesktopRelease(version);
      if (release) next = { ...release, desktop: true, status: 'ready', downloadUrl: DESKTOP_DOWNLOAD_PAGE };
      else if (signedCheckFailed) throw new Error('Signed update channel unavailable');
    }
    if (update) await update.close();
    update = candidate;
    downloaded = false;
    available = next;
    lastCheck = Date.now();
    window.__OPENTU_DESKTOP_UPDATER_ACTIVE__ = Boolean(candidate);
    if (next) publishDesktopUpdate(next);
    publishDesktopUpdateCheck({ status: next ? 'available' : 'current' });
  } catch (error) {
    console.info('[Desktop Updater] 暂时无法检查更新:', error);
    publishDesktopUpdateCheck({ status: 'error' });
  }
}

export function checkDesktopUpdates(): Promise<void> {
  if (!isTauriEnvironment() || busy || installed) return Promise.resolve();
  if (pendingCheck) return pendingCheck;
  pendingCheck = runCheck().finally(() => { pendingCheck = undefined; });
  return pendingCheck;
}

export function initializeDesktopUpdater(): Promise<void> {
  if (!isTauriEnvironment()) return Promise.resolve();
  if (initialized) return pendingCheck || Promise.resolve();
  initialized = true;
  window.__OPENTU_DESKTOP_UPDATER_ACTIVE__ = false;
  window.addEventListener('user-confirmed-upgrade', () => { void install(); });
  window.addEventListener('desktop-check-for-updates', () => { void checkDesktopUpdates(); });
  window.addEventListener('online', () => { void checkDesktopUpdates(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck >= CHECK_INTERVAL) void checkDesktopUpdates();
  });
  window.setInterval(() => { void checkDesktopUpdates(); }, CHECK_INTERVAL);
  return checkDesktopUpdates();
}
