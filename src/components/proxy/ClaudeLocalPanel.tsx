import { useEffect, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  Loader2,
  Monitor,
  Plus,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { providersApi } from "@/lib/api/providers";
import {
  claudeDesktopLocal,
  type ClaudeLocalAction,
} from "@/lib/api/claudeDesktopLocal";

interface ClaudeLocalPanelProps {
  providerId?: string;
  providers?: { id: string; name: string }[];
  providersLoading?: boolean;
  switchingProviderId?: string;
  onSelectProvider?: (id: string) => void;
  onAddProvider?: () => void;
  children?: ReactNode;
  expandProviders?: boolean;
}

export function ClaudeLocalPanel({
  providerId,
  providers = [],
  providersLoading = false,
  switchingProviderId,
  onSelectProvider,
  onAddProvider,
  children,
  expandProviders = false,
}: ClaudeLocalPanelProps) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["claude-local"],
    queryFn: claudeDesktopLocal.status,
    refetchInterval: 8000,
    retry: false,
  });
  const action = useMutation({
    mutationFn: (name: ClaudeLocalAction) =>
      claudeDesktopLocal.action(name, providerId),
    onSuccess: (value) => client.setQueryData(["claude-local"], value),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["claude-local"] });
    },
  });
  const importing = useMutation({
    mutationFn: () => providersApi.importClaudeDesktopFromClaude(),
    onSuccess: (count) => {
      void client.invalidateQueries({
        queryKey: ["providers", "claude-desktop"],
      });
      void client.invalidateQueries({ queryKey: ["claudeDesktopStatus"] });
      if (!count) toast.info(t("claudeLocal.importEmpty"));
    },
  });
  if (query.isPending)
    return (
      <div
        role="status"
        className="w-full rounded-2xl border p-6 text-sm text-muted-foreground"
      >
        {t("claudeLocal.loadingPanel")}
      </div>
    );
  if (query.isError)
    return (
      <div className="space-y-4">
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border p-4 text-sm"
        >
          <span>{t("claudeLocal.statusError")}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            {t("claudeLocal.retry")}
          </Button>
        </div>
        {children}
      </div>
    );
  // Normal builds without the optional core retain the existing provider UI.
  if (!query.data?.enabled) return <>{children}</>;
  const status = query.data;
  const core = status.core;
  const available = {
    voice: status.capabilities?.voiceInput ?? true,
    computer: status.capabilities?.computerUse ?? true,
    cowork: status.capabilities?.cowork ?? true,
  };
  const active = Boolean(
    status.boundProvider || status.recoveryRequired || core?.running,
  );
  const busy =
    action.isPending ||
    importing.isPending ||
    providersLoading ||
    Boolean(switchingProviderId);
  const hasProvider = Boolean(providerId);
  const prepared = Boolean(core?.caReady && core?.supported && core?.version);
  const stage = !hasProvider
    ? 0
    : !prepared || !core?.nodeAvailable
      ? 1
      : !core.caTrusted
        ? 2
        : 3;
  const state = status.recoveryRequired
    ? "recovery"
    : core?.connected
      ? "connected"
      : core?.running
        ? "running"
        : "idle";
  const primary: ClaudeLocalAction = active
    ? "stop"
    : !prepared
      ? "prepare"
      : !core?.caTrusted
        ? "trust"
        : "launch";
  const runtimeMissing = prepared && !core?.nodeAvailable;
  const externalClaude = !active && core?.claudeRunning;
  const providerName = providers.find(
    (provider) => provider.id === providerId,
  )?.name;
  const featureCount = [
    available.voice && status.options?.voiceInput,
    available.computer && status.options?.computerUse,
    available.cowork && status.options?.cowork,
  ].filter(Boolean).length;
  const hint = active
    ? "activeHint"
    : runtimeMissing
      ? "runtimeMissingHint"
      : externalClaude
        ? "closeClaudeHint"
        : ["lineHint", "prepareHint", "trustHint", "launchHint"][stage];
  const primaryLabel = active
    ? status.recoveryRequired
      ? "recoverAction"
      : "stopAction"
    : primary === "launch"
      ? "launchAction"
      : primary === "trust"
        ? "trustAction"
        : "prepareAction";
  const error = action.error || importing.error;
  const progress = Math.min(
    100,
    Math.round(
      (100 * (status.voiceDownload?.completedBytes || 0)) /
        (status.voiceDownload?.totalBytes || 1),
    ),
  );
  return (
    <section
      aria-label={t("claudeLocal.title")}
      className="w-full overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400">
              <Monitor className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Claude Desktop
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("claudeLocal.subtitle")}
              </p>
            </div>
          </div>
          <span
            role="status"
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${status.recoveryRequired ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : active ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}
          >
            {t(`claudeLocal.${state}`)}
          </span>
        </div>
        {!active && (
          <ol
            aria-label={t("claudeLocal.stepsLabel")}
            className="mt-6 grid grid-cols-4 gap-2"
          >
            {["lineStep", "prepareStep", "trustStep", "launchStep"].map(
              (step, index) => (
                <li
                  key={step}
                  aria-current={stage === index ? "step" : undefined}
                  className={`flex items-center gap-2 text-xs sm:text-sm ${index === stage ? "font-medium text-foreground" : "text-muted-foreground"}`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${index < stage ? "bg-primary/10 text-primary" : index === stage ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                  >
                    {index < stage ? (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  {t(`claudeLocal.${step}`)}
                </li>
              ),
            )}
          </ol>
        )}
        <div className="mt-6 rounded-xl bg-muted/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <label
                htmlFor="claude-local-provider"
                className="text-xs font-medium text-muted-foreground"
              >
                {t(
                  active ? "claudeLocal.sessionLine" : "claudeLocal.lineLabel",
                )}
              </label>
              {active ? (
                <p className="mt-1 break-words text-sm font-medium">
                  {status.boundProvider ||
                    providerName ||
                    t("claudeLocal.sessionLine")}
                </p>
              ) : providers.length > 0 ? (
                <select
                  id="claude-local-provider"
                  value={providerId || ""}
                  disabled={busy}
                  onChange={(event) => onSelectProvider?.(event.target.value)}
                  className="mt-1 block w-full max-w-sm rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <option value="" disabled>
                    {t("claudeLocal.chooseLine")}
                  </option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-1 text-sm font-medium">
                  {t(
                    providersLoading
                      ? "claudeLocal.loadingLines"
                      : "claudeLocal.noLine",
                  )}
                </p>
              )}
            </div>
            {!active &&
              (hasProvider || providers.length > 0) &&
              onAddProvider && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onAddProvider}
                  disabled={busy}
                >
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t("claudeLocal.addLine")}
                </Button>
              )}
          </div>
          {!active && !hasProvider && providers.length === 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => importing.mutate()}>
                {importing.isPending ? (
                  <Loader2
                    className="mr-2 h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                {t("claudeLocal.importLine")}
              </Button>
              {onAddProvider && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={onAddProvider}
                >
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t("claudeLocal.addLine")}
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
            {t(`claudeLocal.${hint}`)}
          </p>
          {(active || hasProvider || providers.length > 0) && (
            <Button
              className="shrink-0 self-start sm:self-auto"
              variant={active ? "outline" : "default"}
              disabled={
                busy ||
                (!active &&
                  (!hasProvider || runtimeMissing || Boolean(externalClaude)))
              }
              onClick={() => action.mutate(primary)}
            >
              {action.isPending ? (
                <Loader2
                  className="mr-2 h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
              ) : active ? (
                <Square className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
              ) : null}
              {t(
                action.isPending
                  ? "claudeLocal.working"
                  : `claudeLocal.${primaryLabel}`,
              )}
              {!active && !action.isPending && (
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="mt-4 break-words rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
          >
            {String(error)}
          </p>
        )}
        {active && core?.warning && (
          <p
            role="alert"
            className="mt-3 break-words text-sm text-amber-700 dark:text-amber-400"
          >
            {core.warning}
          </p>
        )}
      </div>
      <div className="divide-y divide-border/60 border-t border-border/60">
        <details className="group px-5 sm:px-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              <SlidersHorizontal
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              {t("claudeLocal.optionalFeatures")}
            </span>
            <span className="flex items-center gap-3 text-xs text-muted-foreground">
              {t(
                featureCount
                  ? "claudeLocal.featuresEnabled"
                  : "claudeLocal.featuresOptional",
                { count: featureCount },
              )}
              <ChevronDown
                className="h-4 w-4 transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </span>
          </summary>
          <div className="space-y-4 pb-5">
            {(
              [
                ["voice", status.options?.voiceInput],
                ["computer", status.options?.computerUse],
                ["cowork", status.options?.cowork],
              ] as const
            ).map(([feature, checked]) => (
              <div
                key={feature}
                className="flex items-center justify-between gap-4"
              >
                <div>
                  <label
                    htmlFor={`claude-local-${feature}`}
                    className="text-sm font-medium"
                  >
                    {t(`claudeLocal.${feature}`)}
                  </label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t(
                      !available[feature]
                        ? "claudeLocal.unsupportedFeature"
                        : feature === "voice" &&
                            checked &&
                            !status.voiceModelReady
                          ? "claudeLocal.voicePendingDescription"
                          : `claudeLocal.${feature}Description`,
                    )}
                  </p>
                </div>
                <Switch
                  id={`claude-local-${feature}`}
                  checked={available[feature] && Boolean(checked)}
                  disabled={!available[feature] || active || busy}
                  onCheckedChange={(checked) =>
                    action.mutate(
                      `${checked ? "enable" : "disable"}_${feature}`,
                    )
                  }
                />
              </div>
            ))}
            {available.voice && !status.voiceModelReady && (
              <Button
                size="sm"
                variant="outline"
                disabled={
                  active ||
                  busy ||
                  status.voiceDownload?.phase === "downloading"
                }
                onClick={() => action.mutate("prepare_voice")}
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                {t("claudeLocal.prepareVoice")}
              </Button>
            )}
            {status.voiceDownload?.phase === "downloading" && (
              <p role="status" className="text-xs text-muted-foreground">
                {t("claudeLocal.voiceProgress", { percent: progress })}
              </p>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t(
                status.capabilities?.platform === "linux"
                  ? "claudeLocal.linuxHint"
                  : "claudeLocal.capabilityHint",
              )}
            </p>
          </div>
        </details>
        {providers.length > 0 && children && (
          <details
            className="group px-5 sm:px-6"
            open={active ? false : expandProviders || undefined}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm [&::-webkit-details-marker]:hidden">
              {t("claudeLocal.manageLines")}
              <ChevronDown
                className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="pb-5">
              {active ? (
                <p className="text-sm text-muted-foreground">
                  {t("claudeLocal.manageAfterStop")}
                </p>
              ) : (
                children
              )}
            </div>
          </details>
        )}
        <details className="group px-5 sm:px-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden">
            {t("claudeLocal.advanced")}
            <ChevronDown
              className="h-4 w-4 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="space-y-3 pb-5 text-xs text-muted-foreground">
            <p>
              {t("claudeLocal.requirements", {
                version: core?.version || "—",
                certificate: t(
                  core?.caTrusted
                    ? "claudeLocal.trusted"
                    : "claudeLocal.untrusted",
                ),
                node: t(
                  core?.nodeAvailable
                    ? "claudeLocal.ready"
                    : "claudeLocal.missing",
                ),
              })}
            </p>
            <p className="break-all">{status.profileDir}</p>
            {!active && core?.warning && <p>{core.warning}</p>}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={active || busy}
                onClick={() => action.mutate("prepare")}
              >
                {t("claudeLocal.repairResources")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={active || busy || !core?.caReady}
                onClick={() => action.mutate("untrust")}
              >
                {t("claudeLocal.untrust")}
              </Button>
            </div>
            <p className="leading-relaxed">{t("claudeLocal.stopHint")}</p>
            <p>{t("claudeLocal.testingNote")}</p>
          </div>
        </details>
      </div>
    </section>
  );
}

export function useClaudeLocalExitNotice() {
  useEffect(() => {
    const off = listen<string>("claude-local-exit-blocked", (event) =>
      toast.warning(event.payload, { duration: 8000 }),
    );
    return () => {
      void off.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
}
