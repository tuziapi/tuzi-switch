import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AddProviderDialog } from './AddProviderDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { AppId } from '@/lib/api';
import { Button } from '@/components/ui/button';
import type { Provider } from '@/types';
import { TUZI_TOOL_TARGETS, type TuziProviderDraft } from '@/lib/tuziToolCompatibility';
import type { ProviderFormProps } from './forms/ProviderForm';

export function tuziCreationPrefill(draft:TuziProviderDraft):ProviderFormProps['initialData'] {
 const endpoint=TUZI_TOOL_TARGETS.find(t=>t.appId===draft.appId&&t.protocol===draft.protocol)!.endpoint;
 const model=draft.model??'';
 let settingsConfig:Record<string,unknown>={};
 let meta:Provider['meta'];
 if (draft.appId==='claude'||draft.appId==='claude-desktop') {
   settingsConfig={env:{ANTHROPIC_BASE_URL:endpoint,ANTHROPIC_AUTH_TOKEN:draft.key,...(model?{ANTHROPIC_MODEL:model}:{})}};
   meta={apiFormat:'anthropic',...(draft.appId==='claude-desktop'?{claudeDesktopMode:'proxy' as const}: {})};
 } else if(draft.appId==='codex') {
   const suffix=crypto.randomUUID().replace(/-/g,'').slice(0,12).toUpperCase();
   const envKey=`TUZI_SWITCH_${suffix}_CODEX_API_KEY`;
   settingsConfig={auth:{OPENAI_API_KEY:draft.key},env:{envKey},config:`model_provider = "custom"\n${model?`model = "${model.replace(/"/g,'')}"\n`:''}[model_providers.custom]\nname = "Tuzi"\nbase_url = "${endpoint}"\nwire_api = "responses"\nenv_key = "${envKey}"\n`};
 } else if(draft.appId==='gemini') settingsConfig={env:{GEMINI_API_KEY:draft.key,GOOGLE_GEMINI_BASE_URL:endpoint},config:{}};
 else if(draft.appId==='opencode') settingsConfig={npm:{responses:'@ai-sdk/openai',chat:'@ai-sdk/openai-compatible',anthropic:'@ai-sdk/anthropic',gemini:'@ai-sdk/google'}[draft.protocol],options:{baseURL:endpoint,apiKey:draft.key},models:model?{[model]:{name:model}}:{}};
 else if(draft.appId==='openclaw') settingsConfig={baseUrl:endpoint,apiKey:draft.key,api:draft.protocol==='anthropic'?'anthropic-messages':'openai-completions',models:model?[{id:model,name:model}]:[]};
 else settingsConfig={base_url:endpoint,api_key:draft.key,api_mode:draft.protocol==='anthropic'?'anthropic_messages':'codex_responses',models:model?[{id:model}]:[]};
 return {name:draft.name??'兔子主站',websiteUrl:'https://api.tu-zi.com',settingsConfig,category:'third_party',meta};
}
interface Preview {id:string; changes:string[]}
export function TuziProviderDialog({draft,onClose,onSaved}:{draft:TuziProviderDraft;onClose:()=>void;onSaved?:(providerId:string)=>void}) {
 const initial=useMemo(()=>tuziCreationPrefill(draft),[draft]);
 const [pending,setPending]=useState<{provider:Provider;preview:Preview;resolve:()=>void;reject:(error:Error)=>void}|null>(null);
 const pendingRef=useRef(pending);
 pendingRef.current=pending;
 useEffect(()=>()=>{pendingRef.current?.reject(new Error('账户或创建草稿已关闭'));pendingRef.current=null;},[]);
 const queryClient=useQueryClient();
 const cancel=()=>{pending?.reject(new Error('已取消保存'));setPending(null);onClose();};
 return <><AddProviderDialog open appId={draft.appId} creationPrefill={initial} onOpenChange={open=>{if(!open)cancel();}} onSubmit={async value=>{
   const provider={...value,id:crypto.randomUUID()} as Provider;
   const preview=await invoke<Preview>('tuzi_provider_preview',{app:draft.appId,provider});
   await new Promise<void>((resolve,reject)=>setPending({provider,preview,resolve,reject}));
 }}/><ConfirmDialog isOpen={!!pending} title="确认配置变更" message={pending ? `${pending.preview.changes.join('\n')}\n模型 Key 已脱敏。保存前将完成全部文件和本地状态备份；保存、启用和测试是独立结果，不自动调用模型。` : ''} confirmText="备份并保存" cancelText="取消" onCancel={()=>{pending?.reject(new Error('已取消保存'));setPending(null);}} onConfirm={async()=>{
   if(!pending)return;
   try {
     const outcome=await invoke<{backupId:string;enabled:boolean;tested:boolean}>('tuzi_provider_save',{app:draft.appId,provider:pending.provider,previewId:pending.preview.id,source:{site:'https://api.tu-zi.com',userId:draft.userId,tokenId:draft.tokenId,generation:draft.generation}});
     await queryClient.invalidateQueries({queryKey:['providers',draft.appId]});
     toast.success(outcome.enabled?'已保存并按工具规则启用':'已保存，尚未启用',{description:'未执行模型测试。可从本次完整备份恢复。',duration:20000,action:{label:'恢复配置',onClick:()=>{void invoke('tuzi_provider_restore',{backupId:outcome.backupId}).then(async()=>{await queryClient.invalidateQueries({queryKey:['providers',draft.appId]});toast.success('已恢复保存前配置');}).catch(error=>toast.error(String(error)));}}});
     pending.resolve();onSaved?.(pending.provider.id);setPending(null);
   }catch(error){pending.reject(new Error(String(error)));setPending(null);}
 }}/></>;
}

