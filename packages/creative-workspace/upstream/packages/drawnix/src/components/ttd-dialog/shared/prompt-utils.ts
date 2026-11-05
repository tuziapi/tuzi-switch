import {
  getDefaultPromptsByGenerationType as getDefaultPromptContentsByGenerationType,
  getImagePrompts,
  getVideoPrompts,
  type Language,
  type PromptPreviewExample,
  type PromptGenerationType,
} from '../../../constants/prompts';
import {
  type ImageHistoryItem,
  type VideoHistoryItem,
} from '../../generation-history';
import {
  addVideoPromptHistory,
  addImagePromptHistory,
  getVideoPromptHistoryContents,
  getImagePromptHistoryContents,
  promptStorageService,
  type PromptHistoryItem,
} from '../../../services/prompt-storage-service';
import type { PromptItem } from '../../shared';
import { PRESET_PROMPTS_LIMIT, USER_PROMPTS_LIMIT } from './size-constants';

export type PromptType = 'image' | 'video';
export type HistoryItem = ImageHistoryItem | VideoHistoryItem;
export interface ResolvedPromptItem extends PromptItem {
  historyId?: string;
}
interface ResolvedPromptSeed {
  content: string;
  historyId?: string;
  previewExamples?: PromptPreviewExample[];
}

export interface ResolvePromptItemsByGenerationTypeParams {
  generationType: PromptGenerationType;
  language: Language;
  aiInputHistory: PromptHistoryItem[];
  imageHistory: ImageHistoryItem[];
  videoHistory: VideoHistoryItem[];
}

export interface ResolvePromptPreviewExamplesParams {
  generationType: PromptType;
  language: Language;
  promptContents: string[];
  imageHistory: ImageHistoryItem[];
  videoHistory: VideoHistoryItem[];
}

export interface ResolvePresetPromptItemsParams {
  generationType: PromptType;
  language: Language;
  promptContents: string[];
  imageHistory: ImageHistoryItem[];
  videoHistory: VideoHistoryItem[];
}

/**
 * 从历史记录中提取用户使用过的提示词（去重，最新的在前）
 */
function extractUserPromptsFromHistory(historyItems: HistoryItem[]): string[] {
  return historyItems
    .map((item) => promptStorageService.resolveContent(item.prompt))
    .filter((prompt) => prompt.length > 0)
    .filter((prompt, index, arr) => arr.indexOf(prompt) === index); // 去重
}

function dedupePromptContents(prompts: string[]): string[] {
  return prompts.filter(
    (prompt, index, arr) => arr.indexOf(prompt) === index
  );
}

function buildPromptSeedLookup(promptSeeds: ResolvedPromptSeed[]) {
  return promptSeeds.reduce<Map<string, ResolvedPromptSeed>>((map, seed) => {
    const content = seed.content.trim();
    if (!content) {
      return map;
    }

    const normalizedSeed: ResolvedPromptSeed = {
      ...seed,
      content,
      previewExamples: seed.previewExamples?.slice(0, 3),
    };
    const existingSeed = map.get(content);

    if (!existingSeed) {
      map.set(content, normalizedSeed);
      return map;
    }

    map.set(content, {
      ...existingSeed,
      historyId: existingSeed.historyId || normalizedSeed.historyId,
      previewExamples:
        existingSeed.previewExamples?.length
          ? existingSeed.previewExamples
          : normalizedSeed.previewExamples,
    });
    return map;
  }, new Map());
}

function createResolvedPromptItems(
  generationType: PromptGenerationType,
  promptContents: string[],
  promptSeeds: ResolvedPromptSeed[] = []
): ResolvedPromptItem[] {
  const promptSeedLookup = buildPromptSeedLookup(promptSeeds);
  const sortedContents = promptStorageService.sortPrompts(
    generationType,
    dedupePromptContents(
      promptContents
        .map((content) => promptStorageService.resolveContent(content))
        .filter(Boolean)
    )
  );

  return sortedContents.map((content, index) => {
    const promptSeed = promptSeedLookup.get(content);
    const metadata = (
      promptStorageService as typeof promptStorageService & {
        resolveMetadata?: (content: string) => {
          content: string;
          title?: string;
          tags?: string[];
        };
      }
    ).resolveMetadata?.(content);
    const sentPrompt = metadata?.content || content;

    return {
      id: promptSeed?.historyId || `${generationType}-prompt-${index}-${content.slice(0, 24)}`,
      content,
      title: metadata?.title,
      tags: metadata?.tags,
      sentPrompt,
      pinned: promptStorageService.isPinned(generationType, content),
      modelType: generationType,
      historyId: promptSeed?.historyId,
      previewExamples: promptSeed?.previewExamples,
    };
  });
}

