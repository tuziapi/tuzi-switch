import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { ASSISTANT_OPEN_SETTINGS, setAssistantAccount } from '../upstream/packages/drawnix/src/services/assistant-account';
import {
  ASSISTANT_QUICK_SETUP,
  type AssistantCreationSetupRequest,
} from '../upstream/packages/drawnix/src/services/assistant-creation-setup';
import { AssistantAccountQuickPicker } from './AssistantAccountQuickPicker';
import ConfigProvider from 'tdesign-react/es/config-provider';
import { Plus, LayoutGrid, ArrowUpRight, Search, Pencil, Plug, Copy, X, RefreshCw, CheckCircle2 } from 'lucide-react';
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
import { OpenTuConnectionGuide } from './OpenTuConnectionGuide';
import { startVideoTaskRecovery } from './videoTaskRecovery';

// Host lifetime, independent of canvas/project/assistant navigation. The editor
// still unmounts so its keyboard handlers and board observers cannot leak.
function CreativeTaskRuntime() {
  const ready = useTaskStorage();
  useTaskExecutor(ready);
  useEffect(() => { if (ready) return startVideoTaskRecovery(); }, [ready]);
  useEffect(() => { setCreativeRuntimeReady(ready); return () => setCreativeRuntimeReady(false); }, [ready]);
  useBeforeUnload();
  return null;
}

