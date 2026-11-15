import { isTauriEnvironment } from './tauri-api';
import { getAnalyticsReleaseContext } from '../../../../packages/drawnix/src/utils/umami-analytics';

const SCRIPT_ID = 'opentu-desktop-umami';
const BEFORE_SEND = '__OPENTU_DESKTOP_UMAMI_BEFORE_SEND__';

interface UmamiPayload extends Record<string, unknown> {
  data?: Record<string, unknown>;
}

declare global {
  interface Window {
    __OPENTU_DESKTOP_UMAMI_BEFORE_SEND__?: (
      type: string,
      payload: UmamiPayload
    ) => UmamiPayload;
  }
}

/** Normalize the native WebView URL so analytics never includes local paths. */
export function prepareDesktopAnalyticsPayload(
  _type: string,
  payload: UmamiPayload
): UmamiPayload {
  const context = getAnalyticsReleaseContext();
  return {
    ...payload,
    hostname: context.hostname,
    url: `https://${context.hostname}/desktop`,
    referrer: '',
    title: 'OpenTu Desktop',
    tag: 'desktop',
    data: { ...payload.data, ...context },
  };
}

/** Analytics is optional: a blocked SDK must never hold up application startup. */
export function initializeDesktopAnalytics(): void {
  if (
    !isTauriEnvironment() ||
    import.meta.env.DEV ||
    window.__OPENTU_DESKTOP_ANALYTICS_READY__
  ) {
    return;
  }

  window[BEFORE_SEND] = prepareDesktopAnalyticsPayload;
  window.__OPENTU_DESKTOP_ANALYTICS_READY__ = new Promise<void>((resolve) => {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = 'https://umami.tu-zi.com/script.js';
    script.async = true;
    script.dataset.websiteId = 'e6bd249e-bc68-4857-b6a5-02131b4ea286';
    script.dataset.beforeSend = BEFORE_SEND;
    script.dataset.tag = 'desktop';
    script.dataset.excludeSearch = 'true';
    script.dataset.excludeHash = 'true';
    // Count one visit per launch, rather than a pageview for every board change.
    script.dataset.autoTrack = 'false';

    const timeout = window.setTimeout(resolve, 8000);
    const finish = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    script.onload = () => {
      try {
        void Promise.resolve(window.umami?.track()).catch(() => undefined);
      } catch {
        // Keep SDK errors outside the application boot path.
      }
      finish();
    };
    script.onerror = finish;
    document.head.appendChild(script);
  });
}
