import { Rabbit } from "lucide-react";
import "./account.css";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AccountBusiness } from "./BusinessPages";
import type { DesktopKey, DesktopPricing } from "@/lib/api/desktop";
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
export function AccountPage({
  account,
}: {
  account: AccountController;
  localStatus?: string;
  onConfigureKey?: (key: DesktopKey, model?: DesktopPricing) => void;
}) {
  const { t } = useTranslation();
  const page = "keys";
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
      className="account-shell account-phase1"
      aria-label={t("account.title")}
    >
      <div className="account-connection">
        <div className="account-avatar">
          <Rabbit size={20} aria-hidden="true" />
        </div>
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
      <section
        className="account-content"
        data-account-page={page}
        aria-label={t(`account.pages.${page}`)}
      >
        {!connected && <p>{t("account.connectRequired")}</p>}
        {connected && state.identity ? (
          <AccountBusiness
            key={`${state.identity.connectionId}:${state.generation}:${page}`}
            state={state}
            page={page}
          />
        ) : null}
      </section>
    </section>
  );
}
