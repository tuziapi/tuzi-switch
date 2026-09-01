/**
 * Codex 预设供应商配置模板
 */
import { ProviderCategory } from "../types";
import type {
  CodexApiFormat,
  CodexCatalogModel,
  CodexChatReasoning,
} from "../types";
import type { PresetTheme } from "./claudeProviderPresets";

export interface CodexProviderPreset {
  name: string;
  nameKey?: string; // i18n key for localized display name
  websiteUrl: string;
  apiKeyUrl?: string;
  auth: Record<string, any>; // legacy, always {} for new providers
  config: string; // 将写入 ~/.codex/config.toml（TOML 字符串）
  isOfficial?: boolean;
  category?: ProviderCategory;
  isCustomTemplate?: boolean;
  endpointCandidates?: string[];
  envKey?: string; // 环境变量名，用于 shell rc managed block
  apiFormat?: CodexApiFormat;
  modelCatalog?: CodexCatalogModel[];
  codexChatReasoning?: CodexChatReasoning;
  theme?: PresetTheme;
  icon?: string;
  iconColor?: string;
}

/**
 * 生成第三方供应商的 auth.json (legacy - always empty for new providers)
 */
export function generateThirdPartyAuth(_apiKey: string): Record<string, any> {
  return {};
}

/**
 * 生成第三方供应商的 config.toml (profile-based)
 */
export function generateThirdPartyConfig(
  providerName: string,
  baseUrl: string,
  envKey: string,
  modelName = "gpt-5.5",
): string {
  return `model_provider = "custom"
model = "${modelName}"
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.custom]
name = "${providerName}"
base_url = "${baseUrl}"
env_key = "${envKey}"
wire_api = "responses"
requires_openai_auth = false`;
}

