import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Loader2,
  Route,
  ShieldCheck,
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
import type { OpenClawModel, Provider } from "@/types";

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
    providerName: "兔子 Claude · gac 线路",
    baseUrl: "https://gaccode.com/claudecode",
    websiteUrl: "https://gaccode.com/claudecode",
  },
  "tu-zi": {
    providerId: "tuzi-claude-route",
    providerName: "兔子 Claude · 兔子线路",
    baseUrl: "https://api.tu-zi.com",
    websiteUrl: "https://api.tu-zi.com",
  },
};

const CODEX_ROUTE_OPTIONS: Array<{
  value: CodexBusinessRoute;
  label: string;
}> = [
  { value: "gac", label: "gac 线路" },
  { value: "tuzi", label: "兔子主线路" },
  { value: "codex", label: "兔子 Coding 特别线路" },
];

function getCodexRouteLabel(route: string | null | undefined) {
  if (!route) return "--";
  return (
    CODEX_ROUTE_OPTIONS.find((option) => option.value === route)?.label || route
  );
}
const CODEX_ROUTE_CONFIG = {
  tuzi: {
    providerId: "tuzi-codex-route",
    providerName: "兔子 Codex · 兔子主线路",
    baseUrl: "https://api.tu-zi.com/v1",
    websiteUrl: "https://api.tu-zi.com",
    businessLine: "tuzi" as const,
  },
  codex: {
    providerId: "tuzi.coding",
    providerName: "兔子 Codex · Coding 特别线路",
    baseUrl: "https://coding.tu-zi.com",
    websiteUrl: "https://coding.tu-zi.com",
    businessLine: "tuzi" as const,
  },
  gac: {
    providerId: "default",
    providerName: "default",
    baseUrl: "https://gaccode.com/codex/v1",
    websiteUrl: "https://gaccode.com/codex",
    businessLine: "gac" as const,
  },
};

const GEMINI_ROUTE_OPTIONS: Array<{
  value: GeminiBusinessRoute;
  label: string;
}> = [
  { value: "tuzi", label: "兔子线路" },
];

function getGeminiRouteLabel(route: string | null | undefined) {
  if (!route) return "--";
  return (
    GEMINI_ROUTE_OPTIONS.find((option) => option.value === route)?.label || route
  );
}

function getCurrentRouteBaseUrl(
  routes: Array<{ is_current: boolean; base_url: string | null }> | undefined,
) {
  return routes?.find((route) => route.is_current)?.base_url || "--";
}

function getGeminiCliStatusLabel(status: GeminiInstallerStatus) {
  if (!status.installed) return "未安装";
  if (!status.install_type && !status.env_file_exists && !status.settings_file_exists) {
    return "检测到命令";
  }
  return "已安装";
}

function getCodexRouteDisplay(status: CodexInstallerStatus) {
  if (status.install_type === "gac") return "gac 改版";
  return getCodexRouteLabel(status.current_route);
}

function getGeminiRouteDisplay(status: GeminiInstallerStatus) {
  if (status.install_type === "gac") return "gac 改版";
  return getGeminiRouteLabel(status.current_route);
}

