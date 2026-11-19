import { lazy, Suspense, useEffect, useState } from 'react';
import { ASSISTANT_OPEN_SETTINGS, setAssistantAccount } from '../upstream/packages/drawnix/src/services/assistant-account';
import ConfigProvider from 'tdesign-react/es/config-provider';
import { Plus, LayoutGrid, ArrowUpRight, Search, Pencil, Plug, Copy } from 'lucide-react';
import App from '../upstream/apps/web/src/app/app';
import { workspaceService } from '../upstream/packages/drawnix/src/services/workspace-service';
import type { BoardMetadata } from '../upstream/packages/drawnix/src/types/workspace.types';
import type { CreativeWorkspaceProps } from './index.d';
import './workspace.css';
import { useTaskStorage } from '../upstream/packages/drawnix/src/hooks/useTaskStorage';
import { useTaskExecutor } from '../upstream/packages/drawnix/src/hooks/useTaskExecutor';
import { setCreativeRuntimeReady, registerEditorUpdateGuard } from './updateGuard';
import { useBeforeUnload } from '../upstream/packages/drawnix/src/hooks/useBeforeUnload';
import { startOpenTuMcpBridge, stopOpenTuMcpBridge } from './opentuMcpBridge';
import { invoke } from '@tauri-apps/api/core';

// Host lifetime, independent of canvas/project/assistant navigation. The editor
// still unmounts so its keyboard handlers and board observers cannot leak.
function CreativeTaskRuntime() {
  const ready = useTaskStorage();
  useTaskExecutor(ready);
  useEffect(() => { setCreativeRuntimeReady(ready); return () => setCreativeRuntimeReady(false); }, [ready]);
  useBeforeUnload();
  return null;
}

const attach = () => document.getElementById('creative-portals')!;
const CreativeSettings = lazy(() => import('./CreativeSettings').then(module => ({default:module.CreativeSettings})));

