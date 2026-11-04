import { useUpdate } from "@/contexts/UpdateContext";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowUpCircle } from "lucide-react";

interface UpdateBadgeProps {
  className?: string;
  onOpenAbout?: () => void;
}
export function UpdateBadge({ className = "" }: UpdateBadgeProps) {
  const {
    hasUpdate,
    updateInfo,
    updateHandle,
    openUpdateDialog,
    downloadUpdate,
  } = useUpdate();
  const { t } = useTranslation();
  if (!hasUpdate || !updateInfo) return null;
  const title = t("settings.updateAvailable", {
    version: updateInfo.availableVersion,
  });
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={title}
      aria-label={title}
      onClick={() => {
        if (updateHandle?.manual) void downloadUpdate();
        else openUpdateDialog();
      }}
      className={`h-8 w-8 rounded-full text-green-600 dark:text-green-400 ${className}`}
    >
      <ArrowUpCircle className="h-5 w-5" />
    </Button>
  );
}
