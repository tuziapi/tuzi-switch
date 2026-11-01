import { useTranslation } from "react-i18next";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A failed query must not be presented as an empty workspace. */
export function WorkspaceQueryError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="workspace-query-error">
      <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
      <p>{t("navigation.loadFailed")}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {t("common.refresh")}
      </Button>
    </div>
  );
}
