import { TaskStatus, TaskType } from '../types/task.types';
import {
  taskStorageReader,
  type PromptHistoryTaskSummary,
} from './task-storage-reader';
import {
  promptStorageService,
  type PromptHistoryItem,
  type PromptType,
} from './prompt-storage-service';
import { stripKnowledgeContextFromPrompt } from './generation-context-service';

export type PromptHistoryCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'agent'
  | 'ppt-common'
  | 'ppt-slide';

export type PromptHistoryResultPreview =
  | {
      kind: 'image';
      url: string;
      title?: string;
    }
  | {
      kind: 'video';
      url: string;
      posterUrl?: string;
      title?: string;
      duration?: number;
    }
  | {
      kind: 'audio';
      url?: string;
      coverUrl?: string;
      title?: string;
      text?: string;
      duration?: number;
    }
  | {
      kind: 'text';
      text: string;
      title?: string;
    }
  | {
      kind: 'error';
      text: string;
    }
  | {
      kind: 'none';
      text: string;
    };

export interface PromptHistoryRecord {
  id: string;
  taskId: string;
  taskIds: string[];
  sourceSentPrompt: string;
  sourceSentPrompts: string[];
  category: PromptHistoryCategory;
  status: TaskStatus;
  title: string;
  initialPrompt: string;
  sentPrompt: string;
  tags: string[];
  skillId?: string;
  skillName?: string;
  model?: string;
  createdAt: number;
  completedAt?: number;
  resultPreview: PromptHistoryResultPreview;
  resultPreviews: PromptHistoryResultPreview[];
  resultCount: number;
  pinned: boolean;
}

export interface PromptHistoryQuery {
  category?: PromptHistoryCategory | 'all';
  skillTag?: string | 'all';
  search?: string;
  offset?: number;
  limit?: number;
}

export interface PromptHistoryPage {
  records: PromptHistoryRecord[];
  nextOffset: number;
  hasMore: boolean;
  total: number;
  skillTags: string[];
}

export interface CreatePromptHistoryRecordInput {
  content: string;
  title?: string;
  tags?: string[];
  category?: PromptHistoryCategory;
  modelType?: PromptType;
  pinned?: boolean;
  hasSelection?: boolean;
}

const DEFAULT_PAGE_LIMIT = 30;
const READ_BATCH_SIZE = 80;
const TITLE_LIMIT = 20;
const MAX_PROMPT_META_LENGTH = 2000;

function compactText(value: unknown, limit = MAX_PROMPT_META_LENGTH): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, limit);
}

