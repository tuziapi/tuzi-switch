import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload, Wrench } from "lucide-react";
import type { AppId } from "@/lib/api";
import { providersApi } from "@/lib/api/providers";
import {
  installerApi,
  type ClaudeInstallerStatus,
  type CodexInstallerStatus,
  type GeminiInstallerStatus,
  type InstallerActionResult,
} from "@/lib/api/installer";
import { openclawApi } from "@/lib/api/openclaw";
import {
  openclawKeys,
  useOpenClawAgentsDefaults,
  useOpenClawDefaultModel,
  useOpenClawHealth,
  useOpenClawLiveProviderIds,
  useOpenClawTools,
} from "@/hooks/useOpenClaw";
import {
  ClaudeIcon,
  CodexIcon,
  GeminiIcon,
  OpenClawIcon,
} from "@/components/BrandIcons";
import { generateThirdPartyAuth } from "@/config/codexProviderPresets";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchProvidersQueryData,
  providersQueryKey,
  type ProvidersQueryData,
  useProvidersQuery,
} from "@/lib/query/queries";
import type { OpenClawModel, Provider } from "@/types";
import { extractErrorMessage } from "@/utils/errorUtils";

type OpenClawRoute = "tuzi-claude" | "tuzi-codex" | "gac-claude" | "gac-codex";
type ClaudeBusinessRoute = "gaccode" | "tu-zi";
type CodexBusinessRoute = "gac" | "tuzi" | "codex";
type GeminiBusinessRoute = "tuzi";
type ClaudeEntryOption = "modified" | "gaccode" | "tu-zi";
type CodexEntryOption = "tuzi" | "tuzi-coding" | "gac" | "gac-modified";
type GeminiEntryOption = "tuzi" | "gac-modified";
type BusinessProviderApp = "claude" | "codex" | "gemini" | "openclaw";

const EMPTY_CLAUDE_STATUS: ClaudeInstallerStatus = {
  installed: false,
  version: null,
  latest_version: null,
  resolved_version: null,
  current_route: null,
  route_file_current_route: null,
  effective_base_url: null,
  resolved_executable_path: null,
  resolved_package_name: null,
  resolved_variant: null,
  variant_conflict: false,
  route_file_exists: false,
  settings_file_exists: false,
  sources_conflict: false,
  process_env_route: null,
  runtime_env_conflict: false,
  routes: [],
  env_summary: {
    anthropic_api_key_masked: null,
    anthropic_base_url: null,
    anthropic_api_token_set: false,
  },
  settings_summary: {
    anthropic_api_key_masked: null,
    anthropic_base_url: null,
    anthropic_auth_token_set: false,
  },
  process_env_summary: {
    anthropic_api_key_masked: null,
    anthropic_base_url: null,
    anthropic_auth_token_set: false,
  },
};

const EMPTY_CODEX_STATUS: CodexInstallerStatus = {
  installed: false,
  version: null,
  latest_version: null,
  resolved_version: null,
  install_type: null,
  current_route: null,
  resolved_executable_path: null,
  resolved_package_name: null,
  resolved_variant: null,
  variant_conflict: false,
  state_file_exists: false,
  config_file_exists: false,
  routes: [],
  env_summary: {
    codex_api_key_masked: null,
  },
};

const EMPTY_GEMINI_STATUS: GeminiInstallerStatus = {
  installed: false,
  version: null,
  latest_version: null,
  resolved_version: null,
  install_type: null,
  current_route: null,
  resolved_executable_path: null,
  resolved_package_name: null,
  resolved_variant: null,
  variant_conflict: false,
  env_file_exists: false,
  settings_file_exists: false,
  routes: [],
  env_summary: {
    gemini_api_key_masked: null,
    google_gemini_base_url: null,
    gemini_model: null,
  },
};

const CODEX_REASONING_OPTIONS = [
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh / 超高" },
];

const OPENCLAW_ROUTE_CONFIG: Record<
  OpenClawRoute,
  {
    label: string;
    optionLabel: string;
    providerId: string;
    providerName: string;
    baseUrl: string;
    api: string;
    apiKeyLabel: string;
    models: OpenClawModel[];
  }
> = {
  "tuzi-claude": {
    label: "兔子 Claude 线路",
    optionLabel: "兔子 · Claude 线路",
    providerId: "tuzi-openclaw-claude",
    providerName: "兔子 Claude 线路",
    baseUrl: "https://api.tu-zi.com",
    api: "anthropic-messages",
    apiKeyLabel: "兔子 API Key",
    models: [
      {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        contextWindow: 200000,
        maxTokens: 8192,
      },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        contextWindow: 200000,
        maxTokens: 8192,
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        contextWindow: 200000,
        maxTokens: 8192,
      },
    ],
  },
  "tuzi-codex": {
    label: "兔子 Codex 线路",
    optionLabel: "兔子 · Codex 线路",
    providerId: "tuzi-openclaw-codex",
    providerName: "兔子 Codex 线路",
    baseUrl: "https://api.tu-zi.com/v1",
    api: "openai-responses",
    apiKeyLabel: "兔子 API Key",
    models: [
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        contextWindow: 200000,
        maxTokens: 100000,
      },
    ],
  },
  "gac-claude": {
    label: "gac Claude 线路",
    optionLabel: "gac · Claude 线路",
    providerId: "gac-openclaw-claude",
    providerName: "gac Claude 线路",
    baseUrl: "https://gaccode.com/claudecode",
    api: "anthropic-messages",
    apiKeyLabel: "GAC API Key",
    models: [
      {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        contextWindow: 200000,
        maxTokens: 8192,
      },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        contextWindow: 200000,
        maxTokens: 8192,
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        contextWindow: 200000,
        maxTokens: 8192,
      },
    ],
  },
  "gac-codex": {
    label: "gac Codex 线路",
    optionLabel: "gac · Codex 线路",
    providerId: "gac-openclaw-codex",
    providerName: "gac Codex 线路",
    baseUrl: "https://gaccode.com/codex/v1",
    api: "openai-completions",
    apiKeyLabel: "GAC API Key",
    models: [
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        contextWindow: 200000,
        maxTokens: 100000,
      },
    ],
  },
};

const CLAUDE_ROUTE_CONFIG: Record<
  ClaudeBusinessRoute,
  {
    providerId: string;
    providerName: string;
    baseUrl: string;
    websiteUrl: string;
  }
> = {
  gaccode: {
    providerId: "gac-claude-route",
    providerName: "Claude · gac 线路",
    baseUrl: "https://gaccode.com/claudecode",
    websiteUrl: "https://gaccode.com/claudecode",
  },
  "tu-zi": {
    providerId: "tuzi-claude-route",
    providerName: "Claude · 兔子线路",
    baseUrl: "https://api.tu-zi.com",
    websiteUrl: "https://api.tu-zi.com",
  },
};

