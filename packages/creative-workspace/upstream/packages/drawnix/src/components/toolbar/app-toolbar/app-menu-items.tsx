import {
  ExportImageIcon,
  SettingsIcon,
  OpenFileIcon,
  SaveFileIcon,
  TrashIcon,
  GithubIcon,
  BackupRestoreIcon,
  DebugLogIcon,
  BookOpenIcon,
  CloudIcon,
  CleanBrokenLinksIcon,
  CommandPaletteIcon,
} from '../../icons';
import { useBoard, useListRender } from '@plait-board/react-board';
import {
  BoardTransforms,
  PlaitBoard,
  PlaitElement,
  PlaitTheme,
  ThemeColorMode,
  Viewport,
  Transforms,
  clearSelectedElement,
} from '@plait/core';
import { PlaitDrawElement } from '@plait/draw';
import { isVideoElement } from '../../../plugins/with-video';
import { isWorkZoneElement } from '../../../plugins/workzone-transforms';
import { isImageGenerationAnchorElement } from '../../../types/image-generation-anchor.types';
import { MessagePlugin } from 'tdesign-react';
import { loadFromJSON, saveAsJSON } from '../../../data/json';
import MenuItem from '../../menu/menu-item';
import { saveAsImage } from '../../../utils/image';
import { useDrawnix } from '../../../hooks/use-drawnix';
import { useI18n } from '../../../i18n';
import { useLatestRelease } from '../../../hooks/useLatestRelease';
import Menu from '../../menu/menu';
import { useContext, useState, useCallback, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { DESKTOP_DOWNLOAD_PAGE, publishDesktopUpdate, type DesktopUpdateCheckState, type DesktopUpdateState } from '../../../utils/desktop-update-state';
import { MenuContentPropsContext } from '../../menu/common';
import { EVENT } from '../../../constants';
import { queueProviderSettingsNavigation } from '../../settings-dialog/provider-settings-navigation';
import { LEGACY_DEFAULT_PROVIDER_PROFILE_ID } from '../../../utils/settings-manager';

export const SaveToFile = () => {
  const board = useBoard();
  const { t } = useI18n();
  return (
    <MenuItem
      data-testid="save-button"
      data-track="toolbar_click_menu_save"
      onSelect={() => {
        saveAsJSON(board);
      }}
      icon={<SaveFileIcon />}
      aria-label={t('menu.saveFile')}
      shortcut={`Cmd+S`}
    >
      {t('menu.saveFile')}
    </MenuItem>
  );
};
SaveToFile.displayName = 'SaveToFile';

export const OpenFile = () => {
  const board = useBoard();
  const listRender = useListRender();
  const { t } = useI18n();
  const clearAndLoad = (
    value: PlaitElement[],
    viewport?: Viewport,
    theme?: PlaitTheme
  ) => {
    board.children = value;
    board.history.undos = [];
    board.history.redos = [];
    clearSelectedElement(board);
    board.selection = null;
    board.viewport = viewport || { zoom: 1 };
    board.theme = theme || { themeColorMode: ThemeColorMode.default };
    listRender.update(board.children, {
      board: board,
      parent: board,
      parentG: PlaitBoard.getElementHost(board),
    });
    BoardTransforms.fitViewport(board);
  };
  return (
    <MenuItem
      data-testid="open-button"
      data-track="toolbar_click_menu_open"
      onSelect={() => {
        loadFromJSON(board).then((data) => {
          if (!data) {
            return;
          }
          clearAndLoad(data.elements, data.viewport);
        });
      }}
      icon={<OpenFileIcon />}
      aria-label={t('menu.open')}
    >
      {t('menu.open')}
    </MenuItem>
  );
};
OpenFile.displayName = 'OpenFile';

export const SaveAsImage = () => {
  const board = useBoard();
  const menuContentProps = useContext(MenuContentPropsContext);
  const { t } = useI18n();
  return (
    <MenuItem
      icon={<ExportImageIcon />}
      data-testid="image-export-button"
      data-track="toolbar_click_menu_export"
      onSelect={() => {
        saveAsImage(board, true);
      }}
      submenu={
        <Menu
          onSelect={() => {
            const itemSelectEvent = new CustomEvent(EVENT.MENU_ITEM_SELECT, {
              bubbles: true,
              cancelable: true,
            });
            menuContentProps.onSelect?.(itemSelectEvent);
          }}
        >
          <MenuItem
            data-track="toolbar_click_menu_export_png"
            onSelect={() => {
              saveAsImage(board, true);
            }}
            aria-label={t('menu.exportImage.png')}
          >
            {t('menu.exportImage.png')}
          </MenuItem>
          <MenuItem
            data-track="toolbar_click_menu_export_jpg"
            onSelect={() => {
              saveAsImage(board, false);
            }}
            aria-label={t('menu.exportImage.jpg')}
          >
            {t('menu.exportImage.jpg')}
          </MenuItem>
        </Menu>
      }
      shortcut={`Cmd+Shift+E`}
      aria-label={t('menu.exportImage')}
    >
      {t('menu.exportImage')}
    </MenuItem>
  );
};
SaveAsImage.displayName = 'SaveAsImage';

export const CleanBoard = () => {
  const { appState, setAppState } = useDrawnix();
  const { t } = useI18n();
  return (
    <MenuItem
      icon={<TrashIcon />}
      data-testid="reset-button"
      data-track="toolbar_click_menu_clean"
      onSelect={() => {
        setAppState({
          ...appState,
          openCleanConfirm: true,
        });
      }}
      shortcut={`Cmd+Backspace`}
      aria-label={t('menu.cleanBoard')}
    >
      {t('menu.cleanBoard')}
    </MenuItem>
  );
};
CleanBoard.displayName = 'CleanBoard';

export const BackupRestore = ({
  onOpenBackupRestore,
}: {
  onOpenBackupRestore: () => void;
}) => {
  const { t } = useI18n();
  return (
    <MenuItem
      icon={<BackupRestoreIcon />}
      data-track="toolbar_click_menu_backup"
      onSelect={onOpenBackupRestore}
      aria-label={t('menu.backupRestore')}
    >
      {t('menu.backupRestore')}
    </MenuItem>
  );
};
BackupRestore.displayName = 'BackupRestore';

export const CloudSync = ({
  onOpenCloudSync,
}: {
  onOpenCloudSync: () => void;
}) => {
  const { t } = useI18n();
  return (
    <MenuItem
      icon={<CloudIcon />}
      data-track="toolbar_click_menu_cloud_sync"
      onSelect={onOpenCloudSync}
      aria-label={t('menu.cloudSync')}
    >
      {t('menu.cloudSync')}
    </MenuItem>
  );
};
CloudSync.displayName = 'CloudSync';

export const DebugPanel = () => {
  const { t } = useI18n();
  return (
    <MenuItem
      icon={<DebugLogIcon />}
      data-track="toolbar_click_menu_debug"
      onSelect={() => {
        window.location.href = './sw-debug.html';
      }}
      aria-label={t('menu.debugPanel')}
    >
      {t('menu.debugPanel')}
    </MenuItem>
  );
};
DebugPanel.displayName = 'DebugPanel';

export const Settings = () => {
  const { setAppState } = useDrawnix();
  const { t } = useI18n();
  return (
    <MenuItem
      icon={<SettingsIcon />}
      data-track="toolbar_click_menu_settings"
      onSelect={() => {
        queueProviderSettingsNavigation({
          action: 'select',
          profileId: LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
        });
        setAppState((prev) => ({ ...prev, openSettings: true }));
      }}
      aria-label={t('menu.settings')}
    >
      {t('menu.settings')}
    </MenuItem>
  );
};
Settings.displayName = 'Settings';

export const GitHubLink = () => {
  const { t } = useI18n();
  return (
    <MenuItem
      icon={<GithubIcon />}
      data-track="toolbar_click_menu_github"
      onSelect={() => {
        const isTauri = typeof window !== 'undefined' && !!(window as any).__TUZI_CREATIVE_NATIVE__;
        if (isTauri) {
          (window as any).__TUZI_CREATIVE_NATIVE__.invoke('plugin:opener|open_url', { url: 'https://github.com/AiW520/opentu' });
        } else {
          window.open('https://github.com/ljquan/aitu', '_blank');
        }
      }}
      aria-label={t('menu.github')}
    >
      {t('menu.github')}
    </MenuItem>
  );
};
GitHubLink.displayName = 'GitHubLink';

export const QuickCommands = () => {
  const { appState, setAppState } = useDrawnix();
  const { t } = useI18n();
  return (
    <MenuItem
      icon={<CommandPaletteIcon />}
      data-track="toolbar_click_menu_commands"
      onSelect={() => {
        setAppState({
          ...appState,
          openCommandPalette: true,
        });
      }}
      shortcut="Cmd+K"
      aria-label={t('menu.commandPalette')}
    >
      {t('menu.commandPalette')}
    </MenuItem>
  );
};
QuickCommands.displayName = 'QuickCommands';

export const UserManual = () => {
  const { t } = useI18n();
  return (
    <MenuItem
      icon={<BookOpenIcon />}
      data-track="toolbar_click_menu_manual"
      onSelect={() => {
        const isTauri = typeof window !== 'undefined' && !!(window as any).__TUZI_CREATIVE_NATIVE__;
        if (isTauri) {
          (window as any).__TUZI_CREATIVE_NATIVE__.invoke('plugin:opener|open_url', { url: 'https://opentu.ai/user-manual/index.html' });
        } else {
          window.open('./user-manual/index.html', '_blank');
        }
      }}
      aria-label={t('menu.userManual')}
    >
      {t('menu.userManual')}
    </MenuItem>
  );
};
UserManual.displayName = 'UserManual';

export const VersionInfo = () => {
  const { t } = useI18n();
  // The integrated host has its own HTML, so use the injected build version.
  const version = import.meta.env.VITE_TUZI_ASSISTANT === 'true' ? __APP_VERSION__ : document.querySelector('meta[name="app-version"]')?.getAttribute('content') || '0.0.0';
  const isDesktop = !!(window as any).__TUZI_CREATIVE_NATIVE__;
  const webLatest = useLatestRelease(version, !isDesktop);
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateState | undefined>(window.__OPENTU_DESKTOP_UPDATE_EVENT__);
  const [checkState, setCheckState] = useState<DesktopUpdateCheckState | undefined>(window.__OPENTU_DESKTOP_UPDATE_CHECK__);
  useEffect(() => {
    if (!isDesktop) return;
    const sync = () => {
      setDesktopUpdate(window.__OPENTU_DESKTOP_UPDATE_EVENT__);
      setCheckState(window.__OPENTU_DESKTOP_UPDATE_CHECK__);
    };
    sync();
    window.addEventListener('sw-update-available', sync);
    window.addEventListener('desktop-update-check-state', sync);
    return () => {
      window.removeEventListener('sw-update-available', sync);
      window.removeEventListener('desktop-update-check-state', sync);
    };
  }, [isDesktop]);
  const latest = isDesktop ? desktopUpdate && { tag: `v${desktopUpdate.version}`, url: DESKTOP_DOWNLOAD_PAGE } : webLatest;

  const openExternalUrl = (url: string) => {
    const isTauri = typeof window !== 'undefined' && !!(window as any).__TUZI_CREATIVE_NATIVE__;
    if (isTauri) {
      (window as any).__TUZI_CREATIVE_NATIVE__.invoke('plugin:opener|open_url', { url });
    } else {
      window.open(url, '_blank');
    }
  };

  return (
    <>
    {isDesktop && <MenuItem
      icon={<RefreshCw size={16} />}
      data-testid="desktop-check-for-updates"
      onSelect={() => window.dispatchEvent(new CustomEvent('desktop-check-for-updates'))}
      aria-label="检查更新"
    >
      {checkState?.status === 'checking' ? '正在检查更新…' : checkState?.status === 'current' ? '已是最新版本 · 再次检查' : checkState?.status === 'error' ? '检查失败 · 重试' : '检查更新'}
    </MenuItem>}
    <MenuItem
      data-track="toolbar_click_menu_version"
      onSelect={() => {}}
      aria-label={t('menu.version')}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          width: '100%',
        }}
      >
        <span style={{ color: '#666' }}>
          {t('menu.version')}：{version}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          {latest && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 999,
                background: 'rgba(243, 156, 18, 0.16)',
                color: '#b7791f',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
              data-track="toolbar_click_menu_update_available"
              title={t('menu.updateAvailable').replace('{version}', latest.tag)}
              onClick={(e) => {
                e.stopPropagation();
                if (desktopUpdate) publishDesktopUpdate(desktopUpdate);
                else openExternalUrl(latest.url);
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#f39c12',
                  display: 'inline-block',
                }}
              />
              {t('menu.updateAvailableLabel')} {latest.tag}
            </span>
          )}
          <span
            style={{ color: '#1890ff', cursor: 'pointer' }}
            data-track="toolbar_click_menu_changelog"
            onClick={(e) => {
              e.stopPropagation();
              openExternalUrl(isDesktop ? 'https://github.com/AiW520/opentuAI/releases' : './versions.html');
            }}
          >
            {t('menu.changelog')}
          </span>
          <span
            style={{ color: '#1890ff', cursor: 'pointer' }}
            data-track="toolbar_click_menu_more_versions"
            onClick={(e) => {
              e.stopPropagation();
              openExternalUrl(isDesktop ? DESKTOP_DOWNLOAD_PAGE : 'https://release.opentu.ai/');
            }}
          >
            {t('menu.more')}
          </span>
        </span>
      </span>
    </MenuItem>
    </>
  );
};
VersionInfo.displayName = 'VersionInfo';

