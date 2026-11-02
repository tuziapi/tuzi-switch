import type { default as PptxGenJS } from 'pptxgenjs';
import type { PlaitBoard, PlaitElement } from '@plait/core';
import {
  RectangleClient,
  getRectangleByElements,
  PlaitGroupElement,
} from '@plait/core';
import {
  PlaitDrawElement,
  getStrokeWidthByElement,
  isClosedPoints,
} from '@plait/draw';
import { MindElement } from '@plait/mind';
import { Freehand } from '../../plugins/freehand/type';
import { getFreehandRectangle } from '../../plugins/freehand/utils';
import { PenPath } from '../../plugins/pen/type';
import {
  getAbsoluteAnchors,
  getPenPathRectangle,
} from '../../plugins/pen/utils';
import { getPathSamplePoints } from '../../plugins/pen/bezier-utils';
import { isFrameElement, type PlaitFrame } from '../../types/frame.types';
import {
  sortElementsByPosition,
  extractTextFromElement,
  isTextElement,
  isImageElement,
} from '../../utils/selection-utils';
import { getCurrentFill, getCurrentStrokeColor } from '../../utils/property';
import type { PPTSlideTransition } from './ppt.types';
import {
  hasPPTSlideTransition,
  injectPPTSlideTransitions,
  normalizePPTSlideTransition,
} from './ppt-transitions';
import { smartDownload } from '../../utils/download-utils';

export interface ExportPPTOptions {
  fileName?: string;
  embedMedia?: boolean;
  mediaSizeLimitBytes?: number;
}

const SLIDE_WIDTH = 10;
const SLIDE_HEIGHT = 5.625;
const DEFAULT_EXPORT_MEDIA_SIZE_LIMIT_BYTES = 50 * 1024 * 1024;
const PPTX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const EXPORT_MEDIA_COVER_MAX_WIDTH_PX = 1280;
const EXPORT_MEDIA_COVER_TIMEOUT_MS = 5000;
/** 幻灯片宽度（磅），与 fontScale 计算一致：SLIDE_WIDTH 英寸 × 72pt/英寸 */
const SLIDE_WIDTH_PT = SLIDE_WIDTH * 72;
// 画布默认使用的中文系统字体（与前端一致）
const DEFAULT_FONT_FACE = 'PingFang SC';
// 画布文本默认字号（见 with-text-resize / inline text 输入）
const DEFAULT_CANVAS_TEXT_FONT_SIZE_PX = 14;

/**
 * 画布坐标系下的描边宽度（与 element.points 同单位）→ PptxGenJS line.width（磅）。
 * 原先把 1～2 的像素级线宽直接当「磅」传入，在宽 Frame 上会粗得夸张。
 */
function canvasStrokeWidthToPptPt(
  strokeWidthPx: number,
  frameWidthPx: number
): number {
  const fw = Math.max(frameWidthPx, 1);
  const pt = strokeWidthPx * (SLIDE_WIDTH_PT / fw);
  return Math.max(0.1, pt);
}

// ─── Color conversion ───

function toPptColor(color: string | null | undefined): string | undefined {
  if (!color) return undefined;
  const c = color.trim();
  if (c === 'transparent' || c === 'none' || c === '') return undefined;

  if (c.startsWith('#')) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      return hex
        .split('')
        .map((ch) => ch + ch)
        .join('')
        .toUpperCase();
    }
    return hex.substring(0, 6).toUpperCase();
  }

  const rgbMatch = c.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return [r, g, b]
      .map((v) => parseInt(v).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }

  return undefined;
}

// ─── Slate rich text extraction ───
//
// Plait geometry/text elements store text as:
//   element.text = { type: 'paragraph', children: [{ text: '...', 'font-size': 44, ... }] }
// MindElement / some elements use:
//   element.data = [ { type: 'paragraph', children: [...] }, ... ]
//
// We walk both to extract styled TextProps for pptxgenjs.

interface SlateLeaf {
  text: string;
  'font-size'?: number;
  'font-weight'?: string;
  color?: string;
  italic?: boolean;
  underline?: boolean;
  bold?: boolean;
  [key: string]: any;
}

interface TextFallbackStyle {
  fontSizePt?: number;
  align?: 'left' | 'center' | 'right';
}

interface ResolvedExportPPTOptions {
  embedMedia: boolean;
  mediaSizeLimitBytes: number;
}

type ExportMediaKind = 'audio' | 'video';

interface ExportMediaDescriptor {
  kind: ExportMediaKind;
  url: string;
  title?: string;
  coverCandidates: string[];
}

interface ResolvedExportMediaSource {
  data: string;
  extn: string;
  mimeType: string;
  size: number;
}

interface ExportMediaCoverSize {
  width: number;
  height: number;
}

function normalizePPTFileName(fileName: string): string {
  return fileName.toLowerCase().endsWith('.pptx')
    ? fileName
    : `${fileName}.pptx`;
}

function getFramePPTTransition(frame: PlaitFrame): PPTSlideTransition {
  return normalizePPTSlideTransition(
    (frame as PlaitFrame & { pptMeta?: { transition?: PPTSlideTransition } })
      .pptMeta?.transition
  );
}

function toPPTXBlob(data: string | ArrayBuffer | Blob | Uint8Array): Blob {
  if (data instanceof Blob) {
    return data;
  }
  return new Blob([data as BlobPart], { type: PPTX_MIME_TYPE });
}

async function downloadPPTXBlob(blob: Blob, fileName: string): Promise<void> {
  const outputBlob =
    blob.type === PPTX_MIME_TYPE
      ? blob
      : new Blob([blob], { type: PPTX_MIME_TYPE });
  const url = URL.createObjectURL(outputBlob);
  try {
    await smartDownload([{ url, type: 'file', filename: fileName }]);
  } finally {
    URL.revokeObjectURL(url);
  }
}

class ExportMediaTooLargeError extends Error {
  constructor(readonly size: number, readonly limit: number) {
    super(
      `媒体文件超过导出上限 (${formatBytes(size)} / ${formatBytes(limit)})`
    );
    this.name = 'ExportMediaTooLargeError';
  }
}

function isSlateLeaf(node: any): node is SlateLeaf {
  return node && typeof node === 'object' && typeof node.text === 'string';
}

function collectLeaves(node: any): SlateLeaf[] {
  if (isSlateLeaf(node)) return [node];
  const leaves: SlateLeaf[] = [];
  const children = node?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      leaves.push(...collectLeaves(child));
    }
  }
  return leaves;
}

