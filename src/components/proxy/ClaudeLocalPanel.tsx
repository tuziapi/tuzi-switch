import { useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Provider } from "@/types";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { settingsApi } from "@/lib/api/settings";
import { providersApi } from "@/lib/api/providers";
import { ClaudeGatewayWizard } from "./ClaudeGatewayWizard";
import { configuredModels } from "@/lib/claudeDesktopModels";
import {
  claudeDesktopLocal,
  type ClaudeLocalAction,
} from "@/lib/api/claudeDesktopLocal";

interface ClaudeLocalPanelProps {
  providerId?: string;
  providers?: (Pick<Provider, "id" | "name"> &
    Partial<Pick<Provider, "meta" | "settingsConfig">>)[];
  providersLoading?: boolean;
  switchingProviderId?: string;
  onSelectProvider?: (id: string) => void;
  onAddProvider?: () => void;
  onEditProvider?: (id: string) => void;
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
  onEditProvider,
  children,
  expandProviders = false,
}: ClaudeLocalPanelProps) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [mode, setMode] = useState<"normal" | "guided">(() => {
    try {
      return localStorage.getItem("claude-desktop-configuration-mode") ===
        "normal"
        ? "normal"
        : "guided";
    } catch {
      return "guided";
    }
  });
  const query = useQuery({
    queryKey: ["claude-local"],
    queryFn: claudeDesktopLocal.status,
    refetchInterval: 8000,
    retry: false,
  });
  const action = useMutation({
    mutationFn: (name: ClaudeLocalAction) =>
      claudeDesktopLocal.action(name, providerId),
    onSuccess: (value, name) => {
      client.setQueryData(["claude-local"], value);
      if (name === "launch") toast.success(t("claudeLocal.launchRequested"));
      if (name === "prepare_connection")
        toast.success(t("claudeLocal.connectionPrepared"));
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["claude-local"] });
      void client.invalidateQueries({ queryKey: ["claudeDesktopStatus"] });
      void client.invalidateQueries({ queryKey: ["proxyStatus"] });
    },
  });
  const [installPromptDismissed, setInstallPromptDismissed] = useState(false);
  const installation = useQuery({
    queryKey: ["officialClaudeDesktopInstallation"],
    queryFn: claudeDesktopLocal.officialInstallation,
    enabled: query.data?.enabled === true,
    retry: false,
  });
  const gateway = useQuery({
    queryKey: ["claudeDesktopStatus"],
    queryFn: () => providersApi.getClaudeDesktopStatus(),
    enabled: query.data?.enabled === true && mode === "guided",
    refetchInterval: mode === "guided" ? 5000 : false,
    retry: false,
  });
  const modelsSignature = configuredModels(
    providers.find((provider) => provider.id === providerId),
  ).join("\n");
  useEffect(() => {
    action.reset();
    void client.invalidateQueries({ queryKey: ["claudeDesktopStatus"] });
  }, [providerId, modelsSignature, client]);
  const openDownload = () => {
    void settingsApi
      .openExternal("https://claude.com/")
      .catch(() => toast.error(t("claudeLocal.downloadError")));
  };
  const recheckInstallation = async () => {
    void query.refetch();
    const result = await installation.refetch();
    if (result.isError || result.data == null) {
      toast.error(t("claudeLocal.gatewayDetectionError"));
    } else if (result.data) {
      toast.success(t("claudeLocal.installationConfirmed"));
    } else {
      setInstallPromptDismissed(false);
    }
  };
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
  const installDialog = (
    <ConfirmDialog
      isOpen={
        installation.isSuccess &&
        installation.data === false &&
        !installPromptDismissed
      }
      variant="info"
      title={t("claudeLocal.installTitle")}
      message={t("claudeLocal.installMessage")}
      confirmText={t("claudeLocal.downloadLink")}
      onCancel={() => setInstallPromptDismissed(true)}
      onConfirm={() => {
        setInstallPromptDismissed(true);
        openDownload();
      }}
    />
  );
  const busy =
    action.isPending ||
    importing.isPending ||
    providersLoading ||
    Boolean(switchingProviderId);
  const desktopRunning =
    status.desktopRunning ?? status.core?.claudeRunning ?? null;
  const official = providerId === "claude-desktop-official";
  const connectionReady =
    gateway.isSuccess &&
    gateway.data.supported &&
    (official
      ? !gateway.data.appliedId && !gateway.data.configured
      : gateway.data.configured &&
        Boolean(gateway.data.appliedId) &&
        Boolean(gateway.data.expectedBaseUrl) &&
        gateway.data.expectedBaseUrl === gateway.data.actualBaseUrl &&
        !gateway.data.staleRawModels &&
        !gateway.data.missingRouteMappings &&
        (gateway.data.mode !== "proxy" || gateway.data.proxyRunning));
  const error = action.error || importing.error;
  const errorMessage = error ? (
    <p role="alert" className="mt-3 text-sm text-destructive">
      {String(error)}
    </p>
  ) : null;
  const utilities = (
    <div className="space-y-3">
      <p role="status" className="text-sm text-muted-foreground">
        {installation.isFetching
          ? t("claudeLocal.loadingPanel")
          : installation.isError || installation.data == null
            ? t("claudeLocal.gatewayDetectionError")
            : installation.data
              ? t("claudeLocal.gatewayHint")
              : t("claudeLocal.installMessage")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy || installation.isFetching}
          onClick={() => void recheckInstallation()}
        >
          {t("claudeLocal.recheckInstallation")}
        </Button>
        <Button variant="link" onClick={openDownload}>
          {t("claudeLocal.downloadLink")}
        </Button>
      </div>
      {!status.recoveryRequired && mode === "normal" && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={importing.isPending}
            onClick={() => importing.mutate()}
          >
            {t("claudeLocal.importLine")}
          </Button>
          {onAddProvider && (
            <Button variant="outline" onClick={onAddProvider}>
              {t("claudeLocal.addLine")}
            </Button>
          )}
        </div>
      )}
      <details open={status.recoveryRequired || undefined}>
        <summary className="cursor-pointer text-sm">
          {t("claudeLocal.gatewayCleanup")}
        </summary>
        {status.recoveryRequired && (
          <Button
            disabled={action.isPending}
            onClick={() => action.mutate("stop")}
          >
            {t("claudeLocal.recoverAction")}
          </Button>
        )}
        <Button
          variant="outline"
          disabled={action.isPending || status.recoveryRequired}
          onClick={() => action.mutate("untrust")}
        >
          {t("claudeLocal.untrust")}
        </Button>
        {action.isSuccess &&
          (action.variables === "stop" || action.variables === "untrust") && (
            <p role="status">{t("claudeLocal.gatewayCleanupDone")}</p>
          )}
      </details>
    </div>
  );
  return (
    <div className="space-y-4">
      {installDialog}
      <div
        role="group"
        aria-label={t("claudeLocal.modeLabel")}
        className="flex flex-wrap gap-2"
      >
        {(["normal", "guided"] as const).map((value) => (
          <Button
            key={value}
            variant={mode === value ? "default" : "outline"}
            aria-pressed={mode === value}
            disabled={busy}
            onClick={() => {
              setMode(value);
              action.reset();
              try {
                localStorage.setItem(
                  "claude-desktop-configuration-mode",
                  value,
                );
              } catch {}
            }}
          >
            {t(`claudeLocal.${value}Mode`)}
          </Button>
        ))}
      </div>
      {status.recoveryRequired ? (
        <div className="space-y-3 rounded-2xl border bg-card p-5">
          {utilities}
          {errorMessage}
        </div>
      ) : mode === "normal" ? (
        <>
          <div className="rounded-xl border p-4">
            {utilities}
            {errorMessage}
          </div>
          {children}
        </>
      ) : (
        <ClaudeGatewayWizard
          providerId={providerId}
          providers={providers}
          installed={installation.data === true && !installation.isError}
          installationPending={installation.isFetching}
          connectionReady={connectionReady}
          desktopRunning={desktopRunning}
          busy={busy}
          working={action.isPending}
          onSelectProvider={onSelectProvider}
          onAddProvider={onAddProvider}
          onEditProvider={onEditProvider}
          onImport={() => importing.mutate()}
          onPrepare={() => void recheckInstallation()}
          onConnect={() => action.mutate("prepare_connection")}
          onLaunch={() => action.mutate("launch")}
          expandProviders={expandProviders}
          advanced={utilities}
          error={
            errorMessage ||
            (gateway.isError ? (
              <p role="alert">{t("claudeLocal.connectionStatusError")}</p>
            ) : null)
          }
        >
          {children}
        </ClaudeGatewayWizard>
      )}
    </div>
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
