import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ExternalLink, Loader2, Rabbit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { officialMcpApi } from "@/lib/api/officialMcp";

const phases = new Set([
  "preparing",
  "configuring",
  "authorizing",
  "checking",
  "connected",
  "configured",
  "not_configured",
]);
const errors = new Set([
  "codex_missing",
  "codex_not_initialized",
  "codex_upgrade_required",
  "codex_unavailable",
  "codex_protocol_error",
  "config_conflict",
  "config_home_mismatch",
  "authorization_failed",
  "authorization_url_rejected",
  "browser_failed",
  "verification_failed",
  "request_failed",
  "timeout",
  "cancelled",
  "not_configured",
  "server_upgrade_required",
  "service_unavailable",
  "busy",
  "local_error",
]);

export function OfficialTuziMcpCard() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState(false);
  const status = useQuery({
    queryKey: ["official-tuzi-mcp"],
    queryFn: officialMcpApi.status,
    // Polling only reads local status; network checks require the user's button.
    refetchInterval: (q) => (q.state.data?.busy ? 800 : 5000),
    refetchIntervalInBackground: true,
    retry: false,
  });
  const data = status.data;
  useEffect(() => {
    if (data && !data.busy)
      void client.invalidateQueries({ queryKey: ["mcp", "all"] });
  }, [client, data?.busy, data?.configured]);
  const busy = pending || !!data?.busy;
  const phase = data && phases.has(data.phase) ? data.phase : "not_configured";
  const connected =
    phase === "connected" && !!data?.checkedAt && !data?.accountMismatch;
  const error =
    data?.error && errors.has(data.error)
      ? data.error
      : data?.error
        ? "local_error"
        : null;

  const act = async (operation: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setLocalError(false);
    try {
      await operation();
    } catch {
      setLocalError(true);
    } finally {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["official-tuzi-mcp"] }),
        client.invalidateQueries({ queryKey: ["mcp", "all"] }),
      ]);
      setPending(false);
    }
  };

  return (
    <section
      aria-labelledby="official-tuzi-mcp-title"
      className="mb-5 rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/5 via-background to-background p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div className="rounded-xl bg-blue-500/10 p-2.5 text-blue-600">
            <Rabbit size={22} />
          </div>
          <div>
            <h2
              id="official-tuzi-mcp-title"
              className="text-base font-semibold"
            >
              {t("officialMcp.title")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("officialMcp.description")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border px-2 py-0.5">Codex</span>
              <code className="break-all">https://api.tu-zi.com/mcp</code>
            </div>
          </div>
        </div>
        <div
          role="status"
          className={`flex items-center gap-1.5 text-sm ${connected ? "text-emerald-600" : "text-muted-foreground"}`}
        >
          {busy ? (
            <Loader2 size={15} className="animate-spin" />
          ) : connected ? (
            <CheckCircle2 size={15} />
          ) : null}
          {t(
            `officialMcp.phases.${data?.accountMismatch ? "account_mismatch" : phase}`,
          )}
        </div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        {t("officialMcp.steps")}
      </p>
      {data?.assistantAccountName && (
        <p className="mt-2 text-sm">
          {t("officialMcp.assistantAccount", {
            name: data.assistantAccountName,
          })}
        </p>
      )}
      {data?.accountName && (
        <p className="mt-1 text-sm">
          {t("officialMcp.authorizedAccount", { name: data.accountName })}
        </p>
      )}
      {data?.accountMismatch && (
        <p role="alert" className="mt-2 text-sm text-amber-600">
          {t("officialMcp.mismatch")}
        </p>
      )}
      {(error || status.isError || localError) && (
        <p role="alert" className="mt-3 text-sm text-amber-600">
          {t(
            `officialMcp.errors.${localError || status.isError ? "local_error" : error}`,
          )}
        </p>
      )}
      {connected && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("officialMcp.verified", {
            time: new Date(data!.checkedAt! * 1000).toLocaleString(),
          })}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={busy || status.isLoading}
          onClick={() => void act(() => officialMcpApi.start("connect"))}
        >
          {t(
            data?.configured
              ? "officialMcp.reauthorize"
              : "officialMcp.connect",
          )}
        </Button>
        {data?.configured && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void act(() => officialMcpApi.start("check"))}
          >
            {t("officialMcp.check")}
          </Button>
        )}
        {data?.busy && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void act(officialMcpApi.cancel)}
          >
            {t("officialMcp.cancel")}
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => void act(officialMcpApi.manage)}
        >
          <ExternalLink size={14} className="mr-1.5" />
          {t("officialMcp.manage")}
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {t("officialMcp.note")}
      </p>
    </section>
  );
}
