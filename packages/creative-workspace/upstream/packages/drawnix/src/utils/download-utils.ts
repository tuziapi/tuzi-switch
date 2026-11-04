/**
 * Download Utilities
 *
 * Centralized download logic for images, videos, and other media files
 * Supports single file download and batch download as ZIP
 */

import {
  sanitizeFilename,
  isVolcesDomain,
  getFileExtension,
  downloadFromBlob,
  downloadFile,
  openInNewTab,
  processBatchWithConcurrency,
  normalizeImageDataUrl,
} from '@aitu/utils';
import type { Asset } from '../types/asset.types';
import { AssetType } from '../types/asset.types';
import type { Task } from '../types/task.types';
import { TaskType } from '../types/task.types';
import {
  applyAudioMetadataToBlob,
  type AudioDownloadMetadata,
} from './audio-id3';
import { isDesktopAssetUrl } from './desktop-asset-url';
import { isVirtualMediaUrl } from './virtual-media-url';
import { writeDesktopBinaryFile } from './desktop-binary-writer';
import { getAssistantAccount } from '../services/assistant-account';
import { runCanvasImageAction } from './canvas-image-actions';
import { unifiedCacheService } from '../services/unified-cache-service';

export interface SmartDownloadResult {
  openedCount: number;
  downloadedCount: number;
  failedCount: number;
}

function createDownloadResult(
  overrides: Partial<SmartDownloadResult> = {}
): SmartDownloadResult {
  return {
    openedCount: 0,
    downloadedCount: 0,
    failedCount: 0,
    ...overrides,
  };
}

function isCrossOriginUrl(url: string): boolean {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') {
    return /^https?:\/\//i.test(url);
  }

  try {
    const resolvedUrl = new URL(url, window.location.href);
    return resolvedUrl.origin !== window.location.origin;
  } catch {
    return false;
  }
}

function isLikelyFetchFailure(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch|Load failed|NetworkError/i.test(message);
}

function shouldOpenUrlOnDownloadFailure(url: string, error: unknown): boolean {
  if (isTauriEnvironment()) {
    return false;
  }
  return isCrossOriginUrl(url) && isLikelyFetchFailure(error);
}

function openUrlForDownload(url: string): SmartDownloadResult {
  openInNewTab(url);
  return createDownloadResult({ openedCount: 1 });
}

async function runSingleDownloadWithFallback(
  url: string,
  download: () => Promise<void>
): Promise<SmartDownloadResult> {
  try {
    await download();
    return createDownloadResult({ downloadedCount: 1 });
  } catch (error) {
    if (shouldOpenUrlOnDownloadFailure(url, error)) {
      return openUrlForDownload(url);
    }
    throw error;
  }
}

/**
 * Download a media file with auto-generated filename from prompt
 * For Volces (火山引擎) domains that don't support CORS, opens in new tab instead
 *
 * @param url - The URL of the media file
 * @param prompt - The prompt text to use for filename
 * @param format - File extension (e.g., 'png', 'mp4', 'webp')
 * @param fallbackName - Fallback name if prompt is empty
 * @param audioMetadata - Optional metadata for audio files
 * @param saveLocation - Optional custom save location (e.g., from Tauri save dialog)
 * @returns Promise that resolves when download is complete, or object with opened flag for new tab
 */
