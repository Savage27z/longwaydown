import { describe, expect, it } from 'vitest';
import { RUN } from '../src/config/gameplay';
import { events } from '../src/core/Events';
import { Run } from '../src/gameplay/Run';

describe('Run lifecycle', () => {
  it('goes intro -> countdown -> running -> finished with checkpoints and penalties', () => {
    const run = new Run('snowPeak', [1000, 2000], 0, 3000, { time: 100, splits: [30, 60], date: '' });
    const seen: string[] = [];
    const offs = [
      events.on('run:state', (s) => seen.push(s.state)),
      events.on('run:countdown', (c) => seen.push(`cd${c.n}`)),
      events.on('run:checkpoint', (c) => seen.push(`cp${c.index}:${c.delta! < 0 ? 'ahead' : 'behind'}`)),
    ];
    run.begin();
    const dt = 1 / 60;
    for (let t = 0; t < RUN.introDuration + 4 && run.state !== 'running'; t += dt) run.update(dt, dt, { progressS: 0, speed: 0 });
    expect(run.state).toBe('running');
    expect(seen).toContain('cd3');
    expect(seen).toContain('cd0');
    // Ride 20 s to the first checkpoint (ahead of the 30 s best split).
    for (let i = 0; i < 1200; i++) run.update(dt, dt, { progressS: i, speed: 20 });
    run.update(dt, dt, { progressS: 1001, speed: 20 });
    events.emit('player:crash', { reason: 'test', penalty: 3 });
    expect(run.crashes).toBe(1);
    expect(run.penalties).toBe(3);
    for (let i = 0; i < 4000; i++) run.update(dt, dt, { progressS: 1001 + i, speed: 25 });
    expect(run.state).toBe('finished');
    const r = run.results();
    expect(r.newRecord).toBe(true);
    expect(r.splits.length).toBe(2);
    expect(r.topSpeed).toBe(25);
    expect(seen).toContain('cp0:ahead');
    for (const off of offs) off();
    run.dispose();
  });

  it('keeps the clock still while frozen by Time Freeze', () => {
    const run = new Run('snowPeak', [], 0, 1e9, null);
    run.begin(true);
    for (let i = 0; i < 300; i++) run.update(1 / 60, 1 / 60, { progressS: 0, speed: 0 });
    const before = run.time;
    run.freeze = 1;
    for (let i = 0; i < 60; i++) run.update(1 / 60, 1 / 60, { progressS: 0, speed: 0 });
    expect(run.time).toBeCloseTo(before, 5);
    run.dispose();
  });
});
