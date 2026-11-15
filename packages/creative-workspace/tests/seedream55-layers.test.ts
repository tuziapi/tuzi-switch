import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeProviderLayerPayload, decomposeWithConfiguredImageProvider } from '../upstream/packages/drawnix/src/services/layer-decomposition/provider';
import { parseLayerDecompositionResponse } from '../upstream/packages/drawnix/src/services/layer-decomposition/contract';
import { buildLayerDecompositionManifest } from '../upstream/packages/drawnix/src/services/layer-decomposition/manifest';
import { SEEDREAM55_MODEL_ID } from '../upstream/packages/drawnix/src/services/model-adapters/seedream55';
const {send} = vi.hoisted(()=>({send:vi.fn()}));
vi.mock('../upstream/packages/drawnix/src/services/model-adapters/context',()=>({
  sendAdapterRequest:send,
  getAdapterContextFromSettings:()=>({baseUrl:'https://api.example.test/v1',binding:{modelId:'doubao-seedream-5-5-261028',protocol:'openai.images.generations'}}),
}));
vi.mock('../upstream/packages/drawnix/src/utils/settings-manager',async (importOriginal)=>({
  ...await importOriginal<typeof import('../upstream/packages/drawnix/src/utils/settings-manager')>(),
  settingsManager:{waitForInitialization:async()=>{}}, createModelRef:(profileId:string,modelId:string)=>({profileId,modelId}),
  resolveInvocationRoute:()=>({profileId:'synthetic',modelId:'doubao-seedream-5-5-261028'}),
}));
const layer = (z:number) => ({url:'https://example.test/same.png',z_index:z,
  bounding_box:{absolute:[0,0,100,100],normalized:[0,0,1000,1000]},name:`layer-${z}`,description:'',
  background:z===0?'opaque':'transparent', text_recognition:z===0?undefined:{text:'你好',lines:[{font:{family:'Synthetic'},styles:[{bold:true}]}]},
  future_extension:{version:55}});
const payload = (n=3)=>({data:Array.from({length:n},(_,i)=>layer(i))});
beforeEach(()=>send.mockReset());
describe('Seedream 5.5 layers and OCR',()=>{
  it('preserves duplicate URLs, OCR and unknown fields without fabricating quality',()=>{
    const r=normalizeProviderLayerPayload(payload(),{seedream55:true,trustedModel:true,maxImages:30});
    expect(r.layers).toHaveLength(2);
    expect(r.quality).toBeUndefined();
    expect(r.layers[0].textRecognition).toEqual(layer(1).text_recognition);
    expect(r.layers[0].providerMetadata?.future_extension).toEqual({version:55});
    const m=buildLayerDecompositionManifest(r);
    expect(JSON.parse(JSON.stringify(m)).layers[1].textRecognition).toEqual(layer(1).text_recognition);
    (r.layers[0].providerMetadata!.future_extension as {version:number}).version=0;
    expect((m.layers[1].providerMetadata!.future_extension as {version:number}).version).toBe(55);
  });
  it('allows 100 results only for the explicit provider path',()=>{
    expect(normalizeProviderLayerPayload(payload(100),{seedream55:true,trustedModel:true,maxImages:100}).layers).toHaveLength(99);
    expect(()=>parseLayerDecompositionResponse({group_id:'synthetic',data:payload(18).data})).toThrow(/16/);
  });
  it('rejects partial failures, excessive results and duplicate z indexes',()=>{
    const bad=payload(); bad.data[1]={...bad.data[1],error:{code:'failed'}} as any;
    expect(()=>normalizeProviderLayerPayload(bad,{seedream55:true,maxImages:30})).toThrow(/失败/);
    expect(()=>normalizeProviderLayerPayload(payload(4),{seedream55:true,maxImages:3})).toThrow(/上限/);
    const duplicate=payload(); duplicate.data[2].z_index=1;
    expect(()=>normalizeProviderLayerPayload(duplicate,{seedream55:true,maxImages:30})).toThrow(/duplicate/);
  });
  it.each([true,false])('sends max_images including base and explicit OCR %s, omitting background',async ocr=>{
    send.mockResolvedValue(new Response(JSON.stringify(payload())));
    const r=await decomposeWithConfiguredImageProvider({image:'https://example.test/input.png',maxLayers:99,textRecognition:ocr,size:'1.5K'}, {modelId:SEEDREAM55_MODEL_ID});
    const body=JSON.parse(send.mock.calls[0][1].body);
    expect(body).toMatchObject({model:SEEDREAM55_MODEL_ID,size:'1.5K',response_format:'url',layer_decomposition:true,layer_decomposition_options:{max_images:100,text_recognition:ocr}});
    expect(body).not.toHaveProperty('background'); expect(r?.layers).toHaveLength(2); expect(send).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid limits without network submission',async()=>{
    await expect(decomposeWithConfiguredImageProvider({image:'https://example.test/input.png',maxLayers:100},{modelId:SEEDREAM55_MODEL_ID})).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