const attach = () => document.getElementById('creative-portals')!;
const CreativeSettings = lazy(() => import('./CreativeSettings').then(module => ({default:module.CreativeSettings})));
const EcommerceWorkbench = lazy(() => import('./EcommerceWorkbench').then(module => ({default:module.EcommerceWorkbench})));

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
  const [quickSetupRequest, setQuickSetupRequest] = useState<AssistantCreationSetupRequest | null>(null);
  const closeQuickSetup = useCallback(() => setQuickSetupRequest(null), []);
  const fallbackQuickSetup = useCallback(() => {
    setQuickSetupRequest(null);
    onSettingsOpenChange?.(true);
  }, [onSettingsOpenChange]);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; model?: AssistantCreationSetupRequest['model'] }>).detail;
      if (detail?.type !== 'image') {
        onSettingsOpenChange?.(true);
        return;
      }
      setQuickSetupRequest({ type: 'image', model: detail.model });
    };
    window.addEventListener(ASSISTANT_QUICK_SETUP, open);
    return () => window.removeEventListener(ASSISTANT_QUICK_SETUP, open);
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
  const [connector, setConnector] = useState<{configured: boolean; lastToolCallAt: number | null; configPath: string; scope: 'local' | 'isolated'} | null>(null);
  const [connectorBusy, setConnectorBusy] = useState(false);
  const configureConnector = async (remove: boolean) => {
    if (!connector?.configPath) return;
    setConnectorBusy(true); setPairingError(''); setPairingMessage('');
    try {
      setConnector(await invoke(remove ? 'opentu_connector_remove' : 'opentu_connector_install', { connectLocal: true, expectedConfigPath: connector.configPath }));
      setPairingMessage(remove ? '已解除兔子助手创建的连接器配置。' : '配置已写入。请在 Codex 刷新 MCP；若工具仍未出现，请重新打开会话。已有手动 OpenTu 项时，请停用旧项并保留 tuzi-opentu。');
    } catch { setPairingError('配置失败，其他配置已保留。请检查 Codex 配置格式、目录权限及同名 tuzi-opentu 服务。'); }
    finally { setConnectorBusy(false); }
  };
  useEffect(() => {
    if (!pairing) return;
    let active = true;
    const timer = setInterval(() => {
      invoke<NonNullable<typeof connector>>('opentu_connector_status', { connectLocal: true })
        .then(value => { if (active) setConnector(value); })
        .catch(() => { if (active) setPairingError('无法读取连接状态，请重新打开连接面板。'); });
    }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [pairing]);
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
      setConnector(await invoke('opentu_connector_status', { connectLocal: true }));
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
      setConnector(await invoke('opentu_connector_status', { connectLocal: true }));
      setPairingMessage(`本地认证、初始化和 ${result.toolCount} 个工具检查通过。仍需在目标客户端连接并调用工具。`);
    } catch { setPairingError('本地连接检查失败，请重试。'); }
  };

  return <ConfigProvider globalConfig={{ attach }}>
    <CreativeTaskRuntime />
    {active && <div className="creative-root" data-page={page} data-theme={dark ? "dark" : "light"} theme-mode={dark ? "dark" : "light"}>
      <div id="creative-portals" />
      {quickSetupRequest && <AssistantAccountQuickPicker request={quickSetupRequest} onFallback={fallbackQuickSetup} onComplete={closeQuickSetup} />}
      {settingsOpen && <Suspense fallback={<div className="creative-loading" role="status">正在打开创作配置…</div>}><CreativeSettings onClose={() => onSettingsOpenChange?.(false)} /></Suspense>}
      {renaming && <div className="creative-rename-backdrop"><form role="dialog" aria-modal="true" aria-label="重命名项目" className="creative-rename-dialog" onSubmit={event => { event.preventDefault(); void rename(); }} onKeyDown={event => { if(event.key === 'Escape' && !busy) setRenaming(null); }}><h3>重命名项目</h3><input autoFocus aria-label="项目名称" value={renaming.name} onChange={event => setRenaming({...renaming, name:event.target.value})}/><div><button type="button" disabled={busy} onClick={() => setRenaming(null)}>取消</button><button type="submit" disabled={busy || !renaming.name.trim()}>保存</button></div></form></div>}
      {pairing && <div className="creative-rename-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="creative-mcp-title" className="creative-mcp-pairing">
        <header className="creative-mcp-header">
          <span className="creative-mcp-icon"><Plug size={21} /></span>
          <div><h3 id="creative-mcp-title">连接 Codex / MCP 客户端</h3><p>让客户端使用 OpenTu 创作工具，与你的画布协同工作。</p></div>
          <button className="creative-mcp-close" type="button" aria-label="关闭连接面板" disabled={connectorBusy} onClick={() => setPairing(null)}><X size={18} /></button>
        </header>
        <div className="creative-mcp-body">
          <section className="creative-mcp-connect-card" aria-label="本机 Codex 连接">
            <div className="creative-mcp-card-heading"><h4>本机 Codex</h4><span className="creative-mcp-badge" data-configured={!!connector?.configured}>{connector?.configured ? '已配置' : '未配置'}</span></div>
            <p>添加 tuzi-opentu 配置，保留其他设置；助手重启后自动重连。</p>
            <div className="creative-mcp-actions"><button className="creative-mcp-primary" type="button" disabled={connectorBusy || !connector?.configPath} onClick={() => void configureConnector(false)}><Plug size={15} />{connectorBusy ? '正在配置…' : connector?.configured ? '修复本机连接' : '连接本机 Codex'}</button>{connector?.configured && <button className="creative-mcp-disconnect" type="button" disabled={connectorBusy} onClick={() => void configureConnector(true)}>解除连接</button>}</div>
            {connector?.configured && <p className="creative-mcp-connection-status" role="status"><CheckCircle2 size={14} />{connector.lastToolCallAt ? '本次运行已收到连接器转发的成功工具调用。' : '已配置，等待客户端实际调用。'}</p>}
            {connector && <details className="creative-mcp-config-path"><summary>{connector.scope === 'local' ? '查看本机配置位置' : '查看隔离测试配置位置'}</summary><code>{connector.configPath}</code></details>}
          </section>
          <OpenTuConnectionGuide />
          <details className="creative-mcp-manual"><summary>其他客户端 / 手动 HTTP 配置</summary>
            <p>名称填“兔子助手 OpenTu”，类型选“流式 HTTP”。以下手动配置在重启后需要更新；上方 Codex 连接器不需要重新配对。云端客户端需要另行配置 Tunnel。</p>
            <label>本地 MCP 地址<input readOnly value={pairing.endpoint} /></label>
            <p>自定义标头名称填 Authorization，值粘贴“复制 Authorization 值”的完整内容。不要把令牌填入“Bearer 令牌环境变量”，也不要发送到聊天中。</p>
            <div className="creative-mcp-actions"><button type="button" onClick={() => void copyPairing('endpoint')}><Copy size={14} />复制地址</button><button type="button" onClick={() => void copyPairing('token')}><Copy size={14} />复制配对令牌</button><button type="button" onClick={() => void copyPairing('authorization')}><Copy size={14} />复制 Authorization 值</button></div>
          </details>
        </div>
        <footer className="creative-mcp-footer">
          {pairingMessage && <p className="creative-mcp-feedback" role="status">{pairingMessage}</p>}{pairingError && <p className="creative-mcp-feedback creative-mcp-feedback-error" role="alert">{pairingError}</p>}
          <div className="creative-mcp-actions"><button type="button" disabled={connectorBusy} onClick={() => void checkPairing()}><RefreshCw size={14} />检查连接</button><button type="button" disabled={connectorBusy} onClick={() => setPairing(null)}>关闭</button></div>
        </footer>
      </section></div>}
      {error && <div role="alert" className="creative-error">{error}</div>}
      {!ready && !error && <div className="creative-loading" role="status">正在读取本地项目…</div>}
      {ready && page === 'projects' && <section className="creative-projects">
        <div className="creative-project-list-header">
          <h2>我的项目 <small>{boards.length}</small></h2>
          <div className="creative-project-list-actions">
            <label><Search size={15} /><input aria-label="搜索项目" placeholder="搜索项目" value={search} onChange={e => setSearch(e.target.value)} /></label>
            <button className="creative-connect-button" onClick={() => void openPairing()} title="配置 Codex 或其他 MCP 客户端调用 OpenTu"><Plug size={15} />连接 Codex / MCP</button>
            <button className="creative-primary" disabled={busy} onClick={createBoard}><Plus size={17} />新建项目</button>
          </div>
        </div>
        {pairingError && !pairing && <div role="alert" className="creative-error">{pairingError}</div>}
        {boards.length === 0 ? <div className="creative-empty"><LayoutGrid size={30} /><h3>从第一个项目开始</h3><p>你的作品保存在当前设备。创建一个空白画布，开始编辑。</p><button onClick={createBoard} disabled={busy}>创建项目 <ArrowUpRight size={15} /></button></div> : <div className="creative-project-grid">{boards.filter(b => b.name.toLowerCase().includes(search.toLowerCase())).sort((a,b) => b.updatedAt-a.updatedAt).map(board => <article className="creative-project-card" key={board.id}><button disabled={busy} onClick={() => openBoard(board.id)} className="creative-project-open"><span className="creative-project-thumbnail"><LayoutGrid size={28}/></span><strong>{board.name}</strong><span>{new Date(board.updatedAt).toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}</span></button><button aria-label={`重命名 ${board.name}`} onClick={() => setRenaming({ id: board.id, name: board.name })} className="creative-rename"><Pencil size={14}/></button></article>)}</div>}
      </section>}
      {ready && page === 'ecommerce' && <Suspense fallback={<div className="creative-loading" role="status">正在打开电商生图…</div>}><EcommerceWorkbench accountBridge={accountBridge} onOpenCanvas={() => onPageChange('canvas')} /></Suspense>}
      {ready && editor && page === 'canvas' && <div className="creative-editor"><App /></div>}
    </div>}
  </ConfigProvider>;
}

export { prepareCreativeUpdate } from "./updateGuard";
