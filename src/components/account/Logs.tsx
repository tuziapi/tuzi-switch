import { ModelIcon } from "./ModelIcon";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { AccountState } from "@/lib/api/account";
import type {
  DesktopAccount,
  Log,
  Money,
  Page,
  Summary,
} from "@/lib/api/desktop";
import { useDesktop } from "@/lib/query/desktop";
import { date, Field, FilterBar, Pager, QueryState } from "./BusinessShared";
import { AccountDialog } from "./AccountDialog";
import {
  CurrencySwitcher,
  displayAmount,
  useAccountCurrency,
  type AccountCurrency,
} from "./AccountCurrency";
import { useAccountViewState } from "./AccountViewState";
import { UsageChart } from "./UsageChart";

function initialWindow() {
  const end = new Date();
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  return {
    start_timestamp: String(Math.floor(start.getTime() / 1000)),
    end_timestamp: String(Math.floor(end.getTime() / 1000)),
  };
}
function localDate(value: string) {
  if (!value) return "";
  const d = new Date(Number(value) * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
interface LogStatistics {
  summary: Summary;
  trend: Summary[];
  by_model: {
    model_name: string;
    quota: string;
    record_count: string;
    error_count: string;
  }[];
  by_error: { error_code: string; record_count: string }[];
}
export function Logs({ state }: { state: AccountState }) {
  const { t } = useTranslation();
  const [page, setPage] = useAccountViewState("logs.page", 1);
  const [filters, setFilters] = useAccountViewState<Record<string, string>>(
    "logs.filters",
    initialWindow(),
  );
  const [draft, setDraft] = useAccountViewState<Record<string, string>>(
    "logs.draft",
    filters,
  );
  const [request, setRequest] = useState("");
  const [selected, setSelected] = useState<Log | null>(null);
  const [allModels, setAllModels] = useState(false);
  const listTop = useRef<HTMLDivElement>(null);
  const currency = useAccountCurrency();
  const account = useDesktop<DesktopAccount>(
    state,
    "/account/account",
    {},
    60000,
  );
  const money = account.data?.data.money;
  const list = useDesktop<Page<Log>>(state, "/account/logs", {
    ...filters,
    page,
    page_size: 10,
  });
  const summary = useDesktop<Summary>(state, "/account/logs/summary", filters);
  const statistics = useDesktop<LogStatistics>(
    state,
    "/account/logs/statistics",
    filters,
  );
  const detail = useDesktop<{
    request_id: string;
    items: Log[];
    has_more: boolean;
  }>(
    request ? state : { ...state, identity: null },
    `/account/logs/requests/${encodeURIComponent(request)}`,
  );
  const invalidRange =
    !draft.start_timestamp ||
    !draft.end_timestamp ||
    Number(draft.start_timestamp) >= Number(draft.end_timestamp);
  const changed = JSON.stringify(filters) !== JSON.stringify(draft);
  const amount = (quota: string) =>
    money ? displayAmount(quota, money, currency) : `${quota} quota`;
  const submit = () => {
    if (invalidRange) return;
    if (changed) {
      setFilters({ ...draft });
      setPage(1);
      setRequest("");
    } else {
      void list.refetch();
      void summary.refetch();
      void account.refetch();
      void statistics.refetch();
    }
  };
  return (
    <>
      <form
        className="account-log-controls"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FilterBar visible={4}>
          {[
            "start_timestamp",
            "end_timestamp",
            "token_name",
            "model_name",
            "group",
            "request_id",
            "upstream_request_id",
            "request_path",
            "error_keyword",
          ].map((key) => (
            <Field
              key={key}
              label={t(`account.business.logFilter.${key}`)}
              type={key.endsWith("timestamp") ? "datetime-local" : "text"}
              value={
                key.endsWith("timestamp")
                  ? localDate(draft[key] ?? "")
                  : (draft[key] ?? "")
              }
              onChange={(value) =>
                setDraft((previous) => ({
                  ...previous,
                  [key]: key.endsWith("timestamp")
                    ? value
                      ? String(Math.floor(new Date(value).getTime() / 1000))
                      : ""
                    : value,
                }))
              }
            />
          ))}
          <label>
            {t("account.business.type")}
            <select
              value={draft.type ?? "0"}
              onChange={(e) =>
                setDraft((previous) => ({ ...previous, type: e.target.value }))
              }
            >
              {[0, 1, 2, 3, 4, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {t(`account.business.logType.${n}`)}
                </option>
              ))}
            </select>
          </label>
        </FilterBar>
        <div className="account-inline-actions">
          <span className="account-subtle">
            {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </span>
          {changed && (
            <span className="account-subtle">
              {t("account.workspace.filtersPending")}
            </span>
          )}
          <CurrencySwitcher />
          <Button type="submit" disabled={invalidRange || list.isFetching}>
            {t(
              changed ? "account.workspace.query" : "account.business.refresh",
            )}
          </Button>
        </div>
        {invalidRange && (
          <p role="alert">{t("account.workspace.invalidRange")}</p>
        )}
      </form>
      <QueryState
        query={{
          isLoading: list.isLoading || summary.isLoading || account.isLoading,
          error: list.error || summary.error || account.error,
          dataUpdatedAt: 0,
        }}
        showUpdated={false}
      />
      <div ref={listTop} className="account-log-list-anchor" />
      {list.data && (
        <div className="account-model-heading">
          <h3>请求明细</h3>
          <span className="account-subtle">
            共 {list.data.data.total} 条 · 第 {page} /{" "}
            {Math.max(1, Math.ceil(Number(list.data.data.total) / 10))} 页
          </span>
        </div>
      )}
      <LogRows
        items={list.data?.data.items ?? []}
        select={(log) => {
          setSelected(log);
          setRequest("");
        }}
        selectedRequest={request}
        money={money}
        currency={currency}
      />
      {list.data?.data.items.length === 0 && (
        <p className="account-empty">{t("account.business.empty")}</p>
      )}
      {list.data && (
        <Pager
          page={page}
          total={list.data.data.total}
          pageSize={10}
          more={list.data.data.has_more}
          onChange={(value) => {
            setPage(value);
            setRequest("");
            listTop.current?.scrollIntoView?.({
              block: "start",
              behavior: "smooth",
            });
          }}
        />
      )}
      <section className="account-card account-log-statistics">
        <h3>{t("account.workspace.statistics")}</h3>
        <div className="account-log-summary">
          {summary.data && (
            <dl className="account-consumption-values">
              {[
                ["记录消费", amount(summary.data.data.quota)],
                ["记录数", summary.data.data.record_count],
                [
                  "输入 / 输出 Token",
                  `${summary.data.data.prompt_tokens} / ${summary.data.data.completion_tokens}`,
                ],
                ["错误", summary.data.data.error_count],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <p
          className="account-compact-notice"
          title={t("account.business.logsNotice")}
        >
          {t("account.workspace.logNotice")}
        </p>
        <QueryState query={statistics} />
        {statistics.data && (
          <>
            <div className="account-stat-columns">
              <div>
                <h4>{t("account.workspace.consumptionTrend")}</h4>
                <UsageChart
                  label={t("account.workspace.consumptionTrend")}
                  money={
                    money ? { ...money, display_type: currency } : undefined
                  }
                  points={statistics.data.data.trend.map((point) => ({
                    ...point,
                    call_count: point.record_count,
                    bucket_start: point.start_timestamp,
                    bucket_end: point.end_timestamp,
                  }))}
                />
              </div>
              <div className="account-stat-breakdown">
                <div className="account-model-heading">
                  <h4>模型消费排行</h4>
                  <Button variant="link" onClick={() => setAllModels(true)}>
                    查看全部
                  </Button>
                </div>
                {[...statistics.data.data.by_model]
                  .sort((a, b) => Number(b.quota) - Number(a.quota))
                  .slice(0, 5)
                  .map((point) => {
                    const total = statistics.data.data.by_model.reduce(
                      (sum, row) => sum + Number(row.quota),
                      0,
                    );
                    const percent =
                      total > 0 ? (Number(point.quota) / total) * 100 : 0;
                    return (
                      <div
                        className="account-model-rank"
                        key={point.model_name}
                      >
                        <ModelIcon name={point.model_name} />
                        <div>
                          <div>
                            <strong title={point.model_name}>
                              {point.model_name}
                            </strong>
                            <span>{amount(point.quota)}</span>
                          </div>
                          <progress value={percent} max={100} />
                          <small>
                            {point.record_count} 条 · {percent.toFixed(1)}%
                          </small>
                        </div>
                      </div>
                    );
                  })}
                {statistics.data.data.by_model.length === 0 && (
                  <p className="account-subtle">暂无消费记录</p>
                )}
              </div>
            </div>
            {statistics.data.data.by_error.length > 0 && (
              <div className="account-error-breakdown">
                <span>错误分布</span>
                {statistics.data.data.by_error.map((point) => (
                  <span className="account-badge" key={point.error_code}>
                    {point.error_code} · {point.record_count}
                  </span>
                ))}
              </div>
            )}
            {statistics.data.data.summary.refund_quota && (
              <p className="account-subtle">
                退款：{amount(statistics.data.data.summary.refund_quota)}
                （单独统计）
              </p>
            )}
          </>
        )}
      </section>
      {allModels && (
        <AccountDialog
          drawer
          title="模型消费排行"
          onClose={() => setAllModels(false)}
        >
          <table className="account-rank-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>消费</th>
                <th>记录</th>
                <th>错误</th>
              </tr>
            </thead>
            <tbody>
              {[...(statistics.data?.data.by_model ?? [])]
                .sort((a, b) => Number(b.quota) - Number(a.quota))
                .map((row) => (
                  <tr key={row.model_name}>
                    <td>
                      <ModelIcon name={row.model_name} /> {row.model_name}
                    </td>
                    <td>{amount(row.quota)}</td>
                    <td>{row.record_count}</td>
                    <td>{row.error_count}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </AccountDialog>
      )}
      {selected && (
        <AccountDialog
          drawer
          title="请求详情"
          description={selected.model_name}
          onClose={() => {
            setSelected(null);
            setRequest("");
          }}
        >
          <dl className="account-log-detail">
            {[
              ["日志 ID", selected.id],
              ["时间", date(selected.created_at)],
              ["模型", selected.model_name],
              ["密钥", selected.token_name],
              ["分组", selected.group],
              ["请求 ID", selected.request_id],
              ["上游请求 ID", selected.upstream_request_id],
              ["请求路径", selected.request_path],
              [
                "请求结果",
                t(`account.business.resultStatus.${selected.result}`),
              ],
              ["耗时", `${selected.duration_ms} ms`],
              ["流式", selected.is_stream ? "是" : "否"],
              [
                "输入 / 输出 Token",
                `${selected.prompt_tokens} / ${selected.completion_tokens}`,
              ],
              [
                "计费状态",
                t(`account.business.billingStatus.${selected.billing_status}`),
              ],
              ["消费", amount(selected.quota)],
              ["错误代码", selected.public_error_code ?? selected.error_code],
              ["HTTP 状态", selected.status_code],
              ["错误详情", selected.error_message],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || "—"}</dd>
              </div>
            ))}
          </dl>
          {selected.request_id && (
            <details
              onToggle={(e) =>
                setRequest(e.currentTarget.open ? selected.request_id : "")
              }
            >
              <summary>同一请求的关联记录（扣费、错误、退款）</summary>
              <QueryState query={detail} />
              <LogRows
                items={(detail.data?.data.items ?? []).filter(
                  (log) => log.id !== selected.id,
                )}
                money={money}
                currency={currency}
              />
              {detail.data &&
                detail.data.data.items.filter((log) => log.id !== selected.id)
                  .length === 0 && <p>暂无其他关联记录</p>}
              {detail.data?.data.has_more && (
                <p>{t("account.business.summaryLimit")}</p>
              )}
            </details>
          )}
        </AccountDialog>
      )}
    </>
  );
}
function LogRows({
  items,
  select,
  selectedRequest,
  money,
  currency,
}: {
  items: Log[];
  select?: (log: Log) => void;
  selectedRequest?: string;
  money?: Money;
  currency: AccountCurrency;
}) {
  const { t } = useTranslation();
  return (
    <div className="account-table-scroll account-log-table">
      <table>
        <thead>
          <tr>
            {[
              "time",
              "model",
              "result",
              "billing",
              "quota",
              "tokens",
              "duration",
            ].map((k) => (
              <th key={k}>
                {t(
                  k === "quota"
                    ? "account.workspace.cost"
                    : `account.business.${k}`,
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((l) => (
            <tr
              key={l.id}
              className={
                selectedRequest && l.request_id === selectedRequest
                  ? "is-selected"
                  : undefined
              }
            >
              <td>{date(l.created_at)}</td>
              <td>
                <strong>{l.model_name}</strong>
                <small>
                  {l.token_name} · {l.group}
                </small>
              </td>
              <td>
                <span
                  className={`account-badge ${l.result === "success" ? "is-success" : l.result === "error" ? "is-error" : ""}`}
                >
                  {t(`account.business.resultStatus.${l.result}`)}
                </span>
              </td>
              <td>{t(`account.business.billingStatus.${l.billing_status}`)}</td>
              <td>
                {money
                  ? displayAmount(l.quota, money, currency)
                  : `${l.quota} quota`}
              </td>
              <td>
                {l.prompt_tokens} / {l.completion_tokens}
              </td>
              <td>
                {l.duration_ms} ms {l.is_stream ? "stream" : ""}
                {l.error_code && (
                  <p>{t(`account.business.callError.${l.error_code}`)}</p>
                )}
                {select && (
                  <Button variant="link" onClick={() => select(l)}>
                    查看详情
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
