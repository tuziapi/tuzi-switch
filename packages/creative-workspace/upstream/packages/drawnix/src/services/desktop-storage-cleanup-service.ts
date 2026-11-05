import { LS_KEYS } from '../constants/storage-keys';
import { getLocalDataClearRisk } from './local-data-clear-service';
import { syncEngine } from './github-sync/sync-engine';
import { unifiedCacheService } from './unified-cache-service';
import { beginDesktopCleanup } from './desktop-cleanup-lock';
import { workspaceService } from './workspace-service';
import { taskQueueService } from './task-queue-service';

export interface DesktopMediaFile {
  path: string;
  name: string;
  kind: string;
  size: number;
  modified: string;
}

export interface CleanupFile extends DesktopMediaFile {
  references: string[];
  owned: boolean;
  owners: Array<{
    database: string;
    store: string;
    key: IDBValidKey;
    url?: string;
  }>;
}

export interface CleanupInventory {
  root: string;
  files: CleanupFile[];
  errors: string[];
  scannedAt?: number;
  stale?: boolean;
}

export interface CleanupScanProgress {
  stage: 'native' | 'owners' | 'references' | 'finalizing';
  completed: number;
  total: number;
}

interface NativeInventory {
  root: string;
  files: DesktopMediaFile[];
  errors: string[];
  nativeReferences: string[];
}

interface NativeDeleteResult {
  path: string;
  deletedBytes: number;
  error: string | null;
}

interface StoredRecord {
  value: any;
  key: IDBValidKey;
}

let lastInventory: CleanupInventory | null = null;

export function getCachedDesktopStorage(
  expectedRoot?: string
): CleanupInventory | null {
  if (!lastInventory || !lastInventory.scannedAt) return null;
  if (expectedRoot && lastInventory.root !== expectedRoot) return null;
  if (Date.now() - lastInventory.scannedAt > 30_000) return null;
  return {
    ...lastInventory,
    stale: true,
    files: lastInventory.files.map((file) => ({
      ...file,
      references: [...file.references],
      owners: [...file.owners],
    })),
    errors: [...lastInventory.errors],
  };
}

export function invokeDesktopCleanup<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  const internals = (window as any).__TUZI_CREATIVE_NATIVE__;
  if (!internals?.invoke) throw new Error('此功能仅在桌面应用中可用');
  return internals.invoke(command, args);
}

function fileName(value: string): string {
  try {
    value = decodeURIComponent(value);
  } catch {
    /* Keep malformed strings conservative. */
  }
  return value.split(/[?#]/)[0].split(/[/\\]/).pop() || '';
}

async function openExisting(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let absent = false;
    request.onupgradeneeded = (event) => {
      // WebKit can enumerate a database whose creation was previously aborted.
      // oldVersion=0 confirms there is no persisted database to inspect.
      absent = event.oldVersion === 0;
      request.transaction?.abort();
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      if (absent && request.error?.name === 'AbortError') resolve(null);
      else reject(new Error(`无法读取数据库 ${name}：${request.error?.name || '未知错误'}`));
    };
    request.onblocked = () => reject(new Error(`数据库 ${name} 正忙`));
  });
}

async function readStoreBatch(
  db: IDBDatabase,
  store: string,
  after?: IDBValidKey
): Promise<StoredRecord[]> {
  return new Promise<StoredRecord[]>((resolve, reject) => {
    const records: StoredRecord[] = [];
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).openCursor(
      after === undefined ? undefined : IDBKeyRange.lowerBound(after, true)
    );
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      records.push({ value: cursor.value, key: cursor.primaryKey });
      if (records.length < 200) cursor.continue();
    };
    tx.oncomplete = () => resolve(records);
    tx.onerror = tx.onabort = () =>
      reject(tx.error || new Error(`读取 ${db.name}/${store} 失败`));
  });
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function processStore(
  db: IDBDatabase,
  store: string,
  visit: (value: any, key: IDBValidKey) => void,
  progress?: (completed: number) => void,
  remaining = 100_000
): Promise<void> {
  let after: IDBValidKey | undefined;
  let completed = 0;
  while (true) {
    const records = await readStoreBatch(db, store, after);
    for (const record of records) {
      if (++completed > remaining)
        throw new Error('本地记录超过检查上限，已停用永久删除');
      visit(record.value, record.key);
    }
    progress?.(completed);
    if (records.length < 200) return;
    after = records[records.length - 1].key;
    await yieldToBrowser();
  }
}

