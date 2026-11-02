const LAZY_CHUNK_RETRY_KEY_PREFIX = 'aitu:lazy-chunk-retry';
const LAZY_CHUNK_RETRY_PARAM = '_lazy_chunk_retry';
const LAZY_CHUNK_RETRY_TS_PARAM = '_t';
const STATIC_CACHE_NAME_PREFIX = 'drawnix-static-v';
const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /Loading chunk [\w-]+ failed/i,
  /ChunkLoadError/i,
];

let lazyAssetRecoveryScheduled = false;

type ErrorLikeEvent = Event & {
  error?: unknown;
  reason?: unknown;
  payload?: unknown;
  message?: string;
};

function getAppVersion(): string {
  if (typeof document === 'undefined') {
    return 'unknown';
  }

  return (
    document
      .querySelector('meta[name="app-version"]')
      ?.getAttribute('content') || 'unknown'
  );
}

function getEventTargetAssetUrl(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const assetTarget = target as HTMLElement & {
    src?: string;
    currentSrc?: string;
    href?: string;
  };

  return assetTarget.currentSrc || assetTarget.src || assetTarget.href || null;
}

function serializeError(error: unknown, depth = 0): string {
  if (error instanceof Error) {
    const parts = [error.name, error.message, error.stack];
    const errorWithCause = error as Error & { cause?: unknown };
    if (errorWithCause.cause && depth < 2) {
      parts.push(serializeError(errorWithCause.cause, depth + 1));
    }
    return parts.filter(Boolean).join('\n');
  }

  if (typeof Event !== 'undefined' && error instanceof Event) {
    const event = error as ErrorLikeEvent;
    const parts = [`event:${event.type}`];
    const targetAssetUrl = getEventTargetAssetUrl(event.target);

    if (event.message) {
      parts.push(event.message);
    }
    if (targetAssetUrl) {
      parts.push(targetAssetUrl);
    }

    if (depth < 2) {
      [event.error, event.reason, event.payload].forEach((value) => {
        if (value && value !== error) {
          parts.push(serializeError(value, depth + 1));
        }
      });
    }

    return parts.filter(Boolean).join('\n');
  }

  return String(error ?? '');
}

function extractModuleKey(errorText: string): string {
  const matchedUrl = errorText.match(
    /https?:\/\/[^\s)'"]+\.(?:js|css)(?:\?[^\s)'"]*)?/i
  );
  if (!matchedUrl) {
    return 'unknown-module';
  }

  try {
    return new URL(matchedUrl[0]).pathname;
  } catch {
    return matchedUrl[0];
  }
}

function isRecoverableDynamicImportError(error: unknown): boolean {
  const errorText = serializeError(error);
  return DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) =>
    pattern.test(errorText)
  );
}

async function prepareDynamicImportRecoveryReload(
  moduleKey: string,
  errorText: string
): Promise<void> {
  const cleanupTasks: Promise<unknown>[] = [];

  try {
    navigator.serviceWorker?.controller?.postMessage({
      type: 'RECOVER_DYNAMIC_IMPORT_FAILURE',
      appVersion: getAppVersion(),
      moduleKey,
      error: errorText.slice(0, 500),
    });
  } catch {
    // Best-effort only. The reload path below still works without SW support.
  }

  if (typeof caches !== 'undefined') {
    cleanupTasks.push(
      caches
        .keys()
        .then((cacheNames) =>
          Promise.all(
            cacheNames
              .filter((name) => name.startsWith(STATIC_CACHE_NAME_PREFIX))
              .map((name) => caches.delete(name))
          )
        )
    );
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    cleanupTasks.push(
      navigator.serviceWorker
        .getRegistration()
        .then((registration) => registration?.update())
    );
  }

  await Promise.allSettled(cleanupTasks);
}

export function tryRecoverDynamicImportError(error: unknown): boolean {
  if (!isRecoverableDynamicImportError(error)) {
    return false;
  }

  if (lazyAssetRecoveryScheduled) {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  const errorText = serializeError(error);
  const moduleKey = extractModuleKey(errorText);
  const retryKey = `${LAZY_CHUNK_RETRY_KEY_PREFIX}:${getAppVersion()}:${moduleKey}`;

  try {
    if (sessionStorage.getItem(retryKey) === '1') {
      return false;
    }

    sessionStorage.setItem(retryKey, '1');
  } catch {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has(LAZY_CHUNK_RETRY_PARAM)) {
      return false;
    }
  }

  lazyAssetRecoveryScheduled = true;

  const reloadUrl = new URL(window.location.href);
  reloadUrl.searchParams.set(LAZY_CHUNK_RETRY_PARAM, '1');
  reloadUrl.searchParams.set(LAZY_CHUNK_RETRY_TS_PARAM, String(Date.now()));

  console.warn(
    '[ErrorBoundary] Detected stale lazy asset. Reloading once to recover.',
    error
  );

  let didReload = false;
  const reload = () => {
    if (didReload) {
      return;
    }
    didReload = true;
    window.location.replace(reloadUrl.toString());
  };

  window.setTimeout(reload, 700);
  void prepareDynamicImportRecoveryReload(moduleKey, errorText).finally(reload);

  return true;
}
