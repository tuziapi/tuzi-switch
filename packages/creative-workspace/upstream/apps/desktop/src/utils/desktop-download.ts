/**
 * 桌面端下载工具
 * 提供带保存位置选择的下载功能
 */

import { isTauriEnvironment, pickSaveLocation } from './tauri-api';
import { sanitizeFilename } from '@aitu/utils';
import { writeFile } from '@tauri-apps/plugin-fs';

/** 图片下载过滤器 */
const IMAGE_FILTERS = [
  { name: 'PNG 图片', extensions: ['png'] },
  { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] },
  { name: 'WebP 图片', extensions: ['webp'] },
  { name: '所有图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
];

/** 视频下载过滤器 */
const VIDEO_FILTERS = [
  { name: 'MP4 视频', extensions: ['mp4'] },
  { name: 'WebM 视频', extensions: ['webm'] },
  { name: '所有视频', extensions: ['mp4', 'webm'] },
];

/** 音频下载过滤器 */
const AUDIO_FILTERS = [
  { name: 'MP3 音频', extensions: ['mp3'] },
  { name: 'WAV 音频', extensions: ['wav'] },
  { name: '所有音频', extensions: ['mp3', 'wav'] },
];

/**
 * 获取文件扩展名
 */
function getExtensionFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const ext = pathname.split('.').pop()?.toLowerCase();
    return ext || 'png';
  } catch {
    return 'png';
  }
}

/**
 * 获取文件 MIME 类型对应的扩展名
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/mp3': 'mp3',
  };
  return mimeToExt[mimeType] || 'png';
}

async function invoke<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  return (window as any).__TAURI_INTERNALS__.invoke(command, args);
}

async function writeBytesToPath(
  savePath: string,
  bytes: Uint8Array
): Promise<void> {
  await writeFile(savePath, bytes);
}

async function saveUrlToPath(
  url: string,
  savePath: string,
  fallbackFetch: () => Promise<Uint8Array>
): Promise<void> {
  if (/^https?:\/\//i.test(url)) {
    try {
      await invoke<void>('download_url_to_path', {
        url,
        savePath,
      });
      return;
    } catch (error) {
      console.warn('[Desktop] 原生下载失败，回退到浏览器 fetch:', error);
    }
  }

  await writeBytesToPath(savePath, await fallbackFetch());
}

/**
 * 下载图片到用户选择的位置
 * @param imageUrl 图片 URL
 * @param defaultName 默认文件名（不含扩展名）
 * @param mimeType 可选的 MIME 类型
 * @returns 是否成功下载
 */
export async function downloadImageToCustomLocation(
  imageUrl: string,
  defaultName: string,
  mimeType?: string
): Promise<boolean> {
  if (!isTauriEnvironment()) {
    // 非桌面环境，使用浏览器默认下载
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `${sanitizeFilename(
      defaultName
    )}.${getExtensionFromMimeType(mimeType || '')}`;
    link.click();
    return true;
  }

  try {
    // 获取扩展名
    const ext = mimeType
      ? getExtensionFromMimeType(mimeType)
      : getExtensionFromUrl(imageUrl);
    const fileName = `${sanitizeFilename(defaultName)}.${ext}`;

    // 显示保存对话框
    const savePath = await pickSaveLocation(fileName, IMAGE_FILTERS);
    if (!savePath) {
      return false; // 用户取消
    }

    await saveUrlToPath(imageUrl, savePath, async () => {
      const response = await fetch(imageUrl, { referrerPolicy: 'no-referrer' });
      if (!response.ok) {
        throw new Error(`下载失败: ${response.status}`);
      }
      return new Uint8Array(await (await response.blob()).arrayBuffer());
    });

    return true;
  } catch (error) {
    console.error('[Desktop] 保存图片失败:', error);
    return false;
  }
}

/**
 * 下载视频到用户选择的位置
 * @param videoUrl 视频 URL
 * @param defaultName 默认文件名（不含扩展名）
 * @param mimeType 可选的 MIME 类型
 * @returns 是否成功下载
 */
export async function downloadVideoToCustomLocation(
  videoUrl: string,
  defaultName: string,
  mimeType?: string
): Promise<boolean> {
  if (!isTauriEnvironment()) {
    const link = document.createElement('a');
    link.href = videoUrl;
    link.download = `${sanitizeFilename(
      defaultName
    )}.${getExtensionFromMimeType(mimeType || 'video/mp4')}`;
    link.click();
    return true;
  }

  try {
    const ext = mimeType ? getExtensionFromMimeType(mimeType) : 'mp4';
    const fileName = `${sanitizeFilename(defaultName)}.${ext}`;

    const savePath = await pickSaveLocation(fileName, VIDEO_FILTERS);
    if (!savePath) {
      return false;
    }

    await saveUrlToPath(videoUrl, savePath, async () => {
      const response = await fetch(videoUrl, { referrerPolicy: 'no-referrer' });
      if (!response.ok) {
        throw new Error(`下载失败: ${response.status}`);
      }
      return new Uint8Array(await (await response.blob()).arrayBuffer());
    });

    return true;
  } catch (error) {
    console.error('[Desktop] 保存视频失败:', error);
    return false;
  }
}

/**
 * 下载音频到用户选择的位置
 * @param audioUrl 音频 URL
 * @param defaultName 默认文件名（不含扩展名）
 * @param mimeType 可选的 MIME 类型
 * @returns 是否成功下载
 */
export async function downloadAudioToCustomLocation(
  audioUrl: string,
  defaultName: string,
  mimeType?: string
): Promise<boolean> {
  if (!isTauriEnvironment()) {
    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = `${sanitizeFilename(
      defaultName
    )}.${getExtensionFromMimeType(mimeType || 'audio/mpeg')}`;
    link.click();
    return true;
  }

  try {
    const ext = mimeType ? getExtensionFromMimeType(mimeType) : 'mp3';
    const fileName = `${sanitizeFilename(defaultName)}.${ext}`;

    const savePath = await pickSaveLocation(fileName, AUDIO_FILTERS);
    if (!savePath) {
      return false;
    }

    await saveUrlToPath(audioUrl, savePath, async () => {
      const response = await fetch(audioUrl, { referrerPolicy: 'no-referrer' });
      if (!response.ok) {
        throw new Error(`下载失败: ${response.status}`);
      }
      return new Uint8Array(await (await response.blob()).arrayBuffer());
    });

    return true;
  } catch (error) {
    console.error('[Desktop] 保存音频失败:', error);
    return false;
  }
}
