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
    "/api/desktop/account",
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
            path: "/api/desktop/usage",
            query: [...query, ["interval_seconds", "3600"]],
            generation: state.generation,
          },
          signal,
        ),
        desktopRequest<UsageValues>(
          {
            method: "GET",
            path: "/api/desktop/usage/summary",
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
      <QueryState query={account} />
      {account.data && (
        <dl>
          {[
            ["identity", account.data.data.username],
            ["group", account.data.data.group],
            [
              "balance",
              formatMoney(account.data.data.quota, account.data.data.money),
            ],
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
      <h3>{t("account.business.daily")}</h3>
      <QueryState query={consumption} />
      {daily && (
        <p>
          {t("account.business.records")}: {daily.data.call_count} ·{" "}
          {account.data
            ? formatMoney(daily.data.quota, account.data.data.money)
            : daily.data.quota + " quota"}{" "}
          · tokens: {daily.data.prompt_tokens} / {daily.data.completion_tokens}
        </p>
      )}
      <p>{t("account.business.usageNotice")}</p>
      {usage && (
        <>
          <p>
            {timezone} · [{date(usage.data.start_time)},{" "}
            {date(usage.data.end_time)})
          </p>
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
        </>
      )}
      <p>
        {t("account.business.localNotice")}{" "}
        {localStatus ?? t("account.business.localUnknown")}
      </p>
      <WebEntry target="coding" />
      <WebEntry target="gaccode" />
    </>
  );
}
