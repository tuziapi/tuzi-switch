/**
 * Backup & Restore - Type Definitions
 */

import type {
  PromptHistoryItem,
  VideoPromptHistoryItem,
  ImagePromptHistoryItem,
  PromptHistoryOverride,
  PromptType,
} from '../prompt-storage-service';
import type { PlaitTheme, PlaitElement as CorePlaitElement } from '@plait/core';
import type { EmbeddedMediaItem } from '../../data/types';
import type { Folder } from '../../types/workspace.types';

// 备份文件版本（v4 支持完整环境备份/覆盖恢复）
export const BACKUP_VERSION = 4;

// 备份文件标识
export const BACKUP_SIGNATURE = 'aitu-backup';

export interface PresetPromptSettings {
  pinnedPrompts: string[];
  deletedPrompts: string[];
}

export type PresetStorageData = Record<PromptType, PresetPromptSettings>;

export type BackupMode = 'incremental' | 'complete';
export type ImportMode = 'merge' | 'replace';

export interface BackupDomainStats {
  count: number;
  checksum?: string;
  bytes?: number;
}

export interface BackupEncryptionInfo {
  enabled: boolean;
  algorithm?: 'AES-GCM';
  kdf?: 'PBKDF2-SHA256';
  secretsFile?: string;
}

export interface BackupOptions {
  mode?: BackupMode;
  includePrompts: boolean;
  includeProjects: boolean;
  includeAssets: boolean;
  includeKnowledgeBase: boolean;
  includeEnvironment?: boolean;
  includeSecrets?: boolean;
  encryptionPassword?: string;
  /** 导出时间范围起点（毫秒时间戳，包含） */
  timeRangeStart?: number | null;
  /** 导出时间范围终点（毫秒时间戳，包含） */
  timeRangeEnd?: number | null;
}

export interface ImportOptions {
  mode?: ImportMode;
  encryptionPassword?: string;
  selectedDomains?: string[];
}

export interface BackupWorkspaceState {
  currentBoardId: string | null;
  currentBoardName?: string;
  viewport?: {
    zoom: number;
    origination?: [number, number];
  };
}

export interface BackupManifest {
  signature: string;
  version: number;
  schemaVersion?: number;
  backupMode?: BackupMode;
  createdAt: number;
  source?: string;
  includes: {
    prompts: boolean;
    projects: boolean;
    assets: boolean;
    tasks: boolean;
    knowledgeBase: boolean;
    environment?: boolean;
  };
  encryption?: BackupEncryptionInfo;
  stats: {
    promptCount: number;
    videoPromptCount: number;
    imagePromptCount: number;
    folderCount: number;
    boardCount: number;
    assetCount: number;
    taskCount: number;
    kbNoteCount: number;
    workflowCount?: number;
    environmentItemCount?: number;
    chatSessionCount?: number;
    audioPlaylistCount?: number;
    characterCount?: number;
  };
  domainStats?: Record<string, BackupDomainStats>;
  workspaceState?: BackupWorkspaceState;
  // v3 分片字段
  backupId?: string;
  partIndex?: number;
  totalParts?: number | null;
  isFinalPart?: boolean;
}

export interface PromptsData {
  promptHistory: PromptHistoryItem[];
  videoPromptHistory: VideoPromptHistoryItem[];
  imagePromptHistory: ImagePromptHistoryItem[];
  presetSettings: PresetStorageData;
  deletedPromptContents?: string[];
  promptHistoryOverrides?: PromptHistoryOverride[];
}

export interface DrawnixFileData {
  type: string;
  version: number;
  source: string;
  elements: PlaitElement[];
  viewport: Viewport;
  theme?: PlaitTheme;
  embeddedMedia?: EmbeddedMediaItem[];
  boardMeta?: {
    id: string;
    name: string;
    folderId: string | null;
    order: number;
    createdAt: number;
    updatedAt: number;
  };
}

export interface BackupProjectFoldersData {
  folders: Folder[];
}

export interface Viewport {
  zoom: number;
  origination?: [number, number];
}

export interface PlaitElement {
  id?: string;
  type?: string;
  assetId?: string;
  imageAssetId?: string;
  videoAssetId?: string;
  children?: PlaitElement[];
  [key: string]: unknown;
}

export interface ImportResult {
  success: boolean;
  mode?: ImportMode;
  prompts: { imported: number; skipped: number };
  projects: { folders: number; boards: number; merged: number; skipped: number };
  assets: { imported: number; skipped: number };
  tasks: { imported: number; skipped: number };
  knowledgeBase: { directories: number; notes: number; tags: number; skipped: number };
  environment?: { imported: number; skipped: number };
  domains?: Record<string, { imported: number; skipped: number; checksum?: string }>;
  warnings: string[];
  errors: string[];
  workspaceState?: BackupWorkspaceState;
}

export interface ExportResult {
  files: Array<{ filename: string; size: number }>;
  totalParts: number;
  stats: BackupManifest['stats'];
  domainStats?: BackupManifest['domainStats'];
  warnings?: string[];
}

export type ProgressCallback = (progress: number, message: string) => void;

/**
 * 确保所有元素都有 id
 */
export function ensureElementIds(elements: PlaitElement[]): CorePlaitElement[] {
  return elements.map(el => {
    if (!el.id) {
      return { ...el, id: `imported-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` } as CorePlaitElement;
    }
    return el as CorePlaitElement;
  });
}
