import { describe, expect, it } from 'vitest';
import { hash3, makeRng } from '../src/utils/rng';
import { formatTime, wrapAngle } from '../src/utils/math';

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = makeRng('snow-peak');
    const b = makeRng('snow-peak');
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('differs between seeds and stays in [0,1)', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    let same = 0;
    for (let i = 0; i < 1000; i++) {
      const x = a();
      const y = b();
      if (x === y) same++;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(same).toBeLessThan(5);
  });

  it('hash3 is stable', () => {
    expect(hash3(1, 2, 3, 4)).toBe(hash3(1, 2, 3, 4));
    expect(hash3(1, 2, 3, 4)).not.toBe(hash3(1, 2, 3, 5));
  });
});

describe('math', () => {
  it('wraps angles', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5);
  });

  it('formats times', () => {
    expect(formatTime(65.25)).toBe('1:05.250');
    expect(formatTime(5, false)).toBe('0:05');
  });
});
