// Synthetic UI only. Never writes Codex settings or accesses real credentials.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockIPC } from '@tauri-apps/api/mocks';
import { OfficialTuziMcpCard } from '@/components/mcp/OfficialTuziMcpCard';
import i18n from '@/i18n';
import '@/index.css';
const params = new URLSearchParams(location.search);
await i18n.changeLanguage(params.get('lang') || 'zh');
let state = { configPath:'/synthetic/desktop/.codex/config.toml', scope:'local', configured:false, busy:false, phase:'not_configured', error:null as string|null, accountId:null as string|null, accountName:null as string|null, assistantAccountName:'演示客户', accountMismatch:false, checkedAt:null as number|null };
if (params.has('connected')) state = { ...state, configured:true, phase:'connected', accountId:'1', accountName:'演示客户', checkedAt:1795420800 };
if (params.has('mismatch')) state = { ...state, configured:true, phase:'connected', accountId:'2', accountName:'另一演示账号', checkedAt:1795420800, accountMismatch:true };
mockIPC((command,args) => {
 if(command==='tuzi_mcp_status') return {...state};
 if(command==='tuzi_mcp_start') { state={...state,configured:true,busy:true,phase:(args as {action:string}).action==='check'?'checking':'authorizing',error:null}; return; }
 if(command==='tuzi_mcp_cancel') { state={...state,busy:false,phase:'configured',error:'cancelled'}; return; }
 if(command==='tuzi_mcp_manage') { state={...state,error:'browser_failed'}; return; }
 throw new Error('Unexpected synthetic command');
});
const client = new QueryClient();
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><main className="mx-auto max-w-6xl px-6 py-8"><header className="mb-7 border-b pb-5"><h1 className="text-xl font-semibold">MCP 服务器管理</h1><p className="mt-2 text-sm text-muted-foreground">本地交互预览 · 使用合成账号，不会修改真实配置</p></header><OfficialTuziMcpCard/><section className="rounded-2xl border px-5 py-8 text-sm text-muted-foreground">其他 MCP 服务器仍在原列表管理。</section></main></QueryClientProvider>);
