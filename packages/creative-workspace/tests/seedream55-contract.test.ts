import { describe, it, expect } from 'vitest';
import fixtures from './seedream55-native-fixtures.json';
import { validateSeedream55, seedream55GenerationBody, SEEDREAM55_MODEL_ID } from '../upstream/packages/drawnix/src/services/model-adapters/seedream55';
import { getCompatibleParams } from '../upstream/packages/drawnix/src/constants/model-config';

describe('Seedream 5.5 paired API native fixtures (28443ae8)', () => {
  it.each(fixtures)('$name', fixture => {
    if (fixture.valid) expect(validateSeedream55(fixture.request)).toBe(fixture.maximum);
    else expect(() => validateSeedream55(fixture.request)).toThrow();
  });
  it('retains explicit false, transparency and output format', () => {
    expect(seedream55GenerationBody({ prompt: 'rabbit', background: 'transparent', params: {watermark:false} }))
      .toMatchObject({ background:'transparent', output_format:'png', watermark:false, size:'2K' });
    expect(() => seedream55GenerationBody({prompt:'rabbit', background:'transparent', outputFormat:'jpeg'})).toThrow(/PNG/);
  });
  it.each(['1k','1.5k','2k'])('maps supported aspect ratios within the %s pixel budget', quality => {
    for(const size of ['1x1','16x9','9x16','21x9','3x2','2x3','4x3','3x4']) {
      expect(() => seedream55GenerationBody({prompt:'rabbit',size,params:{seedream_quality:quality}})).not.toThrow();
    }
  });
  it('rejects old quality and excessive references before sending', () => {
    expect(() => seedream55GenerationBody({prompt:'rabbit',params:{seedream_quality:'4k'}})).toThrow();
    expect(() => seedream55GenerationBody({prompt:'rabbit',referenceImages:Array(11).fill('https://example.test/a.png')})).toThrow();
  });
});

it('exposes exact model controls without old 4K quality',()=>{
  const params=getCompatibleParams(SEEDREAM55_MODEL_ID);
  expect(params.find(p=>p.id==='seedream_quality')?.options?.map(o=>o.value)).toEqual(['1k','1.5k','2k']);
  expect(params.find(p=>p.id==='background')?.options?.some(o=>o.value==='transparent')).toBe(true);
  expect(params.find(p=>p.id==='output_format')?.options?.map(o=>o.value)).toEqual(['png','jpeg']);
});
