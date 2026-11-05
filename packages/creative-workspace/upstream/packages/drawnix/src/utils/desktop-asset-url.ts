import type { Asset } from '../types/asset.types';

export const OPENTU_ASSET_PROTOCOL = 'opentu-asset';

export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TUZI_CREATIVE_NATIVE__;
}

function shouldUseHttpAssetProtocol(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  // Windows exposes Tauri custom protocols as http://<scheme>.localhost.
  // Do not use HTTP on every platform until the runtime owns a loopback server.
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ||
    navigator.platform ||
    '';
  return /win/i.test(platform) || /windows/i.test(navigator.userAgent);
}

export function convertLocalFilePathToAssetUrl(filePath: string): string {
  if (isTauriEnvironment()) {
    const encodedPath = encodeURIComponent(filePath);
    if (shouldUseHttpAssetProtocol()) {
      return `http://${OPENTU_ASSET_PROTOCOL}.localhost/${encodedPath}`;
    }
    return `${OPENTU_ASSET_PROTOCOL}://localhost/${encodedPath}`;
  }

  return `file://${filePath.replace(/\\/g, '/')}`;
}

export function isDesktopAssetUrl(url: string | undefined | null): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url, window.location.origin);
    return (
      parsed.protocol === `${OPENTU_ASSET_PROTOCOL}:` ||
      parsed.hostname === `${OPENTU_ASSET_PROTOCOL}.localhost`
    );
  } catch {
    return url.startsWith(`${OPENTU_ASSET_PROTOCOL}:`);
  }
}

export function getAssetRuntimeUrl(
  asset: Pick<Asset, 'url' | 'filePath'>
): string {
  if (asset.filePath && isTauriEnvironment()) {
    return convertLocalFilePathToAssetUrl(asset.filePath);
  }

  return asset.url;
}

export function getNativeFilePath(file: Blob): string | undefined {
  const path = (file as unknown as { path?: unknown }).path;
  return typeof path === 'string' && path.trim() ? path : undefined;
}

export function getFileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || `asset-${Date.now()}`;
}
