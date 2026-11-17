import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  opentuMcpApi,
  type OpenTuPairing,
  type OpenTuConnectionCheck,
} from "@/lib/api/opentuMcp";

export function OpenTuConnectionPanel() {
  const { t } = useTranslation();
  const [pairing, setPairing] = useState<OpenTuPairing | null>(null);
  const [check, setCheck] = useState<OpenTuConnectionCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState("");

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
