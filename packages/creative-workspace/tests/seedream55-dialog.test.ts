import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { LayerDecompositionDialog } from '../upstream/packages/drawnix/src/components/layer-decomposition/LayerDecompositionDialog';
const {decompose,insert,board}=vi.hoisted(()=>({decompose:vi.fn(),insert:vi.fn(),board:{children:[{id:'source',type:'image'}]}}));
const {readPreview}=vi.hoisted(()=>({readPreview:vi.fn()}));
vi.mock('../upstream/packages/drawnix/src/services/unified-cache-service',()=>({
  unifiedCacheService:{getCachedImageBlobWithThumbnailFallback:readPreview},
}));
vi.mock('../upstream/packages/drawnix/src/hooks/use-drawnix',()=>({useDrawnix:()=>({board})}));
vi.mock('../upstream/packages/drawnix/src/services/layer-decomposition/provider',()=>({decomposeWithConfiguredImageProvider:decompose}));
vi.mock('../upstream/packages/drawnix/src/services/layer-decomposition',()=>({
  createLayerDecompositionApiClient:()=>({decompose:vi.fn(),cancel:vi.fn()}),insertLayerDecomposition:insert,
  LayerDecompositionCorrectionRequiredError:class extends Error {},
}));
vi.mock('../upstream/packages/drawnix/src/components/dialog/ConfirmDialog',()=>({
  ConfirmDialog:({children,footer}:any)=>React.createElement('div',null,children,footer),
}));
vi.mock('tdesign-react',()=>({
  Button:({children,onClick,disabled}:any)=>React.createElement('button',{onClick,disabled},children),
  Progress:()=>null,MessagePlugin:{warning:vi.fn(),error:vi.fn(),success:vi.fn()},
}));
describe('real layer settings dialog',()=>{
  beforeEach(()=>{vi.clearAllMocks();readPreview.mockResolvedValue(null);});
  it('resolves a desktop cached source for preview without making a model request',async()=>{
    readPreview.mockResolvedValue(new Blob(['synthetic-image'],{type:'image/png'}));
    const createUrl=vi.fn(()=> 'blob:synthetic-layer-preview');
    const revokeUrl=vi.fn();
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:createUrl});
    Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:revokeUrl});
    const {container,unmount}=render(React.createElement(LayerDecompositionDialog,{open:true,board:board as any,sourceElementId:'source',imageUrl:'/__aitu_cache__/image/authorized.png',language:'zh',providerModelId:'doubao-seedream-5-5-261028',onClose:()=>{}}));
    await waitFor(()=>expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:synthetic-layer-preview'));
    expect(readPreview).toHaveBeenCalledWith('/__aitu_cache__/image/authorized.png');
    expect(decompose).not.toHaveBeenCalled();
    unmount();
    expect(revokeUrl).toHaveBeenCalledWith('blob:synthetic-layer-preview');

  });
  it('recovers when the virtual source fails before its cached bytes arrive',async()=>{
    let resolveCache!: (blob:Blob)=>void;
    readPreview.mockReturnValue(new Promise<Blob>(resolve=>{resolveCache=resolve;}));
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:late-layer-preview')});
    Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
    const {container,unmount}=render(React.createElement(LayerDecompositionDialog,{open:true,board:board as any,sourceElementId:'source',imageUrl:'/__aitu_cache__/image/late.png',language:'zh',providerModelId:'doubao-seedream-5-5-261028',onClose:()=>{}}));
    fireEvent.error(container.querySelector('img')!);
    await act(async()=>{resolveCache(new Blob(['synthetic-image'],{type:'image/png'}));});
    await waitFor(()=>expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:late-layer-preview'));
    fireEvent.load(container.querySelector('img')!);
    expect(decompose).not.toHaveBeenCalled();
    expect(readPreview).toHaveBeenCalledTimes(1);
    unmount();
  });
  it('submits chosen OCR and total layer limit, displays results and applies to canvas',async()=>{
    const artifact={groupId:'synthetic',url:'https://example.test/layer.png',zIndex:1,name:'标题',description:'',boundingBox:{absolute:[0,0,1,1],normalized:[0,0,1000,1000]},textRecognition:{text:'你好',lines:[{font:{family:'Synthetic'}}]}};
    decompose.mockResolvedValue({groupId:'synthetic',background:{...artifact,zIndex:0},layers:[artifact],resultKind:'inference'});
    insert.mockResolvedValue({});
    render(React.createElement(LayerDecompositionDialog,{open:true,board:board as any,sourceElementId:'source',imageUrl:'https://example.test/source.png',language:'zh',providerModelId:'doubao-seedream-5-5-261028',onClose:()=>{}}));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByRole('slider'),{target:{value:'99'}});
    fireEvent.change(screen.getByRole('combobox'),{target:{value:'1.5K'}});
    fireEvent.click(screen.getByRole('button',{name:/开始分层/}));
    await waitFor(()=>expect(decompose).toHaveBeenCalledTimes(1));
    expect(decompose.mock.calls[0][0]).toMatchObject({maxLayers:99,textRecognition:true,size:'1.5K'});
    expect(await screen.findByText(/OCR 和图层扩展信息/)).toBeTruthy();
    expect(screen.getAllByText(/你好/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button',{name:/应用|插入/}));
    await waitFor(()=>expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][2].layers[0].textRecognition).toEqual(artifact.textRecognition);
  });
});
