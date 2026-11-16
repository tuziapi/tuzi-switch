import { useEffect } from "react";
import { ArrowUpCircle, X } from "lucide-react";
import { useUpdate } from "@/contexts/UpdateContext";
import "./canvas-update-notice.css";

export function CanvasUpdateNotice() {
  const {
    setCanvasNoticeActive,
    hasUpdate,
    updateInfo,
    isDismissed,
    dismissUpdate,
    openUpdateDialog,
    installState,
  } = useUpdate();
  useEffect(() => {
    setCanvasNoticeActive(true);
    return () => setCanvasNoticeActive(false);
  }, [setCanvasNoticeActive]);
  if (!hasUpdate || !updateInfo) return null;

  const version = updateInfo.availableVersion;
  const ready = installState.phase === "ready" && !installState.error;
  return (
    <aside className="canvas-update-notice" aria-label="桌面版本更新">
      {isDismissed ? (
        <button
          type="button"
          className="canvas-update-notice__compact"
          onClick={openUpdateDialog}
        >
          <ArrowUpCircle size={16} aria-hidden="true" />
          更新 {version}
        </button>
      ) : (
        <div className="canvas-update-notice__card">
          <ArrowUpCircle size={19} aria-hidden="true" />
          <div className="canvas-update-notice__content">
            <strong>
              {ready ? "更新已就绪" : "发现新版本"} {version}
            </strong>
            <p>
              {ready
                ? "已下载并校验，可在方便时重启安装。"
                : "查看更新内容，准备好后再安装。"}
            </p>
            <button type="button" onClick={openUpdateDialog}>
              查看更新
            </button>
          </div>
          <button
            type="button"
            className="canvas-update-notice__close"
            aria-label="收起更新提醒"
            onClick={dismissUpdate}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </aside>
  );
}
