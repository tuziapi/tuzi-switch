import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Loader2,
  Upload,
  Wrench,
} from "lucide-react";
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
import { openclawKeys, useOpenClawAgentsDefaults, useOpenClawDefaultModel, useOpenClawHealth, useOpenClawLiveProviderIds, useOpenClawTools } from "@/hooks/useOpenClaw";
import { ClaudeIcon, CodexIcon, GeminiIcon, TuziIcon } from "@/components/BrandIcons";
import {
  generateThirdPartyAuth,
} from "@/config/codexProviderPresets";
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
import { useProvidersQuery } from "@/lib/query/queries";
import type { OpenClawModel, Provider } from "@/types";
import { extractErrorMessage } from "@/utils/errorUtils";

type OpenClawRoute =
  | "tuzi-claude"
  | "tuzi-codex"
  | "gac-claude"
  | "gac-codex";
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
  current_route: null,
  route_file_exists: false,
  routes: [],
  env_summary: {
    anthropic_api_key_masked: null,
    anthropic_base_url: null,
    anthropic_api_token_set: false,
  },
};

const EMPTY_CODEX_STATUS: CodexInstallerStatus = {
  installed: false,
  version: null,
  install_type: null,
  current_route: null,
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
  install_type: null,
  current_route: null,
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
    providerName: "Codex · 兔子 Coding 特别线路",
    baseUrl: "https://coding.tu-zi.com",
    websiteUrl: "https://coding.tu-zi.com",
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
  return new RegExp(
    `^${escapeRegExp(baseProviderId)}-alt-\\d+$`,
  ).test(providerId);
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
      provider.settingsConfig?.env?.ANTHROPIC_AUTH_TOKEN ||
      provider.settingsConfig?.env?.ANTHROPIC_API_KEY ||
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

function getGeminiCliStatusLabel(status: GeminiInstallerStatus) {
  if (!status.installed) return "未安装";
  if (!status.install_type && !status.env_file_exists && !status.settings_file_exists) {
    return "检测到命令";
  }
  return "已安装";
}

function getClaudeRouteLabel(route: ClaudeEntryOption | "modified" | "custom" | null | undefined) {
  if (!route) return "--";
  if (route === "tu-zi") return "兔子线路";
  if (route === "gaccode") return "gac 线路";
  if (route === "modified") return "改版";
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
    providerName.includes("Codex · 兔子 Coding 特别线路") ||
    providerName.includes("Coding 特别线路") ||
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

function getCodexRouteLabel(route: CodexEntryOption | "gac-modified" | "custom" | null | undefined) {
  if (!route) return "--";
  if (route === "tuzi") return "兔子线路";
  if (route === "tuzi-coding") return "兔子 Coding 特别线路";
  if (route === "gac") return "gac 线路";
  if (route === "gac-modified") return "gac 改版";
  return "自定义线路";
}

function getGeminiRouteLabel(route: GeminiEntryOption | "gac-modified" | "custom" | null | undefined) {
  if (!route) return "--";
  if (route === "tuzi") return "兔子线路";
  if (route === "gac-modified") return "gac 改版";
  return "自定义线路";
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
) {
  const profileName = route === "gac" ? "codex" : route;
  return `profile = "${profileName}"
model_provider = "${profileName}"
model = "${modelName}"
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.${profileName}]
name = "${profileName}"
base_url = "${baseUrl}"
wire_api = "responses"
requires_openai_auth = true

[profiles.${profileName}]
model_provider = "${profileName}"
model = "${modelName}"
model_reasoning_effort = "high"
approval_policy = "on-request"`;
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/75 px-3 py-3 dark:border-white/10 dark:bg-white/6">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium">{value}</div>
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
  description: string;
  meta: string;
  status: string;
  selected: boolean;
  tone?: "orange" | "sky" | "pink" | "rose" | "red";
  onClick: () => void;
}) {
  const toneClasses = {
    orange: {
      selected:
        "border-orange-300 bg-orange-50/80 shadow-sm dark:border-orange-400/45 dark:bg-[linear-gradient(135deg,#4a3328,#2a2322)] dark:shadow-[0_0_0_1px_rgba(251,146,60,0.06)]",
      idle:
        "border-border/60 bg-background/70 hover:border-orange-200 hover:bg-orange-50/40 dark:bg-background/30 dark:hover:border-orange-400/30 dark:hover:bg-orange-500/8",
      badge:
        "bg-orange-100 text-orange-700 dark:bg-orange-500/18 dark:text-orange-200",
    },
    sky: {
      selected:
        "border-sky-300 bg-sky-50/80 shadow-sm dark:border-sky-400/45 dark:bg-[linear-gradient(135deg,#253846,#20272d)] dark:shadow-[0_0_0_1px_rgba(56,189,248,0.06)]",
      idle:
        "border-border/60 bg-background/70 hover:border-sky-200 hover:bg-sky-50/40 dark:bg-background/30 dark:hover:border-sky-400/30 dark:hover:bg-sky-500/8",
      badge:
        "bg-sky-100 text-sky-700 dark:bg-sky-500/18 dark:text-sky-200",
    },
    pink: {
      selected:
        "border-pink-300 bg-pink-50/80 shadow-sm dark:border-pink-400/45 dark:bg-[linear-gradient(135deg,#4a2d3d,#282126)] dark:shadow-[0_0_0_1px_rgba(236,72,153,0.06)]",
      idle:
        "border-border/60 bg-background/70 hover:border-pink-200 hover:bg-pink-50/40 dark:bg-background/30 dark:hover:border-pink-400/30 dark:hover:bg-pink-500/8",
      badge:
        "bg-pink-100 text-pink-700 dark:bg-pink-500/18 dark:text-pink-200",
    },
    rose: {
      selected:
        "border-rose-300 bg-rose-50/80 shadow-sm dark:border-rose-400/45 dark:bg-[linear-gradient(135deg,#492c34,#282124)] dark:shadow-[0_0_0_1px_rgba(244,63,94,0.06)]",
      idle:
        "border-border/60 bg-background/70 hover:border-rose-200 hover:bg-rose-50/40 dark:bg-background/30 dark:hover:border-rose-400/30 dark:hover:bg-rose-500/8",
      badge:
        "bg-rose-100 text-rose-700 dark:bg-rose-500/18 dark:text-rose-200",
    },
    red: {
      selected:
        "border-red-300 bg-red-50/80 shadow-sm dark:border-red-400/45 dark:bg-[linear-gradient(135deg,#492c2c,#282121)] dark:shadow-[0_0_0_1px_rgba(239,68,68,0.06)]",
      idle:
        "border-border/60 bg-background/70 hover:border-red-200 hover:bg-red-50/40 dark:bg-background/30 dark:hover:border-red-400/30 dark:hover:bg-red-500/8",
      badge:
        "bg-red-100 text-red-700 dark:bg-red-500/18 dark:text-red-200",
    },
  } as const;
  const activeTone = toneClasses[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-4 text-left transition ${selected ? `${activeTone.selected} dark:text-white` : activeTone.idle}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className={`mt-1 text-xs leading-5 ${selected ? "text-muted-foreground dark:text-white/82" : "text-muted-foreground"}`}>
            {description}
          </div>
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
      <div className={`mt-3 text-xs ${selected ? "text-muted-foreground dark:text-white/78" : "text-muted-foreground"}`}>{meta}</div>
    </button>
  );
}

function ResultHint({
  target,
  syncHint,
}: {
  target: string;
  syncHint: string;
}) {
  return (
    <div className="mt-3 grid gap-2 md:grid-cols-2">
      <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-3 text-sm text-muted-foreground dark:bg-white/6">
        当前目标:
        {" "}
        <span className="text-foreground">{target}</span>
      </div>
      <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-3 text-sm text-muted-foreground dark:bg-white/6">
        配置完成后:
        {" "}
        <span className="text-foreground">{syncHint}</span>
      </div>
    </div>
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
}: {
  appId: AppId;
  providers?: Record<string, Provider>;
}) {
  const isClaude = appId === "claude";
  const isCodex = appId === "codex";
  const isGemini = appId === "gemini";
  const isOpenClaw = appId === "openclaw";
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<InstallerActionResult | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeInstallerStatus | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexInstallerStatus | null>(null);
  const [geminiStatus, setGeminiStatus] = useState<GeminiInstallerStatus | null>(null);
  const [claudeEntryOption, setClaudeEntryOption] = useState<ClaudeEntryOption>("tu-zi");
  const [codexEntryOption, setCodexEntryOption] = useState<CodexEntryOption>("tuzi");
  const [geminiEntryOption, setGeminiEntryOption] = useState<GeminiEntryOption>("tuzi");
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
  const [openclawRoute, setOpenclawRoute] = useState<OpenClawRoute>("tuzi-claude");
  const [openclawApiKey, setOpenclawApiKey] = useState("");

  const { data: claudeProvidersData } = useProvidersQuery("claude");
  const { data: codexProvidersData } = useProvidersQuery("codex");
  const { data: geminiProvidersData } = useProvidersQuery("gemini");

  const { data: openclawDefaultModel } = useOpenClawDefaultModel(isOpenClaw);
  const { data: openclawAgentsDefaults } = useOpenClawAgentsDefaults();
  const { data: openclawTools } = useOpenClawTools();
  const { data: openclawLiveProviderIds = [] } = useOpenClawLiveProviderIds(isOpenClaw);
  const { data: openclawHealthWarnings = [] } = useOpenClawHealth(isOpenClaw);
  const { data: openclawProvidersData } = useProvidersQuery("openclaw");

  const claudeCurrentProviderId = claudeProvidersData?.currentProviderId || "";
  const claudeCurrentProvider =
    claudeProvidersData?.providers?.[claudeCurrentProviderId];
  const codexCurrentProviderId = codexProvidersData?.currentProviderId || "";
  const codexCurrentProvider =
    codexProvidersData?.providers?.[codexCurrentProviderId];
  const geminiCurrentProviderId = geminiProvidersData?.currentProviderId || "";
  const geminiCurrentProvider =
    geminiProvidersData?.providers?.[geminiCurrentProviderId];
  const openclawProviderMap = openclawProvidersData?.providers || {};
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

  const loadStatus = async ({ showRefreshState = false } = {}) => {
    if (showRefreshState) {
      setIsRefreshing(true);
    }
    setPageError(null);
    try {
      if (isClaude) {
        setClaudeStatus(
          await withTimeout(
            installerApi.getClaudeStatus(),
            5000,
            "Claude 状态读取超时，请点击“刷新状态”重试。",
          ),
        );
        void queryClient.invalidateQueries({ queryKey: ["providers", "claude"] });
      } else if (isCodex) {
        setCodexStatus(
          await withTimeout(
            installerApi.getCodexStatus(),
            5000,
            "Codex 状态读取超时，请点击“刷新状态”重试。",
          ),
        );
        void queryClient.invalidateQueries({ queryKey: ["providers", "codex"] });
      } else if (isGemini) {
        setGeminiStatus(
          await withTimeout(
            installerApi.getGeminiStatus(),
            5000,
            "Gemini 状态读取超时，请点击“刷新状态”重试。",
          ),
        );
        void queryClient.invalidateQueries({ queryKey: ["providers", "gemini"] });
      } else if (isOpenClaw) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["providers", "openclaw"] }),
          queryClient.invalidateQueries({ queryKey: openclawKeys.liveProviderIds }),
          queryClient.invalidateQueries({ queryKey: openclawKeys.defaultModel }),
          queryClient.invalidateQueries({ queryKey: openclawKeys.agentsDefaults }),
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
    if (isClaude) return "Claude 快速接入";
    if (isCodex) return "Codex 快速接入";
    if (isGemini) return "Gemini 快速接入";
    if (isOpenClaw) return "OpenClaw 兔子快速接入";
    return "";
  }, [isClaude, isCodex, isOpenClaw]);

  const subtitle = useMemo(() => {
    if (isClaude) {
      return "选择适合你的 Claude 使用方式，输入对应 Key 后即可快速完成接入。";
    }
    if (isCodex) {
      return "选择适合你的 Codex 使用方式，输入对应 Key 后即可快速完成接入。";
    }
    if (isGemini) {
      return "选择适合你的 Gemini 使用方式，输入对应 Key 后即可快速完成接入。";
    }
    if (isOpenClaw) {
      return "先选 tuzi 或 gac，再选 Claude 或 Codex 方向，系统会自动完成所需设置。";
    }
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

  const heroBadgeClassName = useMemo(() => {
    if (isGemini) {
      return "border-pink-300/60 bg-white/80 text-pink-700 dark:border-pink-500/30 dark:bg-pink-500/10 dark:text-pink-200";
    }
    if (isCodex) {
      return "border-sky-300/60 bg-white/80 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200";
    }
    if (isOpenClaw) {
      return "border-red-300/60 bg-white/80 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200";
    }
    return "border-orange-300/60 bg-white/80 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200";
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
  const activeClaudeRoute = useMemo<ClaudeEntryOption | "custom" | null>(() => {
    const providerRoute = getClaudeRouteFromProvider(
      claudeCurrentProviderId,
      claudeCurrentProvider,
    );
    if (providerRoute) return providerRoute;
    if (claudeStatus?.current_route === "改版") return "modified";
    if (claudeStatus?.current_route === "gaccode") {
      return "gaccode";
    }
    if (claudeStatus?.current_route) {
      return "custom";
    }
    return claudeCurrentProviderId || claudeCurrentProvider ? "custom" : null;
  }, [claudeCurrentProvider, claudeCurrentProviderId, claudeStatus]);

  const activeCodexRoute = useMemo<CodexEntryOption | "gac-modified" | "custom" | null>(() => {
    const providerRoute = getCodexRouteFromProvider(
      codexCurrentProviderId,
      codexCurrentProvider,
    );
    if (providerRoute) return providerRoute;
    if (codexStatus?.install_type === "gac") return "gac-modified";
    if (codexStatus?.current_route === "codex") return "tuzi-coding";
    if (codexStatus?.current_route === "gac") return "gac";
    if (codexStatus?.current_route === "tuzi") return "tuzi";
    if (codexStatus?.current_route) return "custom";
    return codexCurrentProviderId || codexCurrentProvider ? "custom" : null;
  }, [codexCurrentProvider, codexCurrentProviderId, codexStatus]);

  const activeGeminiRoute = useMemo<GeminiEntryOption | "gac-modified" | "custom" | null>(() => {
    const providerRoute = getGeminiRouteFromProvider(
      geminiCurrentProviderId,
      geminiCurrentProvider,
    );
    if (providerRoute) return providerRoute;
    if (geminiStatus?.install_type === "gac") return "gac-modified";
    if (geminiStatus?.current_route === "tuzi") return "tuzi";
    if (geminiStatus?.current_route) return "custom";
    return geminiCurrentProviderId || geminiCurrentProvider ? "custom" : null;
  }, [geminiCurrentProvider, geminiCurrentProviderId, geminiStatus]);

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
  const hasClaudeTuziRoute = hasNamedRoute(claudeStatusView.routes, "tu-zi");
  const hasClaudeGacRoute = hasNamedRoute(claudeStatusView.routes, "gaccode");
  const hasCodexTuziRoute = hasNamedRoute(codexStatusView.routes, "tuzi");
  const hasCodexCodingRoute = hasNamedRoute(codexStatusView.routes, "codex");
  const hasCodexGacRoute = hasNamedRoute(codexStatusView.routes, "gac");
  const hasGeminiTuziRoute = hasNamedRoute(geminiStatusView.routes, "tuzi");
  const installerClaudeRoute = getClaudeInstallerRoute(claudeStatusView);
  const installerCodexRoute = getCodexInstallerRoute(codexStatusView);
  const installerGeminiRoute = getGeminiInstallerRoute(geminiStatusView);
  const claudeRouteMismatch = Boolean(
    activeClaudeRoute &&
      installerClaudeRoute &&
      activeClaudeRoute !== installerClaudeRoute,
  );
  const codexRouteMismatch = Boolean(
    activeCodexRoute &&
      installerCodexRoute &&
      activeCodexRoute !== installerCodexRoute,
  );
  const geminiRouteMismatch = Boolean(
    activeGeminiRoute &&
      installerGeminiRoute &&
      activeGeminiRoute !== installerGeminiRoute,
  );

  useEffect(() => {
    if (!isCodex || !codexStatus) return;

    const currentRouteName =
      codexStatus.current_route ||
      (activeCodexRoute === "tuzi"
        ? "tuzi"
        : activeCodexRoute === "tuzi-coding"
          ? "codex"
          : activeCodexRoute === "gac"
            ? "gac"
            : null);

    if (!currentRouteName) return;

    const currentRoute = codexStatus.routes.find((route) => route.name === currentRouteName);
    const model = currentRoute?.model_settings?.model?.trim();
    const reasoning = currentRoute?.model_settings?.model_reasoning_effort?.trim();

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
      ...(claudeProvidersData?.providers || {}),
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
        env: {
          ANTHROPIC_BASE_URL: routeConfig.baseUrl,
          ANTHROPIC_AUTH_TOKEN: apiKey,
        },
      },
    };

    if (target.isNew) {
      await providersApi.add(provider, "claude");
    } else {
      await providersApi.update(provider, "claude", target.targetProviderId);
    }

    await providersApi.switch(target.targetProviderId, "claude");
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
  ) => {
    const routeConfig = CODEX_ROUTE_CONFIG[route];
    const providerMap = {
      ...(codexProvidersData?.providers || {}),
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
          : "由兔子业务一键接入自动生成（Coding 特别线路）";
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
        config: buildCodexBusinessConfig(route, routeConfig.baseUrl, model),
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

  const installCodexBusinessRoute = async (): Promise<InstallerActionResult> => {
    if (codexEntryOption === "gac-modified") {
      return await installerApi.installCodex({ variant: "gac" });
    }

    const trimmedKey = codexApiKey.trim();
    const trimmedModel = codexModel.trim() || "gpt-5.4";
    const trimmedReasoning = codexReasoning.trim() || "medium";
    const selectedRoute: CodexBusinessRoute =
      codexEntryOption === "gac"
        ? "gac"
        : codexEntryOption === "tuzi-coding"
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
      ...(geminiProvidersData?.providers || {}),
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

  const installGeminiBusinessRoute = async (): Promise<InstallerActionResult> => {
    if (geminiEntryOption === "gac-modified") {
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

  if (!isClaude && !isCodex && !isGemini && !isOpenClaw) return null;

  return (
    <Card className={cardClassName}>
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${heroBadgeClassName}`}>
              <TuziIcon size={14} />
              兔子一键接入
            </div>
            <div className="flex items-center gap-3">
              <div className={`flex items-center justify-center rounded-2xl dark:bg-black/10 ${heroIconClassName}`}>
                {isClaude ? (
                  <ClaudeIcon size={26} />
                ) : isCodex ? (
                  <CodexIcon size={26} />
                ) : isGemini ? (
                  <GeminiIcon size={26} />
                ) : (
                  <TuziIcon size={34} className="rounded-[12px]" />
                )}
              </div>
              <div>
                <h3 className="text-xl font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => void loadStatus({ showRefreshState: true })}
            disabled={!!runningAction || isRefreshing}
            className="self-start"
          >
            {isRefreshing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                刷新中...
              </>
            ) : lastRefreshedAt
              ? `刷新状态 · ${new Date(lastRefreshedAt).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}`
              : "刷新状态"}
          </Button>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-6 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/4">
            正在读取当前配置状态...
            {(isClaude || isCodex || isGemini) ? " 你现在也可以直接使用下方路线管理继续配置。" : ""}
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
                value={
                  activeClaudeRoute === "custom"
                    ? claudeCurrentProvider?.name || "自定义线路"
                    : getClaudeRouteLabel(activeClaudeRoute)
                }
              />
              <Stat
                label="CLI 状态"
                value={claudeStatusView.installed ? "已安装" : "未安装"}
              />
              <Stat label="版本" value={claudeStatusView.version || "--"} />
              <Stat
                label="Base URL"
                value={
                  getProviderBaseUrl(claudeCurrentProvider) ||
                  getCurrentRouteBaseUrl(claudeStatusView.routes)
                }
              />
            </div>
            {claudeRouteMismatch ? (
              <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                当前页面显示的线路以已切换的 provider 为准；CLI 安装器记录仍显示为
                {` ${getClaudeRouteLabel(installerClaudeRoute)} `}
                ，两边暂时不一致。
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
              <div className="rounded-2xl border border-border/60 bg-background/80 p-4 dark:border-white/10 dark:bg-white/4">
                <div className="font-medium">Claude 路线管理</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <RouteCard
                    title="Claude · 兔子线路"
                    description="适合希望直接接入兔子服务的使用场景。"
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
                    description="适合已经在使用 gac 服务的场景。"
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
                    title="兔子改版 Claude"
                    description="适合希望直接使用改版 Claude 体验的场景。"
                    meta="无需额外输入 Key，直接写入改版 Claude。"
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
                <div className="mt-4 grid gap-3">
                  {claudeEntryOption === "gaccode" ? (
                    <Input
                      type="password"
                      value={claudeGacKey}
                      onChange={(event) => setClaudeGacKey(event.target.value)}
                      placeholder="输入 gac API Key"
                    />
                  ) : claudeEntryOption === "tu-zi" ? (
                    <Input
                      type="password"
                      value={claudeTuziKey}
                      onChange={(event) => setClaudeTuziKey(event.target.value)}
                      placeholder="输入兔子 API Key"
                    />
                  ) : (
                    <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-3 text-sm text-muted-foreground dark:bg-white/6">
                      当前方案不需要额外输入 Key，适合希望直接交付改版 Claude 的场景。
                      当前方案不需要额外输入 Key，完成后即可直接开始使用。
                    </div>
                  )}
                </div>
                <ResultHint
                  target={
                    claudeEntryOption === "modified"
                      ? "写入改版 Claude 客户端"
                      : claudeEntryOption === "gaccode"
                        ? "写入 gac Claude 线路"
                        : "写入 Claude · 兔子线路"
                  }
                  syncHint="自动同步配置状态，并在下方列表显示对应入口"
                />
                <Button
                  onClick={() =>
                    void runAction(
                      claudeEntryOption === "modified"
                        ? "claude-install-a"
                        : claudeEntryOption === "gaccode"
                          ? "claude-install-b"
                          : "claude-install-c",
                      () =>
                        claudeEntryOption === "modified"
                          ? installerApi.installClaudeCode("A")
                          : claudeEntryOption === "gaccode"
                            ? installClaudeBusinessRoute("B", claudeGacKey)
                            : installClaudeBusinessRoute("C", claudeTuziKey),
                    )
                  }
                  disabled={!!runningAction}
                  className="mt-4 gap-2"
                >
                  {runningAction === "claude-install-a" ||
                  runningAction === "claude-install-b" ||
                  runningAction === "claude-install-c" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wrench className="h-4 w-4" />
                  )}
                  立即配置
                </Button>
              </div>

              <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 p-4 dark:border-white/10 dark:bg-white/4">
                <div className="font-medium">使用与升级</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  已为你保留当前线路的升级入口，后续可直接升级当前使用方式。
                </div>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void runAction("claude-upgrade", () =>
                      installerApi.upgradeClaudeCode(
                        claudeStatusView.current_route === "改版"
                          ? "modified"
                          : "original",
                      ),
                    )
                  }
                  disabled={!!runningAction}
                  className="mt-4 gap-2"
                >
                  {runningAction === "claude-upgrade" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  升级
                </Button>
              </div>
            </div>
          </>
        ) : null}

        {isCodex ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <Stat
                label="当前线路"
                value={
                  activeCodexRoute === "gac-modified"
                    ? "gac 改版"
                    : activeCodexRoute === "custom"
                      ? codexCurrentProvider?.name || "自定义线路"
                    : activeCodexRoute === null
                      ? "--"
                    : activeCodexRoute === "tuzi-coding"
                      ? "兔子 Coding 特别线路"
                    : activeCodexRoute === "gac"
                        ? "gac 线路"
                        : "兔子线路"
                }
              />
              <Stat
                label="CLI 状态"
                value={codexStatusView.installed ? "已安装" : "未安装"}
              />
              <Stat label="版本" value={codexStatusView.version || "--"} />
              <Stat
                label="Base URL"
                value={
                  getProviderBaseUrl(codexCurrentProvider) ||
                  getCurrentRouteBaseUrl(codexStatusView.routes)
                }
              />
            </div>
            {codexRouteMismatch ? (
              <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                当前页面显示的线路以已切换的 provider 为准；CLI 安装器记录仍显示为
                {` ${getCodexRouteLabel(installerCodexRoute)} `}
                ，两边暂时不一致。
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
              <div className="rounded-2xl border border-border/60 bg-background/80 p-4 dark:border-white/10 dark:bg-white/4">
                <div className="font-medium">Codex 路线管理</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <RouteCard
                    title="Codex · 兔子线路"
                    description="适合直接接入兔子主服务，和 Claude 兔子线路保持一致。"
                    meta="Base URL 走 https://api.tu-zi.com/v1，推荐主模型 gpt-5.4。"
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
                    title="Codex · 兔子 Coding 特别线路"
                    description="适合单独使用 coding 业务线的 Codex 场景。"
                    meta="Base URL 走 https://coding.tu-zi.com。"
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
                    description="适合已有 gac 使用基础或迁移场景。"
                    meta="沿用 gac 路线配置。"
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
                    description="适合希望直接使用 gac 改版体验的场景。"
                    meta="直接落地 gac 改版 Codex。"
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
                <div className="mt-4 grid gap-3">
                  {codexEntryOption !== "gac-modified" ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <Input
                        type="password"
                        value={codexApiKey}
                        onChange={(event) => setCodexApiKey(event.target.value)}
                        placeholder={`输入${codexEntryOption === "gac" ? "gac" : "兔子"} API Key`}
                      />
                      <Input
                        value={codexModel}
                        onChange={(event) => setCodexModel(event.target.value)}
                        placeholder="模型，如 gpt-5.4"
                      />
                      <Select value={codexReasoning} onValueChange={setCodexReasoning}>
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
                  ) : (
                    <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-3 text-sm text-muted-foreground dark:bg-white/6">
                      当前方案会直接落地 gac 改版 Codex，不需要再填写路线 Key 或模型参数。
                      当前方案不需要额外设置，完成后即可直接开始使用。
                    </div>
                  )}
                </div>
                <ResultHint
                  target={
                    codexEntryOption === "gac-modified"
                      ? "写入 gac 改版 Codex"
                      : codexEntryOption === "tuzi"
                        ? "写入 Codex · 兔子线路"
                        : codexEntryOption === "tuzi-coding"
                          ? "写入 Codex · 兔子 Coding 特别线路"
                          : "写入 Codex · gac 线路"
                  }
                  syncHint={
                    codexEntryOption === "gac-modified"
                      ? "保留 gac 改版 Codex 入口，并在下方列表显示当前模块"
                      : "自动同步配置，并在下方列表显示对应入口"
                  }
                />
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button
                    onClick={() => void runAction("codex-install-openai", installCodexBusinessRoute)}
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
                </div>
              </div>

              <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 p-4 dark:border-white/10 dark:bg-white/4">
                <div className="font-medium">使用与升级</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  已为你保留当前线路的升级入口，后续可直接升级当前使用方式。
                </div>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void runAction("codex-upgrade", () =>
                      installerApi.upgradeCodex(
                        codexStatusView.install_type === "gac" ? "gac" : "openai",
                      ),
                    )
                  }
                  disabled={!!runningAction}
                  className="mt-4 gap-2"
                >
                  {runningAction === "codex-upgrade" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  升级
                </Button>
              </div>
            </div>
          </>
        ) : null}

        {isGemini ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <Stat
                label="当前线路"
                value={
                  activeGeminiRoute === "gac-modified"
                    ? "gac 改版"
                    : activeGeminiRoute === "custom"
                      ? geminiCurrentProvider?.name || "自定义线路"
                      : activeGeminiRoute === null
                        ? "--"
                      : "兔子线路"
                }
              />
              <Stat
                label="CLI 状态"
                value={getGeminiCliStatusLabel(geminiStatusView)}
              />
              <Stat label="版本" value={geminiStatusView.version || "--"} />
              <Stat
                label="Base URL"
                value={
                  getProviderBaseUrl(geminiCurrentProvider) ||
                  geminiStatusView.env_summary.google_gemini_base_url ||
                  getCurrentRouteBaseUrl(geminiStatusView.routes)
                }
              />
            </div>
            {geminiRouteMismatch ? (
              <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                当前页面显示的线路以已切换的 provider 为准；CLI 安装器记录仍显示为
                {` ${getGeminiRouteLabel(installerGeminiRoute)} `}
                ，两边暂时不一致。
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
              <div className="rounded-2xl border border-border/60 bg-background/80 p-4 dark:border-white/10 dark:bg-white/4">
                <div className="font-medium">Gemini 路线管理</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <RouteCard
                    title="Gemini · 兔子线路"
                    description="原版 Gemini CLI 搭配兔子 API，适合希望保留原版体验的场景。"
                    meta="Base URL 走 https://api.tu-zi.com，推荐模型 gemini-2.5-pro。"
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
                    description="适合直接使用 gac 改版 Gemini 方案的场景。"
                    meta="直接落地 gac 改版 Gemini。"
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
                <div className="mt-4 grid gap-3">
                  {geminiEntryOption !== "gac-modified" ? (
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
                  ) : (
                    <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-3 text-sm text-muted-foreground dark:bg-white/6">
                      当前方案会直接落地 gac 改版 Gemini，不需要再填写路线 Key 或模型参数。
                      当前方案不需要额外设置，完成后即可直接开始使用。
                    </div>
                  )}
                </div>
                <ResultHint
                  target={
                    geminiEntryOption === "gac-modified"
                      ? "写入 gac 改版 Gemini"
                      : "写入 Gemini · 兔子线路"
                  }
                  syncHint={
                    geminiEntryOption === "gac-modified"
                      ? "保留 gac 改版 Gemini 入口，并在下方列表显示当前模块"
                      : "自动同步配置状态，并在下方列表显示对应入口"
                  }
                />
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button
                    onClick={() => void runAction("gemini-install", installGeminiBusinessRoute)}
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
                </div>
              </div>

              <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 p-4 dark:border-white/10 dark:bg-white/4">
                <div className="font-medium">使用与升级</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  已为你保留当前线路的升级入口，后续可直接升级当前使用方式。
                </div>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void runAction("gemini-upgrade", () =>
                      installerApi.upgradeGemini(
                        geminiStatusView.install_type === "gac" ? "gac" : "official",
                      ),
                    )
                  }
                  disabled={!!runningAction}
                  className="mt-4 gap-2"
                >
                  {runningAction === "gemini-upgrade" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  升级
                </Button>
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
                    ? OPENCLAW_ROUTE_CONFIG[openclawStatus.inferredRoute].label
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

            <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
              <div className="rounded-2xl border border-border/60 bg-background/80 p-4 dark:border-white/10 dark:bg-white/4">
                <div className="font-medium">业务线路接入</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {(
                    Object.entries(OPENCLAW_ROUTE_CONFIG) as Array<
                      [OpenClawRoute, (typeof OPENCLAW_ROUTE_CONFIG)[OpenClawRoute]]
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
                        description={`${config.apiKeyLabel} / ${config.models[0]?.name}`}
                        meta={config.baseUrl}
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
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-3 text-sm text-muted-foreground dark:bg-white/6">
                    将接入
                    {` ${selectedOpenClawConfig.providerName} `}
                    ，并同步更新默认模型指向的服务线路。
                  </div>
                  <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-3 text-sm text-muted-foreground dark:bg-white/6">
                    推荐模型共
                    {` ${selectedOpenClawConfig.models.length} `}
                    个，默认优先使用
                    {` ${selectedOpenClawConfig.models[0]?.id} `}
                    。
                  </div>
                </div>
                <ResultHint
                  target={`${selectedOpenClawConfig.label} ${selectedOpenClawConfig.baseUrl}`}
                  syncHint="自动完成相关设置，并在下方列表显示对应入口"
                />
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

              <div className="rounded-2xl border border-border/60 bg-background/80 p-4 dark:border-white/10 dark:bg-white/4">
                <div className="font-medium">使用建议</div>
                <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                  <div>
                    `Claude 方向` 更适合作为偏对话式、偏 Claude 体验的入口。
                  </div>
                  <div>
                    `Codex 方向` 更适合代码生成、补全和工程类场景。
                  </div>
                  <div>
                    `兔子` 与 `gac` 对应不同服务线路，可以根据你的账号和场景灵活选择。
                  </div>
                  <div>
                    配置完成后，下面原有的设置面板仍然保留，方便继续调整细节。
                  </div>
                  <div>
                    当前默认线路是根据默认模型和已写入配置推定出来的，用于帮助快速判断当前主要使用方向。
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-3 py-2 text-emerald-800 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-100/88">
                    <CheckCircle2 className="h-4 w-4" />
                    重点是尽快开始使用，而不是理解底层配置细节。
                  </div>
                  <div className="rounded-xl border border-sky-200/70 bg-sky-50/70 px-3 py-3 text-sky-900 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-100/88">
                    <div className="text-sm font-medium">适合的选择</div>
                    <div className="mt-2 space-y-2 text-xs leading-5 text-sky-800 dark:text-red-100/80">
                      <div>兔子 Claude: 更适合希望统一走兔子服务的 Claude 使用场景。</div>
                      <div>兔子 Codex: 更适合代码生成、补全和工程类工作流。</div>
                      <div>gac 线路: 更适合已有 gac 服务基础的使用场景。</div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-3 dark:border-white/10 dark:bg-white/6">
                    <div className="text-sm font-medium">当前可直接使用的线路</div>
                    <div className="mt-2 text-xs leading-5 text-muted-foreground">
                      {openclawStatus.configuredRoutes.length > 0
                        ? openclawStatus.configuredRoutes
                            .map((route) => OPENCLAW_ROUTE_CONFIG[route].optionLabel)
                            .join(" / ")
                        : "当前还没有完成配置，建议先从兔子 Claude 或兔子 Codex 开始。"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
