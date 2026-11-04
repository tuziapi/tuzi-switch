// Synthetic transport only: never downloads or installs real software.
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { UpdateProvider, useUpdate } from '@/contexts/UpdateContext';
import { UpdateBadge } from '@/components/UpdateBadge';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { registerUpdateGuard } from '@/lib/updateSafety';
import i18n from '@/i18n';
import '@/index.css';
const params=new URLSearchParams(location.search);
let attempts=0;
const trace:string[]=[];
const log=(text:string)=>{trace.push(text);document.querySelector('output')!.textContent=trace.join(' → ');};
registerUpdateGuard(async()=>{log('保存检查');if(params.get('scenario')==='busy')throw Error('还有生成任务正在运行，请完成任务后再更新。');});
mockIPC(async(command,args:any)=>{
 if(command==='get_update_build_info')return {channel:'stable',repository:'AiW520/tuzi-switch',platform:'macos'};
 if(command==='plugin:app|version')return '1.5.2';
 if(command==='plugin:updater|check')return {rid:1,currentVersion:'1.5.2',version:'1.5.3',body:'更新画布与供应商体验。\n此页面使用合成数据，不会真正安装。',rawJson:{}};
 if(command==='plugin:updater|download'){
  log('下载开始');attempts++;
  args.onEvent.onmessage({event:'Started',data:{contentLength:100_000_000}});
  for(let i=0;i<5;i++){await new Promise(r=>setTimeout(r,600));args.onEvent.onmessage({event:'Progress',data:{chunkLength:20_000_000}});}
  args.onEvent.onmessage({event:'Finished'});log('开始校验');await new Promise(r=>setTimeout(r,900));
  if(params.get('scenario')==='signature'&&attempts===1)throw Error('signature mismatch');
  log('校验通过');return 2;
 }
 if(command==='check_update_ready'){log('原生任务检查');return;}
 if(command==='plugin:updater|install'){log('安装');return;}
 if(command==='plugin:process|restart'){log('重启');return;}
 if(command==='plugin:resources|close')return;
 throw Error(`Unexpected IPC: ${command}`);
});
function Controls(){const update=useUpdate();return <><div className="flex gap-3 items-center"><h1>兔子助手 · 应用内更新验收</h1><UpdateBadge/><button onClick={()=>void update.downloadUpdate()}>设置页下载入口</button></div><p className="mt-6">合成测试：关闭弹窗后下载状态应保留，安装仅由“重启并更新”触发。</p><output className="block mt-8"/></>;}
await i18n.changeLanguage('zh');
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultTheme={params.get('theme')==='dark'?'dark':'light'} storageKey="inapp-update-fixture"><UpdateProvider><main className="p-8 bg-background text-foreground min-h-screen"><Controls/></main><Toaster/></UpdateProvider></ThemeProvider>);
