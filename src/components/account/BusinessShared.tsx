import { Button } from "@/components/ui/button";
import {
  desktopRequest,
  openAccountWeb,
  type AccountState,
  type WebTarget,
} from "@/lib/api/account";
import type { DesktopError } from "@/lib/api/desktop";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
export const date = (n: number) =>
  n > 0 ? new Date(n * 1000).toLocaleString() : n === -1 ? "∞" : "—";
export function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      {label}
      <input
        className="border rounded p-2 bg-background"
        aria-label={label}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function Check({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="block">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />{" "}
      {label}
    </label>
  );
}
export function QueryState({
  query,
}: {
  query: {
    isLoading: boolean;
    error: unknown;
    data?: unknown;
    dataUpdatedAt: number;
  };
}) {
  const { t } = useTranslation();
  const e = query.error as DesktopError | null;
  return (
    <>
      {query.isLoading && <p>{t("account.business.loading")}</p>}
      {e && (
        <p role="alert">
          {t(`account.business.errors.${e.code}`, {
            defaultValue: t("account.business.errors.generic"),
          })}
          {e.retryAfter ? ` (${e.retryAfter}s)` : ""}
        </p>
      )}
      {query.data && (
        <p className="text-xs text-muted-foreground">
          {t("account.business.updated")}{" "}
          {new Date(query.dataUpdatedAt).toLocaleString()}
        </p>
      )}
    </>
  );
}
export function Pager({
  page,
  more,
  onChange,
}: {
  page: number;
  more: boolean;
  onChange: (p: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2">
      <Button disabled={page === 1} onClick={() => onChange(page - 1)}>
        {t("account.business.previous")}
      </Button>
      <span>{page}</span>
      <Button disabled={!more} onClick={() => onChange(page + 1)}>
        {t("account.business.next")}
      </Button>
    </div>
  );
}
export function useWrite(state: AccountState) {
  const client = useQueryClient();
  const current = useRef(state);
  current.current = state;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<DesktopError | null>(null);
  const write = async <T,>(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T | undefined> => {
    const generation = state.generation;
    setBusy(true);
    setError(null);
    try {
      const r = await desktopRequest<T>({ method, path, body, generation });
      if (
        current.current.generation !== generation ||
        !current.current.identity
      )
        return;
      if (!path.endsWith("/reveal"))
        void client.invalidateQueries({ queryKey: ["account"] });
      return r.data;
    } catch (e) {
      if (current.current.generation === generation)
        setError(e as DesktopError);
    } finally {
      if (current.current.generation === generation) setBusy(false);
    }
  };
  return { write, busy, error, clear: () => setError(null) };
}
export function WriteError({ error }: { error: DesktopError | null }) {
  const { t } = useTranslation();
  return error ? (
    <p role="alert">
      {t(
        error.outcomeUnknown
          ? "account.business.unknownOutcome"
          : `account.business.errors.${error.code}`,
        { defaultValue: t("account.business.errors.generic") },
      )}
    </p>
  ) : null;
}
export function WebEntry({
  target,
  allowed = true,
}: {
  target: WebTarget;
  allowed?: boolean;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  return (
    <div>
      <p>{t("account.business.browserAccount")}</p>
      <Button
        disabled={!allowed}
        onClick={() => {
          setFailed(false);
          void openAccountWeb(target).catch(() => setFailed(true));
        }}
      >
        {t(`account.business.web.${target}`)}
      </Button>
      {!allowed && <p>{t("account.business.unavailable")}</p>}
      {failed && <p role="alert">{t("account.business.errors.generic")}</p>}
    </div>
  );
}