export function CreativeWorkspace({ active = true, page, onPageChange, settingsOpen = false, onSettingsOpenChange, accountBridge }: CreativeWorkspaceProps) {
  useEffect(() => {
    setAssistantAccount(accountBridge);
    // The host background model runtime owns bridge cleanup on application unmount.
  }, [accountBridge]);
  useEffect(() => {
    void startOpenTuMcpBridge();
    return () => { void stopOpenTuMcpBridge(); };
  }, []);
  useEffect(() => {
    const open = () => onSettingsOpenChange?.(true);
    window.addEventListener(ASSISTANT_OPEN_SETTINGS, open);
    return () => window.removeEventListener(ASSISTANT_OPEN_SETTINGS, open);
  }, [onSettingsOpenChange]);
  const [boards, setBoards] = useState<BoardMetadata[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(false);
  const [renaming, setRenaming] = useState<{id: string; name: string} | null>(null);
  const [pairing, setPairing] = useState<{ endpoint: string; protocolVersion: string } | null>(null);
  const [pairingError, setPairingError] = useState('');
  const [pairingMessage, setPairingMessage] = useState('');
  useEffect(() => registerEditorUpdateGuard(async () => {
    if (!ready || busy || error) throw new Error('创作工作区正在处理操作，请完成后再更新。');
    if (settingsOpen || renaming) throw new Error('请先保存或关闭创作配置/重命名窗口，再更新。');
  }), [ready, busy, error, settingsOpen, renaming]);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let mounted = true;
    const refresh = () => { if (mounted) setBoards(workspaceService.getAllBoards()); };
    const subscription = workspaceService.observeEvents().subscribe(refresh);
    workspaceService.initialize().then(() => {
      if (!mounted) return;
      workspaceService.setSidebarCollapsed(true);
      refresh(); setReady(true);
    }).catch(() => { if (mounted) setError('无法读取本地项目，请检查存储空间后重试。'); });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!ready || page === 'projects') return;
    setEditor(true);
  }, [page, ready]);

  const openBoard = async (id: string) => {
    setBusy(true); setError('');
    try {
      await workspaceService.switchBoard(id);
      onPageChange('canvas');
    } catch { setError('项目打开失败，已有内容已保留，请重试。'); }
    finally { setBusy(false); }
  };
  const createBoard = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const names = new Set(workspaceService.getAllBoards().map(board => board.name));
      let name = '未命名项目';
      for (let n = 2; names.has(name); n++) name = `未命名项目 ${n}`;
      const board = await workspaceService.createBoard({ name, elements: [] });
      await openBoard(board.id);
    } catch { setError('创建失败，请检查本地存储后重试。'); }
    finally { setBusy(false); }
  };
  const rename = async () => {
    if (!renaming?.name.trim() || busy) return;
    setBusy(true); setError('');
    try { await workspaceService.renameBoard(renaming.id, renaming.name.trim()); setRenaming(null); }
    catch { setError('重命名失败，请检查名称是否重复后重试。'); }
    finally { setBusy(false); }
  };
  const openPairing = async () => {
    setPairingError('');
    setPairingMessage('');
    try {
      setPairing(await invoke<{ endpoint: string; protocolVersion: string }>('opentu_mcp_pairing'));
    } catch {
      setPairingError('OpenTu MCP 服务尚未启动，请确认桌面验收版正在运行。');
    }
  };
  const copyPairing = async (field: 'endpoint' | 'token' | 'authorization') => {
    if (!pairing) return;
    setPairingMessage(''); setPairingError('');
    try {
      await invoke('opentu_mcp_copy', { field });
      setPairingMessage(field === 'endpoint' ? '已复制本地地址。' : field === 'token' ? '已复制配对令牌。' : '已复制带 Bearer 前缀的 Authorization 值。');
    } catch { setPairingError('复制失败，请重试。'); }
  };
  const checkPairing = async () => {
    setPairingMessage(''); setPairingError('');
    try {
      const result = await invoke<{ toolCount: number }>('opentu_mcp_check');
      setPairingMessage(`本地认证、初始化和 ${result.toolCount} 个工具检查通过。仍需在目标客户端连接并调用工具。`);
    } catch { setPairingError('本地连接检查失败，请重试。'); }
  };

  return <ConfigProvider globalConfig={{ attach }}>
    <CreativeTaskRuntime />
    {active && <div className="creative-root" data-page={page} data-theme={dark ? "dark" : "light"} theme-mode={dark ? "dark" : "light"}>
      <div id="creative-portals" />
      {settingsOpen && <Suspense fallback={<div className="creative-loading" role="status">正在打开创作配置…</div>}><CreativeSettings onClose={() => onSettingsOpenChange?.(false)} /></Suspense>}
      {renaming && <div className="creative-rename-backdrop"><form role="dialog" aria-modal="true" aria-label="重命名项目" className="creative-rename-dialog" onSubmit={event => { event.preventDefault(); void rename(); }} onKeyDown={event => { if(event.key === 'Escape' && !busy) setRenaming(null); }}><h3>重命名项目</h3><input autoFocus aria-label="项目名称" value={renaming.name} onChange={event => setRenaming({...renaming, name:event.target.value})}/><div><button type="button" disabled={busy} onClick={() => setRenaming(null)}>取消</button><button type="submit" disabled={busy || !renaming.name.trim()}>保存</button></div></form></div>}
      {pairing && <div className="creative-rename-backdrop"><section role="dialog" aria-modal="true" aria-label="ChatGPT Desktop 接入" className="creative-rename-dialog creative-mcp-pairing"><h3>ChatGPT Desktop 接入</h3><p>名称填“兔子助手 OpenTu”，类型选“流式 HTTP”。本机客户端使用下方地址；云端客户端需要另行配置 Tunnel。地址和令牌每次重启会变化，请重新复制，不要把令牌发到聊天中。</p><label>本地 MCP 地址<input readOnly value={pairing.endpoint} /></label><p>Token 输入框粘贴配对令牌；自定义请求头名称填 Authorization，粘贴带 Bearer 前缀的值。调用前请打开目标画布。</p><div><button type="button" onClick={() => void copyPairing('endpoint')}><Copy size={14} />复制地址</button><button type="button" onClick={() => void copyPairing('token')}>复制配对令牌</button><button type="button" onClick={() => void copyPairing('authorization')}>复制 Authorization 值</button></div>{pairingMessage && <p role="status">{pairingMessage}</p>}{pairingError && <p role="alert">{pairingError}</p>}<div><button type="button" onClick={() => void checkPairing()}>检查连接</button><button type="button" onClick={() => setPairing(null)}>关闭</button></div></section></div>}
      {error && <div role="alert" className="creative-error">{error}</div>}
      {!ready && !error && <div className="creative-loading" role="status">正在读取本地项目…</div>}
      {ready && page === 'projects' && <section className="creative-projects">
        <div className="creative-project-list-header">
          <h2>我的项目 <small>{boards.length}</small></h2>
          <div className="creative-project-list-actions">
            <label><Search size={15} /><input aria-label="搜索项目" placeholder="搜索项目" value={search} onChange={e => setSearch(e.target.value)} /></label>
            <button onClick={() => void openPairing()} title="配置 ChatGPT Desktop 调用 OpenTu"><Plug size={15} />ChatGPT 接入</button>
            <button className="creative-primary" disabled={busy} onClick={createBoard}><Plus size={17} />新建项目</button>
          </div>
        </div>
        {pairingError && <div role="alert" className="creative-error">{pairingError}</div>}
        {boards.length === 0 ? <div className="creative-empty"><LayoutGrid size={30} /><h3>从第一个项目开始</h3><p>你的作品保存在当前设备。创建一个空白画布，开始编辑。</p><button onClick={createBoard} disabled={busy}>创建项目 <ArrowUpRight size={15} /></button></div> : <div className="creative-project-grid">{boards.filter(b => b.name.toLowerCase().includes(search.toLowerCase())).sort((a,b) => b.updatedAt-a.updatedAt).map(board => <article className="creative-project-card" key={board.id}><button disabled={busy} onClick={() => openBoard(board.id)} className="creative-project-open"><span className="creative-project-thumbnail"><LayoutGrid size={28}/></span><strong>{board.name}</strong><span>{new Date(board.updatedAt).toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}</span></button><button aria-label={`重命名 ${board.name}`} onClick={() => setRenaming({ id: board.id, name: board.name })} className="creative-rename"><Pencil size={14}/></button></article>)}</div>}
      </section>}
      {ready && editor && page !== 'projects' && <div className="creative-editor"><App /></div>}
    </div>}
  </ConfigProvider>;
}

export { prepareCreativeUpdate } from "./updateGuard";