export async function downloadMediaFile(
  url: string,
  prompt: string,
  format: string,
  fallbackName = 'media',
  audioMetadata?: AudioDownloadMetadata,
  saveLocation?: string
): Promise<SmartDownloadResult> {
  const normalizedUrl = normalizeImageDataUrl(url);
  if (getAssistantAccount()?.imageAction && /^(png|jpe?g|webp|gif)$/i.test(format)) {
    const result = await runCanvasImageAction('save', normalizedUrl, `${sanitizeFilename(prompt) || fallbackName}.${format}`);
    return createDownloadResult({ downloadedCount: result === 'saved' ? 1 : 0 });
  }

  if (isTauriEnvironment()) {
    const type =
      fallbackName === 'video'
        ? 'video'
        : fallbackName === 'audio'
        ? 'audio'
        : 'image';
    const filename = `${sanitizeFilename(prompt) || fallbackName}.${format}`;
    const desktopPath = saveLocation || (await pickDesktopSavePath(filename));
    if (!desktopPath) {
      return createDownloadResult();
    }

    return runSingleDownloadWithFallback(normalizedUrl, async () => {
      await saveUrlToDesktopPath(normalizedUrl, desktopPath, {
        type,
        audioMetadata,
      });
    });
  }

  // For Volces domains (火山引擎), open in new tab due to CORS restrictions
  if (isVolcesDomain(normalizedUrl)) {
    return openUrlForDownload(normalizedUrl);
  }

  const sanitizedPrompt = sanitizeFilename(prompt);
  const filename = `${sanitizedPrompt || fallbackName}.${format}`;

  // 如果提供了自定义保存位置，使用该位置
  if (saveLocation) {
    return runSingleDownloadWithFallback(normalizedUrl, async () => {
      const response = await fetch(normalizedUrl, {
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${normalizedUrl}: ${response.status}`);
      }
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      // 调用外部提供的保存函数
      await saveToCustomLocation(saveLocation, new Uint8Array(arrayBuffer));
    });
  }

  if (fallbackName === 'audio') {
    return runSingleDownloadWithFallback(normalizedUrl, async () => {
      const response = await fetch(normalizedUrl, {
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${normalizedUrl}: ${response.status}`);
      }
      const sourceBlob = await response.blob();
      const blob = await applyAudioMetadataToBlob(
        sourceBlob,
        audioMetadata,
        normalizedUrl
      );
      downloadFromBlob(blob, filename);
    });
  }

  return runSingleDownloadWithFallback(normalizedUrl, async () =>
    downloadFile(normalizedUrl, filename)
  );
}

/**
 * 保存数据到自定义位置的函数类型
 */
export type SaveToLocationFn = (
  path: string,
  data: Uint8Array
) => Promise<void>;

// 默认实现：浏览器下载
let saveToCustomLocation: SaveToLocationFn = async (path, data) => {
  const blob = new Blob([data]);
  downloadFromBlob(blob, path.split('/').pop() || 'download');
};

function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TUZI_CREATIVE_NATIVE__;
}

function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  return (window as any).__TUZI_CREATIVE_NATIVE__.invoke(command, args);
}

