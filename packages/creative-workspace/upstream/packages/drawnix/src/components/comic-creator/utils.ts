import {
  COMIC_PARALLEL_CONCURRENCY_LIMIT,
  DEFAULT_COMIC_PAGE_COUNT,
  DEFAULT_COMIC_IMAGE_SIZE,
  MAX_COMIC_PAGE_COUNT,
  MIN_COMIC_PAGE_COUNT,
  type ComicRecord,
  type ComicPage,
  type ComicPageImageVariant,
  type ComicGenerationMode,
  type ComicPromptInputMode,
  type ComicScriptPayload,
} from './types';
import { buildVisualStructuredPromptSchemaInstruction } from '../../utils/visual-structured-prompt-schema';
import { extractJsonObject } from '../../utils/llm-json-extractor';

export function sanitizeComicPageCount(value: unknown): number {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_COMIC_PAGE_COUNT;
  }

  return Math.min(
    MAX_COMIC_PAGE_COUNT,
    Math.max(MIN_COMIC_PAGE_COUNT, Math.floor(numericValue))
  );
}

export function buildComicScriptPrompt(params: {
  userPrompt: string;
  pageCount?: unknown;
  stylePrompt?: string;
  inputMode?: ComicPromptInputMode;
  scenarioContext?: string;
  pdfAttachmentName?: string;
}): string {
  const pageCount = sanitizeComicPageCount(params.pageCount);
  const userPrompt = String(params.userPrompt || '').trim();
  const stylePrompt = String(params.stylePrompt || '').trim();
  const scenarioContext = String(params.scenarioContext || '').trim();
  const pdfAttachmentName = String(params.pdfAttachmentName || '').trim();
  const inputMode = params.inputMode || 'text';
  const languageInstruction = [
    '语言要求：',
    '- 自动识别用户创作需求的主要语言，并使用同一种语言输出 title、commonPrompt、pages[].title、pages[].script、pages[].prompt 和 notes。',
    '- 如果用户用中文提出需求，除 JSON 字段名、结构化对象键、品牌名、专有名词和必要技术标识外，所有可读内容都必须使用中文，不要把图片提示词改写成英文。',
    '- pages[].prompt 是生成页唯一主要编辑入口，必须自包含：同时写清本页主题、画面主体、构图、必要文案/信息点、风格和色彩，不要依赖 pages[].script 才能理解画面。',
    '- pages[].prompt 不要以「整套连环画统一设定」等全局设定开头；公共视觉基准放在 commonPrompt，每页 prompt 只写本页对应的场景引导和画面要求。',
    '- 后续页面要延续创作场景和前文视觉/叙事语气，但必须给出本页独立的画面主体、构图、信息重点和情绪/文案引导。',
  ].join('\n');
  const pdfSection = pdfAttachmentName
    ? [
        `参考 PDF：本次请求附带 PDF「${pdfAttachmentName}」。`,
        '- 请优先阅读 PDF 内容，提取其中的事实信息、品牌/产品定位、结构层级、关键词、视觉线索和可转化为页面的重点。',
        '- 用户创作需求用于限定目标和取舍；PDF 是主要素材来源。若两者冲突，以用户创作需求为准。',
        '- 不要只复述 PDF 原文，要把 PDF 信息重组为适合当前创作场景的多页图文方案。',
      ].join('\n')
    : '';
  const promptFormatInstruction =
    inputMode === 'json'
      ? [
          '提示词类型：结构化 JSON 提示词。',
          '- pages[].prompt 必须生成给图片模型使用的结构化 JSON，可直接返回对象，也可返回 JSON 字符串。',
          '- 结构化 JSON 的字段名可保持英文，但所有字符串取值必须遵守语言要求。',
          '- commonPrompt 可使用结构化对象描述全局视觉一致性，重点包含系列统一风格、色板、字体、角色/品牌一致性。',
          '- 不要把用户输入当成 JSON schema 原样补全；请结合用户需求和 PDF 内容重新策划。',
          buildVisualStructuredPromptSchemaInstruction('zh'),
        ].join('\n')
      : [
          '提示词类型：文本提示词。',
          '- commonPrompt 和 pages[].prompt 使用自然语言图片提示词，表达完整画面、风格和一致性要求。',
          '- pages[].prompt 必须是可直接送给图片模型的完整单页提示词。',
        ].join('\n');

  return `你是多页图文内容策划和图像提示词工程师。请根据用户创作需求、创作场景和参考资料，规划 ${pageCount} 页可生成图片的图文方案，并只返回合法 JSON。

用户创作需求：
${userPrompt || '围绕一个完整主题创作多页连环图文。'}

${pdfSection ? `${pdfSection}\n` : ''}

${scenarioContext ? `${scenarioContext}\n` : ''}
${stylePrompt ? `风格补充：\n${stylePrompt}\n` : ''}
${languageInstruction}

JSON 字段要求：
- title: 作品标题
- commonPrompt: 所有页面共用的角色、画风、时代、色彩、构图一致性提示词
- pages: 长度为 ${pageCount} 的数组，每项包含 title、script、prompt，可选 notes

${promptFormatInstruction}

输出要求：
1. 只返回 JSON，不要 markdown。
2. pages 必须严格为 ${pageCount} 页。
3. script 写本页文案、页面说明或画面内容，prompt 写给图像模型的单页画面提示词。
4. commonPrompt 不要重复塞进每页 prompt，但每页 prompt 要能独立表达画面。`;
}