interface RecoveryEntry {backupId:string;app:string;providerId:string;createdAt:number}
export function TuziProviderRecovery({appId}:{appId?:AppId}={}) {
 const client=useQueryClient();
 const [open,setOpen]=useState(false);
 const [selected,setSelected]=useState<RecoveryEntry|null>(null);
 const [busy,setBusy]=useState(false);
 const backups=useQuery({queryKey:['tuziProviderBackups',appId],queryFn:()=>invoke<RecoveryEntry[]>('tuzi_provider_backups',{app:appId??null}),enabled:open,staleTime:0});
 return <><Button variant="outline" onClick={()=>setOpen(!open)}>工具配置备份与恢复</Button>{open&&<div className="space-y-2 rounded border p-3">
 <p className="text-sm">恢复会还原本次保存前的工具文件与供应商状态。检测到后续修改时停止，保留当前配置。</p>
 {backups.isLoading&&<p>正在读取本机备份…</p>}{backups.error&&<p role="alert">{String(backups.error)}</p>}
 {backups.data?.length===0&&<p>暂无可恢复的本机备份。</p>}
 {backups.data?.map(entry=><div key={entry.backupId} className="flex items-center justify-between gap-2 text-sm"><span>{entry.app} · {new Date(entry.createdAt*1000).toLocaleString()} · {entry.backupId.slice(0,8)}</span><Button variant="outline" size="sm" disabled={busy} onClick={()=>setSelected(entry)}>恢复</Button></div>)}
 </div>}<ConfirmDialog isOpen={!!selected} title="恢复工具配置" message="确认恢复至该次保存前的完整状态？恢复会核对文件和数据库，若已被其他操作修改则中止。" confirmText="核对并恢复" cancelText="取消" onCancel={()=>setSelected(null)} onConfirm={async()=>{if(!selected||busy)return;setBusy(true);try{await invoke('tuzi_provider_restore',{backupId:selected.backupId});await client.invalidateQueries({queryKey:['providers']});await backups.refetch();toast.success('已恢复保存前配置');setSelected(null);}catch(error){toast.error(String(error));}finally{setBusy(false);}}}/></>;
}
