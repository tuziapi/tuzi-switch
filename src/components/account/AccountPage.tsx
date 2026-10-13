import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { useAccount } from "@/lib/query/account";

export const ACCOUNT_PAGES = [
  "overview",
  "keys",
  "logs",
  "modelsStatus",
  "topup",
  "redeem",
  "profile",
  "models",
] as const;
export type AccountPageId = (typeof ACCOUNT_PAGES)[number];
type AccountController = ReturnType<typeof useAccount>;

/** Only sanitized native account state crosses this boundary. Never persist it. */
export function AccountPage({ account }: { account: AccountController }) {
  const { t } = useTranslation();
  const [page, setPage] = useState<AccountPageId>("overview");
  const [busy, setBusy] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const { state, isLoading } = account;
  const [retrySeconds, setRetrySeconds] = useState(0);
  useEffect(() => {
    setRetrySeconds(Math.max(0, Math.ceil(state.error?.retryAfter ?? 0)));
  }, [state.error]);
  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = window.setTimeout(
      () => setRetrySeconds((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [retrySeconds]);
  const pending = ["authorizing", "exchanging", "verifying"].includes(
    state.status,
  );
  const connected = ["connected", "refreshing", "offline"].includes(
    state.status,
  );
  const policyError = [
    "insufficient_scope",
    "unsupported_contract",
    "account_disabled",
    "desktop_disabled",
  ].includes(state.error?.code ?? "");
  // Native invalid states can retain a refresh journal or expired credentials.
  // Explicit cleanup is required before a new authorization may replace them.
  const requiresCleanup =
    state.status === "invalid" || state.localCleared === false;
  const run = async (action: () => unknown) => {
    setBusy(true);
    setActionFailed(false);
    try {
      await action();
    } catch {
      setActionFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="flex flex-col gap-6 p-6 max-w-6xl w-full mx-auto"
      aria-label={t("account.title")}
    >
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <h1 className="text-xl font-semibold">{t("account.title")}</h1>
        <p role="status" aria-live="polite">
          {t(`account.status.${isLoading ? "loading" : state.status}`)}
        </p>
        {connected && state.identity && (
          <p>
            {state.identity.displayName || state.identity.username}{" "}
            <span className="text-muted-foreground">
              @{state.identity.username}
            </span>
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {t("account.toolsIndependent")}
        </p>
        {state.status === "offline" && <p>{t("account.offlineHint")}</p>}
        {state.error && (
          <p role="alert">
            {t(`account.errors.${state.error.code}`, {
              defaultValue: t("account.errors.generic"),
            })}
          </p>
        )}
        {state.localCleared === true && state.remoteRevoked === false && (
          <p role="alert">{t("account.remoteNotRevoked")}</p>
        )}
        {retrySeconds > 0 && (
          <p>{t("account.retryAfter", { seconds: retrySeconds })}</p>
        )}
        {actionFailed && <p role="alert">{t("account.actionFailed")}</p>}
        <div className="flex flex-wrap gap-2">
          {!pending && !connected && !policyError && !requiresCleanup && (
            <Button
              disabled={busy || isLoading || retrySeconds > 0}
              onClick={() => void run(account.startLogin)}
            >
              {t("account.connect")}
            </Button>
          )}
          {pending && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(account.cancelLogin)}
            >
              {t("account.cancel")}
            </Button>
          )}
          {(connected || policyError || state.status === "error") && (
            <Button
              variant="outline"
              disabled={
                busy ||
                isLoading ||
                retrySeconds > 0 ||
                state.status === "refreshing"
              }
              onClick={() => void run(account.retry)}
            >
              {t("account.retry")}
            </Button>
          )}
          {!pending && (connected || policyError || requiresCleanup) && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(account.logout)}
            >
              {t("account.disconnect")}
            </Button>
          )}
        </div>
      </div>
      <nav
        className="flex flex-wrap gap-2"
        aria-label={t("account.pagesLabel")}
      >
        {ACCOUNT_PAGES.map((id) => (
          <Button
            key={id}
            variant={page === id ? "default" : "outline"}
            aria-current={page === id ? "page" : undefined}
            onClick={() => setPage(id)}
          >
            {t(`account.pages.${id}`)}
          </Button>
        ))}
      </nav>
      <section
        className="rounded-xl border p-5 space-y-3"
        aria-label={t(`account.pages.${page}`)}
      >
        <h2 className="font-semibold">{t(`account.pages.${page}`)}</h2>
        {!connected && <p>{t("account.connectRequired")}</p>}
        <p className="text-muted-foreground">{t("account.stagePending")}</p>
      </section>
    </section>
  );
}