async function pickDesktopSavePath(filename: string): Promise<string | null> {
  if (!isTauriEnvironment()) {
    return null;
  }

  return tauriInvoke<string | null>('pick_save_location', {
    defaultName: filename,
  });
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

async function downloadUrlToDesktopPath(
  url: string,
  path: string
): Promise<void> {
  await tauriInvoke<void>('download_url_to_path', {
    url,
    savePath: path,
  });
}

function isDesktopLocalMediaUrl(url: string): boolean {
  return isDesktopAssetUrl(url) || isVirtualMediaUrl(url);
}

async function copyMediaUrlToDesktopPath(
  url: string,
  path: string
): Promise<void> {
  await tauriInvoke<void>('copy_media_file_to_path', {
    source: url,
    savePath: path,
  });
}

async function writeBlobToDesktopPath(path: string, blob: Blob): Promise<void> {
  await writeDesktopBinaryFile(path, blob);
}

async function saveUrlToDesktopPath(
  url: string,
  path: string,
  options: {
    type: BatchDownloadItem['type'];
    audioMetadata?: AudioDownloadMetadata;
  }
): Promise<void> {
  if (
    isDesktopLocalMediaUrl(url) &&
    (options.type !== 'audio' || !options.audioMetadata)
  ) {
    try {
      await copyMediaUrlToDesktopPath(url, path);
      return;
    } catch (error) {
      console.warn(
        '[download-utils] Desktop local media copy failed, falling back:',
        error
      );
    }
  }

  if (options.type !== 'audio' && isHttpUrl(url)) {
    try {
      await downloadUrlToDesktopPath(url, path);
      return;
    } catch (error) {
      console.warn(
        '[download-utils] Desktop stream download failed, falling back to browser fetch:',
        error
      );
    }
  }

  try {
    const response = await fetch(url, { referrerPolicy: 'no-referrer' });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    const sourceBlob = await response.blob();
    const blob =
      options.type === 'audio'
        ? await applyAudioMetadataToBlob(sourceBlob, options.audioMetadata, url)
        : sourceBlob;
    await writeBlobToDesktopPath(path, blob);
  } catch (error) {
    if (isDesktopLocalMediaUrl(url)) {
      await copyMediaUrlToDesktopPath(url, path);
      return;
    }
    throw error;
  }
}

/**
 * 设置自定义保存函数（桌面环境调用）
 */
async function getSourceBlobForDownload(url: string): Promise<Blob> {
  try {
    const response = await fetch(url, { referrerPolicy: 'no-referrer' });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    return await response.blob();
  } catch (error) {
    if (isDesktopLocalMediaUrl(url)) {
      const { unifiedCacheService } = await import(
        '../services/unified-cache-service'
      );
      const cachedBlob = await unifiedCacheService.getCachedBlob(url);
      if (cachedBlob) {
        return cachedBlob;
      }
    }
    throw error;
  }
}

export function setSaveLocationFn(fn: SaveToLocationFn): void {
  saveToCustomLocation = fn;
}

export function buildDownloadFilename(
  baseName: string | undefined,
  fallbackName: string,
  extension: string,
  suffix?: string
): string {
  const normalizedBase = sanitizeFilename(baseName || '') || fallbackName;
  return `${normalizedBase}${suffix || ''}.${extension}`;
}

/**
 * 批量下载项接口
 */
export interface BatchDownloadItem {
  /** 文件 URL */
  url: string;
  /** 文件类型 */
  type: 'image' | 'video' | 'audio' | 'file';
  /** 可选文件名 */
  filename?: string;
  /** 音频下载时写入的元数据 */
  audioMetadata?: AudioDownloadMetadata;
  /** 自定义保存路径（桌面环境使用） */
  saveLocation?: string;
}

export type DownloadProgressCallback = (progress: number) => void;

function clampProgress(progress: number): number {
  return Math.min(100, Math.max(0, Math.round(progress)));
}

function reportProgress(
  onProgress?: DownloadProgressCallback,
  progress?: number
): void {
  if (onProgress === undefined || progress === undefined) {
    return;
  }
  onProgress(clampProgress(progress));
}

function buildAudioDownloadMetadata(options: {
  title?: string;
  prompt?: string;
  tags?: string;
  coverUrl?: string;
  artist?: string;
  album?: string;
}): AudioDownloadMetadata {
  return {
    title: options.title,
    prompt: options.prompt,
    tags: options.tags,
    coverUrl: options.coverUrl,
    artist: options.artist || 'Aitu',
    album: options.album || 'Aitu Generated',
  };
}

function getTypeFallbackExtension(type: BatchDownloadItem['type']): string {
  if (type === 'image') {
    return 'png';
  }
  if (type === 'video') {
    return 'mp4';
  }
  if (type === 'file') {
    return 'bin';
  }
  return 'mp3';
}

function readBlobHeader(blob: Blob, byteLength: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve(
        result instanceof ArrayBuffer
          ? new Uint8Array(result)
          : new Uint8Array()
      );
    };
    reader.onerror = () =>
      reject(reader.error || new Error('无法读取媒体文件头'));
    reader.readAsArrayBuffer(blob.slice(0, byteLength));
  });
}

async function sniffMediaExtension(
  blob: Blob,
  type: BatchDownloadItem['type'],
  sourceUrl: string
): Promise<string> {
  const normalizedMimeType = blob.type.toLowerCase().split(';')[0].trim();
  if (
    normalizedMimeType === 'text/html' ||
    normalizedMimeType === 'application/json'
  ) {
    throw new Error('下载地址返回的不是媒体文件');
  }

  const header = await readBlobHeader(blob, 16);
  if (
    header.length >= 8 &&
    header[4] === 0x66 &&
    header[5] === 0x74 &&
    header[6] === 0x79 &&
    header[7] === 0x70
  ) {
    return 'mp4';
  }
  if (
    header.length >= 4 &&
    header[0] === 0x1a &&
    header[1] === 0x45 &&
    header[2] === 0xdf &&
    header[3] === 0xa3
  ) {
    return 'webm';
  }
  if (
    header.length >= 4 &&
    header[0] === 0x4f &&
    header[1] === 0x67 &&
    header[2] === 0x67 &&
    header[3] === 0x53
  ) {
    return 'ogg';
  }

  const mimeExtension = getFileExtension('', normalizedMimeType);
  if (mimeExtension !== 'bin') {
    return mimeExtension;
  }

  return resolveDownloadExtension(
    sourceUrl,
    getTypeFallbackExtension(type)
  );
}

