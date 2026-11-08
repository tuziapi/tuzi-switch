import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_INTERACTION_MODE_KEY, readCanvasInteractionMode, saveCanvasInteractionMode } from './canvas-interaction-mode';

describe('device canvas mode preference', () => {
  const values = new Map<string, string>();
  const setItem = vi.fn((key: string, value: string) => values.set(key, value));
  beforeEach(() => {
    values.clear();
    setItem.mockClear();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('defaults old profiles and invalid values to browse', () => {
    expect(readCanvasInteractionMode()).toBe('browse');
    values.set(CANVAS_INTERACTION_MODE_KEY, '{"unexpected":true}');
    expect(readCanvasInteractionMode()).toBe('browse');
  });
  it('restores both modes without touching unrelated preferences', () => {
    values.set('unrelated', 'keep');
    saveCanvasInteractionMode('edit');
    expect(readCanvasInteractionMode()).toBe('edit');
    saveCanvasInteractionMode('browse');
    expect(readCanvasInteractionMode()).toBe('browse');
    expect(values.get('unrelated')).toBe('keep');
  });
  it('does not repeatedly write an unchanged mode', () => {
    saveCanvasInteractionMode('edit');
    saveCanvasInteractionMode('edit');
    expect(setItem).toHaveBeenCalledTimes(1);
  });
  it('survives unavailable reads and failed writes', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('unavailable'); }, setItem });
    expect(readCanvasInteractionMode()).toBe('browse');
    expect(() => saveCanvasInteractionMode('edit')).not.toThrow();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('quota'); } });
    expect(() => saveCanvasInteractionMode('edit')).not.toThrow();
  });
});