const GEMINI_ROUTE_CONFIG = {
  tuzi: {
    providerId: "tuzi-gemini-route",
    providerName: "兔子 Gemini · 兔子线路",
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
  return `profile = "${route}"
model_provider = "${route}"
model = "${modelName}"
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.${route}]
name = "${route}"
base_url = "${baseUrl}"
wire_api = "responses"
requires_openai_auth = true

[profiles.${route}]
model_provider = "${route}"
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
    <div className="rounded-2xl border border-border/60 bg-background/75 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function JourneyStep({
  step,
  title,
  description,
}: {
  step: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/75 px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {step}
      </div>
      <div className="mt-2 text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">
        {description}
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
  description: string;
  meta: string;
  status: string;
  selected: boolean;
  tone?: "orange" | "sky" | "pink" | "rose" | "red";
  onClick: () => void;
}) {
  const toneClasses = {
    orange: {
      selected: "border-orange-300 bg-orange-50/80 shadow-sm",
      idle: "border-border/60 bg-background/70 hover:border-orange-200 hover:bg-orange-50/40",
      badge: "bg-orange-100 text-orange-700",
    },
    sky: {
      selected: "border-sky-300 bg-sky-50/80 shadow-sm",
      idle: "border-border/60 bg-background/70 hover:border-sky-200 hover:bg-sky-50/40",
      badge: "bg-sky-100 text-sky-700",
    },
    pink: {
      selected: "border-pink-300 bg-pink-50/80 shadow-sm",
      idle: "border-border/60 bg-background/70 hover:border-pink-200 hover:bg-pink-50/40",
      badge: "bg-pink-100 text-pink-700",
    },
    rose: {
      selected: "border-rose-300 bg-rose-50/80 shadow-sm",
      idle: "border-border/60 bg-background/70 hover:border-rose-200 hover:bg-rose-50/40",
      badge: "bg-rose-100 text-rose-700",
    },
    red: {
      selected: "border-red-300 bg-red-50/80 shadow-sm",
      idle: "border-border/60 bg-background/70 hover:border-red-200 hover:bg-red-50/40",
      badge: "bg-red-100 text-red-700",
    },
  } as const;
  const activeTone = toneClasses[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-4 text-left transition ${selected ? activeTone.selected : activeTone.idle}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            {description}
          </div>
        </div>
        <div
          className={`inline-flex min-w-[52px] items-center justify-center whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-medium ${
            status === "已接入"
              ? "bg-emerald-100 text-emerald-700"
              : selected
                ? activeTone.badge
                : "bg-muted text-muted-foreground"
          }`}
        >
          {status}
        </div>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">{meta}</div>
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
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
        当前目标:
        {" "}
        <span className="text-foreground">{target}</span>
      </div>
      <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
        配置完成后:
        {" "}
        <span className="text-foreground">{syncHint}</span>
      </div>
    </div>
  );
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
  const [claudeGacKey, setClaudeGacKey] = useState("");
  const [claudeTuziKey, setClaudeTuziKey] = useState("");
  const [codexApiKey, setCodexApiKey] = useState("");
  const [codexModel, setCodexModel] = useState("gpt-5.4");
  const [codexReasoning, setCodexReasoning] = useState("medium");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-pro");
  const [openclawRoute, setOpenclawRoute] = useState<OpenClawRoute>("tuzi-claude");
  const [openclawApiKey, setOpenclawApiKey] = useState("");

  const { data: openclawDefaultModel } = useOpenClawDefaultModel(isOpenClaw);
  const { data: openclawAgentsDefaults } = useOpenClawAgentsDefaults();
  const { data: openclawTools } = useOpenClawTools();
  const { data: openclawLiveProviderIds = [] } = useOpenClawLiveProviderIds(isOpenClaw);
  const { data: openclawHealthWarnings = [] } = useOpenClawHealth(isOpenClaw);

  const loadStatus = async () => {
    setPageError(null);
    try {
      if (isClaude) {
        setClaudeStatus(await installerApi.getClaudeStatus());
      } else if (isCodex) {
        setCodexStatus(await installerApi.getCodexStatus());
      } else if (isGemini) {
        setGeminiStatus(await installerApi.getGeminiStatus());
      } else if (isOpenClaw) {
        await Promise.all([
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
      setPageError(String(error));
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
      setPageError(String(error));
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
      return "把 Claude Code 变成兔子客户可直接交付的一键接入入口。";
    }
    if (isCodex) {
      return "保留 Codex 原版体验，同时把兔子业务线路配置前置。";
    }
    if (isGemini) {
      return "把 Gemini CLI 做成兔子客户可直接使用的一键接入入口。";
    }
    if (isOpenClaw) {
      return "把 OpenClaw 做成可切换兔子与 gac 线路的统一业务入口。";
    }
    return "";
  }, [isClaude, isCodex, isOpenClaw]);

  const recommendedAction = useMemo(() => {
    if (isClaude) return "推荐优先使用兔子线路，输入 Key 后即可完成接入。";
    if (isCodex) return "推荐优先选择合适线路，再完成一次配置即可开始使用。";
    if (isGemini) return "推荐优先选择兔子或 gac 线路，再一键完成 Gemini 接入。";
    if (isOpenClaw) return "推荐先选业务线路，再由系统自动完成所需设置。";
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
      return "bg-white/80 p-3 ring-1 ring-orange-100/90 shadow-sm";
    }
    if (isGemini) {
      return "bg-white/80 p-3 ring-1 ring-pink-100/90 shadow-sm";
    }
    if (isCodex) {
      return "bg-white/80 p-3 ring-1 ring-sky-100/90 shadow-sm";
    }
    if (isOpenClaw) {
      return "h-12 w-12 bg-white/70 shadow-sm ring-1 ring-red-100/80";
    }
    return "bg-white/80 p-3";
  }, [isClaude, isCodex, isGemini, isOpenClaw]);

  const openclawStatus = useMemo(() => {
    const configuredRoutes = (
      Object.entries(OPENCLAW_ROUTE_CONFIG) as Array<
        [OpenClawRoute, (typeof OPENCLAW_ROUTE_CONFIG)[OpenClawRoute]]
      >
    )
      .filter(([, config]) => openclawLiveProviderIds.includes(config.providerId))
      .map(([route]) => route);

    const inferredRoute = configuredRoutes[0];
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
  const activeClaudeRoute = useMemo<ClaudeEntryOption>(() => {
    if (claudeStatus?.current_route === "改版") return "modified";
    if (claudeStatus?.current_route === "gaccode") {
      return "gaccode";
    }
    return "tu-zi";
  }, [claudeStatus]);

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
    const routeProviderIds = Object.values(OPENCLAW_ROUTE_CONFIG).map(
      (item) => item.providerId,
    );
    const provider: Provider = {
      id: routeConfig.providerId,
      name: routeConfig.providerName,
      category: "custom",
      icon: "tuzi",
      notes: `由兔子快速接入自动生成，适用于 ${routeConfig.label}`,
      meta: {
        businessLine: route.startsWith("gac-") ? "gac" : "tuzi",
      },
      settingsConfig: {
        baseUrl: routeConfig.baseUrl,
        apiKey: trimmedKey,
        api: routeConfig.api,
        models: routeConfig.models,
      },
    };

    const exists = Boolean(providers?.[routeConfig.providerId]);
    if (exists) {
      await providersApi.update(provider, "openclaw", routeConfig.providerId);
    } else {
      await providersApi.add(provider, "openclaw", true);
    }

    const modelRefs = routeConfig.models.map(
      (model) => `${routeConfig.providerId}/${model.id}`,
    );
    const currentModelCatalog = openclawAgentsDefaults?.models || {};
    const preservedModelCatalog = Object.fromEntries(
      Object.entries(currentModelCatalog).filter(
        ([key]) => !routeProviderIds.some((providerId) => key.startsWith(`${providerId}/`)),
      ),
    );
    const nextModelCatalog = {
      ...preservedModelCatalog,
      ...Object.fromEntries(
        routeConfig.models.map((model) => [
          `${routeConfig.providerId}/${model.id}`,
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

    return {
      success: true,
      message: `已为 OpenClaw 写入${routeConfig.label}，现在可以直接使用对应业务线路了。`,
      stdout: [
        `Provider: ${routeConfig.providerId}`,
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
    const provider: Provider = {
      id: routeConfig.providerId,
      name: routeConfig.providerName,
      websiteUrl: routeConfig.websiteUrl,
      category: "custom",
      icon: "tuzi",
      iconColor: "#F97316",
      notes: "由兔子业务一键接入自动生成",
      meta: {
        businessLine: route === "gaccode" ? "gac" : "tuzi",
      },
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: routeConfig.baseUrl,
          ANTHROPIC_AUTH_TOKEN: apiKey,
        },
      },
    };

    if (providers?.[routeConfig.providerId]) {
      await providersApi.update(provider, "claude", routeConfig.providerId);
    } else {
      await providersApi.add(provider, "claude");
    }

    await providersApi.switch(routeConfig.providerId, "claude");
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
    return result;
  };

  const syncCodexBusinessProvider = async (
    route: CodexBusinessRoute,
    apiKey: string,
    model: string,
  ) => {
    const routeConfig = CODEX_ROUTE_CONFIG[route];
    const provider: Provider = {
      id: routeConfig.providerId,
      name: routeConfig.providerName,
      websiteUrl: routeConfig.websiteUrl,
      category: "custom",
      icon: "tuzi",
      iconColor: route === "gac" ? "#F97316" : "#0EA5E9",
      notes:
        route === "gac"
          ? "由 gac 业务一键接入自动生成"
          : route === "tuzi"
            ? "由兔子业务一键接入自动生成（兔子主线路）"
            : "由兔子业务一键接入自动生成（Coding 特别线路）",
      meta: {
        businessLine: routeConfig.businessLine,
      },
      settingsConfig: {
        auth: generateThirdPartyAuth(apiKey),
        config: buildCodexBusinessConfig(route, routeConfig.baseUrl, model),
      },
    };

    if (providers?.[routeConfig.providerId]) {
      await providersApi.update(provider, "codex", routeConfig.providerId);
    } else {
      await providersApi.add(provider, "codex");
    }

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
    return result;
  };

  const syncGeminiBusinessProvider = async (
    route: GeminiBusinessRoute,
    apiKey: string,
    model: string,
  ) => {
    const routeConfig = GEMINI_ROUTE_CONFIG[route];
    const provider: Provider = {
      id: routeConfig.providerId,
      name: routeConfig.providerName,
      websiteUrl: routeConfig.websiteUrl,
      category: "custom",
      icon: "gemini",
      iconColor: "#DB2777",
      notes: "由兔子业务一键接入自动生成",
      meta: {
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

    if (providers?.[routeConfig.providerId]) {
      await providersApi.update(provider, "gemini", routeConfig.providerId);
    } else {
      await providersApi.add(provider, "gemini");
    }

    await providersApi.switch(routeConfig.providerId, "gemini");
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
            onClick={() => void loadStatus()}
            disabled={!!runningAction}
            className="self-start"
          >
            {lastRefreshedAt
              ? `刷新状态 · ${new Date(lastRefreshedAt).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}`
              : "刷新状态"}
          </Button>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-6 text-sm text-muted-foreground">
            正在读取当前配置状态...
          </div>
        ) : null}

        {pageError ? (
          <div className="rounded-2xl border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            {pageError}
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

        <div className="grid gap-3 lg:grid-cols-3">
          <JourneyStep
            step="第一步"
            title="选择最适合的线路"
            description={
              isOpenClaw
                ? "根据你的使用场景，选择 tuzi 或 gac，以及 Claude 或 Codex 方向。"
                : "根据你的账号和使用方式，先确定要接入的业务线路。"
            }
          />
          <JourneyStep
            step="第二步"
            title="输入 Key 一键完成设置"
            description="只需要输入对应 Key，应用会自动完成所需配置。"
          />
          <JourneyStep
            step="第三步"
            title="确认已可正常使用"
            description="配置完成后，可直接查看当前线路和接入状态，确认已经可以开始使用。"
          />
        </div>

        <div className="rounded-2xl border border-white/60 bg-white/65 px-4 py-4 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                推荐使用方式
              </div>
              <div className="text-sm text-muted-foreground">
                {recommendedAction}
              </div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-200/70 bg-orange-50/80 px-3 py-1 text-xs text-orange-700">
              <Route className="h-3.5 w-3.5" />
              选择线路后即可快速开始
            </div>
          </div>
        </div>

        {isClaude && claudeStatus ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <Stat label="当前线路" value={claudeStatus.current_route || "--"} />
              <Stat
                label="CLI 状态"
                value={claudeStatus.installed ? "已安装" : "未安装"}
              />
              <Stat label="版本" value={claudeStatus.version || "--"} />
              <Stat
                label="Base URL"
                value={getCurrentRouteBaseUrl(claudeStatus.routes)}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <div className="font-medium">Claude 路线管理</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  选择适合你的 Claude 使用方式，输入对应 Key 后即可快速完成接入。
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <RouteCard
                    title="Claude · 兔子线路"
                    description="适合希望直接接入兔子服务的使用场景。"
                    meta="Base URL: https://api.tu-zi.com"
                    status={activeClaudeRoute === "tu-zi" ? "已接入" : claudeEntryOption === "tu-zi" ? "当前选择" : "推荐"}
                    selected={claudeEntryOption === "tu-zi"}
                    onClick={() => setClaudeEntryOption("tu-zi")}
                  />
                  <RouteCard
                    title="Claude · gac 线路"
                    description="适合已经在使用 gac 服务的场景。"
                    meta="Base URL: https://gaccode.com/claudecode"
                    status={activeClaudeRoute === "gaccode" ? "已接入" : claudeEntryOption === "gaccode" ? "当前选择" : "可选"}
                    selected={claudeEntryOption === "gaccode"}
                    onClick={() => setClaudeEntryOption("gaccode")}
                  />
                  <RouteCard
                    title="兔子改版 Claude"
                    description="适合希望直接使用改版 Claude 体验的场景。"
                    meta="无需额外输入 Key，直接写入改版 Claude。"
                    status={activeClaudeRoute === "modified" ? "已接入" : claudeEntryOption === "modified" ? "当前选择" : "可选"}
                    selected={claudeEntryOption === "modified"}
                    onClick={() => setClaudeEntryOption("modified")}
                  />
                </div>
                <div className="mt-4 grid gap-3">
                  {claudeEntryOption === "gaccode" ? (
                    <Input
                      value={claudeGacKey}
                      onChange={(event) => setClaudeGacKey(event.target.value)}
                      placeholder="输入 gac API Key"
                    />
                  ) : claudeEntryOption === "tu-zi" ? (
                    <Input
                      value={claudeTuziKey}
                      onChange={(event) => setClaudeTuziKey(event.target.value)}
                      placeholder="输入兔子 API Key"
                    />
                  ) : (
                    <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
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
                        : "写入兔子 Claude 线路"
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

              <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 p-4">
                <div className="font-medium">使用与升级</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  已为你保留当前线路的升级入口，后续可直接升级当前使用方式。
                </div>
                <div className="mt-4 rounded-xl border border-border/60 bg-background/70 px-3 py-3 text-sm text-muted-foreground">
                  配置完成后，下方会直接出现对应的 Claude 入口卡片。
                </div>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void runAction("claude-upgrade", () =>
                      installerApi.upgradeClaudeCode(
                        claudeStatus.current_route === "改版"
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

        {isCodex && codexStatus ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <Stat
                label="当前线路"
                value={getCodexRouteDisplay(codexStatus)}
              />
              <Stat
                label="CLI 状态"
                value={codexStatus.installed ? "已安装" : "未安装"}
              />
              <Stat label="版本" value={codexStatus.version || "--"} />
              <Stat
                label="Base URL"
                value={getCurrentRouteBaseUrl(codexStatus.routes)}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <div className="font-medium">Codex 路线管理</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  选择适合你的 Codex 使用方式，输入对应 Key 后即可快速完成接入。
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <RouteCard
                    title="Codex · 兔子主线路"
                    description="适合直接接入兔子主服务，和 Claude 兔子线路保持一致。"
                    meta="Base URL 走 https://api.tu-zi.com/v1，推荐主模型 gpt-5.4。"
                    status={codexStatus.current_route === "tuzi" ? "已接入" : codexEntryOption === "tuzi" ? "当前选择" : "推荐"}
                    selected={codexEntryOption === "tuzi"}
                    tone="sky"
                    onClick={() => setCodexEntryOption("tuzi")}
                  />
                  <RouteCard
                    title="Codex · 兔子 Coding 特别线路"
                    description="适合单独使用 coding 业务线的 Codex 场景。"
                    meta="Base URL 走 https://coding.tu-zi.com。"
                    status={codexStatus.current_route === "codex" ? "已接入" : codexEntryOption === "tuzi-coding" ? "当前选择" : "可选"}
                    selected={codexEntryOption === "tuzi-coding"}
                    tone="sky"
                    onClick={() => setCodexEntryOption("tuzi-coding")}
                  />
                  <RouteCard
                    title="Codex · gac 线路"
                    description="适合已有 gac 使用基础或迁移场景。"
                    meta="沿用 gac 路线配置。"
                    status={codexStatus.current_route === "gac" && codexStatus.install_type !== "gac" ? "已接入" : codexEntryOption === "gac" ? "当前选择" : "可选"}
                    selected={codexEntryOption === "gac"}
                    tone="sky"
                    onClick={() => setCodexEntryOption("gac")}
                  />
                  <RouteCard
                    title="gac 改版 Codex"
                    description="适合希望直接使用 gac 改版体验的场景。"
                    meta="直接落地 gac 改版 Codex。"
                    status={codexStatus.install_type === "gac" ? "已接入" : codexEntryOption === "gac-modified" ? "当前选择" : "可选"}
                    selected={codexEntryOption === "gac-modified"}
                    tone="sky"
                    onClick={() => setCodexEntryOption("gac-modified")}
                  />
                </div>
                <div className="mt-4 grid gap-3">
                  {codexEntryOption !== "gac-modified" ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <Input
                        value={codexApiKey}
                        onChange={(event) => setCodexApiKey(event.target.value)}
                        placeholder={`输入${codexEntryOption === "gac" ? "gac" : "兔子"} API Key`}
                      />
                      <Input
                        value={codexModel}
                        onChange={(event) => setCodexModel(event.target.value)}
                        placeholder="模型，如 gpt-5.4"
                      />
                      <Input
                        value={codexReasoning}
                        onChange={(event) => setCodexReasoning(event.target.value)}
                        placeholder="推理强度，如 medium"
                      />
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
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
                        ? "写入兔子 Codex 主线路"
                        : codexEntryOption === "tuzi-coding"
                          ? "写入兔子 Coding 特别线路"
                          : "写入 gac Codex 路线"
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

              <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 p-4">
                <div className="font-medium">使用与升级</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  已为你保留当前线路的升级入口，后续可直接升级当前使用方式。
                </div>
                <div className="mt-4 rounded-xl border border-border/60 bg-background/70 px-3 py-3 text-sm text-muted-foreground">
                  配置完成后，下方会直接出现对应的 Codex 入口卡片。
                </div>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void runAction("codex-upgrade", () =>
                      installerApi.upgradeCodex(
                        codexStatus.install_type === "gac" ? "gac" : "openai",
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

        {isGemini && geminiStatus ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <Stat
                label="当前线路"
                value={getGeminiRouteDisplay(geminiStatus)}
              />
              <Stat
                label="CLI 状态"
                value={getGeminiCliStatusLabel(geminiStatus)}
              />
              <Stat label="版本" value={geminiStatus.version || "--"} />
              <Stat
                label="Base URL"
                value={
                  geminiStatus.env_summary.google_gemini_base_url ||
                  getCurrentRouteBaseUrl(geminiStatus.routes)
                }
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <div className="font-medium">Gemini 路线管理</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  选择适合你的 Gemini 使用方式，输入对应 Key 后即可快速完成接入。
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <RouteCard
                    title="Gemini · 兔子线路"
                    description="原版 Gemini CLI 搭配兔子 API，适合希望保留原版体验的场景。"
                    meta="Base URL 走 https://api.tu-zi.com，推荐模型 gemini-2.5-pro。"
                    status={geminiStatus.current_route === "tuzi" ? "已接入" : geminiEntryOption === "tuzi" ? "当前选择" : "推荐"}
                    selected={geminiEntryOption === "tuzi"}
                    tone="pink"
                    onClick={() => setGeminiEntryOption("tuzi")}
                  />
                  <RouteCard
                    title="gac 改版 Gemini"
                    description="适合直接使用 gac 改版 Gemini 方案的场景。"
                    meta="直接落地 gac 改版 Gemini。"
                    status={geminiStatus.install_type === "gac" ? "已接入" : geminiEntryOption === "gac-modified" ? "当前选择" : "可选"}
                    selected={geminiEntryOption === "gac-modified"}
                    tone="pink"
                    onClick={() => setGeminiEntryOption("gac-modified")}
                  />
                </div>
                <div className="mt-4 grid gap-3">
                  {geminiEntryOption !== "gac-modified" ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <Input
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
                    <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                      当前方案会直接落地 gac 改版 Gemini，不需要再填写路线 Key 或模型参数。
                      当前方案不需要额外设置，完成后即可直接开始使用。
                    </div>
                  )}
                </div>
                <ResultHint
                  target={
                    geminiEntryOption === "gac-modified"
                      ? "写入 gac 改版 Gemini"
                      : "写入原版 Gemini + 兔子 API"
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

              <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 p-4">
                <div className="font-medium">使用与升级</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  已为你保留当前线路的升级入口，后续可直接升级当前使用方式。
                </div>
                <div className="mt-4 rounded-xl border border-border/60 bg-background/70 px-3 py-3 text-sm text-muted-foreground">
                  配置完成后，下方会直接出现对应的 Gemini 入口卡片。
                </div>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void runAction("gemini-upgrade", () =>
                      installerApi.upgradeGemini(
                        geminiStatus.install_type === "gac" ? "gac" : "official",
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
                label="当前接入"
                value={
                  openclawStatus.configuredRoutes.length > 0
                    ? openclawStatus.configuredRoutes
                        .map((route) => OPENCLAW_ROUTE_CONFIG[route].label)
                        .join(" / ")
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
              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <div className="font-medium">业务线路接入</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  先选 tuzi 或 gac，再选 Claude 或 Codex 方向，系统会自动完成所需设置。
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {(
                    Object.entries(OPENCLAW_ROUTE_CONFIG) as Array<
                      [OpenClawRoute, (typeof OPENCLAW_ROUTE_CONFIG)[OpenClawRoute]]
                    >
                  ).map(([route, config]) => {
                    const isSelected = openclawRoute === route;
                    const isConfigured = openclawLiveProviderIds.includes(
                      config.providerId,
                    );
                    return (
                      <RouteCard
                        key={route}
                        title={config.optionLabel}
                        description={`${config.apiKeyLabel} / ${config.models[0]?.name}`}
                        meta={config.baseUrl}
                        status={isConfigured ? "已写入" : isSelected ? "当前选择" : "可选"}
                        selected={isSelected}
                        tone="red"
                        onClick={() => setOpenclawRoute(route)}
                      />
                    );
                  })}
                </div>
                <div className="mt-4 grid gap-3">
                  <Input
                    value={openclawApiKey}
                    onChange={(event) => setOpenclawApiKey(event.target.value)}
                    placeholder={`输入${selectedOpenClawConfig.apiKeyLabel}`}
                  />
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                    将接入
                    {` ${selectedOpenClawConfig.providerName} `}
                    ，并自动切换到对应服务线路。
                  </div>
                  <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
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

              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
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
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-3 py-2 text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" />
                    重点是尽快开始使用，而不是理解底层配置细节。
                  </div>
                  <div className="rounded-xl border border-sky-200/70 bg-sky-50/70 px-3 py-3 text-sky-900">
                    <div className="text-sm font-medium">适合的选择</div>
                    <div className="mt-2 space-y-2 text-xs leading-5">
                      <div>兔子 Claude: 更适合希望统一走兔子服务的 Claude 使用场景。</div>
                      <div>兔子 Codex: 更适合代码生成、补全和工程类工作流。</div>
                      <div>gac 线路: 更适合已有 gac 服务基础的使用场景。</div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-3">
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
