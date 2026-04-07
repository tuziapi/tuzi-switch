import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload, Wrench } from "lucide-react";
import type { AppId } from "@/lib/api";
import { providersApi } from "@/lib/api/providers";
import { installerApi, type ClaudeInstallerStatus, type CodexInstallerStatus, type InstallerActionResult } from "@/lib/api/installer";
import { openclawApi } from "@/lib/api/openclaw";
import { openclawKeys, useOpenClawAgentsDefaults, useOpenClawDefaultModel, useOpenClawHealth, useOpenClawLiveProviderIds, useOpenClawTools } from "@/hooks/useOpenClaw";
import { ClaudeIcon, CodexIcon, TuziIcon } from "@/components/BrandIcons";
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
import type { OpenClawModel, Provider } from "@/types";

type OpenClawRoute = "claude" | "codex";
type ClaudeBusinessRoute = "gaccode" | "tu-zi";
type CodexBusinessRoute = "gac" | "tuzi" | "tuzi-codex-sub";

const OPENCLAW_ROUTE_CONFIG: Record<
  OpenClawRoute,
  {
    label: string;
    providerId: string;
    providerName: string;
    baseUrl: string;
    api: string;
    models: OpenClawModel[];
  }
> = {
  claude: {
    label: "Claude 线路",
    providerId: "tuzi-openclaw-claude",
    providerName: "兔子 Claude 线路",
    baseUrl: "https://api.tu-zi.com",
    api: "anthropic-messages",
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
  codex: {
    label: "Codex 线路",
    providerId: "tuzi-openclaw-codex",
    providerName: "兔子 Codex 线路",
    baseUrl: "https://api.tu-zi.com/v1",
    api: "openai-responses",
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
  { value: "tuzi", label: "兔子 API 线路" },
  { value: "tuzi-codex-sub", label: "兔子Codex订阅线路" },
];

function getCodexRouteLabel(route: string | null | undefined) {
  if (!route) return "--";
  return (
    CODEX_ROUTE_OPTIONS.find((option) => option.value === route)?.label || route
  );
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

export function BusinessQuickAccess({
  appId,
  providers,
}: {
  appId: AppId;
  providers?: Record<string, Provider>;
}) {
  const isClaude = appId === "claude";
  const isCodex = appId === "codex";
  const isOpenClaw = appId === "openclaw";
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<InstallerActionResult | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeInstallerStatus | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexInstallerStatus | null>(null);
  const [claudeGacKey, setClaudeGacKey] = useState("");
  const [claudeTuziKey, setClaudeTuziKey] = useState("");
  const [codexRoute, setCodexRoute] = useState<CodexBusinessRoute>("gac");
  const [codexApiKey, setCodexApiKey] = useState("");
  const [codexModel, setCodexModel] = useState("gpt-5.4");
  const [codexReasoning, setCodexReasoning] = useState("medium");
  const [openclawRoute, setOpenclawRoute] = useState<OpenClawRoute>("claude");
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
    } catch (error) {
      setPageError(String(error));
    }
  };

  useEffect(() => {
    void (async () => {
      if (!isClaude && !isCodex && !isOpenClaw) return;
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
    if (isOpenClaw) return "OpenClaw 兔子快速接入";
    return "";
  }, [isClaude, isCodex, isOpenClaw]);

  const cardClassName = useMemo(() => {
    if (isCodex) {
      return "overflow-hidden border-sky-200/70 bg-gradient-to-br from-sky-50 via-background to-blue-50 shadow-sm dark:border-sky-500/20 dark:from-sky-500/10 dark:to-blue-500/10";
    }
    if (isOpenClaw) {
      return "overflow-hidden border-rose-200/70 bg-gradient-to-br from-rose-50 via-background to-red-50 shadow-sm dark:border-rose-500/20 dark:from-rose-500/10 dark:to-red-500/10";
    }
    return "overflow-hidden border-orange-200/70 bg-gradient-to-br from-orange-50 via-background to-amber-50 shadow-sm dark:border-orange-500/20 dark:from-orange-500/10 dark:to-amber-500/10";
  }, [isCodex, isOpenClaw]);

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

  const configureOpenClawRoute = async (
    route: OpenClawRoute,
    apiKey: string,
  ): Promise<InstallerActionResult> => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      return {
        success: false,
        message: "请先输入兔子 API Key",
        error: "MISSING_TUZI_API_KEY",
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
      message: `已为 OpenClaw 写入${routeConfig.label}，现在可以直接使用兔子 API 了。`,
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

  if (!isClaude && !isCodex && !isOpenClaw) return null;

  return (
    <Card className={cardClassName}>
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-300/60 bg-white/80 px-3 py-1 text-xs font-medium text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200">
              <TuziIcon size={14} />
              兔子一键接入
            </div>
            <div className="flex items-center gap-3">
              <div
                className={`flex items-center justify-center rounded-2xl dark:bg-black/10 ${
                  isOpenClaw
                    ? "h-12 w-12 bg-white/70 shadow-sm ring-1 ring-sky-100/80"
                    : "bg-white/80 p-3"
                }`}
              >
                {isClaude ? (
                  <ClaudeIcon size={26} />
                ) : isCodex ? (
                  <CodexIcon size={26} />
                ) : (
                  <TuziIcon size={34} className="rounded-[12px]" />
                )}
              </div>
              <div>
                <h3 className="text-xl font-semibold">{title}</h3>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => void loadStatus()}
            disabled={!!runningAction}
            className="self-start"
          >
            刷新状态
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
                value={claudeStatus.env_summary.anthropic_base_url || "--"}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr_auto]">
              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <div className="font-medium">方案 1：改版 ClaudeCode</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  适合希望尽快开始使用的客户，首次登录可走网页授权。
                </div>
                <Button
                  onClick={() =>
                    void runAction("claude-install-a", () =>
                      installerApi.installClaudeCode("A"),
                    )
                  }
                  disabled={!!runningAction}
                  className="mt-4 gap-2"
                >
                  {runningAction === "claude-install-a" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wrench className="h-4 w-4" />
                  )}
                  一键配置改版 Claude
                </Button>
              </div>

              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <div className="font-medium">方案 2：gac 订阅接入</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  让客户只输入 gac key，就自动写好 Claude 所需配置。
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <Input
                    value={claudeGacKey}
                    onChange={(event) => setClaudeGacKey(event.target.value)}
                    placeholder="输入 gac API Key"
                  />
                  <Button
                    onClick={() =>
                      void runAction("claude-install-b", () =>
                        installClaudeBusinessRoute("B", claudeGacKey),
                      )
                    }
                    disabled={!!runningAction}
                    className="gap-2"
                  >
                    {runningAction === "claude-install-b" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wrench className="h-4 w-4" />
                    )}
                    一键配置
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <div className="font-medium">方案 3：兔子 API 接入</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  让客户输入兔子 API Key 后，自动写好 Claude 所需配置。
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <Input
                    value={claudeTuziKey}
                    onChange={(event) => setClaudeTuziKey(event.target.value)}
                    placeholder="输入兔子 API Key"
                  />
                  <Button
                    onClick={() =>
                      void runAction("claude-install-c", () =>
                        installClaudeBusinessRoute("C", claudeTuziKey),
                      )
                    }
                    disabled={!!runningAction}
                    className="gap-2"
                  >
                    {runningAction === "claude-install-c" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wrench className="h-4 w-4" />
                    )}
                    一键配置
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 p-4">
                <div className="font-medium">升级当前</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  按当前线路升级，避免用户自己判断。
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
              <Stat label="当前类型" value={codexStatus.install_type || "--"} />
              <Stat
                label="CLI 状态"
                value={codexStatus.installed ? "已安装" : "未安装"}
              />
              <Stat label="版本" value={codexStatus.version || "--"} />
              <Stat
                label="当前线路"
                value={getCodexRouteLabel(codexStatus.current_route)}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr_auto]">
              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <div className="font-medium">原版 Codex + 业务线路</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  只输入 key 和线路，就自动写入 `~/.codex/config.toml` 与环境变量。
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <Select
                    value={codexRoute}
                    onValueChange={(value: CodexBusinessRoute) =>
                      setCodexRoute(value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择线路" />
                    </SelectTrigger>
                    <SelectContent>
                      {CODEX_ROUTE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={codexApiKey}
                    onChange={(event) => setCodexApiKey(event.target.value)}
                    placeholder="输入 Codex API Key"
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
                <Button
                  onClick={() =>
                    void runAction("codex-install-openai", () =>
                      installerApi.installCodex({
                        variant: "openai",
                        route: codexRoute,
                        apiKey: codexApiKey,
                        model: codexModel,
                        modelReasoningEffort: codexReasoning,
                      }),
                    )
                  }
                  disabled={!!runningAction}
                  className="mt-4 gap-2"
                >
                  {runningAction === "codex-install-openai" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wrench className="h-4 w-4" />
                  )}
                  一键配置原版 Codex
                </Button>
              </div>

              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <div className="font-medium">gac 改版 Codex</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  面向更快接入场景，无需客户自己理解 route 配置。
                </div>
                <Button
                  onClick={() =>
                    void runAction("codex-install-gac", () =>
                      installerApi.installCodex({ variant: "gac" }),
                    )
                  }
                  disabled={!!runningAction}
                  className="mt-4 gap-2"
                >
                  {runningAction === "codex-install-gac" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wrench className="h-4 w-4" />
                  )}
                  一键配置 gac Codex
                </Button>
              </div>

              <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 p-4">
                <div className="font-medium">升级当前</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  保持当前客户线路不变，只升级现有 CLI。
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

        {isOpenClaw ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <Stat
                label="已接入线路"
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
                label="配置告警"
                value={
                  openclawStatus.warningCount > 0
                    ? `${openclawStatus.warningCount} 项`
                    : "正常"
                }
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <div className="font-medium">兔子业务接入</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  输入一次兔子 API Key，就自动写好 OpenClaw 的 provider、默认模型和 coding 模式。
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <Select
                    value={openclawRoute}
                    onValueChange={(value: OpenClawRoute) => setOpenclawRoute(value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择接入线路" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="claude">Claude 线路</SelectItem>
                      <SelectItem value="codex">Codex 线路</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={openclawApiKey}
                    onChange={(event) => setOpenclawApiKey(event.target.value)}
                    placeholder="输入兔子 API Key"
                  />
                </div>
                <div className="mt-3 rounded-xl border border-border/60 bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                  当前将写入
                  {` ${OPENCLAW_ROUTE_CONFIG[openclawRoute].label} `}
                  和
                  {` ${OPENCLAW_ROUTE_CONFIG[openclawRoute].models.length} `}
                  个推荐模型，首选模型为
                  {` ${OPENCLAW_ROUTE_CONFIG[openclawRoute].models[0]?.id} `}
                  。
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
                  一键配置 OpenClaw
                </Button>
              </div>

              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <div className="font-medium">推荐说明</div>
                <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                  <div>
                    `Claude 线路` 更适合把 OpenClaw 当成 Claude 风格入口，默认写入 Claude 系列模型。
                  </div>
                  <div>
                    `Codex 线路` 更适合代码生成和补全场景，默认主模型是 `gpt-5.4`。
                  </div>
                  <div>
                    配置完成后，下面原有的 Provider、Env、Tools、Agents 面板仍然保留，方便继续深改。
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
