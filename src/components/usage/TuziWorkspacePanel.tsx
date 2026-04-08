import { useMemo, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  CheckCircle2,
  Coins,
  Gauge,
  Link2,
  Sparkles,
  TimerReset,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useProvidersQuery } from "@/lib/query/queries";
import { useTuziKeyUsage } from "@/lib/query/usage";
import {
  ClaudeIcon,
  CodexIcon,
  OpenClawIcon,
  TuziIcon,
} from "@/components/BrandIcons";
import type { Provider } from "@/types";

type AccessStatus = {
  id: "claude" | "codex" | "openclaw";
  title: string;
  description: string;
  route: string;
  configured: boolean;
  icon: ReactNode;
  accentClass: string;
};

type TuziKeySource = {
  key: string;
  sourceLabel: string;
};

const onboardingSteps = [
  {
    title: "先完成线路接入",
    description: "从 Claude、Codex、OpenClaw 入口完成一键配置，快速开始使用。",
  },
  {
    title: "确认当前可用状态",
    description: "查看线路、Key 来源和接入数量，确认当前设备已经可以正常使用。",
  },
  {
    title: "查看核心使用信息",
    description: "优先展示余额、已用额度和请求次数，帮助你快速了解当前使用情况。",
  },
];

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isTuziProvider(provider?: Provider): boolean {
  if (!provider) return false;

  const name = provider.name.toLowerCase();
  const metaLine = provider.meta?.businessLine;
  const settings = provider.settingsConfig || {};
  const baseUrlCandidates = [
    readString(settings?.baseUrl),
    readString(settings?.options?.baseURL),
    readString(settings?.options?.baseUrl),
    readString(settings?.env?.ANTHROPIC_BASE_URL),
    readString(settings?.env?.OPENAI_BASE_URL),
  ].filter(Boolean) as string[];

  return (
    metaLine === "tuzi" ||
    name.includes("兔子") ||
    name.includes("tuzi") ||
    baseUrlCandidates.some((url) => url.includes("api.tu-zi.com"))
  );
}