const CODEX_ROUTE_CONFIG = {
  tuzi: {
    providerId: "tuzi-codex-route",
    providerName: "Codex · 兔子线路",
    baseUrl: "https://api.tu-zi.com/v1",
    websiteUrl: "https://api.tu-zi.com",
    businessLine: "tuzi" as const,
  },
  codex: {
    providerId: "tuzi.coding",
    providerName: "Codex·粉色订阅",
    baseUrl: "https://api.tu-zi.com/coding",
    websiteUrl: "https://api.tu-zi.com/coding",
    businessLine: "tuzi" as const,
  },
  gac: {
    providerId: "gac-codex-route",
    providerName: "Codex · gac 线路",
    baseUrl: "https://gaccode.com/codex/v1",
    websiteUrl: "https://gaccode.com/codex",
    businessLine: "gac" as const,
  },
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isBusinessRouteProviderId(providerId: string, baseProviderId: string) {
  if (providerId === baseProviderId) return true;
  return new RegExp(`^${escapeRegExp(baseProviderId)}-alt-\\d+$`).test(
    providerId,
  );
}

function getBusinessRouteProviderAltIndex(
  providerId: string,
  baseProviderId: string,
): number | null {
  if (providerId === baseProviderId) return null;
  const match = providerId.match(
    new RegExp(`^${escapeRegExp(baseProviderId)}-alt-(\\d+)$`),
  );
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isFinite(index) ? index : null;
}

function getBusinessRouteProviders(
  providerMap: Record<string, Provider> | undefined,
  baseProviderId: string,
) {
  return Object.values(providerMap || {}).filter((provider) =>
    isBusinessRouteProviderId(provider.id, baseProviderId),
  );
}

function getBusinessRouteApiKey(
  provider: Provider,
  app: BusinessProviderApp,
): string {
  if (app === "claude") {
    return (
      provider.settingsConfig?.env?.ANTHROPIC_API_KEY ||
      provider.settingsConfig?.env?.ANTHROPIC_AUTH_TOKEN ||
      ""
    )
      .toString()
      .trim();
  }
  if (app === "codex") {
    return (provider.settingsConfig?.auth?.OPENAI_API_KEY || "")
      .toString()
      .trim();
  }
  if (app === "gemini") {
    return (provider.settingsConfig?.env?.GEMINI_API_KEY || "")
      .toString()
      .trim();
  }
  return (provider.settingsConfig?.apiKey || "").toString().trim();
}

function getNextBusinessRouteProviderSlot(
  providerMap: Record<string, Provider> | undefined,
  baseProviderId: string,
) {
  const nextProviderMap = providerMap || {};
  if (!nextProviderMap[baseProviderId]) {
    return {
      targetProviderId: baseProviderId,
      altIndex: null as number | null,
    };
  }

  let altIndex = 2;
  while (nextProviderMap[`${baseProviderId}-alt-${altIndex}`]) {
    altIndex += 1;
  }

  return {
    targetProviderId: `${baseProviderId}-alt-${altIndex}`,
    altIndex,
  };
}

function resolveBusinessRouteProviderTarget(
  providerMap: Record<string, Provider> | undefined,
  baseProviderId: string,
  apiKey: string,
  app: BusinessProviderApp,
) {
  const nextProviderMap = providerMap || {};
  const matchedProvider = getBusinessRouteProviders(
    nextProviderMap,
    baseProviderId,
  ).find((provider) => getBusinessRouteApiKey(provider, app) === apiKey);

  if (matchedProvider) {
    return {
      targetProviderId: matchedProvider.id,
      altIndex: getBusinessRouteProviderAltIndex(
        matchedProvider.id,
        baseProviderId,
      ),
      existingProvider: matchedProvider,
      isNew: false,
    };
  }

  const nextSlot = getNextBusinessRouteProviderSlot(
    nextProviderMap,
    baseProviderId,
  );

  return {
    ...nextSlot,
    existingProvider: nextProviderMap[nextSlot.targetProviderId],
    isNew: !nextProviderMap[nextSlot.targetProviderId],
  };
}

function buildBusinessRouteProviderName(
  baseName: string,
  altIndex: number | null,
) {
  if (!altIndex) return baseName;
  return `${baseName}（附加 Key ${altIndex}）`;
}

function buildBusinessRouteProviderNotes(
  baseNotes: string,
  altIndex: number | null,
) {
  if (!altIndex) return baseNotes;
  return `${baseNotes}（附加 Key ${altIndex}）`;
}

function getOpenClawRouteFromProviderId(
  providerId: string | null | undefined,
): OpenClawRoute | null {
  if (!providerId) return null;
  for (const [route, config] of Object.entries(OPENCLAW_ROUTE_CONFIG) as Array<
    [OpenClawRoute, (typeof OPENCLAW_ROUTE_CONFIG)[OpenClawRoute]]
  >) {
    if (isBusinessRouteProviderId(providerId, config.providerId)) {
      return route;
    }
  }
  return null;
}

function hasBusinessRouteProviderInList(
  providerIds: string[],
  baseProviderId: string,
) {
  return providerIds.some((providerId) =>
    isBusinessRouteProviderId(providerId, baseProviderId),
  );
}

function hasBusinessRouteProviderInRecord(
  providerMap: Record<string, Provider>,
  baseProviderId: string,
) {
  return Object.keys(providerMap).some((providerId) =>
    isBusinessRouteProviderId(providerId, baseProviderId),
  );
}

function getCurrentRouteBaseUrl(
  routes: Array<{ is_current: boolean; base_url: string | null }> | undefined,
) {
  return routes?.find((route) => route.is_current)?.base_url || "--";
}

function hasNamedRoute(
  routes: Array<{ name?: string | null }> | undefined,
  routeName: string,
) {
  return Boolean(routes?.some((route) => route.name === routeName));
}

function getClaudeRouteLabel(
  route: ClaudeEntryOption | "modified" | "custom" | null | undefined,
) {
  if (!route) return "--";
  if (route === "tu-zi") return CLAUDE_ROUTE_CONFIG["tu-zi"].providerName;
  if (route === "gaccode") return CLAUDE_ROUTE_CONFIG.gaccode.providerName;
  if (route === "modified") return "gac 改版 Claude";
  return "自定义线路";
}

function getClaudeRouteFromProvider(
  currentProviderId: string,
  provider?: Provider,
): ClaudeEntryOption | "custom" | null {
  if (!currentProviderId && !provider?.name) return null;
  const baseUrl = getProviderBaseUrl(provider)?.toLowerCase() || "";
  const providerName = provider?.name || "";
  if (
    currentProviderId === CLAUDE_ROUTE_CONFIG.gaccode.providerId ||
    providerName.includes("Claude · gac 线路") ||
    providerName.includes("gac Claude") ||
    baseUrl.includes("gaccode.com/claudecode")
  ) {
    return "gaccode";
  }
  if (
    currentProviderId === CLAUDE_ROUTE_CONFIG["tu-zi"].providerId ||
    providerName.includes("Claude · 兔子线路") ||
    providerName.includes("兔子 Claude") ||
    baseUrl.includes("api.tu-zi.com")
  ) {
    return "tu-zi";
  }
  if (currentProviderId) {
    return "custom";
  }
  return null;
}

function getCodexRouteFromProvider(
  currentProviderId: string,
  provider?: Provider,
): CodexEntryOption | "custom" | null {
  if (!currentProviderId && !provider?.name) return null;
  const baseUrl = getProviderBaseUrl(provider)?.toLowerCase() || "";
  const providerName = provider?.name || "";

  if (
    currentProviderId === CODEX_ROUTE_CONFIG.gac.providerId ||
    providerName.includes("Codex · gac 线路") ||
    providerName.includes("gac") ||
    provider?.meta?.businessLine === "gac" ||
    baseUrl.includes("gaccode.com/codex")
  ) {
    return "gac";
  }

  if (
    currentProviderId === CODEX_ROUTE_CONFIG.tuzi.providerId ||
    providerName.includes("Codex · 兔子线路") ||
    providerName.includes("兔子 Codex · 兔子主线路") ||
    baseUrl.includes("api.tu-zi.com/v1")
  ) {
    return "tuzi";
  }
  if (
    currentProviderId === CODEX_ROUTE_CONFIG.codex.providerId ||
    providerName.includes("Codex·粉色订阅") ||
    providerName.includes("Codex · 兔子 Coding 特别线路") ||
    providerName.includes("Coding 特别线路") ||
    baseUrl.includes("api.tu-zi.com/coding") ||
    baseUrl.includes("coding.tu-zi.com")
  ) {
    return "tuzi-coding";
  }
  if (currentProviderId) {
    return "custom";
  }
  return null;
}

function getGeminiRouteFromProvider(
  currentProviderId: string,
  provider?: Provider,
): GeminiEntryOption | "custom" | null {
  if (!currentProviderId && !provider?.name) return null;
  const baseUrl = getProviderBaseUrl(provider)?.toLowerCase() || "";
  const providerName = provider?.name || "";
  if (
    currentProviderId === GEMINI_ROUTE_CONFIG.tuzi.providerId ||
    providerName.includes("Gemini · 兔子线路") ||
    providerName.includes("兔子 Gemini") ||
    baseUrl.includes("api.tu-zi.com")
  ) {
    return "tuzi";
  }
  if (currentProviderId) {
    return "custom";
  }
  return null;
}

function getClaudeInstallerRoute(
  status: ClaudeInstallerStatus | null,
): ClaudeEntryOption | "modified" | "custom" | null {
  if (!status) return null;
  if (status.current_route === "改版") return "modified";
  if (status.current_route === "gaccode") return "gaccode";
  if (status.current_route === "tu-zi") return "tu-zi";
  if (status.current_route) return "custom";
  return null;
}

function getCodexInstallerRoute(
  status: CodexInstallerStatus | null,
): CodexEntryOption | "gac-modified" | "custom" | null {
  if (!status) return null;
  if (status.install_type === "gac") return "gac-modified";
  if (status.current_route === "codex") return "tuzi-coding";
  if (status.current_route === "gac") return "gac";
  if (status.current_route === "tuzi") return "tuzi";
  if (status.current_route) return "custom";
  return null;
}

function getGeminiInstallerRoute(
  status: GeminiInstallerStatus | null,
): GeminiEntryOption | "gac-modified" | "custom" | null {
  if (!status) return null;
  if (status.install_type === "gac") return "gac-modified";
  if (status.current_route === "tuzi") return "tuzi";
  if (status.current_route) return "custom";
  return null;
}

function resolveDisplayedBusinessRoute<
  TOriginal extends string,
  TModified extends string,
>({
  providerRoute,
  installerRoute,
  usingModifiedVariant,
  modifiedRoute,
  hasCurrentProvider,
  preferProvider = true,
}: {
  providerRoute: TOriginal | "custom" | null;
  installerRoute: TOriginal | TModified | "custom" | null;
  usingModifiedVariant: boolean;
  modifiedRoute: TModified;
  hasCurrentProvider: boolean;
  preferProvider?: boolean;
}): TOriginal | TModified | "custom" | null {
  if (usingModifiedVariant) {
    return modifiedRoute;
  }
  if (preferProvider && providerRoute) {
    return providerRoute;
  }
  if (installerRoute && installerRoute !== modifiedRoute) {
    return installerRoute;
  }
  if (providerRoute) {
    return providerRoute;
  }
  return hasCurrentProvider ? "custom" : null;
}

function getCodexRouteLabel(
  route: CodexEntryOption | "gac-modified" | "custom" | null | undefined,
) {
  if (!route) return "--";
  if (route === "tuzi") return CODEX_ROUTE_CONFIG.tuzi.providerName;
  if (route === "tuzi-coding") return CODEX_ROUTE_CONFIG.codex.providerName;
  if (route === "gac") return CODEX_ROUTE_CONFIG.gac.providerName;
  if (route === "gac-modified") return "gac 改版 Codex";
  return "自定义线路";
}

function getGeminiRouteLabel(
  route: GeminiEntryOption | "gac-modified" | "custom" | null | undefined,
) {
  if (!route) return "--";
  if (route === "tuzi") return GEMINI_ROUTE_CONFIG.tuzi.providerName;
  if (route === "gac-modified") return "gac 改版 Gemini";
  return "自定义线路";
}

function getInstalledVersionLabel(
  installed: boolean,
  version: string | null | undefined,
  latestVersion?: string | null,
) {
  if (!installed) return "未安装";
  const currentVersion = version?.trim();
  const latest = latestVersion?.trim();
  if (!currentVersion) return "已安装";
  if (
    latest &&
    compareVersionMarkers(currentVersion, latest) === 0
  ) {
    return `${currentVersion}（最新版）`;
  }
  return currentVersion;
}

type VersionCheckState = "latest" | "upgrade" | "unknown" | "not-installed";

function parseVersionMarker(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  const parts = normalized
    .split(/[.-]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const firstNumberIndex = parts.findIndex((part) => /^\d+$/.test(part));
  if (firstNumberIndex < 0) return null;
  return parts.slice(firstNumberIndex).map((part) => {
    if (/^\d+$/.test(part)) return Number(part);
    return part;
  });
}

function isGacBuildSuffix(parts: Array<number | string>) {
  return (
    parts.length >= 2 &&
    parts[0] === "gac" &&
    parts.slice(1).every((part) => typeof part === "number")
  );
}

function compareVersionMarkers(
  current: string | null | undefined,
  latest: string | null | undefined,
) {
  const currentParts = parseVersionMarker(current);
  const latestParts = parseVersionMarker(latest);
  if (!currentParts || !latestParts) return null;
  const length = Math.max(currentParts.length, latestParts.length);
  for (let index = 0; index < length; index += 1) {
    const currentPart = currentParts[index];
    const latestPart = latestParts[index];
    if (currentPart === undefined || latestPart === undefined) {
      const remainingCurrent = currentParts.slice(index);
      const remainingLatest = latestParts.slice(index);
      if (
        (remainingCurrent.length === 0 && isGacBuildSuffix(remainingLatest)) ||
        (remainingLatest.length === 0 && isGacBuildSuffix(remainingCurrent))
      ) {
        return 0;
      }
      return null;
    }
    if (currentPart === latestPart) continue;
    if (typeof currentPart === "number" && typeof latestPart === "number") {
      return currentPart > latestPart ? 1 : -1;
    }
    if (typeof currentPart === "string" && typeof latestPart === "string") {
      return currentPart.localeCompare(latestPart);
    }
    return null;
  }
  return 0;
}

function getVersionCheckState(
  installed: boolean,
  version: string | null | undefined,
  latestVersion?: string | null,
): VersionCheckState {
  if (!installed) return "not-installed";
  const currentVersion = version?.trim();
  const latest = latestVersion?.trim();
  if (!currentVersion || !latest) return "unknown";
  const compared = compareVersionMarkers(currentVersion, latest);
  if (compared === null) return "unknown";
  return compared >= 0 ? "latest" : "upgrade";
}

function getUpgradeButtonTitle(state: VersionCheckState) {
  if (state === "latest") return "当前已是最新版";
  if (state === "unknown") return "最新版检测失败，请刷新状态后重试";
  return undefined;
}

function getUpgradeButtonLabel(state: VersionCheckState) {
  return state === "latest" ? "已最新" : "升级";
}

function getCliVariantLabel(
  installed: boolean,
  resolvedVariant: string | null | undefined,
  originalVariantValues: string[],
  modifiedVariantValues: string[],
) {
  if (!installed) return "未安装";
  const normalizedVariant = resolvedVariant?.trim().toLowerCase();
  if (!normalizedVariant) return "已安装";
  if (originalVariantValues.includes(normalizedVariant)) {
    return "原版";
  }
  if (modifiedVariantValues.includes(normalizedVariant)) {
    return "gac 改版";
  }
  if (normalizedVariant === "unknown") {
    return "未知";
  }
  return normalizedVariant;
}

function getOpenClawCurrentRoute(
  primaryModel: string | undefined,
  configuredRoutes: OpenClawRoute[],
): OpenClawRoute | null {
  const primaryProviderId = primaryModel?.split("/")[0] || null;
  const providerRoute = getOpenClawRouteFromProviderId(primaryProviderId);
  if (providerRoute) {
    return providerRoute;
  }

  if (configuredRoutes.length === 1) {
    return configuredRoutes[0];
  }

  return null;
}

function getClaudeStatusBaseUrl(status: ClaudeInstallerStatus) {
  return (
    status.effective_base_url?.trim() ||
    status.settings_summary?.anthropic_base_url?.trim() ||
    status.env_summary.anthropic_base_url?.trim() ||
    getCurrentRouteBaseUrl(status.routes) ||
    "--"
  );
}

function getCodexStatusBaseUrl(
  route: CodexEntryOption | "gac-modified" | "custom" | null,
  status: CodexInstallerStatus,
) {
  if (route === "gac-modified" || route === "gac") {
    return CODEX_ROUTE_CONFIG.gac.baseUrl;
  }
  if (route === "tuzi") {
    return CODEX_ROUTE_CONFIG.tuzi.baseUrl;
  }
  if (route === "tuzi-coding") {
    return CODEX_ROUTE_CONFIG.codex.baseUrl;
  }
  return getCurrentRouteBaseUrl(status.routes);
}

function getGeminiStatusBaseUrl(
  route: GeminiEntryOption | "gac-modified" | "custom" | null,
  status: GeminiInstallerStatus,
) {
  if (route === "gac-modified") {
    return "https://gaccode.com/gemini";
  }
  if (route === "tuzi") {
    return GEMINI_ROUTE_CONFIG.tuzi.baseUrl;
  }
  return (
    status.env_summary.google_gemini_base_url ||
    getCurrentRouteBaseUrl(status.routes)
  );
}

function getProviderBaseUrl(provider?: Provider): string | null {
  if (!provider) return null;
  const env = provider.settingsConfig?.env;
  if (typeof env?.ANTHROPIC_BASE_URL === "string" && env.ANTHROPIC_BASE_URL) {
    return env.ANTHROPIC_BASE_URL;
  }
  if (
    typeof env?.GOOGLE_GEMINI_BASE_URL === "string" &&
    env.GOOGLE_GEMINI_BASE_URL
  ) {
    return env.GOOGLE_GEMINI_BASE_URL;
  }
  if (
    typeof provider.settingsConfig?.baseUrl === "string" &&
    provider.settingsConfig.baseUrl
  ) {
    return provider.settingsConfig.baseUrl;
  }

  const config = provider.settingsConfig?.config;
  if (typeof config === "string" && config.trim()) {
    const modelProviderMatch = config.match(
      /^\s*model_provider\s*=\s*"([^"]+)"/m,
    );
    const profileMatch = config.match(/^\s*profile\s*=\s*"([^"]+)"/m);
    const profile =
      modelProviderMatch?.[1]?.trim() ||
      profileMatch?.[1]?.trim() ||
      provider.id.split(".").pop()?.trim() ||
      "";
    if (profile) {
      const escapedProfile = profile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const sectionPattern = new RegExp(
        `\\[model_providers\\.${escapedProfile}\\][\\s\\S]*?^\\s*base_url\\s*=\\s*"([^"]+)"`,
        "m",
      );
      const sectionMatch = config.match(sectionPattern);
      if (sectionMatch?.[1]?.trim()) {
        return sectionMatch[1].trim();
      }
    }
  }
  if (config && typeof config === "object") {
    const profile =
      typeof config.model_provider === "string"
        ? config.model_provider
        : typeof config.profile === "string"
          ? config.profile
          : null;
    const modelProviders = config.model_providers;
    if (
      profile &&
      modelProviders &&
      typeof modelProviders === "object" &&
      typeof modelProviders[profile]?.base_url === "string"
    ) {
      return modelProviders[profile].base_url;
    }
  }

  return null;
}

