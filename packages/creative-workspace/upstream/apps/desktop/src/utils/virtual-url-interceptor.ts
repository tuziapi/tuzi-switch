import { unifiedCacheService } from '../../../../packages/drawnix/src/services/unified-cache-service';

const ASSET_LIBRARY_URL_PREFIX = '/asset-library/';
const CACHE_URL_PREFIX = '/__aitu_cache__/';
const AI_GENERATED_URL_PREFIX = '/__aitu_generated__/';
const AI_GENERATED_AUDIO_URL_PREFIX = `${AI_GENERATED_URL_PREFIX}audio/`;
const MEDIA_ELEMENT_SELECTOR = 'img, video, audio, source';
const IMAGE_OBJECT_URL_REVOKE_DELAY_MS = 10000;
const MISSING_BLOB_RETRY_DELAY_MS = 5000;
const MAX_MISSING_BLOB_CACHE_SIZE = 256;

let isInitialized = false;
let fetchPatched = false;

type MediaAttribute = 'src' | 'poster';

interface ElementUrlState {
  objectUrls: Partial<Record<MediaAttribute, string>>;
  sourceUrls: Partial<Record<MediaAttribute, string>>;
  pendingUrls: Partial<Record<MediaAttribute, string>>;
  revokeTimers: Partial<Record<MediaAttribute, number>>;
}

const elementUrlStates = new WeakMap<Element, ElementUrlState>();
const pendingBlobReads = new Map<string, Promise<Blob | null>>();
const missingBlobUntil = new Map<string, number>();

function normalizeVirtualMediaUrl(url: string): string {
  if (!url) return url;
  try {
    return new URL(url, 'http://aitu.local').pathname;
  } catch {
    return url;
  }
}

function isVirtualMediaUrl(url: string): boolean {
  const normalized = normalizeVirtualMediaUrl(url);
  return (
    normalized.startsWith(ASSET_LIBRARY_URL_PREFIX) ||
    normalized.startsWith(CACHE_URL_PREFIX) ||
    normalized.startsWith(AI_GENERATED_AUDIO_URL_PREFIX)
  );
}

export function initializeVirtualUrlInterceptor(): void {
  if (isInitialized) return;
  isInitialized = true;

  patchFetchForVirtualMedia();
  scanVirtualMediaElements(document);

  const mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            scanVirtualMediaElements(node);
          }
        });
        mutation.removedNodes.forEach((node) => {
          if (node instanceof Element) {
            revokeElementObjectUrl(node);
          }
        });
        continue;
      }

      if (
        mutation.type === 'attributes' &&
        mutation.target instanceof Element
      ) {
        handleMediaElement(mutation.target);
      }
    }
  });

  mutationObserver.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'poster'],
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      scheduleFallbackScan();
    }
  });
}

function scheduleFallbackScan(): void {
  if (document.visibilityState === 'hidden') return;

  const requestIdle = (
    window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions
      ) => number;
    }
  ).requestIdleCallback;

  if (requestIdle) {
    requestIdle(() => scanVirtualMediaElements(document), { timeout: 1000 });
    return;
  }

  window.setTimeout(() => scanVirtualMediaElements(document), 0);
}

function patchFetchForVirtualMedia(): void {
  if (fetchPatched || typeof window.fetch !== 'function') return;
  fetchPatched = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
    const method =
      init?.method ||
      (input instanceof Request ? input.method : undefined) ||
      'GET';

    if (method.toUpperCase() === 'GET' && isVirtualMediaUrl(url)) {
      const blob = await getVirtualMediaBlob(url);
      if (blob) {
        return new Response(blob, {
          status: 200,
          headers: {
            'Content-Type': blob.type || 'application/octet-stream',
            'Content-Length': String(blob.size),
          },
        });
      }
    }

    return nativeFetch(input, init);
  };
}

function scanVirtualMediaElements(root: ParentNode): void {
  if (root instanceof Element) {
    handleMediaElement(root);
  }

  root
    .querySelectorAll(MEDIA_ELEMENT_SELECTOR)
    .forEach((element) => handleMediaElement(element));
}

function handleMediaElement(element: Element): void {
  if (
    !(
      element instanceof HTMLImageElement ||
      element instanceof HTMLVideoElement ||
      element instanceof HTMLAudioElement ||
      element instanceof HTMLSourceElement
    )
  ) {
    return;
  }

  const src = element.getAttribute('src') || '';
  const poster =
    element instanceof HTMLVideoElement
      ? element.getAttribute('poster') || ''
      : '';

  handleMediaAttribute(element, src, 'src');

  if (element instanceof HTMLVideoElement) {
    handleMediaAttribute(element, poster, 'poster');
  }
}