function uniqueTags(tags: Array<string | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  tags.forEach((tag) => {
    const normalized = compactText(tag, 60);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}

export function buildPromptHistoryTitle(
  initialPrompt: string,
  sentPrompt: string,
  explicitTitle?: string
): string {
  const title = compactText(explicitTitle, 80);
  if (title) {
    return title;
  }

  const initial = compactText(initialPrompt, 120);
  const sent = compactText(sentPrompt, 120);
  if (initial && sent && initial !== sent) {
    return initial;
  }

  return (sent || initial || '未命名提示词').slice(0, TITLE_LIMIT);
}

export function inferPromptHistoryCategory(
  task: PromptHistoryTaskSummary
): PromptHistoryCategory {
  const metaCategory = task.params.promptMeta?.category;
  if (metaCategory) {
    return metaCategory;
  }

  if (task.params.pptSlideImage || task.params.pptSlidePrompt?.trim()) {
    return 'ppt-slide';
  }

  if (task.type === TaskType.IMAGE) return 'image';
  if (task.type === TaskType.VIDEO) return 'video';
  if (task.type === TaskType.AUDIO) return 'audio';

  if (task.params.promptMeta?.skillName || task.params.promptMeta?.skillId) {
    return 'agent';
  }

  return 'text';
}

export function buildPromptHistoryResultPreview(
  task: PromptHistoryTaskSummary,
  category: PromptHistoryCategory
): PromptHistoryResultPreview {
  if (task.status === TaskStatus.FAILED) {
    return {
      kind: 'error',
      text: task.error?.message || '任务失败',
    };
  }

  if (task.status === TaskStatus.CANCELLED) {
    return {
      kind: 'error',
      text: '任务已取消',
    };
  }

  const result = task.result;
  if (!result) {
    return {
      kind: 'none',
      text: '暂无结果',
    };
  }

  if (category === 'image' || category === 'ppt-slide') {
    const url = result.thumbnailUrls?.[0] || result.thumbnailUrl || result.urls?.[0] || result.url;
    return url
      ? { kind: 'image', url, title: result.title }
      : { kind: 'none', text: '暂无图片预览' };
  }

  if (category === 'video') {
    const url = result.url || result.urls?.[0];
    const posterUrl =
      result.thumbnailUrl || result.thumbnailUrls?.[0] || result.previewImageUrl;
    return url
      ? {
          kind: 'video',
          url,
          posterUrl,
          title: result.title,
          duration: result.duration,
        }
      : { kind: 'none', text: '暂无视频预览' };
  }

  if (category === 'audio') {
    const firstClip = result.clips?.[0];
    const url = firstClip?.audioUrl || result.urls?.[0] || result.url;
    const coverUrl =
      firstClip?.imageLargeUrl ||
      firstClip?.imageUrl ||
      result.previewImageUrl ||
      result.thumbnailUrl;
    const title = result.title || firstClip?.title || task.params.title;
    return {
      kind: 'audio',
      url,
      coverUrl,
      title,
      text: result.lyricsText || result.lyricsTitle,
      duration: firstClip?.duration ?? result.duration,
    };
  }

  const text =
    result.chatResponse ||
    result.lyricsText ||
    result.title ||
    (result.url ? '结果已生成' : '');
  return text
    ? {
        kind: 'text',
        text: text.slice(0, 500),
        title: result.title || result.lyricsTitle,
      }
    : { kind: 'none', text: '暂无文本预览' };
}

export function taskSummaryToPromptHistoryRecord(
  task: PromptHistoryTaskSummary
): PromptHistoryRecord {
  const meta = task.params.promptMeta;
  const category = inferPromptHistoryCategory(task);
  const sentPrompt = compactText(
    stripKnowledgeContextFromPrompt(
      meta?.sentPrompt ||
        (category === 'ppt-slide' ? task.params.pptSlidePrompt : undefined) ||
        task.params.prompt
    )
  );
  const initialPrompt = compactText(
    stripKnowledgeContextFromPrompt(
      meta?.initialPrompt ||
        task.params.sourcePrompt ||
        task.params.rawInput ||
        sentPrompt
    )
  );
  const skillName = compactText(meta?.skillName, 80);
  const skillId = compactText(meta?.skillId, 120);
  const knowledgeContextTags = (
    meta?.knowledgeContextRefs ||
    task.params.knowledgeContextRefs ||
    []
  ).map((ref) =>
    ref?.title ? `知识库:${compactText(ref.title, 40)}` : undefined
  );
  const tags = uniqueTags([
    category,
    skillName || undefined,
    ...(meta?.tags || []),
    ...knowledgeContextTags,
  ]);

  return {
    id: `prompt-history-${task.id}`,
    taskId: task.id,
    taskIds: [task.id],
    sourceSentPrompt: sentPrompt,
    sourceSentPrompts: [sentPrompt],
    category,
    status: task.status,
    title: buildPromptHistoryTitle(initialPrompt, sentPrompt, meta?.title),
    initialPrompt,
    sentPrompt,
    tags,
    skillId: skillId || undefined,
    skillName: skillName || undefined,
    model: compactText(task.params.model, 120) || undefined,
    createdAt: task.completedAt || task.createdAt,
    completedAt: task.completedAt,
    resultPreview: buildPromptHistoryResultPreview(task, category),
    resultPreviews: [buildPromptHistoryResultPreview(task, category)],
    resultCount: 1,
    pinned: promptStorageService.isContentPinned(sentPrompt),
  };
}

function applyPromptHistoryOverride(
  record: PromptHistoryRecord
): PromptHistoryRecord {
  const override = promptStorageService.getHistoryOverride(
    record.sourceSentPrompt
  );

  const sentPrompt = compactText(
    override?.content ||
      override?.sentPrompt ||
      promptStorageService.resolveContent(record.sourceSentPrompt) ||
      record.sentPrompt
  );
  const title =
    compactText(override?.title, 80) ||
    (sentPrompt === record.sentPrompt
      ? record.title
      : buildPromptHistoryTitle(record.initialPrompt, sentPrompt));
  const tags =
    override?.tags !== undefined ? uniqueTags(override.tags) : record.tags;

  return {
    ...record,
    sentPrompt,
    title,
    tags,
    pinned: promptStorageService.isContentPinned(sentPrompt),
  };
}

function recordMatchesQuery(record: PromptHistoryRecord, query: PromptHistoryQuery): boolean {
  if (query.category && query.category !== 'all' && record.category !== query.category) {
    return false;
  }

  if (query.skillTag && query.skillTag !== 'all' && !record.tags.includes(query.skillTag)) {
    return false;
  }

  const search = query.search?.trim().toLowerCase();
  if (!search) {
    return true;
  }

  const previewSearchText =
    record.resultPreview.kind === 'text' ||
    record.resultPreview.kind === 'error' ||
    record.resultPreview.kind === 'none'
      ? record.resultPreview.text
      : record.resultPreview.title;

  const haystack = [
    record.title,
    record.initialPrompt,
    record.sentPrompt,
    record.sourceSentPrompts.join(' '),
    record.tags.join(' '),
    record.skillName,
    record.model,
    previewSearchText,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  return search.split(/\s+/).every((token) => haystack.includes(token));
}

function recordMatchesSkillTag(record: PromptHistoryRecord, query: PromptHistoryQuery): boolean {
  return !query.skillTag || query.skillTag === 'all' || record.tags.includes(query.skillTag);
}

function recordMatchesBaseQuery(
  record: PromptHistoryRecord,
  query: PromptHistoryQuery
): boolean {
  return recordMatchesQuery({ ...record, tags: record.tags }, {
    ...query,
    skillTag: 'all',
  });
}

function promptTypeFromCategory(category: PromptHistoryCategory): PromptType {
  return category;
}

function categoryFromPromptType(
  modelType?: PromptType
): PromptHistoryCategory {
  return modelType || 'text';
}

function chooseLongerText(left: string, right: string): string {
  return right.length > left.length ? right : left;
}

function shouldKeepPreview(preview: PromptHistoryResultPreview): boolean {
  return preview.kind !== 'none';
}

function manualHistoryItemToPromptHistoryRecord(
  item: PromptHistoryItem
): PromptHistoryRecord {
  const metadata = promptStorageService.resolveMetadata(item.content);
  const sourceContent = compactText(metadata.sourceContent || item.content);
  const sentPrompt = compactText(metadata.content || item.content);
  const category = categoryFromPromptType(
    item.modelType || metadata.modelType
  );
  const tags = uniqueTags([category, ...(metadata.tags || [])]);

  return {
    id: `prompt-history-manual-${item.id}`,
    taskId: item.id,
    taskIds: [],
    sourceSentPrompt: sourceContent,
    sourceSentPrompts: [sourceContent],
    category,
    status: TaskStatus.COMPLETED,
    title: buildPromptHistoryTitle(sentPrompt, sentPrompt, metadata.title),
    initialPrompt: sentPrompt,
    sentPrompt,
    tags,
    createdAt: item.timestamp,
    resultPreview: { kind: 'none', text: '暂无结果' },
    resultPreviews: [],
    resultCount: 0,
    pinned: Boolean(item.pinned) || promptStorageService.isContentPinned(sentPrompt),
  };
}

function aggregatePromptHistoryRecords(
  records: PromptHistoryRecord[]
): PromptHistoryRecord[] {
  const map = new Map<string, PromptHistoryRecord>();

  for (const record of records) {
    const key = record.sentPrompt.trim();
    const sourceKey = record.sourceSentPrompt.trim();
    if (
      !key ||
      promptStorageService.isContentDeleted(key) ||
      promptStorageService.isContentDeleted(sourceKey)
    ) {
      continue;
    }

    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...record,
        id: `prompt-history-${key}`,
        resultPreviews: shouldKeepPreview(record.resultPreview)
          ? [record.resultPreview]
          : [],
        resultCount: shouldKeepPreview(record.resultPreview) ? 1 : 0,
        pinned: promptStorageService.isContentPinned(record.sentPrompt),
      });
      continue;
    }

    existing.taskIds.push(...record.taskIds);
    existing.sourceSentPrompts = Array.from(
      new Set([...existing.sourceSentPrompts, ...record.sourceSentPrompts])
    );
    existing.tags = Array.from(new Set([...existing.tags, ...record.tags]));
    existing.title = chooseLongerText(existing.title, record.title);
    existing.initialPrompt = chooseLongerText(
      existing.initialPrompt,
      record.initialPrompt
    );
    if (record.createdAt > existing.createdAt) {
      existing.createdAt = record.createdAt;
      existing.completedAt = record.completedAt;
      existing.taskId = record.taskId;
      existing.status = record.status;
      existing.category = record.category;
      existing.model = record.model || existing.model;
    }
    if (record.skillName && !existing.skillName) {
      existing.skillName = record.skillName;
    }
    if (record.skillId && !existing.skillId) {
      existing.skillId = record.skillId;
    }
    if (shouldKeepPreview(record.resultPreview)) {
      existing.resultPreviews.push(record.resultPreview);
      existing.resultCount = existing.resultPreviews.length;
      existing.resultPreview = existing.resultPreviews[0];
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.createdAt - a.createdAt;
  });
}

