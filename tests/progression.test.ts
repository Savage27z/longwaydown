import { describe, expect, it } from 'vitest';
import type { Save } from '../src/core/Save';
import { defaultSave } from '../src/core/Save';
import { Progression } from '../src/gameplay/Progression';

function fakeSave() {
  const data = defaultSave();
  let writes = 0;
  const save = { data, write: () => void writes++ } as unknown as Save;
  return { save, data, writes: () => writes };
}

describe('Progression', () => {
  it('starts with only the bicycle and wingsuit', () => {
    const { save } = fakeSave();
    const p = new Progression(save);
    expect(p.vehicleUnlocked('bicycle')).toBe(true);
    expect(p.vehicleUnlocked('wingsuit')).toBe(true);
    expect(p.vehicleUnlocked('mountainBike')).toBe(false);
    expect(p.vehicleUnlocked('flyingCar')).toBe(false);
    expect(p.outfitUnlocked('Swat')).toBe(false);
    expect(p.gogglesUnlocked('goggles')).toBe(true);
    expect(p.gogglesUnlocked('shades')).toBe(false);
  });

  it('records milestone unlocks once and keeps them', () => {
    const { save, data, writes } = fakeSave();
    const p = new Progression(save);
    data.progress.finishes.snowPeak = 1;
    data.progress.bestTimes.snowPeak = { time: 700, splits: [], date: '' };
    const got = p.collectNew().map((u) => u.id);
    expect(got).toEqual(expect.arrayContaining(['mountainBike', 'snowboard', 'skis', 'roadster', 'Swat']));
    expect(got).not.toContain('flyingCar');
    expect(writes()).toBe(1);
    expect(p.collectNew()).toEqual([]);
    // Stored: still unlocked even if the stats that earned it were reset.
    data.progress.finishes = {};
    expect(p.vehicleUnlocked('mountainBike')).toBe(true);
  });

  it('tokens unlock cosmetics, and unlock-all opens everything', () => {
    const { save, data } = fakeSave();
    const p = new Progression(save);
    data.progress.collectibles = ['snowPeak:0', 'snowPeak:1'];
    expect(p.collectNew().map((u) => u.id)).toEqual(['shades']);
    data.settings.unlockAll = true;
    expect(p.vehicleUnlocked('car')).toBe(true);
    expect(p.outfitUnlocked('King')).toBe(true);
  });
});
