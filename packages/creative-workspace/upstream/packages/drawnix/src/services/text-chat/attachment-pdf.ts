import { ATTACHMENT_LIMITS } from "./attachments";
import type { TextContent } from "pdfjs-dist/types/src/display/api";

// Lazy local assets support CJK PDFs even when the original document omits
// embedded character maps. They remain inside the app and require no CDN.
const pdfAssets = import.meta.glob<string>(
  [
    "/node_modules/pdfjs-dist/cmaps/*.bcmap",
    "/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}",
  ],
  { query: "?url&inline", import: "default" },
);
class LocalPdfDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const folder =
      kind === "cMapUrl"
        ? "cmaps"
        : kind === "standardFontDataUrl"
          ? "standard_fonts"
          : "";
    const load = pdfAssets[`/node_modules/pdfjs-dist/${folder}/${filename}`];
    if (!folder || !load) throw new Error("PDF 所需的字体或字符映射不可用。");
    const url = await load();
    const encoded = /^data:[^,]*;base64,(.*)$/.exec(url);
    if (encoded)
      return Uint8Array.from(atob(encoded[1]), (c) => c.charCodeAt(0));
    return new Uint8Array(await (await fetch(url)).arrayBuffer());
  }
}

/** Legacy build supplies missing JS built-ins in native WebKit. Loaded only for PDFs; no CDN. */
export async function extractPdfText(file: File, signal: AbortSignal) {
  const [pdf, { default: WorkerFactory }] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline"),
  ]);
  signal.throwIfAborted();
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  const port = new WorkerFactory();
  const worker = pdf.PDFWorker.create({ port });
  const task = pdf.getDocument({
    data: bytes,
    worker,
    useSystemFonts: true,
    useWorkerFetch: false,
    cMapUrl: "local-cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "local-fonts/",
    BinaryDataFactory: LocalPdfDataFactory,
  });
  const abort = () => {
    void task.destroy();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const document = await task.promise;
    if (document.numPages > ATTACHMENT_LIMITS.pdfPages)
      throw new Error("PDF 超过 50 页，请拆分后添加。");
    const parts: string[] = [],
      empty: number[] = [];
    let length = 0;
    for (let index = 1; index <= document.numPages; index++) {
      signal.throwIfAborted();
      const page = await document.getPage(index);
      // getTextContent() internally uses ReadableStream async iteration, which
      // native WebKit may lack. Its getReader() API is supported by our desktop.
      const reader = (page.streamTextContent() as ReadableStream<TextContent>).getReader();
      let pageText = "";
      try {
        while (true) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          pageText += value.items
            .map((item) =>
              "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
            )
            .join("");
          if (length + pageText.length > ATTACHMENT_LIMITS.textChars)
            throw new Error("PDF 文字超过 8 万字符，请拆分后添加。");
        }
      } finally {
        try {
          await reader.cancel();
        } catch {
          /* Destroyed/aborted PDF task. */
        }
        reader.releaseLock();
        page.cleanup();
      }
      const text = pageText.trim();
      if (!text) empty.push(index);
      else {
        const part = `[第 ${index} 页]\n${text}`;
        parts.push(part);
        length += part.length + 2;
      }
      if (length > ATTACHMENT_LIMITS.textChars)
        throw new Error("PDF 文字超过 8 万字符，请拆分后添加。");
    }
    return {
      text: parts.join("\n\n"),
      pages: document.numPages,
      warning: empty.length
        ? `第 ${empty.join("、")} 页没有提取到文字，扫描页或图表请另加截图。`
        : undefined,
    };
  } catch (e) {
    signal.throwIfAborted();
    if ((e as Error).name === "PasswordException")
      throw new Error("PDF 已加密，请先解锁后添加。");
    if ((e as Error).name === "InvalidPDFException")
      throw new Error("PDF 已损坏或格式不正确。");
    throw e;
  } finally {
    signal.removeEventListener("abort", abort);
    try {
      await task.destroy();
    } finally {
      worker.destroy();
      port.terminate();
    }
  }
}
