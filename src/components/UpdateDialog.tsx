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
    updateHandle,
    updateDialogOpen,
    closeUpdateDialog,
    installState,
    manualDownloadState,
    openManualDownloadPage,
    copyManualDownloadLink,
    downloadUpdate,
    installUpdate,
  } = useUpdate();
  if (!updateInfo) return null;
  const manual = updateHandle?.manual === true;
  const opening = manual && manualDownloadState.phase === "opening";
  const { phase, downloaded, total, error } = installState;
  const downloading =
    !manual && (phase === "downloading" || phase === "verifying");
  const installing =
    !manual && (phase === "preparing" || phase === "installing");
  const ready = !manual && (phase === "ready" || phase === "installed");
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
            {manual
              ? "。查看更新说明后下载对应系统的安装包，下载完成后请手动安装。"
              : "。应用内下载，完成后点击重启安装。"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 py-4">
          {manual && manualDownloadState.error && (
            <p
              role="alert"
              className="whitespace-pre-line text-sm text-destructive"
            >
              {manualDownloadState.error}
            </p>
          )}
          {manual && manualDownloadState.phase === "opened" && (
            <p role="status" className="text-sm text-muted-foreground">
              已请求浏览器打开下载。若浏览器没有出现，请复制下方链接手动打开。
            </p>
          )}
          {manual && updateHandle.downloadUrl && (
            <div className="space-y-2 rounded-lg border p-3 text-xs">
              <p className="text-muted-foreground">
                安装包对应当前显示的版本。
              </p>
              <input
                aria-label="安装包下载链接"
                readOnly
                value={updateHandle.downloadUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="w-full min-w-0 rounded bg-muted px-2 py-2 text-xs select-text"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copyManualDownloadLink()}
                >
                  复制下载链接
                </Button>
                {updateHandle.openDownloadPage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={opening}
                    onClick={() => void openManualDownloadPage()}
                  >
                    打开版本下载页
                  </Button>
                )}
              </div>
            </div>
          )}
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
          {!manual && error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!downloading && !installing && (
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
              {updateInfo.notes || "此版本暂无更新说明。"}
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
            disabled={downloading || installing || opening}
            onClick={() => void (ready ? installUpdate() : downloadUpdate())}
            className="gap-2"
          >
            {downloading || installing || opening ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : ready ? (
              <RotateCcw className="h-4 w-4" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {opening
              ? "正在打开浏览器…"
              : installing
                ? label
                : downloading
                  ? "正在下载"
                  : ready
                    ? "重启并更新"
                    : manual
                      ? "下载安装包"
                      : phase === "error"
                        ? "重新下载"
                        : "下载更新"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
