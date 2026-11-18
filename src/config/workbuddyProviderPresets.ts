import { upstreamWorkBuddyPresets } from "./workbuddyUpstreamPresets";

export const WORKBUDDY_ACCOUNT_AUTH_PROVIDER = "workbuddy_account" as const;

export const WORKBUDDY_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type WorkBuddyEffort = (typeof WORKBUDDY_EFFORTS)[number];

export type WorkBuddyThinkingLevel = "off" | "minimal" | WorkBuddyEffort;
export type WorkBuddyThinkingLevelMap = Partial<
  Record<WorkBuddyThinkingLevel, string | null>
>;

export interface WorkBuddyReasoning {
  supportedEfforts: WorkBuddyEffort[];
  defaultEffort: WorkBuddyEffort;
  canDisableThinking: boolean;
}

export interface WorkBuddyModel {
  id: string;
  name?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  supportsToolCall?: boolean;
  supportsImages?: boolean;
  supportsReasoning?: boolean;
  reasoning?: WorkBuddyReasoning;
  thinkingLevelMap?: WorkBuddyThinkingLevelMap;
  [key: string]: unknown;
}

export interface WorkBuddyPreset {
  name: string;
  vendor: string;
  url: string;
  apiKey?: string;
  models: WorkBuddyModel[];
}

const cloneThinkingMap = (
  map: WorkBuddyThinkingLevelMap,
): WorkBuddyThinkingLevelMap => ({ ...map });

const isThinkingLevelMap = (
  value: unknown,
): value is WorkBuddyThinkingLevelMap => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([key, entry]) =>
      ["off", "minimal", ...WORKBUDDY_EFFORTS].includes(key) &&
      (entry === null || typeof entry === "string"),
  );
};

/** 将 WorkBuddy 的上游思考映射转换为模型选择器需要的元数据。 */
export function workbuddyThinkingFields(
  map: unknown,
): Pick<WorkBuddyModel, "reasoning" | "thinkingLevelMap"> {
  if (!isThinkingLevelMap(map) || Object.keys(map).length === 0) return {};

  const supportedEfforts = WORKBUDDY_EFFORTS.filter((effort) => {
    const value = map[effort];
    return (
      value !== null &&
      (effort === "xhigh" || effort === "max" ? value !== undefined : true)
    );
  });
  if (supportedEfforts.length === 0) return {};

  return {
    reasoning: {
      supportedEfforts,
      defaultEffort: supportedEfforts.includes("high")
        ? "high"
        : supportedEfforts[supportedEfforts.length - 1],
      canDisableThinking: map.off !== null,
    },
    thinkingLevelMap: cloneThinkingMap(map),
  };
}

function listedEffortsMap(model: WorkBuddyModel): WorkBuddyThinkingLevelMap {
  const map: WorkBuddyThinkingLevelMap = { minimal: null };
  const listed = model.reasoning?.supportedEfforts ?? [];
  for (const effort of WORKBUDDY_EFFORTS) {
    map[effort] = listed.includes(effort) ? effort : null;
  }
  return map;
}

function editableThinkingMap(model: WorkBuddyModel): WorkBuddyThinkingLevelMap {
  if (
    isThinkingLevelMap(model.thinkingLevelMap) &&
    Object.keys(model.thinkingLevelMap).length > 0
  ) {
    return cloneThinkingMap(model.thinkingLevelMap);
  }
  const map = listedEffortsMap(model);
  if (model.reasoning?.canDisableThinking === false) map.off = null;
  return map;
}

function withThinkingMap(
  model: WorkBuddyModel,
  map: WorkBuddyThinkingLevelMap,
): WorkBuddyModel {
  const { reasoning: _reasoning, thinkingLevelMap: _map, ...rest } = model;
  const fields = workbuddyThinkingFields(map);
  if (!fields.reasoning) return rest;

  const previous = model.reasoning?.defaultEffort;
  if (previous && fields.reasoning.supportedEfforts.includes(previous)) {
    fields.reasoning.defaultEffort = previous;
  }
  return { ...rest, ...fields };
}

export function setWorkBuddyEffort(
  model: WorkBuddyModel,
  effort: WorkBuddyEffort,
  enabled: boolean,
): WorkBuddyModel {
  const map = editableThinkingMap(model);
  if (!enabled) map[effort] = null;
  else if (typeof map[effort] !== "string") map[effort] = effort;
  return withThinkingMap(model, map);
}

export function setWorkBuddyCanDisableThinking(
  model: WorkBuddyModel,
  enabled: boolean,
): WorkBuddyModel {
  const map = editableThinkingMap(model);
  if (!enabled) map.off = null;
  else if (map.off === null) {
    delete map.off;
    if (Object.keys(map).length === 0)
      Object.assign(map, listedEffortsMap(model));
  }
  return withThinkingMap(model, map);
}

/** 将供应商根地址规范化为 WorkBuddy 使用的 Chat Completions 端点。 */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return /\/chat\/completions$/.test(trimmed)
    ? trimmed
    : `${trimmed}/chat/completions`;
}

