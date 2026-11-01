import { useState } from "react";
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
  const [statisticsOpen, setStatisticsOpen] = useState(false);
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
  });
  const summary = useDesktop<Summary>(state, "/account/logs/summary", filters);
  const statistics = useDesktop<LogStatistics>(
    statisticsOpen ? state : { ...state, identity: null },
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
      if (statisticsOpen) void statistics.refetch();
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
      <div className="account-log-summary">
        {summary.data && (
          <span>
            {t("account.business.records")}: {summary.data.data.record_count} ·{" "}
            {t("account.business.errorRecords")}:{" "}
            {summary.data.data.error_count} · {t("account.workspace.cost")}:{" "}
            {amount(summary.data.data.quota)}
          </span>
        )}
        <button
          type="button"
          aria-expanded={statisticsOpen}
          onClick={() => setStatisticsOpen(!statisticsOpen)}
        >
          {t("account.workspace.statistics")} {statisticsOpen ? "▴" : "▾"}
        </button>
      </div>
      <p
        className="account-compact-notice"
        title={t("account.business.logsNotice")}
      >
        {t("account.workspace.logNotice")}
      </p>
      <QueryState
        query={{
          isLoading: list.isLoading || summary.isLoading || account.isLoading,
          error: list.error || summary.error || account.error,
          dataUpdatedAt: 0,
        }}
        showUpdated={false}
      />
      {statisticsOpen && (
        <section className="account-card account-log-statistics">
          <QueryState query={statistics} />
          {statistics.data && (
            <>
              <UsageChart
                label={t("account.workspace.consumptionTrend")}
                money={money ? { ...money, display_type: currency } : undefined}
                points={statistics.data.data.trend.map((point) => ({
                  ...point,
                  call_count: point.record_count,
                  bucket_start: point.start_timestamp,
                  bucket_end: point.end_timestamp,
                }))}
              />
              <div className="account-stat-breakdown">
                {statistics.data.data.by_model.map((point) => (
                  <p key={point.model_name}>
                    {point.model_name}: {point.record_count} ·{" "}
                    {amount(point.quota)}
                  </p>
                ))}
                {statistics.data.data.by_error.map((point) => (
                  <p key={point.error_code}>
                    {point.error_code}: {point.record_count}
                  </p>
                ))}
              </div>
            </>
          )}
        </section>
      )}
      <LogRows
        items={list.data?.data.items ?? []}
        select={setRequest}
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
          more={list.data.data.has_more}
          onChange={(value) => {
            setPage(value);
            setRequest("");
          }}
        />
      )}
      {request && (
        <AccountDialog
          drawer
          title={t("account.business.requestSummary")}
          description={request}
          onClose={() => setRequest("")}
        >
          <QueryState query={detail} />
          <LogRows
            items={detail.data?.data.items ?? []}
            money={money}
            currency={currency}
          />
          {detail.data?.data.has_more && (
            <p>{t("account.business.summaryLimit")}</p>
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
  select?: (id: string) => void;
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
                {select && l.request_id && (
                  <Button variant="link" onClick={() => select(l.request_id)}>
                    {t("account.business.requestSummary")}
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
