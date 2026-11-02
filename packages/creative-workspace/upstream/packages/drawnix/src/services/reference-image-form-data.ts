import {
  compressImageBlob,
  getFileExtension,
  normalizeImageDataUrl,
} from '@aitu/utils';
import { AssetType } from '../types/asset.types';
import {
  isDesktopAssetUrl,
  isTauriEnvironment,
} from '../utils/desktop-asset-url';
import { isVirtualMediaUrl } from '../utils/virtual-media-url';
import { assetStorageService } from './asset-storage-service';
import { unifiedCacheService } from './unified-cache-service';

const MB = 1024 * 1024;
const MAX_REFERENCE_IMAGE_BYTES = 25 * MB;
const COMPRESSION_THRESHOLD_BYTES = 10 * MB;
const COMPRESSION_TARGET_MB = 5;

interface PrepareReferenceImageOptions {
  filenamePrefix?: string;
  filename?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  maxBytes?: number;
}

interface PreparedReferenceImage {
  blob: Blob;
  filename: string;
}

function isLocalResolvableImage(value: string): boolean {
  return (
    value.startsWith('/__aitu_cache__/') || value.startsWith('/asset-library/')
  );
}

function decodeDataUrlToBlob(value: string): Blob | null {
  const match = value.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,([\s\S]*)$/i);
  if (!match) {
    return null;
  }

  const mimeType = (match[1] || 'image/png').toLowerCase();
  const payload = (match[2] || '').replace(/\s+/g, '');
  if (!payload) {
    throw new Error('引用图数据为空');
  }

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

function withImageMimeType(blob: Blob, source: string): Blob {
  if (blob.type?.startsWith('image/')) {
    return blob;
  }

  const extension = getFileExtension(source, blob.type);
  const inferredType =
    extension && extension !== 'bin' ? `image/${extension}` : 'image/png';
  return new Blob([blob], { type: inferredType });
}

function getReferenceFileName(
  blob: Blob,
  source: string,
  options: PrepareReferenceImageOptions
): string {
  if (options.filename) {
    return options.filename;
  }

  const prefix = options.filenamePrefix || 'reference';
  const extension =
    getFileExtension(source, blob.type) ||
    getFileExtension('', blob.type || 'image/png') ||
    'png';
  return `${prefix}.${extension === 'bin' ? 'png' : extension}`;
}

async function normalizeReferenceSource(value: string): Promise<string> {
  const trimmed = value.trim();
  if (!isLocalResolvableImage(trimmed)) {
    return trimmed;
  }

  const imageData = await unifiedCacheService.getImageForAI(trimmed);
  return imageData.value;
}

async function fetchReferenceBlob(
  source: string,
  fetcher: typeof fetch,
  signal?: AbortSignal
): Promise<Blob> {
  const response = await fetcher(source, {
    signal,
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) {
    throw new Error(`引用图读取失败: ${response.status} ${response.statusText}`);
  }
  return response.blob();
}

async function readDesktopReferenceBlob(source: string): Promise<Blob | null> {
  if (!isTauriEnvironment()) {
    return null;
  }

  if (isDesktopAssetUrl(source)) {
    return assetStorageService.getDesktopAssetBlob({
      url: source,
      filePath: undefined,
      mimeType: 'image/png',
      type: AssetType.IMAGE,
      name: 'reference.png',
    });
  }

  if (isVirtualMediaUrl(source)) {
    const imageData = await unifiedCacheService.getImageForAI(source);
    if (imageData.type === 'base64') {
      const match = imageData.value.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,([\s\S]*)$/i);
      if (match) {
        const mimeType = (match[1] || 'image/png').toLowerCase();
        const payload = (match[2] || '').replace(/\s+/g, '');
        const binary = atob(payload);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([bytes], { type: mimeType });
      }
    } else if (imageData.type === 'url') {
      return unifiedCacheService.getCachedBlob(source);
    }
  }

  return null;
}

async function normalizeReferenceBlob(
  blob: Blob,
  source: string,
  maxBytes: number
): Promise<Blob> {
  let normalized = withImageMimeType(blob, source);

  if (!normalized.type.startsWith('image/')) {
    throw new Error('引用素材不是图片文件');
  }

  if (normalized.size <= 0) {
    throw new Error('引用图数据为空');
  }

  if (normalized.size > maxBytes) {
    throw new Error('引用图超过 25MB，请先压缩后再使用');
  }

  if (normalized.size > COMPRESSION_THRESHOLD_BYTES) {
    try {
      normalized = await compressImageBlob(normalized, COMPRESSION_TARGET_MB);
    } catch (error) {
      throw new Error(
        `引用图超过 10MB 且压缩失败，请换一张更小的图片: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (normalized.size > COMPRESSION_THRESHOLD_BYTES) {
    throw new Error('引用图压缩后仍超过 10MB，请换一张更小的图片');
  }

  return normalized;
}

export async function prepareReferenceImageForMultipart(
  value: string,
  options: PrepareReferenceImageOptions = {}
): Promise<PreparedReferenceImage> {
  const maxBytes = options.maxBytes || MAX_REFERENCE_IMAGE_BYTES;
  const fetcher = options.fetcher || fetch;
  const source = await normalizeReferenceSource(value);
  const normalizedSource = normalizeImageDataUrl(source, 'image/png');
  let blob: Blob | null = decodeDataUrlToBlob(normalizedSource);

  if (!blob) {
    blob = await readDesktopReferenceBlob(normalizedSource);
  }

  if (!blob && isVirtualMediaUrl(normalizedSource)) {
    blob = await unifiedCacheService.getCachedBlob(normalizedSource);
  }

  if (!blob) {
    blob = await fetchReferenceBlob(normalizedSource, fetcher, options.signal);
  }

  const normalizedBlob = await normalizeReferenceBlob(
    blob,
    normalizedSource,
    maxBytes
  );

  return {
    blob: normalizedBlob,
    filename: getReferenceFileName(normalizedBlob, normalizedSource, options),
  };
}

export async function appendReferenceImageToFormData(
  formData: FormData,
  field: string,
  value: string,
  options: PrepareReferenceImageOptions = {}
): Promise<void> {
  const { blob, filename } = await prepareReferenceImageForMultipart(value, options);
  formData.append(field, blob, filename);
}