function replaceFilenameExtension(filename: string, extension: string): string {
  const dotIndex = filename.lastIndexOf('.');
  const baseName = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  return `${baseName}.${extension}`;
}

async function readDownloadBlob(item: BatchDownloadItem): Promise<Blob> {
  if (isVirtualMediaUrl(item.url)) {
    const cachedBlob = await unifiedCacheService.getCachedBlob(item.url);
    if (!cachedBlob?.size) {
      throw new Error('原图缓存暂不可用，请从任务列表找回已有结果后重试');
    }
    return cachedBlob;
  }

  const assetUrl =
    item.type === 'image' ? normalizeImageDataUrl(item.url) : item.url;
  const response = await fetch(assetUrl, { referrerPolicy: 'no-referrer' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${assetUrl}: ${response.status}`);
  }
  return response.blob();
}

function resolveDownloadExtension(
  primaryValue: string | undefined,
  fallbackExtension: string,
  secondaryValue?: string
): string {
  if (primaryValue && /^[a-z0-9]+$/i.test(primaryValue)) {
    return primaryValue.toLowerCase();
  }

  const primaryExtension = primaryValue
    ? getFileExtension(primaryValue)
    : 'bin';
  if (primaryExtension !== 'bin') {
    return primaryExtension;
  }

  const secondaryExtension = secondaryValue
    ? getFileExtension(secondaryValue)
    : 'bin';
  if (secondaryExtension !== 'bin') {
    return secondaryExtension;
  }

  return fallbackExtension;
}

function getUniqueFilename(
  filename: string,
  seenFilenames: Map<string, number>
): string {
  const count = seenFilenames.get(filename) || 0;
  seenFilenames.set(filename, count + 1);

  if (count === 0) {
    return filename;
  }

  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0) {
    return `${filename}_${count}`;
  }

  return `${filename.slice(0, dotIndex)}_${count}${filename.slice(dotIndex)}`;
}

export function buildAssetDownloadItem(
  asset: Pick<
    Asset,
    'url' | 'type' | 'name' | 'thumbnail' | 'prompt' | 'modelName'
  >
): BatchDownloadItem {
  const type =
    asset.type === AssetType.IMAGE
      ? 'image'
      : asset.type === AssetType.VIDEO
      ? 'video'
      : 'audio';
  const extension = resolveDownloadExtension(
    asset.name,
    getTypeFallbackExtension(type),
    asset.url
  );

  return {
    url: asset.url,
    type,
    filename: buildDownloadFilename(asset.name, type, extension),
    audioMetadata:
      type === 'audio'
        ? buildAudioDownloadMetadata({
            title: asset.name,
            prompt: asset.prompt,
            coverUrl: asset.thumbnail,
            artist: asset.modelName,
          })
        : undefined,
  };
}

export function buildAssetDownloadItems(
  assets: Array<
    Pick<Asset, 'url' | 'type' | 'name' | 'thumbnail' | 'prompt' | 'modelName'>
  >
): BatchDownloadItem[] {
  return assets.map(buildAssetDownloadItem);
}

export function buildTaskDownloadItems(
  task: Pick<Task, 'type' | 'params' | 'result'>
): BatchDownloadItem[] {
  if (!task.result?.url && !task.result?.urls?.length) {
    return [];
  }

  const type =
    task.type === TaskType.IMAGE
      ? 'image'
      : task.type === TaskType.VIDEO
      ? 'video'
      : 'audio';
  const urls = task.result.urls?.length ? task.result.urls : [task.result.url];

  return urls.map((url, index) => {
    const clip = task.result?.clips?.[index];
    const baseName =
      clip?.title ||
      task.result?.title ||
      task.params.title ||
      task.params.prompt;
    const extension = resolveDownloadExtension(
      task.result?.format,
      getTypeFallbackExtension(type),
      url
    );

    return {
      url,
      type,
      filename: buildDownloadFilename(
        baseName,
        type,
        extension,
        urls.length > 1 ? `-${index + 1}` : undefined
      ),
      audioMetadata:
        task.type === TaskType.AUDIO
          ? buildAudioDownloadMetadata({
              title: clip?.title || task.result?.title || task.params.title,
              prompt: task.params.prompt,
              tags:
                typeof task.params.tags === 'string'
                  ? task.params.tags
                  : undefined,
              coverUrl:
                clip?.imageLargeUrl ||
                clip?.imageUrl ||
                task.result?.previewImageUrl,
              artist: task.params.model || task.params.mv,
            })
          : undefined,
    };
  });
}

/**
 * 批量下载为 ZIP 文件
 * 使用并发限制避免同时发起过多网络请求
 *
 * @param items - 下载项数组
 * @param zipFilename - 可选的 ZIP 文件名
 * @returns Promise
 */
export async function downloadAsZip(
  items: BatchDownloadItem[],
  zipFilename?: string,
  onProgress?: DownloadProgressCallback,
  extraFiles?: Array<{ filename: string; content: Blob | string }>
): Promise<SmartDownloadResult> {
  if (items.length === 0) {
    throw new Error('No files to download');
  }

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const finalZipName = zipFilename || `aitu_download_${timestamp}.zip`;
  const isDesktop = isTauriEnvironment();
  const desktopZipPath = isDesktop
    ? await pickDesktopSavePath(finalZipName)
    : null;
  if (isDesktop && !desktopZipPath) {
    reportProgress(onProgress, 100);
    return createDownloadResult();
  }

  const seenFilenames = new Map<string, number>();
  let processedCount = 0;
  let addedCount = 0;

  reportProgress(onProgress, 0);

  // 添加文件到 ZIP 根目录（限制并发数为 3）
  await processBatchWithConcurrency(
    items,
    async (item, index) => {
      try {
        const assetUrl =
          item.type === 'image' ? normalizeImageDataUrl(item.url) : item.url;
        const sourceBlob = await readDownloadBlob(item);
        const blob =
          item.type === 'audio'
            ? await applyAudioMetadataToBlob(
                sourceBlob,
                item.audioMetadata,
                assetUrl
              )
            : sourceBlob;
        const ext = await sniffMediaExtension(blob, item.type, assetUrl);

        const prefix =
          item.type === 'image'
            ? 'image'
            : item.type === 'video'
            ? 'video'
            : item.type === 'file'
            ? 'file'
            : 'audio';
        const filename = getUniqueFilename(
          item.filename
            ? replaceFilenameExtension(item.filename, ext)
            : `${prefix}_${index + 1}.${ext}`,
          seenFilenames
        );

        zip.file(filename, blob);
        addedCount += 1;
      } catch (error) {
        console.error(`Failed to add file to zip:`, error);
      } finally {
        processedCount += 1;
        reportProgress(
          onProgress,
          items.length > 0 ? (processedCount / items.length) * 50 : 50
        );
      }
    },
    3 // 并发限制为 3
  );

  if (addedCount === 0) {
    throw new Error('No files available to download');
  }

  extraFiles?.forEach(({ filename, content }) => {
    zip.file(filename, content);
  });

  // 生成 ZIP 并下载
  const content = await zip.generateAsync({ type: 'blob' }, (metadata) => {
    reportProgress(onProgress, 50 + metadata.percent / 2);
  });
  if (desktopZipPath) {
    await writeBlobToDesktopPath(desktopZipPath, content);
  } else {
    downloadFromBlob(content, finalZipName);
  }
  reportProgress(onProgress, 100);
  return createDownloadResult({
    downloadedCount: addedCount,
    failedCount: items.length - addedCount,
  });
}

/**
 * 智能下载：单个直接下载，多个打包为 ZIP
 *
 * @param items - 下载项数组
 * @param zipFilename - 可选的 ZIP 文件名（仅在多文件时使用）
 * @returns Promise
 */
export async function smartDownload(
  items: BatchDownloadItem[],
  zipFilename?: string,
  onProgress?: DownloadProgressCallback
): Promise<SmartDownloadResult> {
  if (items.length === 0) {
    throw new Error('No files to download');
  }

  if (items.length === 1) {
    const item = items[0];
    const assetUrl =
      item.type === 'image' ? normalizeImageDataUrl(item.url) : item.url;

    if (item.type === 'image' && getAssistantAccount()?.imageAction) {
      const result = await runCanvasImageAction('save', assetUrl, item.filename);
      reportProgress(onProgress, 100);
      return createDownloadResult({ downloadedCount: result === 'saved' ? 1 : 0 });
    }

    // 如果有自定义保存路径，使用该路径
    if (item.saveLocation) {
      const saveLocation = item.saveLocation;
      const result = await runSingleDownloadWithFallback(assetUrl, async () => {
        if (isTauriEnvironment()) {
          await saveUrlToDesktopPath(assetUrl, saveLocation, {
            type: item.type,
            audioMetadata: item.audioMetadata,
          });
          return;
        }

        const sourceBlob = await getSourceBlobForDownload(assetUrl);
        const blob =
          item.type === 'audio'
            ? await applyAudioMetadataToBlob(
                sourceBlob,
                item.audioMetadata,
                assetUrl
              )
            : sourceBlob;
        const arrayBuffer = await blob.arrayBuffer();
        await saveToCustomLocation(saveLocation, new Uint8Array(arrayBuffer));
      });
      reportProgress(onProgress, 100);
      return result;
    }

    if (isTauriEnvironment()) {
      const ext =
        getFileExtension(assetUrl) || getTypeFallbackExtension(item.type);
      const filename = item.filename || `${item.type}_download.${ext}`;
      const desktopPath = await pickDesktopSavePath(filename);
      if (!desktopPath) {
        reportProgress(onProgress, 100);
        return createDownloadResult();
      }
      if (desktopPath) {
        const result = await runSingleDownloadWithFallback(
          assetUrl,
          async () => {
            await saveUrlToDesktopPath(assetUrl, desktopPath, {
              type: item.type,
              audioMetadata: item.audioMetadata,
            });
          }
        );
        reportProgress(onProgress, 100);
        return result;
      }
    }
    if (item.type === 'audio') {
      const result = await runSingleDownloadWithFallback(assetUrl, async () => {
        const response = await fetch(assetUrl, {
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch ${assetUrl}: ${response.status}`);
        }
        const sourceBlob = await response.blob();
        const blob = await applyAudioMetadataToBlob(
          sourceBlob,
          item.audioMetadata,
          assetUrl
        );
        const ext = getFileExtension(assetUrl, blob.type) || 'mp3';
        const filename = item.filename || `${item.type}_download.${ext}`;
        downloadFromBlob(blob, filename);
      });
      reportProgress(onProgress, 100);
      return result;
    }

    if (item.type === 'video' || isVirtualMediaUrl(assetUrl)) {
      const result = await runSingleDownloadWithFallback(assetUrl, async () => {
        const sourceBlob = await readDownloadBlob(item);
        const ext = await sniffMediaExtension(sourceBlob, item.type, assetUrl);
        const filename = replaceFilenameExtension(
          item.filename || `${item.type}_download.${ext}`,
          ext
        );
        downloadFromBlob(sourceBlob, filename);
      });
      reportProgress(onProgress, 100);
      return result;
    }

    // Use getFileExtension to detect correct extension (handles SVG, PNG, etc.)
    const ext =
      getFileExtension(assetUrl) || getTypeFallbackExtension(item.type);
    const filename = item.filename || `${item.type}_download.${ext}`;
    const result = await runSingleDownloadWithFallback(assetUrl, async () =>
      downloadFile(assetUrl, filename)
    );
    reportProgress(onProgress, 100);
    return result;
  } else {
    return downloadAsZip(items, zipFilename, onProgress);
  }
}