function handleMediaAttribute(
  element: HTMLImageElement | HTMLMediaElement | HTMLSourceElement,
  url: string,
  attribute: MediaAttribute
): void {
  const state = elementUrlStates.get(element);
  const objectUrl = state?.objectUrls[attribute];

  if (objectUrl && url === objectUrl) {
    return;
  }

  if (!url || !isVirtualMediaUrl(url)) {
    if (state?.sourceUrls[attribute] || objectUrl) {
      revokeElementObjectUrl(element, attribute);
    }
    return;
  }

  if (state?.sourceUrls[attribute] === url && objectUrl) {
    element.setAttribute(attribute, objectUrl);
    return;
  }

  if (
    state?.sourceUrls[attribute] === url ||
    state?.pendingUrls[attribute] === url
  ) {
    return;
  }

  void replaceElementUrl(element, url, attribute);
}

async function replaceElementUrl(
  element: HTMLImageElement | HTMLMediaElement | HTMLSourceElement,
  url: string,
  attribute: MediaAttribute
): Promise<void> {
  const state = getElementUrlState(element);
  state.pendingUrls[attribute] = url;

  try {
    const blob = await getVirtualMediaBlob(url);
    if (!blob) return;

    const currentUrl = element.getAttribute(attribute) || '';
    if (!element.isConnected || currentUrl !== url) {
      return;
    }

    revokeElementObjectUrl(element, attribute);

    const blobUrl = URL.createObjectURL(blob);
    state.objectUrls[attribute] = blobUrl;
    state.sourceUrls[attribute] = url;
    element.setAttribute(attribute, blobUrl);

    if (element instanceof HTMLImageElement) {
      const revokeLater = () => {
        clearRevokeTimer(state, attribute);
        state.revokeTimers[attribute] = window.setTimeout(
          () => revokeElementObjectUrl(element, attribute),
          IMAGE_OBJECT_URL_REVOKE_DELAY_MS
        );
      };
      element.addEventListener('load', revokeLater, { once: true });
      element.addEventListener(
        'error',
        () => revokeElementObjectUrl(element, attribute),
        { once: true }
      );
    } else if (element instanceof HTMLMediaElement) {
      element.load();
      element.addEventListener(
        'emptied',
        () => revokeElementObjectUrl(element, attribute),
        { once: true }
      );
      element.addEventListener(
        'error',
        () => revokeElementObjectUrl(element, attribute),
        { once: true }
      );
    }
  } finally {
    if (state.pendingUrls[attribute] === url) {
      delete state.pendingUrls[attribute];
    }
  }
}

function getVirtualMediaBlob(url: string): Promise<Blob | null> {
  const normalizedUrl = normalizeVirtualMediaUrl(url);
  const missingUntil = missingBlobUntil.get(normalizedUrl);
  if (missingUntil && missingUntil > Date.now()) {
    return Promise.resolve(null);
  }

  const pending = pendingBlobReads.get(normalizedUrl);
  if (pending) {
    return pending;
  }

  const request = unifiedCacheService
    .getCachedBlob(url)
    .then((blob) => {
      if (!blob) {
        rememberMissingBlob(normalizedUrl);
      } else {
        missingBlobUntil.delete(normalizedUrl);
      }
      return blob;
    })
    .finally(() => {
      pendingBlobReads.delete(normalizedUrl);
    });

  pendingBlobReads.set(normalizedUrl, request);
  return request;
}

function rememberMissingBlob(normalizedUrl: string): void {
  missingBlobUntil.set(normalizedUrl, Date.now() + MISSING_BLOB_RETRY_DELAY_MS);

  if (missingBlobUntil.size <= MAX_MISSING_BLOB_CACHE_SIZE) {
    return;
  }

  const firstKey = missingBlobUntil.keys().next().value as string | undefined;
  if (firstKey) {
    missingBlobUntil.delete(firstKey);
  }
}

function getElementUrlState(element: Element): ElementUrlState {
  let state = elementUrlStates.get(element);
  if (!state) {
    state = {
      objectUrls: {},
      sourceUrls: {},
      pendingUrls: {},
      revokeTimers: {},
    };
    elementUrlStates.set(element, state);
  }
  return state;
}

function clearRevokeTimer(
  state: ElementUrlState,
  attribute: MediaAttribute
): void {
  const timer = state.revokeTimers[attribute];
  if (timer) {
    window.clearTimeout(timer);
    delete state.revokeTimers[attribute];
  }
}

function revokeElementObjectUrl(
  element: Element,
  attribute?: MediaAttribute
): void {
  const state = elementUrlStates.get(element);
  if (!state) {
    revokeChildObjectUrls(element);
    return;
  }

  const attributes: MediaAttribute[] = attribute
    ? [attribute]
    : ['src', 'poster'];

  for (const currentAttribute of attributes) {
    clearRevokeTimer(state, currentAttribute);

    const objectUrl = state.objectUrls[currentAttribute];
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      delete state.objectUrls[currentAttribute];
    }

    delete state.sourceUrls[currentAttribute];
    delete state.pendingUrls[currentAttribute];
  }

  if (!attribute) {
    revokeChildObjectUrls(element);
  }
}

function revokeChildObjectUrls(element: Element): void {
  element
    .querySelectorAll?.(MEDIA_ELEMENT_SELECTOR)
    .forEach((child) => revokeElementObjectUrl(child));
}
