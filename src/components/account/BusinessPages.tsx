import { TuziProviderRecovery } from "@/components/providers/TuziProviderDialog";
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
import { ProfilePage } from "./ProfilePage";
export { Keys, Logs, ModelsPage, Overview, ProfilePage, WebEntry };
export function AccountBusiness({
  state,
  page,
  onConfigure,
  localStatus,
}: {
  state: AccountState;
  localStatus?: string;
  page: string;
  onConfigure?: (key: DesktopKey, model?: DesktopPricing) => void;
}) {
  const { t } = useTranslation();
  const caps = useDesktop<Capabilities>(
    state,
    "/api/desktop/capabilities",
    {},
    60000,
  );
  const feature =
    page === "overview"
      ? "account"
      : page === "modelsStatus"
        ? "performance"
        : page === "profile"
          ? "profile_read"
          : page;
  const enabled =
    page === "topup" || page === "redeem"
      ? caps.data?.data.web[page === "redeem" ? "redemption" : "topup"]
      : caps.data?.data.native[feature as keyof Capabilities["native"]];
  return (
    <>
      <div className="account-capabilities">
        <QueryState query={caps} />
      </div>
      {(page === "overview" || page === "keys") && (
        <div className="account-recovery">
          <TuziProviderRecovery />
        </div>
      )}
      {enabled === false && (
        <p role="alert">{t("account.business.unavailable")}</p>
      )}
      {enabled && (
        <>
          {page === "overview" && (
            <Overview state={state} localStatus={localStatus} />
          )}{" "}
          {page === "keys" && <Keys state={state} onConfigure={onConfigure} />}{" "}
          {page === "logs" && <Logs state={state} />}{" "}
          {page === "profile" && (
            <ProfilePage
              state={state}
              canWrite={!!caps.data?.data.native.profile_write}
              personalAllowed={!!caps.data?.data.web.personal}
            />
          )}{" "}
          {(page === "models" || page === "modelsStatus") && (
            <ModelsPage
              state={state}
              performance={page === "modelsStatus"}
              onConfigure={onConfigure}
            />
          )}{" "}
          {(page === "topup" || page === "redeem") && (
            <WebEntry
              target={page === "topup" ? "topup" : "redemption"}
              allowed={!!enabled}
            />
          )}
        </>
      )}
    </>
  );
}
