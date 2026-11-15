import type { PromptType } from './prompt-storage-service';
import { buildVisualStructuredPromptSchemaInstruction } from '../utils/visual-structured-prompt-schema';
import {
  createDirectory,
  createNote,
  getAllDirectories,
  getNoteById,
  getNotesBySourceUrl,
  updateNote,
} from './knowledge-base-service';

export type PromptOptimizeMode = 'polish' | 'structured';
export type PromptOptimizeType = 'image' | 'video' | 'audio' | 'text' | 'agent';

export type PromptOptimizationScenarioId =
  | 'ai-input.image'
  | 'ai-input.video'
  | 'ai-input.audio'
  | 'ai-input.text'
  | 'ai-input.agent'
  | 'tool.image'
  | 'tool.video'
  | 'ppt.common'
  | 'ppt.slide'
  | 'music.create-song';

export interface PromptOptimizationScenario {
  id: PromptOptimizationScenarioId;
  name: string;
  type: PromptOptimizeType;
  historyType?: PromptType;
  defaultMode: PromptOptimizeMode;
  noteTitle: string;
  focus: string;
}

export interface PromptOptimizationRequestOptions {
  scenarioId?: PromptOptimizationScenarioId;
  originalPrompt: string;
  optimizationRequirements?: string;
  language: 'zh' | 'en';
  type?: PromptOptimizeType;
  mode?: PromptOptimizeMode;
}

const PROMPT_OPTIMIZATION_DIRECTORY_NAME = '提示词优化';
const SOURCE_URL_PREFIX = 'aitu://prompt-optimization/';

const SCENARIOS: Record<PromptOptimizationScenarioId, PromptOptimizationScenario> = {
  'ai-input.image': {
    id: 'ai-input.image',
    name: 'AI 输入框图片生成',
    type: 'image',
    historyType: 'image',
    defaultMode: 'structured',
    noteTitle: 'AI输入-图片',
    focus: '补足主体、构图、风格、光线、材质、比例、负面约束和画面细节。',
  },
  'ai-input.video': {
    id: 'ai-input.video',
    name: 'AI 输入框视频生成',
    type: 'video',
    historyType: 'video',
    defaultMode: 'structured',
    noteTitle: 'AI输入-视频',
    focus: '补足主体动作、镜头语言、运镜、时序、转场、连续性和画面节奏。',
  },
  'ai-input.audio': {
    id: 'ai-input.audio',
    name: 'AI 输入框音频生成',
    type: 'audio',
    historyType: 'audio',
    defaultMode: 'polish',
    noteTitle: 'AI输入-音频',
    focus: '补足音乐风格、节奏、情绪、乐器、人声、歌词结构、时长和使用场景。',
  },
  'ai-input.text': {
    id: 'ai-input.text',
    name: 'AI 输入框文本生成',
    type: 'text',
    historyType: 'text',
    defaultMode: 'polish',
    noteTitle: 'AI输入-文本',
    focus: '补足主题、受众、结构、语气、信息密度、格式和交付标准。',
  },
  'ai-input.agent': {
    id: 'ai-input.agent',
    name: 'AI 输入框 Agent 指令',
    type: 'agent',
    historyType: 'agent',
    defaultMode: 'polish',
    noteTitle: 'AI输入-Agent',
    focus: '补足目标、上下文、约束、输入输出、执行步骤、工具边界和验收标准。',
  },
  'tool.image': {
    id: 'tool.image',
    name: '图片工具提示词',
    type: 'image',
    historyType: 'image',
    defaultMode: 'structured',
    noteTitle: '工具-图片生成',
    focus: '面向图片生成工具，突出可直接生成的画面描述、构图、风格、尺寸比例和质量约束。',
  },
  'tool.video': {
    id: 'tool.video',
    name: '视频工具提示词',
    type: 'video',
    historyType: 'video',
    defaultMode: 'structured',
    noteTitle: '工具-视频生成',
    focus: '面向视频生成工具，突出镜头序列、运动方式、时长、首尾帧关系、主体一致性和节奏。',
  },
  'ppt.common': {
    id: 'ppt.common',
    name: 'PPT 公共提示词',
    type: 'image',
    historyType: 'ppt-common',
    defaultMode: 'polish',
    noteTitle: 'PPT-公共提示词',
    focus: '优化整套 PPT 的统一视觉方向、受众、版式规则、品牌语气、图文密度和风格约束。',
  },
  'ppt.slide': {
    id: 'ppt.slide',
    name: 'PPT 单页提示词',
    type: 'image',
    historyType: 'image',
    defaultMode: 'structured',
    noteTitle: 'PPT-单页提示词',
    focus: '优化单页幻灯片的页面目标、标题层级、内容区块、视觉重点、版式和生成可控性。',
  },
  'music.create-song': {
    id: 'music.create-song',
    name: '爆款音乐歌曲创作',
    type: 'audio',
    historyType: 'audio',
    defaultMode: 'polish',
    noteTitle: '爆款音乐-歌曲创作',
    focus: '补足爆款歌曲定位、曲风标签、情绪弧线、人声设定、段落结构、歌词主题和 Suno 可用表达。',
  },
};

