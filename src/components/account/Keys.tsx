import { toast } from "sonner";
import { LoaderCircle } from "lucide-react";
import { AccountDialog } from "./AccountDialog";
import { KeyEditor } from "./KeyEditor";
import { displayAmount, useAccountCurrency } from "./AccountCurrency";
import type { DesktopAccount } from "@/lib/api/desktop";
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
  date,
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
  unlimited_quota: true,
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
    [secretSearch, setSecretSearch] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string>>(
    {},
  );
  const [composing, setComposing] = useState(false);
  const trimmedFilters = Object.fromEntries(
    Object.entries(filters).map(([k, v]) => [k, v.trim()]),
  );
  const filterHint = secretSearch
    ? "请输入名称或密钥最后 4 位，不要粘贴完整 Key。"
    : trimmedFilters.token && trimmedFilters.token.length !== 4
      ? "输满密钥最后 4 位后搜索。"
      : trimmedFilters.keyword &&
          new TextEncoder().encode(trimmedFilters.keyword).length < 2
        ? "名称至少输入 2 个英文字母或 1 个汉字。"
        : "";
  const filterSignature = JSON.stringify(trimmedFilters);
  const appliedSignature = JSON.stringify(appliedFilters);
  const waiting = filterSignature !== appliedSignature;
  useEffect(() => {
    if (composing || filterHint || !waiting) return;
    const timer = window.setTimeout(
      () => {
        setAppliedFilters(trimmedFilters);
        setPage(1);
      },
      trimmedFilters.status !== appliedFilters.status ? 0 : 300,
    );
    return () => window.clearTimeout(timer);
  }, [filterSignature, appliedSignature, composing, filterHint]);
  const [deleting, setDeleting] = useState<DesktopKey | null>(null);
  const writeLock = useRef(false);
  const currency = useAccountCurrency();
  const account = useDesktop<DesktopAccount>(
    state,
    "/account/account",
    {},
    60000,
  );
  const money = account.data?.data.money;
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
  const list = useDesktop<Page<DesktopKey>>(
    state,
    "/account/keys",
    {
      page,
      ...appliedFilters,
    },
    30000,
    false,
    true,
  );
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
    if (writeLock.current || busy || error?.outcomeUnknown) return;
    writeLock.current = true;
    operation.current = { method, path, body };
    setVerified(null);
    try {
      return await performWrite(method, path, body);
    } finally {
      writeLock.current = false;
    }
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
    setDeleting(null);
    clearSecret();
    clear();
  }, [session]);
  useEffect(() => {
    if (error?.outcomeUnknown) {
      setForm(null);
      setSelected(null);
      setDeleting(null);
      clearSecret();
    }
  }, [error]);
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
          if (
            op.method !== "DELETE" ||
            ((e as DesktopError).code !== "not_found" &&
              (e as DesktopError).status !== 404)
          )
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
    if (!["connected", "refreshing"].includes(state.status)) clearSecret();
  }, [state.status]);
  const startEdit = () => {
    const k = detail.data?.data;
    if (!k || k.id !== selected) return;
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
    setOriginal(f);
    setForm(f);
  };
  const closePanel = () => {
    setForm(null);
    setOriginal(null);
    setSelected(null);
    clearSecret();
  };
  const save = async () => {
    if (!form || error?.outcomeUnknown) return;
    if (!form.name.trim() || !form.group) {
      toast.error("请填写名称并选择分组");
      return;
    }
    if (
      (!selected || form.expired_time !== original?.expired_time) &&
      form.expired_time !== -1 &&
      form.expired_time <= Date.now() / 1000
    ) {
      toast.error("到期时间应晚于当前时间");
      return;
    }
    if (
      !form.unlimited_quota &&
      (!selected ||
        form.remain_quota !== original?.remain_quota ||
        form.unlimited_quota !== original?.unlimited_quota) &&
      (!/^\d+$/.test(form.remain_quota) || BigInt(form.remain_quota) <= 0n)
    ) {
      toast.error("请输入大于零的额度");
      return;
    }
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
      toast.success(selected ? "密钥已更新" : "密钥已创建");
    }
  };
  return (
    <>
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
              aria-describedby="key-search-feedback"
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              onChange={(event) => {
                const value = event.target.value;
                if (
                  (field === "token" && !/^[A-Za-z0-9]{0,4}$/.test(value)) ||
                  (field === "keyword" &&
                    /^sk-[A-Za-z0-9_-]{20,}$/.test(value.trim()))
                ) {
                  setSecretSearch(true);
                  return;
                }
                setSecretSearch(false);
                setFilters((previous) => ({ ...previous, [field]: value }));
                setSelected(null);
                clearSecret();
              }}
            />
          ))}
          <select
            aria-label={t("account.business.keyFilter.status")}
            value={filters.status ?? ""}
            onChange={(event) => {
              setSecretSearch(false);
              setFilters((previous) => ({
                ...previous,
                status: event.target.value,
              }));
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
            const available = groups.data?.data ?? [];
            setForm({
              ...defaultKey,
              group:
                available.find((g) => g.id === "default")?.id ??
                available[0]?.id ??
                "",
            });
            clearSecret();
          }}
        >
          {t("account.business.create")}
        </Button>
      </div>

      <div
        id="key-search-feedback"
        className="account-key-search-feedback"
        role="status"
        aria-live="polite"
      >
        {filterHint ? (
          <span>{filterHint}</span>
        ) : list.error && !waiting ? (
          <>
            <span>未能读取密钥列表，请重试。</span>
            <Button
              variant="link"
              size="sm"
              onClick={() => void list.refetch()}
            >
              重试
            </Button>
          </>
        ) : list.isFetching || waiting || composing ? (
          <>
            <LoaderCircle size={14} className="animate-spin" />
            <span>正在更新列表…</span>
          </>
        ) : (
          <span>{list.data ? `共 ${list.data.data.total} 个密钥` : ""}</span>
        )}
      </div>
      <div className="account-table-scroll" aria-busy={list.isFetching}>
        <table className="account-key-table">
          <thead>
            <tr>
              {["name", "group", "keyQuota", "status", "expiry", "actions"].map(
                (label) => (
                  <th key={label}>{t(`account.visual.columns.${label}`)}</th>
                ),
              )}
              {onConfigure && (
                <th>
                  <span className="sr-only">配置到工具</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {!list.data && (
              <tr>
                <td colSpan={onConfigure ? 7 : 6}>
                  <div className="account-keys-empty">
                    {list.error
                      ? "列表暂不可用，请点击重试。"
                      : "正在读取密钥…"}
                  </div>
                </td>
              </tr>
            )}
            {list.data?.data.items.map((k) => (
              <tr key={k.id}>
                <td>
                  <strong>{k.name}</strong>
                  <small>{k.masked_key}</small>
                </td>
                <td>{k.group || "—"}</td>
                <td>
                  <span>
                    {k.unlimited_quota
                      ? "不限额度"
                      : displayAmount(k.remain_quota, money, currency)}{" "}
                    / {displayAmount(k.used_quota, money, currency)}
                  </span>
                  <small>{t("account.visual.remainingUsed")}</small>
                </td>
                <td>
                  <span
                    className={`account-badge ${k.status === 1 ? "is-success" : ""}`}
                  >
                    {t(`account.business.keyStatus.${k.status}`)}
                  </span>
                </td>
                <td>
                  {k.expired_time === -1 ? "永不到期" : date(k.expired_time)}
                </td>
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
                        setDeleting(k);
                        clear();
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
                        setForm(null);
                        setSelected(null);
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
                  </div>
                </td>
                {onConfigure && (
                  <td className="account-configure-cell">
                    <Button
                      size="sm"
                      variant="outline"
                      className="account-configure-primary"
                      disabled={
                        busy ||
                        !!error?.outcomeUnknown ||
                        state.status !== "connected"
                      }
                      onClick={() => onConfigure(k)}
                    >
                      配置
                    </Button>
                  </td>
                )}
              </tr>
            ))}
            {!list.isFetching &&
              !waiting &&
              !filterHint &&
              !list.error &&
              list.data?.data.items.length === 0 && (
                <tr>
                  <td colSpan={onConfigure ? 7 : 6}>
                    <div className="account-keys-empty">
                      <strong>
                        {Object.values(filters).some(Boolean)
                          ? "没有找到匹配的密钥"
                          : "还没有 API 密钥"}
                      </strong>
                      <p>
                        {Object.values(filters).some(Boolean)
                          ? "调整筛选条件后再试试"
                          : "创建一个密钥，即可用于 API 调用或配置到工具。"}
                      </p>
                      {!Object.values(filters).some(Boolean) && (
                        <Button
                          variant="outline"
                          disabled={busy || !!error?.outcomeUnknown}
                          onClick={() => {
                            clear();
                            setSelected(null);
                            setOriginal(null);
                            clearSecret();
                            const g = groups.data?.data ?? [];
                            setForm({
                              ...defaultKey,
                              group:
                                g.find((x) => x.id === "default")?.id ??
                                g[0]?.id ??
                                "",
                            });
                          }}
                        >
                          创建第一个密钥
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
          </tbody>
        </table>
      </div>
      {list.data &&
        !waiting &&
        !list.isPlaceholderData &&
        (page > 1 || list.data.data.has_more) && (
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
      {(busy || reveal.busy) && (
        <Button onClick={clearSecret}>{t("account.business.close")}</Button>
      )}
      {deleting && (
        <AccountDialog
          title="删除密钥"
          description={`确定删除「${deleting.name}」？删除后，使用此密钥的工具将无法继续调用。`}
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
          footer={
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setDeleting(null)}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={busy || !!error?.outcomeUnknown}
                onClick={async () => {
                  const result = await write(
                    "DELETE",
                    `/account/keys/${deleting.id}`,
                  );
                  if (result !== undefined) {
                    setDeleting(null);
                    toast.success("密钥已删除");
                  }
                }}
              >
                {busy ? "删除中…" : "确认删除"}
              </Button>
            </>
          }
        >
          <WriteError error={error} />
        </AccountDialog>
      )}
      {secret && (
        <AccountDialog
          title="查看密钥"
          description="仅向可信应用提供此密钥。关闭后将清除本次显示。"
          onClose={clearSecret}
          footer={
            <>
              <Button variant="outline" onClick={clearSecret}>
                关闭
              </Button>
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(secret);
                    toast.success("已复制密钥");
                  } catch {
                    toast.error("复制失败，请选中密钥手动复制");
                  }
                }}
              >
                复制密钥
              </Button>
            </>
          }
        >
          <input
            className="account-secret-input"
            aria-label={t("account.business.revealed")}
            readOnly
            value={secret}
            onFocus={(e) => e.target.select()}
          />
        </AccountDialog>
      )}
      {(form || selected) && !secret && (
        <AccountDialog
          title={form ? (selected ? "编辑密钥" : "创建密钥") : "密钥详情"}
          description={
            form ? "设置密钥名称和分组，其他选项可按需调整。" : undefined
          }
          onClose={closePanel}
          footer={
            <>
              <Button variant="outline" onClick={closePanel}>
                {form ? "取消" : "关闭"}
              </Button>
              {form ? (
                <Button
                  type="submit"
                  form="account-key-editor"
                  disabled={busy || !!error?.outcomeUnknown}
                >
                  {busy ? "保存中…" : selected ? "保存" : "创建"}
                </Button>
              ) : (
                <Button
                  disabled={
                    !detail.data ||
                    detail.data.data.id !== selected ||
                    busy ||
                    !!error?.outcomeUnknown
                  }
                  onClick={startEdit}
                >
                  编辑
                </Button>
              )}
            </>
          }
        >
          {form ? (
            <form
              id="account-key-editor"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <KeyEditor
                key={selected ?? "create"}
                form={form}
                onChange={setForm}
                groups={groups.data?.data ?? []}
                money={money}
              />
              <QueryState query={groups} showUpdated={false} />
              <WriteError error={error} />
            </form>
          ) : (
            <>
              <QueryState query={detail} showUpdated={false} />
              {detail.data?.data.id === selected && (
                <dl className="account-key-details">
                  {[
                    ["名称", detail.data.data.name],
                    ["分组", detail.data.data.group],
                    [
                      "剩余额度",
                      detail.data.data.unlimited_quota
                        ? "不限额度"
                        : displayAmount(
                            detail.data.data.remain_quota,
                            money,
                            currency,
                          ),
                    ],
                    [
                      "已用额度",
                      displayAmount(
                        detail.data.data.used_quota,
                        money,
                        currency,
                      ),
                    ],
                    [
                      "到期时间",
                      detail.data.data.expired_time === -1
                        ? "永不到期"
                        : date(detail.data.data.expired_time),
                    ],
                    [
                      "状态",
                      t(
                        `account.business.keyStatus.${detail.data.data.status}`,
                      ),
                    ],
                    [
                      "模型限制",
                      detail.data.data.model_limits_enabled
                        ? detail.data.data.model_limits
                        : "不限制",
                    ],
                    ["允许的 IP", detail.data.data.allow_ips || "不限制"],
                    ["排除的 IP", detail.data.data.exclude_ips || "无"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </AccountDialog>
      )}
    </>
  );
}