function parseNumericFontSize(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function leafToTextProps(
  leaf: SlateLeaf,
  addBreakLine: boolean,
  fontScale: number,
  defaultFontSizePt: number
): PptxGenJS.TextProps {
  const opts: Record<string, any> = {};

  const fontSize = parseNumericFontSize(leaf['font-size']);
  const targetPt = fontSize
    ? Math.max(6, Math.round(fontSize * fontScale))
    : defaultFontSizePt;
  opts.fontSize = targetPt;

  const fontWeight = leaf['font-weight'];
  const fontWeightNum = fontWeight ? Number(fontWeight) : NaN;
  if (
    fontWeight === 'bold' ||
    leaf.bold ||
    (!Number.isNaN(fontWeightNum) && fontWeightNum >= 500)
  ) {
    opts.bold = true;
  }

  const color = toPptColor(leaf.color);
  if (color) opts.color = color;

  if (leaf.italic) opts.italic = true;
  if (leaf.underline) opts.underline = { style: 'sng' };
  if (addBreakLine) opts.breakLine = true;

  return { text: leaf.text, options: opts };
}

/**
 * 从 Slate 段落节点数组中提取带样式的 TextProps
 */
function walkParagraphs(
  paragraphs: any[],
  fontScale: number
): PptxGenJS.TextProps[] | null {
  const result: PptxGenJS.TextProps[] = [];
  const defaultFontSizePt = Math.max(
    6,
    Math.round(DEFAULT_CANVAS_TEXT_FONT_SIZE_PX * fontScale)
  );

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const isLastPara = pi === paragraphs.length - 1;
    const leaves = collectLeaves(paragraphs[pi]);
    if (leaves.length === 0) {
      if (!isLastPara) result.push({ text: '', options: { breakLine: true } });
      continue;
    }
    for (let li = 0; li < leaves.length; li++) {
      const isLastLeaf = li === leaves.length - 1;
      const needBreak = isLastLeaf && !isLastPara;
      result.push(
        leafToTextProps(leaves[li], needBreak, fontScale, defaultFontSizePt)
      );
    }
  }

  if (result.length === 0) return null;
  return result.some((r) => r.text?.trim()) ? result : null;
}

interface RichTextResult {
  rows: PptxGenJS.TextProps[];
  align?: 'left' | 'center' | 'right';
}

/**
 * 统一提取元素的富文本（同时支持 element.data 和 element.text）
 * 同时提取段落对齐方式
 */
function extractElementRichText(
  element: PlaitElement,
  fontScale: number
): RichTextResult | null {
  // 1) element.data：MindElement / 部分 PlaitText 使用 data 数组
  const data = (element as any).data;
  if (data && Array.isArray(data)) {
    const rows = walkParagraphs(data, fontScale);
    if (rows) {
      const align = extractAlign(data[0]);
      return { rows, align };
    }
  }

  // 2) element.text：PlaitGeometry / PlaitText 使用单个 Slate 段落
  const textObj = (element as any).text;
  if (textObj && typeof textObj === 'object' && 'children' in textObj) {
    const rows = walkParagraphs([textObj], fontScale);
    if (rows) {
      const align = extractAlign(textObj);
      return { rows, align };
    }
  }

  return null;
}

function extractAlign(para: any): 'left' | 'center' | 'right' | undefined {
  if (!para || typeof para !== 'object') return undefined;
  const a = para.align;
  if (a === 'center' || a === 'right' || a === 'left') return a;
  return undefined;
}

function extractFallbackTextStyle(
  element: PlaitElement,
  fontScale: number,
  defaultFontPt: number,
  defaultAlign: 'left' | 'center' | 'right'
): TextFallbackStyle {
  const textObj = (element as any).text;
  const data = (element as any).data;

  let align = defaultAlign;
  let fontSizePt = defaultFontPt;

  const paragraphs: any[] = [];
  if (Array.isArray(data)) {
    paragraphs.push(...data);
  }
  if (textObj && typeof textObj === 'object') {
    paragraphs.push(textObj);
  }

  for (const para of paragraphs) {
    const paraAlign = extractAlign(para);
    if (paraAlign) {
      align = paraAlign;
      break;
    }
  }

  for (const para of paragraphs) {
    const leaves = collectLeaves(para);
    for (const leaf of leaves) {
      const sizePx = parseNumericFontSize((leaf as any)['font-size']);
      if (sizePx && sizePx > 0) {
        fontSizePt = Math.max(6, Math.round(sizePx * fontScale));
        return { align, fontSizePt };
      }
    }
  }

  return { align, fontSizePt };
}

function extractPlainTextWithLineBreaks(
  element: PlaitElement,
  board: PlaitBoard
): string {
  const data = (element as any).data;
  if (Array.isArray(data) && data.length > 0) {
    const rows = data
      .map((node: any) => {
        const leaves = collectLeaves(node);
        return leaves.map((leaf) => leaf.text || '').join('');
      })
      .filter((line: string) => line.length > 0);
    if (rows.length > 0) return rows.join('\n');
  }

  const textObj = (element as any).text;
  if (textObj && typeof textObj === 'object' && 'children' in textObj) {
    const children = (textObj as any).children;
    if (Array.isArray(children)) {
      const lines: string[] = [];
      const hasParagraphChildren = children.some(
        (child: any) =>
          child && typeof child === 'object' && Array.isArray(child.children)
      );
      if (hasParagraphChildren) {
        for (const child of children) {
          const leaves = collectLeaves(child);
          const line = leaves.map((leaf) => leaf.text || '').join('');
          if (line.length > 0) lines.push(line);
        }
      } else {
        const line = collectLeaves(textObj)
          .map((leaf) => leaf.text || '')
          .join('');
        if (line.length > 0) lines.push(line);
      }
      if (lines.length > 0) return lines.join('\n');
    }
  }

  return extractTextFromElement(element, board);
}

/**
 * 纯文本兜底（无样式数据时使用）
 */
function buildPlainTextRows(
  text: string,
  fontSizePt: number
): PptxGenJS.TextProps[] {
  return text.split('\n').map((line, i, arr) => ({
    text: line,
    options: {
      fontSize: fontSizePt,
      ...(i < arr.length - 1 ? { breakLine: true } : {}),
    },
  }));
}

function isShortSingleLine(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  if (!t) return false;
  // 没有显式换行且字符数不多（如「感谢聆听」「Q&A」）
  return !text.includes('\n') && t.length <= 12;
}

function shouldEnableAutoWrap(text: string, isSingle: boolean): boolean {
  // 用户输入了显式换行时，优先保留原换行，避免 PPT/WPS 二次自动断行
  if (text.includes('\n')) return false;
  return !isSingle;
}

// ─── Shape type mapping ───

function mapShapeType(pptx: PptxGenJS, shape: string): any {
  const st = pptx.ShapeType as Record<string, any>;
  switch (shape) {
    case 'rectangle':
    case 'process':
      return st.rect;
    case 'ellipse':
    case 'circle':
      return st.ellipse;
    case 'roundRectangle':
    case 'roundedRectangle':
    case 'round_rectangle':
      return st.roundRect;
    case 'diamond':
    case 'decision':
      return st.diamond;
    case 'triangle':
      return st.triangle;
    case 'parallelogram':
      return st.parallelogram;
    case 'trapezoid':
      return st.trapezoid;
    case 'hexagon':
      return st.hexagon;
    case 'star4':
      return st.star4;
    case 'star5':
    case 'star':
      return st.star5;
    case 'cloud':
      return st.cloud;
    default:
      return st.rect;
  }
}

