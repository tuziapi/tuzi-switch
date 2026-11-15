import type { ModelRef } from '../../utils/settings-manager';
import { AI_GENERATION_CONCURRENCY_LIMIT } from '../../constants/TASK_CONSTANTS';

export const DEFAULT_COMIC_PAGE_COUNT = 6;
export const MIN_COMIC_PAGE_COUNT = 1;
export const MAX_COMIC_PAGE_COUNT = 60;
export const DEFAULT_COMIC_IMAGE_SIZE = '16x9';
export const COMIC_PARALLEL_CONCURRENCY_LIMIT =
  AI_GENERATION_CONCURRENCY_LIMIT;

export type ComicPageStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type ComicGenerationMode = 'serial' | 'parallel';
export type ComicPromptInputMode = 'text' | 'json';

export interface ComicScenarioPreset {
  id: string;
  label: string;
  category: string;
  description: string;
  audience: string;
  style: string;
  pageFocus: string[];
  textPrompt: string;
  jsonPrompt: string;
}

export interface ComicPage {
  id: string;
  pageNumber: number;
  title: string;
  script: string;
  prompt: string;
  notes?: string;
  status?: ComicPageStatus;
  taskId?: string | null;
  taskIds?: string[] | null;
  imageUrl?: string;
  imageMimeType?: string;
  imageGeneratedAt?: number;
  imageVariants?: ComicPageImageVariant[];
  error?: string;
}

export interface ComicPageImageVariant {
  id: string;
  url: string;
  mimeType?: string;
  generatedAt?: number;
  taskId?: string;
}

export interface ComicRecord {
  id: string;
  starred: boolean;
  title: string;
  sourcePrompt: string;
  commonPrompt: string;
  pageCount: number;
  pages: ComicPage[];
  textModel?: string;
  textModelRef?: ModelRef | null;
  imageModel?: string;
  imageModelRef?: ModelRef | null;
  imageParams?: Record<string, string>;
  generationMode?: ComicGenerationMode;
  sourcePromptMode?: ComicPromptInputMode;
  scenarioId?: string;
  pendingOutlineTaskId?: string | null;
  outlineError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ComicScriptPageInput {
  title?: unknown;
  script?: unknown;
  prompt?: unknown;
  notes?: unknown;
}

export interface ComicScriptPayload {
  title: string;
  commonPrompt: string;
  pages: ComicScriptPageInput[];
}

export interface ComicImageExportSource {
  pageId?: string;
  pageNumber?: number;
  url: string;
  mimeType?: string;
  width?: number;
  height?: number;
  aspectRatio?: number | string;
  variantNumber?: number;
}

export interface ComicExportManifestPage {
  pageNumber: number;
  id: string;
  title: string;
  script: string;
  prompt: string;
  notes?: string;
  imageFilename?: string;
  imageMimeType?: string;
}

export interface ComicExportManifest {
  title: string;
  pageCount: number;
  commonPrompt: string;
  exportedAt: string;
  pages: ComicExportManifestPage[];
}

export interface ComicExportOptions {
  filename?: string;
  imageSources?: ComicImageExportSource[];
  imageConcurrency?: number;
  now?: Date;
}
