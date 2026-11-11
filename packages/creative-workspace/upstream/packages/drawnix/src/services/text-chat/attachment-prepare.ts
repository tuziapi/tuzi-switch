import { generateUUID } from "../../utils/runtime-helpers";
import {
  ATTACHMENT_LIMITS,
  attachmentFileKind,
  type TextAttachmentRecord,
} from "./attachments";

function dataUrl(blob: Blob, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => {
      reader.abort();
      reject(new DOMException("已取消", "AbortError"));
    };
    signal.throwIfAborted();
    signal.addEventListener("abort", abort, { once: true });
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取附件失败，请重新添加。"));
    reader.onloadend = () => signal.removeEventListener("abort", abort);
    reader.readAsDataURL(blob);
  });
}
async function prepareImage(
  file: File,
  signal: AbortSignal,
): Promise<{ dataUrl: string; thumbnailDataUrl: string }> {
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        image.src = "";
        reject(new DOMException("已取消", "AbortError"));
      };
      signal.throwIfAborted();
      signal.addEventListener("abort", abort, { once: true });
      const done = () => signal.removeEventListener("abort", abort);
      image.onload = () => {
        done();
        resolve();
      };
      image.onerror = () => {
        done();
        reject(new Error("图片无法解码，请使用有效的 PNG/JPEG/WebP 图片。"));
      };
      image.src = url;
    });
    signal.throwIfAborted();
    if (
      !image.naturalWidth ||
      image.naturalWidth * image.naturalHeight > 48000000
    )
      throw new Error("图片分辨率过大，请先缩小到 4800 万像素以内。");
    const scale = Math.min(
      1,
      2048 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法处理图片，请重试。");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("图片压缩失败。"))),
        "image/jpeg",
        0.86,
      ),
    );
    const thumbScale = Math.min(
      1,
      160 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    canvas.width = Math.max(1, Math.round(image.naturalWidth * thumbScale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * thumbScale));
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const thumbnailDataUrl = canvas.toDataURL("image/jpeg", 0.7);
    canvas.width = canvas.height = 0;
    if (blob.size > 2 * 1024 ** 2)
      throw new Error("图片压缩后仍超过 2 MB，请缩小后添加。");
    signal.throwIfAborted();
    return { dataUrl: await dataUrl(blob, signal), thumbnailDataUrl };
  } finally {
    image.src = "";
    URL.revokeObjectURL(url);
  }
}
export async function prepareTextAttachment(
  file: File,
  sessionId: string,
  signal: AbortSignal,
): Promise<TextAttachmentRecord> {
  signal.throwIfAborted();
  const kind = attachmentFileKind(file);
  const ref = {
    id: generateUUID(),
    name: file.name.split(/[\\/]/).pop()!.slice(0, 200),
    kind: kind === "image" ? ("image" as const) : ("document" as const),
    mimeType:
      kind === "image"
        ? "image/jpeg"
        : kind === "pdf"
          ? "application/pdf"
          : "text/plain",
    size: file.size,
  };
  if (kind === "image")
    return { ref, sessionId, ...(await prepareImage(file, signal)) };
  let text: string, pages: number | undefined, warning: string | undefined;
  if (kind === "pdf") {
    const parser = await import("./attachment-pdf");
    ({ text, pages, warning } = await parser.extractPdfText(file, signal));
  } else {
    const buffer = await file.arrayBuffer();
    signal.throwIfAborted();
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      throw new Error("文本编码不是 UTF-8，请转换后重新添加。");
    }
    if (text.includes("\0"))
      throw new Error("文件包含二进制内容，请使用文本或代码文件。");
  }
  signal.throwIfAborted();
  if (!text.trim())
    throw new Error("文件没有可读取的文字。扫描 PDF 请改为添加图片。");
  if (text.length > ATTACHMENT_LIMITS.textChars)
    throw new Error("文档文字超过 8 万字符，请拆分后添加。");
  return {
    ref: {
      ...ref,
      textLength: text.length,
      ...(pages ? { pages } : {}),
      ...(warning ? { warning } : {}),
    },
    sessionId,
    text,
  };
}