// ─── Position / style helpers ───

/**
 * widthBuffer > 1 时：按中心点向两侧扩展宽度，防止 PPT 字体度量差异导致换行
 */
function computeSlidePosition(
  elRect: { x: number; y: number; width: number; height: number },
  frameRect: { x: number; y: number; width: number; height: number },
  widthBuffer = 1
) {
  const relX = (elRect.x - frameRect.x) / frameRect.width;
  const relY = (elRect.y - frameRect.y) / frameRect.height;
  const relW = elRect.width / frameRect.width;
  const relH = elRect.height / frameRect.height;

  const w = Math.max(0.1, relW * SLIDE_WIDTH * widthBuffer);
  const rawX = relX * SLIDE_WIDTH;
  const expandDelta = (w - relW * SLIDE_WIDTH) / 2;

  return {
    x: Math.max(0, rawX - expandDelta),
    y: Math.max(0, relY * SLIDE_HEIGHT),
    w,
    h: Math.max(0.1, relH * SLIDE_HEIGHT),
  };
}

function getElementFillOpts(
  board: PlaitBoard,
  element: PlaitElement
): { fill?: { color: string } } {
  const fillColor = toPptColor(getCurrentFill(board, element));
  return fillColor ? { fill: { color: fillColor } } : {};
}

function getElementLineOpts(
  board: PlaitBoard,
  element: PlaitElement,
  frameWidthPx: number
): { line: { color: string; width: number } } {
  const strokeColor = toPptColor(getCurrentStrokeColor(board, element));
  const px = getStrokeWidthByElement(element as any);
  const widthPt = canvasStrokeWidthToPptPt(px, frameWidthPx);
  // pptxgenjs：未传 line 时会默认 { type: 'none' }，无填充的几何图形在 PPT 中会完全不可见
  return { line: { color: strokeColor || '333333', width: widthPt } };
}

type CustGeomPoint =
  | { x: number; y: number; moveTo?: boolean }
  | { close: true };

// ─── Image helper ───

function resolveExportPPTOptions(
  options: ExportPPTOptions = {}
): ResolvedExportPPTOptions {
  return {
    embedMedia: options.embedMedia !== false,
    mediaSizeLimitBytes:
      typeof options.mediaSizeLimitBytes === 'number' &&
      Number.isFinite(options.mediaSizeLimitBytes) &&
      options.mediaSizeLimitBytes > 0
        ? options.mediaSizeLimitBytes
        : DEFAULT_EXPORT_MEDIA_SIZE_LIMIT_BYTES,
  };
}

async function ensureBase64Image(url: string): Promise<string> {
  if (!url) throw new Error('图片 URL 为空');
  if (url.startsWith('data:')) return url;

  const response = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error(`获取图片失败: ${response.status}`);
  const blob = await response.blob();

  return blobToDataUrl(blob, '图片转换失败', '图片读取失败');
}

function blobToDataUrl(
  blob: Blob,
  convertErrorMessage = '媒体转换失败',
  readErrorMessage = '媒体读取失败'
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error(convertErrorMessage));
    };
    reader.onerror = () => reject(new Error(readErrorMessage));
    reader.readAsDataURL(blob);
  });
}

function getMediaCoverSize(pos: {
  w: number;
  h: number;
}): ExportMediaCoverSize {
  const ratio = Math.min(4, Math.max(0.4, pos.w / Math.max(pos.h, 0.1)));
  const width =
    ratio >= 1
      ? EXPORT_MEDIA_COVER_MAX_WIDTH_PX
      : Math.round(EXPORT_MEDIA_COVER_MAX_WIDTH_PX * ratio);
  const height = Math.round(width / ratio);
  return {
    width: Math.max(320, width),
    height: Math.max(180, height),
  };
}

function createPngCanvas(
  size: ExportMediaCoverSize
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) {
    return null;
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;
  canvas.width = size.width;
  canvas.height = size.height;
  return { canvas, ctx };
}

function fillCanvasBackground(
  ctx: CanvasRenderingContext2D,
  size: ExportMediaCoverSize
) {
  const gradient = ctx.createLinearGradient(0, 0, size.width, size.height);
  gradient.addColorStop(0, '#0f172a');
  gradient.addColorStop(0.55, '#1d4ed8');
  gradient.addColorStop(1, '#f97316');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size.width, size.height);
}

function drawMediaPlayBadge(
  ctx: CanvasRenderingContext2D,
  size: ExportMediaCoverSize,
  kind: ExportMediaKind
) {
  const radius = Math.min(size.width, size.height) * 0.14;
  const cx = size.width / 2;
  const cy = size.height / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.62)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.lineWidth = Math.max(4, radius * 0.08);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  if (kind === 'video') {
    ctx.beginPath();
    ctx.moveTo(cx - radius * 0.22, cy - radius * 0.38);
    ctx.lineTo(cx - radius * 0.22, cy + radius * 0.38);
    ctx.lineTo(cx + radius * 0.46, cy);
    ctx.closePath();
    ctx.fill();
  } else {
    const barWidth = Math.max(4, radius * 0.12);
    const bars = [0.52, 0.82, 0.62, 0.92, 0.7];
    bars.forEach((heightRatio, index) => {
      const x = cx - radius * 0.45 + index * barWidth * 1.7;
      const h = radius * heightRatio;
      ctx.fillRect(x, cy - h / 2, barWidth, h);
    });
  }
  ctx.restore();
}

function drawImageCoverToCanvas(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  size: ExportMediaCoverSize
) {
  const sourceRatio = sourceWidth / Math.max(sourceHeight, 1);
  const targetRatio = size.width / Math.max(size.height, 1);
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceRatio > targetRatio) {
    sw = sourceHeight * targetRatio;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / targetRatio;
    sy = (sourceHeight - sh) / 2;
  }

  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, size.width, size.height);
}

function loadCoverImage(data: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('封面图片加载失败'));
    image.src = data;
  });
}

async function imageToPngCover(
  data: string,
  size: ExportMediaCoverSize,
  kind?: ExportMediaKind
): Promise<string> {
  const pngCanvas = createPngCanvas(size);
  if (!pngCanvas) return data;
  const image = await loadCoverImage(data);
  fillCanvasBackground(pngCanvas.ctx, size);
  drawImageCoverToCanvas(
    pngCanvas.ctx,
    image,
    image.naturalWidth || size.width,
    image.naturalHeight || size.height,
    size
  );
  if (kind) {
    drawMediaPlayBadge(pngCanvas.ctx, size, kind);
  }
  return pngCanvas.canvas.toDataURL('image/png');
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(message)),
      timeoutMs
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function waitForMediaEvent(
  media: HTMLMediaElement,
  eventName: string,
  errorMessage: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      media.removeEventListener(eventName, onEvent);
      media.removeEventListener('error', onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(errorMessage));
    };
    media.addEventListener(eventName, onEvent, { once: true });
    media.addEventListener('error', onError, { once: true });
  });
}

