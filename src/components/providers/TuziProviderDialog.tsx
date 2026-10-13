import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useQueryClient } from '@tanstack/react-query';
import { AddProviderDialog } from './AddProviderDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
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
     await invoke('tuzi_provider_save',{app:draft.appId,provider:pending.provider,previewId:pending.preview.id,source:{site:'https://api.tu-zi.com',userId:draft.userId,tokenId:draft.tokenId,generation:draft.generation}});
     await queryClient.invalidateQueries({queryKey:['providers',draft.appId]});
     pending.resolve();onSaved?.(pending.provider.id);setPending(null);
   }catch(error){pending.reject(new Error(String(error)));setPending(null);}
 }}/></>;
}
