import { type AccountState } from "@/lib/api/account";
import type {
  Capabilities,
  DesktopKey,
  DesktopPricing,
} from "@/lib/api/desktop";
import { useDesktop } from "@/lib/query/desktop";
import { useTranslation } from "react-i18next";
import { QueryState, WebEntry } from "./BusinessShared";
import { CurrencySwitcher } from "./AccountCurrency";
import { Keys } from "./Keys";
import { Logs } from "./Logs";
import { ModelsPage } from "./ModelsPage";
import { Overview } from "./Overview";
import { AccountMetrics } from "./AccountMetrics";
import { ProfilePage } from "./ProfilePage";
export { Keys, Logs, ModelsPage, Overview, ProfilePage, WebEntry };
export function AccountBusiness({
  state,
  page,
  onConfigure,
}: {
  state: AccountState;
  localStatus?: string;
  page: string;
  onConfigure?: (key: DesktopKey, model?: DesktopPricing) => void;
}) {
  const { t } = useTranslation();
  const caps = useDesktop<Capabilities>(
    state,
    "/account/capabilities",
    {},
    60000,
  );
  const enabled =
    page === "keys" &&
    (caps.data?.data.release?.keys ?? caps.data?.data.native.keys);
  return (
    <>
      <div className="account-capabilities">
        <QueryState query={caps} showUpdated={false} />
      </div>
      {enabled === false && (
        <p role="alert">{t("account.business.unavailable")}</p>
      )}
      {enabled && (
        <>
          <div className="account-workspace-heading">
            <h2>{t("account.pages.keys")}</h2>
            <CurrencySwitcher />
          </div>
          <AccountMetrics
            state={state}
            accountEnabled={!!caps.data?.data.native.account}
            usageEnabled={!!caps.data?.data.native.usage}
          />
          <Keys state={state} onConfigure={onConfigure} />
        </>
      )}
    </>
  );
}
