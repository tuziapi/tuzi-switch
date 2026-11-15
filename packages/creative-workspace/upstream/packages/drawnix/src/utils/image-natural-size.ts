/**
 * 加载图片获取其自然尺寸（带超时机制）
 * @param url 图片 URL
 * @param fallbackWidth 加载失败时的回退宽度
 * @param fallbackHeight 加载失败时的回退高度
 * @param timeout 超时时间（毫秒），默认 5000ms
 */
export async function getImageNaturalSize(
  url: string,
  fallbackWidth: number,
  fallbackHeight: number,
  timeout = 5000
): Promise<{ width: number; height: number }> {
  const img = new Image();

  await Promise.race([
    new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = url;
    }),
    new Promise<void>((resolve) => setTimeout(resolve, timeout)),
  ]);

  const width = img.naturalWidth || fallbackWidth;
  const height = img.naturalHeight || fallbackHeight;

  return {
    width: width > 0 ? width : fallbackWidth,
    height: height > 0 ? height : fallbackHeight,
  };
}
