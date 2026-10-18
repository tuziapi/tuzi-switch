import { Rabbit } from "lucide-react";
import "./account.css";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  // This input exists only in this mounted form, never in query or persistent state.
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [tokenInvalid, setTokenInvalid] = useState(false);
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
  useEffect(() => {
    if (connected) setToken("");
  }, [connected]);
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
  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = token.trim();
    if (!value || /\s/.test(value)) {
      setTokenInvalid(true);
      return;
    }
    setTokenInvalid(false);
    setConnecting(true);
    await run(() => account.connect(value));
    setConnecting(false);
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
          {t(
            `account.status.${isLoading ? "loading" : connecting ? "verifying" : state.status}`,
          )}
        </p>
        {connected && state.identity && (
          <p>
            {state.identity.displayName || state.identity.username}{" "}
            <span className="text-muted-foreground">
              @{state.identity.username}
            </span>
          </p>
        )}
        {connected && <p>{t("account.disconnectHint")}</p>}
        {state.status === "offline" && <p>{t("account.offlineHint")}</p>}
        {state.error && (
          <p role="alert">
            {t(`account.errors.${state.error.code}`, {
              defaultValue: t("account.errors.generic"),
            })}
          </p>
        )}
        {retrySeconds > 0 && (
          <p>{t("account.retryAfter", { seconds: retrySeconds })}</p>
        )}
        {actionFailed && <p role="alert">{t("account.actionFailed")}</p>}
        <div className="flex flex-wrap gap-2">
          {!connected && (
            <Button
              variant="outline"
              disabled={busy || isLoading}
              onClick={() => void run(account.openTokenPage)}
            >
              {t("account.getToken")}
            </Button>
          )}
          {connected && (
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
          {!pending && (connected || !state.localCleared) && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(account.logout)}
            >
              {t("account.disconnect")}
            </Button>
          )}
        </div>
        {!connected && (
          <form
            className="account-token-form"
            onSubmit={(event) => void connect(event)}
          >
            <label htmlFor="account-system-token">
              {t("account.tokenLabel")}
            </label>
            <p id="account-token-hint">{t("account.tokenHint")}</p>
            <div className="account-token-entry">
              <Input
                id="account-system-token"
                type="password"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={token}
                disabled={busy || pending || isLoading}
                aria-describedby="account-token-hint"
                aria-invalid={tokenInvalid}
                placeholder={t("account.tokenPlaceholder")}
                onChange={(event) => {
                  setToken(event.target.value);
                  setTokenInvalid(false);
                  setActionFailed(false);
                }}
              />
              <Button
                type="submit"
                disabled={busy || pending || isLoading || retrySeconds > 0}
              >
                {t(
                  connecting || pending
                    ? "account.verifyingToken"
                    : "account.connect",
                )}
              </Button>
            </div>
            {tokenInvalid && <p role="alert">{t("account.tokenInvalid")}</p>}
          </form>
        )}
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
