import { useEffect, useState } from 'react';
import { unifiedCacheService } from '../services/unified-cache-service';

const IMAGE_CACHE_NAME = 'drawnix-images';

const sizeCache = new Map<string, number>();
const pendingQueries = new Map<string, ((size: number | null) => void)[]>();

interface CachedSizeState {
  url: string;
  size: number | null;
}

async function processPendingQueries(): Promise<void> {
  if (pendingQueries.size === 0) return;

  const queries = new Map(pendingQueries);
  pendingQueries.clear();

  for (const [url, callbacks] of queries) {
    try {
      const size = await fetchSizeFromCache(url);
      if (size !== null) {
        sizeCache.set(url, size);
      }
      callbacks.forEach((cb) => cb(size));
    } catch {
      callbacks.forEach((cb) => cb(null));
    }
  }
}

async function fetchSizeFromCache(url: string): Promise<number | null> {
  try {
    const cacheInfo = await unifiedCacheService.getCacheInfo(url);
    if (cacheInfo.isCached && cacheInfo.size && cacheInfo.size > 0) {
      return cacheInfo.size;
    }

    if (typeof caches !== 'undefined') {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      const response = await cache.match(url);
      if (response) {
        const sizeHeader =
          response.headers.get('sw-video-size') ||
          response.headers.get('sw-image-size') ||
          response.headers.get('Content-Length');
        if (sizeHeader) {
          const size = parseInt(sizeHeader, 10);
          if (size > 0) {
            return size;
          }
        }

        return null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function getAssetSizeFromCache(
  url: string
): Promise<number | null> {
  if (sizeCache.has(url)) {
    return sizeCache.get(url)!;
  }

  const size = await fetchSizeFromCache(url);
  if (size !== null) {
    sizeCache.set(url, size);
  }
  return size;
}

export function useAssetSize(
  assetId: string | undefined,
  assetUrl: string | undefined,
  assetSize: number | undefined
): number | null {
  const [cachedSize, setCachedSize] = useState<CachedSizeState | null>(null);

  useEffect(() => {
    if (!assetId || !assetUrl) {
      setCachedSize(null);
      return;
    }

    if (assetSize && assetSize > 0) {
      return;
    }

    if (sizeCache.has(assetUrl)) {
      setCachedSize({ url: assetUrl, size: sizeCache.get(assetUrl)! });
      return;
    }

    setCachedSize((prev) => (prev?.url === assetUrl ? prev : null));

    let active = true;
    const handleSize = (size: number | null) => {
      if (active) {
        setCachedSize({ url: assetUrl, size });
      }
    };

    const callbacks = pendingQueries.get(assetUrl) || [];
    callbacks.push(handleSize);
    pendingQueries.set(assetUrl, callbacks);

    if (callbacks.length === 1) {
      if ('requestIdleCallback' in window) {
        (window as Window).requestIdleCallback(processPendingQueries, {
          timeout: 1000,
        });
      } else {
        setTimeout(processPendingQueries, 100);
      }
    }

    return () => {
      active = false;
      const currentCallbacks = pendingQueries.get(assetUrl);
      if (!currentCallbacks) {
        return;
      }

      const nextCallbacks = currentCallbacks.filter((cb) => cb !== handleSize);
      if (nextCallbacks.length > 0) {
        pendingQueries.set(assetUrl, nextCallbacks);
      } else {
        pendingQueries.delete(assetUrl);
      }
    };
  }, [assetId, assetUrl, assetSize]);

  if (assetSize && assetSize > 0) {
    return assetSize;
  }

  if (!assetUrl || cachedSize?.url !== assetUrl) {
    return null;
  }

  return cachedSize.size;
}