function createDefaultPromptSeeds(
  generationType: PromptGenerationType,
  language: Language
): ResolvedPromptSeed[] {
  return getDefaultPromptContentsByGenerationType(generationType, language).map(
    (content) => ({
      content,
    })
  );
}

function createTypedHistorySeeds(history: PromptHistoryItem[]): ResolvedPromptSeed[] {
  return history
    .map((item) => ({
      content: promptStorageService.resolveContent(item.content),
      historyId: item.id,
    }))
    .filter((item) => item.content.length > 0);
}

function createMediaPreviewExample(
  generationType: PromptType,
  item: HistoryItem,
  alt: string
): PromptPreviewExample {
  if (
    generationType === 'video' &&
    'previewUrl' in item &&
    typeof item.previewUrl === 'string'
  ) {
    return {
      kind: 'video',
      src: item.previewUrl || item.downloadUrl || item.imageUrl,
      posterSrc: item.imageUrl,
      playable: true,
      alt,
    };
  }

  return {
    kind: 'image',
    src: item.imageUrl,
    alt,
  };
}

function createMediaHistorySeeds(
  generationType: PromptType,
  historyItems: HistoryItem[]
): ResolvedPromptSeed[] {
  const previewMap = new Map<string, PromptPreviewExample[]>();
  const orderedPrompts: string[] = [];

  historyItems.forEach((item) => {
    const content = promptStorageService.resolveContent(item.prompt);
    if (!content) {
      return;
    }

    if (!previewMap.has(content)) {
      previewMap.set(content, []);
      orderedPrompts.push(content);
    }

    const previews = previewMap.get(content);
    if (!previews) {
      return;
    }
    const previewSrc =
      generationType === 'video' &&
      'previewUrl' in item &&
      typeof item.previewUrl === 'string'
        ? item.previewUrl || item.downloadUrl || item.imageUrl
        : item.imageUrl;

    if (
      previews.length >= 3 ||
      previews.some((preview) => preview.src === previewSrc)
    ) {
      return;
    }

    previews.push(
      createMediaPreviewExample(
        generationType,
        item,
        generationType === 'image'
          ? `Generated image example ${previews.length + 1}`
          : `Generated video example ${previews.length + 1}`
      )
    );
  });

  return orderedPrompts.map((content) => ({
    content,
    previewExamples: previewMap.get(content),
  }));
}

function createLocalPromptSeeds(promptContents: string[]): ResolvedPromptSeed[] {
  return promptContents
    .map((content) => ({ content: promptStorageService.resolveContent(content) }))
    .filter((item) => item.content.length > 0);
}

function getTypedPromptHistoryContents(type: PromptType): string[] {
  const history =
    typeof promptStorageService.getHistory === 'function'
      ? promptStorageService.getHistory()
      : [];

  return history
    .filter((item) => {
      const metadata = promptStorageService.resolveMetadata?.(item.content);
      return item.modelType === type || metadata?.modelType === type;
    })
    .map((item) => promptStorageService.resolveContent(item.content))
    .filter(Boolean);
}

export function resolvePromptPreviewExamples({
  generationType,
  promptContents,
  imageHistory,
  videoHistory,
}: ResolvePromptPreviewExamplesParams): Map<string, PromptPreviewExample[]> {
  const promptSeedLookup = buildPromptSeedLookup(
    generationType === 'video'
      ? createMediaHistorySeeds(generationType, videoHistory)
      : createMediaHistorySeeds(generationType, imageHistory)
  );

  return promptContents.reduce<Map<string, PromptPreviewExample[]>>(
    (map, content) => {
      map.set(content, promptSeedLookup.get(content.trim())?.previewExamples ?? []);
      return map;
    },
    new Map()
  );
}

export function resolvePresetPromptItems({
  generationType,
  language,
  promptContents,
  imageHistory,
  videoHistory,
}: ResolvePresetPromptItemsParams): ResolvedPromptItem[] {
  const sortedPromptContents = promptStorageService.sortPrompts(
    generationType,
    promptContents
      .map((content) => promptStorageService.resolveContent(content))
      .filter(Boolean)
  );
  const previewExampleLookup = resolvePromptPreviewExamples({
    generationType,
    language,
    promptContents: sortedPromptContents,
    imageHistory,
    videoHistory,
  });

  return sortedPromptContents.map((content, index) => {
    const metadata = promptStorageService.resolveMetadata?.(content);
    const sentPrompt = metadata?.content || content;

    return {
      id: `preset-${index}-${content.slice(0, 20)}`,
      content,
      title: metadata?.title,
      tags: metadata?.tags,
      sentPrompt,
      pinned: promptStorageService.isPinned(generationType, content),
      modelType: generationType,
      previewExamples: [...(previewExampleLookup.get(content) ?? [])],
    };
  });
}

