import { useTranslation } from "react-i18next";
import { desktopRequest, type AccountState } from "@/lib/api/account";
import type { DesktopAccount, UsageValues } from "@/lib/api/desktop";
import { useAccountRead, useDesktop } from "@/lib/query/desktop";
import { displayAmount, useAccountCurrency } from "./AccountCurrency";
import { QueryState } from "./BusinessShared";

/** The first release needs only today's summary, not the hidden trend data. */
export function AccountMetrics({
  state,
  accountEnabled,
  usageEnabled,
}: {
  state: AccountState;
  accountEnabled: boolean;
  usageEnabled: boolean;
}) {
  const { t } = useTranslation();
  const currency = useAccountCurrency();
  const account = useDesktop<DesktopAccount>(
    accountEnabled ? state : { ...state, identity: null },
    "/account/account",
    {},
    60000,
  );
  const consumption = useAccountRead(
    usageEnabled ? state : { ...state, identity: null },
    "phase1-consumption",
    {},
    async (signal) => {
      const now = new Date();
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return desktopRequest<UsageValues>(
        {
          method: "GET",
          path: "/account/usage/summary",
          generation: state.generation,
          query: [
            ["timezone", Intl.DateTimeFormat().resolvedOptions().timeZone],
            ["start_time", String(Math.floor(start.getTime() / 1000))],
            ["end_time", String(Math.floor(now.getTime() / 1000))],
          ],
        },
        signal,
      );
    },
  );
  const daily = consumption.data?.data;
  return (
    <>
      <dl className="account-metrics">
        <div className="account-card">
          <dt>{t("account.business.balance")}</dt>
          <dd>
            {account.data
              ? displayAmount(
                  account.data.data.quota,
                  account.data.data.money,
                  currency,
                )
              : "—"}
          </dd>
        </div>
        <div className="account-card">
          <dt>{t("account.visual.todayCost")}</dt>
          <dd>
            {daily && account.data
              ? displayAmount(daily.quota, account.data.data.money, currency)
              : "—"}
          </dd>
        </div>
        <div className="account-card">
          <dt>{t("account.visual.todayCalls")}</dt>
          <dd>{daily?.call_count ?? "—"}</dd>
        </div>
        <div className="account-card">
          <dt>{t("account.visual.todayTokens")}</dt>
          <dd className="account-token-value">
            {daily
              ? `${daily.prompt_tokens} / ${daily.completion_tokens}`
              : "—"}
          </dd>
        </div>
      </dl>
      <p
        className="account-metrics-note"
        title={t("account.business.usageNotice")}
      >
        今日数据按已记录消费统计 ⓘ
      </p>
      <div className="account-sync">
        <QueryState query={account} showUpdated={false} />
        <QueryState query={consumption} showUpdated={false} />
      </div>
      {(!accountEnabled || !usageEnabled) && (
        <p role="alert">{t("account.business.unavailable")}</p>
      )}
    </>
  );
}
