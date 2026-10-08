import type { ProviderCategory } from "@/types";

/**
 * Gemini 预设供应商的视觉主题配置
 */
export interface GeminiPresetTheme {
  /** 图标类型：'gemini' | 'generic' | 'tuzi' */
  icon?: "gemini" | "generic" | "tuzi";
  /** 背景色（选中状态），支持 hex 颜色 */
  backgroundColor?: string;
  /** 文字色（选中状态），支持 hex 颜色 */
  textColor?: string;
}

export interface GeminiProviderPreset {
  name: string;
  nameKey?: string; // i18n key for localized display name
  websiteUrl: string;
  apiKeyUrl?: string;
  settingsConfig: object;
  baseURL?: string;
  model?: string;
  description?: string;
  category?: ProviderCategory;
  isPartner?: boolean;
  partnerPromotionKey?: string;
  endpointCandidates?: string[];
  theme?: GeminiPresetTheme;
  // 图标配置
  icon?: string; // 图标名称
  iconColor?: string; // 图标颜色
}

export const geminiProviderPresets: GeminiProviderPreset[] = [
  {
    name: "兔子线路",
    websiteUrl: "",
    apiKeyUrl: "https://api.tu-zi.com",
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: "https://api.tu-zi.com",
        GEMINI_MODEL: "gemini-3.1-pro",
      },
    },
    baseURL: "https://api.tu-zi.com",
    model: "gemini-3.1-pro",
    category: "aggregator",
    endpointCandidates: ["https://api.tu-zi.com"],
    icon: "tuzi",
    theme: { icon: "tuzi" },
  },
  {
    name: "Google Official",
    websiteUrl: "https://ai.google.dev/",
    apiKeyUrl: "https://aistudio.google.com/apikey",
    settingsConfig: {
      env: {},
    },
    description: "Google 官方 Gemini API (OAuth)",
    category: "official",
    partnerPromotionKey: "google-official",
    theme: {
      icon: "gemini",
      backgroundColor: "#4285F4",
      textColor: "#FFFFFF",
    },
    icon: "gemini",
    iconColor: "#4285F4",
  },
  {
    name: "E-FlowCode",
    websiteUrl: "https://e-flowcode.cc",
    apiKeyUrl: "https://e-flowcode.cc",
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: "https://e-flowcode.cc",
        GEMINI_API_KEY: "",
        GEMINI_MODEL: "gemini-3.1-pro",
      },
      config: {
        general: {
          previewFeatures: true,
          sessionRetention: {
            enabled: true,
            maxAge: "30d",
            warningAcknowledged: true,
          },
        },
        mcpServers: {},
        security: {
          auth: {
            selectedType: "gemini-api-key",
          },
        },
      },
    },
    baseURL: "https://e-flowcode.cc",
    model: "gemini-3.1-pro",
    description: "E-FlowCode",
    category: "third_party",
    endpointCandidates: ["https://e-flowcode.cc"],
    icon: "eflowcode",
    iconColor: "#000000",
  },
  {
    name: "OpenRouter",
    websiteUrl: "https://openrouter.ai",
    apiKeyUrl: "https://openrouter.ai/keys",
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: "https://openrouter.ai/api",
        GEMINI_MODEL: "gemini-3.1-pro",
      },
    },
    baseURL: "https://openrouter.ai/api",
    model: "gemini-3.1-pro",
    description: "OpenRouter",
    category: "aggregator",
    icon: "openrouter",
    iconColor: "#6566F1",
  },
  {
    name: "TheRouter",
    websiteUrl: "https://therouter.ai",
    apiKeyUrl: "https://dashboard.therouter.ai",
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: "https://api.therouter.ai",
        GEMINI_MODEL: "gemini-3.1-pro",
      },
    },
    baseURL: "https://api.therouter.ai",
    model: "gemini-3.1-pro",
    description: "TheRouter",
    category: "aggregator",
    endpointCandidates: ["https://api.therouter.ai"],
  },
];
