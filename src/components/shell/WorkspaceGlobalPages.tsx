import { useTranslation } from "react-i18next";
import { AuthCenterPanel } from "@/components/settings/AuthCenterPanel";
import { UsageDashboard } from "@/components/usage/UsageDashboard";

export function WorkspaceAuthPage() {
  const { t } = useTranslation();
  return (
    <div className="px-6 flex-1 min-h-0 overflow-y-auto space-y-4 pb-6">
      <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        {t("navigation.authScope")}
      </p>
      <AuthCenterPanel />
    </div>
  );
}
export function WorkspaceUsagePage() {
  const { t } = useTranslation();
  return (
    <div className="px-6 flex-1 min-h-0 overflow-y-auto space-y-4 pb-6">
      <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        {t("navigation.localUsageScope")}
      </p>
      <UsageDashboard />
    </div>
  );
}
