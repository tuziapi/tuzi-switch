import { BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ToggleRow } from "@/components/ui/toggle-row";
import type { SettingsFormState } from "@/hooks/useSettings";

interface AnonymousAnalyticsSettingsProps {
  settings: SettingsFormState;
  onEnabledChange: (enabled: boolean) => void;
}

export function AnonymousAnalyticsSettings({
  settings,
  onEnabledChange,
}: AnonymousAnalyticsSettingsProps) {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-border/40">
        <BarChart3 className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">
          {t("settings.anonymousAnalytics.sectionTitle")}
        </h3>
      </div>
      <ToggleRow
        icon={<BarChart3 className="h-4 w-4 text-blue-500" />}
        title={t("settings.anonymousAnalytics.title")}
        description={t("settings.anonymousAnalytics.description")}
        checked={settings.anonymousAnalyticsEnabled ?? true}
        onCheckedChange={onEnabledChange}
      />
    </section>
  );
}
