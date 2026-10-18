import { FilterBar } from "./BusinessShared";
import { Button } from "@/components/ui/button";
import { type AccountState } from "@/lib/api/account";
import type { Log, Page, Summary } from "@/lib/api/desktop";
import { useDesktop } from "@/lib/query/desktop";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { date, Field, Pager, QueryState } from "./BusinessShared";
export function Logs({ state }: { state: AccountState }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [request, setRequest] = useState("");
  const list = useDesktop<Page<Log>>(state, "/account/logs", {
    ...filters,
    page,
  });
  const summary = useDesktop<Summary>(state, "/account/logs/summary", filters);
  const statistics = useDesktop<{
    summary: Summary;
    trend: Summary[];
    by_model: {
      model_name: string;
      quota: string;
      record_count: string;
      error_count: string;
    }[];
    by_error: { error_code: string; record_count: string }[];
  }>(state, "/account/logs/statistics", filters);
  const detail = useDesktop<{
    request_id: string;
    items: Log[];
    has_more: boolean;
  }>(
    request ? state : { ...state, identity: null },
    `/account/logs/requests/${encodeURIComponent(request)}`,
  );
  return (
    <>
      <p>{Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
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
        ].map((k) => (
          <Field
            key={k}
            label={t(`account.business.logFilter.${k}`)}
            value={filters[k] ?? ""}
            onChange={(v) => {
              setFilters((f) => ({ ...f, [k]: v }));
              setPage(1);
              setRequest("");
            }}
          />
        ))}
        <label>
          {t("account.business.type")}
          <select
            aria-label={t("account.business.type")}
            value={filters.type ?? "0"}
            onChange={(e) => {
              setFilters((f) => ({ ...f, type: e.target.value }));
              setPage(1);
              setRequest("");
            }}
          >
            {[0, 1, 2, 3, 4, 6, 7].map((n) => (
              <option key={n} value={n}>
                {t(`account.business.logType.${n}`)}
              </option>
            ))}
          </select>
        </label>
      </FilterBar>
      <Button
        className="account-page-action"
        variant="outline"
        onClick={() => {
          void list.refetch();
          void summary.refetch();
          void statistics.refetch();
        }}
      >
        {t("account.business.refresh")}
      </Button>
      <p className="account-notice">{t("account.business.logsNotice")}</p>
      <QueryState query={list} />
      {list.data?.data.items.length === 0 && (
        <p className="account-empty">{t("account.business.empty")}</p>
      )}
      <QueryState query={summary} />
      {summary.data && (
        <p>
          {t("account.business.records")}: {summary.data.data.record_count} ·{" "}
          {t("account.business.errorRecords")}: {summary.data.data.error_count}{" "}
          · quota {summary.data.data.quota} · [
          {date(summary.data.data.start_timestamp)},{" "}
          {date(summary.data.data.end_timestamp)})
        </p>
      )}
      <LogRows
        items={list.data?.data.items ?? []}
        select={setRequest}
        selectedRequest={request}
      />
      {list.data && (
        <Pager
          page={page}
          more={list.data.data.has_more}
          onChange={(p) => {
            setPage(p);
            setRequest("");
          }}
        />
      )}
      <QueryState query={statistics} />
      {statistics.data && (
        <>
          <section className="account-card account-log-statistics">
            <h3>{t("account.business.trend")}</h3>
            {statistics.data.data.trend.map((b) => (
              <p key={b.start_timestamp}>
                {date(b.start_timestamp)}: {b.record_count} · quota {b.quota}
              </p>
            ))}
            {statistics.data.data.by_model.map((b) => (
              <p key={b.model_name}>
                {b.model_name}: {b.record_count} · quota {b.quota}
              </p>
            ))}
            {statistics.data.data.by_error.map((b) => (
              <p key={b.error_code}>
                {b.error_code}: {b.record_count}
              </p>
            ))}
          </section>
        </>
      )}
      {request && (
        <section className="account-card account-detail">
          <h3>
            {t("account.business.requestSummary")} {request}
          </h3>
          <QueryState query={detail} />
          <LogRows items={detail.data?.data.items ?? []} />
          {detail.data?.data.has_more && (
            <p>{t("account.business.summaryLimit")}</p>
          )}
          <Button onClick={() => setRequest("")}>
            {t("account.business.close")}
          </Button>
        </section>
      )}
    </>
  );
}
function LogRows({
  items,
  select,
  selectedRequest,
}: {
  items: Log[];
  select?: (id: string) => void;
  selectedRequest?: string;
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
              <th key={k}>{t(`account.business.${k}`)}</th>
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
              <td>{l.quota}</td>
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