const GEMINI_ROUTE_CONFIG = {
  tuzi: {
    providerId: "tuzi-gemini-route",
    providerName: "Gemini · 兔子线路",
    baseUrl: "https://api.tu-zi.com",
    websiteUrl: "https://api.tu-zi.com",
    businessLine: "tuzi" as const,
  },
};

function buildCodexBusinessConfig(
  route: CodexBusinessRoute,
  baseUrl: string,
  modelName = "gpt-5.4",
  reasoningEffort = "medium",
) {
  const profileName = route === "gac" ? "codex" : route;
  return `profile = "${profileName}"
model_provider = "${profileName}"
model = "${modelName}"
model_reasoning_effort = "${reasoningEffort}"
disable_response_storage = true

[model_providers.${profileName}]
name = "${profileName}"
base_url = "${baseUrl}"
wire_api = "responses"
requires_openai_auth = true

[profiles.${profileName}]
model_provider = "${profileName}"
model = "${modelName}"
model_reasoning_effort = "${reasoningEffort}"
approval_policy = "on-request"`;
}

function Stat({
  label,
  value,
  action,
  compact = false,
  valueClassName,
  valueTitle,
}: {
  label: string;
  value: string;
  action?: ReactNode;
  compact?: boolean;
  valueClassName?: string;
  valueTitle?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-border/60 bg-background/75 px-3 dark:border-white/10 dark:bg-white/6 ${
        compact ? "py-2" : "py-3"
      }`}
    >
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`flex items-center justify-between gap-3 ${
          compact ? "mt-1 min-h-5" : "mt-2 min-h-6"
        }`}
      >
        <div
          className={`min-w-0 flex-1 text-sm font-medium leading-5 ${valueClassName || ""}`}
          title={valueTitle || value}
        >
          {value}
        </div>
        {action ? <div className="shrink-0 self-center">{action}</div> : null}
      </div>
    </div>
  );
}

function RouteCard({
  title,
  description,
  meta,
  status,
  selected,
  tone = "orange",
  onClick,
}: {
  title: string;
  description?: string;
  meta?: string;
  status: string;
  selected: boolean;
  tone?: "orange" | "sky" | "pink" | "rose" | "red";
  onClick: () => void;
}) {
  const toneClasses = {
    orange: {
      selected:
        "border-orange-300 bg-orange-50/80 shadow-sm dark:border-orange-400/45 dark:bg-[linear-gradient(135deg,#4a3328,#2a2322)] dark:shadow-[0_0_0_1px_rgba(251,146,60,0.06)]",
      idle: "border-border/60 bg-background/70 hover:border-orange-200 hover:bg-orange-50/40 dark:bg-background/30 dark:hover:border-orange-400/30 dark:hover:bg-orange-500/8",
      badge:
        "bg-orange-100 text-orange-700 dark:bg-orange-500/18 dark:text-orange-200",
    },
    sky: {
      selected:
        "border-sky-300 bg-sky-50/80 shadow-sm dark:border-sky-400/45 dark:bg-[linear-gradient(135deg,#253846,#20272d)] dark:shadow-[0_0_0_1px_rgba(56,189,248,0.06)]",
      idle: "border-border/60 bg-background/70 hover:border-sky-200 hover:bg-sky-50/40 dark:bg-background/30 dark:hover:border-sky-400/30 dark:hover:bg-sky-500/8",
      badge: "bg-sky-100 text-sky-700 dark:bg-sky-500/18 dark:text-sky-200",
    },
    pink: {
      selected:
        "border-pink-300 bg-pink-50/80 shadow-sm dark:border-pink-400/45 dark:bg-[linear-gradient(135deg,#4a2d3d,#282126)] dark:shadow-[0_0_0_1px_rgba(236,72,153,0.06)]",
      idle: "border-border/60 bg-background/70 hover:border-pink-200 hover:bg-pink-50/40 dark:bg-background/30 dark:hover:border-pink-400/30 dark:hover:bg-pink-500/8",
      badge: "bg-pink-100 text-pink-700 dark:bg-pink-500/18 dark:text-pink-200",
    },
    rose: {
      selected:
        "border-rose-300 bg-rose-50/80 shadow-sm dark:border-rose-400/45 dark:bg-[linear-gradient(135deg,#492c34,#282124)] dark:shadow-[0_0_0_1px_rgba(244,63,94,0.06)]",
      idle: "border-border/60 bg-background/70 hover:border-rose-200 hover:bg-rose-50/40 dark:bg-background/30 dark:hover:border-rose-400/30 dark:hover:bg-rose-500/8",
      badge: "bg-rose-100 text-rose-700 dark:bg-rose-500/18 dark:text-rose-200",
    },
    red: {
      selected:
        "border-red-300 bg-red-50/80 shadow-sm dark:border-red-400/45 dark:bg-[linear-gradient(135deg,#492c2c,#282121)] dark:shadow-[0_0_0_1px_rgba(239,68,68,0.06)]",
      idle: "border-border/60 bg-background/70 hover:border-red-200 hover:bg-red-50/40 dark:bg-background/30 dark:hover:border-red-400/30 dark:hover:bg-red-500/8",
      badge: "bg-red-100 text-red-700 dark:bg-red-500/18 dark:text-red-200",
    },
  } as const;
  const activeTone = toneClasses[tone];
  const hasDescription = Boolean(description);
  const hasMeta = Boolean(meta);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 text-left transition ${
        hasDescription || hasMeta ? "py-4" : "py-3.5"
      } ${selected ? `${activeTone.selected} dark:text-white` : activeTone.idle}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{title}</div>
          {hasDescription ? (
            <div
              className={`mt-1 text-xs leading-5 ${
                selected
                  ? "text-muted-foreground dark:text-white/82"
                  : "text-muted-foreground"
              }`}
            >
              {description}
            </div>
          ) : null}
        </div>
        <div
          className={`inline-flex min-w-[52px] items-center justify-center whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-medium ${
            status === "已接入"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200"
              : selected
                ? activeTone.badge
                : "bg-muted text-muted-foreground dark:bg-white/8 dark:text-white/70"
          }`}
        >
          {status}
        </div>
      </div>
      {hasMeta ? (
        <div
          className={`mt-3 text-xs ${
            selected
              ? "text-muted-foreground dark:text-white/78"
              : "text-muted-foreground"
          }`}
        >
          {meta}
        </div>
      ) : null}
    </button>
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function BusinessQuickAccess({
  appId,
  providers,
  externalRefreshToken,
}: {
  appId: AppId;
  providers?: Record<string, Provider>;
  externalRefreshToken?: number;
}) {
  const isClaude = appId === "claude";
  const isCodex = appId === "codex";
  const isGemini = appId === "gemini";
  const isOpenClaw = appId === "openclaw";
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [actionResult, setActionResult] =
    useState<InstallerActionResult | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [claudeStatus, setClaudeStatus] =
    useState<ClaudeInstallerStatus | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexInstallerStatus | null>(
    null,
  );
  const [geminiStatus, setGeminiStatus] =
    useState<GeminiInstallerStatus | null>(null);
  const [claudeProvidersSnapshot, setClaudeProvidersSnapshot] =
    useState<ProvidersQueryData | null>(null);
  const [codexProvidersSnapshot, setCodexProvidersSnapshot] =
    useState<ProvidersQueryData | null>(null);
  const [geminiProvidersSnapshot, setGeminiProvidersSnapshot] =
    useState<ProvidersQueryData | null>(null);
  const [openclawProvidersSnapshot, setOpenclawProvidersSnapshot] =
    useState<ProvidersQueryData | null>(null);
  const [claudeEntryOption, setClaudeEntryOption] =
    useState<ClaudeEntryOption>("tu-zi");
  const [codexEntryOption, setCodexEntryOption] =
    useState<CodexEntryOption>("tuzi");
  const [geminiEntryOption, setGeminiEntryOption] =
    useState<GeminiEntryOption>("tuzi");
  const [claudeSelectionTouched, setClaudeSelectionTouched] = useState(false);
  const [codexSelectionTouched, setCodexSelectionTouched] = useState(false);
  const [geminiSelectionTouched, setGeminiSelectionTouched] = useState(false);
  const [claudeGacKey, setClaudeGacKey] = useState("");
  const [claudeTuziKey, setClaudeTuziKey] = useState("");
  const [codexApiKey, setCodexApiKey] = useState("");
  const [codexModel, setCodexModel] = useState("gpt-5.4");
  const [codexReasoning, setCodexReasoning] = useState("medium");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-pro");
  const [openclawRoute, setOpenclawRoute] =
    useState<OpenClawRoute>("tuzi-claude");
  const [openclawApiKey, setOpenclawApiKey] = useState("");
  const externalRefreshTokenRef = useRef(externalRefreshToken);

  const { data: claudeProvidersData } = useProvidersQuery("claude");
  const { data: codexProvidersData } = useProvidersQuery("codex");
  const { data: geminiProvidersData } = useProvidersQuery("gemini");

  const { data: openclawDefaultModel } = useOpenClawDefaultModel(isOpenClaw);
  const { data: openclawAgentsDefaults } = useOpenClawAgentsDefaults();
  const { data: openclawTools } = useOpenClawTools();
  const { data: openclawLiveProviderIds = [] } =
    useOpenClawLiveProviderIds(isOpenClaw);
  const { data: openclawHealthWarnings = [] } = useOpenClawHealth(isOpenClaw);
  const { data: openclawProvidersData } = useProvidersQuery("openclaw");

  const claudeProvidersView = claudeProvidersSnapshot ?? claudeProvidersData;
  const codexProvidersView = codexProvidersSnapshot ?? codexProvidersData;
  const geminiProvidersView = geminiProvidersSnapshot ?? geminiProvidersData;
  const openclawProvidersView =
    openclawProvidersSnapshot ?? openclawProvidersData;

  const claudeCurrentProviderId = claudeProvidersView?.currentProviderId || "";
  const claudeCurrentProvider =
    claudeProvidersView?.providers?.[claudeCurrentProviderId];
  const codexCurrentProviderId = codexProvidersView?.currentProviderId || "";
  const codexCurrentProvider =
    codexProvidersView?.providers?.[codexCurrentProviderId];
  const geminiCurrentProviderId = geminiProvidersView?.currentProviderId || "";
  const geminiCurrentProvider =
    geminiProvidersView?.providers?.[geminiCurrentProviderId];
  const openclawProviderMap = openclawProvidersView?.providers || {};
  const claudeStatusView = claudeStatus ?? EMPTY_CLAUDE_STATUS;
  const codexStatusView = codexStatus ?? EMPTY_CODEX_STATUS;
  const geminiStatusView = geminiStatus ?? EMPTY_GEMINI_STATUS;
  const statusErrorHint = useMemo(() => {
    if (isClaude || isCodex || isGemini) {
      return "状态读取失败不会影响下方路线管理，你仍可继续输入 Key 并立即配置。";
    }
    if (isOpenClaw) {
      return "状态读取失败不会影响当前页面，你仍可继续调整 OpenClaw 路线配置。";
    }
    return "";
  }, [isClaude, isCodex, isGemini, isOpenClaw]);

  const getStatusReadErrorMessage = (error: unknown) => {
    const detail = extractErrorMessage(error);
    if (detail) return detail;
    if (isClaude) return "Claude 状态读取失败，请稍后重试。";
    if (isCodex) return "Codex 状态读取失败，请稍后重试。";
    if (isGemini) return "Gemini 状态读取失败，请稍后重试。";
    if (isOpenClaw) return "OpenClaw 状态读取失败，请稍后重试。";
    return "状态读取失败，请稍后重试。";
  };

  useEffect(() => {
    if (loading || isRefreshing || runningAction) return;
    setClaudeProvidersSnapshot(claudeProvidersData ?? null);
  }, [claudeProvidersData, loading, isRefreshing, runningAction]);

  useEffect(() => {
    if (loading || isRefreshing || runningAction) return;
    setCodexProvidersSnapshot(codexProvidersData ?? null);
  }, [codexProvidersData, loading, isRefreshing, runningAction]);

  useEffect(() => {
    if (loading || isRefreshing || runningAction) return;
    setGeminiProvidersSnapshot(geminiProvidersData ?? null);
  }, [geminiProvidersData, loading, isRefreshing, runningAction]);

  useEffect(() => {
    if (loading || isRefreshing || runningAction) return;
    setOpenclawProvidersSnapshot(openclawProvidersData ?? null);
  }, [openclawProvidersData, loading, isRefreshing, runningAction]);

  const loadStatus = async ({ showRefreshState = false } = {}) => {
    if (showRefreshState) {
      setIsRefreshing(true);
    }
    setPageError(null);
    try {
      if (isClaude) {
        const [nextStatus, nextProviders] = await Promise.all([
          withTimeout(
            installerApi.getClaudeStatus(),
            5000,
            "Claude 状态读取超时，请点击“刷新状态”重试。",
          ),
          queryClient.fetchQuery({
            queryKey: providersQueryKey("claude"),
            queryFn: async () => fetchProvidersQueryData("claude"),
            staleTime: 0,
          }),
        ]);
        setClaudeStatus(nextStatus);
        setClaudeProvidersSnapshot(nextProviders);
      } else if (isCodex) {
        const [nextStatus, nextProviders] = await Promise.all([
          withTimeout(
            installerApi.getCodexStatus(),
            5000,
            "Codex 状态读取超时，请点击“刷新状态”重试。",
          ),
          queryClient.fetchQuery({
            queryKey: providersQueryKey("codex"),
            queryFn: async () => fetchProvidersQueryData("codex"),
            staleTime: 0,
          }),
        ]);
        setCodexStatus(nextStatus);
        setCodexProvidersSnapshot(nextProviders);
      } else if (isGemini) {
        const [nextStatus, nextProviders] = await Promise.all([
          withTimeout(
            installerApi.getGeminiStatus(),
            5000,
            "Gemini 状态读取超时，请点击“刷新状态”重试。",
          ),
          queryClient.fetchQuery({
            queryKey: providersQueryKey("gemini"),
            queryFn: async () => fetchProvidersQueryData("gemini"),
            staleTime: 0,
          }),
        ]);
        setGeminiStatus(nextStatus);
        setGeminiProvidersSnapshot(nextProviders);
      } else if (isOpenClaw) {
        const nextProviders = await queryClient.fetchQuery({
          queryKey: providersQueryKey("openclaw"),
          queryFn: async () => fetchProvidersQueryData("openclaw"),
          staleTime: 0,
        });
        setOpenclawProvidersSnapshot(nextProviders);
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: openclawKeys.liveProviderIds,
          }),
          queryClient.invalidateQueries({
            queryKey: openclawKeys.defaultModel,
          }),
          queryClient.invalidateQueries({
            queryKey: openclawKeys.agentsDefaults,
          }),
          queryClient.invalidateQueries({ queryKey: openclawKeys.tools }),
          queryClient.invalidateQueries({ queryKey: openclawKeys.health }),
        ]);
      }
      setLastRefreshedAt(Date.now());
    } catch (error) {
      setPageError(getStatusReadErrorMessage(error));
    } finally {
      if (showRefreshState) {
        setIsRefreshing(false);
      }
    }
  };

  useEffect(() => {
    void (async () => {
      if (!isClaude && !isCodex && !isGemini && !isOpenClaw) return;
      setLoading(true);
      await loadStatus();
      setLoading(false);
    })();
  }, [appId]);

  useEffect(() => {
    if (externalRefreshTokenRef.current === externalRefreshToken) {
      return;
    }
    externalRefreshTokenRef.current = externalRefreshToken;
    void loadStatus();
  }, [appId, externalRefreshToken]);

  const runAction = async (
    id: string,
    action: () => Promise<InstallerActionResult>,
  ) => {
    setRunningAction(id);
    setPageError(null);
    setActionResult(null);
    try {
      const result = await action();
      setActionResult(result);
      await loadStatus();
      if (!result.success) {
        setPageError(result.error || result.message);
      }
    } catch (error) {
      setPageError(getStatusReadErrorMessage(error));
    } finally {
      setRunningAction(null);
    }
  };

  const title = useMemo(() => {
    if (isClaude) return "Claude 兔子快速接入";
    if (isCodex) return "Codex 兔子快速接入";
    if (isGemini) return "Gemini 兔子快速接入";
    if (isOpenClaw) return "OpenClaw 兔子快速接入";
    return "";
  }, [isClaude, isCodex, isOpenClaw]);

  const cardClassName = useMemo(() => {
    if (isCodex) {
      return "overflow-hidden border-sky-200/70 bg-gradient-to-br from-sky-50 via-background to-blue-50 shadow-sm dark:border-sky-500/20 dark:from-sky-500/10 dark:to-blue-500/10";
    }
    if (isGemini) {
      return "overflow-hidden border-pink-200/70 bg-gradient-to-br from-pink-50 via-background to-rose-50 shadow-sm dark:border-pink-500/20 dark:from-pink-500/10 dark:to-rose-500/10";
    }
    if (isOpenClaw) {
      return "overflow-hidden border-rose-200/70 bg-gradient-to-br from-rose-50 via-background to-red-50 shadow-sm dark:border-rose-500/20 dark:from-rose-500/10 dark:to-red-500/10";
    }
    return "overflow-hidden border-orange-200/70 bg-gradient-to-br from-orange-50 via-background to-amber-50 shadow-sm dark:border-orange-500/20 dark:from-orange-500/10 dark:to-amber-500/10";
  }, [isCodex, isGemini, isOpenClaw]);

  const heroIconClassName = useMemo(() => {
    if (isClaude) {
      return "bg-white/80 p-3 ring-1 ring-orange-100/90 shadow-sm dark:bg-white/8 dark:ring-orange-400/20";
    }
    if (isGemini) {
      return "bg-white/80 p-3 ring-1 ring-pink-100/90 shadow-sm dark:bg-white/8 dark:ring-pink-400/20";
    }
    if (isCodex) {
      return "bg-white/80 p-3 ring-1 ring-sky-100/90 shadow-sm dark:bg-white/8 dark:ring-sky-400/20";
    }
    if (isOpenClaw) {
      return "h-12 w-12 bg-white/70 shadow-sm ring-1 ring-red-100/80 dark:bg-white/8 dark:ring-red-400/20";
    }
    return "bg-white/80 p-3 dark:bg-white/8";
  }, [isClaude, isCodex, isGemini, isOpenClaw]);

  const openclawStatus = useMemo(() => {
    const configuredRoutes = (
      Object.entries(OPENCLAW_ROUTE_CONFIG) as Array<
        [OpenClawRoute, (typeof OPENCLAW_ROUTE_CONFIG)[OpenClawRoute]]
      >
    )
      .filter(([, config]) =>
        hasBusinessRouteProviderInList(
          openclawLiveProviderIds,
          config.providerId,
        ),
      )
      .map(([route]) => route);

    const inferredRoute = getOpenClawCurrentRoute(
      openclawDefaultModel?.primary,
      configuredRoutes,
    );
    const primaryModel = openclawDefaultModel?.primary || "--";

    return {
      configuredRoutes,
      inferredRoute,
      primaryModel,
      toolsProfile: openclawTools?.profile || "--",
      warningCount: openclawHealthWarnings.length,
    };
  }, [
    openclawDefaultModel?.primary,
    openclawHealthWarnings.length,
    openclawLiveProviderIds,
    openclawTools?.profile,
  ]);
  const selectedOpenClawConfig = OPENCLAW_ROUTE_CONFIG[openclawRoute];
  const claudeProviderRoute = useMemo(
    () =>
      getClaudeRouteFromProvider(
        claudeCurrentProviderId,
        claudeCurrentProvider,
      ),
    [claudeCurrentProvider, claudeCurrentProviderId],
  );
  const codexProviderRoute = useMemo(
    () =>
      getCodexRouteFromProvider(codexCurrentProviderId, codexCurrentProvider),
    [codexCurrentProvider, codexCurrentProviderId],
  );
  const geminiProviderRoute = useMemo(
    () =>
      getGeminiRouteFromProvider(
        geminiCurrentProviderId,
        geminiCurrentProvider,
      ),
    [geminiCurrentProvider, geminiCurrentProviderId],
  );
  const installerClaudeRoute = getClaudeInstallerRoute(claudeStatusView);
  const installerCodexRoute = getCodexInstallerRoute(codexStatusView);
  const installerGeminiRoute = getGeminiInstallerRoute(geminiStatusView);
  const claudeUsingModifiedVariant =
    claudeStatusView.resolved_variant === "modified";
  const codexUsingModifiedVariant = codexStatusView.resolved_variant === "gac";
  const geminiUsingModifiedVariant =
    geminiStatusView.resolved_variant === "gac";
  const activeClaudeRoute = useMemo<
    ClaudeEntryOption | "modified" | "custom" | null
  >(() => {
    return resolveDisplayedBusinessRoute({
      providerRoute: claudeProviderRoute,
      installerRoute: installerClaudeRoute,
      usingModifiedVariant: claudeUsingModifiedVariant,
      modifiedRoute: "modified",
      hasCurrentProvider: Boolean(
        claudeCurrentProviderId || claudeCurrentProvider,
      ),
    });
  }, [
    claudeCurrentProvider,
    claudeCurrentProviderId,
    claudeUsingModifiedVariant,
    claudeProviderRoute,
    installerClaudeRoute,
  ]);

  const activeCodexRoute = useMemo<
    CodexEntryOption | "gac-modified" | "custom" | null
  >(() => {
    return resolveDisplayedBusinessRoute({
      providerRoute: codexProviderRoute,
      installerRoute: installerCodexRoute,
      usingModifiedVariant: codexUsingModifiedVariant,
      modifiedRoute: "gac-modified",
      hasCurrentProvider: Boolean(
        codexCurrentProviderId || codexCurrentProvider,
      ),
    });
  }, [
    codexCurrentProvider,
    codexCurrentProviderId,
    codexUsingModifiedVariant,
    codexProviderRoute,
    installerCodexRoute,
  ]);

  const activeGeminiRoute = useMemo<
    GeminiEntryOption | "gac-modified" | "custom" | null
  >(() => {
    return resolveDisplayedBusinessRoute({
      providerRoute: geminiProviderRoute,
      installerRoute: installerGeminiRoute,
      usingModifiedVariant: geminiUsingModifiedVariant,
      modifiedRoute: "gac-modified",
      hasCurrentProvider: Boolean(
        geminiCurrentProviderId || geminiCurrentProvider,
      ),
    });
  }, [
    geminiCurrentProvider,
    geminiCurrentProviderId,
    geminiUsingModifiedVariant,
    geminiProviderRoute,
    installerGeminiRoute,
  ]);

  const claudeSelectedRoute = claudeSelectionTouched
    ? claudeEntryOption
    : activeClaudeRoute === "custom"
      ? null
      : activeClaudeRoute;
  const codexSelectedRoute = codexSelectionTouched
    ? codexEntryOption
    : activeCodexRoute === "custom"
      ? null
      : activeCodexRoute;
  const geminiSelectedRoute = geminiSelectionTouched
    ? geminiEntryOption
    : activeGeminiRoute === "custom"
      ? null
      : activeGeminiRoute;
  const claudePanelRoute = claudeSelectedRoute ?? claudeEntryOption;
  const codexPanelRoute = codexSelectedRoute ?? codexEntryOption;
  const geminiPanelRoute = geminiSelectedRoute ?? geminiEntryOption;
  const hasClaudeTuziRoute = hasNamedRoute(claudeStatusView.routes, "tu-zi");
  const hasClaudeGacRoute = hasNamedRoute(claudeStatusView.routes, "gaccode");
  const hasCodexTuziRoute = hasNamedRoute(codexStatusView.routes, "tuzi");
  const hasCodexCodingRoute = hasNamedRoute(codexStatusView.routes, "codex");
  const hasCodexGacRoute = hasNamedRoute(codexStatusView.routes, "gac");
  const hasGeminiTuziRoute = hasNamedRoute(geminiStatusView.routes, "tuzi");
  const claudeSourceConflict = Boolean(claudeStatusView.sources_conflict);
  const claudeRouteMismatch = Boolean(
    claudeProviderRoute &&
      activeClaudeRoute &&
      claudeProviderRoute !== activeClaudeRoute,
  );
  const codexRouteMismatch = Boolean(
    codexProviderRoute &&
      activeCodexRoute &&
      codexProviderRoute !== activeCodexRoute,
  );
  const geminiRouteMismatch = Boolean(
    geminiProviderRoute &&
      activeGeminiRoute &&
      geminiProviderRoute !== activeGeminiRoute,
  );
  const claudeVariantConflict = Boolean(claudeStatusView.variant_conflict);
  const claudeRuntimeEnvConflict = Boolean(
    claudeStatusView.runtime_env_conflict,
  );
  const codexVariantConflict = Boolean(codexStatusView.variant_conflict);
  const geminiVariantConflict = Boolean(geminiStatusView.variant_conflict);
  const claudeVersionLabel = getInstalledVersionLabel(
    claudeStatusView.installed,
    claudeStatusView.version,
    claudeStatusView.latest_version,
  );
  const codexVersionLabel = getInstalledVersionLabel(
    codexStatusView.installed,
    codexStatusView.version,
    codexStatusView.latest_version,
  );
  const geminiVersionLabel = getInstalledVersionLabel(
    geminiStatusView.installed,
    geminiStatusView.version,
    geminiStatusView.latest_version,
  );
  const claudeVersionCheckState = getVersionCheckState(
    claudeStatusView.installed,
    claudeStatusView.version,
    claudeStatusView.latest_version,
  );
  const codexVersionCheckState = getVersionCheckState(
    codexStatusView.installed,
    codexStatusView.version,
    codexStatusView.latest_version,
  );
  const geminiVersionCheckState = getVersionCheckState(
    geminiStatusView.installed,
    geminiStatusView.version,
    geminiStatusView.latest_version,
  );
  const claudeCliVariantLabel = getCliVariantLabel(
    claudeStatusView.installed,
    claudeStatusView.resolved_variant,
    ["original"],
    ["modified"],
  );
  const codexCliVariantLabel = getCliVariantLabel(
    codexStatusView.installed,
    codexStatusView.resolved_variant,
    ["openai"],
    ["gac"],
  );
  const geminiCliVariantLabel = getCliVariantLabel(
    geminiStatusView.installed,
    geminiStatusView.resolved_variant,
    ["official"],
    ["gac"],
  );
  const claudeCurrentRouteLabel =
    !claudeUsingModifiedVariant &&
    claudeCurrentProvider?.name &&
    claudeProviderRoute &&
    activeClaudeRoute &&
    claudeProviderRoute === activeClaudeRoute
      ? claudeCurrentProvider.name
      : getClaudeRouteLabel(activeClaudeRoute);
  const codexCurrentRouteLabel =
    !codexUsingModifiedVariant &&
    codexCurrentProvider?.name &&
    codexProviderRoute &&
    activeCodexRoute &&
    codexProviderRoute === activeCodexRoute
      ? codexCurrentProvider.name
      : getCodexRouteLabel(activeCodexRoute);
  const geminiCurrentRouteLabel =
    !geminiUsingModifiedVariant &&
    geminiCurrentProvider?.name &&
    geminiProviderRoute &&
    activeGeminiRoute &&
    geminiProviderRoute === activeGeminiRoute
      ? geminiCurrentProvider.name
      : getGeminiRouteLabel(activeGeminiRoute);
  const claudeCurrentBaseUrl =
    !claudeUsingModifiedVariant && !claudeRouteMismatch
      ? getProviderBaseUrl(claudeCurrentProvider) ||
        getClaudeStatusBaseUrl(claudeStatusView)
      : getClaudeStatusBaseUrl(claudeStatusView);
  const codexCurrentBaseUrl =
    !codexUsingModifiedVariant && !codexRouteMismatch
      ? getProviderBaseUrl(codexCurrentProvider) ||
        getCodexStatusBaseUrl(activeCodexRoute, codexStatusView)
      : getCodexStatusBaseUrl(activeCodexRoute, codexStatusView);
  const geminiCurrentBaseUrl =
    !geminiUsingModifiedVariant && !geminiRouteMismatch
      ? getProviderBaseUrl(geminiCurrentProvider) ||
        getGeminiStatusBaseUrl(activeGeminiRoute, geminiStatusView)
      : getGeminiStatusBaseUrl(activeGeminiRoute, geminiStatusView);

  useEffect(() => {
    if (!isCodex || !codexStatus) return;

    const currentRouteName =
      activeCodexRoute === "tuzi"
        ? "tuzi"
        : activeCodexRoute === "tuzi-coding"
          ? "codex"
          : activeCodexRoute === "gac"
            ? "gac"
            : !codexUsingModifiedVariant
              ? codexStatus.current_route
              : null;

    if (!currentRouteName) return;

    const currentRoute = codexStatus.routes.find(
      (route) => route.name === currentRouteName,
    );
    const model = currentRoute?.model_settings?.model?.trim();
    const reasoning =
      currentRoute?.model_settings?.model_reasoning_effort?.trim();

    if (model) {
      setCodexModel(model);
    }
    if (reasoning) {
      setCodexReasoning(reasoning);
    }
  }, [activeCodexRoute, codexStatus, isCodex]);

  const configureOpenClawRoute = async (
    route: OpenClawRoute,
    apiKey: string,
  ): Promise<InstallerActionResult> => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      return {
        success: false,
        message: `请先输入${OPENCLAW_ROUTE_CONFIG[route].apiKeyLabel}`,
        error: "MISSING_OPENCLAW_ROUTE_API_KEY",
        stdout: "",
        stderr: "",
        restart_required: false,
      };
    }

    const routeConfig = OPENCLAW_ROUTE_CONFIG[route];
    const providerMap = {
      ...openclawProviderMap,
      ...(providers || {}),
    };
    const target = resolveBusinessRouteProviderTarget(
      providerMap,
      routeConfig.providerId,
      trimmedKey,
      "openclaw",
    );
    const providerName = buildBusinessRouteProviderName(
      routeConfig.providerName,
      target.altIndex,
    );
    const providerNotes = buildBusinessRouteProviderNotes(
      `由兔子快速接入自动生成，适用于 ${routeConfig.label}`,
      target.altIndex,
    );
    const provider: Provider = {
      ...target.existingProvider,
      id: target.targetProviderId,
      name: providerName,
      category: "custom",
      icon: "tuzi",
      notes: providerNotes,
      createdAt: target.existingProvider?.createdAt ?? Date.now(),
      meta: {
        ...(target.existingProvider?.meta || {}),
        businessLine: route.startsWith("gac-") ? "gac" : "tuzi",
      },
      settingsConfig: {
        baseUrl: routeConfig.baseUrl,
        apiKey: trimmedKey,
        api: routeConfig.api,
        models: routeConfig.models,
      },
    };

    if (target.isNew) {
      await providersApi.add(provider, "openclaw", true);
    } else {
      await providersApi.update(provider, "openclaw", target.targetProviderId);
    }
    await providersApi.switch(target.targetProviderId, "openclaw");

    const modelRefs = routeConfig.models.map(
      (model) => `${target.targetProviderId}/${model.id}`,
    );
    const currentModelCatalog = openclawAgentsDefaults?.models || {};
    const preservedModelCatalog = Object.fromEntries(
      Object.entries(currentModelCatalog).filter(
        ([key]) => !key.startsWith(`${target.targetProviderId}/`),
      ),
    );
    const nextModelCatalog = {
      ...preservedModelCatalog,
      ...Object.fromEntries(
        routeConfig.models.map((model) => [
          `${target.targetProviderId}/${model.id}`,
          { alias: model.name },
        ]),
      ),
    };

    await openclawApi.setAgentsDefaults({
      ...(openclawAgentsDefaults || {}),
      model: {
        primary: modelRefs[0],
        fallbacks: modelRefs.slice(1),
      },
      models: nextModelCatalog,
    });

    await openclawApi.setTools({
      ...(openclawTools || {}),
      profile: "coding",
    });

    await loadStatus();
    setOpenclawApiKey("");

    return {
      success: true,
      message: `已为 OpenClaw 写入${routeConfig.label}，现在可以直接使用对应业务线路了。`,
      stdout: [
        `Provider: ${target.targetProviderId}`,
        `Base URL: ${routeConfig.baseUrl}`,
        `Primary Model: ${modelRefs[0]}`,
        `Tools Profile: coding`,
      ].join("\n"),
      stderr: "",
      error: "",
      restart_required: false,
    };
  };

  const syncClaudeBusinessProvider = async (
    route: ClaudeBusinessRoute,
    apiKey: string,
  ) => {
    const routeConfig = CLAUDE_ROUTE_CONFIG[route];
    const providerMap = {
      ...(claudeProvidersView?.providers || {}),
      ...(providers || {}),
    };
    const target = resolveBusinessRouteProviderTarget(
      providerMap,
      routeConfig.providerId,
      apiKey,
      "claude",
    );
    const providerName = buildBusinessRouteProviderName(
      routeConfig.providerName,
      target.altIndex,
    );
    const providerNotes = buildBusinessRouteProviderNotes(
      "由兔子业务一键接入自动生成",
      target.altIndex,
    );
    const nextEnv = {
      ...(target.existingProvider?.settingsConfig?.env || {}),
      ANTHROPIC_BASE_URL: routeConfig.baseUrl,
      ANTHROPIC_API_KEY: apiKey,
    } as Record<string, unknown>;
    delete nextEnv.ANTHROPIC_AUTH_TOKEN;
    delete nextEnv.ANTHROPIC_API_TOKEN;

    const provider: Provider = {
      ...target.existingProvider,
      id: target.targetProviderId,
      name: providerName,
      websiteUrl: routeConfig.websiteUrl,
      category: "custom",
      icon: "tuzi",
      iconColor: "#F97316",
      notes: providerNotes,
      createdAt: target.existingProvider?.createdAt ?? Date.now(),
      meta: {
        ...(target.existingProvider?.meta || {}),
        businessLine: route === "gaccode" ? "gac" : "tuzi",
      },
      settingsConfig: {
        ...(target.existingProvider?.settingsConfig || {}),
        env: nextEnv,
      },
    };

    if (target.isNew) {
      await providersApi.add(provider, "claude");
    } else {
      await providersApi.update(provider, "claude", target.targetProviderId);
    }

    await providersApi.switch(target.targetProviderId, "claude", {
      skipBackfill: true,
    });
    await queryClient.invalidateQueries({ queryKey: ["providers", "claude"] });
  };

  const installClaudeBusinessRoute = async (
    scheme: "B" | "C",
    apiKey: string,
  ): Promise<InstallerActionResult> => {
    const trimmedKey = apiKey.trim();
    const result = await installerApi.installClaudeCode(scheme, trimmedKey);
    if (!result.success) {
      return result;
    }

    await syncClaudeBusinessProvider(
      scheme === "B" ? "gaccode" : "tu-zi",
      trimmedKey,
    );
    if (scheme === "B") {
      setClaudeGacKey("");
    } else {
      setClaudeTuziKey("");
    }
    return result;
  };

  const syncCodexBusinessProvider = async (
    route: CodexBusinessRoute,
    apiKey: string,
    model: string,
    reasoningEffort: string,
  ) => {
    const routeConfig = CODEX_ROUTE_CONFIG[route];
    const providerMap = {
      ...(codexProvidersView?.providers || {}),
      ...(providers || {}),
    };
    const target = resolveBusinessRouteProviderTarget(
      providerMap,
      routeConfig.providerId,
      apiKey,
      "codex",
    );
    const providerName = buildBusinessRouteProviderName(
      routeConfig.providerName,
      target.altIndex,
    );
    const baseNotes =
      route === "gac"
        ? "由 gac 业务一键接入自动生成"
        : route === "tuzi"
          ? "由兔子业务一键接入自动生成（兔子线路）"
          : "由兔子业务一键接入自动生成（粉色订阅）";
    const provider: Provider = {
      ...target.existingProvider,
      id: target.targetProviderId,
      name: providerName,
      websiteUrl: routeConfig.websiteUrl,
      category: "custom",
      icon: "tuzi",
      iconColor: route === "gac" ? "#F97316" : "#0EA5E9",
      notes: buildBusinessRouteProviderNotes(baseNotes, target.altIndex),
      createdAt: target.existingProvider?.createdAt ?? Date.now(),
      meta: {
        ...(target.existingProvider?.meta || {}),
        businessLine: routeConfig.businessLine,
      },
      settingsConfig: {
        auth: generateThirdPartyAuth(apiKey),
        config: buildCodexBusinessConfig(
          route,
          routeConfig.baseUrl,
          model,
          reasoningEffort,
        ),
      },
    };

    if (target.isNew) {
      await providersApi.add(provider, "codex");
    } else {
      await providersApi.update(provider, "codex", target.targetProviderId);
    }

    await providersApi.switch(target.targetProviderId, "codex", {
      skipBackfill: true,
    });
    await queryClient.invalidateQueries({ queryKey: ["providers", "codex"] });
  };

  const installCodexBusinessRoute =
    async (): Promise<InstallerActionResult> => {
      if (codexPanelRoute === "gac-modified") {
        return await installerApi.installCodex({ variant: "gac" });
      }

      const trimmedKey = codexApiKey.trim();
      const trimmedModel = codexModel.trim() || "gpt-5.4";
      const trimmedReasoning = codexReasoning.trim() || "medium";
      const selectedRoute: CodexBusinessRoute =
        codexPanelRoute === "gac"
          ? "gac"
          : codexPanelRoute === "tuzi-coding"
            ? "codex"
            : "tuzi";
      const result = await installerApi.installCodex({
        variant: "openai",
        route: selectedRoute,
        apiKey: trimmedKey,
        model: trimmedModel,
        modelReasoningEffort: trimmedReasoning,
      });

      if (!result.success) {
        return result;
      }

      await syncCodexBusinessProvider(
        selectedRoute,
        trimmedKey,
        trimmedModel,
        trimmedReasoning,
      );
      setCodexApiKey("");
      return result;
    };

  const syncGeminiBusinessProvider = async (
    route: GeminiBusinessRoute,
    apiKey: string,
    model: string,
  ) => {
    const routeConfig = GEMINI_ROUTE_CONFIG[route];
    const providerMap = {
      ...(geminiProvidersView?.providers || {}),
      ...(providers || {}),
    };
    const target = resolveBusinessRouteProviderTarget(
      providerMap,
      routeConfig.providerId,
      apiKey,
      "gemini",
    );
    const providerName = buildBusinessRouteProviderName(
      routeConfig.providerName,
      target.altIndex,
    );
    const provider: Provider = {
      ...target.existingProvider,
      id: target.targetProviderId,
      name: providerName,
      websiteUrl: routeConfig.websiteUrl,
      category: "custom",
      icon: "gemini",
      iconColor: "#DB2777",
      notes: buildBusinessRouteProviderNotes(
        "由兔子业务一键接入自动生成",
        target.altIndex,
      ),
      createdAt: target.existingProvider?.createdAt ?? Date.now(),
      meta: {
        ...(target.existingProvider?.meta || {}),
        businessLine: routeConfig.businessLine,
      },
      settingsConfig: {
        env: {
          GOOGLE_GEMINI_BASE_URL: routeConfig.baseUrl,
          GEMINI_API_KEY: apiKey,
          GEMINI_MODEL: model,
        },
        config: {},
      },
    };

    if (target.isNew) {
      await providersApi.add(provider, "gemini");
    } else {
      await providersApi.update(provider, "gemini", target.targetProviderId);
    }

    await providersApi.switch(target.targetProviderId, "gemini", {
      skipBackfill: true,
    });
    await queryClient.invalidateQueries({ queryKey: ["providers", "gemini"] });
  };

  const installGeminiBusinessRoute =
    async (): Promise<InstallerActionResult> => {
      if (geminiPanelRoute === "gac-modified") {
        return await installerApi.installGemini({ variant: "gac" });
      }

      const trimmedKey = geminiApiKey.trim();
      const trimmedModel = geminiModel.trim() || "gemini-2.5-pro";
      const selectedRoute: GeminiBusinessRoute = "tuzi";
      const result = await installerApi.installGemini({
        variant: "official",
        route: selectedRoute,
        apiKey: trimmedKey,
        model: trimmedModel,
      });

      if (!result.success) {
        return result;
      }

      await syncGeminiBusinessProvider(selectedRoute, trimmedKey, trimmedModel);
      setGeminiApiKey("");
      return result;
    };

  const switchClaudeModifiedUsage =
    async (): Promise<InstallerActionResult> => {
      const targetVariant = claudeUsingModifiedVariant
        ? "original"
        : "modified";
      const result = await installerApi.switchClaudeVariant(targetVariant);
      setClaudeSelectionTouched(false);
      return result;
    };

  const switchCodexModifiedUsage = async (): Promise<InstallerActionResult> => {
    const targetVariant = codexUsingModifiedVariant ? "openai" : "gac";
    const result = await installerApi.switchCodexVariant(targetVariant);
    setCodexSelectionTouched(false);
    return result;
  };

  const switchGeminiModifiedUsage =
    async (): Promise<InstallerActionResult> => {
      const targetVariant = geminiUsingModifiedVariant ? "official" : "gac";
      const result = await installerApi.switchGeminiVariant(targetVariant);
      setGeminiSelectionTouched(false);
      return result;
    };

  if (!isClaude && !isCodex && !isGemini && !isOpenClaw) return null;

  return (
    <Card className={cardClassName}>
      <CardContent className="space-y-5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex items-center justify-center rounded-2xl dark:bg-black/10 ${heroIconClassName}`}
            >
              {isClaude ? (
                <ClaudeIcon size={26} />
              ) : isCodex ? (
                <CodexIcon size={26} />
              ) : isGemini ? (
                <GeminiIcon size={26} />
              ) : (
                <OpenClawIcon size={26} />
              )}
            </div>
            <h3 className="text-xl font-semibold">{title}</h3>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadStatus({ showRefreshState: true })}
            disabled={!!runningAction || isRefreshing}
            className="self-start"
          >
            {isRefreshing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                刷新中...
              </>
            ) : lastRefreshedAt ? (
              `刷新状态 · ${new Date(lastRefreshedAt).toLocaleTimeString(
                "zh-CN",
                {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                },
              )}`
            ) : (
              "刷新状态"
            )}
          </Button>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-6 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/4">
            正在读取当前配置状态...
            {isClaude || isCodex || isGemini
              ? " 你现在也可以直接使用下方路线管理继续配置。"
              : ""}
          </div>
        ) : null}

        {pageError ? (
          <div className="rounded-2xl border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            <div className="font-medium">{pageError}</div>
            {statusErrorHint ? (
              <div className="mt-1 text-red-700/90 dark:text-red-200/90">
                {statusErrorHint}
              </div>
            ) : null}
          </div>
        ) : null}

        {actionResult ? (
          <div
            className={`rounded-2xl border px-4 py-4 text-sm ${
              actionResult.success
                ? "border-emerald-300/60 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                : "border-red-300/60 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
            }`}
          >
            <div className="font-medium">{actionResult.message}</div>
            {(actionResult.stdout || actionResult.stderr) && (
              <pre className="mt-4 max-h-48 overflow-y-auto rounded-xl bg-black/85 p-4 text-xs text-zinc-100 whitespace-pre-wrap">
                {[actionResult.stdout, actionResult.stderr]
                  .filter((value) => value && value.trim().length > 0)
                  .join("\n\n")}
              </pre>
            )}
          </div>
        ) : null}

        {isClaude ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <Stat
                label="当前线路"
                value={claudeCurrentRouteLabel}
                compact
                valueTitle={claudeCurrentRouteLabel}
              />
              <Stat
                label="CLI 变体"
                value={claudeCliVariantLabel}
                compact
                valueTitle={claudeCliVariantLabel}
              />
              <Stat
                label="版本"
                value={claudeVersionLabel}
                compact
                action={
                  claudeStatusView.installed ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        void runAction("claude-upgrade", () =>
                          installerApi.upgradeClaudeCode(
                            claudeUsingModifiedVariant
                              ? "modified"
                              : "original",
                          ),
                        )
                      }
                      disabled={
                        !!runningAction ||
                        claudeVersionCheckState !== "upgrade"
                      }
                      title={getUpgradeButtonTitle(claudeVersionCheckState)}
                      className="h-7 gap-1.5 px-2 text-[11px]"
                    >
                      {runningAction === "claude-upgrade" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      {getUpgradeButtonLabel(claudeVersionCheckState)}
                    </Button>
                  ) : null
                }
              />
              <Stat
                label="Base URL"
                value={claudeCurrentBaseUrl}
                compact
                valueTitle={claudeCurrentBaseUrl}
                valueClassName="break-all whitespace-normal leading-5"
              />
            </div>
            {claudeVariantConflict ? (
              <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                检测到 Claude 当前业务线路记录与实际命中的 CLI
                变体不一致。顶部“CLI 变体”和“版本”已按真实命中的 Claude
                显示；重新执行目标线路配置后会自动纠正到对应变体。
              </div>
            ) : null}
            {claudeSourceConflict ? (
              <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                检测到 Claude
                本地配置来源不一致。这条提示仅用于诊断；顶部当前线路和 Base URL
                仍优先按当前 provider 与实际 CLI
                变体显示。如需收口到同一条线路，可重新执行一次配置或切换操作。
              </div>
            ) : null}
            {claudeRuntimeEnvConflict ? (
              <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                当前 app/终端会话仍继承旧 Claude
                环境；文件配置已切回原版，但需重新打开终端或重启应用后，运行时环境才会完全生效。
              </div>
            ) : null}
            {claudeRouteMismatch ? (
              <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                顶部状态已按 Claude 实际启用线路显示；当前 provider 仍停留在
                {` ${getClaudeRouteLabel(claudeProviderRoute)} `}
                ，两边暂时不一致。
              </div>
            ) : null}

            <div className="rounded-2xl border border-border/60 bg-background/80 p-4 dark:border-white/10 dark:bg-white/4">
              <div className="font-medium">Claude 路线管理</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <RouteCard
                  title="Claude · 兔子线路"
                  meta="Base URL: https://api.tu-zi.com"
                  status={
                    activeClaudeRoute === "tu-zi"
                      ? "已接入"
                      : hasClaudeTuziRoute
                        ? "已写入"
                        : claudeSelectedRoute === "tu-zi"
                          ? "当前选择"
                          : "推荐"
                  }
                  selected={claudeSelectedRoute === "tu-zi"}
                  onClick={() => {
                    setClaudeSelectionTouched(true);
                    setClaudeEntryOption("tu-zi");
                  }}
                />
                <RouteCard
                  title="Claude · gac 线路"
                  meta="Base URL: https://gaccode.com/claudecode"
                  status={
                    activeClaudeRoute === "gaccode"
                      ? "已接入"
                      : hasClaudeGacRoute
                        ? "已写入"
                        : claudeSelectedRoute === "gaccode"
                          ? "当前选择"
                          : "可选"
                  }
                  selected={claudeSelectedRoute === "gaccode"}
                  onClick={() => {
                    setClaudeSelectionTouched(true);
                    setClaudeEntryOption("gaccode");
                  }}
                />
                <RouteCard
                  title="gac 改版 Claude"
                  status={
                    activeClaudeRoute === "modified"
                      ? "已接入"
                      : claudeSelectedRoute === "modified"
                        ? "当前选择"
                        : "可选"
                  }
                  selected={claudeSelectedRoute === "modified"}
                  onClick={() => {
                    setClaudeSelectionTouched(true);
                    setClaudeEntryOption("modified");
                  }}
                />
              </div>
              {claudePanelRoute === "gaccode" ||
              claudePanelRoute === "tu-zi" ? (
                <div className="mt-4 grid gap-3">
                  {claudePanelRoute === "gaccode" ? (
                    <Input
                      type="password"
                      value={claudeGacKey}
                      onChange={(event) => setClaudeGacKey(event.target.value)}
                      placeholder="输入 gac API Key"
                    />
                  ) : (
                    <Input
                      type="password"
                      value={claudeTuziKey}
                      onChange={(event) => setClaudeTuziKey(event.target.value)}
                      placeholder="输入兔子 API Key"
                    />
                  )}
                </div>
              ) : null}
              {claudePanelRoute === "modified" ? (
                <Button
                  onClick={() =>
                    void runAction(
                      activeClaudeRoute === "modified"
                        ? "claude-switch-original"
                        : "claude-switch-modified",
                      switchClaudeModifiedUsage,
                    )
                  }
                  disabled={!!runningAction}
                  className="mt-4 gap-2"
                >
                  {runningAction === "claude-switch-original" ||
                  runningAction === "claude-switch-modified" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wrench className="h-4 w-4" />
                  )}
                  {claudeUsingModifiedVariant ? "退出使用改版" : "选择使用改版"}
                </Button>
              ) : (
                <Button
                  onClick={() =>
                    void runAction(
                      claudePanelRoute === "gaccode"
                        ? "claude-install-b"
                        : "claude-install-c",
                      () =>
                        claudePanelRoute === "gaccode"
                          ? installClaudeBusinessRoute("B", claudeGacKey)
                          : installClaudeBusinessRoute("C", claudeTuziKey),
                    )
                  }
                  disabled={!!runningAction}
                  className="mt-4 gap-2"
                >
                  {runningAction === "claude-install-b" ||
                  runningAction === "claude-install-c" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wrench className="h-4 w-4" />
                  )}
                  立即配置
                </Button>
              )}
            </div>
          </>
        ) : null}

        {isCodex ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <Stat
                label="当前线路"
                value={codexCurrentRouteLabel}
                compact
                valueTitle={codexCurrentRouteLabel}
              />
              <Stat
                label="CLI 变体"
                value={codexCliVariantLabel}
                compact
                valueTitle={codexCliVariantLabel}
              />
              <Stat
                label="版本"
                value={codexVersionLabel}
                compact
                action={
                  codexStatusView.installed ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        void runAction("codex-upgrade", () =>
                          installerApi.upgradeCodex(
                            codexUsingModifiedVariant ? "gac" : "openai",
                          ),
                        )
                      }
                      disabled={
                        !!runningAction ||
                        codexVersionCheckState !== "upgrade"
                      }
                      title={getUpgradeButtonTitle(codexVersionCheckState)}
                      className="h-7 gap-1.5 px-2 text-[11px]"
                    >
                      {runningAction === "codex-upgrade" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      {getUpgradeButtonLabel(codexVersionCheckState)}
                    </Button>
                  ) : null
                }
              />
              <Stat
                label="Base URL"
                value={codexCurrentBaseUrl}
                compact
                valueTitle={codexCurrentBaseUrl}
                valueClassName="break-all whitespace-normal leading-5"
              />
            </div>
            {codexVariantConflict ? (
              <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                检测到 Codex 当前业务线路记录与实际命中的 CLI
                变体不一致。顶部“CLI 变体”和“版本”已按真实命中的 Codex
                显示；重新执行目标线路配置后会自动纠正到对应变体。
              </div>
            ) : null}

            <div className="rounded-2xl border border-border/60 bg-background/80 p-4 dark:border-white/10 dark:bg-white/4">
              <div className="font-medium">Codex 路线管理</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <RouteCard
                  title="Codex · 兔子线路"
                  meta="Base URL: https://api.tu-zi.com/v1"
                  status={
                    activeCodexRoute === "tuzi"
                      ? "已接入"
                      : hasCodexTuziRoute
                        ? "已写入"
                        : codexSelectedRoute === "tuzi"
                          ? "当前选择"
                          : "推荐"
                  }
                  selected={codexSelectedRoute === "tuzi"}
                  tone="sky"
                  onClick={() => {
                    setCodexSelectionTouched(true);
                    setCodexEntryOption("tuzi");
                  }}
                />
                <RouteCard
                  title={CODEX_ROUTE_CONFIG.codex.providerName}
                  meta="Base URL: https://api.tu-zi.com/coding"
                  status={
                    activeCodexRoute === "tuzi-coding"
                      ? "已接入"
                      : hasCodexCodingRoute
                        ? "已写入"
                        : codexSelectedRoute === "tuzi-coding"
                          ? "当前选择"
                          : "可选"
                  }
                  selected={codexSelectedRoute === "tuzi-coding"}
                  tone="sky"
                  onClick={() => {
                    setCodexSelectionTouched(true);
                    setCodexEntryOption("tuzi-coding");
                  }}
                />
                <RouteCard
                  title="Codex · gac 线路"
                  meta="Base URL: https://gaccode.com/codex/v1"
                  status={
                    activeCodexRoute === "gac"
                      ? "已接入"
                      : hasCodexGacRoute
                        ? "已写入"
                        : codexSelectedRoute === "gac"
                          ? "当前选择"
                          : "可选"
                  }
                  selected={codexSelectedRoute === "gac"}
                  tone="sky"
                  onClick={() => {
                    setCodexSelectionTouched(true);
                    setCodexEntryOption("gac");
                  }}
                />
                <RouteCard
                  title="gac 改版 Codex"
                  status={
                    activeCodexRoute === "gac-modified"
                      ? "已接入"
                      : codexSelectedRoute === "gac-modified"
                        ? "当前选择"
                        : "可选"
                  }
                  selected={codexSelectedRoute === "gac-modified"}
                  tone="sky"
                  onClick={() => {
                    setCodexSelectionTouched(true);
                    setCodexEntryOption("gac-modified");
                  }}
                />
              </div>
              {codexPanelRoute !== "gac-modified" ? (
                <div className="mt-4 grid gap-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      type="password"
                      value={codexApiKey}
                      onChange={(event) => setCodexApiKey(event.target.value)}
                      placeholder={`输入${codexPanelRoute === "gac" ? "gac" : "兔子"} API Key`}
                    />
                    <Input
                      value={codexModel}
                      onChange={(event) => setCodexModel(event.target.value)}
                      placeholder="模型，如 gpt-5.4"
                    />
                    <Select
                      value={codexReasoning}
                      onValueChange={setCodexReasoning}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择推理强度" />
                      </SelectTrigger>
                      <SelectContent>
                        {CODEX_REASONING_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-3">
                {codexPanelRoute === "gac-modified" ? (
                  <Button
                    onClick={() =>
                      void runAction(
                        activeCodexRoute === "gac-modified"
                          ? "codex-switch-original"
                          : "codex-switch-modified",
                        switchCodexModifiedUsage,
                      )
                    }
                    disabled={!!runningAction}
                    className="gap-2"
                  >
                    {runningAction === "codex-switch-original" ||
                    runningAction === "codex-switch-modified" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wrench className="h-4 w-4" />
                    )}
                    {codexUsingModifiedVariant
                      ? "退出使用改版"
                      : "选择使用改版"}
                  </Button>
                ) : (
                  <Button
                    onClick={() =>
                      void runAction(
                        "codex-install-openai",
                        installCodexBusinessRoute,
                      )
                    }
                    disabled={!!runningAction}
                    className="gap-2"
                  >
                    {runningAction === "codex-install-openai" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wrench className="h-4 w-4" />
                    )}
                    立即配置
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : null}

        {isGemini ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <Stat
                label="当前线路"
                value={geminiCurrentRouteLabel}
                compact
                valueTitle={geminiCurrentRouteLabel}
              />
              <Stat
                label="CLI 变体"
                value={geminiCliVariantLabel}
                compact
                valueTitle={geminiCliVariantLabel}
              />
              <Stat
                label="版本"
                value={geminiVersionLabel}
                compact
                action={
                  geminiStatusView.installed ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        void runAction("gemini-upgrade", () =>
                          installerApi.upgradeGemini(
                            geminiUsingModifiedVariant ? "gac" : "official",
                          ),
                        )
                      }
                      disabled={
                        !!runningAction ||
                        geminiVersionCheckState !== "upgrade"
                      }
                      title={getUpgradeButtonTitle(geminiVersionCheckState)}
                      className="h-7 gap-1.5 px-2 text-[11px]"
                    >
                      {runningAction === "gemini-upgrade" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      {getUpgradeButtonLabel(geminiVersionCheckState)}
                    </Button>
                  ) : null
                }
              />
              <Stat
                label="Base URL"
                value={geminiCurrentBaseUrl}
                compact
                valueTitle={geminiCurrentBaseUrl}
                valueClassName="break-all whitespace-normal leading-5"
              />
            </div>
            {geminiVariantConflict ? (
              <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                检测到 Gemini 当前业务线路记录与实际命中的 CLI
                变体不一致。顶部“CLI 变体”和“版本”已按真实命中的 Gemini
                显示；重新执行目标线路配置后会自动纠正到对应变体。
              </div>
            ) : null}
            {geminiRouteMismatch ? (
              <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                顶部状态已按 CLI 实际启用线路显示；当前 provider 仍停留在
                {` ${getGeminiRouteLabel(geminiProviderRoute)} `}
                ，两边暂时不一致。
              </div>
            ) : null}

            <div className="rounded-2xl border border-border/60 bg-background/80 p-4 dark:border-white/10 dark:bg-white/4">
              <div className="font-medium">Gemini 路线管理</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <RouteCard
                  title="Gemini · 兔子线路"
                  meta="Base URL: https://api.tu-zi.com"
                  status={
                    activeGeminiRoute === "tuzi"
                      ? "已接入"
                      : hasGeminiTuziRoute
                        ? "已写入"
                        : geminiSelectedRoute === "tuzi"
                          ? "当前选择"
                          : "推荐"
                  }
                  selected={geminiSelectedRoute === "tuzi"}
                  tone="pink"
                  onClick={() => {
                    setGeminiSelectionTouched(true);
                    setGeminiEntryOption("tuzi");
                  }}
                />
                <RouteCard
                  title="gac 改版 Gemini"
                  status={
                    activeGeminiRoute === "gac-modified"
                      ? "已接入"
                      : geminiSelectedRoute === "gac-modified"
                        ? "当前选择"
                        : "可选"
                  }
                  selected={geminiSelectedRoute === "gac-modified"}
                  tone="pink"
                  onClick={() => {
                    setGeminiSelectionTouched(true);
                    setGeminiEntryOption("gac-modified");
                  }}
                />
              </div>
              {geminiPanelRoute !== "gac-modified" ? (
                <div className="mt-4 grid gap-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      type="password"
                      value={geminiApiKey}
                      onChange={(event) => setGeminiApiKey(event.target.value)}
                      placeholder="输入兔子 API Key"
                    />
                    <Input
                      value={geminiModel}
                      onChange={(event) => setGeminiModel(event.target.value)}
                      placeholder="模型，如 gemini-2.5-pro"
                    />
                  </div>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-3">
                {geminiPanelRoute === "gac-modified" ? (
                  <Button
                    onClick={() =>
                      void runAction(
                        activeGeminiRoute === "gac-modified"
                          ? "gemini-switch-original"
                          : "gemini-switch-modified",
                        switchGeminiModifiedUsage,
                      )
                    }
                    disabled={!!runningAction}
                    className="gap-2"
                  >
                    {runningAction === "gemini-switch-original" ||
                    runningAction === "gemini-switch-modified" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wrench className="h-4 w-4" />
                    )}
                    {geminiUsingModifiedVariant
                      ? "退出使用改版"
                      : "选择使用改版"}
                  </Button>
                ) : (
                  <Button
                    onClick={() =>
                      void runAction(
                        "gemini-install",
                        installGeminiBusinessRoute,
                      )
                    }
                    disabled={!!runningAction}
                    className="gap-2"
                  >
                    {runningAction === "gemini-install" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wrench className="h-4 w-4" />
                    )}
                    立即配置
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : null}

        {isOpenClaw ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <Stat
                label="当前默认线路"
                value={
                  openclawStatus.inferredRoute
                    ? OPENCLAW_ROUTE_CONFIG[openclawStatus.inferredRoute]
                        .optionLabel
                    : "--"
                }
              />
              <Stat label="默认模型" value={openclawStatus.primaryModel} />
              <Stat label="工具模式" value={openclawStatus.toolsProfile} />
              <Stat
                label="状态概览"
                value={
                  openclawStatus.warningCount > 0
                    ? `${openclawStatus.warningCount} 项`
                    : "正常"
                }
              />
            </div>

            <div>
              <div className="rounded-2xl border border-border/60 bg-background/80 p-4 dark:border-white/10 dark:bg-white/4">
                <div className="font-medium">OpenClaw 路线管理</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {(
                    Object.entries(OPENCLAW_ROUTE_CONFIG) as Array<
                      [
                        OpenClawRoute,
                        (typeof OPENCLAW_ROUTE_CONFIG)[OpenClawRoute],
                      ]
                    >
                  ).map(([route, config]) => {
                    const isSelected = openclawRoute === route;
                    const isConfigured =
                      hasBusinessRouteProviderInList(
                        openclawLiveProviderIds,
                        config.providerId,
                      ) ||
                      hasBusinessRouteProviderInRecord(
                        openclawProviderMap,
                        config.providerId,
                      );
                    return (
                      <RouteCard
                        key={route}
                        title={config.optionLabel}
                        meta={`Base URL: ${config.baseUrl}`}
                        status={
                          openclawStatus.inferredRoute === route
                            ? "默认使用"
                            : isConfigured
                              ? "已写入"
                              : isSelected
                                ? "当前选择"
                                : "可选"
                        }
                        selected={isSelected}
                        tone="red"
                        onClick={() => setOpenclawRoute(route)}
                      />
                    );
                  })}
                </div>
                <div className="mt-4 grid gap-3">
                  <Input
                    type="password"
                    value={openclawApiKey}
                    onChange={(event) => setOpenclawApiKey(event.target.value)}
                    placeholder={`输入${selectedOpenClawConfig.apiKeyLabel}`}
                  />
                </div>
                <Button
                  onClick={() =>
                    void runAction("openclaw-configure", () =>
                      configureOpenClawRoute(openclawRoute, openclawApiKey),
                    )
                  }
                  disabled={!!runningAction}
                  className="mt-4 gap-2"
                >
                  {runningAction === "openclaw-configure" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wrench className="h-4 w-4" />
                  )}
                  立即配置
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