/**
 * 检查 URL 是否有效
 * 对于虚拟路径和外部 URL 进行不同的检查策略
 */
async function checkUrlValidity(url: string): Promise<boolean> {
  if (!url || typeof url !== 'string') {
    return false;
  }

  // blob URL 直接视为有效（临时 URL）
  if (url.startsWith('blob:')) {
    return true;
  }

  // data URL 直接视为有效
  if (url.startsWith('data:')) {
    return true;
  }

  try {
    // 对于虚拟路径和外部 URL，尝试 HEAD 请求检查
    const response = await fetch(url, {
      method: 'HEAD',
      mode: 'cors',
      cache: 'no-cache',
    });
    return response.ok;
  } catch {
    // HEAD 请求失败，尝试 GET 请求
    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'no-cors', // 使用 no-cors 模式尝试获取
        cache: 'no-cache',
      });
      // no-cors 模式下，opaque response 类型表示请求成功但无法读取内容
      // 这种情况我们认为是有效的
      return response.type === 'opaque' || response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * 判断画布上的生成占位卡片是否已经进入失败终态。
 * 这类元素没有可供 HEAD/GET 检查的媒体 URL，但仍属于失效生成内容。
 */
function isFailedGenerationElement(element: PlaitElement): boolean {
  if (isImageGenerationAnchorElement(element)) {
    return element.phase === 'failed';
  }

  if (isWorkZoneElement(element)) {
    return (
      element.workflow?.status === 'failed' ||
      element.workflow?.steps?.some((step) => step.status === 'failed') === true
    );
  }

  return false;
}

