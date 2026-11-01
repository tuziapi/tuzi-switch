import { type AccountState } from "@/lib/api/account";
import type {
  Capabilities,
  DesktopKey,
  DesktopPricing,
} from "@/lib/api/desktop";
import { useDesktop } from "@/lib/query/desktop";
import { useTranslation } from "react-i18next";
import { QueryState, WebEntry } from "./BusinessShared";
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
  const native = caps.data?.data.native;
  const enabled =
    page === "keys"
      ? (caps.data?.data.release?.keys ?? native?.keys)
      : page === "logs"
        ? native?.logs
        : page === "models"
          ? native?.models
          : page === "modelsStatus"
            ? native?.models && native?.performance
            : false;
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
          {page === "keys" && (
            <>
              <AccountMetrics
                state={state}
                accountEnabled={!!native?.account}
                usageEnabled={!!native?.usage}
                web={caps.data?.data.web}
              />
              <Keys state={state} onConfigure={onConfigure} />
            </>
          )}
          {page === "logs" && <Logs state={state} />}
          {(page === "models" || page === "modelsStatus") && (
            <ModelsPage
              state={state}
              performance={page === "modelsStatus"}
              onConfigure={page === "models" ? onConfigure : undefined}
            />
          )}
        </>
      )}
    </>
  );
}
