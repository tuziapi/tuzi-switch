import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { aggregationApi } from "@/lib/api/aggregation";
import { AggregationDialog } from "./AggregationDialog";
import type { AppId } from "@/lib/api";
import type { Provider } from "@/types";
import { useTranslation } from "react-i18next";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { ProviderConnectionBar } from "./ProviderConnectionBar";

export function ProviderConnectionControls({
  appId,
  providers,
  currentProviderId,
  routeEnabled,
  onOpenSettings,
}: {
  appId: AppId;
  providers: Record<string, Provider>;
  currentProviderId: string;
  routeEnabled: boolean;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const proxy = useProxyStatus();
  const client = useQueryClient();
  const [aggregationOpen, setAggregationOpen] = useState(false);
  const supportsAggregation = appId === "claude" || appId === "codex";
  const aggregation = useQuery({
    queryKey: ["aggregation", appId],
    queryFn: () => aggregationApi.read(appId),
    enabled: supportsAggregation,
    retry: false,
    refetchInterval: (query) => (query.state.data?.enabled ? 2000 : false),
  });
  const exit = useMutation({
    mutationFn: async (next: "direct" | "route") => {
      await aggregationApi.apply(appId, aggregation.data!.plan, false);
      await client.invalidateQueries({ queryKey: ["aggregation", appId] });
      if (next === "direct")
        await proxy.setTakeoverForApp({ appType: appId, enabled: false });
      await client.invalidateQueries({ queryKey: ["proxyStatus"] });
    },
  });
  const ready =
    !proxy.isLoading &&
    !proxy.isTakeoverLoading &&
    !!proxy.status &&
    !!proxy.takeoverStatus &&
    !proxy.error &&
    (!supportsAggregation || !!aggregation.data) &&
    !aggregation.error;
  const routed = !!proxy.takeoverStatus?.[appId];
  const mode = ready
    ? aggregation.data?.enabled
      ? "aggregate"
      : routed
        ? "route"
        : "direct"
    : "unknown";
  const target = proxy.status?.active_targets?.find(
    (target) => target.app_type === appId,
  );
  const currentName = providers[currentProviderId]?.name;
  const status = !ready
    ? t(
        proxy.error || aggregation.error
          ? "connectionMode.failed"
          : "connectionMode.loading",
      )
    : aggregation.data?.needsRecovery
      ? t("aggregation.recovery")
      : aggregation.data?.enabled && !proxy.isRunning
        ? t("connectionMode.stopped")
        : aggregation.data?.enabled
          ? t("aggregation.active", {
              name:
                providers[aggregation.data.plan.defaultProviderId]?.name ?? "",
            })
          : routed
            ? !proxy.isRunning
              ? t("connectionMode.stopped")
              : target
                ? t("connectionMode.routed", { name: target.provider_name })
                : t("connectionMode.routeReady")
            : currentName
              ? t("connectionMode.directActive", { name: currentName })
              : t("connectionMode.noProvider");

  return (
    <>
      <ProviderConnectionBar
        mode={mode}
        status={status}
        busy={proxy.isPending || exit.isPending}
        unavailable={!ready}
        onOpenSettings={onOpenSettings}
        aggregationSupported={supportsAggregation}
        onOpenAggregation={
          supportsAggregation
            ? () => (routeEnabled ? setAggregationOpen(true) : onOpenSettings())
            : undefined
        }
        onChange={(next) => {
          if (next === "route" && !routeEnabled) {
            onOpenSettings();
            return;
          }
          if (aggregation.data?.enabled || aggregation.data?.needsRecovery) {
            exit.mutate(next);
            return;
          }
          if (next === "route" && routed && !proxy.isRunning) {
            void proxy.startProxyServer().catch(() => {});
            return;
          }
          if ((next === "route") === routed) return;
          // Native command owns backup, restore and startup. Keep its error handling.
          void proxy
            .setTakeoverForApp({ appType: appId, enabled: next === "route" })
            .catch(() => {});
        }}
      />
      {exit.error && (
        <p role="alert" className="text-xs text-destructive mb-2">
          {t("aggregation.failed")}
        </p>
      )}
      {aggregationOpen && aggregation.data && (
        <AggregationDialog
          appId={appId}
          providers={providers}
          currentProviderId={currentProviderId}
          state={aggregation.data}
          onClose={() => setAggregationOpen(false)}
        />
      )}
    </>
  );
}
