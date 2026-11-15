import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AccountState } from "@/lib/api/account";
import type { Capabilities, DesktopAccount } from "@/lib/api/desktop";
import { useDesktop } from "@/lib/query/desktop";
import { Button } from "@/components/ui/button";
import { AccountDialog } from "./AccountDialog";
import { ProfilePage } from "./ProfilePage";
import { QueryState } from "./BusinessShared";
import { displayAmount, useAccountCurrency } from "./AccountCurrency";

export function AccountSettings({
  state,
  onClose,
}: {
  state: AccountState;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const caps = useDesktop<Capabilities>(
    state,
    "/account/capabilities",
    {},
    60000,
  );
  const account = useDesktop<DesktopAccount>(
    caps.data?.data.native.account ? state : { ...state, identity: null },
    "/account/account",
    {},
    60000,
  );
  const currency = useAccountCurrency();
  const [editing, setEditing] = useState({ dirty: false, busy: false });
  const [confirmClose, setConfirmClose] = useState(false);
  const onEditState = useCallback(
    (dirty: boolean, busy: boolean) => setEditing({ dirty, busy }),
    [],
  );
  const close = () => {
    if (editing.busy) return;
    if (editing.dirty) setConfirmClose(true);
    else onClose();
  };
  return (
    <AccountDialog
      drawer
      title={t("account.workspace.settings")}
      onClose={close}
      footer={
        confirmClose ? (
          <div role="alert" className="account-discard">
            <p>{t("account.workspace.unsaved")}</p>
            <Button variant="outline" onClick={() => setConfirmClose(false)}>
              {t("account.workspace.keepEditing")}
            </Button>
            <Button disabled={editing.busy} onClick={onClose}>
              {t("account.workspace.discard")}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="account-settings-body">
        <QueryState query={caps} showUpdated={false} />
        <QueryState query={account} showUpdated={false} />
        {account.data && (
          <dl className="account-settings-facts">
            <div>
              <dt>{t("account.business.group")}</dt>
              <dd>{account.data.data.group}</dd>
            </div>
            <div>
              <dt>{t("account.business.cumulative")}</dt>
              <dd>
                {displayAmount(
                  account.data.data.used_quota,
                  account.data.data.money,
                  currency,
                )}
              </dd>
            </div>
            <div>
              <dt>{t("account.business.requests")}</dt>
              <dd>{account.data.data.request_count}</dd>
            </div>
          </dl>
        )}
        {caps.data?.data.native.profile_read ? (
          <ProfilePage
            state={state}
            canWrite={
              state.status === "connected" &&
              !!caps.data.data.native.profile_write
            }
            personalAllowed={caps.data.data.web.personal}
            onEditState={onEditState}
          />
        ) : (
          caps.data && <p role="alert">{t("account.business.unavailable")}</p>
        )}
      </div>
    </AccountDialog>
  );
}