async function captureVideoFrameCover(
  videoUrl: string,
  size: ExportMediaCoverSize
): Promise<string | undefined> {
  const pngCanvas = createPngCanvas(size);
  if (!pngCanvas || typeof document === 'undefined') return undefined;

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'metadata';
  video.playsInline = true;

  try {
    video.src = videoUrl;
    await withTimeout(
      waitForMediaEvent(video, 'loadedmetadata', '视频封面加载失败'),
      EXPORT_MEDIA_COVER_TIMEOUT_MS,
      '视频封面加载超时'
    );

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const timestamp =
      duration > 0 ? Math.min(0.1, Math.max(0, duration - 0.01)) : 0;
    if (timestamp > 0) {
      video.currentTime = timestamp;
      await withTimeout(
        waitForMediaEvent(video, 'seeked', '视频首帧定位失败'),
        EXPORT_MEDIA_COVER_TIMEOUT_MS,
        '视频首帧定位超时'
      );
    } else if (video.readyState < video.HAVE_CURRENT_DATA) {
      await withTimeout(
        waitForMediaEvent(video, 'loadeddata', '视频首帧加载失败'),
        EXPORT_MEDIA_COVER_TIMEOUT_MS,
        '视频首帧加载超时'
      );
    }

    fillCanvasBackground(pngCanvas.ctx, size);
    drawImageCoverToCanvas(
      pngCanvas.ctx,
      video,
      video.videoWidth || size.width,
      video.videoHeight || size.height,
      size
    );
    drawMediaPlayBadge(pngCanvas.ctx, size, 'video');
    return pngCanvas.canvas.toDataURL('image/png');
  } catch {
    return undefined;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

function truncateCoverText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}

function createAudioGeneratedCover(
  descriptor: ExportMediaDescriptor,
  size: ExportMediaCoverSize
): string | undefined {
  const pngCanvas = createPngCanvas(size);
  if (!pngCanvas) return undefined;
  const { canvas, ctx } = pngCanvas;
  fillCanvasBackground(ctx, size);

  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  for (let i = 0; i < 18; i++) {
    const x = (size.width / 18) * i;
    const h = size.height * (0.18 + ((i * 37) % 9) / 18);
    ctx.fillRect(x, size.height - h, Math.max(8, size.width / 60), h);
  }
  ctx.restore();

  const artworkSize = Math.min(size.height * 0.58, size.width * 0.28);
  const artworkX = size.width * 0.08;
  const artworkY = (size.height - artworkSize) / 2;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
  ctx.fillRect(artworkX, artworkY, artworkSize, artworkSize);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
  const barWidth = artworkSize * 0.08;
  [0.7, 0.46, 0.82, 0.58].forEach((heightRatio, index) => {
    const h = artworkSize * heightRatio;
    const x = artworkX + artworkSize * 0.25 + index * barWidth * 1.8;
    ctx.fillRect(x, artworkY + (artworkSize - h) / 2, barWidth, h);
  });

  const title = truncateCoverText(descriptor.title || 'Canvas Audio', 34);
  const textX = artworkX + artworkSize + size.width * 0.06;
  const textW = size.width - textX - size.width * 0.08;
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.max(
    24,
    Math.round(size.height * 0.13)
  )}px ${DEFAULT_FONT_FACE}, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(title, textX, size.height * 0.43, textW);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.font = `500 ${Math.max(
    14,
    Math.round(size.height * 0.055)
  )}px ${DEFAULT_FONT_FACE}, sans-serif`;
  ctx.fillText('AUDIO', textX, size.height * 0.58, textW);
  drawMediaPlayBadge(ctx, size, 'audio');
  return canvas.toDataURL('image/png');
}

