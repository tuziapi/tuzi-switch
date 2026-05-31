import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { useUsageSummaryByApp } from "@/lib/query/usage";
import { cn } from "@/lib/utils";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  Info,
  Loader2,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  fmtUsd,
  formatTokensShort,
  getResolvedLang,
  parseFiniteNumber,
} from "./format";
import {
  CACHE_INCLUSIVE_APP_TYPES,
  type AppType,
  type UsageRangeSelection,
  type UsageSummary,
  type UsageSummaryByApp,
} from "@/types/usage";

interface UsageHeroProps {
  range: UsageRangeSelection;
  appType?: string;
  refreshIntervalMs: number;
}

interface TitleTheme {
  accent: string;
  iconBg: string;
}

const TITLE_THEMES: Record<AppType | "all", TitleTheme> = {
  all: { accent: "text-primary", iconBg: "bg-primary/10" },
  claude: {
    accent: "text-amber-600 dark:text-amber-400",
    iconBg: "bg-amber-500/10",
  },
  codex: {
    accent: "text-emerald-600 dark:text-emerald-400",
    iconBg: "bg-emerald-500/10",
  },
  gemini: {
    accent: "text-sky-600 dark:text-sky-400",
    iconBg: "bg-sky-500/10",
  },
};

function aggregateSummaries(items: UsageSummary[]): UsageSummary {
  let totalRequests = 0;
  let successCount = 0;
  let totalCostNum = 0;
  let input = 0;
  let output = 0;
  let cacheCreation = 0;
  let cacheRead = 0;

  for (const s of items) {
    totalRequests += s.totalRequests;
    successCount += Math.round((s.totalRequests * s.successRate) / 100);
    totalCostNum += parseFiniteNumber(s.totalCost) ?? 0;
    input += s.totalInputTokens;
    output += s.totalOutputTokens;
    cacheCreation += s.totalCacheCreationTokens;
    cacheRead += s.totalCacheReadTokens;
  }

  const cacheableInput = input + cacheCreation + cacheRead;
  return {
    totalRequests,
    totalCost: totalCostNum.toFixed(6),
    totalInputTokens: input,
    totalOutputTokens: output,
    totalCacheCreationTokens: cacheCreation,
    totalCacheReadTokens: cacheRead,
    successRate: totalRequests > 0 ? (successCount / totalRequests) * 100 : 0,
    realTotalTokens: input + output + cacheCreation + cacheRead,
    cacheHitRate: cacheableInput > 0 ? cacheRead / cacheableInput : 0,
  };
}

function pickSummary(
  apps: UsageSummaryByApp[],
  appType: string | undefined,
): UsageSummary | undefined {
  if (apps.length === 0) return undefined;
  if (appType) {
    return apps.find((a) => a.appType === appType)?.summary;
  }
  return aggregateSummaries(apps.map((a) => a.summary));
}

type CacheWriteState = "ok" | "partial" | "na";

function deriveCacheWriteState(appTypes: string[]): CacheWriteState {
  if (appTypes.length === 0) return "ok";
  const inclusive = appTypes.filter((t) =>
    CACHE_INCLUSIVE_APP_TYPES.has(t),
  ).length;
  if (inclusive === appTypes.length) return "na";
  if (inclusive === 0) return "ok";
  return "partial";
}

