/**
 * Claude Desktop 预设供应商配置模板
 *
 * 形态与 Claude Code 预设不同：
 * - baseUrl 是顶级字段，而不是 settingsConfig.env.ANTHROPIC_BASE_URL
 * - 模型信息以"请求模型 → 上游模型 → 显示模型"三段式表达，
 *   对应后端 ClaudeDesktopModelRoute 的 routeId / model / displayName
 *
 * 翻译来源：src/config/claudeProviderPresets.ts（排除 OAuth 与不兼容预设）
 */
import { ProviderCategory } from "../types";
import type { PresetTheme } from "./claudeProviderPresets";

export type ClaudeDesktopApiFormat =
  | "anthropic"
  | "openai_chat"
  | "openai_responses"
  | "gemini_native";

export interface ClaudeDesktopRoutePreset {
  routeId: string;
  upstreamModel: string;
  displayName: string;
  supports1m: boolean;
}

export interface ClaudeDesktopProviderPreset {
  name: string;
  nameKey?: string;
  websiteUrl: string;
  apiKeyUrl?: string;
  category?: ProviderCategory;

  baseUrl: string;
  apiKeyField?: "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY";

  mode: "direct" | "proxy";
  apiFormat?: ClaudeDesktopApiFormat;
  modelRoutes?: ClaudeDesktopRoutePreset[];

  endpointCandidates?: string[];
  theme?: PresetTheme;
  icon?: string;
  iconColor?: string;
}

export const mappedRoutes = (
  sonnet: string,
  opus: string,
  haiku: string,
  supports1m = false,
): ClaudeDesktopRoutePreset[] => [
  {
    routeId: "claude-sonnet-4-6",
    upstreamModel: sonnet,
    displayName: "Sonnet",
    supports1m,
  },
  {
    routeId: "claude-opus-4-7",
    upstreamModel: opus,
    displayName: "Opus",
    supports1m,
  },
  {
    routeId: "claude-haiku-4-5",
    upstreamModel: haiku,
    displayName: "Haiku",
    supports1m,
  },
];

/**
 * 非 Claude 上游模型用此工厂：displayName 直接等于 upstreamModel，
 * 让用户在 Claude Desktop 看到的就是实际请求的模型 ID（如 "deepseek-v4-pro"）。
 */
export const brandedRoutes = (
  sonnet: string,
  opus: string,
  haiku: string,
  supports1m = false,
): ClaudeDesktopRoutePreset[] => [
  {
    routeId: "claude-sonnet-4-6",
    upstreamModel: sonnet,
    displayName: sonnet,
    supports1m,
  },
  {
    routeId: "claude-opus-4-7",
    upstreamModel: opus,
    displayName: opus,
    supports1m,
  },
  {
    routeId: "claude-haiku-4-5",
    upstreamModel: haiku,
    displayName: haiku,
    supports1m,
  },
];

export const claudeDesktopProviderPresets: ClaudeDesktopProviderPreset[] = [];