function strings(
  value: unknown,
  visit: (text: string) => void,
  depth = 0
): void {
  if (depth > 50) throw new Error('本地记录嵌套过深，无法完整检查引用');
  if (typeof value === 'string') {
    visit(value);
    // Legacy records also contain serialized boards and escaped local paths.
    if (value.startsWith('{') || value.startsWith('[')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return;
      }
      strings(parsed, visit, depth + 1);
    }
  } else if (
    value &&
    typeof value === 'object' &&
    !(value instanceof Blob) &&
    !(value instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(value)
  ) {
    for (const child of Object.values(value)) strings(child, visit, depth + 1);
  }
}

const labels: Record<string, string> = {
  'aitu-workspace': '画板',
  'sw-task-queue': '任务与工作流',
  'aitu-task-queue': '生成历史',
  'aitu-knowledge-base': '知识库',
  'aitu-chat': '聊天',
  'kb-chat-storage': '知识库聊天',
  'aitu-audio-playlists': '播放列表',
  drawnix: '角色或旧画板',
  'aitu-storage': '本地记录',
};

export class MediaReferenceIndex {
  files: CleanupFile[];
  private names = new Map<string, CleanupFile[]>();
  private tokens = new Map<string, Set<CleanupFile>>();
  private matcher: RegExp | null = null;

  constructor(files: DesktopMediaFile[]) {
    this.files = files.map((file) => ({
      ...file,
      references: [],
      owned: false,
      owners: [],
    }));
    for (const file of this.files) {
      this.names.set(file.name, [...(this.names.get(file.name) || []), file]);
      this.token(file.name, file);
      this.token(encodeURIComponent(file.name), file);
    }
  }

  private token(token: string, file: CleanupFile) {
    if (!token) return;
    const matches = this.tokens.get(token) || new Set<CleanupFile>();
    matches.add(file);
    this.tokens.set(token, matches);
    this.matcher = null;
  }

  owner(database: string, store: string, key: IDBValidKey, value: any) {
    const source = value?.filePath || value?.url;
    if (typeof source !== 'string') return;
    let candidates = this.names.get(fileName(source)) || [];
    if (value.filePath)
      candidates = candidates.filter((file) => file.path === value.filePath);
    else
      candidates = candidates.filter(
        (file) =>
          file.kind === String(value.type).toLowerCase() ||
          (file.kind === 'other' &&
            ['zip', 'archive', 'ppt', 'text'].includes(value.type))
      );
    if (candidates.length !== 1) return;
    const file = candidates[0];
    file.owned = true;
    file.owners.push({ database, store, key, url: value.url });
    if (database === 'aitu-assets' && typeof value.id === 'string')
      this.token(value.id, file);
    // A full URL must protect same-named files too when legacy directories coexist.
    for (const match of this.names.get(file.name) || []) {
      this.token(source, match);
      if (database === 'aitu-assets' && typeof value.id === 'string')
        this.token(value.id, match);
    }
  }

  reference(value: unknown, location: string) {
    if (!this.tokens.size) return;
    if (!this.matcher) {
      const escaped = [...this.tokens.keys()]
        .sort((a, b) => b.length - a.length)
        .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      this.matcher = new RegExp(escaped.join('|'), 'g');
    }
    strings(value, (text) => {
      this.matcher!.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = this.matcher!.exec(text))) {
        for (const file of this.tokens.get(match[0]) || []) {
          if (!file.references.includes(location))
            file.references.push(location);
        }
      }
    });
  }
}

