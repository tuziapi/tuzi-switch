import type {
  ComicExportManifest,
  ComicExportManifestPage,
  ComicExportOptions,
  ComicImageExportSource,
  ComicRecord,
} from './types';
import { formatComicMarkdown } from './utils';

interface DownloadUtilsModule {
  downloadFromBlob: (blob: Blob, filename: string) => void;
  getFileExtension: (url: string, mimeType?: string) => string;
  normalizeImageDataUrl: (value: string, fallbackMimeType?: string) => string;
  processBatchWithConcurrency: <T, R>(
    items: T[],
    handler: (item: T, index: number) => Promise<R>,
    concurrency?: number
  ) => Promise<R[]>;
}

interface JSZipLike {
  file: (path: string, data: Blob | string) => void;
  generateAsync: (options: { type: 'blob' }) => Promise<Blob>;
}

interface JSZipCtor {
  new (): JSZipLike;
}

interface PptxLike {
  layout?: string;
  author?: string;
  subject?: string;
  title?: string;
  defineLayout?: (layout: {
    name: string;
    width: number;
    height: number;
  }) => void;
  addSlide: () => {
    addText: (text: string, options?: Record<string, unknown>) => void;
    addImage?: (options: Record<string, unknown>) => void;
  };
  write: (options: { outputType: 'blob' }) => Promise<Blob>;
}

interface JsPdfLike {
  text: (
    text: string | string[],
    x: number,
    y: number,
    options?: unknown
  ) => void;
  addPage: (
    format?: [number, number],
    orientation?: 'portrait' | 'landscape'
  ) => void;
  addImage?: (...args: unknown[]) => void;
  output: (type: 'blob') => Blob;
  splitTextToSize?: (text: string, maxWidth: number) => string[];
}

interface PageImageExportItem {
  page: ComicRecord['pages'][number];
  source: ComicImageExportSource;
}

interface Size {
  width: number;
  height: number;
}

async function loadDownloadUtils(): Promise<DownloadUtilsModule> {
  return import('@aitu/utils') as unknown as Promise<DownloadUtilsModule>;
}

async function loadJSZipModule(): Promise<{ default: JSZipCtor }> {
  return import('jszip') as unknown as Promise<{ default: JSZipCtor }>;
}

async function loadPptxModule(): Promise<{ default: new () => PptxLike }> {
  return import('pptxgenjs') as unknown as Promise<{
    default: new () => PptxLike;
  }>;
}

async function loadJsPdfModule(): Promise<{
  default: new (options?: Record<string, unknown>) => JsPdfLike;
}> {
  return import('jspdf') as unknown as Promise<{
    default: new (options?: Record<string, unknown>) => JsPdfLike;
  }>;
}

export function sanitizeComicFilenamePart(
  value: string,
  fallback = 'comic'
): string {
  const sanitized = String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return sanitized.slice(0, 80) || fallback;
}

export function buildComicExportBaseName(
  record: Pick<ComicRecord, 'title'>
): string {
  return sanitizeComicFilenamePart(record.title || 'comic', 'comic');
}

export function buildComicPageImageFilename(params: {
  pageNumber: number;
  title?: string;
  extension?: string;
  variantNumber?: number;
}): string {
  const pageNumber = Math.max(1, Math.floor(params.pageNumber || 1));
  const pageToken = String(pageNumber).padStart(2, '0');
  const variantNumber = Number.isFinite(params.variantNumber)
    ? Math.max(1, Math.floor(params.variantNumber || 1))
    : undefined;
  const variantToken = variantNumber ? `-${variantNumber}` : '';
  const title = sanitizeComicFilenamePart(
    params.title || '',
    ''
  )
    .replace(/^[|｜]\s*/, '')
    .trim();
  const titleToken = title ? ` ${title}` : '';
  const extension = sanitizeComicFilenamePart(params.extension || 'png', 'png');

  return `images/page-${pageToken}${titleToken}${variantToken}.${extension}`;
}

