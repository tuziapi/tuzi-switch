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
  onAddProvider,
  children,
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
  const [installPromptDismissed, setInstallPromptDismissed] = useState(false);
  const installation = useQuery({
    queryKey: ["officialClaudeDesktopInstallation"],
    queryFn: claudeDesktopLocal.officialInstallation,
    enabled: query.data?.enabled === true,
    retry: false,
  });
  const openDownload = () => {
    void settingsApi
      .openExternal("https://claude.com/")
      .catch(() => toast.error(t("claudeLocal.downloadError")));
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
  return (
    <>
      {installDialog}
      <section
        className="space-y-3 rounded-2xl border bg-card p-5"
        aria-label="Claude Desktop"
      >
        <h2 className="font-semibold">Claude Desktop</h2>
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
            disabled={installation.isFetching}
            onClick={() => void installation.refetch()}
          >
            {t("claudeLocal.prepareAction")}
          </Button>
          <Button variant="link" onClick={openDownload}>
            {t("claudeLocal.downloadLink")}
          </Button>
        </div>
        {!status.recoveryRequired && (
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
            {importing.isError && <p role="alert">{String(importing.error)}</p>}
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
          {action.isError && <p role="alert">{String(action.error)}</p>}
          {action.isSuccess && (
            <p role="status">{t("claudeLocal.gatewayCleanupDone")}</p>
          )}
        </details>
      </section>
      {!status.recoveryRequired && children}
    </>
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
