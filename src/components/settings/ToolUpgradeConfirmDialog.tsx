import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ToolInstallationReport } from "@/lib/api/settings";
import { ToolInstallRow } from "./ToolInstallRow";

interface ToolUpgradeConfirmDialogProps {
  isOpen: boolean;
  plans: ToolInstallationReport[];
  displayName: (tool: string) => string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ToolUpgradeConfirmDialog({
  isOpen,
  plans,
  displayName,
  onConfirm,
  onCancel,
}: ToolUpgradeConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-md" zIndex="alert">
        <DialogHeader className="space-y-2 border-b-0 bg-transparent pb-0">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            {t("settings.toolUpgradeConfirmTitle")}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {t("settings.toolUpgradeConfirmHint")}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-3 overflow-y-auto">
          {plans.map((plan) => (
            <div
              key={plan.tool}
              className="space-y-1.5 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-2.5"
            >
              <div className="text-xs font-medium">
                {displayName(plan.tool)}
              </div>
              {!plan.anchored && (
                <div className="text-[10px] leading-snug text-yellow-600 dark:text-yellow-400">
                  {t("settings.toolUpgradeUnanchoredHint")}
                </div>
              )}
              <ul className="space-y-1">
                {plan.installs.map((inst) => (
                  <li key={inst.path}>
                    <ToolInstallRow inst={inst} />
                  </li>
                ))}
              </ul>
              <div className="space-y-0.5">
                <div className="text-[10px] text-muted-foreground">
                  {t("settings.toolUpgradeWillRun")}
                </div>
                <code
                  className="block truncate rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-foreground"
                  title={plan.command}
                >
                  {plan.command}
                </code>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="flex gap-2 border-t-0 bg-transparent pt-2 sm:justify-end">
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onConfirm}>
            {t("settings.toolUpgradeConfirmBtn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