const FALLBACK_SCENARIO_BY_TYPE: Record<PromptOptimizeType, PromptOptimizationScenarioId> = {
  image: 'ai-input.image',
  video: 'ai-input.video',
  audio: 'ai-input.audio',
  text: 'ai-input.text',
  agent: 'ai-input.agent',
};
const VISUAL_STRUCTURED_PROMPT_SCENARIOS = new Set<PromptOptimizationScenarioId>([
  'ai-input.image',
  'tool.image',
  'ppt.slide',
]);

function getSourceUrl(scenarioId: PromptOptimizationScenarioId): string {
  return `${SOURCE_URL_PREFIX}${scenarioId}`;
}

export function getPromptOptimizationScenario(
  scenarioId?: PromptOptimizationScenarioId,
  type?: PromptOptimizeType
): PromptOptimizationScenario {
  const id = scenarioId || (type ? FALLBACK_SCENARIO_BY_TYPE[type] : 'ai-input.image');
  return SCENARIOS[id];
}

export function listPromptOptimizationScenarios(): PromptOptimizationScenario[] {
  return Object.values(SCENARIOS);
}

function shouldUseVisualStructuredPromptSchema(
  scenario: PromptOptimizationScenario,
  mode: PromptOptimizeMode
): boolean {
  return mode === 'structured' && VISUAL_STRUCTURED_PROMPT_SCENARIOS.has(scenario.id);
}

function buildVisualStructuredRuntimeInstruction(
  scenario: PromptOptimizationScenario,
  mode: PromptOptimizeMode,
  language: 'zh' | 'en'
): string {
  if (!shouldUseVisualStructuredPromptSchema(scenario, mode)) {
    return '';
  }

  return [
    '',
    language === 'zh'
      ? '【视觉结构化 JSON 强制要求】'
      : '[Required Visual Structured JSON]',
    buildVisualStructuredPromptSchemaInstruction(language),
    language === 'zh'
      ? '最终输出必须是单个合法 JSON 对象，不要 Markdown，不要代码块，不要解释。'
      : 'The final output must be one valid JSON object. No Markdown, no code fence, no explanation.',
  ].join('\n');
}

function buildDefaultTemplate(scenario: PromptOptimizationScenario): string {
  return [
    `你是一名专业的「{{scenarioName}}」提示词优化助手。`,
    '',
    '请基于用户原始提示词和补充要求，输出一版可直接用于下游模型的最终提示词。',
    '',
    '场景优化方向：',
    scenario.focus,
    '',
    '通用要求：',
    '1. 保持原始意图，不要擅自改题、换主题或新增关键事实。',
    '2. 优先满足补充要求；补充要求为空时，仅做必要润色、结构补全和可执行性增强。',
    '3. 输出语言尽量跟随原始提示词；中英混合时保留原表达习惯。',
    '4. 原始提示词已经完整时，做轻量优化，避免堆砌无关细节。',
    '5. 当前模式为 {{mode}}。structured 模式下可以强化结构、字段和可复用性；polish 模式下保持自然文本。',
    '6. 只输出最终优化后的提示词，不要解释、不要标题、不要 Markdown 代码块。',
    '',
    '可用变量：{{originalPrompt}}、{{requirements}}、{{language}}、{{mode}}、{{scenarioName}}。',
  ].join('\n');
}

function renderTemplate(
  template: string,
  values: {
    originalPrompt: string;
    requirements: string;
    language: 'zh' | 'en';
    mode: PromptOptimizeMode;
    scenarioName: string;
  }
): string {
  return template.replace(
    /\{\{\s*(originalPrompt|requirements|language|mode|scenarioName)\s*\}\}/g,
    (_, key: keyof typeof values) => values[key]
  );
}

async function ensurePromptOptimizationDirectory(): Promise<string> {
  const dirs = await getAllDirectories();
  const existing = dirs.find((dir) => dir.name === PROMPT_OPTIMIZATION_DIRECTORY_NAME);
  if (existing) return existing.id;

  try {
    const created = await createDirectory(PROMPT_OPTIMIZATION_DIRECTORY_NAME);
    return created.id;
  } catch {
    const latest = await getAllDirectories();
    const recovered = latest.find((dir) => dir.name === PROMPT_OPTIMIZATION_DIRECTORY_NAME);
    if (!recovered) throw new Error('提示词优化目录创建失败');
    return recovered.id;
  }
}