export async function getPromptHistoryPage(
  query: PromptHistoryQuery = {}
): Promise<PromptHistoryPage> {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_LIMIT, 1), 80);
  const offset = Math.max(query.offset ?? 0, 0);
  let readOffset = 0;
  const records: PromptHistoryRecord[] = [];
  let hasMorePages = true;

  promptStorageService
    .getHistory()
    .forEach((item) => records.push(manualHistoryItemToPromptHistoryRecord(item)));

  while (hasMorePages) {
    const page = await taskStorageReader.getPromptHistoryTaskSummaries({
      offset: readOffset,
      limit: READ_BATCH_SIZE,
      statuses: [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED],
    });

    for (const item of page.items) {
      const record = applyPromptHistoryOverride(
        taskSummaryToPromptHistoryRecord(item)
      );
      records.push(record);
    }

    readOffset = page.nextOffset;

    if (!page.hasMore || page.items.length === 0) {
      hasMorePages = false;
    }
  }

  const aggregatedRecords = aggregatePromptHistoryRecords(records);
  const skillTags = new Set<string>();
  aggregatedRecords.forEach((record) => {
    if (recordMatchesBaseQuery(record, query) && record.category === 'agent') {
      record.tags
        .filter((tag) => tag !== 'agent')
        .forEach((tag) => skillTags.add(tag));
    }
  });

  const filteredRecords = aggregatedRecords.filter(
    (record) =>
      recordMatchesQuery(record, query) && recordMatchesSkillTag(record, query)
  );
  const matchedCount = filteredRecords.length;
  return {
    records: filteredRecords.slice(offset, offset + limit),
    nextOffset: offset + Math.min(limit, Math.max(matchedCount - offset, 0)),
    hasMore: offset + limit < matchedCount,
    total: matchedCount,
    skillTags: Array.from(skillTags).sort((a, b) => a.localeCompare(b, 'zh-CN')),
  };
}

