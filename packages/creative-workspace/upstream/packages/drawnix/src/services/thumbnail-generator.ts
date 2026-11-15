/**
 * 视频缩略图生成器
 * 提供桌面环境下的视频缩略图生成功能
 */

export interface ThumbnailResult {
  success: boolean;
  thumbnailUrl?: string;
  error?: string;
}

export interface ThumbnailSizes {
  small?: string;
  large?: string;
}

/**
 * 在浏览器中生成视频缩略图
 * @param blob - 视频文件的 ArrayBuffer
 * @param mimeType - 视频 MIME 类型
 * @returns 缩略图的 base64 URL
 */
export async function generateVideoThumbnail(
  blob: ArrayBuffer,
  mimeType: string,
  maxSize: number = 200
): Promise<ThumbnailResult> {
  return new Promise((resolve) => {
    const videoBlob = new Blob([blob], { type: mimeType });
    const videoUrl = URL.createObjectURL(videoBlob);

    const video = document.createElement('video');
    video.src = videoUrl;
    video.crossOrigin = 'anonymous';
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      try {
        // 取视频中间帧作为缩略图
        video.currentTime = video.duration / 2;
      } catch {
        // 如果无法设置时间，取第一帧
        video.currentTime = 0;
      }
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;

        // 计算缩放比例以适应最大尺寸
        let width = videoWidth;
        let height = videoHeight;
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(videoUrl);
          resolve({ success: false, error: '无法创建 Canvas 上下文' });
          return;
        }

        ctx.drawImage(video, 0, 0, width, height);

        const thumbnailUrl = canvas.toDataURL('image/png');
        URL.revokeObjectURL(videoUrl);

        resolve({ success: true, thumbnailUrl });
      } catch (error) {
        URL.revokeObjectURL(videoUrl);
        resolve({ success: false, error: String(error) });
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(videoUrl);
      resolve({ success: false, error: '视频加载失败' });
    };

    video.onabort = () => {
      URL.revokeObjectURL(videoUrl);
      resolve({ success: false, error: '视频加载被中断' });
    };
  });
}

/**
 * 生成图片缩略图（缩放）
 * @param blob - 图片文件的 ArrayBuffer
 * @param mimeType - 图片 MIME 类型
 * @param maxSize - 最大尺寸
 * @returns 缩略图的 base64 URL
 */
export async function generateImageThumbnail(
  blob: ArrayBuffer,
  mimeType: string,
  maxSize: number = 200
): Promise<ThumbnailResult> {
  return new Promise((resolve) => {
    const imgBlob = new Blob([blob], { type: mimeType });
    const imgUrl = URL.createObjectURL(imgBlob);

    const img = document.createElement('img');
    img.src = imgUrl;
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const imgWidth = img.naturalWidth;
        const imgHeight = img.naturalHeight;

        // 计算缩放比例以适应最大尺寸
        let width = imgWidth;
        let height = imgHeight;
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(imgUrl);
          resolve({ success: false, error: '无法创建 Canvas 上下文' });
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        const thumbnailUrl = canvas.toDataURL('image/png');
        URL.revokeObjectURL(imgUrl);

        resolve({ success: true, thumbnailUrl });
      } catch (error) {
        URL.revokeObjectURL(imgUrl);
        resolve({ success: false, error: String(error) });
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(imgUrl);
      resolve({ success: false, error: '图片加载失败' });
    };
  });
}

/**
 * 生成多种尺寸的缩略图
 * @param blob - 文件的 ArrayBuffer
 * @param mimeType - 文件 MIME 类型
 * @param mediaType - 媒体类型
 * @param sizes - 需要生成的尺寸
 * @returns 不同尺寸的缩略图 URL
 */
export async function generateThumbnails(
  blob: ArrayBuffer,
  mimeType: string,
  mediaType: 'image' | 'video',
  sizes: ('small' | 'large')[] = ['small']
): Promise<ThumbnailSizes & { success: boolean; error?: string }> {
  const result: ThumbnailSizes = {};
  const sizeMap = {
    small: 128,
    large: 512,
  };

  for (const size of sizes) {
    const maxSize = sizeMap[size];
    const thumbnailFn = mediaType === 'video' ? generateVideoThumbnail : generateImageThumbnail;
    
    const thumbnailResult = await thumbnailFn(blob, mimeType, maxSize);
    if (!thumbnailResult.success) {
      return { success: false, error: thumbnailResult.error };
    }
    result[size] = thumbnailResult.thumbnailUrl;
  }

  return { success: true, ...result };
}