export const codexProviderPresets: CodexProviderPreset[] = [
  {
    name: "兔子线路",
    websiteUrl: "",
    apiKeyUrl: "https://api.tu-zi.com",
    auth: {},
    config: generateThirdPartyConfig(
      "provider-tuzi01",
      "https://api.tu-zi.com/v1",
      "TUZI01_CODEX_API_KEY",
      "gpt-5.5",
    ),
    envKey: "TUZI01_CODEX_API_KEY",
    category: "aggregator",
    endpointCandidates: ["https://api.tu-zi.com/v1"],
    icon: "tuzi",
    theme: { icon: "tuzi" },
  },
  {
    name: "codex订阅",
    websiteUrl: "",
    apiKeyUrl: "https://store.tu-zi.com/cat/11",
    auth: {},
    config: generateThirdPartyConfig(
      "provider-coding01",
      "https://api.tu-zi.com/coding",
      "CODING01_CODEX_API_KEY",
      "gpt-5.5",
    ),
    envKey: "CODING01_CODEX_API_KEY",
    category: "aggregator",
    endpointCandidates: [
      "https://api.tu-zi.com/coding",
      "https://coding.tu-zi.com",
      "https://coding.opentu.ai",
      "https://coding.sydney-ai.com",
    ],
    icon: "codex-sub",
    theme: { icon: "codex-sub" },
  },
  {
    name: "gaccode",
    websiteUrl: "",
    apiKeyUrl: "https://store.tu-zi.com/cat/1",
    auth: {},
    config: generateThirdPartyConfig(
      "gac",
      "https://gaccode.com/codex/v1",
      "GAC_CODEX_API_KEY",
      "gpt-5.5",
    ),
    envKey: "GAC_CODEX_API_KEY",
    category: "aggregator",
    endpointCandidates: ["https://gaccode.com/codex/v1"],
    icon: "gaccode",
    theme: { icon: "gaccode" },
  },
  {
    name: "OpenAI Official",
    websiteUrl: "https://chatgpt.com/codex",
    isOfficial: true,
    category: "official",
    auth: {},
    config: ``,
    theme: {
      icon: "codex",
      backgroundColor: "#1F2937",
      textColor: "#FFFFFF",
    },
    icon: "openai",
    iconColor: "#00A67E",
  },
  {
    name: "Azure OpenAI",
    websiteUrl:
      "https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/codex",
    category: "third_party",
    isOfficial: true,
    auth: {},
    config: generateThirdPartyConfig(
      "azure",
      "https://YOUR_RESOURCE_NAME.openai.azure.com/openai",
      "AZURE_CODEX_API_KEY",
      "gpt-5.4",
    ),
    envKey: "AZURE_CODEX_API_KEY",
    endpointCandidates: ["https://YOUR_RESOURCE_NAME.openai.azure.com/openai"],
    theme: {
      icon: "codex",
      backgroundColor: "#0078D4",
      textColor: "#FFFFFF",
    },
    icon: "azure",
    iconColor: "#0078D4",
  },
  {
    name: "AiHubMix",
    websiteUrl: "https://aihubmix.com",
    category: "aggregator",
    auth: {},
    config: generateThirdPartyConfig(
      "aihubmix",
      "https://aihubmix.com/v1",
      "AIHUBMIX_CODEX_API_KEY",
      "gpt-5.4",
    ),
    envKey: "AIHUBMIX_CODEX_API_KEY",
    endpointCandidates: [
      "https://aihubmix.com/v1",
      "https://api.aihubmix.com/v1",
    ],
  },
  {
    name: "RelaxyCode",
    websiteUrl: "https://www.relaxycode.com",
    apiKeyUrl: "https://www.relaxycode.com/register",
    category: "third_party",
    auth: {},
    config: generateThirdPartyConfig(
      "relaxycode",
      "https://www.relaxycode.com/v1",
      "RELAXYCODE_CODEX_API_KEY",
      "gpt-5.5",
    ),
    envKey: "RELAXYCODE_CODEX_API_KEY",
    icon: "relaxcode",
  },
  {
    name: "E-FlowCode",
    websiteUrl: "https://e-flowcode.cc",
    apiKeyUrl: "https://e-flowcode.cc",
    auth: {},
    config: generateThirdPartyConfig(
      "e_flowcode",
      "https://e-flowcode.cc/v1",
      "EFLOWCODE_CODEX_API_KEY",
      "gpt-5.4",
    ),
    envKey: "EFLOWCODE_CODEX_API_KEY",
    category: "third_party",
    endpointCandidates: ["https://e-flowcode.cc/v1"],
    icon: "eflowcode",
    iconColor: "#000000",
  },
  {
    name: "PIPELLM",
    websiteUrl: "https://code.pipellm.ai",
    apiKeyUrl: "https://code.pipellm.ai/login?ref=uvw650za",
    auth: {},
    config: generateThirdPartyConfig(
      "pipellm",
      "https://cc-api.pipellm.ai/v1",
      "PIPELLM_CODEX_API_KEY",
      "gpt-5.4",
    ),
    envKey: "PIPELLM_CODEX_API_KEY",
    category: "aggregator",
    endpointCandidates: ["https://cc-api.pipellm.ai/v1"],
    icon: "pipellm",
  },
  {
    name: "OpenRouter",
    websiteUrl: "https://openrouter.ai",
    apiKeyUrl: "https://openrouter.ai/keys",
    auth: {},
    config: generateThirdPartyConfig(
      "openrouter",
      "https://openrouter.ai/api/v1",
      "OPENROUTER_CODEX_API_KEY",
      "gpt-5.4",
    ),
    envKey: "OPENROUTER_CODEX_API_KEY",
    category: "aggregator",
    icon: "openrouter",
    iconColor: "#6566F1",
  },
  {
    name: "TheRouter",
    websiteUrl: "https://therouter.ai",
    apiKeyUrl: "https://dashboard.therouter.ai",
    auth: {},
    config: generateThirdPartyConfig(
      "therouter",
      "https://api.therouter.ai/v1",
      "THEROUTER_CODEX_API_KEY",
      "openai/gpt-5.3-codex",
    ),
    envKey: "THEROUTER_CODEX_API_KEY",
    endpointCandidates: ["https://api.therouter.ai/v1"],
    category: "aggregator",
  },
];
