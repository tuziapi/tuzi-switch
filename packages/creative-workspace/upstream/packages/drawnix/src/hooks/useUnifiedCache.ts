/**
 * useUnifiedCache Hook
 *
 * React hook for unified cache management
 * Provides easy access to cache operations and status
 */

import { useState, useEffect, useCallback } from 'react';
import { unifiedCacheService, type CacheInfo, type StorageUsage } from '../services/unified-cache-service';

const CACHE_INFO_TTL_MS = 30 * 1000;
const EMPTY_CACHE_INFO: CacheInfo = { isCached: false };

const cacheInfoMemory = new Map<
  string,
  {
    info: CacheInfo;
    updatedAt: number;
  }
>();
const pendingCacheInfoLoads = new Map<string, Promise<CacheInfo>>();

function setCacheInfoMemory(url: string, info: CacheInfo): void {
  cacheInfoMemory.set(url, {
    info,
    updatedAt: Date.now(),
  });
}

async function loadCacheInfoWithMemory(
  url: string,
  force = false
): Promise<CacheInfo> {
  const cached = cacheInfoMemory.get(url);
  if (!force && cached && Date.now() - cached.updatedAt < CACHE_INFO_TTL_MS) {
    return cached.info;
  }

  const pending = pendingCacheInfoLoads.get(url);
  if (pending) {
    return pending;
  }

  const promise = unifiedCacheService
    .getCacheInfo(url)
    .then((info) => {
      setCacheInfoMemory(url, info);
      return info;
    })
    .catch((error) => {
      console.error('[useUnifiedCache] Failed to load cache info:', error);
      return EMPTY_CACHE_INFO;
    })
    .finally(() => {
      pendingCacheInfoLoads.delete(url);
    });

  pendingCacheInfoLoads.set(url, promise);
  return promise;
}

/**
 * Hook for managing cache of a specific URL
 */
export function useUnifiedCache(url: string | undefined) {
  const [cacheInfo, setCacheInfo] = useState<CacheInfo>({ isCached: false });
  const [isLoading, setIsLoading] = useState(false);

  // Load cache info
  const loadCacheInfo = useCallback(async (force = false) => {
    if (!url) {
      setCacheInfo(EMPTY_CACHE_INFO);
      return;
    }

    const info = await loadCacheInfoWithMemory(url, force);
    setCacheInfo(info);
  }, [url]);

  // Initial load
  useEffect(() => {
    let mounted = true;

    if (!url) {
      setCacheInfo(EMPTY_CACHE_INFO);
      return () => {
        mounted = false;
      };
    }

    void loadCacheInfoWithMemory(url).then((info) => {
      if (mounted) {
        setCacheInfo(info);
      }
    });

    return () => {
      mounted = false;
    };
  }, [url]);

  // Subscribe to cache changes
  useEffect(() => {
    if (!url) {
      return undefined;
    }

    const unsubscribe = unifiedCacheService.subscribe(() => {
      void loadCacheInfo(true);
    });
    return unsubscribe;
  }, [loadCacheInfo, url]);

  // Cache image manually
  const cacheImage = useCallback(async (metadata?: any) => {
    if (!url) return false;

    setIsLoading(true);
    try {
      const success = await unifiedCacheService.cacheImage(url, metadata);
      if (success) {
        await loadCacheInfo(true);
      }
      return success;
    } catch (error) {
      console.error('[useUnifiedCache] Failed to cache image:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [url, loadCacheInfo]);

  // Delete cache
  const deleteCache = useCallback(async () => {
    if (!url) return false;

    setIsLoading(true);
    try {
      await unifiedCacheService.deleteCache(url);
      await loadCacheInfo(true);
      return true;
    } catch (error) {
      console.error('[useUnifiedCache] Failed to delete cache:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [url, loadCacheInfo]);

  return {
    cacheInfo,
    isLoading,
    isCached: cacheInfo.isCached,
    cacheWarning: cacheInfo.cacheWarning,
    cacheAge: cacheInfo.age,
    cacheImage,
    deleteCache,
    reload: loadCacheInfo,
  };
}

/**
 * Hook for overall cache statistics
 */
export function useCacheStats() {
  const [stats, setStats] = useState<{
    totalCount: number;
    storageUsage: StorageUsage;
  }>({
    totalCount: 0,
    storageUsage: { usage: 0, quota: 0, percentage: 0 },
  });
  const [isLoading, setIsLoading] = useState(true);

  const loadStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const [urls, usage] = await Promise.all([
        unifiedCacheService.getAllCachedUrls(),
        unifiedCacheService.getStorageUsage(),
      ]);

      setStats({
        totalCount: urls.length,
        storageUsage: usage,
      });
    } catch (error) {
      console.error('[useCacheStats] Failed to load stats:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Subscribe to cache changes
  useEffect(() => {
    const unsubscribe = unifiedCacheService.subscribe(() => {
      loadStats();
    });
    return unsubscribe;
  }, [loadStats]);

  return {
    ...stats,
    isLoading,
    reload: loadStats,
    formatSize: unifiedCacheService.formatSize.bind(unifiedCacheService),
  };
}

/**
 * Hook for cache quota monitoring
 */
export function useCacheQuotaMonitor(onQuotaExceeded?: () => void) {
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);

  useEffect(() => {
    const handleQuotaExceeded = () => {
      setIsQuotaExceeded(true);
      onQuotaExceeded?.();
    };

    const unsubscribe = unifiedCacheService.onQuotaExceeded(handleQuotaExceeded);
    return unsubscribe;
  }, [onQuotaExceeded]);

  const resetQuotaFlag = useCallback(() => {
    setIsQuotaExceeded(false);
  }, []);

  return {
    isQuotaExceeded,
    resetQuotaFlag,
  };
}
