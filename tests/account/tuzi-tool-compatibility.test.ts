import { isNativeTool } from '@/lib/api/nativeTools';
import {describe,it,expect} from 'vitest';
import {TUZI_TOOL_TARGETS,tuziToolCompatibility} from '@/lib/tuziToolCompatibility';
import {tuziCreationPrefill} from '@/components/providers/TuziProviderDialog';
const key={status:1,group:'default',model_limits:'other',model_limits_enabled:false,remain_quota:'900719925474099300'};
const model={model_name:'synthetic-model',enable_groups:['default'],supported_endpoint_types:['codex_responses','anthropic_messages','openai_chat','gemini_native']};
describe('account tool creation',()=>{
 it('requires actual compatibility and preserves Linux restriction',()=>{
  for(const target of TUZI_TOOL_TARGETS) expect(tuziToolCompatibility(key,model,target.appId,target.protocol,'MacIntel')).toBeNull();
  expect(tuziToolCompatibility(key,model,'claude-desktop','anthropic','Linux')).toMatch('Linux');
  expect(tuziToolCompatibility({...key,model_limits_enabled:true},model,'codex','responses')).toMatch('模型限制');
  expect(tuziToolCompatibility({...key,status:2},model,'codex','responses')).toMatch('未启用');
  expect(tuziToolCompatibility({...key,group:'different'},model,'codex','responses')).toMatch('分组');
  expect(tuziToolCompatibility(key,{...model,supported_endpoint_types:['anthropic_messages']},'codex','responses')).toMatch('端点');
 });
 it('all seven creation payloads contain only a synthetic model key and independent Codex key',()=>{
  for(const appId of [...new Set(TUZI_TOOL_TARGETS.map(t=>t.appId))]) {
   if (isNativeTool(appId)) continue;
   const target=TUZI_TOOL_TARGETS.find(t=>t.appId===appId)!;
   const data=tuziCreationPrefill({appId,protocol:target.protocol,key:'SYNTHETIC_MODEL_KEY',tokenId:'17',userId:'20',generation:1,model:'synthetic-model'});
   expect(JSON.stringify(data)).toContain('SYNTHETIC_MODEL_KEY');
   expect(JSON.stringify(data)).not.toContain('/coding');
   if(appId==='codex')expect(JSON.stringify(data)).toContain('TUZI_SWITCH_');
   if(appId==='claude-desktop')expect(data?.meta?.claudeDesktopMode).toBe('proxy');
  }
 });
});

it('resolves virtual default per model using visible pricing metadata',()=>{
 const key={status:1,group:'default',model_limits:'',unlimited_quota:true};
 const model={model_name:'synthetic',enable_groups:['special'],supported_endpoint_types:['responses']};
 expect(tuziToolCompatibility(key,model,'codex','responses','MacIntel',{usable_group:{special:'Special'},default_effective_group:'ordinary',default_resolution:{synthetic:{effective_group:'special'}}})).toBeNull();
 expect(tuziToolCompatibility(key,model,'codex','responses','MacIntel',{usable_group:{ordinary:'Ordinary'},default_effective_group:'special'})).toBe('Key 分组与模型不兼容');
});


it('accepts the API Responses endpoint and legacy aliases but excludes Chat-only models',()=>{
 for(const endpoint of ['openai-response','openai-responses','responses','codex_responses']) {
  expect(tuziToolCompatibility(key,{...model,supported_endpoint_types:[endpoint]},'codex','responses')).toBeNull();
 }
 expect(tuziToolCompatibility(key,{...model,supported_endpoint_types:['openai']},'codex','responses')).toMatch('端点');
});
