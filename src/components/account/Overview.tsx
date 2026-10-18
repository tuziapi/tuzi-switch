import { UsageChart } from "./UsageChart";
import { formatMoney } from "@/lib/accountMoney";
import { desktopRequest, type AccountState } from "@/lib/api/account";
import type { DesktopAccount, Usage, UsageValues } from "@/lib/api/desktop";
import { useAccountRead, useDesktop } from "@/lib/query/desktop";
import { useTranslation } from "react-i18next";
import { date, QueryState, WebEntry } from "./BusinessShared";
export function Overview({
  state,
  localStatus,
}: {
  state: AccountState;
  localStatus?: string;
}) {
  const { t } = useTranslation();
  const account = useDesktop<DesktopAccount>(
    state,
    "/account/account",
    {},
    60000,
  );
  const consumption = useAccountRead(
    state,
    "overview-consumption",
    {},
    async (signal) => {
      // Recompute on every actual read (including focus, reconnect and invalidation).
      // Both endpoints use exactly this window, even if the requests span midnight.
      const now = new Date();
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const query: [string, string][] = [
        ["timezone", timezone],
        ["start_time", String(Math.floor(start.getTime() / 1000))],
        ["end_time", String(Math.floor(now.getTime() / 1000))],
      ];
      const [usage, daily] = await Promise.all([
        desktopRequest<Usage>(
          {
            method: "GET",
            path: "/account/usage",
            query: [...query, ["interval_seconds", "3600"]],
            generation: state.generation,
          },
          signal,
        ),
        desktopRequest<UsageValues>(
          {
            method: "GET",
            path: "/account/usage/summary",
            query,
            generation: state.generation,
          },
          signal,
        ),
      ]);
      return { usage, daily, timezone };
    },
  );
  const { usage, daily, timezone } = consumption.data ?? {};
  return (
    <>
      <div className="account-sync">
        <QueryState query={account} />
        <QueryState query={consumption} />
      </div>
      <dl className="account-metrics">
        <div className="account-card">
          <dt>{t("account.business.balance")}</dt>
          <dd>
            {account.data
              ? formatMoney(account.data.data.quota, account.data.data.money)
              : "—"}
          </dd>
          <small>{t("account.visual.accountInfo")}</small>
        </div>
        <div className="account-card">
          <dt>{t("account.visual.todayCost")}</dt>
          <dd>
            {daily
              ? account.data
                ? formatMoney(daily.data.quota, account.data.data.money)
                : daily.data.quota + " quota"
              : "—"}
          </dd>
          <small>{t("account.business.daily")}</small>
        </div>
        <div className="account-card">
          <dt>{t("account.visual.todayCalls")}</dt>
          <dd>{daily?.data.call_count ?? "—"}</dd>
          <small>{t("account.business.records")}</small>
        </div>
        <div className="account-card">
          <dt>{t("account.visual.todayTokens")}</dt>
          <dd className="account-token-value">
            {daily
              ? `${daily.data.prompt_tokens} / ${daily.data.completion_tokens}`
              : "—"}
          </dd>
          <small>{t("account.business.tokens")}</small>
        </div>
      </dl>
      <div className="account-overview-columns">
        <section className="account-card account-daily">
          <h3>{t("account.visual.dailyTrend")}</h3>
          {usage && (
            <>
              <UsageChart
                points={usage.data.chart}
                money={account.data?.data.money}
              />
              <p className="account-updated">
                {timezone} · [{date(usage.data.start_time)},{" "}
                {date(usage.data.end_time)})
              </p>
            </>
          )}
          <p className="account-notice">{t("account.business.usageNotice")}</p>
        </section>
        <section className="account-card">
          <h3>{t("account.visual.accountInfo")}</h3>
          {account.data && (
            <dl className="account-facts">
              {[
                ["identity", account.data.data.username],
                ["group", account.data.data.group],
                [
                  "cumulative",
                  formatMoney(
                    account.data.data.used_quota,
                    account.data.data.money,
                  ),
                ],
                ["requests", account.data.data.request_count],
              ].map(([key, value]) => (
                <div key={key}>
                  <dt>{t(`account.business.${key}`)}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>
      {usage && (
        <details className="account-card account-data-details">
          <summary>{t("account.visual.details")}</summary>
          <div className="account-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("account.business.time")}</th>
                  <th>{t("account.business.records")}</th>
                  <th>quota</th>
                  <th>tokens</th>
                </tr>
              </thead>
              <tbody>
                {usage.data.chart.map((b) => (
                  <tr key={b.bucket_start}>
                    <td>{date(b.bucket_start)}</td>
                    <td>{b.call_count}</td>
                    <td>
                      {account.data
                        ? formatMoney(b.quota, account.data.data.money)
                        : b.quota + " quota"}
                    </td>
                    <td>
                      {b.prompt_tokens} / {b.completion_tokens}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <section className="account-card">
        <h3>{t("account.visual.localTools")}</h3>
        <p>
          {t("account.business.localNotice")}{" "}
          {localStatus ?? t("account.business.localUnknown")}
        </p>
      </section>
      <div className="account-web-links">
        <WebEntry target="coding" />
        <WebEntry target="gaccode" />
      </div>
    </>
  );
}
