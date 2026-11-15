import React, { Suspense, lazy } from 'react';
import type { PlaitElement } from '@plait/core';
import type { DrawnixBoard } from '../../hooks/use-drawnix';
import type { Board as WorkspaceBoard } from '../../types/workspace.types';
import type { MediaLibraryConfig } from '../../types/asset.types';
import { useDrawnix } from '../../hooks/use-drawnix';
import './deferred-features.scss';

const ProjectDrawer = lazy(() =>
  import('../project-drawer/ProjectDrawer').then((module) => ({
    default: module.ProjectDrawer,
  }))
);
const ToolboxDrawer = lazy(() =>
  import('../toolbox-drawer/ToolboxDrawer').then((module) => ({
    default: module.ToolboxDrawer,
  }))
);
const MediaLibraryModal = lazy(() =>
  import('./DeferredMediaLibraryModal').then((module) => ({
    default: module.DeferredMediaLibraryModal,
  }))
);
const BackupRestoreDialog = lazy(() =>
  import('../backup-restore/backup-restore-dialog').then((module) => ({
    default: module.BackupRestoreDialog,
  }))
);
const PerformancePanel = lazy(() =>
  import('../performance-panel/PerformancePanel').then((module) => ({
    default: module.PerformancePanel,
  }))
);
const SyncSettings = lazy(() =>
  import('./DeferredSyncSettings').then((module) => ({
    default: module.DeferredSyncSettings,
  }))
);
const CommandPalette = lazy(() =>
  import('../command-palette/command-palette').then((module) => ({
    default: module.CommandPalette,
  }))
);
const CanvasSearch = lazy(() =>
  import('../canvas-search/canvas-search').then((module) => ({
    default: module.CanvasSearch,
  }))
);
const ToolWinBoxManager = lazy(() =>
  import('../toolbox-drawer/ToolWinBoxManager').then((module) => ({
    default: module.ToolWinBoxManager,
  }))
);

interface DrawnixDeferredFeaturesProps {
  board: DrawnixBoard | null;
  value: PlaitElement[];
  containerRef: React.RefObject<HTMLDivElement>;
  performancePanelEnabled: boolean;
  toolWindowManagerEnabled: boolean;
  projectDrawerOpen: boolean;
  toolboxDrawerOpen: boolean;
  mediaLibraryOpen: boolean;
  mediaLibraryConfig?: Partial<MediaLibraryConfig> & {
    selectButtonText?: string;
    batchSelectButtonText?: string;
  };
  backupRestoreOpen: boolean;
  cloudSyncOpen: boolean;
  onBoardSwitch?: (board: WorkspaceBoard) => void;
  setProjectDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setToolboxDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMediaLibraryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setBackupRestoreOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCloudSyncOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleOpenMediaLibrary: (
    config?: Partial<MediaLibraryConfig> & {
      selectButtonText?: string;
      batchSelectButtonText?: string;
    }
  ) => void;
  handleBeforeSwitch: () => Promise<void>;
  onCreateProjectForMemory: () => Promise<void>;
}

export function DrawnixDeferredFeatures({
  board,
  value,
  containerRef,
  performancePanelEnabled,
  toolWindowManagerEnabled,
  projectDrawerOpen,
  toolboxDrawerOpen,
  mediaLibraryOpen,
  mediaLibraryConfig,
  backupRestoreOpen,
  cloudSyncOpen,
  onBoardSwitch,
  setProjectDrawerOpen,
  setToolboxDrawerOpen,
  setMediaLibraryOpen,
  setBackupRestoreOpen,
  setCloudSyncOpen,
  handleOpenMediaLibrary,
  handleBeforeSwitch,
  onCreateProjectForMemory,
}: DrawnixDeferredFeaturesProps) {
  const { appState, setAppState } = useDrawnix();
  const commandPaletteOpen = appState.openCommandPalette || false;
  const canvasSearchOpen = appState.openCanvasSearch || false;

  return (
    <>
      {mediaLibraryOpen && (
        <Suspense fallback={null}>
          <MediaLibraryModal
            isOpen={mediaLibraryOpen}
            onClose={() => setMediaLibraryOpen(false)}
            mode={mediaLibraryConfig?.mode}
            filterType={mediaLibraryConfig?.filterType}
            onSelect={mediaLibraryConfig?.onSelect}
            onSelectMultiple={mediaLibraryConfig?.onSelectMultiple}
            selectButtonText={mediaLibraryConfig?.selectButtonText}
            batchSelectButtonText={mediaLibraryConfig?.batchSelectButtonText}
          />
        </Suspense>
      )}
      {backupRestoreOpen && (
        <Suspense fallback={null}>
          <BackupRestoreDialog
            open={backupRestoreOpen}
            onOpenChange={setBackupRestoreOpen}
            container={containerRef.current}
            onBeforeImport={async () => {
              await handleBeforeSwitch();
            }}
            onSwitchBoard={async (boardId, viewport) => {
              const { workspaceService } = await import(
                '../../services/workspace-service'
              );
              const nextBoard = await workspaceService.switchBoard(boardId);
              if (nextBoard && onBoardSwitch) {
                if (viewport) {
                  nextBoard.viewport = viewport;
                }
                onBoardSwitch(nextBoard);
              }
            }}
          />
        </Suspense>
      )}
      {cloudSyncOpen && (
        <Suspense fallback={null}>
          <SyncSettings
            visible={cloudSyncOpen}
            onClose={() => setCloudSyncOpen(false)}
          />
        </Suspense>
      )}
      {toolWindowManagerEnabled && (
        <Suspense fallback={null}>
          <ToolWinBoxManager />
        </Suspense>
      )}
      {commandPaletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            open={commandPaletteOpen}
            onClose={() => {
              setAppState((prev) => ({
                ...prev,
                openCommandPalette: false,
              }));
            }}
            board={board}
            container={containerRef.current}
          />
        </Suspense>
      )}
      {canvasSearchOpen && (
        <Suspense fallback={null}>
          <CanvasSearch
            open={canvasSearchOpen}
            onClose={() => {
              setAppState((prev) => ({
                ...prev,
                openCanvasSearch: false,
              }));
            }}
            board={board}
          />
        </Suspense>
      )}
      {performancePanelEnabled && (
        <Suspense fallback={null}>
          <PerformancePanel
            container={containerRef.current}
            onCreateProject={onCreateProjectForMemory}
            elements={board?.children || value}
          />
        </Suspense>
      )}
      {projectDrawerOpen && (
        <Suspense fallback={null}>
          <ProjectDrawer
            isOpen={projectDrawerOpen}
            onOpenChange={setProjectDrawerOpen}
            onBeforeSwitch={handleBeforeSwitch}
            onBoardSwitch={onBoardSwitch}
            onOpenMediaLibrary={handleOpenMediaLibrary}
          />
        </Suspense>
      )}
      {toolboxDrawerOpen && (
        <Suspense fallback={null}>
          <ToolboxDrawer
            isOpen={toolboxDrawerOpen}
            onOpenChange={setToolboxDrawerOpen}
          />
        </Suspense>
      )}
    </>
  );
}

export default DrawnixDeferredFeatures;