function isOwnerStore(database: string, store: string) {
  return (
    (database === 'aitu-assets' && store === 'assets') ||
    (database === 'drawnix-unified-cache' && store === 'media')
  );
}

export async function inspectDesktopStorage(
  liveBoard?: unknown,
  options: {
    onProgress?: (progress: CleanupScanProgress) => void;
  } = {}
): Promise<CleanupInventory> {
  const report = options.onProgress || (() => undefined);
  report({ stage: 'native', completed: 0, total: 0 });
  const native = await invokeDesktopCleanup<NativeInventory>(
    'inspect_media_storage'
  );
  const index = new MediaReferenceIndex(native.files);
  const errors = [...native.errors];
  report({ stage: 'owners', completed: 0, total: 0 });
  try {
    const factory = indexedDB as IDBFactory & {
      databases?: () => Promise<Array<{ name?: string }>>;
    };
    if (!factory.databases)
      throw new Error('此系统不支持完整枚举本地数据库，已停用永久删除');
    const databases = await factory.databases();
    let records = 0;
    let textBytes = 0;
    for (const ownerName of ['aitu-assets', 'drawnix-unified-cache']) {
      if (!databases.some((db) => db.name === ownerName)) continue;
      const db = await openExisting(ownerName);
      if (!db) continue;
      try {
        for (const store of Array.from(db.objectStoreNames))
          if (isOwnerStore(ownerName, store)) {
            await processStore(
              db,
              store,
              (value, key) => {
                if (++records > 100_000)
                  throw new Error('本地记录超过检查上限，已停用永久删除');
                index.owner(ownerName, store, key, value);
              },
              (completed) =>
                report({ stage: 'owners', completed, total: 0 }),
              100_000 - records
            );
          }
      } finally {
        db.close();
      }
    }
    report({ stage: 'references', completed: 0, total: databases.length });
    for (
      let databaseIndex = 0;
      databaseIndex < databases.length;
      databaseIndex += 1
    ) {
      const database = databases[databaseIndex];
      if (!database.name) throw new Error('发现无法识别的本地数据库');
      const db = await openExisting(database.name);
      if (!db) continue;
      try {
        for (const store of Array.from(db.objectStoreNames)) {
          if (db.name === 'drawnix-unified-cache' && store === 'media-blobs')
            continue;
          await processStore(
            db,
            store,
            (value, key) => {
              if (++records > 100_000)
                throw new Error('本地记录超过检查上限，已停用永久删除');
              let references = value;
              if (isOwnerStore(db.name, store)) {
                const { url, filePath, id, name, ...rest } = value;
                references = rest;
              }
              strings(references, (text) => {
                textBytes += text.length;
              });
              if (textBytes > 50_000_000)
                throw new Error('本地记录超过检查上限，已停用永久删除');
              const title =
                typeof value?.name === 'string'
                  ? value.name
                  : typeof value?.title === 'string'
                  ? value.title
                  : String(key);
              index.reference(
                references,
                `${labels[db.name] || db.name}：${title.slice(0, 80)}`
              );
            },
            (completed) =>
              report({ stage: 'references', completed, total: 0 }),
            100_000 - records
          );
        }
      } finally {
        db.close();
      }
      report({
        stage: 'references',
        completed: databaseIndex + 1,
        total: databases.length,
      });
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (
        [
          LS_KEYS.AI_IMAGE_PREVIEW_CACHE,
          LS_KEYS.AI_VIDEO_PREVIEW_CACHE,
        ].includes(key as any)
      )
        continue;
      index.reference(localStorage.getItem(key), `本地设置：${key}`);
    }
    index.reference(liveBoard, '当前画板（含未保存内容）');
    index.reference(taskQueueService.getAllTasks(), '内存中的生成记录');
    index.reference(
      workspaceService.getAllBoards(),
      '内存中的画板（含待保存内容）'
    );
    for (const reference of native.nativeReferences)
      index.reference(reference, '桌面数据库');
    const latestNames = (await factory.databases())
      .map((db) => db.name)
      .sort()
      .join('|');
    if (
      latestNames !==
      databases
        .map((db) => db.name)
        .sort()
        .join('|')
    )
      throw new Error('本地数据库发生变化，请重新扫描');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  report({ stage: 'finalizing', completed: 1, total: 1 });
  const result = {
    root: native.root,
    files: index.files,
    errors,
    scannedAt: Date.now(),
    stale: false,
  };
  lastInventory = result;
  return result;
}

export function assertCleanupIdle(): void {
  const risk = getLocalDataClearRisk();
  if (
    risk.activeTaskCount ||
    risk.activeWorkflowCount ||
    risk.hasPendingSync ||
    syncEngine.getSyncStatus() === 'syncing'
  ) {
    throw new Error('请等待生成任务和同步完成后再清理');
  }
}

async function removeOwner(
  owner: CleanupFile['owners'][number]
): Promise<void> {
  if (owner.database === 'drawnix-unified-cache' && owner.url) {
    await unifiedCacheService.removeDeletedDesktopCacheIndex(owner.url);
    return;
  }
  const db = await openExisting(owner.database);
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(owner.store, 'readwrite');
      tx.objectStore(owner.store).delete(owner.key);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(tx.error || new Error('素材索引清理失败'));
    });
  } finally {
    db.close();
  }
}

