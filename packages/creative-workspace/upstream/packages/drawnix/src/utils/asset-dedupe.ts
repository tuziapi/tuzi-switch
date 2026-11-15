import type { Asset } from '../types/asset.types';
import { AssetSource } from '../types/asset.types';

const CONTENT_HASH_PATTERN = /(?:^|\/)content-([a-f0-9]{64})(?:-[^/.]+)?(?:\.[^/?#]+)?(?:[?#].*)?$/i;

export function normalizeAssetUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('/')) return url;

  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function extractContentHashFromUrl(url: string): string | undefined {
  const normalizedUrl = normalizeAssetUrl(url);
  const match = normalizedUrl.match(CONTENT_HASH_PATTERN);
  return match?.[1]?.toLowerCase();
}

export function getAssetContentHash(asset: Pick<Asset, 'contentHash' | 'url'>): string | undefined {
  return asset.contentHash?.toLowerCase() || extractContentHashFromUrl(asset.url);
}

export function getLocalAssetGroupKey(asset: Pick<Asset, 'source' | 'contentHash' | 'url'>): string | null {
  if (asset.source !== AssetSource.LOCAL) {
    return null;
  }

  const contentHash = getAssetContentHash(asset);
  if (contentHash) {
    return `content:${contentHash}`;
  }

  return `url:${normalizeAssetUrl(asset.url)}`;
}
