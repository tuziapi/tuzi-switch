import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UsageSummaryCards } from "./UsageSummaryCards";
import { UsageTrendChart } from "./UsageTrendChart";
import { RequestLogTable } from "./RequestLogTable";
import { ProviderStatsTable } from "./ProviderStatsTable";
import { ModelStatsTable } from "./ModelStatsTable";
import { TuziWorkspacePanel } from "./TuziWorkspacePanel";
import type { TimeRange } from "@/types/usage";
import { motion } from "framer-motion";
import {
  BarChart3,
  ListFilter,
  Activity,
  RefreshCw,
  Coins,
  Clock3,
  Radar,
  Waypoints,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { usageKeys } from "@/lib/query/usage";
import type { BusinessLineFilter } from "@/types/usage";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PricingConfigPanel } from "@/components/usage/PricingConfigPanel";

export function UsageDashboard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [timeRange, setTimeRange] = useState<TimeRange>("1d");
  const [businessLine, setBusinessLine] = useState<BusinessLineFilter>("all");
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(30000);

  const refreshIntervalOptionsMs = [0, 5000, 10000, 30000, 60000] as const;
  const changeRefreshInterval = () => {
    const currentIndex = refreshIntervalOptionsMs.indexOf(
      refreshIntervalMs as (typeof refreshIntervalOptionsMs)[number],
    );
    const safeIndex = currentIndex >= 0 ? currentIndex : 3; // default 30s
    const nextIndex = (safeIndex + 1) % refreshIntervalOptionsMs.length;
    const next = refreshIntervalOptionsMs[nextIndex];
    setRefreshIntervalMs(next);
    queryClient.invalidateQueries({ queryKey: usageKeys.all });
  };

  const days = timeRange === "1d" ? 1 : timeRange === "7d" ? 7 : 30;
  const timeRangeLabel =
    timeRange === "1d" ? "今天" : timeRange === "7d" ? "近 7 天" : "近 30 天";
  const businessLineLabel =
    businessLine === "all"
      ? "全部业务线路"
      : businessLine === "tuzi"
        ? "兔子线路"
        : "gac 线路";
  const refreshLabel =
    refreshIntervalMs > 0 ? `${refreshIntervalMs / 1000} 秒自动刷新` : "手动刷新";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-8 pb-8"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold">{t("usage.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("usage.subtitle")}</p>
        </div>

        <Tabs
          value={timeRange}
          onValueChange={(v) => setTimeRange(v as TimeRange)}
          className="w-full sm:w-auto"
        >
          <div className="flex w-full sm:w-auto items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-10 px-2 text-xs text-muted-foreground"
              title={t("common.refresh", "刷新")}
              onClick={changeRefreshInterval}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              {refreshIntervalMs > 0 ? `${refreshIntervalMs / 1000}s` : "--"}
            </Button>
            <TabsList className="flex h-10 w-full border border-border/50 bg-card/60 p-1 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/6 sm:w-auto">
              <TabsTrigger
                value="1d"
                className="flex-1 transition-colors hover:text-orange-500 data-[state=active]:bg-orange-500 data-[state=active]:text-white data-[state=active]:shadow-sm sm:flex-none sm:px-6 dark:data-[state=active]:bg-orange-500"
              >
                {t("usage.today")}
              </TabsTrigger>
              <TabsTrigger
                value="7d"
                className="flex-1 transition-colors hover:text-orange-500 data-[state=active]:bg-orange-500 data-[state=active]:text-white data-[state=active]:shadow-sm sm:flex-none sm:px-6 dark:data-[state=active]:bg-orange-500"
              >
                {t("usage.last7days")}
              </TabsTrigger>
              <TabsTrigger
                value="30d"
                className="flex-1 transition-colors hover:text-orange-500 data-[state=active]:bg-orange-500 data-[state=active]:text-white data-[state=active]:shadow-sm sm:flex-none sm:px-6 dark:data-[state=active]:bg-orange-500"
              >
                {t("usage.last30days")}
              </TabsTrigger>
            </TabsList>
          </div>
        </Tabs>
      </div>

      <Tabs defaultValue="tuzi-workspace" className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="border border-border/50 bg-card/60 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/6">
            <TabsTrigger className="gap-2 data-[state=active]:bg-orange-500 data-[state=active]:text-white dark:data-[state=active]:bg-orange-500" value="tuzi-workspace">
              <Coins className="h-4 w-4" />
              兔子工作台
            </TabsTrigger>
            <TabsTrigger className="gap-2 data-[state=active]:bg-orange-500 data-[state=active]:text-white dark:data-[state=active]:bg-orange-500" value="proxy-stats">
              <BarChart3 className="h-4 w-4" />
              本地代理统计
            </TabsTrigger>
          </TabsList>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">业务线路</span>
            <Tabs
              value={businessLine}
              onValueChange={(value) =>
                setBusinessLine(value as BusinessLineFilter)
              }
              className="w-auto"
            >
              <TabsList className="h-10 border border-border/50 bg-card/60 p-1 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/6">
                <TabsTrigger className="data-[state=active]:bg-orange-500 data-[state=active]:text-white dark:data-[state=active]:bg-orange-500" value="all">全部</TabsTrigger>
                <TabsTrigger className="data-[state=active]:bg-orange-500 data-[state=active]:text-white dark:data-[state=active]:bg-orange-500" value="tuzi">兔子</TabsTrigger>
                <TabsTrigger className="data-[state=active]:bg-orange-500 data-[state=active]:text-white dark:data-[state=active]:bg-orange-500" value="gac">gac</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        <TabsContent value="tuzi-workspace" className="mt-6">
          <TuziWorkspacePanel refreshIntervalMs={refreshIntervalMs} />
        </TabsContent>

        <TabsContent value="proxy-stats" className="mt-6 space-y-8">
          <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr_0.8fr]">
            <div className="rounded-3xl border border-border/60 bg-[linear-gradient(135deg,rgba(14,165,233,0.08),rgba(255,255,255,0.94))] p-5 shadow-sm dark:border-sky-400/20 dark:bg-[linear-gradient(135deg,rgba(14,165,233,0.14),rgba(20,24,33,0.94))]">
              <div className="flex items-center gap-2 text-sm font-medium text-sky-700 dark:text-sky-200">
                <Radar className="h-4 w-4" />
                本地代理统计
              </div>
              <div className="mt-3 text-sm leading-6 text-muted-foreground dark:text-white/68">
                先看整体消耗，再下钻到供应商、模型和请求明细。
              </div>
            </div>

            <div className="rounded-3xl border border-border/60 bg-card/60 p-5 shadow-sm dark:border-white/10 dark:bg-white/6">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock3 className="h-4 w-4 text-sky-500" />
                当前统计范围
              </div>
              <div className="mt-4 text-2xl font-semibold">{timeRangeLabel}</div>
              <div className="mt-2 text-sm text-muted-foreground dark:text-white/65">
                当前查看 {businessLineLabel} 的代理记录
              </div>
            </div>

            <div className="rounded-3xl border border-border/60 bg-card/60 p-5 shadow-sm dark:border-white/10 dark:bg-white/6">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Waypoints className="h-4 w-4 text-orange-500" />
                数据刷新方式
              </div>
              <div className="mt-4 text-2xl font-semibold">{refreshLabel}</div>
              <div className="mt-2 text-sm text-muted-foreground dark:text-white/65">
                适合在排查波动或观察近期消耗时使用
              </div>
            </div>
          </div>

          <UsageSummaryCards
            days={days}
            businessLine={businessLine}
            refreshIntervalMs={refreshIntervalMs}
          />

          <UsageTrendChart
            days={days}
            businessLine={businessLine}
            refreshIntervalMs={refreshIntervalMs}
          />

          <div className="space-y-4">
            <Tabs defaultValue="logs" className="w-full">
              <div className="flex items-center justify-between mb-4">
                <TabsList className="bg-muted/50 dark:bg-white/6">
                  <TabsTrigger className="gap-2 data-[state=active]:bg-orange-500 data-[state=active]:text-white dark:data-[state=active]:bg-orange-500" value="logs">
                    <ListFilter className="h-4 w-4" />
                    {t("usage.requestLogs")}
                  </TabsTrigger>
                  <TabsTrigger className="gap-2 data-[state=active]:bg-orange-500 data-[state=active]:text-white dark:data-[state=active]:bg-orange-500" value="providers">
                    <Activity className="h-4 w-4" />
                    {t("usage.providerStats")}
                  </TabsTrigger>
                  <TabsTrigger className="gap-2 data-[state=active]:bg-orange-500 data-[state=active]:text-white dark:data-[state=active]:bg-orange-500" value="models">
                    <BarChart3 className="h-4 w-4" />
                    {t("usage.modelStats")}
                  </TabsTrigger>
                </TabsList>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <TabsContent value="logs" className="mt-0">
                  <RequestLogTable
                    days={days}
                    businessLine={businessLine}
                    refreshIntervalMs={refreshIntervalMs}
                  />
                </TabsContent>

                <TabsContent value="providers" className="mt-0">
                  <ProviderStatsTable
                    days={days}
                    businessLine={businessLine}
                    refreshIntervalMs={refreshIntervalMs}
                  />
                </TabsContent>

                <TabsContent value="models" className="mt-0">
                  <ModelStatsTable
                    days={days}
                    businessLine={businessLine}
                    refreshIntervalMs={refreshIntervalMs}
                  />
                </TabsContent>
              </motion.div>
            </Tabs>
          </div>
        </TabsContent>
      </Tabs>

      {/* Pricing Configuration */}
      <Accordion type="multiple" defaultValue={[]} className="w-full space-y-4">
        <AccordionItem
          value="pricing"
          className="rounded-xl glass-card overflow-hidden"
        >
          <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
            <div className="flex items-center gap-3">
              <Coins className="h-5 w-5 text-yellow-500" />
              <div className="text-left">
                <h3 className="text-base font-semibold">
                  {t("settings.advanced.pricing.title")}
                </h3>
                <p className="text-sm text-muted-foreground font-normal">
                  {t("settings.advanced.pricing.description")}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6 pt-4 border-t border-border/50">
            <PricingConfigPanel />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </motion.div>
  );
}