export function resolveComicImageExtension(source?: {
  url?: string;
  mimeType?: string;
}): string {
  const mimeType = String(source?.mimeType || '').toLowerCase();
  const mimeMatch = mimeType.match(/^image\/([a-z0-9.+-]+)$/);
  if (mimeMatch) {
    return mimeMatch[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  }

  const url = String(source?.url || '');
  const dataUrlMatch = url.match(/^data:image\/([a-z0-9.+-]+)[;,]/i);
  if (dataUrlMatch) {
    return dataUrlMatch[1]
      .toLowerCase()
      .replace('jpeg', 'jpg')
      .replace('svg+xml', 'svg');
  }

  try {
    const path =
      url.startsWith('/') || !url.includes('://') ? url : new URL(url).pathname;
    const extension = path.split('/').pop()?.split('.').pop()?.toLowerCase();
    if (extension && extension !== path && /^[a-z0-9]{1,5}$/.test(extension)) {
      return extension;
    }
  } catch {
    // Use default extension below.
  }

  return 'png';
}

function findImageSource(
  page: ComicRecord['pages'][number],
  imageSources: ComicImageExportSource[]
): ComicImageExportSource | undefined {
  return imageSources.find((source) => isPageImageSource(page, source));
}

function isPageImageSource(
  page: ComicRecord['pages'][number],
  source: ComicImageExportSource
): boolean {
  return (
    (!!source.pageId && source.pageId === page.id) ||
    (!!source.pageNumber && source.pageNumber === page.pageNumber)
  );
}

export function resolveComicImageSources(
  record: ComicRecord,
  imageSources?: ComicImageExportSource[]
): ComicImageExportSource[] {
  if (imageSources?.length) {
    return imageSources;
  }

  return record.pages
    .filter((page) => Boolean(page.imageUrl))
    .map((page) => ({
      pageId: page.id,
      pageNumber: page.pageNumber,
      url: page.imageUrl!,
      mimeType: page.imageMimeType,
      ...(record.imageParams?.size
        ? { aspectRatio: record.imageParams.size }
        : {}),
    }));
}

function parseAspectRatio(
  value: ComicImageExportSource['aspectRatio']
): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  const ratioMatch = trimmed.match(
    /^(\d+(?:\.\d+)?)\s*[:/xX]\s*(\d+(?:\.\d+)?)$/
  );
  if (ratioMatch) {
    const width = Number(ratioMatch[1]);
    const height = Number(ratioMatch[2]);
    return width > 0 && height > 0 ? width / height : undefined;
  }

  const numericValue = Number(trimmed);
  return Number.isFinite(numericValue) && numericValue > 0
    ? numericValue
    : undefined;
}

function getSourceAspectRatio(
  source?: ComicImageExportSource
): number | undefined {
  const width = Number(source?.width);
  const height = Number(source?.height);
  if (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    return width / height;
  }

  return parseAspectRatio(source?.aspectRatio);
}

function getPresentationAspectRatio(items: PageImageExportItem[]): number {
  return getSourceAspectRatio(items[0]?.source) || 16 / 9;
}

export function calculateContainRect(
  container: Size,
  content: Size
): Size & { x: number; y: number } {
  const safeContainerWidth = Math.max(0, container.width);
  const safeContainerHeight = Math.max(0, container.height);
  const contentRatio =
    content.width > 0 && content.height > 0
      ? content.width / content.height
      : 1;
  const containerRatio =
    safeContainerWidth > 0 && safeContainerHeight > 0
      ? safeContainerWidth / safeContainerHeight
      : contentRatio;

  if (contentRatio > containerRatio) {
    const width = safeContainerWidth;
    const height = width / contentRatio;
    return { x: 0, y: (safeContainerHeight - height) / 2, width, height };
  }

  const height = safeContainerHeight;
  const width = height * contentRatio;
  return { x: (safeContainerWidth - width) / 2, y: 0, width, height };
}

function getImageExportItems(
  record: ComicRecord,
  imageSources: ComicImageExportSource[]
) {
  return record.pages.map((page) => ({
    page,
    source: findImageSource(page, imageSources),
  }));
}

