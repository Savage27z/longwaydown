import { beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};
(globalThis as unknown as { location: { search: string } }).location = { search: '' };

const { Save, SAVE_VERSION } = await import('../src/core/Save');

describe('Save', () => {
  beforeEach(() => store.clear());

  it('starts from defaults and persists', () => {
    const s = new Save();
    expect(s.data.version).toBe(SAVE_VERSION);
    expect(s.isMapUnlocked('snowPeak')).toBe(true);
    expect(s.isMapUnlocked('greenRidge')).toBe(false);
    s.data.progress.unlockedMaps.push('greenRidge');
    s.data.settings.quality = 'high';
    s.write();
    const again = new Save();
    expect(again.isMapUnlocked('greenRidge')).toBe(true);
    expect(again.data.settings.quality).toBe('high');
  });

  it('fills fields missing from older saves and survives corrupt data', () => {
    store.set('long-way-down:save', JSON.stringify({ version: 1, settings: { quality: 'low' } }));
    const s = new Save();
    expect(s.data.settings.quality).toBe('low');
    expect(s.data.settings.sfxVolume).toBeGreaterThan(0);
    expect(s.data.progress.unlockedVehicles).toContain('bicycle');
    store.set('long-way-down:save', '{not json');
    expect(new Save().data.settings.quality).toBe('medium');
  });
});
