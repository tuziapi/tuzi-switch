
import React, { useState, useEffect } from 'react';
import { Button, Dialog } from 'tdesign-react';
import { useTaskQueue } from '../../hooks/useTaskQueue';
import { RefreshIcon } from 'tdesign-icons-react';
import type { DesktopUpdateState } from '../../utils/desktop-update-state';
import { isTauriEnvironment } from '../../utils/tauri-env';
import './version-update-prompt.scss';

export const VersionUpdatePrompt: React.FC<{
  prepareDesktopUpdate?: () => Promise<void>;
}> = ({ prepareDesktopUpdate }) => {
  const [updateAvailable, setUpdateAvailable] = useState<{
    version: string;
    changelog?: string[];
  } | DesktopUpdateState | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState('');
  const { activeTasks } = useTaskQueue();

  useEffect(() => {
    const handleUpdateAvailable = async (event: Event) => {
      const customEvent = event as CustomEvent;
      const newVersion = customEvent.detail?.version;
      const isDesktopUpdate = customEvent.detail?.desktop === true;
      if (isDesktopUpdate !== isTauriEnvironment()) return;
      if (isDesktopUpdate && newVersion) {
        setUpdateAvailable(customEvent.detail);
        return;
      }
      
      // 获取当前运行的版本（从 HTML meta 标签）
      const currentVersionMeta = document.querySelector('meta[name="app-version"]');
      const currentVersion = currentVersionMeta?.getAttribute('content');
      
      try {
        // Fetch detailed version info (changelog)
        const res = await fetch(`./version.json?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          
          if (currentVersion && data.version === currentVersion) {
            // console.log('[VersionUpdatePrompt] Already on latest version, skipping prompt');
            return;
          }
          
          // Use fetched data if versions match or if event didn't specify version
          if (!newVersion || data.version === newVersion) {
            setUpdateAvailable(data);
            return;
          }
        }
      } catch (error) {
        console.warn('Failed to fetch version.json:', error);
      }

      // 如果无法获取 version.json，但事件带了版本号，检查是否相同
      if (currentVersion && newVersion && currentVersion === newVersion) {
        return; // 已经是最新版本
      }

      // Fallback to event detail
      if (newVersion) {
        setUpdateAvailable(customEvent.detail);
      }
    };

    window.addEventListener('sw-update-available', handleUpdateAvailable);
    const handleCheck = () => {
      if (window.__OPENTU_DESKTOP_UPDATE_CHECK__?.status === 'current') setUpdateAvailable(null);
    };
    window.addEventListener('desktop-update-check-state', handleCheck);

    const queuedUpdate = window.__OPENTU_DESKTOP_UPDATE_EVENT__;
    if (queuedUpdate) {
      void handleUpdateAvailable(
        new CustomEvent('sw-update-available', { detail: queuedUpdate })
      );
    }

    // 调试辅助：在开发环境下挂载手动触发方法
    if (process.env.NODE_ENV === 'development') {
      (window as any).__debugTriggerUpdate = (version = '9.9.9') => {
        // console.log('[Debug] Triggering update prompt');
        window.dispatchEvent(new CustomEvent('sw-update-available', { 
          detail: { version } 
        }));
      };
      // console.log('[VersionUpdatePrompt] Debug mode: run window.__debugTriggerUpdate() to test');
    }

    return () => {
      window.removeEventListener('sw-update-available', handleUpdateAvailable);
      window.removeEventListener('desktop-update-check-state', handleCheck);
    };
  }, []);

  const desktopUpdate = updateAvailable && 'desktop' in updateAvailable
    ? updateAvailable as DesktopUpdateState
    : null;
  const busy = preparing || Boolean(desktopUpdate && ['downloading', 'installing', 'restarting'].includes(desktopUpdate.status));
  const actionLabel = desktopUpdate?.downloadUrl ? '下载新版' : desktopUpdate?.status === 'error' ? desktopUpdate.restartOnly ? '重启应用' : '重试更新' : '立即更新';
  const handleUpdate = async () => {
    if (busy || activeTasks.length > 0) return;
    setPrepareError('');
    if (desktopUpdate && !desktopUpdate.downloadUrl && prepareDesktopUpdate) {
      setPreparing(true);
      try {
        await prepareDesktopUpdate();
      } catch (error) {
        setPrepareError(error instanceof Error ? error.message : '准备更新失败，请重试');
        return;
      } finally {
        setPreparing(false);
      }
    }
    // Keep the prompt visible until the new SW actually takes over.
    // Otherwise a failed COMMIT_UPGRADE looks like a successful update.
    setShowChangelog(false);
    // Dispatch event to notify main.tsx to proceed with upgrade
    window.dispatchEvent(new CustomEvent('user-confirmed-upgrade'));
  };

  // Desktop users can see a release while generating; installation still waits.
  if (!updateAvailable || (!desktopUpdate && activeTasks.length > 0 && !busy)) {
    return null;
  }

  return (
    <>
      <div className="version-update-prompt">
        <div className="version-update-prompt__content">
          <span className="version-update-prompt__text">
            {desktopUpdate?.status === 'downloading'
              ? `正在下载 v${updateAvailable.version}${desktopUpdate.progress !== undefined ? ` · ${desktopUpdate.progress}%` : ''}`
              : desktopUpdate?.status === 'installing'
              ? '正在验证并安装更新'
              : desktopUpdate?.status === 'restarting'
              ? '更新已安装，正在重启'
              : desktopUpdate?.status === 'error'
              ? desktopUpdate.errorMessage || (desktopUpdate.restartOnly ? '更新已安装，重启失败' : desktopUpdate.downloadUrl ? '下载页面打开失败，请重试' : '更新未完成，请重试或手动安装新版')
              : `发现新版本 v${updateAvailable.version}`}
          </span>
          {updateAvailable.changelog && updateAvailable.changelog.length > 0 && (
            <Button
              theme="default"
              variant="text"
              size="small"
              onClick={() => setShowChangelog(true)}
            >
              查看更新内容
            </Button>
          )}
          <Button 
            theme="primary" 
            size="small" 
            onClick={handleUpdate}
            disabled={busy || activeTasks.length > 0}
            loading={busy}
            icon={<RefreshIcon />}
          >
            {actionLabel}
          </Button>
          {desktopUpdate && activeTasks.length > 0 && !busy && (
            <span className="version-update-prompt__text">生成任务进行中，完成后可更新</span>
          )}
          {prepareError && <span role="alert" className="version-update-prompt__text">{prepareError}</span>}
        </div>
      </div>

      <Dialog
        header={`新版本 v${updateAvailable.version} 更新内容`}
        visible={showChangelog}
        onClose={() => setShowChangelog(false)}
        width="min(600px, calc(100vw - 32px))"
        footer={
          <Button theme="primary" onClick={handleUpdate} disabled={busy || activeTasks.length > 0} loading={busy}>
            {actionLabel}
          </Button>
        }
      >
        <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '8px' }}>
          <ul style={{ paddingLeft: '20px', margin: 0 }}>
            {updateAvailable.changelog?.map((item, index) => (
              <li key={index} style={{ marginBottom: '4px', lineHeight: '1.5' }}>{index + 1}. {item}</li>
            ))}
          </ul>
        </div>
      </Dialog>
    </>
  );
};
