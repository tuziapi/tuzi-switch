export type IdlePrefetchGroup =
  | 'ai-chat'
  | 'tool-windows'
  | 'diagram-engines'
  | 'office-data'
  | 'editor-engines'
  | 'media-viewer'
  | 'external-skills'
  | 'runtime-static-assets'
  | 'offline-static-assets';

interface IdlePrefetchMessage {
  type: 'SW_PREFETCH_GROUPS';
  groups: IdlePrefetchGroup[];
}

const requestedGroups = new Set<IdlePrefetchGroup>();
const MAX_IDLE_PREFETCH_POST_ATTEMPTS = 4;
const IDLE_PREFETCH_RETRY_DELAY_MS = 1000;

function logStartupPrefetch(message: string, detail?: unknown): void {
  if (detail === undefined) {
    return;
  }
}

function releaseRequestedGroups(groups: IdlePrefetchGroup[]): void {
  groups.forEach((group) => requestedGroups.delete(group));
}

function canUseConnectionForPrefetch(): boolean {
  const connection =
    typeof navigator !== 'undefined'
      ? (
          navigator as Navigator & {
            connection?: { saveData?: boolean; effectiveType?: string };
          }
        ).connection
      : undefined;

  if (!connection) {
    return true;
  }

  if (connection.saveData) {
    return false;
  }

  return (
    connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g'
  );
}

export function requestServiceWorkerIdlePrefetch(
  groups: IdlePrefetchGroup[]
): void {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    groups.length === 0 ||
    !canUseConnectionForPrefetch()
  ) {
    logStartupPrefetch('skip idle prefetch request', {
      hasWindow: typeof window !== 'undefined',
      hasServiceWorker:
        typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      groupCount: groups.length,
      canUseConnection: canUseConnectionForPrefetch(),
    });
    return;
  }

  const pendingGroups = groups.filter((group) => {
    if (requestedGroups.has(group)) {
      return false;
    }
    requestedGroups.add(group);
    return true;
  });

  if (pendingGroups.length === 0) {
    logStartupPrefetch(
      'skip idle prefetch request: all groups already requested',
      {
        groups,
      }
    );
    return;
  }

  const message: IdlePrefetchMessage = {
    type: 'SW_PREFETCH_GROUPS',
    groups: pendingGroups,
  };

  const postMessage = (attempt = 1) => {
    const controller = navigator.serviceWorker.controller;
    if (controller) {
      controller.postMessage(message);
      logStartupPrefetch('posted idle prefetch request via controller', {
        groups: pendingGroups,
        attempt,
      });
      return;
    }

    navigator.serviceWorker.ready
      .then((registration) => {
        if (registration.active) {
          registration.active.postMessage(message);
          logStartupPrefetch(
            'posted idle prefetch request via registration.active',
            {
              groups: pendingGroups,
              attempt,
            }
          );
          return;
        }

        if (attempt >= MAX_IDLE_PREFETCH_POST_ATTEMPTS) {
          releaseRequestedGroups(pendingGroups);
          console.warn(
            '[StartupPrefetch] idle prefetch request dropped: no active service worker',
            {
              groups: pendingGroups,
              attempt,
            }
          );
          return;
        }

        logStartupPrefetch(
          'retry idle prefetch request: no active service worker yet',
          {
            groups: pendingGroups,
            attempt,
            retryDelayMs: IDLE_PREFETCH_RETRY_DELAY_MS,
          }
        );
        window.setTimeout(
          () => postMessage(attempt + 1),
          IDLE_PREFETCH_RETRY_DELAY_MS
        );
      })
      .catch((error) => {
        if (attempt >= MAX_IDLE_PREFETCH_POST_ATTEMPTS) {
          releaseRequestedGroups(pendingGroups);
          console.warn(
            '[StartupPrefetch] idle prefetch request failed after retries',
            {
              groups: pendingGroups,
              attempt,
              error,
            }
          );
          return;
        }

        logStartupPrefetch(
          'retry idle prefetch request after navigator.serviceWorker.ready failure',
          {
            groups: pendingGroups,
            attempt,
            retryDelayMs: IDLE_PREFETCH_RETRY_DELAY_MS,
          }
        );
        window.setTimeout(
          () => postMessage(attempt + 1),
          IDLE_PREFETCH_RETRY_DELAY_MS
        );
      });
  };

  const idleCallback = (
    window as Window & {
      requestIdleCallback?: (
        callback: (deadline: IdleDeadline) => void,
        options?: { timeout: number }
      ) => number;
    }
  ).requestIdleCallback;

  if (typeof idleCallback === 'function') {
    logStartupPrefetch('queue idle prefetch request with requestIdleCallback', {
      groups: pendingGroups,
    });
    idleCallback(() => postMessage(), { timeout: 1500 });
  } else {
    logStartupPrefetch('queue idle prefetch request with setTimeout fallback', {
      groups: pendingGroups,
    });
    window.setTimeout(postMessage, 400);
  }
}
