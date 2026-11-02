import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import type { UpdateInfo, UpdateHandle } from "../lib/updater";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { openReleasePage } from "../lib/updater";
import { checkForUpdate } from "../lib/updater";

function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* In-memory dismissal still works. */
  }
}
function removePreference(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Optional preference. */
  }
}

interface UpdateContextValue {
  // 更新状态
  hasUpdate: boolean;
  updateInfo: UpdateInfo | null;
  updateHandle: UpdateHandle | null;
  isChecking: boolean;
  error: string | null;

  // 提示状态
  isDismissed: boolean;
  dismissUpdate: () => void;

  // 操作方法
  checkUpdate: () => Promise<boolean>;
  resetDismiss: () => void;
}

const UpdateContext = createContext<UpdateContextValue | undefined>(undefined);

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const notifiedVersion = useRef<string | null>(null);
  const lastCheckAt = useRef(0);
  const DISMISSED_VERSION_KEY = "tuziswitch:update:dismissedVersion";
  const LEGACY_DISMISSED_KEY = "dismissedUpdateVersion"; // 兼容旧键

  const [hasUpdate, setHasUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateHandle, setUpdateHandle] = useState<UpdateHandle | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  const inFlight = useRef<Promise<boolean> | null>(null);

  const checkUpdate = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    lastCheckAt.current = Date.now();
    const operation = (async () => {
      setIsChecking(true);
      setError(null);

      try {
        const result = await checkForUpdate({ timeout: 30000 });

        if (result.status === "available") {
          setHasUpdate(true);
          setUpdateInfo(result.info);
          setUpdateHandle(result.update);

          // 检查是否已经关闭过这个版本的提醒
          let dismissedVersion = readPreference(DISMISSED_VERSION_KEY);
          if (!dismissedVersion) {
            const legacy = readPreference(LEGACY_DISMISSED_KEY);
            if (legacy) {
              writePreference(DISMISSED_VERSION_KEY, legacy);
              removePreference(LEGACY_DISMISSED_KEY);
              dismissedVersion = legacy;
            }
          }
          setIsDismissed(dismissedVersion === result.info.availableVersion);
          return true; // 有更新
        } else {
          setHasUpdate(false);
          setUpdateInfo(null);
          setUpdateHandle(null);
          setIsDismissed(false);
          return false; // 已是最新
        }
      } catch (err) {
        console.error("检查更新失败:", err);
        setError(err instanceof Error ? err.message : "检查更新失败");
        setHasUpdate(false);
        setUpdateInfo(null);
        setUpdateHandle(null);
        throw err; // 抛出错误让调用方处理
      } finally {
        setIsChecking(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = operation;
    return operation;
  }, []);

  const dismissUpdate = useCallback(() => {
    setIsDismissed(true);
    if (updateInfo?.availableVersion) {
      writePreference(DISMISSED_VERSION_KEY, updateInfo.availableVersion);
      // 清理旧键
      removePreference(LEGACY_DISMISSED_KEY);
    }
  }, [updateInfo?.availableVersion]);

  const resetDismiss = useCallback(() => {
    setIsDismissed(false);
    removePreference(DISMISSED_VERSION_KEY);
    removePreference(LEGACY_DISMISSED_KEY);
  }, []);

  // Startup, six-hour polling, and a throttled wake/reconnect check.
  useEffect(() => {
    const run = () => {
      void checkUpdate().catch(() => {});
    };
    const wake = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastCheckAt.current >= 15 * 60_000
      )
        run();
    };
    const timer = window.setTimeout(run, 1000);
    const interval = window.setInterval(run, 6 * 60 * 60_000);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [checkUpdate]);

  // Global toast also reaches the creative workspace where the host header folds.
  useEffect(() => {
    if (!hasUpdate) {
      toast.dismiss("tuzi-client-update");
      return;
    }
    if (
      !hasUpdate ||
      !updateInfo ||
      !updateHandle ||
      isDismissed ||
      notifiedVersion.current === updateInfo.availableVersion
    )
      return;
    notifiedVersion.current = updateInfo.availableVersion;
    toast.info(t("settings.updateNoticeTitle"), {
      id: "tuzi-client-update",
      duration: 15000,
      description: t(
        updateInfo.channel === "acceptance"
          ? "settings.acceptanceUpdateNotice"
          : "settings.manualUpdateHint",
      ),
      action: {
        label: t("settings.downloadUpdate"),
        onClick: () => {
          const open = updateHandle.manual
            ? updateHandle.downloadAndInstall()
            : openReleasePage(updateInfo.availableVersion);
          void open
            .then(() => toast.success(t("settings.updatePageOpened")))
            .catch(() => toast.error(t("settings.updateDownloadFailed")));
        },
      },
      cancel: { label: t("settings.updateLater"), onClick: dismissUpdate },
      onDismiss: dismissUpdate,
    });
  }, [hasUpdate, updateInfo, updateHandle, isDismissed, dismissUpdate, t]);

  const value: UpdateContextValue = {
    hasUpdate,
    updateInfo,
    updateHandle,
    isChecking,
    error,
    isDismissed,
    dismissUpdate,
    checkUpdate,
    resetDismiss,
  };

  return (
    <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
  );
}

export function useUpdate() {
  const context = useContext(UpdateContext);
  if (!context) {
    throw new Error("useUpdate must be used within UpdateProvider");
  }
  return context;
}