export async function deleteDesktopMedia(
  inventory: CleanupInventory,
  selected: CleanupFile[],
  getLiveBoard: () => unknown
) {
  assertCleanupIdle();
  const release = beginDesktopCleanup();
  let paused = false;
  try {
    await unifiedCacheService.pauseDesktopCleanupWrites();
    paused = true;
    const latest = await inspectDesktopStorage(getLiveBoard());
    assertCleanupIdle();
    if (latest.errors.length || latest.root !== inventory.root)
      throw new Error('存储检查不完整或路径已变化，请重新扫描');
    const currentFiles = new Map(latest.files.map((file) => [file.path, file]));
    const checked = selected.map((file) => {
      const current = currentFiles.get(file.path);
      if (
        !current ||
        !current.owned ||
        current.references.length ||
        current.size !== file.size ||
        current.modified !== file.modified
      ) {
        throw new Error(`文件状态已变化或正在使用：${file.name}。请重新扫描`);
      }
      return current;
    });
    const results = await invokeDesktopCleanup<NativeDeleteResult[]>(
      'delete_inspected_media',
      {
        expectedRoot: latest.root,
        files: checked.map(({ path, name, kind, size, modified }) => ({
          path,
          name,
          kind,
          size,
          modified,
        })),
      }
    );
    const failures: string[] = [];
    let bytes = 0;
    let count = 0;
    for (const result of results) {
      if (result.error) {
        failures.push(`${fileName(result.path)}：${result.error}`);
        continue;
      }
      count++;
      bytes += result.deletedBytes;
      for (const owner of currentFiles.get(result.path)!.owners) {
        try {
          await removeOwner(owner);
        } catch (error) {
          failures.push(
            `${fileName(result.path)}：文件已删除，索引清理失败（${String(
              error
            )}）`
          );
        }
      }
    }
    return { count, bytes, failures };
  } finally {
    if (paused) unifiedCacheService.resumeCacheWrites();
    release();
  }
}

export async function clearDesktopPreviewCache(): Promise<void> {
  assertCleanupIdle();
  const release = beginDesktopCleanup();
  let paused = false;
  try {
    await unifiedCacheService.pauseDesktopCleanupWrites();
    paused = true;
    assertCleanupIdle();
    if (typeof caches !== 'undefined')
      await caches.delete('drawnix-images-thumb');
    localStorage.removeItem(LS_KEYS.AI_IMAGE_PREVIEW_CACHE);
    localStorage.removeItem(LS_KEYS.AI_VIDEO_PREVIEW_CACHE);
  } finally {
    if (paused) unifiedCacheService.resumeCacheWrites();
    release();
  }
}

export function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