export function setPromptHistoryPinned(
  sentPrompt: string,
  pinned: boolean,
  category: PromptHistoryCategory
): boolean {
  return promptStorageService.setContentPinned(
    sentPrompt,
    pinned,
    promptTypeFromCategory(category)
  );
}

export function deletePromptHistoryPrompts(sourceSentPrompts: string[]): void {
  promptStorageService.deleteContents(sourceSentPrompts);
}

export function createPromptHistoryRecord(
  input: CreatePromptHistoryRecordInput
): boolean {
  const content = input.content.trim();
  if (!content) {
    return false;
  }

  const modelType = input.modelType || input.category;
  promptStorageService.addHistory(content, input.hasSelection, modelType);

  if (input.title !== undefined || input.tags !== undefined || modelType) {
    promptStorageService.setHistoryOverride(content, {
      title: input.title,
      sentPrompt: content,
      tags: input.tags,
      modelType,
    });
  }

  if (input.pinned !== undefined) {
    promptStorageService.setContentPinned(content, input.pinned, modelType);
  }

  return true;
}

export function updatePromptHistoryRecord(input: {
  sourceSentPrompt: string;
  sourceSentPrompts?: string[];
  title?: string;
  sentPrompt: string;
  tags: string[];
  category?: PromptHistoryCategory;
  allowSentPromptEdit?: boolean;
}): boolean {
  const sourceSentPrompts = Array.from(
    new Set(
      (input.sourceSentPrompts || [input.sourceSentPrompt])
        .map((prompt) => prompt.trim())
        .filter(Boolean)
    )
  );
  const sourceSentPrompt = sourceSentPrompts[0] || '';
  if (!sourceSentPrompt) {
    return false;
  }

  const metadata = promptStorageService.resolveMetadata(sourceSentPrompt);
  const nextSentPrompt = input.sentPrompt.trim();
  const modelType = input.category
    ? promptTypeFromCategory(input.category)
    : undefined;
  const canEditSentPrompt = Boolean(
    input.allowSentPromptEdit && nextSentPrompt
  );
  const sentPrompt = canEditSentPrompt
    ? nextSentPrompt
    : metadata.content || nextSentPrompt || sourceSentPrompt;

  if (canEditSentPrompt && sentPrompt !== metadata.content) {
    promptStorageService.setContentEdited(
      sourceSentPrompts,
      sentPrompt,
      modelType
    );
  }

  return Boolean(
    promptStorageService.setHistoryOverride(sourceSentPrompt, {
      title: input.title,
      sentPrompt,
      tags: input.tags,
      modelType,
    })
  );
}

export const promptHistoryService = {
  getPage: getPromptHistoryPage,
  toRecord: taskSummaryToPromptHistoryRecord,
  setPinned: setPromptHistoryPinned,
  deletePrompts: deletePromptHistoryPrompts,
  createRecord: createPromptHistoryRecord,
  updateRecord: updatePromptHistoryRecord,
};
