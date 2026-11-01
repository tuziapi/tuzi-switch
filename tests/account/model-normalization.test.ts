import { describe, expect, it } from 'vitest';
import { normalizeModels } from '../../src/lib/api/modelNormalization';
describe('model wire compatibility', () => {
  it('normalizes omitted and null optional arrays recursively', () => {
    const result = normalizeModels({ items: [{ model_name: 'gpt-test', enable_groups: null, related_pricing: [{ model_name: 'child' }] }], pagination: { total: '1' } });
    expect(result.items[0].supported_endpoint_types).toEqual([]);
    expect(result.items[0].related_pricing[0].related_pricing).toEqual([]);
  });
  it('accepts genuine empty search results', () => {
    expect(normalizeModels({ items: [], pagination: { total: '0' } }).items).toEqual([]);
  });
  it('does not disguise malformed catalogs as no results', () => {
    expect(() => normalizeModels({ items: null, pagination: { total: '0' } })).toThrow();
    expect(() => normalizeModels({ items: [{ model_name: 'bad', enable_groups: {} }], pagination: { total: '1' } })).toThrow();
  });
});