/**
 * 清除失效链接菜单项
 */
export const CleanInvalidLinks = () => {
  const board = useBoard();
  const { t } = useI18n();
  const [isScanning, setIsScanning] = useState(false);

  const handleCleanInvalidLinks = useCallback(async () => {
    if (isScanning) return;

    setIsScanning(true);
    const loadingInstance = MessagePlugin.loading(
      t('menu.cleanInvalidLinks.scanning'),
      0
    );

    try {
      // 收集所有媒体元素，以及已经失败的生成占位卡片
      const mediaElements: { element: PlaitElement; index: number; url: string }[] = [];
      const invalidElements: { element: PlaitElement; index: number }[] = [];

      for (let i = 0; i < board.children.length; i++) {
        const element = board.children[i];

        if (isFailedGenerationElement(element)) {
          invalidElements.push({ element, index: i });
          continue;
        }

        const url = (element as any).url;

        if (!url || typeof url !== 'string') continue;

        // 检查是否为图片或视频元素
        const isImage =
          PlaitDrawElement.isDrawElement(element) &&
          PlaitDrawElement.isImage(element);
        const isVideo = isVideoElement(element);

        if (isImage || isVideo) {
          mediaElements.push({ element, index: i, url });
        }
      }

      // 检查每个媒体元素的 URL 有效性
      await Promise.all(
        mediaElements.map(async ({ element, index, url }) => {
          const isValid = await checkUrlValidity(url);
          if (!isValid) {
            invalidElements.push({ element, index });
          }
        })
      );

      // 关闭 loading 提示
      loadingInstance.then((instance) => instance?.close?.());

      if (invalidElements.length === 0) {
        MessagePlugin.success(t('menu.cleanInvalidLinks.noInvalid'));
        setIsScanning(false);
        return;
      }

      // 从后往前删除，避免索引偏移问题
      invalidElements.sort((a, b) => b.index - a.index);

      for (const { index } of invalidElements) {
        Transforms.removeNode(board, [index]);
      }

      const successMessage = t('menu.cleanInvalidLinks.success').replace(
        '{count}',
        String(invalidElements.length)
      );
      MessagePlugin.success(successMessage);
    } catch (error) {
      // 关闭 loading 提示
      loadingInstance.then((instance) => instance?.close?.());
      MessagePlugin.error(t('menu.cleanInvalidLinks.error'));
      console.error('[CleanInvalidLinks] Error:', error);
    } finally {
      setIsScanning(false);
    }
  }, [board, t, isScanning]);

  return (
    <MenuItem
      icon={<CleanBrokenLinksIcon />}
      data-track="toolbar_click_menu_clean_invalid_links"
      onSelect={handleCleanInvalidLinks}
      aria-label={t('menu.cleanInvalidLinks')}
      disabled={isScanning}
    >
      {t('menu.cleanInvalidLinks')}
    </MenuItem>
  );
};
CleanInvalidLinks.displayName = 'CleanInvalidLinks';