function getAllImageExportItems(
  record: ComicRecord,
  imageSources: ComicImageExportSource[]
): PageImageExportItem[] {
  return record.pages.flatMap((page) =>
    imageSources
      .filter((source) => isPageImageSource(page, source))
      .map((source) => ({ page, source }))
  );
}

function getRequiredImageExportItems(
  record: ComicRecord,
  imageSources: ComicImageExportSource[]
): PageImageExportItem[] {
  return getImageExportItems(record, imageSources).map((item) => {
    if (!item.source) {
      throw new Error(`第 ${item.page.pageNumber} 页缺少图片，无法导出`);
    }
    return { page: item.page, source: item.source };
  });
}

export function buildComicExportManifest(
  record: ComicRecord,
  options: Pick<ComicExportOptions, 'imageSources' | 'now'> = {}
): ComicExportManifest {
  const exportedAt = (options.now || new Date()).toISOString();
  const imageSources = resolveComicImageSources(record, options.imageSources);
  const pages: ComicExportManifestPage[] = record.pages.map((page) => {
    const source = findImageSource(page, imageSources);
    const extension = resolveComicImageExtension(source);
    const imageFilename = source
      ? buildComicPageImageFilename({
          pageNumber: page.pageNumber,
          title: page.title,
          extension,
        })
      : undefined;

    return {
      id: page.id,
      pageNumber: page.pageNumber,
      title: page.title,
      script: page.script,
      prompt: page.prompt,
      notes: page.notes,
      imageFilename,
      imageMimeType: source?.mimeType || page.imageMimeType,
    };
  });

  return {
    title: record.title,
    pageCount: record.pageCount,
    commonPrompt: record.commonPrompt,
    exportedAt,
    pages,
  };
}

export function buildComicExportFiles(
  record: ComicRecord,
  options?: ComicExportOptions
) {
  const manifest = buildComicExportManifest(record, options);
  return {
    baseName: options?.filename
      ? sanitizeComicFilenamePart(options.filename)
      : buildComicExportBaseName(record),
    manifest,
    manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
    markdown: formatComicMarkdown(record),
  };
}

async function fetchImageBlob(
  source: ComicImageExportSource,
  utils: Pick<DownloadUtilsModule, 'normalizeImageDataUrl'>
): Promise<Blob> {
  const url = utils.normalizeImageDataUrl(source.url);
  const response = await fetch(url, { referrerPolicy: 'no-referrer' });
  if (!response.ok) {
    throw new Error(`图片下载失败：${response.status}`);
  }
  return response.blob();
}

export async function exportComicAsZip(
  record: ComicRecord,
  options: ComicExportOptions = {}
): Promise<void> {
  const [{ default: JSZip }, utils] = await Promise.all([
    loadJSZipModule(),
    loadDownloadUtils(),
  ]);
  const files = buildComicExportFiles(record, options);
  const zip = new JSZip();

  zip.file('manifest.json', files.manifestJson);
  zip.file('script.md', files.markdown);

  const imageSources = resolveComicImageSources(record, options.imageSources);
  const manifestPageById = new Map(
    files.manifest.pages.map((page) => [page.id, page])
  );
  const imageTasks = getAllImageExportItems(record, imageSources)
    .map((item) => ({
      page: manifestPageById.get(item.page.id),
      source: item.source,
    }))
    .filter(
      (
        item
      ): item is {
        page: ComicExportManifestPage;
        source: ComicImageExportSource;
      } => Boolean(item.source && item.page?.imageFilename)
    );

  await utils.processBatchWithConcurrency(
    imageTasks,
    async ({ page, source }) => {
      const blob = await fetchImageBlob(source, utils);
      const filename =
        !source.variantNumber && page.imageFilename
          ? page.imageFilename
          : buildComicPageImageFilename({
              pageNumber: page.pageNumber,
              title: page.title,
              variantNumber: source.variantNumber,
              extension: utils.getFileExtension(
                source.url,
                blob.type || source.mimeType
              ),
            });
      zip.file(filename, blob);
    },
    Math.max(1, Math.min(3, options.imageConcurrency || 1))
  );

  const blob = await zip.generateAsync({ type: 'blob' });
  utils.downloadFromBlob(blob, `${files.baseName}.zip`);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });
}

