import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LayerDecompositionDialog } from '../upstream/packages/drawnix/src/components/layer-decomposition/LayerDecompositionDialog';
const {decompose,insert,board}=vi.hoisted(()=>({decompose:vi.fn(),insert:vi.fn(),board:{children:[{id:'source',type:'image'}]}}));
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
