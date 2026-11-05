import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderOpen,
  RefreshCw,
  Search,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useDrawnix } from '../../hooks/use-drawnix';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import {
  clearDesktopPreviewCache,
  deleteDesktopMedia,
  formatStorageBytes,
  getCachedDesktopStorage,
  inspectDesktopStorage,
  invokeDesktopCleanup,
  type CleanupInventory,
  type CleanupScanProgress,
} from '../../services/desktop-storage-cleanup-service';
import './desktop-storage-cleanup.scss';

const PAGE_SIZE = 40;
const kinds = [
  ['all', '全部'],
  ['image', '图片'],
  ['video', '视频'],
  ['audio', '音频'],
  ['other', '其他'],
] as const;

export function DesktopStorageCleanup({ mediaPath }: { mediaPath: string }) {
  const { board } = useDrawnix();
  const boardRef = useRef(board);
  boardRef.current = board;
  const [inventory, setInventory] = useState<CleanupInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [failures, setFailures] = useState<string[]>([]);
  const [kind, setKind] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [progress, setProgress] = useState<CleanupScanProgress | null>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(new Set<string>());
  const [confirmMode, setConfirmMode] = useState<'delete' | 'cache' | null>(
    null
  );
  const [confirmText, setConfirmText] = useState('');
  const operationRef = useRef(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!busy) return;
    const stopInput = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const type of ['keydown', 'paste', 'drop'])
      window.addEventListener(type, stopInput, true);
    return () => {
      for (const type of ['keydown', 'paste', 'drop'])
        window.removeEventListener(type, stopInput, true);
    };
  }, [busy]);

  const scan = useCallback(async () => {
    const generation = ++generationRef.current;
    setInventory((current) => current && { ...current, stale: true });
    setLoading(true);
    setProgress({ stage: 'native', completed: 0, total: 0 });
    setError('');
    setSelected(new Set());
    try {
      const value = await inspectDesktopStorage(
        {
          children: boardRef.current?.children,
          history: boardRef.current?.history,
        },
        {
          onProgress: (value) => {
            if (mountedRef.current && generation === generationRef.current)
              setProgress(value);
          },
        }
      );
      if (mountedRef.current && generation === generationRef.current) {
        setInventory(value);
        setPage(0);
      }
    } catch (err) {
      if (mountedRef.current && generation === generationRef.current) {
        setInventory(null);
        setError(String(err));
      }
    } finally {
      if (mountedRef.current && generation === generationRef.current)
        setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const cached = getCachedDesktopStorage(mediaPath);
    setInventory(cached);
    void scan();
    return () => {
      mountedRef.current = false;
      generationRef.current++;
    };
  }, [scan, mediaPath]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const files = inventory?.files || [];
  const filtered = useMemo(
    () =>
      files.filter(
        (file) =>
          (kind === 'all' || kind === file.kind) &&
          `${file.name} ${file.references.join(' ')}`
            .toLowerCase()
            .includes(search.toLowerCase())
      ),
    [files, kind, search]
  );
  const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, maxPage);
  const visible = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE
  );
  const canDelete = (file: (typeof files)[number]) =>
    !loading &&
    file.owned &&
    !file.references.length &&
    !inventory?.errors.length &&
    !inventory?.stale;
  const selectedFiles = files.filter((file) => selected.has(file.path));
  const selectedBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const totalBytes = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files]
  );

  const reveal = async (path?: string) => {
    try {
      await invokeDesktopCleanup('open_media_location', { path: path || null });
    } catch (err) {
      setError(`无法打开目录：${String(err)}`);
    }
  };

  const execute = async () => {
    if (operationRef.current || !inventory) return;
    operationRef.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    setFailures([]);
    try {
      if (confirmMode === 'cache') {
        await clearDesktopPreviewCache();
        setMessage('预览缓存已清理');
      } else {
        const result = await deleteDesktopMedia(
          inventory,
          selectedFiles,
          () => ({
            children: boardRef.current?.children,
            history: boardRef.current?.history,
          })
        );
        setMessage(
          `已删除 ${result.count} 个文件，释放 ${formatStorageBytes(
            result.bytes
          )}`
        );
        setFailures(result.failures);
        await scan();
      }
      setConfirmMode(null);
      setConfirmText('');
    } catch (err) {
      setError(String(err));
    } finally {
      operationRef.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="desktop-cleanup" aria-label="本地文件清理">
      <div className="desktop-cleanup__heading">
        <h3 className="settings-dialog__section-title">本地文件与清理</h3>
        <div className="desktop-cleanup__actions">
          <button
            type="button"
            className="settings-dialog__button"
            onClick={() => reveal()}
            disabled={busy}
            title="打开媒体目录"
          >
            <FolderOpen size={16} />
            打开目录
          </button>
          <button
            type="button"
            className="settings-dialog__button"
            onClick={scan}
            disabled={loading || busy}
            title="重新扫描"
          >
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
      </div>
      <div className="desktop-cleanup__summary">
        <div>
          <strong>{formatStorageBytes(totalBytes)}</strong>
          <span>
            {files.length} 个本地文件
            {inventory?.errors.length ? '（扫描不完整）' : ''}
          </span>
        </div>
        {kinds.slice(1).map(([id, label]) => {
          const entries = files.filter((file) => file.kind === id);
          return (
            <div key={id}>
              <span>
                {label} · {entries.length}
              </span>
              <strong>
                {formatStorageBytes(
                  entries.reduce((sum, file) => sum + file.size, 0)
                )}
              </strong>
            </div>
          );
        })}
      </div>
      {loading && (
        <p className="desktop-cleanup__progress" role="status">
          {progress?.stage === 'native' && '正在读取媒体目录...'}
          {progress?.stage === 'owners' && '正在识别素材索引...'}
          {progress?.stage === 'references' &&
            '正在检查画板、任务和本地记录引用...'}
          {progress?.stage === 'finalizing' && '正在整理检查结果...'}
        </p>
      )}
      {!loading && inventory?.stale && (
        <p className="desktop-cleanup__notice" role="status">
          已显示最近一次检查结果，正在刷新；刷新完成前暂不可永久删除。
        </p>
      )}
      {error && !confirmMode && (
        <p role="alert" className="desktop-cleanup__error">
          {error}
        </p>
      )}
      {!!inventory?.errors.length && (
        <div role="alert" className="desktop-cleanup__error">
          检查未完成，永久删除已停用。
          {inventory.errors.map((item, i) => (
            <p key={i}>{item}</p>
          ))}
        </div>
      )}
      {message && (
        <p role="status" className="desktop-cleanup__result">
          {message}
        </p>
      )}
      {!!failures.length && (
        <details className="desktop-cleanup__error" open>
          <summary>{failures.length} 项未完成</summary>
          {failures.map((item, i) => (
            <p key={i}>{item}</p>
          ))}
        </details>
      )}
      <div className="desktop-cleanup__filters">
        <select
          aria-label="文件类型"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(0);
          }}
          disabled={busy}
        >
          {kinds.map(([id, label]) => (
            <option value={id} key={id}>
              {label}
            </option>
          ))}
        </select>
        <label>
          <Search size={16} />
          <input
            type="search"
            aria-label="搜索本地文件"
            placeholder="搜索文件或画板"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(0);
            }}
            disabled={busy}
          />
        </label>
      </div>
      <div className="desktop-cleanup__toolbar">
        <label>
          <input
            type="checkbox"
            aria-label="选择本页可删除文件"
            disabled={loading || busy || !visible.some(canDelete)}
            checked={
              visible.some(canDelete) &&
              visible.filter(canDelete).every((file) => selected.has(file.path))
            }
            onChange={(e) => {
              const next = new Set(selected);
              visible
                .filter(canDelete)
                .forEach((file) =>
                  e.target.checked
                    ? next.add(file.path)
                    : next.delete(file.path)
                );
              setSelected(next);
            }}
          />
          本页
        </label>
        <span>
          {selected.size} 个已选 · {formatStorageBytes(selectedBytes)}
        </span>
        <button
          type="button"
          className="settings-dialog__button"
          disabled={!selected.size || selected.size > 500 || loading || busy}
          onClick={() => {
            setConfirmText('');
            setConfirmMode('delete');
          }}
        >
          <Trash2 size={16} />
          永久删除
        </button>
      </div>
      <div className="desktop-cleanup__files" aria-busy={loading}>
        {loading && !inventory ? (
          <p className="desktop-cleanup__empty">正在检查本地文件和引用...</p>
        ) : visible.length ? (
          visible.map((file) => (
            <div className="desktop-cleanup__file" key={file.path}>
              <input
                type="checkbox"
                aria-label={`选择 ${file.name}`}
                disabled={!canDelete(file) || busy}
                checked={selected.has(file.path)}
                onChange={(e) => {
                  const next = new Set(selected);
                  e.target.checked
                    ? next.add(file.path)
                    : next.delete(file.path);
                  setSelected(next);
                }}
              />
              <div className="desktop-cleanup__file-copy">
                <strong title={file.path}>{file.name}</strong>
                <span>
                  {formatStorageBytes(file.size)} ·{' '}
                  {file.references.length
                    ? '正在使用'
                    : inventory?.errors.length
                    ? '待完整检查'
                    : file.owned
                    ? '可删除'
                    : '来源未确认'}
                </span>
                {!!file.references.length && (
                  <details>
                    <summary>{file.references.length} 处引用</summary>
                    {file.references.map((ref) => (
                      <p key={ref}>{ref}</p>
                    ))}
                  </details>
                )}
              </div>
              <button
                type="button"
                className="desktop-cleanup__icon"
                title="在文件管理器中定位"
                aria-label={`定位 ${file.name}`}
                onClick={() => reveal(file.path)}
                disabled={busy}
              >
                <FolderOpen size={17} />
              </button>
            </div>
          ))
        ) : (
          <p className="desktop-cleanup__empty">
            {inventory ? '没有匹配的本地文件' : '暂无扫描结果'}
          </p>
        )}
      </div>
      <div className="desktop-cleanup__footer">
        <button
          type="button"
          className="settings-dialog__button"
          disabled={loading || busy}
          onClick={() => setConfirmMode('cache')}
        >
          <Trash2 size={16} />
          清理预览缓存
        </button>
        <div className="desktop-cleanup__pagination">
          <button
            type="button"
            className="desktop-cleanup__icon"
            title="上一页"
            aria-label="上一页"
            disabled={!currentPage || busy}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {currentPage + 1} / {maxPage + 1}
          </span>
          <button
            type="button"
            className="desktop-cleanup__icon"
            title="下一页"
            aria-label="下一页"
            disabled={currentPage === maxPage || busy}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmMode !== null}
        title={confirmMode === 'delete' ? '永久删除本地文件' : '清理预览缓存'}
        confirmText={confirmMode === 'delete' ? '永久删除' : '清理'}
        confirmTheme={confirmMode === 'delete' ? 'danger' : 'primary'}
        closeOnConfirm={false}
        confirmDisabled={confirmMode === 'delete' && confirmText !== '永久删除'}
        confirmLoading={busy}
        onConfirm={execute}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmMode(null);
        }}
      >
        {error && (
          <p role="alert" className="desktop-cleanup__error">
            {error}
          </p>
        )}
        {confirmMode === 'delete' ? (
          <>
            <p>
              将永久删除 {selectedFiles.length} 个文件（
              {formatStorageBytes(selectedBytes)}
              ）及对应素材记录，无法恢复。引用检查不通过的文件不会删除。
            </p>
            <input
              className="settings-dialog__input"
              aria-label="永久删除确认"
              placeholder="输入“永久删除”"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={busy}
            />
          </>
        ) : (
          <p>清除缩略图和生成预览缓存。原始文件、画板、生成记录和配置保留。</p>
        )}
      </ConfirmDialog>
      {busy &&
        createPortal(
          <div className="desktop-cleanup__busy" role="status">
            <Loader2 size={22} />
            <span>正在清理本地存储...</span>
          </div>,
          (document.getElementById('creative-portals') || document.body)
        )}
    </section>
  );
}
