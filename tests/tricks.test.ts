import { describe, expect, it } from 'vitest';
import { TRICKS } from '../src/config/stunts';
import { scoreLanding, TrickCombo } from '../src/gameplay/Tricks';
import type { LandInfo } from '../src/vehicles/Vehicle';

const land = (o: Partial<LandInfo>): LandInfo => ({ airTime: 1, impact: 2, flips: 0, spins: 0, grabTime: 0, height: 2, switchLanding: false, ...o });

describe('trick scoring', () => {
  it('ignores hops', () => {
    expect(scoreLanding(land({ airTime: 0.3 }), 'mountainBike')).toBeNull();
  });

  it('names and scores spins, flips, grabs and big air', () => {
    const t = scoreLanding(land({ airTime: 1.5, spins: 2, flips: -1, grabTime: 0.5, height: 9 }), 'snowboard')!;
    expect(t.name).toBe('360 Backflip Indy Big Air');
    expect(t.points).toBe(150 + 2 * TRICKS.halfSpin + TRICKS.flip + TRICKS.grab + 100 + TRICKS.bigAir);
  });

  it('calls a plain air "Air" and double flips "Double"', () => {
    expect(scoreLanding(land({}), 'skis')!.name).toBe('Air');
    expect(scoreLanding(land({ flips: 2 }), 'motorbike')!.name).toBe('Double Frontflip');
  });
});

describe('combo', () => {
  it('multiplies chained tricks and banks after the window', () => {
    const c = new TrickCombo();
    c.add({ name: 'a', points: 100 });
    c.update(1);
    c.add({ name: 'b', points: 200 });
    expect(c.mult).toBe(2);
    expect(c.update(TRICKS.comboWindow - 0.1)).toBe(0);
    expect(c.update(0.2)).toBe(600);
    expect(c.best).toBe(600);
  });

  it('loses the chain on a crash', () => {
    const c = new TrickCombo();
    c.add({ name: 'a', points: 300 });
    expect(c.lose()).toBe(300);
    expect(c.update(10)).toBe(0);
    expect(c.best).toBe(0);
  });
});
