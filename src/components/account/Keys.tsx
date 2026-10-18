import { Button } from "@/components/ui/button";
import { desktopRequest, type AccountState } from "@/lib/api/account";
import type {
  DesktopError,
  DesktopKey,
  DesktopPricing,
  KeyWrite,
  Page,
} from "@/lib/api/desktop";
import { useDesktop } from "@/lib/query/desktop";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  date,
  Field,
  Pager,
  QueryState,
  useWrite,
  WriteError,
} from "./BusinessShared";
const defaultKey: KeyWrite = {
  name: "",
  group: "",
  expired_time: -1,
  remain_quota: "0",
  unlimited_quota: false,
  model_limits_enabled: false,
  model_limits: "",
  allow_ips: "",
  exclude_ips: "",
};
export function Keys({
  state,
  onConfigure,
}: {
  state: AccountState;
  onConfigure?: (key: DesktopKey, model?: DesktopPricing) => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [selected, setSelected] = useState<string | null>(null),
    [form, setForm] = useState<KeyWrite | null>(null),
    [original, setOriginal] = useState<KeyWrite | null>(null),
    [secret, setSecret] = useState(""),
    [secretSearch, setSecretSearch] = useState(false),
    [copyFailed, setCopyFailed] = useState(false);
  const current = useRef(true);
  const secretEpoch = useRef(0);
  const clearSecret = () => {
    secretEpoch.current++;
    setSecret("");
  };
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
      secretEpoch.current++;
    };
  }, []);
  const list = useDesktop<Page<DesktopKey>>(state, "/account/keys", {
    page,
    ...filters,
  });
  const detail = useDesktop<DesktopKey>(
    selected ? state : { ...state, identity: null },
    `/account/keys/${selected}`,
  );
  const groups = useDesktop<{ id: string; label: string }[]>(
    state,
    "/account/key-groups",
  );
  const { write: performWrite, busy, error, clear } = useWrite(state);
  const reveal = useWrite(state);
  const operation = useRef<{
    method: string;
    path: string;
    body?: unknown;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const verificationLock = useRef(false);
  const [verified, setVerified] = useState<DesktopKey[] | null>(null);
  const [verifyError, setVerifyError] = useState<DesktopError | null>(null);
  const write: typeof performWrite = async (method, path, body) => {
    if (busy || error?.outcomeUnknown) return;
    operation.current = { method, path, body };
    setVerified(null);
    return performWrite(method, path, body);
  };
  const session = `${state.identity?.connectionId}:${state.generation}`;
  const latestSession = useRef(session);
  latestSession.current = session;
  useEffect(() => {
    operation.current = null;
    setVerified(null);
    setVerifyError(null);
    setForm(null);
    setSelected(null);
    clearSecret();
    clear();
  }, [session]);
  const verify = async () => {
    const requestSession = session;
    const op = operation.current;
    if (!op || verificationLock.current) return;
    verificationLock.current = true;
    setVerifying(true);
    setVerified(null);
    setVerifyError(null);
    try {
      let items: DesktopKey[];
      if (op.method === "POST") {
        items = [];
        for (let page = 1; page <= 100; page++) {
          const result = await desktopRequest<Page<DesktopKey>>({
            method: "GET",
            path: "/account/keys",
            generation: state.generation,
            query: [
              ["keyword", (op.body as KeyWrite).name],
              ["page_size", "100"],
              ["page", String(page)],
            ],
          });
          if (!current.current || latestSession.current !== requestSession)
            return;
          items.push(...result.data.items);
          if (!result.data.has_more) break;
          // Never unlock on a partial or unbounded listing.
          if (page === 100) throw { code: "verificationIncomplete" };
        }
      } else {
        try {
          const result = await desktopRequest<DesktopKey>({
            method: "GET",
            path: op.path.replace(/\/status$/, ""),
            generation: state.generation,
          });
          items = [result.data];
        } catch (e) {
          if (op.method !== "DELETE" || (e as DesktopError).status !== 404)
            throw e;
          items = [];
        }
      }
      if (current.current && latestSession.current === requestSession)
        setVerified(items);
    } catch (e) {
      if (current.current && latestSession.current === requestSession)
        setVerifyError(e as DesktopError);
    } finally {
      verificationLock.current = false;
      if (current.current) setVerifying(false);
    }
  };
  useEffect(() => {
    clearSecret();
    const timer = window.setTimeout(() => clearSecret(), 60000);
    return () => window.clearTimeout(timer);
  }, [selected, state.status]);
  useEffect(() => {
    if (selected && detail.data && "id" in detail.data.data) {
      const k = detail.data.data;
      const f: KeyWrite = {
        name: k.name,
        group: k.group,
        expired_time: k.expired_time,
        remain_quota: k.remain_quota,
        unlimited_quota: k.unlimited_quota,
        model_limits_enabled: k.model_limits_enabled,
        model_limits: k.model_limits,
        allow_ips: k.allow_ips ?? "",
        exclude_ips: k.exclude_ips ?? "",
      };
      setForm(f);
      setOriginal(f);
    }
  }, [selected, detail.data]);
  const update = (key: keyof KeyWrite, value: string | boolean | number) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));
  const save = async () => {
    if (!form || error?.outcomeUnknown) return;
    const body = selected
      ? Object.fromEntries(
          Object.entries(form).filter(
            ([k, v]) => v !== original?.[k as keyof KeyWrite],
          ),
        )
      : form;
    if (!Object.keys(body).length) return;
    clearSecret();
    const epoch = secretEpoch.current;
    const result = await write<DesktopKey | { id: string; key: string }>(
      selected ? "PATCH" : "POST",
      selected ? `/account/keys/${selected}` : "/account/keys",
      body,
    );
    if (result && current.current && epoch === secretEpoch.current) {
      if ("key" in result) {
        setSecret(result.key);
        window.setTimeout(() => {
          if (current.current && epoch === secretEpoch.current) clearSecret();
        }, 60000);
      }
      setForm(null);
      setSelected(null);
    }
  };
  return (
    <>
      <QueryState query={list} />
      {list.data?.data.items.length === 0 && (
        <p className="account-empty">{t("account.business.empty")}</p>
      )}
      {secretSearch && <p role="alert">{t("account.business.secretSearch")}</p>}
      <div className="account-key-toolbar">
        <div className="account-key-filters">
          {["keyword", "token", "group"].map((field) => (
            <input
              key={field}
              aria-label={t(`account.business.keyFilter.${field}`)}
              placeholder={t(`account.business.keyPlaceholder.${field}`)}
              value={filters[field] ?? ""}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                const value = event.target.value;
                if (
                  (field === "token" && !/^[A-Za-z0-9]{0,4}$/.test(value)) ||
                  (field === "keyword" && /^sk-[A-Za-z0-9_-]{20,}$/.test(value))
                ) {
                  setSecretSearch(true);
                  return;
                }
                setSecretSearch(false);
                setFilters((previous) => ({ ...previous, [field]: value }));
                setPage(1);
                setSelected(null);
                clearSecret();
              }}
            />
          ))}
          <select
            aria-label={t("account.business.keyFilter.status")}
            value={filters.status ?? ""}
            onChange={(event) => {
              setFilters((previous) => ({
                ...previous,
                status: event.target.value,
              }));
              setPage(1);
              setSelected(null);
              clearSecret();
            }}
          >
            <option value="">
              {t("account.business.keyPlaceholder.status")}
            </option>
            {[1, 2, 3, 4].map((status) => (
              <option key={status} value={status}>
                {t(`account.business.keyStatus.${status}`)}
              </option>
            ))}
          </select>
        </div>
        <Button
          className="account-key-create"
          disabled={busy || !!error?.outcomeUnknown}
          onClick={() => {
            clear();
            setSelected(null);
            setOriginal(null);
            setForm(defaultKey);
            clearSecret();
          }}
        >
          {t("account.business.create")}
        </Button>
      </div>

      <div className="account-table-scroll">
        <table className="account-key-table">
          <thead>
            <tr>
              {["name", "group", "keyQuota", "status", "expiry", "actions"].map(
                (label) => (
                  <th key={label}>{t(`account.visual.columns.${label}`)}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {list.data?.data.items.map((k) => (
              <tr key={k.id}>
                <td>
                  <strong>{k.name}</strong>
                  <small>{k.masked_key}</small>
                </td>
                <td>{k.group || "—"}</td>
                <td>
                  <span>
                    {k.remain_quota} / {k.used_quota}
                  </span>
                  <small>quota · {t("account.visual.remainingUsed")}</small>
                </td>
                <td>
                  <span
                    className={`account-badge ${k.status === 1 ? "is-success" : ""}`}
                  >
                    {t(`account.business.keyStatus.${k.status}`)}
                  </span>
                </td>
                <td>{date(k.expired_time)}</td>
                <td>
                  <div className="account-row-actions">
                    <Button
                      variant="link"
                      disabled={busy || !!error?.outcomeUnknown}
                      onClick={() => {
                        setSelected(k.id);
                        setForm(null);
                        clearSecret();
                        clear();
                      }}
                    >
                      {t("account.business.details")}
                    </Button>
                    <Button
                      variant="link"
                      disabled={busy || !!error?.outcomeUnknown}
                      onClick={() =>
                        void write("PATCH", `/account/keys/${k.id}/status`, {
                          status: k.status === 1 ? 2 : 1,
                        })
                      }
                    >
                      {t(
                        k.status === 1
                          ? "account.business.disable"
                          : "account.business.enable",
                      )}
                    </Button>
                    <Button
                      variant="link"
                      disabled={busy || !!error?.outcomeUnknown}
                      onClick={() => {
                        if (window.confirm(t("account.business.deleteConfirm")))
                          void write("DELETE", `/account/keys/${k.id}`);
                      }}
                    >
                      {t("account.business.delete")}
                    </Button>
                    <Button
                      variant="link"
                      disabled={
                        busy || reveal.busy || state.status === "offline"
                      }
                      onClick={async () => {
                        clearSecret();
                        const epoch = secretEpoch.current;
                        const r = await reveal.write<{ key: string }>(
                          "POST",
                          `/account/keys/${k.id}/reveal`,
                        );
                        if (
                          r &&
                          current.current &&
                          epoch === secretEpoch.current
                        ) {
                          setSecret(r.key);
                          window.setTimeout(() => {
                            if (
                              current.current &&
                              epoch === secretEpoch.current
                            )
                              clearSecret();
                          }, 60000);
                        }
                      }}
                    >
                      {t("account.business.reveal")}
                    </Button>
                    {onConfigure && (
                      <Button variant="link" onClick={() => onConfigure(k)}>
                        {t("account.business.configure")}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && (
        <Pager
          page={page}
          more={list.data.data.has_more}
          onChange={(next) => {
            clearSecret();
            setPage(next);
          }}
        />
      )}
      <WriteError error={error} />
      <WriteError error={reveal.error} />
      {error?.outcomeUnknown && (
        <>
          <Button disabled={verifying} onClick={() => void verify()}>
            {t("account.business.verify")}
          </Button>
          <WriteError error={verifyError} />
          {verified && (
            <div>
              <p>{t("account.business.verifyReview")}</p>
              <p>
                {t(
                  operation.current?.method === "POST"
                    ? "account.business.create"
                    : operation.current?.method === "DELETE"
                      ? "account.business.delete"
                      : "account.business.save",
                )}
              </p>
              {Object.entries(
                (operation.current?.body ?? {}) as Record<string, unknown>,
              ).map(([field, value]) => (
                <p key={field}>
                  {t(
                    `account.business.${({ remain_quota: "quota", expired_time: "expiry", status: "keyFilter.status" } as Record<string, string>)[field] ?? field}`,
                    { defaultValue: field },
                  )}
                  : {String(value)}
                </p>
              ))}
              {verified.length === 0 && (
                <p className="account-empty">{t("account.business.empty")}</p>
              )}
              {verified.map((k) => (
                <dl key={k.id}>
                  <dt>ID</dt>
                  <dd>{k.id}</dd>
                  {Object.keys(defaultKey).map((field) => (
                    <div key={field}>
                      <dt>
                        {t(
                          `account.business.${({ remain_quota: "quota", expired_time: "expiry", status: "keyFilter.status" } as Record<string, string>)[field] ?? field}`,
                          {
                            defaultValue: field,
                          },
                        )}
                      </dt>
                      <dd>{String(k[field as keyof KeyWrite] ?? "")}</dd>
                    </div>
                  ))}
                  <dt>{t("account.business.keyFilter.status")}</dt>
                  <dd>{t(`account.business.keyStatus.${k.status}`)}</dd>
                </dl>
              ))}
              <Button
                onClick={() => {
                  setForm(null);
                  setSelected(null);
                  setOriginal(null);
                  clearSecret();
                  setVerified(null);
                  operation.current = null;
                  clear();
                  void list.refetch();
                }}
              >
                {t("account.business.verifyAcknowledge")}
              </Button>
            </div>
          )}
        </>
      )}
      {copyFailed && <p role="alert">{t("account.business.errors.generic")}</p>}
      {(busy || reveal.busy) && (
        <Button onClick={clearSecret}>{t("account.business.close")}</Button>
      )}
      {secret && (
        <div>
          <input
            aria-label={t("account.business.revealed")}
            readOnly
            value={secret}
          />
          <Button
            onClick={() => {
              setCopyFailed(false);
              void navigator.clipboard
                .writeText(secret)
                .catch(() => setCopyFailed(true));
            }}
          >
            {t("account.business.copy")}
          </Button>
          <Button onClick={clearSecret}>{t("account.business.close")}</Button>
        </div>
      )}
      {form && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="account-editor"
        >
          <h3>
            {t(
              selected ? "account.business.details" : "account.business.create",
            )}
          </h3>
          <Field
            label={t("account.business.name")}
            value={form.name}
            onChange={(v) => update("name", v)}
          />
          <label>
            {t("account.business.group")}
            <select
              aria-label={t("account.business.group")}
              multiple
              value={form.group.split(",").filter(Boolean)}
              onChange={(e) =>
                update(
                  "group",
                  Array.from(e.target.selectedOptions, (option) => option.value)
                    .filter(Boolean)
                    .join(","),
                )
              }
            >
              {groups.data?.data.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <Field
            label={t("account.business.quota")}
            value={form.remain_quota}
            onChange={(v) => update("remain_quota", v)}
          />
          <Field
            label={t("account.business.expiry")}
            value={String(form.expired_time)}
            onChange={(v) => update("expired_time", Number(v))}
          />
          {(["unlimited_quota", "model_limits_enabled"] as const).map((k) => (
            <Check
              key={k}
              label={t(`account.business.${k}`)}
              value={form[k]}
              onChange={(v) => update(k, v)}
            />
          ))}
          {(["model_limits", "allow_ips", "exclude_ips"] as const).map((k) => (
            <Field
              key={k}
              label={t(`account.business.${k}`)}
              value={form[k] ?? ""}
              onChange={(v) => update(k, v)}
            />
          ))}
          <div className="account-form-actions">
            <Button type="submit" disabled={busy || !!error?.outcomeUnknown}>
              {t("account.business.save")}
            </Button>
            <Button
              variant="outline"
              type="button"
              disabled={!!error?.outcomeUnknown}
              onClick={() => {
                setSelected(null);
                setForm(null);
                clearSecret();
                clear();
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
