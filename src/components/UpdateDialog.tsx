import { useUpdate } from "@/contexts/UpdateContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, Loader2, RotateCcw } from "lucide-react";

export function UpdateDialog() {
  const {
    updateInfo,
    updateDialogOpen,
    closeUpdateDialog,
    installState,
    downloadUpdate,
    installUpdate,
  } = useUpdate();
  if (!updateInfo) return null;
  const { phase, downloaded, total, error } = installState;
  const downloading = phase === "downloading" || phase === "verifying";
  const installing = phase === "preparing" || phase === "installing";
  const ready = phase === "ready" || phase === "installed";
  const progress =
    total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;
  const label =
    phase === "verifying"
      ? "正在校验更新包…"
      : phase === "preparing"
        ? "正在检查任务并保存作品…"
        : phase === "installing"
          ? "正在安装更新…"
          : ready
            ? "更新已准备好"
            : "下载更新";
  return (
    <Dialog
      open={updateDialogOpen}
      onOpenChange={(open) => {
        if (!open && !installing) closeUpdateDialog();
      }}
    >
      <DialogContent
        className="max-w-md"
        zIndex="top"
        onInteractOutside={(event) => {
          if (installing) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (installing) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            更新兔子助手 · {updateInfo.availableVersion}
          </DialogTitle>
          <DialogDescription>
            当前版本 {updateInfo.currentVersion}
            。应用内下载，完成后点击重启安装。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 py-4">
          {(downloading || installing || ready) && (
            <div role="status" aria-live="polite" className="space-y-2 text-sm">
              <p>
                {phase === "downloading"
                  ? `正在下载${progress === null ? "" : ` ${progress}%`}`
                  : label}
              </p>
              {downloading && (
                <>
                  <div
                    role="progressbar"
                    aria-label="更新下载进度"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress ?? undefined}
                    className="h-2 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className={`h-full rounded-full bg-primary ${progress === null ? "animate-pulse" : ""}`}
                      style={{ width: `${progress ?? 15}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {(downloaded / 1048576).toFixed(1)} MB
                    {total > 0 ? ` / ${(total / 1048576).toFixed(1)} MB` : ""}
                  </p>
                </>
              )}
              {ready && (
                <p className="text-muted-foreground">
                  可以稍后安装。重启前会检查生成任务并保存画布。
                </p>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!downloading && !installing && updateInfo.notes && (
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
              {updateInfo.notes}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={installing}
            onClick={closeUpdateDialog}
          >
            {downloading ? "后台下载" : "稍后"}
          </Button>
          <Button
            disabled={downloading || installing}
            onClick={() => void (ready ? installUpdate() : downloadUpdate())}
            className="gap-2"
          >
            {downloading || installing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : ready ? (
              <RotateCcw className="h-4 w-4" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {installing
              ? label
              : downloading
                ? "正在下载"
                : ready
                  ? "重启并更新"
                  : phase === "error"
                    ? "重新下载"
                    : "下载更新"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
