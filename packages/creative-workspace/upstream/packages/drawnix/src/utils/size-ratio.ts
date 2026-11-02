/**
 * 从 size 参数（如 '16x9', '1x1'）解析为像素尺寸。
 * 基于默认宽度 400px 计算，并保持纵横比一致。
 */
export function parseSizeToPixels(
  size?: string,
  defaultWidth = 400
): { width: number; height: number } {
  if (!size) {
    return { width: defaultWidth, height: defaultWidth };
  }

  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return { width: defaultWidth, height: defaultWidth };
  }

  const ratioWidth = parseInt(match[1], 10);
  const ratioHeight = parseInt(match[2], 10);

  if (ratioWidth <= 0 || ratioHeight <= 0) {
    return { width: defaultWidth, height: defaultWidth };
  }

  return {
    width: defaultWidth,
    height: Math.round(defaultWidth * (ratioHeight / ratioWidth)),
  };
}
