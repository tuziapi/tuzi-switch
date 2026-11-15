import {
  normalizeImageDataUrl,
  downloadFromBlob,
  base64ToBlob,
} from "@aitu/utils";
import { getAssistantAccount } from "../services/assistant-account";
import { unifiedCacheService } from "../services/unified-cache-service";
import { isVirtualMediaUrl } from "./virtual-media-url";
import { copyToClipboard } from "./runtime-helpers";

export type CanvasImageAction = "copy" | "save" | "reveal";

const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

/** Always use the original; a thumbnail is not a successful image export. */
export async function readCanvasImage(url: string): Promise<Blob> {
  const source = normalizeImageDataUrl(url);
  // Generated images can remain inline when persistence falls back to the
  // board. Decode them locally: production CSP permits data: for images but
  // deliberately not for fetch. Avoid using multi-MB data URLs as cache keys.
  if (/^data:image\/[^;,]+;base64,/i.test(source)) {
    const comma = source.indexOf(",");
    const payload = source.slice(comma + 1).replace(/\s/g, "");
    if (payload.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
      throw new Error("图片超过 64 MB。");
    let blob: Blob;
    try {
      blob = base64ToBlob(`${source.slice(0, comma + 1)}${payload}`);
    } catch {
      throw new Error(
        "原图数据损坏，无法读取，请从任务列表找回已有结果后重试。",
      );
    }
    if (!blob.size || blob.size > MAX_IMAGE_BYTES)
      throw new Error("图片为空或超过 64 MB。");
    return blob;
  }
  const cached = await unifiedCacheService.getCachedBlob(source, {
    allowNetwork: false,
  });
  if (cached?.size) {
    if (cached.size > 64 * 1024 * 1024) throw new Error("图片超过 64 MB。");
    return cached;
  }
  if (isVirtualMediaUrl(source)) {
    throw new Error("原图缓存暂不可用，请从任务列表找回已有结果后重试。");
  }
  if (!/^(https?:|blob:|data:image\/)/i.test(source)) {
    throw new Error("无法读取此图片来源。");
  }
  const response = await fetch(source, {
    referrerPolicy: "no-referrer",
    credentials: "omit",
  });
  if (!response.ok)
    throw new Error("原图读取失败，请检查网络或从任务列表找回已有结果。");
  const blob = await response.blob();
  if (!blob.size || blob.size > 64 * 1024 * 1024)
    throw new Error("图片为空或超过 64 MB。");
  return blob;
}

async function pngForClipboard(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 32 * 1024 * 1024)
      throw new Error("图片尺寸过大，无法复制。");
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法转换图片。");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error("图片转换失败。")),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function runCanvasImageAction(
  action: CanvasImageAction,
  url: string,
  name?: string,
) {
  const native = getAssistantAccount()?.imageAction;
  if (native) return native(action, await readCanvasImage(url), name);
  if (action === "reveal")
    throw new Error("请在兔子助手桌面客户端中显示图片文件。");
  if (action === "copy") {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("当前环境不支持复制图片，请使用另存为。");
    }
    // Start clipboard.write in the click gesture, before reading cached bytes.
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": readCanvasImage(url).then(pngForClipboard),
      }),
    ]);
    return "copied" as const;
  }
  const blob = await readCanvasImage(url);
  const ext =
    (
      {
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
      } as Record<string, string>
    )[blob.type] || "png";
  downloadFromBlob(blob, `opentu-image.${ext}`);
  return "download-started" as const;
}

export async function copyImagePrompt(prompt: string) {
  const native = getAssistantAccount()?.copyText;
  if (native) await native(prompt);
  else await copyToClipboard(prompt);
}