function getPptxPageSize(items: PageImageExportItem[]): Size {
  const aspectRatio = getPresentationAspectRatio(items);
  const width = 10;
  return { width, height: width / aspectRatio };
}

function getPdfPageSize(items: PageImageExportItem[]): Size {
  const aspectRatio = getPresentationAspectRatio(items);
  const longSide = 297;
  return aspectRatio >= 1
    ? { width: longSide, height: longSide / aspectRatio }
    : { width: longSide * aspectRatio, height: longSide };
}

function getImageContentSize(
  source: ComicImageExportSource,
  fallbackAspectRatio: number
): Size {
  const aspectRatio = getSourceAspectRatio(source) || fallbackAspectRatio;
  return { width: aspectRatio, height: 1 };
}

function getImageFormat(mimeType?: string): string {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) {
    return 'JPEG';
  }
  if (normalized.includes('webp')) {
    return 'WEBP';
  }
  return 'PNG';
}

export async function exportComicAsPptx(
  record: ComicRecord,
  options: ComicExportOptions = {}
): Promise<void> {
  const [{ default: PptxGenJS }, utils] = await Promise.all([
    loadPptxModule(),
    loadDownloadUtils(),
  ]);
  const files = buildComicExportFiles(record, options);
  const imageSources = resolveComicImageSources(record, options.imageSources);
  const imageItems = getRequiredImageExportItems(record, imageSources);
  const pageSize = getPptxPageSize(imageItems);
  const pptx = new PptxGenJS();
  pptx.defineLayout?.({
    name: 'COMIC_IMAGE_ONLY',
    width: pageSize.width,
    height: pageSize.height,
  });
  pptx.layout = 'COMIC_IMAGE_ONLY';
  pptx.author = 'Aitu';
  pptx.subject = 'Comic export';
  pptx.title = record.title;

  for (const { source } of imageItems) {
    const blob = await fetchImageBlob(source, utils);
    const data = await blobToDataUrl(blob);
    const slide = pptx.addSlide();
    const rect = calculateContainRect(
      pageSize,
      getImageContentSize(source, pageSize.width / pageSize.height)
    );
    slide.addImage?.({
      data,
      x: rect.x,
      y: rect.y,
      w: rect.width,
      h: rect.height,
    });
  }

  const blob = await pptx.write({ outputType: 'blob' });
  utils.downloadFromBlob(blob, `${files.baseName}.pptx`);
}

export async function exportComicAsPdf(
  record: ComicRecord,
  options: ComicExportOptions = {}
): Promise<void> {
  const [{ default: JsPDF }, utils] = await Promise.all([
    loadJsPdfModule(),
    loadDownloadUtils(),
  ]);
  const files = buildComicExportFiles(record, options);
  const imageSources = resolveComicImageSources(record, options.imageSources);
  const imageItems = getRequiredImageExportItems(record, imageSources);
  const pageSize = getPdfPageSize(imageItems);
  const orientation =
    pageSize.width >= pageSize.height ? 'landscape' : 'portrait';
  const doc = new JsPDF({
    unit: 'mm',
    format: [pageSize.width, pageSize.height],
    orientation,
  });

  for (let index = 0; index < imageItems.length; index += 1) {
    const { source } = imageItems[index];
    if (index > 0) {
      doc.addPage([pageSize.width, pageSize.height], orientation);
    }
    const blob = await fetchImageBlob(source, utils);
    const data = await blobToDataUrl(blob);
    const rect = calculateContainRect(
      pageSize,
      getImageContentSize(source, pageSize.width / pageSize.height)
    );
    doc.addImage?.(
      data,
      getImageFormat(blob.type || source.mimeType),
      rect.x,
      rect.y,
      rect.width,
      rect.height
    );
  }

  utils.downloadFromBlob(doc.output('blob'), `${files.baseName}.pdf`);
}