export function parseStructuredComicPrompt(value: string): unknown {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error('请输入结构化 JSON');
  }

  const parsed = JSON.parse(trimmed);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('结构化 JSON 须为对象');
  }
  return parsed;
}

export function normalizeStructuredComicPrompt(value: string): string {
  return JSON.stringify(parseStructuredComicPrompt(value), null, 2);
}

function toCleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toPromptString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  }
  return '';
}

export function formatComicPromptPreview(
  value: unknown,
  fallback = '未生成'
): { text: string; isJson: boolean } {
  const text = toPromptString(value);
  if (!text) {
    return { text: fallback, isJson: false };
  }

  if (!/^[{[]/.test(text)) {
    return { text, isJson: false };
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') {
      return { text, isJson: false };
    }
    return { text: JSON.stringify(parsed, null, 2), isJson: true };
  } catch {
    return { text, isJson: false };
  }
}

export function normalizeComicPageTitle(
  value: unknown,
  pageNumber: number
): string {
  let title = toCleanString(value);
  const prefixPattern = /^第\s*\d+\s*页\s*[：:、,，.\-\s]*/;
  while (prefixPattern.test(title)) {
    title = title.replace(prefixPattern, '').trim();
  }
  return title || `第 ${pageNumber} 页（待补全）`;
}

export function parseComicScriptResponse(
  text: string,
  expectedPageCount?: unknown
): ComicScriptPayload {
  const parsed = extractJsonObject<Partial<ComicScriptPayload>>(
    text,
    value => Array.isArray((value as Partial<ComicScriptPayload>).pages)
  );
  const requestedCount = sanitizeComicPageCount(expectedPageCount);
  const rawPages = Array.isArray(parsed.pages) ? parsed.pages : [];
  const pages = rawPages.slice(0, requestedCount).map((page, index) => ({
    title: normalizeComicPageTitle(page?.title, index + 1),
    script: toCleanString(page?.script),
    prompt: toPromptString(page?.prompt),
    notes: toCleanString(page?.notes),
  }));

  while (pages.length < requestedCount) {
    const pageNumber = pages.length + 1;
    pages.push({
      title: `第 ${pageNumber} 页（待补全）`,
      script: '',
      prompt: '',
      notes: '',
    });
  }

  return {
    title: toCleanString(parsed.title) || '未命名连环画',
    commonPrompt: toPromptString(parsed.commonPrompt),
    pages,
  };
}

export function createComicPages(payload: ComicScriptPayload): ComicPage[] {
  return payload.pages.map((page, index) => {
    const pageNumber = index + 1;
    return {
      id: `page-${String(pageNumber).padStart(2, '0')}`,
      pageNumber,
      title: normalizeComicPageTitle(page.title, pageNumber),
      script: toCleanString(page.script),
      prompt: toPromptString(page.prompt),
      notes: toCleanString(page.notes) || undefined,
      status: 'draft',
    };
  });
}

export function buildComicImagePrompt(params: {
  commonPrompt?: string;
  pagePrompt?: string;
  script?: string;
  title?: string;
  pageNumber?: number;
  pageCount?: number;
  size?: string;
}): string {
  const commonPrompt = trimMarkdownCell(params.commonPrompt || '');
  const pagePrompt = trimMarkdownCell(params.pagePrompt || '');
  const script = trimMarkdownCell(params.script || '');
  const title = trimMarkdownCell(params.title || '');
  const pageNumber = Math.max(1, Math.floor(params.pageNumber || 1));
  const pageCount = sanitizeComicPageCount(params.pageCount || pageNumber);
  const size = trimMarkdownCell(params.size || DEFAULT_COMIC_IMAGE_SIZE);

  return [
    commonPrompt ? `【创作场景基准】\n${commonPrompt}` : '',
    `【当前页场景】第 ${pageNumber}/${pageCount} 页${
      title ? `：${title}` : ''
    }`,
    script ? `【本页内容引导】\n${script}` : '',
    pagePrompt ? `【本页图像提示词】\n${pagePrompt}` : '',
    `【画面要求】画幅 ${size}，整页连环画成品图，文字如需出现必须自然融入画面，不要出现提示词字段名、JSON 或说明文字。`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function getComicGenerationConcurrency(
  mode: ComicGenerationMode,
  selectedCount: number
): number {
  if (selectedCount <= 0) return 0;
  if (mode === 'serial') return 1;
  return Math.min(COMIC_PARALLEL_CONCURRENCY_LIMIT, selectedCount);
}

export function getComicPagesForGeneration(params: {
  pages: ComicPage[];
  selectedPageIds?: Set<string>;
  singlePageId?: string;
}): ComicPage[] {
  const selectedPageIds = params.selectedPageIds || new Set<string>();
  return params.pages
    .filter((page) =>
      params.singlePageId
        ? page.id === params.singlePageId
        : selectedPageIds.has(page.id)
    )
    .slice()
    .sort((left, right) => left.pageNumber - right.pageNumber);
}

type ComicPageImageVariantInput = Omit<ComicPageImageVariant, 'id'> & {
  id?: string;
};

function isDataImageUrl(url?: string): boolean {
  return typeof url === 'string' && url.startsWith('data:');
}

function normalizeImageVariant(
  variant: ComicPageImageVariantInput,
  fallbackIndex: number
): ComicPageImageVariant | null {
  const url = String(variant.url || '').trim();
  if (!url || isDataImageUrl(url)) return null;

  return {
    id:
      variant.id ||
      variant.taskId ||
      `${url}-${variant.generatedAt || ''}-${fallbackIndex}`,
    url,
    mimeType: variant.mimeType,
    generatedAt: variant.generatedAt,
    taskId: variant.taskId,
  };
}

export function getComicImageMimeType(format?: string): string | undefined {
  const value = String(format || '').trim();
  if (!value) return undefined;
  return value.includes('/') ? value : `image/${value}`;
}

export function buildComicPageImageVariantsFromResult(params: {
  taskId?: string;
  url?: string;
  urls?: string[];
  format?: string;
  generatedAt?: number;
}): ComicPageImageVariant[] {
  const urls =
    Array.isArray(params.urls) && params.urls.length > 0
      ? params.urls
      : params.url
      ? [params.url]
      : [];
  const mimeType = getComicImageMimeType(params.format);

  return urls
    .map((url, index) =>
      normalizeImageVariant(
        {
          id: params.taskId
            ? index === 0
              ? params.taskId
              : `${params.taskId}-${index + 1}`
            : undefined,
          url,
          mimeType,
          generatedAt: params.generatedAt,
          taskId: params.taskId,
        },
        index
      )
    )
    .filter((variant): variant is ComicPageImageVariant => !!variant);
}

export function getComicPageImageVariants(
  page: ComicPage
): ComicPageImageVariant[] {
  const variants = Array.isArray(page.imageVariants) ? page.imageVariants : [];
  const normalized = variants
    .map((variant, index) => normalizeImageVariant(variant, index))
    .filter((variant): variant is ComicPageImageVariant => !!variant);

  if (page.imageUrl && !isDataImageUrl(page.imageUrl)) {
    const legacyVariant = normalizeImageVariant(
      {
        id: `${page.id}-current-${page.imageGeneratedAt || normalized.length}`,
        url: page.imageUrl,
        mimeType: page.imageMimeType,
        generatedAt: page.imageGeneratedAt,
      },
      normalized.length
    );
    if (legacyVariant) normalized.push(legacyVariant);
  }

  const seenUrls = new Set<string>();
  return normalized.filter((variant) => {
    if (seenUrls.has(variant.url)) return false;
    seenUrls.add(variant.url);
    return true;
  });
}

export function getComicGeneratedPageCount(
  record?: Pick<ComicRecord, 'pages'> | null
): number {
  return (
    record?.pages.filter((page) => getComicPageImageVariants(page).length > 0)
      .length || 0
  );
}

export function getComicGeneratedImageCount(
  record?: Pick<ComicRecord, 'pages'> | null
): number {
  return (
    record?.pages.reduce(
      (count, page) => count + getComicPageImageVariants(page).length,
      0
    ) || 0
  );
}

export function appendComicPageImageVariants(
  page: ComicPage,
  variants: ComicPageImageVariantInput[]
): ComicPage {
  const existing = getComicPageImageVariants(page);
  const seenUrls = new Set(existing.map((variant) => variant.url));
  const nextVariants = [...existing];

  variants.forEach((variant, index) => {
    const normalized = normalizeImageVariant(variant, existing.length + index);
    if (!normalized || seenUrls.has(normalized.url)) return;
    seenUrls.add(normalized.url);
    nextVariants.push(normalized);
  });

  const latest = nextVariants[nextVariants.length - 1];
  return {
    ...page,
    imageVariants: nextVariants.length > 0 ? nextVariants : undefined,
    imageUrl: latest?.url || page.imageUrl,
    imageMimeType: latest?.mimeType || page.imageMimeType,
    imageGeneratedAt: latest?.generatedAt || page.imageGeneratedAt,
  };
}

export function selectComicPageImageVariant(
  page: ComicPage,
  variantId: string
): ComicPage {
  const variants = getComicPageImageVariants(page);
  const variant = variants.find((item) => item.id === variantId);
  if (!variant) return page;

  return {
    ...page,
    imageVariants: variants,
    imageUrl: variant.url,
    imageMimeType: variant.mimeType,
    imageGeneratedAt: variant.generatedAt,
  };
}

function trimMarkdownCell(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

export function formatComicMarkdown(params: {
  title: string;
  commonPrompt?: string;
  pages: Array<
    Pick<ComicPage, 'pageNumber' | 'title' | 'script' | 'prompt' | 'notes'>
  >;
}): string {
  const lines: string[] = [
    `# ${trimMarkdownCell(params.title) || '未命名连环画'}`,
  ];
  const commonPrompt = trimMarkdownCell(params.commonPrompt || '');

  if (commonPrompt) {
    lines.push('', '## 通用提示词', '', commonPrompt);
  }

  lines.push('', '## 分页脚本');

  for (const page of params.pages) {
    lines.push(
      '',
      `### 第 ${page.pageNumber} 页：${
        trimMarkdownCell(page.title) || '未命名'
      }`,
      '',
      '#### 脚本',
      '',
      trimMarkdownCell(page.script) || '（空）',
      '',
      '#### 图像提示词',
      '',
      trimMarkdownCell(page.prompt) || '（空）'
    );

    const notes = trimMarkdownCell(page.notes || '');
    if (notes) {
      lines.push('', '#### 备注', '', notes);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function stripLargeImageDataFromComicPage(page: ComicPage): ComicPage {
  const imageVariants = getComicPageImageVariants(page);

  if (!isDataImageUrl(page.imageUrl)) {
    return {
      ...page,
      imageVariants: imageVariants.length > 0 ? imageVariants : undefined,
    };
  }

  const { imageUrl, ...rest } = page;
  return {
    ...rest,
    imageVariants: imageVariants.length > 0 ? imageVariants : undefined,
  };
}
