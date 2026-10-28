import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { TuziAccountIcon } from "@/components/icons/TuziAccountIcon";
import "./account.css";
import "./account-polish.css";
import { useEffect, useState, useRef } from "react";
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
  tokenReturnRequest = 0,
  onConfigureKey,
}: {
  account: AccountController;
  tokenReturnRequest?: number;
  localStatus?: string;
  onConfigureKey?: (key: DesktopKey, model?: DesktopPricing) => void;
}) {
  const { t } = useTranslation();
  const page = "keys";
  const [busy, setBusy] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  // This input exists only in this mounted form, never in query or persistent state.
  const [token, setToken] = useState("");
  const inputRevision = useRef(0);
  const [prefilled, setPrefilled] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const tokenInput = useRef<HTMLInputElement>(null);
  const connectingLock = useRef(false);
  const checkingLock = useRef(false);
  const [checking, setChecking] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
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
  useEffect(
    () => () => {
      inputRevision.current++;
      void invoke("account_cancel_token_prefill").catch(() => {});
    },
    [],
  );
  useEffect(() => {
    if (!tokenReturnRequest || isLoading) return;
    if (connected || pending || connectingLock.current || token) {
      void invoke("account_cancel_token_prefill").catch(() => {});
      return;
    }
    let alive = true;
    const revision = inputRevision.current;
    void invoke<string | null>("account_take_token_prefill")
      .then((value) => {
        if (alive && revision === inputRevision.current && value) {
          setToken(value);
          setPrefilled(true);
          setTokenInvalid(false);
          tokenInput.current?.focus();
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // Input edits invalidate the outstanding read immediately via inputRevision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenReturnRequest, state.generation, connected, pending, isLoading]);
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
    if (connectingLock.current) return;
    const value = token.trim();
    if (!value || /\s/.test(value)) {
      setTokenInvalid(true);
      toast.error(t("account.tokenInvalid"), { duration: 3500 });
      tokenInput.current?.focus();
      return;
    }
    setTokenInvalid(false);
    inputRevision.current++;
    void invoke("account_cancel_token_prefill").catch(() => {});
    connectingLock.current = true;
    setConnecting(true);
    await run(() => account.connect(value));
    setConnecting(false);
    connectingLock.current = false;
  };
  const checkConnection = async () => {
    if (checkingLock.current) return;
    checkingLock.current = true;
    setChecking(true);
    await run(async () => {
      try {
        const next = await account.retry();
        if (!alive.current || next.generation !== state.generation) return;
        if (next.status === "connected" && next.identity && !next.error) {
          toast.success(t("account.connectionSuccess"));
        } else {
          toast.error(t("account.connectionFailed"), {
            description: next.error
              ? t(`account.errors.${next.error.code}`, {
                  defaultValue: t("account.errors.generic"),
                })
              : t(`account.status.${next.status}`),
          });
        }
      } catch {
        if (alive.current)
          toast.error(t("account.connectionFailed"), {
            description: t("account.actionFailed"),
          });
      }
    });
    checkingLock.current = false;
    if (alive.current) setChecking(false);
  };
  if (!connected)
    return (
      <section
        className="account-shell account-phase1 account-disconnected"
        aria-label={t("account.title")}
      >
        <section
          className="account-connect-card"
          aria-label={t("account.pages.keys")}
        >
          <div className="account-connect-emblem">
            <TuziAccountIcon size={40} />
          </div>
          <h2>连接兔子账户</h2>
          <p className="account-connect-description">
            {t("account.tokenHint")}
          </p>
          <p
            className="account-connect-status"
            role="status"
            aria-live="polite"
          >
            {t(
              `account.status.${isLoading ? "loading" : connecting ? "verifying" : state.status}`,
            )}
          </p>
          <form
            className="account-connect-form"
            onSubmit={(e) => void connect(e)}
          >
            <label htmlFor="account-system-token">
              {t("account.tokenLabel")}
            </label>
            <Input
              ref={tokenInput}
              id="account-system-token"
              type="password"
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={token}
              disabled={busy || pending || isLoading}
              aria-invalid={tokenInvalid}
              placeholder={t("account.tokenPlaceholder")}
              onChange={(e) => {
                inputRevision.current++;
                setPrefilled(false);
                void invoke("account_cancel_token_prefill").catch(() => {});
                setToken(e.target.value);
                setTokenInvalid(false);
                setActionFailed(false);
              }}
            />
            {prefilled && <p role="status">{t("account.tokenPrefilled")}</p>}
            {state.error && (
              <p role="alert">
                {t(`account.errors.${state.error.code}`, {
                  defaultValue: t("account.errors.generic"),
                })}
              </p>
            )}
            {actionFailed && <p role="alert">{t("account.actionFailed")}</p>}
            {retrySeconds > 0 && (
              <p>{t("account.retryAfter", { seconds: retrySeconds })}</p>
            )}
            <div className="account-connect-actions">
              <Button
                type="button"
                variant="outline"
                disabled={busy || isLoading}
                onClick={() => {
                  setPrefilled(false);
                  void run(account.openTokenPage);
                }}
              >
                {t("account.getToken")}
              </Button>
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
          </form>
          {!pending && !state.localCleared && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void run(account.logout)}
            >
              {t("account.disconnect")}
            </Button>
          )}
          <p className="account-connect-footnote">
            {t("account.connectRequired")}
          </p>
        </section>
      </section>
    );
  return (
    <section
      className="account-shell account-phase1"
      aria-label={t("account.title")}
    >
      <div className="account-connection" data-status={state.status}>
        <div className="account-avatar">
          <TuziAccountIcon size={24} />
        </div>
        <p
          className="account-connection-status"
          role="status"
          aria-live="polite"
        >
          {t(`account.status.${isLoading ? "loading" : state.status}`)}
        </p>
        {state.identity && (
          <p className="account-connection-identity">
            {state.identity.displayName || state.identity.username}{" "}
            <span className="text-muted-foreground">
              @{state.identity.username}
            </span>
          </p>
        )}
        <p
          className="account-connection-hint"
          title={t("account.disconnectHint")}
        >
          {t("account.disconnectHint")}
        </p>
        {state.status === "offline" && <p>{t("account.offlineHint")}</p>}
        {state.error && (
          <p role="alert">
            {t(`account.errors.${state.error.code}`, {
              defaultValue: t("account.errors.generic"),
            })}
          </p>
        )}
        {actionFailed && <p role="alert">{t("account.actionFailed")}</p>}
        {retrySeconds > 0 && (
          <p>{t("account.retryAfter", { seconds: retrySeconds })}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={
              busy ||
              isLoading ||
              retrySeconds > 0 ||
              state.status === "refreshing"
            }
            onClick={() => void checkConnection()}
          >
            {t(checking ? "account.checkingConnection" : "account.retry")}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void run(account.logout)}
          >
            {t("account.disconnect")}
          </Button>
        </div>
      </div>
      <section
        className="account-content"
        data-account-page={page}
        aria-label={t(`account.pages.${page}`)}
      >
        {state.identity && (
          <AccountBusiness
            key={`${state.identity.connectionId}:${state.generation}:${page}`}
            state={state}
            page={page}
            onConfigure={onConfigureKey}
          />
        )}
      </section>
    </section>
  );
}
