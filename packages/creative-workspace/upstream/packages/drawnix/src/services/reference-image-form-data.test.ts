import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  native: vi.fn(),
  readNative: vi.fn(),
  readCache: vi.fn(),
  compress: vi.fn(),
  keepOriginal: vi.fn(),
}));
vi.mock('@aitu/utils', () => ({
  normalizeImageDataUrl: (value: string) => value,
  getFileExtension: () => 'png',
  compressImageBlob: mocks.compress,
}));
vi.mock('../utils/desktop-asset-url', () => ({
  isTauriEnvironment: mocks.native,
  isDesktopAssetUrl: (url: string) => url.startsWith('opentu-asset://'),
}));
vi.mock('./asset-storage-service', () => ({
  assetStorageService: { getDesktopAssetBlob: mocks.readNative },
}));
vi.mock('./unified-cache-service', () => ({
  unifiedCacheService: { getCachedBlob: mocks.readCache },
}));
vi.mock('./reference-image-settings', () => ({
  readKeepOriginalImageEnabled: mocks.keepOriginal,
}));
import { prepareReferenceImageForMultipart } from './reference-image-form-data';
import { imageInputToBlob } from './model-adapters/gpt-image-adapter';

const nativeSource = 'opentu-asset://localhost/%2Fnative%2Freference.png';
const cacheSource = '/__aitu_cache__/image/reference.png';
const MB = 1024 * 1024;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.native.mockReturnValue(true);
  mocks.keepOriginal.mockReturnValue(false);
  mocks.readNative.mockResolvedValue(new Blob(['original'], { type: 'image/png' }));
  mocks.readCache.mockResolvedValue(null);
  mocks.compress.mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' }));
});

describe('desktop multipart reference fidelity', () => {
  it('reads native bytes through native storage without a network fetch', async () => {
    const source = new Blob([new Uint8Array([137, 80, 78, 71, 0, 255])], { type: 'image/png' });
    mocks.readNative.mockResolvedValue(source);
    const fetcher = vi.fn();
    const result = await prepareReferenceImageForMultipart(nativeSource, { fetcher });
    expect(result.blob).toBe(source);
    expect(result.filename).toBe('reference.png');
    expect(mocks.readNative).toHaveBeenCalledWith(expect.objectContaining({ url: nativeSource }));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps virtual cached bytes original until the multipart compression decision', async () => {
    const source = new Blob([new Uint8Array(2 * MB)], { type: 'image/png' });
    mocks.readCache.mockResolvedValue(source);
    const fetcher = vi.fn();
    const result = await prepareReferenceImageForMultipart(cacheSource, { fetcher });
    expect(result.blob).toBe(source);
    expect(mocks.readCache).toHaveBeenCalledWith(cacheSource, { allowNetwork: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.compress).not.toHaveBeenCalled();
  });

  it('fails a missing virtual cache without attempting an external download', async () => {
    const fetcher = vi.fn();
    await expect(prepareReferenceImageForMultipart(cacheSource, { fetcher })).rejects.toThrow('本地图片缓存已失效');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([true, false])('honors keepOriginal=%s for large native references', async (enabled) => {
    const source = new Blob([new Uint8Array(11 * MB)], { type: 'image/png' });
    mocks.readNative.mockResolvedValue(source);
    mocks.keepOriginal.mockReturnValue(enabled);
    const result = await prepareReferenceImageForMultipart(nativeSource);
    if (enabled) {
      expect(result.blob).toBe(source);
      expect(mocks.compress).not.toHaveBeenCalled();
    } else {
      expect(mocks.compress).toHaveBeenCalledWith(source, 5);
      expect(result.blob.type).toBe('image/jpeg');
    }
  });

  it('preserves the mask Blob including alpha bytes even with ordinary compression enabled', async () => {
    const mask = new Blob([new Uint8Array(11 * MB)], { type: 'image/png' });
    mocks.readNative.mockResolvedValue(mask);
    const result = await imageInputToBlob(nativeSource, 'mask', vi.fn());
    expect(result.blob).toBe(mask);
    expect(mocks.compress).not.toHaveBeenCalled();
  });

  it('rejects oversized originals without compressing or submitting them', async () => {
    mocks.readNative.mockResolvedValue(new Blob([new Uint8Array(26 * MB)], { type: 'image/png' }));
    await expect(prepareReferenceImageForMultipart(nativeSource, { keepOriginal: true })).rejects.toThrow('25MB');
    expect(mocks.compress).not.toHaveBeenCalled();
  });

  it('does not read a cancelled reference and rejects cancellation while native loading completes', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Cancelled', 'AbortError'));
    await expect(prepareReferenceImageForMultipart(nativeSource, { signal: controller.signal })).rejects.toHaveProperty('name', 'AbortError');
    expect(mocks.readNative).not.toHaveBeenCalled();

    const active = new AbortController();
    mocks.readNative.mockImplementation(async () => {
      active.abort(new DOMException('Cancelled', 'AbortError'));
      return new Blob(['original'], { type: 'image/png' });
    });
    await expect(imageInputToBlob(nativeSource, 'reference', vi.fn(), active.signal)).rejects.toHaveProperty('name', 'AbortError');
  });
});
