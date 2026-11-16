import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  claudeDesktopLocal,
  type ClaudeLocalAction,
} from "@/lib/api/claudeDesktopLocal";

export function ClaudeLocalPanel({ providerId }: { providerId?: string }) {
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
    onError: (error) => toast.error(String(error)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["claude-local"] });
    },
  });
  if (query.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("claudeLocal.statusError")}
      </p>
    );
  if (!query.data?.enabled) return null;
  const status = query.data;
  const core = status.core;
  const active = Boolean(
    status.boundProvider || status.recoveryRequired || core?.running,
  );
  const state = status.recoveryRequired
    ? "recovery"
    : core?.connected
      ? "connected"
      : core?.running
        ? "running"
        : "idle";
  return (
    <section
      className="rounded-xl border border-border bg-card p-4 space-y-3"
      aria-label={t("claudeLocal.title")}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">{t("claudeLocal.title")}</h3>
        <span className="text-xs text-muted-foreground" role="status">
          {t(`claudeLocal.${state}`)}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("claudeLocal.description")}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("claudeLocal.requirements", {
          version: core?.version || "—",
          certificate: t(
            core?.caTrusted ? "claudeLocal.trusted" : "claudeLocal.untrusted",
          ),
          node: t(
            core?.nodeAvailable ? "claudeLocal.ready" : "claudeLocal.missing",
          ),
        })}
      </p>
      {status.boundProvider && (
        <p className="text-sm">
          {t("claudeLocal.bound", { name: status.boundProvider })}
        </p>
      )}
      <p className="text-xs break-all text-muted-foreground">
        {status.profileDir}
      </p>
      <div className="flex flex-wrap gap-2">
        {(["prepare", "trust", "launch", "stop", "untrust"] as const).map(
          (name) => (
            <Button
              key={name}
              size="sm"
              variant={name === "launch" ? "default" : "outline"}
              disabled={
                action.isPending ||
                (name !== "stop" && active) ||
                (name === "launch" &&
                  (!providerId ||
                    !core?.caTrusted ||
                    !core.nodeAvailable ||
                    core.claudeRunning))
              }
              onClick={() => action.mutate(name)}
            >
              {t(`claudeLocal.${name}`)}
            </Button>
          ),
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("claudeLocal.stopHint")}
      </p>
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