function isLikelyVideoUrl(url: string): boolean {
  const normalized = url.toLowerCase();
  return (
    normalized.includes('#video') ||
    normalized.includes('#merged-video') ||
    /\.(mp4|webm|mov|mkv|avi|m4v|flv|wmv)(\?|#|$)/i.test(url)
  );
}

function isLikelyAudioUrl(url: string): boolean {
  return /\.(mp3|wav|m4a|aac|ogg|flac|webm)(\?|#|$)/i.test(url);
}

function stripMediaUrlMarker(url: string): string {
  return url.replace(/#(?:video|merged-video[^?#]*)$/i, '');
}

function getAudioUrl(element: PlaitElement): string | undefined {
  const audioUrl = (element as PlaitElement & { audioUrl?: unknown }).audioUrl;
  return typeof audioUrl === 'string' && audioUrl.trim()
    ? audioUrl.trim()
    : undefined;
}

function getImageUrl(element: PlaitElement): string | undefined {
  const anyEl = element as any;
  const url = anyEl.url || anyEl.image?.url;
  return typeof url === 'string' && url.trim() ? url.trim() : undefined;
}

function getMediaCoverCandidates(element: PlaitElement): string[] {
  const anyEl = element as any;
  const seen = new Set<string>();
  return [
    anyEl.poster,
    anyEl.previewImageUrl,
    anyEl.coverUrl,
    anyEl.thumbnail,
    anyEl.imageLargeUrl,
    anyEl.image?.url,
    anyEl.url,
  ].filter((value): value is string => {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return false;
    seen.add(trimmed);
    return true;
  });
}

function getExportMediaDescriptor(
  element: PlaitElement
): ExportMediaDescriptor | null {
  const anyEl = element as any;
  const imageUrl = getImageUrl(element);
  const audioUrl = getAudioUrl(element);
  const isLegacyAudio =
    anyEl.isAudio === true ||
    anyEl.audioType === 'music-card' ||
    Boolean(audioUrl && anyEl.type !== 'audio');

  if (audioUrl && (anyEl.type === 'audio' || isLegacyAudio)) {
    return {
      kind: 'audio',
      url: audioUrl,
      title:
        typeof anyEl.title === 'string'
          ? anyEl.title
          : typeof anyEl.audioTitle === 'string'
          ? anyEl.audioTitle
          : undefined,
      coverCandidates: getMediaCoverCandidates(element),
    };
  }

  if (
    imageUrl &&
    (anyEl.type === 'video' ||
      anyEl.isVideo === true ||
      Boolean(anyEl.videoType) ||
      isLikelyVideoUrl(imageUrl))
  ) {
    return {
      kind: 'video',
      url: stripMediaUrlMarker(imageUrl),
      title: typeof anyEl.title === 'string' ? anyEl.title : undefined,
      coverCandidates: getMediaCoverCandidates(element),
    };
  }

  return null;
}

function shouldSkipMediaAsRasterImage(element: PlaitElement): boolean {
  return getExportMediaDescriptor(element)?.kind === 'video';
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function estimateDataUrlBytes(url: string): number | null {
  const commaIndex = url.indexOf(',');
  if (commaIndex < 0) return null;
  const metadata = url.slice(0, commaIndex).toLowerCase();
  const payload = url.slice(commaIndex + 1);
  if (!metadata.includes(';base64')) {
    return Math.ceil(decodeURIComponent(payload).length);
  }
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

async function responseToLimitedBlob(
  response: Response,
  limitBytes: number
): Promise<Blob> {
  const headerSize = parsePositiveInteger(
    response.headers.get('content-length')
  );
  if (headerSize && headerSize > limitBytes) {
    throw new ExportMediaTooLargeError(headerSize, limitBytes);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > limitBytes) {
      throw new ExportMediaTooLargeError(blob.size, limitBytes);
    }
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limitBytes) {
        await reader.cancel();
        throw new ExportMediaTooLargeError(total, limitBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return new Blob(chunks, { type: contentType || undefined });
}

function getMimeTypeFromDataUrl(url: string): string | undefined {
  const match = /^data:([^;,]+)/i.exec(url);
  return match?.[1]?.toLowerCase();
}

function normalizeMediaExtension(ext: string | undefined): string | undefined {
  const normalized = ext?.toLowerCase().replace(/^\./, '').trim();
  if (!normalized || !/^[a-z0-9]+$/.test(normalized)) return undefined;
  if (normalized === 'mpeg' || normalized === 'mpga') return 'mp3';
  if (normalized === 'quicktime') return 'mov';
  if (normalized === 'x-m4v') return 'm4v';
  return normalized;
}

function inferExtensionFromMime(
  mimeType: string | undefined,
  kind: ExportMediaKind
): string | undefined {
  const mime = mimeType?.toLowerCase().split(';')[0].trim();
  if (!mime) return undefined;
  const mapped: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-m4v': 'm4v',
    'video/x-msvideo': 'avi',
    'video/x-matroska': 'mkv',
  };
  if (mapped[mime]) return mapped[mime];
  if (mime.startsWith(`${kind}/`)) {
    return normalizeMediaExtension(mime.slice(kind.length + 1));
  }
  return undefined;
}

function inferExtensionFromUrl(url: string): string | undefined {
  const cleanUrl = stripMediaUrlMarker(url).split('?')[0].split('#')[0];
  const match = /\.([a-z0-9]+)$/i.exec(cleanUrl);
  return normalizeMediaExtension(match?.[1]);
}

function inferMediaExtension(
  url: string,
  mimeType: string | undefined,
  kind: ExportMediaKind
): string {
  return (
    inferExtensionFromMime(mimeType, kind) ||
    inferExtensionFromUrl(url) ||
    (kind === 'video' ? 'mp4' : 'mp3')
  );
}

function inferMediaMimeType(
  blob: Blob,
  url: string,
  kind: ExportMediaKind
): string {
  return (
    blob.type ||
    getMimeTypeFromDataUrl(url) ||
    (kind === 'video' ? 'video/mp4' : 'audio/mpeg')
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)}${units[unitIndex]}`;
}

async function resolveExportMediaSource(
  descriptor: ExportMediaDescriptor,
  limitBytes: number
): Promise<ResolvedExportMediaSource> {
  const mediaUrl =
    descriptor.kind === 'video'
      ? stripMediaUrlMarker(descriptor.url)
      : descriptor.url;
  if (!mediaUrl) throw new Error('媒体 URL 为空');

  const estimatedDataSize = mediaUrl.startsWith('data:')
    ? estimateDataUrlBytes(mediaUrl)
    : null;
  if (estimatedDataSize && estimatedDataSize > limitBytes) {
    throw new ExportMediaTooLargeError(estimatedDataSize, limitBytes);
  }

  const response = await fetch(mediaUrl, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) {
    throw new Error(`获取媒体失败: ${response.status}`);
  }

  const blob = await responseToLimitedBlob(response, limitBytes);
  if (blob.size <= 0) throw new Error('媒体内容为空');

  const mimeType = inferMediaMimeType(blob, mediaUrl, descriptor.kind);
  const data = await blobToDataUrl(blob);
  const extn = inferMediaExtension(mediaUrl, mimeType, descriptor.kind);
  return { data, extn, mimeType, size: blob.size };
}

function shouldSkipMediaCoverCandidate(
  candidate: string,
  descriptor: ExportMediaDescriptor
): boolean {
  const normalizedCandidate = stripMediaUrlMarker(candidate);
  const normalizedMediaUrl = stripMediaUrlMarker(descriptor.url);
  return (
    normalizedCandidate === normalizedMediaUrl ||
    isLikelyVideoUrl(candidate) ||
    isLikelyAudioUrl(candidate)
  );
}

async function resolveMediaCover(
  descriptor: ExportMediaDescriptor,
  size: ExportMediaCoverSize,
  allowGeneratedCover = true
): Promise<string | undefined> {
  for (const candidate of descriptor.coverCandidates) {
    if (shouldSkipMediaCoverCandidate(candidate, descriptor)) {
      continue;
    }
    if (
      candidate.startsWith('data:') &&
      !candidate.toLowerCase().startsWith('data:image/')
    ) {
      continue;
    }
    try {
      const data = await ensureBase64Image(candidate);
      const normalizedData = data.toLowerCase();
      if (normalizedData.startsWith('data:image/')) {
        return await imageToPngCover(data, size, descriptor.kind);
      }
    } catch {}
  }

  if (!allowGeneratedCover) {
    return undefined;
  }

  if (descriptor.kind === 'video') {
    return captureVideoFrameCover(descriptor.url, size);
  }

  return createAudioGeneratedCover(descriptor, size);
}

function getFallbackReason(error: unknown): string {
  if (error instanceof ExportMediaTooLargeError) {
    return `文件超过 ${formatBytes(error.limit)} 上限`;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '媒体获取失败';
}

function getSafeHyperlink(url: string): { url: string } | undefined {
  return /^https?:\/\//i.test(url) ? { url } : undefined;
}

async function addMediaFallback(
  slide: PptxGenJS.Slide,
  descriptor: ExportMediaDescriptor,
  pos: { x: number; y: number; w: number; h: number },
  error?: unknown
) {
  const label = descriptor.kind === 'video' ? '视频' : '音频';
  const title = descriptor.title?.trim();
  const reason = getFallbackReason(error);
  const text = [
    `${label}未嵌入`,
    reason,
    title ? `《${title}》` : '',
    getSafeHyperlink(descriptor.url) ? '点击打开原始链接' : '',
  ]
    .filter(Boolean)
    .join('\n');

  const cover = await resolveMediaCover(descriptor, getMediaCoverSize(pos));
  if (cover) {
    slide.addImage({ data: cover, x: pos.x, y: pos.y, w: pos.w, h: pos.h });
  }

  slide.addText(buildPlainTextRows(text, 10), {
    x: pos.x,
    y: pos.y,
    w: pos.w,
    h: pos.h,
    valign: 'middle',
    align: 'center',
    margin: 0.08,
    fit: 'shrink',
    fontFace: DEFAULT_FONT_FACE,
    color: cover ? 'FFFFFF' : '334155',
    fill: cover ? { color: '0F172A', transparency: 18 } : { color: 'F8FAFC' },
    line: { color: 'CBD5E1', width: 0.5 },
    hyperlink: getSafeHyperlink(descriptor.url),
  });
}

async function addMediaElementToSlide(
  slide: PptxGenJS.Slide,
  element: PlaitElement,
  pos: { x: number; y: number; w: number; h: number },
  options: ResolvedExportPPTOptions
): Promise<boolean> {
  const descriptor = getExportMediaDescriptor(element);
  if (!descriptor) return false;

  if (!options.embedMedia) {
    await addMediaFallback(slide, descriptor, pos);
    return true;
  }

  try {
    const coverSize = getMediaCoverSize(pos);
    const [source, cover] = await Promise.all([
      resolveExportMediaSource(descriptor, options.mediaSizeLimitBytes),
      resolveMediaCover(descriptor, coverSize),
    ]);
    slide.addMedia({
      type: descriptor.kind,
      data: source.data,
      extn: source.extn,
      ...(cover ? { cover } : {}),
      objectName:
        descriptor.title ||
        (descriptor.kind === 'video' ? 'Canvas Video' : 'Canvas Audio'),
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
    });
  } catch (error) {
    await addMediaFallback(slide, descriptor, pos, error);
  }

  return true;
}

// ─── Frame sorting ───

function sortFramesForPPT(frames: PlaitFrame[]): PlaitFrame[] {
  return [...frames].sort((a, b) => {
    const metaA = (a as PlaitFrame & { pptMeta?: { pageIndex?: number } })
      .pptMeta;
    const metaB = (b as PlaitFrame & { pptMeta?: { pageIndex?: number } })
      .pptMeta;
    const indexA = metaA?.pageIndex;
    const indexB = metaB?.pageIndex;
    const hasA = typeof indexA === 'number' && !Number.isNaN(indexA);
    const hasB = typeof indexB === 'number' && !Number.isNaN(indexB);
    // 原先用 pageA && pageB：pageIndex 为 0 或与「无 meta」混排时会失效，导致顺序退化成仅按 x，幻灯片与配图页错乱
    if (hasA && hasB && indexA !== indexB) {
      return indexA - indexB;
    }
    if (hasA !== hasB) {
      return hasA ? -1 : 1;
    }

    const rectA = RectangleClient.getRectangleByPoints(a.points);
    const rectB = RectangleClient.getRectangleByPoints(b.points);
    const dy = rectA.y - rectB.y;
    if (Math.abs(dy) > 1) return dy;
    return rectA.x - rectB.x;
  });
}

function rectangleIntersectionArea(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const w = x2 - x1;
  const h = y2 - y1;
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * 将画布元素划分到各 Frame（导出页）。有 frameId 的跟绑定走；无绑定的按与 Frame 相交面积最大的一页归属，避免重复进多页。
 */
function partitionElementsByExportFrames(
  board: PlaitBoard,
  frames: PlaitFrame[]
): Map<string, PlaitElement[]> {
  const byFrame = new Map<string, PlaitElement[]>();
  const frameRectMap = new Map(
    frames.map(
      (f) => [f.id, RectangleClient.getRectangleByPoints(f.points)] as const
    )
  );
  for (const f of frames) {
    byFrame.set(f.id, []);
  }
  const unbound: PlaitElement[] = [];

  for (const el of board.children as PlaitElement[]) {
    if (isFrameElement(el)) continue;
    if (PlaitGroupElement.isGroup(el)) continue;

    const boundId = (el as PlaitElement & { frameId?: string }).frameId;
    if (boundId && byFrame.has(boundId)) {
      byFrame.get(boundId)!.push(el);
      continue;
    }
    if (boundId) {
      continue;
    }
    unbound.push(el);
  }

  for (const el of unbound) {
    let rect: RectangleClient;
    try {
      rect = getRectangleByElements(board, [el], false);
    } catch {
      continue;
    }
    if (rect.width <= 0 || rect.height <= 0) continue;

    let bestId: string | null = null;
    let bestArea = 0;
    for (const f of frames) {
      const fr = frameRectMap.get(f.id)!;
      if (!RectangleClient.isHit(rect, fr)) continue;
      const center = {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
      if (!isPointInRect(center, fr, 2)) continue;
      const area = rectangleIntersectionArea(rect, fr);
      if (area > bestArea) {
        bestArea = area;
        bestId = f.id;
      }
    }
    if (bestId && bestArea > 0) {
      byFrame.get(bestId)!.push(el);
    }
  }

  return byFrame;
}

/** 与 FramePanel 一致：递归收集所有 Frame（含嵌套） */
function collectAllFramesFromBoard(board: PlaitBoard): PlaitFrame[] {
  const seen = new Set<string>();
  const out: PlaitFrame[] = [];
  const walk = (elements: PlaitElement[]) => {
    for (const el of elements) {
      if (isFrameElement(el)) {
        const f = el as PlaitFrame;
        if (!seen.has(f.id)) {
          seen.add(f.id);
          out.push(f);
        }
      }
      const ch = (el as PlaitElement & { children?: PlaitElement[] }).children;
      if (ch && ch.length > 0) {
        walk(ch);
      }
    }
  };
  walk(board.children as PlaitElement[]);
  return out;
}

function isRectContained(
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number },
  epsilon = 0.5
): boolean {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.height <= outer.y + outer.height + epsilon
  );
}

function isPointInRect(
  point: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
  epsilon = 0.5
): boolean {
  return (
    point.x >= rect.x - epsilon &&
    point.y >= rect.y - epsilon &&
    point.x <= rect.x + rect.width + epsilon &&
    point.y <= rect.y + rect.height + epsilon
  );
}

// ─── Core: convert one Frame into a PPT slide ───

async function addFrameSlide(
  pptx: PptxGenJS,
  board: PlaitBoard,
  frame: PlaitFrame,
  children: PlaitElement[],
  options: ResolvedExportPPTOptions
): Promise<boolean> {
  const frameRect = RectangleClient.getRectangleByPoints(frame.points);
  const slide = pptx.addSlide();

  // Frame 背景图：用 addImage 铺满幻灯片并设置透明度，与画布预览保持一致（opacity=0.3）
  const backgroundUrl = frame.backgroundUrl;
  if (backgroundUrl) {
    try {
      const bgData = await ensureBase64Image(backgroundUrl);
      slide.addImage({
        data: bgData,
        x: 0,
        y: 0,
        w: '100%',
        h: '100%',
        transparency: 70,
      });
    } catch {}
  }

  const ordered = sortElementsByPosition(board, children as PlaitElement[]);

  // 字号缩放：画布 px → PPT pt（保持视觉比例一致）
  // 1920px 宽的画布映射到 10 英寸（720pt）宽的幻灯片
  const fontScale = (SLIDE_WIDTH * 72) / frameRect.width;

  // 兜底字号（按缩放后）
  const defaultBodyPt = Math.max(6, Math.round(18 * fontScale));

  for (const element of ordered) {
    try {
      if (PlaitGroupElement.isGroup(element)) {
        continue;
      }

      const rect = getRectangleByElements(board, [element], false);
      const pos = computeSlidePosition(rect, frameRect);

      if (await addMediaElementToSlide(slide, element, pos, options)) {
        continue;
      }

      // --- Image element ---
      if (isImageElement(board, element)) {
        if (shouldSkipMediaAsRasterImage(element)) {
          continue;
        }
        const url = (element as any).url || (element as any).image?.url;
        if (!url) continue;
        try {
          const data = await ensureBase64Image(url);
          slide.addImage({ data, x: pos.x, y: pos.y, w: pos.w, h: pos.h });
        } catch {}
        continue;
      }

      // --- Geometry shape（须先于 isTextElement：形状工具创建的图形也带 Slate 的 element.text，空文案时走文本分支会既不 addText 也不 addShape）---
      if (
        PlaitDrawElement.isGeometry?.(element) &&
        !PlaitDrawElement.isText?.(element)
      ) {
        const shape = (element as any).shape || 'rectangle';
        const shapeType = mapShapeType(pptx, shape);
        const fillOpts = getElementFillOpts(board, element);
        const lineOpts = getElementLineOpts(board, element, frameRect.width);

        const baseOpts: Record<string, any> = {
          x: pos.x,
          y: pos.y,
          w: pos.w,
          h: pos.h,
          ...fillOpts,
          ...lineOpts,
        };

        const angle = (element as any).angle;
        if (typeof angle === 'number' && !Number.isNaN(angle) && angle !== 0) {
          baseOpts.rotate = angle;
        }

        if (
          shape === 'roundRectangle' ||
          shape === 'roundedRectangle' ||
          shape === 'round_rectangle'
        ) {
          baseOpts.rectRadius = 0.2;
        }

        const rich = extractElementRichText(element, fontScale);
        const plainText = extractTextFromElement(element, board);
        const isSingle = isShortSingleLine(plainText);
        if (rich) {
          slide.addText(rich.rows, {
            ...baseOpts,
            shape: shapeType,
            valign: 'middle',
            align: rich.align || 'center',
            wrap: !isSingle,
            fontFace: DEFAULT_FONT_FACE,
          });
        } else if (plainText) {
          slide.addText(buildPlainTextRows(plainText, defaultBodyPt), {
            ...baseOpts,
            shape: shapeType,
            valign: 'middle',
            align: 'center',
            wrap: !isSingle,
            fontFace: DEFAULT_FONT_FACE,
          });
        } else {
          slide.addShape(shapeType, baseOpts);
        }
        continue;
      }

      // --- PlaitText / 纯文本（排除已处理的几何形状）---
      if (isTextElement(board, element)) {
        const rawText = extractPlainTextWithLineBreaks(element, board);
        const isSingle = isShortSingleLine(rawText);
        const autoWrap = shouldEnableAutoWrap(rawText, isSingle);
        // 仅在允许自动换行时做轻微宽度冗余；手动换行时保持与画布等宽
        const textPos = computeSlidePosition(
          rect,
          frameRect,
          autoWrap ? 1.12 : 1
        );
        const rich = extractElementRichText(element, fontScale);
        if (rich) {
          slide.addText(rich.rows, {
            x: textPos.x,
            y: textPos.y,
            w: textPos.w,
            h: textPos.h,
            valign: 'top',
            wrap: autoWrap,
            align: rich.align || 'left',
            fontFace: DEFAULT_FONT_FACE,
            margin: 0,
            fit: 'none',
          });
        } else if (rawText) {
          const fallback = extractFallbackTextStyle(
            element,
            fontScale,
            defaultBodyPt,
            'left'
          );
          slide.addText(
            buildPlainTextRows(rawText, fallback.fontSizePt || defaultBodyPt),
            {
              x: textPos.x,
              y: textPos.y,
              w: textPos.w,
              h: textPos.h,
              valign: 'top',
              wrap: autoWrap,
              align: fallback.align || 'left',
              fontFace: DEFAULT_FONT_FACE,
              margin: 0,
              fit: 'none',
            }
          );
        }
        continue;
      }

      // --- Arrow line / Vector line ---
      if (
        PlaitDrawElement.isArrowLine?.(element) ||
        PlaitDrawElement.isVectorLine?.(element)
      ) {
        const points = (element as any).points;
        if (!points || points.length < 2) continue;

        const startPt = points[0] as [number, number];
        const endPt = points[points.length - 1] as [number, number];

        const sx = ((startPt[0] - frameRect.x) / frameRect.width) * SLIDE_WIDTH;
        const sy =
          ((startPt[1] - frameRect.y) / frameRect.height) * SLIDE_HEIGHT;
        const ex = ((endPt[0] - frameRect.x) / frameRect.width) * SLIDE_WIDTH;
        const ey = ((endPt[1] - frameRect.y) / frameRect.height) * SLIDE_HEIGHT;

        const strokeColor = toPptColor(getCurrentStrokeColor(board, element));
        const lineProps: Record<string, any> = {
          color: strokeColor || '333333',
          width: canvasStrokeWidthToPptPt(
            getStrokeWidthByElement(element as any),
            frameRect.width
          ),
        };

        if (PlaitDrawElement.isArrowLine?.(element)) {
          const source = (element as any).source;
          const target = (element as any).target;
          if (source?.marker && source.marker !== 'none') {
            lineProps.beginArrowType = 'triangle';
          }
          if (!target?.marker || target.marker !== 'none') {
            lineProps.endArrowType = 'triangle';
          }
        }

        slide.addShape(pptx.ShapeType.line, {
          x: Math.min(sx, ex),
          y: Math.min(sy, ey),
          w: Math.abs(ex - sx) || 0.01,
          h: Math.abs(ey - sy) || 0.01,
          flipH: ex < sx,
          flipV: ey < sy,
          line: lineProps,
        });
        continue;
      }

      // --- Freehand (画笔)：custGeom 折线/多边形 ---
      if (Freehand.isFreehand(element)) {
        const freehand = element as Freehand;
        const points = freehand.points;
        if (!points || points.length < 2) continue;

        const freehandRect = getFreehandRectangle(freehand);
        const fhPos = computeSlidePosition(freehandRect, frameRect);
        const strokeColor = toPptColor(getCurrentStrokeColor(board, element));
        const lineOpts = {
          color: strokeColor || '333333',
          width: canvasStrokeWidthToPptPt(
            getStrokeWidthByElement(freehand as any),
            frameRect.width
          ),
        };

        // 将画布坐标转为形状局部坐标（与 ppt 形状 w×h 同单位）
        const toLocal = (p: [number, number]) => ({
          x: ((p[0] - freehandRect.x) / freehandRect.width) * fhPos.w,
          y: ((p[1] - freehandRect.y) / freehandRect.height) * fhPos.h,
        });

        const pathPoints: CustGeomPoint[] = [];
        pathPoints.push({ ...toLocal(points[0]), moveTo: true });
        for (let i = 1; i < points.length; i++) {
          pathPoints.push(toLocal(points[i]));
        }
        if (isClosedPoints(points)) {
          pathPoints.push({ close: true });
        }

        slide.addShape((pptx as any).ShapeType.custGeom, {
          x: fhPos.x,
          y: fhPos.y,
          w: fhPos.w,
          h: fhPos.h,
          line: lineOpts,
          fill: { color: 'FFFFFF', transparency: 100 },
          points: pathPoints,
        });
        continue;
      }

      // --- PenPath（钢笔/布尔生成的矢量形状）：custGeom 近似 ---
      if (PenPath.isPenPath(element)) {
        const pen = element as PenPath;
        const absoluteAnchors = getAbsoluteAnchors(pen);
        if (!absoluteAnchors.length) continue;

        const penRect = getPenPathRectangle(pen);
        const penPos = computeSlidePosition(penRect, frameRect);

        const strokeColor = toPptColor(getCurrentStrokeColor(board, element));
        const line = {
          color: strokeColor || '333333',
          width: canvasStrokeWidthToPptPt(
            getStrokeWidthByElement(pen as any),
            frameRect.width
          ),
        };

        const fillColor = toPptColor(pen.fill);
        const fill =
          pen.closed && fillColor
            ? { color: fillColor }
            : { color: 'FFFFFF', transparency: 100 };

        // 贝塞尔曲线按采样点近似为折线（PPT 兼容 & 实现简单）
        const samples = getPathSamplePoints(absoluteAnchors, pen.closed, 12);
        if (samples.length < 2) continue;

        const toLocal = (p: [number, number]) => ({
          x: ((p[0] - penRect.x) / penRect.width) * penPos.w,
          y: ((p[1] - penRect.y) / penRect.height) * penPos.h,
        });

        const pathPoints: CustGeomPoint[] = [];
        pathPoints.push({
          ...toLocal(samples[0] as [number, number]),
          moveTo: true,
        });
        for (let i = 1; i < samples.length; i++) {
          pathPoints.push(toLocal(samples[i] as [number, number]));
        }
        if (pen.closed) {
          pathPoints.push({ close: true });
        }

        slide.addShape((pptx as any).ShapeType.custGeom, {
          x: penPos.x,
          y: penPos.y,
          w: penPos.w,
          h: penPos.h,
          line,
          fill,
          points: pathPoints,
        });
        continue;
      }

      // --- Mind element ---
      if (MindElement.isMindElement?.(board, element)) {
        const rich = extractElementRichText(element, fontScale);
        const text = extractTextFromElement(element, board);
        const isSingle = isShortSingleLine(text);
        if (rich) {
          slide.addText(rich.rows, {
            x: pos.x,
            y: pos.y,
            w: pos.w,
            h: pos.h,
            valign: 'middle',
            wrap: !isSingle,
            fontFace: DEFAULT_FONT_FACE,
          });
        } else if (text) {
          slide.addText(buildPlainTextRows(text, defaultBodyPt), {
            x: pos.x,
            y: pos.y,
            w: pos.w,
            h: pos.h,
            valign: 'middle',
            wrap: !isSingle,
            fontFace: DEFAULT_FONT_FACE,
          });
        }
        continue;
      }

      // --- Fallback ---
      const richFallback = extractElementRichText(element, fontScale);
      const fallbackText = extractTextFromElement(element, board);
      const isSingle = isShortSingleLine(fallbackText);
      const autoWrap = shouldEnableAutoWrap(fallbackText, isSingle);
      if (richFallback) {
        slide.addText(richFallback.rows, {
          x: pos.x,
          y: pos.y,
          w: pos.w,
          h: pos.h,
          valign: 'top',
          wrap: autoWrap,
          align: richFallback.align,
          fontFace: DEFAULT_FONT_FACE,
          margin: 0,
          fit: 'none',
        });
      } else if (fallbackText) {
        slide.addText(buildPlainTextRows(fallbackText, defaultBodyPt), {
          x: pos.x,
          y: pos.y,
          w: pos.w,
          h: pos.h,
          valign: 'top',
          wrap: autoWrap,
          fontFace: DEFAULT_FONT_FACE,
          margin: 0,
          fit: 'none',
        });
      }
    } catch (err) {
      void err;
    }
  }

  return true;
}

// ─── Public API ───

export async function exportFramesToPPT(
  board: PlaitBoard,
  frames: PlaitFrame[],
  options: ExportPPTOptions = {}
): Promise<void> {
  if (!frames.length) throw new Error('没有可导出的 PPT 页面');

  const sortedFrames = sortFramesForPPT(frames);
  const partition = partitionElementsByExportFrames(board, sortedFrames);
  const { default: PptxGen } = await import('pptxgenjs');
  const pptx = new PptxGen();
  const resolvedOptions = resolveExportPPTOptions(options);

  let addedCount = 0;
  for (const frame of sortedFrames) {
    const slideChildren = partition.get(frame.id) ?? [];
    const ok = await addFrameSlide(
      pptx,
      board,
      frame,
      slideChildren,
      resolvedOptions
    );
    if (ok) addedCount += 1;
  }

  if (addedCount === 0) throw new Error('PPT 导出失败：没有生成任何页面');

  const baseName =
    options.fileName ||
    (sortedFrames.length === 1 && sortedFrames[0].name
      ? sortedFrames[0].name
      : 'aitu-ppt');
  const fileName = normalizePPTFileName(baseName);
  const transitions = sortedFrames.map(getFramePPTTransition);

  if (!transitions.some(hasPPTSlideTransition)) {
    const pptxData = await pptx.write({ outputType: 'blob' });
    await downloadPPTXBlob(toPPTXBlob(pptxData), fileName);
    return;
  }

  const pptxData = await pptx.write({ outputType: 'blob' });
  const pptxBlob = toPPTXBlob(pptxData);
  const outputBlob = await injectPPTSlideTransitions(pptxBlob, transitions);
  await downloadPPTXBlob(outputBlob, fileName);
}

export async function exportAllPPTFrames(
  board: PlaitBoard,
  options: ExportPPTOptions = {}
): Promise<void> {
  const allFrames = collectAllFramesFromBoard(board);
  if (!allFrames.length) throw new Error('当前画布没有可导出的 PPT 页面');
  await exportFramesToPPT(board, allFrames, options);
}