export function UsageHero({
  range,
  appType,
  refreshIntervalMs,
}: UsageHeroProps) {
  const { t, i18n } = useTranslation();
  const lang = getResolvedLang(i18n);

  const { data, isLoading } = useUsageSummaryByApp(range, {
    refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
  });

  const allApps = data ?? [];
  const summary = pickSummary(allApps, appType);

  const titleTheme =
    TITLE_THEMES[(appType ?? "all") as keyof typeof TITLE_THEMES] ??
    TITLE_THEMES.all;
  const appLabel =
    appType && appType in TITLE_THEMES ? t(`usage.appFilter.${appType}`) : null;

  const cacheWriteState = deriveCacheWriteState(
    appType ? [appType] : allApps.map((a: UsageSummaryByApp) => a.appType),
  );

  const input = summary?.totalInputTokens ?? 0;
  const output = summary?.totalOutputTokens ?? 0;
  const cacheWrite = summary?.totalCacheCreationTokens ?? 0;
  const cacheRead = summary?.totalCacheReadTokens ?? 0;
  const realTotal = summary?.realTotalTokens ?? 0;
  const hitRate = summary?.cacheHitRate ?? 0;
  const totalCost = parseFiniteNumber(summary?.totalCost);
  const requests = summary?.totalRequests ?? 0;

  const cacheWriteDisplay = {
    value:
      cacheWriteState === "na" ? "N/A" : formatTokensShort(cacheWrite, lang),
    muted: cacheWriteState === "na",
    tooltip:
      cacheWriteState === "na"
        ? t(
            "usage.cacheWriteNotReported",
            "OpenAI 协议不区分缓存写入，仅上报缓存命中",
          )
        : cacheWriteState === "partial"
          ? t(
              "usage.cacheWritePartial",
              "部分协议（如 OpenAI）不上报缓存写入，数值可能偏低",
            )
          : undefined,
  };

  if (isLoading) {
    return (
      <Card className="border border-border/50 bg-card/40 backdrop-blur-sm">
        <CardContent className="flex items-center justify-center min-h-[200px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
        </CardContent>
      </Card>
    );
  }

  const hitPercent = Math.max(0, Math.min(100, hitRate * 100));
  const hitPercentLabel = hitPercent.toFixed(hitPercent >= 99.95 ? 0 : 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="relative overflow-hidden border border-border/50 bg-gradient-to-br from-primary/5 via-card/50 to-background/50 backdrop-blur-xl shadow-sm">
        <CardContent className="p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <div className={cn("p-2 rounded-lg", titleTheme.iconBg)}>
                <Zap className={cn("h-4 w-4", titleTheme.accent)} />
              </div>
              <span className="text-sm font-medium text-muted-foreground">
                {appLabel && (
                  <>
                    <span className={cn("font-semibold", titleTheme.accent)}>
                      {appLabel}
                    </span>
                    <span className="mx-1.5 text-muted-foreground/40">·</span>
                  </>
                )}
                {t("usage.realTotal", "真实消耗 Tokens")}
              </span>
            </div>
            <div className="flex items-center gap-4 text-right">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">
                  {t("usage.totalRequests")}
                </span>
                <span className="text-sm font-semibold flex items-center gap-1 justify-end">
                  <Activity className="h-3.5 w-3.5 text-blue-500" />
                  {requests.toLocaleString()}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">
                  {t("usage.totalCost")}
                </span>
                <span className="text-sm font-semibold text-green-500">
                  {totalCost == null ? "--" : fmtUsd(totalCost, 4)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start mb-6">
            <div
              className="text-4xl md:text-5xl font-bold tracking-tight tabular-nums leading-tight"
              title={realTotal.toLocaleString()}
            >
              {realTotal.toLocaleString()}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              ≈ {formatTokensShort(realTotal, lang, 2)}{" "}
              {t("usage.tokensSuffix", "tokens")}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <MiniStat
              icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
              label={t("usage.freshInput", "新增输入")}
              value={formatTokensShort(input, lang)}
              accent="text-blue-500"
            />
            <MiniStat
              icon={<ArrowUpFromLine className="h-3.5 w-3.5" />}
              label={t("usage.output")}
              value={formatTokensShort(output, lang)}
              accent="text-purple-500"
            />
            <MiniStat
              icon={<Database className="h-3.5 w-3.5" />}
              label={t("usage.cacheWrite", "缓存写入")}
              value={cacheWriteDisplay.value}
              accent="text-amber-500"
              muted={cacheWriteDisplay.muted}
              tooltip={cacheWriteDisplay.tooltip}
            />
            <MiniStat
              icon={<Sparkles className="h-3.5 w-3.5" />}
              label={t("usage.cacheRead", "缓存命中")}
              value={formatTokensShort(cacheRead, lang)}
              accent="text-emerald-500"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {t("usage.cacheHitRate", "缓存命中率")}
              </span>
              <span className="font-semibold text-emerald-500 tabular-nums">
                {hitPercentLabel}%
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-muted/50 overflow-hidden">
              <motion.div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500/80 to-emerald-400 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${hitPercent}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

interface MiniStatProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
  tooltip?: string;
  muted?: boolean;
}

function MiniStat({
  icon,
  label,
  value,
  accent,
  tooltip,
  muted,
}: MiniStatProps) {
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border border-border/40 bg-background/40 px-3 py-2.5"
      title={tooltip}
    >
      <div
        className={`flex items-center gap-1.5 text-xs text-muted-foreground ${accent}`}
      >
        {icon}
        <span className="text-foreground/70">{label}</span>
        {tooltip && (
          <Info className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        )}
      </div>
      <div
        className={cn(
          "text-base font-semibold tabular-nums",
          muted && "text-muted-foreground/70",
        )}
      >
        {value}
      </div>
    </div>
  );
}
