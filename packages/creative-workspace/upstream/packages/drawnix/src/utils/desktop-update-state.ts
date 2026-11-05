export interface DesktopUpdateState {
  version: string;
  desktop: true;
  changelog?: string[];
  status: 'ready' | 'downloading' | 'installing' | 'restarting' | 'error';
  progress?: number;
  restartOnly?: boolean;
  downloadUrl?: string;
  errorMessage?: string;
}

export const DESKTOP_DOWNLOAD_PAGE = 'https://aiw520.github.io/opentuAI/download.html';

export interface DesktopUpdateCheckState {
  status: 'checking' | 'available' | 'current' | 'error';
}

declare global {
  interface Window {
    __OPENTU_DESKTOP_UPDATER_ACTIVE__?: boolean;
    __OPENTU_DESKTOP_UPDATE_EVENT__?: DesktopUpdateState;
    __OPENTU_DESKTOP_UPDATE_CHECK__?: DesktopUpdateCheckState;
    __OPENTU_PREPARE_DESKTOP_UPDATE__?: () => Promise<void>;
  }
}

export function publishDesktopUpdateCheck(state: DesktopUpdateCheckState): void {
  window.__OPENTU_DESKTOP_UPDATE_CHECK__ = state;
  if (state.status === 'current') delete window.__OPENTU_DESKTOP_UPDATE_EVENT__;
  window.dispatchEvent(new CustomEvent('desktop-update-check-state', { detail: state }));
}

export function publishDesktopUpdate(state: DesktopUpdateState): void {
  window.__OPENTU_DESKTOP_UPDATE_EVENT__ = state;
  window.dispatchEvent(
    new CustomEvent('sw-update-available', { detail: state })
  );
}
