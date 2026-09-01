import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { useUsageSummary } from "@/lib/query/usage";
import {
  Database,
  Activity,
  Layers,
  DollarSign,
  Gauge,
  ArrowDownToLine,
  ArrowUpFromLine,
  Info,
  Loader2,
} from "lucide-react";
import { fmtUsd, parseFiniteNumber } from "./format";
import type { UsageRangeSelection } from "@/types/usage";

export function UsageHero({
  range,
  appType,
  providerName,
  model,
  refreshIntervalMs,
}: {
  range: UsageRangeSelection;
  appType?: string;
  providerName?: string;
  model?: string;
  refreshIntervalMs: number;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useUsageSummary(
    range,
    appType,
    { providerName, model },
    { refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false },
  );
  if (isLoading)
    return (
      <Card>
        <CardContent className="flex min-h-28 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </CardContent>
      </Card>
    );
  const realTotal = data?.realTotalTokens ?? 0;
  const hitRate = Math.max(0, Math.min(1, data?.cacheHitRate ?? 0));
  const cost = parseFiniteNumber(data?.totalCost);
  const items = [
    [
      t("usage.realTotal", "真实消耗 Tokens"),
      realTotal.toLocaleString(),
      Layers,
    ],
    [
      t("usage.totalRequests"),
      (data?.totalRequests ?? 0).toLocaleString(),
      Activity,
    ],
    [t("usage.totalCost"), cost == null ? "--" : fmtUsd(cost, 4), DollarSign],
    [
      t("usage.freshInput", "新鲜输入"),
      (data?.totalInputTokens ?? 0).toLocaleString(),
      ArrowDownToLine,
    ],
    [
      t("usage.outputTokens"),
      (data?.totalOutputTokens ?? 0).toLocaleString(),
      ArrowUpFromLine,
    ],
    [
      t("usage.cacheHitRate", "缓存命中率"),
      `${(hitRate * 100).toFixed(1)}%`,
      Gauge,
    ],
    [
      t("usage.cacheReadTokens"),
      (data?.totalCacheReadTokens ?? 0).toLocaleString(),
      Database,
    ],
    [
      t("usage.cacheCreationTokens"),
      (data?.totalCacheCreationTokens ?? 0).toLocaleString(),
      Database,
    ],
  ] as const;
  const cacheNote =
    appType === "codex" || appType === "gemini"
      ? t("usage.cacheWriteNotReported")
      : appType === "all" || !appType
        ? t("usage.cacheWritePartial")
        : null;
  return (
    <Card className="border-border/50 bg-card/60">
      <CardContent className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(([label, value, Icon]) => (
            <div key={label} className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-xl font-bold tabular-nums">{value}</div>
              </div>
            </div>
          ))}
        </div>
        {cacheNote && (
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            {cacheNote}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