const openAiModel = (id: string, name = id): WorkBuddyModel => ({
  id,
  name,
  supportsToolCall: true,
});

const reasoningModel = (
  model: WorkBuddyModel,
  map: WorkBuddyThinkingLevelMap,
): WorkBuddyModel => ({
  ...model,
  supportsReasoning: true,
  ...workbuddyThinkingFields(map),
});

/**
 * WorkBuddy 的模型配置是独立的 OpenAI Chat Completions 清单。
 * 这些预设只包含当前客户端已有配置中能确认协议和端点的供应商，API Key 仍由用户填写。
 */
const localWorkBuddyPresets: WorkBuddyPreset[] = [
  {
    name: "OpenAI Compatible",
    vendor: "OpenAI",
    url: "https://api.openai.com/v1/chat/completions",
    models: [openAiModel("gpt-4o", "GPT-4o")],
  },
  {
    name: "DeepSeek",
    vendor: "DeepSeek",
    url: "https://api.deepseek.com/v1/chat/completions",
    models: [
      openAiModel("deepseek-chat", "DeepSeek Chat"),
      reasoningModel(openAiModel("deepseek-reasoner", "DeepSeek Reasoner"), {
        low: null,
        medium: null,
        high: "high",
        max: "max",
      }),
    ],
  },
  {
    name: "Kimi",
    vendor: "Kimi",
    url: "https://api.moonshot.cn/v1/chat/completions",
    models: [
      openAiModel("kimi-k2.6", "Kimi K2.6"),
      reasoningModel(openAiModel("kimi-k3.1-pro", "Kimi K3.1 Pro"), {
        off: null,
        low: "low",
        high: "high",
        max: "max",
      }),
    ],
  },
  {
    name: "Zhipu GLM",
    vendor: "Zhipu GLM",
    url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    models: [
      reasoningModel(openAiModel("glm-5", "GLM-5"), {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        max: "max",
      }),
    ],
  },
  {
    name: "Zhipu GLM en",
    vendor: "Zhipu GLM en",
    url: "https://api.z.ai/api/paas/v4/chat/completions",
    models: [
      reasoningModel(openAiModel("glm-5", "GLM-5"), {
        off: null,
        low: "low",
        medium: "medium",
        high: "high",
        max: "max",
      }),
    ],
  },
  {
    name: "Bailian",
    vendor: "Bailian",
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    models: [
      openAiModel("qwen3-coder-plus", "Qwen3 Coder Plus"),
      reasoningModel(openAiModel("qwen3-max", "Qwen3 Max"), {
        low: "low",
        medium: "medium",
        high: "high",
        max: "max",
      }),
    ],
  },
  {
    name: "OpenRouter",
    vendor: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    models: [
      openAiModel("anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6"),
      openAiModel("openai/gpt-5.4", "GPT-5.4"),
      openAiModel("google/gemini-3.1-pro", "Gemini 3.1 Pro"),
    ],
  },
  {
    name: "TheRouter",
    vendor: "TheRouter",
    url: "https://api.therouter.ai/v1/chat/completions",
    models: [openAiModel("anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6")],
  },
  {
    name: "AiHubMix",
    vendor: "AiHubMix",
    url: "https://aihubmix.com/v1/chat/completions",
    models: [
      openAiModel("anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6"),
      openAiModel("gpt-5.4", "GPT-5.4"),
    ],
  },
  {
    name: "Nvidia",
    vendor: "Nvidia",
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    models: [
      openAiModel("moonshotai/kimi-k2.5", "Kimi K2.5"),
      openAiModel("qwen/qwen3-coder-480b-a35b-instruct", "Qwen3 Coder 480B"),
    ],
  },
  {
    name: "ModelScope",
    vendor: "ModelScope",
    url: "https://api-inference.modelscope.cn/v1/chat/completions",
    models: [openAiModel("ZhipuAI/GLM-5", "GLM-5")],
  },
  {
    name: "Together AI",
    vendor: "Together AI",
    url: "https://api.together.xyz/v1/chat/completions",
    models: [
      openAiModel(
        "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8-TEE",
        "Qwen3 Coder 480B",
      ),
      openAiModel("deepseek-ai/DeepSeek-V3.2", "DeepSeek V3.2"),
    ],
  },
];

const upstreamNames = new Set(upstreamWorkBuddyPresets.map(({ name }) => name));
export const workbuddyProviderPresets = [
  ...localWorkBuddyPresets.map((preset) =>
    upstreamNames.has(preset.name)
      ? { ...preset, name: `${preset.name} (legacy)` }
      : preset,
  ),
  ...upstreamWorkBuddyPresets,
];

export const WORKBUDDY_DEFAULT_CONFIG = JSON.stringify(
  {
    vendor: "",
    url: "",
    apiKey: "",
    models: [{ id: "", name: "", supportsToolCall: true }],
  },
  null,
  2,
);