function extractProviderApiKey(provider?: Provider): string | undefined {
  if (!provider) return undefined;

  const settings = provider.settingsConfig || {};
  const candidates = [
    settings?.env?.ANTHROPIC_AUTH_TOKEN,
    settings?.env?.ANTHROPIC_API_KEY,
    settings?.env?.OPENAI_API_KEY,
    settings?.env?.CODEX_API_KEY,
    settings?.auth?.OPENAI_API_KEY,
    settings?.auth?.apiKey,
    settings?.auth?.api_key,
    settings?.options?.apiKey,
    settings?.apiKey,
  ];

  return candidates.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

function getClaudeRoute(currentProviderId: string, providerName?: string) {
  if (currentProviderId === "tuzi-claude-route" || providerName?.includes("兔子")) {
    return "兔子 Claude 线路";
  }
  return "未接入";
}

function getCodexRoute(currentProviderId: string, providerName?: string) {
  if (
    currentProviderId.includes("tuzi") ||
    providerName?.includes("兔子") ||
    providerName?.toLowerCase().includes("tuzi")
  ) {
    return "兔子 Codex 线路";
  }
  return currentProviderId ? providerName || currentProviderId : "未接入";
}

function getOpenClawRoute(providerIds: string[]) {
  if (providerIds.includes("tuzi-openclaw-codex")) return "兔子 Codex 线路";
  if (providerIds.includes("tuzi-openclaw-claude")) return "兔子 Claude 线路";
  return "未接入";
}

function formatCurrency(value?: number, symbol: string = "$") {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return `${symbol}${value.toFixed(2)}`;
}

function formatCount(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function TuziWorkspacePanel({
  refreshIntervalMs,
}: {
  refreshIntervalMs?: number;
}) {
  const { data: claudeData } = useProvidersQuery("claude");
  const { data: codexData } = useProvidersQuery("codex");
  const { data: openclawData } = useProvidersQuery("openclaw");

  const accessCards = useMemo<AccessStatus[]>(() => {
    const claudeCurrent =
      claudeData?.providers?.[claudeData.currentProviderId || ""] || undefined;
    const codexCurrent =
      codexData?.providers?.[codexData.currentProviderId || ""] || undefined;
    const openclawProviderIds = Object.keys(openclawData?.providers || {});

    return [
      {
        id: "claude",
        title: "Claude",
        description: "兔子 API 一键接入 Claude Code",
        route: getClaudeRoute(
          claudeData?.currentProviderId || "",
          claudeCurrent?.name,
        ),
        configured:
          (claudeData?.currentProviderId || "") === "tuzi-claude-route" ||
          Boolean(claudeCurrent?.name?.includes("兔子")),
        icon: <ClaudeIcon size={20} />,
        accentClass:
          "border-orange-200/70 bg-gradient-to-br from-orange-50 via-background to-amber-50",
      },
      {
        id: "codex",
        title: "Codex",
        description: "兔子 API 一键接入 Codex",
        route: getCodexRoute(
          codexData?.currentProviderId || "",
          codexCurrent?.name,
        ),
        configured:
          Boolean(codexData?.currentProviderId) &&
          getCodexRoute(codexData?.currentProviderId || "", codexCurrent?.name) !==
            "未接入",
        icon: <CodexIcon size={20} />,
        accentClass:
          "border-sky-200/70 bg-gradient-to-br from-sky-50 via-background to-blue-50",
      },
      {
        id: "openclaw",
        title: "OpenClaw",
        description: "兔子 API 快速写入 OpenClaw 业务线路",
        route: getOpenClawRoute(openclawProviderIds),
        configured:
          openclawProviderIds.includes("tuzi-openclaw-claude") ||
          openclawProviderIds.includes("tuzi-openclaw-codex"),
        icon: <OpenClawIcon size={20} />,
        accentClass:
          "border-rose-200/70 bg-gradient-to-br from-rose-50 via-background to-red-50",
      },
    ];
  }, [claudeData, codexData, openclawData]);

  const activeCount = accessCards.filter((item) => item.configured).length;
  const tuziKeySource = useMemo<TuziKeySource | null>(() => {
    const claudeCurrent =
      claudeData?.providers?.[claudeData.currentProviderId || ""] || undefined;
    if (isTuziProvider(claudeCurrent)) {
      const key = extractProviderApiKey(claudeCurrent);
      if (key) return { key, sourceLabel: "Claude 当前线路" };
    }

    const codexCurrent =
      codexData?.providers?.[codexData.currentProviderId || ""] || undefined;
    if (isTuziProvider(codexCurrent)) {
      const key = extractProviderApiKey(codexCurrent);
      if (key) return { key, sourceLabel: "Codex 当前线路" };
    }

    const openclawTuziProviders = [
      openclawData?.providers?.["tuzi-openclaw-claude"],
      openclawData?.providers?.["tuzi-openclaw-codex"],
    ];
    for (const provider of openclawTuziProviders) {
      if (isTuziProvider(provider)) {
        const key = extractProviderApiKey(provider);
        if (key) return { key, sourceLabel: "OpenClaw 兔子线路" };
      }
    }

    return null;
  }, [claudeData, codexData, openclawData]);

  const { data: tuziUsage, isLoading: tuziUsageLoading } = useTuziKeyUsage(
    tuziKeySource?.key,
    {
      enabled: Boolean(tuziKeySource?.key),
      refetchInterval: refreshIntervalMs ?? 30000,
    },
  );

  const usageSymbol = tuziUsage?.currencySymbol || "$";
  const usageNote =
    tuziUsage?.error ||
    tuziUsage?.note ||
    (tuziKeySource
      ? "当前已检测到兔子 API Key，优先同步可公开查询的额度数据。"
      : "当前还没有检测到可用的兔子 API Key，所以这里只展示接入状态。");
  const statusTone = tuziUsage?.success ? "已同步部分真实数据" : "当前以接入状态为主";

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="overflow-hidden rounded-[28px] border border-orange-200/70 bg-[radial-gradient(circle_at_top_left,_rgba(251,146,60,0.18),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_28%),linear-gradient(135deg,rgba(255,247,237,0.96),rgba(255,255,255,0.92))] shadow-sm"
      >
        <div className="grid gap-6 p-6 lg:grid-cols-[1.3fr_0.9fr]">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-300/60 bg-white/80 px-3 py-1 text-xs font-medium text-orange-700">
              <TuziIcon size={14} />
              兔子工作台
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/85 shadow-sm ring-1 ring-orange-100">
                  <TuziIcon size={32} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">
                    兔子 API 业务总览
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    这里会优先展示接入状态和关键使用信息，帮助你快速了解当前是否已经可以正常使用。
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {onboardingSteps.map((item, index) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-white/70 bg-white/70 px-4 py-4 shadow-none backdrop-blur"
                >
                  <div className="text-[11px] uppercase tracking-[0.18em] text-orange-700/80">
                    第 {index + 1} 步
                  </div>
                  <div className="mt-2 text-sm font-medium">{item.title}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {item.description}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="border-white/70 bg-white/75 shadow-none backdrop-blur">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">账户余额</span>
                    <Wallet className="h-4 w-4 text-orange-500" />
                  </div>
                  <div className="mt-3 text-3xl font-semibold">
                    {tuziUsageLoading
                      ? "--"
                      : formatCurrency(tuziUsage?.balance, usageSymbol)}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {tuziUsage?.success
                      ? "基于兔子 API Key 查询"
                      : "当前未同步到可用余额数据"}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-white/70 bg-white/75 shadow-none backdrop-blur">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">已用额度</span>
                    <Coins className="h-4 w-4 text-sky-500" />
                  </div>
                  <div className="mt-3 text-3xl font-semibold">
                    {tuziUsageLoading
                      ? "--"
                      : formatCurrency(tuziUsage?.usedAmount, usageSymbol)}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {tuziUsage?.success
                      ? "展示累计已用额度"
                      : "当前未同步到已用额度数据"}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-white/70 bg-white/75 shadow-none backdrop-blur">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">请求次数</span>
                    <Sparkles className="h-4 w-4 text-rose-500" />
                  </div>
                  <div className="mt-3 text-3xl font-semibold">
                    {tuziUsageLoading ? "--" : formatCount(tuziUsage?.requestCount)}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {tuziUsage?.success
                      ? "展示当前 Key 的累计请求数"
                      : "当前未同步到请求次数数据"}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <Card className="border-orange-200/60 bg-white/72 shadow-none backdrop-blur">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">接入状态概览</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    当前已接入 {activeCount} / 3 个业务入口
                  </div>
                </div>
                <Badge className="bg-orange-500/90 text-white hover:bg-orange-500/90">
                  {statusTone}
                </Badge>
              </div>

              <div className="mt-5 space-y-3">
                {accessCards.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/70 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-background shadow-sm">
                        {item.icon}
                      </div>
                      <div>
                        <div className="text-sm font-medium">{item.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.route}
                        </div>
                      </div>
                    </div>
                    <Badge
                      variant={item.configured ? "default" : "outline"}
                      className={
                        item.configured
                          ? "bg-emerald-500 text-white hover:bg-emerald-500"
                          : "text-muted-foreground"
                      }
                    >
                      {item.configured ? "已接入" : "待配置"}
                    </Badge>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-2xl border border-dashed border-orange-200/80 bg-orange-50/70 px-4 py-3 text-xs text-orange-900/80">
                <div className="flex items-center justify-between gap-3">
                  <span>{usageNote}</span>
                  {tuziKeySource?.sourceLabel ? (
                    <Badge variant="outline" className="border-orange-300 bg-white/80">
                      {tuziKeySource.sourceLabel}
                    </Badge>
                  ) : null}
                </div>
                {tuziUsage?.keyMasked ? (
                  <div className="mt-2 text-orange-800/70">
                    当前查询 Key：{tuziUsage.keyMasked}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">当前可查看的信息</h3>
                <p className="text-sm text-muted-foreground">
                  这里会优先展示已经可以稳定查看的信息，让你先看到真正有用的内容。
                </p>
              </div>
              <Badge variant="outline" className="bg-background/60">
                持续优化
              </Badge>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Gauge className="h-4 w-4 text-orange-500" />
                  当前已可查看
                </div>
                <div className="mt-3 text-xs leading-6 text-muted-foreground">
                  账户余额、已用额度、请求次数、工具接入状态、当前线路来源。
                </div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <TimerReset className="h-4 w-4 text-sky-500" />
                  即将补充
                </div>
                <div className="mt-3 text-xs leading-6 text-muted-foreground">
                  今日消耗、月度趋势、按天峰值、面板同款统计图和更细的业务维度。
                </div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Link2 className="h-4 w-4 text-rose-500" />
                  后续可扩展
                </div>
                <div className="mt-3 text-xs leading-6 text-muted-foreground">
                  需要后续拿到稳定鉴权或聚合接口，才能和兔子面板做更完整的真实同步。
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-dashed border-border/70 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
              后续会继续补充更多使用数据和趋势信息，让这里成为更完整的业务工作台。
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {accessCards.map((item) => (
            <Card
              key={item.id}
              className={`overflow-hidden border ${item.accentClass} shadow-sm`}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/85 shadow-sm">
                      {item.icon}
                    </div>
                    <div>
                      <div className="text-base font-semibold">{item.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.description}
                      </div>
                    </div>
                  </div>
                  {item.configured ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <Link2 className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>

                <div className="mt-5 rounded-2xl border border-white/70 bg-white/70 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    当前线路
                  </div>
                  <div className="mt-2 text-sm font-medium">{item.route}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card className="border-border/50 bg-card/40 backdrop-blur-sm">
        <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold">更多能力将陆续补充</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              后续会继续补充更完整的消耗趋势和账户信息，让你在这里看到更全面的使用情况。
            </p>
          </div>
          <Button variant="outline" disabled className="gap-2 self-start md:self-auto">
            更多内容敬请期待
            <ArrowUpRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