/**
 * 获取合并的预设提示词（用户历史 + 默认预设）
 *
 * 会合并三个来源：
 * 1. 本地存储的描述历史（提交时立即保存）
 * 2. 任务队列中已完成任务的提示词
 * 3. 默认预设提示词
 */
export const getMergedPresetPrompts = (
  type: PromptType,
  language: Language,
  historyItems: HistoryItem[]
) => {
  // 获取默认预设提示词
  const defaultPrompts = type === 'image'
    ? getImagePrompts(language)
    : getVideoPrompts(language);

  // 提取用户历史提示词（来自任务队列的已完成任务）
  const taskQueuePrompts = extractUserPromptsFromHistory(historyItems);

  // 获取“我的提示词”通用历史，以及图片/视频工具本地历史记录
  const typedPromptHistoryPrompts = getTypedPromptHistoryContents(type);
  const localStoragePrompts = type === 'video'
    ? getVideoPromptHistoryContents()
    : getImagePromptHistoryContents();

  // 合并所有来源的提示词（本地存储优先，因为包含最新提交的）
  // 顺序：我的提示词 -> 本地存储历史 -> 任务队列历史 -> 默认预设
  const allUserPrompts = [
    ...typedPromptHistoryPrompts,
    ...localStoragePrompts,
    ...taskQueuePrompts,
  ]
    .filter((prompt, index, arr) => arr.indexOf(prompt) === index) // 去重
    .slice(0, USER_PROMPTS_LIMIT);

  // 合并：用户历史提示词在前，默认预设在后，总数不超过限制
  const merged = [...allUserPrompts, ...defaultPrompts]
    .filter((prompt, index, arr) => arr.indexOf(prompt) === index) // 再次去重，避免用户历史与默认重复
    .slice(0, PRESET_PROMPTS_LIMIT); // 限制总数

  return merged;
};

export const getDefaultPromptsByGenerationType = (
  generationType: PromptGenerationType,
  language: Language
): ResolvedPromptItem[] => {
  const promptSeeds = createDefaultPromptSeeds(generationType, language);

  return createResolvedPromptItems(
    generationType,
    promptSeeds.map((item) => item.content),
    promptSeeds
  );
};

export const resolvePromptItemsByGenerationType = ({
  generationType,
  language,
  aiInputHistory,
  imageHistory,
  videoHistory,
}: ResolvePromptItemsByGenerationTypeParams): ResolvedPromptItem[] => {
  if (generationType === 'image') {
    const promptSeeds = [
      ...createLocalPromptSeeds(getImagePromptHistoryContents()),
      ...createMediaHistorySeeds('image', imageHistory),
      ...createDefaultPromptSeeds('image', language),
    ];

    return createResolvedPromptItems(
      'image',
      getMergedPresetPrompts('image', language, imageHistory),
      promptSeeds
    );
  }

  if (generationType === 'video') {
    const promptSeeds = [
      ...createLocalPromptSeeds(getVideoPromptHistoryContents()),
      ...createDefaultPromptSeeds('video', language),
      ...createMediaHistorySeeds('video', videoHistory),
    ];

    return createResolvedPromptItems(
      'video',
      getMergedPresetPrompts('video', language, videoHistory),
      promptSeeds
    );
  }

  const typedHistory = aiInputHistory.filter(
    (item) => item.modelType === generationType && item.content.trim().length > 0
  );
  const promptSeeds = [
    ...createTypedHistorySeeds(typedHistory),
    ...createDefaultPromptSeeds(generationType, language),
  ];

  return createResolvedPromptItems(
    generationType,
    promptSeeds.map((item) => item.content),
    promptSeeds
  );
};

/**
 * 保存提示词到历史记录（去重）
 *
 * 会立即保存到本地存储，这样即使任务还在执行中，
 * 用户也可以在预设列表中看到刚刚使用的提示词。
 */
export const savePromptToHistory = (type: PromptType, promptText: string, dimensions?: { width: number; height: number }) => {
  if (!promptText || !promptText.trim()) return;

  if (type === 'video') {
    addVideoPromptHistory(promptText.trim());
  } else {
    addImagePromptHistory(promptText.trim());
  }
};
