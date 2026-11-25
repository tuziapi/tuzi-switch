import type { CreativeAccountBridge } from "./bridge-types";

export const ECOMMERCE_IMAGE_TIMEOUT_MS = 10 * 60 * 1000;

/** Some output CDNs use application/octet-stream for valid MP4 files. */
export async function readEcommerceVideoResponse(
  response: Response,
): Promise<Blob> {
  if (!response.ok)
    throw new Error("视频下载失败，可继续获取原任务结果，无需重新生成。");
  const blob = await response.blob();
  const header = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const text = String.fromCharCode(...header);
  const mp4 =
    text.slice(4, 8) === "ftyp" &&
    !["avif", "avis", "heic", "heix", "mif1"].includes(text.slice(8, 12));
  const webm =
    header[0] === 0x1a &&
    header[1] === 0x45 &&
    header[2] === 0xdf &&
    header[3] === 0xa3;
  if (blob.size < 32 || (!mp4 && !webm))
    throw new Error(
      `下载内容不是可识别的 MP4/MOV/WebM 视频（${blob.type || "未声明类型"}，${blob.size} 字节），请核对原任务结果。`,
    );
  return blob.slice(0, blob.size, mp4 ? "video/mp4" : "video/webm");
}

/** Bound the complete operation, including preparation and result decoding. */
export function waitForEcommerceRequest<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function resolveEcommerceAccountReference(
  configuredKey: string | undefined,
  bridge: CreativeAccountBridge | undefined,
): Promise<string | undefined> {
  const key = configuredKey?.trim();
  // The chosen model's provider owns its credential. An unrelated account-page
  // selection must not replace a configured manual key or existing binding.
  if (key) {
    if (key.startsWith("tuzi-account:") && !bridge?.requestManual) {
      throw new Error(
        "账户模型需要桌面原生连接，请在兔子助手桌面版中生成；浏览器可使用手动配置的 API Key。",
      );
    }
    return undefined;
  }
  if (bridge?.selectedKeyId) {
    if (!bridge.requestManual) {
      throw new Error(
        "账户模型需要桌面原生连接，请在兔子助手桌面版中生成；浏览器可使用手动配置的 API Key。",
      );
    }
    const binding = await bridge.bindKey(bridge.selectedKeyId);
    return `tuzi-account:${binding.id}`;
  }
  throw new Error(
    "请先在创作配置中选择账户 API Key，或在当前模型供应商中配置 API Key。",
  );
}

export function readEcommerceImage(
  file: File,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const reader = new FileReader();
    const abort = () => {
      reader.abort();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    reader.onload = () => {
      cleanup();
      resolve(String(reader.result));
    };
    reader.onerror = () => {
      cleanup();
      reject(new Error(`读取图片失败：${file.name}`));
    };
    reader.onabort = () => {
      cleanup();
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    reader.readAsDataURL(file);
  });
}
