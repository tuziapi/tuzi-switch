import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  opentuMcpApi,
  type OpenTuPairing,
  type OpenTuConnectionCheck,
  type OpenTuConnectorStatus,
} from "@/lib/api/opentuMcp";

export function OpenTuConnectionPanel() {
  const { t } = useTranslation();
  const [pairing, setPairing] = useState<OpenTuPairing | null>(null);
  const [check, setCheck] = useState<OpenTuConnectionCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState("");
  const [connector, setConnector] = useState<OpenTuConnectorStatus | null>(
    null,
  );
  const [connectorError, setConnectorError] = useState(false);
  const [connectorBusy, setConnectorBusy] = useState(false);
  const [connectorMessage, setConnectorMessage] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = () => {
      opentuMcpApi
        .connectorStatus()
        .then((status) => {
          if (active) setConnector(status);
        })
        .catch(() => {
          if (active) setConnectorError(true);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  const configureConnector = async (remove: boolean) => {
    if (!connector?.configPath) return;
    setConnectorBusy(true);
    setConnectorError(false);
    setConnectorMessage("");
    try {
      setConnector(
        await (remove
          ? opentuMcpApi.removeConnector(connector.configPath)
          : opentuMcpApi.installConnector(connector.configPath)),
      );
      setConnectorMessage(remove ? "removed" : "installed");
    } catch {
      setConnectorError(true);
    } finally {
      setConnectorBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    opentuMcpApi
      .pairing()
      .then((info) => {
        if (active) setPairing(info);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const inspect = async () => {
    setBusy(true);
    setError(false);
    setCheck(null);
    try {
      setPairing(await opentuMcpApi.pairing());
      setCheck(await opentuMcpApi.check());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (field: "endpoint" | "token" | "authorization") => {
    setCopied("");
    setError(false);
    try {
      await opentuMcpApi.copy(field);
      setCopied(field);
    } catch {
      setError(true);
    }
  };

  return (
    <section
      className="rounded-xl glass-card p-6 space-y-5"
      aria-label={t("opentuConnection.title")}
    >
      <div className="space-y-2">
        <h3 className="text-base font-semibold">
          {t("opentuConnection.title")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("opentuConnection.description")}
        </p>
      </div>
      <div className="space-y-3 rounded-lg border p-4">
        <h4 className="font-medium">{t("opentuConnection.codexTitle")}</h4>
        <p className="text-sm text-muted-foreground">
          {t("opentuConnection.connectorHelp")}
        </p>
        {connector && (
          <p className="text-xs text-muted-foreground break-all">
            {t(
              connector.scope === "local"
                ? "opentuConnection.localTarget"
                : "opentuConnection.isolatedTarget",
            )}
            <br />
            <span>{connector.configPath}</span>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={connectorBusy || !pairing || !connector?.configPath}
            onClick={() => void configureConnector(false)}
          >
            {t(
              connectorBusy
                ? "opentuConnection.configuring"
                : connector?.configured
                  ? "opentuConnection.repair"
                  : "opentuConnection.install",
            )}
          </Button>
          {connector?.configured && (
            <Button
              variant="outline"
              disabled={connectorBusy}
              onClick={() => void configureConnector(true)}
            >
              {t("opentuConnection.remove")}
            </Button>
          )}
        </div>
        <div role="status" aria-live="polite" className="text-sm space-y-2">
          {connectorMessage && (
            <p>{t(`opentuConnection.${connectorMessage}`)}</p>
          )}
          {connector?.configured && (
            <p>
              {t(
                connector.lastToolCallAt
                  ? "opentuConnection.clientCalled"
                  : "opentuConnection.awaitingClient",
              )}
            </p>
          )}
        </div>
        {connectorError && (
          <p role="alert" className="text-sm text-destructive">
            {t("opentuConnection.connectorError")}
          </p>
        )}
      </div>
      <details className="space-y-3">
        <summary className="cursor-pointer text-sm">
          {t("opentuConnection.manual")}
        </summary>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">
              {t("opentuConnection.name")}
            </dt>
            <dd>兔子助手 OpenTu</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("opentuConnection.transport")}
            </dt>
            <dd>{t("opentuConnection.http")}</dd>
          </div>
        </dl>
        <div className="space-y-2">
          <label htmlFor="opentu-mcp-endpoint" className="text-sm font-medium">
            {t("opentuConnection.endpoint")}
          </label>
          <div className="flex gap-2">
            <Input
              id="opentu-mcp-endpoint"
              readOnly
              value={pairing?.endpoint ?? ""}
              placeholder={t("opentuConnection.unavailable")}
            />
            <Button
              variant="outline"
              disabled={!pairing}
              onClick={() => copy("endpoint")}
            >
              {t("opentuConnection.copyAddress")}
            </Button>
          </div>
        </div>
        <div className="space-y-3">
          <p className="text-sm">{t("opentuConnection.auth")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!pairing}
              onClick={() => copy("token")}
            >
              {t("opentuConnection.copyToken")}
            </Button>
            <Button
              variant="outline"
              disabled={!pairing}
              onClick={() => copy("authorization")}
            >
              {t("opentuConnection.copyHeader")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("opentuConnection.headerHelp")}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("opentuConnection.restart")}
        </p>
      </details>
      <Button disabled={busy} onClick={inspect}>
        {t(busy ? "opentuConnection.checking" : "opentuConnection.check")}
      </Button>
      <div role="status" className="text-sm space-y-2" aria-live="polite">
        {copied && <p>{t(`opentuConnection.copied.${copied}`)}</p>}
        {check && (
          <>
            <p>{t("opentuConnection.passed", { count: check.toolCount })}</p>
            <p>
              {t(
                check.canvasReady
                  ? "opentuConnection.canvasReady"
                  : "opentuConnection.openCanvas",
              )}
            </p>
            <p className="text-muted-foreground">
              {t("opentuConnection.localOnly")}
            </p>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t("opentuConnection.error")}
        </p>
      )}
    </section>
  );
}
