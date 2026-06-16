import { useUpdate } from "@/contexts/UpdateContext";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  ArrowUpCircle,
  CheckCircle2,
  Download,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { relaunchApp } from "@/lib/updater";
import type { UpdateProgressEvent } from "@/lib/updater";

interface UpdateBadgeProps {
  className?: string;
  onOpenAbout?: () => void;
}

export function UpdateBadge({ className = "", onOpenAbout }: UpdateBadgeProps) {
  const { hasUpdate, updateInfo, updateHandle, resetDismiss } = useUpdate();
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const downloadedBytesRef = useRef(0);
  const totalBytesRef = useRef(0);
  const isActive = hasUpdate && updateInfo;
  const title = isActive
    ? t("settings.updateAvailable", {
        version: updateInfo?.availableVersion ?? "",
      })
    : t("settings.checkForUpdates");
  const progressLabel = useMemo(() => {
    if (!totalBytes) return t("settings.updateDownloading");
    return t("settings.updateDownloadingWithProgress", {
      progress: Math.round(progress),
    });
  }, [progress, t, totalBytes]);

  if (!isActive) {
    return null;
  }

  const handleProgress = (event: UpdateProgressEvent) => {
    if (event.event === "Started") {
      downloadedBytesRef.current = 0;
      totalBytesRef.current = event.total ?? 0;
      setTotalBytes(totalBytesRef.current);
      setProgress(0);
      return;
    }

    if (event.event === "Progress") {
      downloadedBytesRef.current += event.downloaded ?? 0;
      if (totalBytesRef.current > 0) {
        setProgress(
          Math.min(100, (downloadedBytesRef.current / totalBytesRef.current) * 100),
        );
      }
      return;
    }

    if (event.event === "Finished") {
      setProgress(100);
    }
  };

  const handleInstall = async () => {
    if (!updateHandle) return;

    setIsDownloading(true);
    setProgress(0);
    downloadedBytesRef.current = 0;
    totalBytesRef.current = 0;
    setTotalBytes(0);

    try {
      resetDismiss();
      await updateHandle.downloadAndInstall(handleProgress);
      if (updateHandle.manual) {
        toast.success(t("settings.updatePageOpened"), { closeButton: true });
        setDialogOpen(false);
        return;
      }

      setIsInstalled(true);
      setProgress(100);
      toast.success(t("settings.updateInstalledRestarting"), {
        closeButton: true,
      });
    } catch (error) {
      console.error("[UpdateBadge] Update failed", error);
      toast.error(t("settings.updateFailed"));
    } finally {
      setIsDownloading(false);
    }
  };

  const handleRestart = async () => {
    try {
      await relaunchApp();
    } catch (error) {
      console.error("[UpdateBadge] Restart failed", error);
      toast.error(t("settings.restartFailed"));
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title={title}
        aria-label={title}
        onClick={() => setDialogOpen(true)}
        className={`
          relative h-8 w-8 rounded-full
          ${isActive ? "text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-500/10" : "text-muted-foreground hover:bg-muted/60"}
          ${className}
        `}
      >
        <ArrowUpCircle className="h-5 w-5" />
      </Button>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!isDownloading) setDialogOpen(open);
        }}
      >
        <DialogContent className="max-w-md" zIndex="top">
          <DialogHeader className="space-y-3 border-b-0 bg-transparent pb-0">
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
              {isInstalled ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <ArrowUpCircle className="h-5 w-5 text-green-500" />
              )}
              {isInstalled
                ? t("settings.updateRestartTitle")
                : t("settings.updateAvailable", {
                    version: updateInfo.availableVersion,
                  })}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              {isInstalled
                ? t("settings.updateRestartMessage")
                : t("settings.updateDialogDescription", {
                    current: updateInfo.currentVersion || "-",
                    version: updateInfo.availableVersion,
                  })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 py-4">
            {isDownloading && (
              <div className="space-y-2" role="status" aria-live="polite">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{progressLabel}</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-green-500 transition-[width] duration-300"
                    style={{ width: `${Math.max(4, progress)}%` }}
                  />
                </div>
              </div>
            )}

            {!isInstalled && updateInfo.notes && (
              <div className="max-h-32 overflow-y-auto rounded-md border border-border-default bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
                {updateInfo.notes}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 border-t-0 bg-transparent pt-0">
            {isInstalled ? (
              <>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  {t("settings.restartLater")}
                </Button>
                <Button onClick={handleRestart} className="gap-1.5">
                  <RotateCcw className="h-4 w-4" />
                  {t("settings.restartNow")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={isDownloading}
                >
                  {t("common.cancel")}
                </Button>
                {onOpenAbout && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDialogOpen(false);
                      onOpenAbout();
                    }}
                    disabled={isDownloading}
                  >
                    {t("common.about")}
                  </Button>
                )}
                <Button
                  onClick={handleInstall}
                  disabled={isDownloading || !updateHandle}
                  className="gap-1.5"
                >
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {isDownloading
                    ? t("settings.updating")
                    : t("settings.updateTo", {
                        version: updateInfo.availableVersion,
                      })}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
