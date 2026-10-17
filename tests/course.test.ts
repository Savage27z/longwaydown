import { describe, expect, it } from 'vitest';
import { MAPS, MAP_ORDER } from '../src/config/maps';
import { generateCourse } from '../src/world/CourseGenerator';
import { TerrainSampler } from '../src/world/TerrainSampler';

describe.each(MAP_ORDER)('course %s', (id) => {
  const map = MAPS[id];
  const course = generateCourse(map);

  it('is 15-25 km long and drops the configured height', () => {
    expect(course.length).toBeGreaterThan(15000);
    expect(course.length).toBeLessThan(25000);
    const drop = course.y[0]! - course.y[course.count - 1]!;
    expect(drop).toBeGreaterThan(map.totalDrop * 0.95);
    expect(drop).toBeLessThan(map.totalDrop * 1.05);
  });

  it('is deterministic', () => {
    const again = generateCourse(map);
    expect(again.count).toBe(course.count);
    for (let i = 0; i < course.count; i += 97) {
      expect(again.x[i]).toBe(course.x[i]);
      expect(again.z[i]).toBe(course.z[i]);
    }
    expect(again.features.length).toBe(course.features.length);
  });

  it('places features, checkpoints and markers', () => {
    expect(course.features.length).toBeGreaterThan(15);
    expect(course.checkpoints.length).toBeGreaterThanOrEqual(7);
    expect(course.markers.length).toBeGreaterThanOrEqual(14);
    expect(course.sectionStart.length).toBe(map.sections.length);
  });

  it('never self-intersects (non-adjacent samples stay apart)', () => {
    let minSep = Infinity;
    for (let i = 0; i < course.count; i += 25) {
      for (let j = i + 400; j < course.count; j += 25) {
        const d = Math.hypot(course.x[i]! - course.x[j]!, course.z[i]! - course.z[j]!);
        if (d < minSep) minSep = d;
      }
    }
    expect(minSep).toBeGreaterThan(60);
  });

  it('terrain follows the line and is continuous', () => {
    const sampler = new TerrainSampler(id, course);
    let maxLineErr = 0;
    for (let i = 100; i < course.count - 100; i += 211) {
      const h = sampler.heightAt(course.x[i]!, course.z[i]!);
      maxLineErr = Math.max(maxLineErr, Math.abs(h - course.y[i]!));
    }
    expect(maxLineErr).toBeLessThan(15);
    // Continuity: neighbours 0.5 m apart never differ by more than a few metres.
    let maxJump = 0;
    for (let k = 0; k < 4000; k++) {
      const i = 50 + ((k * 7919) % (course.count - 100));
      const x = course.x[i]! + ((k % 13) - 6) * 15;
      const z = course.z[i]! + ((k % 7) - 3) * 20;
      const a = sampler.heightAt(x, z);
      const b = sampler.heightAt(x + 0.5, z);
      maxJump = Math.max(maxJump, Math.abs(a - b));
    }
    expect(maxJump).toBeLessThan(6);
  });
});

describe('sampler performance', () => {
  it('builds a 129x129 tile worth of heights quickly', () => {
    const sampler = new TerrainSampler('snowPeak');
    const c = sampler.course;
    const i = Math.floor(c.count / 2);
    const x0 = c.x[i]! - 128;
    const z0 = c.z[i]! - 128;
    const t0 = performance.now();
    let sum = 0;
    for (let a = 0; a <= 128; a++) for (let b = 0; b <= 128; b++) sum += sampler.heightAt(x0 + a * 2, z0 + b * 2);
    const ms = performance.now() - t0;
    console.log(`129x129 heights: ${ms.toFixed(1)} ms, course length ${(c.length / 1000).toFixed(2)} km, features ${c.features.length}`);
    expect(Number.isFinite(sum)).toBe(true);
    expect(ms).toBeLessThan(1500);
  });
});