async function getOrRestoreTemplate(scenario: PromptOptimizationScenario): Promise<string> {
  const directoryId = await ensurePromptOptimizationDirectory();
  const sourceUrl = getSourceUrl(scenario.id);
  const defaultTemplate = buildDefaultTemplate(scenario);
  const existingMetas = await getNotesBySourceUrl(sourceUrl);
  const existingMeta = existingMetas[0];

  if (existingMeta) {
    const note = await getNoteById(existingMeta.id);
    const content = note?.content || '';
    if (content.trim()) {
      return content;
    }

    await updateNote(existingMeta.id, {
      title: existingMeta.title || scenario.noteTitle,
      directoryId: existingMeta.directoryId || directoryId,
      content: defaultTemplate,
      metadata: {
        ...existingMeta.metadata,
        sourceUrl,
        domain: '提示词优化',
        tags: ['提示词优化', scenario.type],
      },
    });
    return defaultTemplate;
  }

  await createNote(scenario.noteTitle, directoryId, defaultTemplate, {
    sourceUrl,
    domain: '提示词优化',
    tags: ['提示词优化', scenario.type],
  });
  return defaultTemplate;
}

export async function ensurePromptOptimizationTemplates(): Promise<void> {
  for (const scenario of Object.values(SCENARIOS)) {
    await getOrRestoreTemplate(scenario);
  }
}

export async function buildOptimizationPrompt({
  scenarioId,
  originalPrompt,
  optimizationRequirements,
  language,
  type,
  mode,
}: PromptOptimizationRequestOptions): Promise<string> {
  const scenario = getPromptOptimizationScenario(scenarioId, type);
  const effectiveMode = mode || scenario.defaultMode;
  const trimmedPrompt = originalPrompt.trim();
  const trimmedRequirements = optimizationRequirements?.trim() || '';
  const template = await getOrRestoreTemplate(scenario);
  const rendered = renderTemplate(template, {
    originalPrompt: trimmedPrompt,
    requirements: trimmedRequirements || '无',
    language,
    mode: effectiveMode,
    scenarioName: scenario.name,
  });
  const visualStructuredInstruction = buildVisualStructuredRuntimeInstruction(
    scenario,
    effectiveMode,
    language
  );

  const inputBlock =
    language === 'zh'
      ? [
          '',
          '---',
          '以下输入块由系统固定附加，请必须以此为准：',
          '',
          '【原始提示词】',
          trimmedPrompt,
          '',
          '【补充要求】',
          trimmedRequirements || '无，做通顺、准确、可执行的轻量优化。',
          visualStructuredInstruction,
          '',
          '【输出要求】',
          visualStructuredInstruction
            ? '只输出符合视觉结构化 schema 的合法 JSON 对象，不要解释、不要标题、不要 Markdown 代码块。'
            : '只输出最终优化后的提示词，不要解释、不要标题、不要 Markdown 代码块。',
        ]
      : [
          '',
          '---',
          'The following input block is appended by the system and must be treated as authoritative:',
          '',
          '[Original Prompt]',
          trimmedPrompt,
          '',
          '[Refinement Requirements]',
          trimmedRequirements ||
            'None. Apply light polishing for clarity and execution quality.',
          visualStructuredInstruction,
          '',
          '[Output Requirement]',
          visualStructuredInstruction
            ? 'Output only a valid JSON object following the visual structured schema. No explanation, no title, no Markdown code block.'
            : 'Output only the final optimized prompt. No explanation, no title, no Markdown code block.',
        ];

  return `${rendered.trim()}\n${inputBlock.join('\n')}`;
}

export async function buildPromptOptimizationRequest(
  options: PromptOptimizationRequestOptions
): Promise<string> {
  return buildOptimizationPrompt(options);
}

export const promptOptimizationService = {
  buildOptimizationPrompt,
  buildPromptOptimizationRequest,
  ensureTemplates: ensurePromptOptimizationTemplates,
  getScenario: getPromptOptimizationScenario,
  listScenarios: listPromptOptimizationScenarios,
};

export const normalizeOptimizedPromptResult = (value: string): string => {
  const trimmed = value.trim();
  const codeFenceMatch = trimmed.match(/^```[\w-]*\n?([\s\S]*?)\n?```$/);
  if (codeFenceMatch) {
    return codeFenceMatch[1].trim();
  }
  return trimmed;
};
