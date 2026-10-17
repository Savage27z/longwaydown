import { TERRAIN } from '../config/terrain';
import { clamp } from '../utils/math';
import type { CourseData } from './CourseGenerator';

/** Grid hash over every `stride`-th course sample. */
export class SampleHash {
  private cells = new Map<number, number[]>();

  constructor(
    private readonly course: CourseData,
    readonly stride: number,
    readonly cell: number,
  ) {
    for (let i = 0; i < course.count; i += stride) this.add(i);
    if ((course.count - 1) % stride !== 0) this.add(course.count - 1);
  }

  private add(i: number): void {
    const k = key(Math.floor(this.course.x[i]! / this.cell), Math.floor(this.course.z[i]! / this.cell));
    let list = this.cells.get(k);
    if (!list) this.cells.set(k, (list = []));
    list.push(i);
  }

  forEachInRadius(x: number, z: number, r: number, fn: (i: number) => void): void {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c);
    const x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c);
    const z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.cells.get(key(cx, cz));
        if (list) for (let j = 0; j < list.length; j++) fn(list[j]!);
      }
    }
  }

  /** Nearest hashed sample within maxR, or -1. Expands ring by ring. */
  nearest(x: number, z: number, maxR: number): number {
    const c = this.cell;
    const cx = Math.floor(x / c);
    const cz = Math.floor(z / c);
    const xs = this.course.x;
    const zs = this.course.z;
    let best = -1;
    let bestD2 = maxR * maxR;
    const maxRing = Math.ceil(maxR / c) + 1;
    for (let ring = 0; ring <= maxRing; ring++) {
      // Every point in this ring is at least (ring - 1) * cell away.
      const minD = Math.max(0, ring - 1) * c;
      if (best >= 0 && minD * minD > bestD2) break;
      for (let ix = cx - ring; ix <= cx + ring; ix++) {
        for (let iz = cz - ring; iz <= cz + ring; iz++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== ring) continue;
          const list = this.cells.get(key(ix, iz));
          if (!list) continue;
          for (let j = 0; j < list.length; j++) {
            const i = list[j]!;
            const dx = xs[i]! - x;
            const dz = zs[i]! - z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = i;
            }
          }
        }
      }
    }
    return best;
  }
}

function key(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

export interface NearestResult {
  /** Fine sample index at/below the projection. */
  idx: number;
  /** Distance along the course (m). */
  s: number;
  /** Signed lateral offset (+ = right of travel direction). */
  lat: number;
  /** Horizontal distance to the line. */
  d: number;
}

/** Smoothly-varying course fields at a ground point (kernel-weighted over nearby samples). */
export interface CourseFields {
  d: number;
  s: number;
  lat: number;
  idx: number;
  E: number;
  hw: number;
  walls: number;
  rough: number;
  bumps: number;
  forest: number;
  rocks: number;
  flat: number;
}

export function emptyFields(): CourseFields {
  return { d: 0, s: 0, lat: 0, idx: 0, E: 0, hw: 0, walls: 0, rough: 0, bumps: 0, forest: 0, rocks: 0, flat: 0 };
}

export class CourseQuery {
  readonly fine: SampleHash;
  readonly coarse: SampleHash;
  readonly far: SampleHash;
  private acc = new Float64Array(9);
  private acc2 = new Float64Array(9);

  constructor(readonly course: CourseData) {
    this.fine = new SampleHash(course, 4, 64);
    this.coarse = new SampleHash(course, 32, 512);
    this.far = new SampleHash(course, 128, 2048);
  }

  /** Exact nearest point on the polyline (projected), searching around a seed index. */
  refine(x: number, z: number, seed: number, span: number, out: NearestResult): NearestResult {
    const c = this.course;
    const lo = Math.max(0, seed - span);
    const hi = Math.min(c.count - 1, seed + span);
    let bestI = seed;
    let bestD2 = Infinity;
    for (let i = lo; i <= hi; i++) {
      const dx = c.x[i]! - x;
      const dz = c.z[i]! - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestI = i;
      }
    }
    return this.project(x, z, bestI, out);
  }

  /** Project onto the segment(s) adjacent to sample i. */
  project(x: number, z: number, i: number, out: NearestResult): NearestResult {
    const c = this.course;
    let bestD2 = Infinity;
    let bestI = i;
    let bestT = 0;
    for (let a = i - 1; a <= i; a++) {
      if (a < 0 || a + 1 >= c.count) continue;
      const ax = c.x[a]!;
      const az = c.z[a]!;
      const sx = c.x[a + 1]! - ax;
      const sz = c.z[a + 1]! - az;
      const len2 = sx * sx + sz * sz || 1;
      const t = clamp(((x - ax) * sx + (z - az) * sz) / len2, 0, 1);
      const px = ax + sx * t - x;
      const pz = az + sz * t - z;
      const d2 = px * px + pz * pz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestI = a;
        bestT = t;
      }
    }
    if (bestD2 === Infinity) {
      const dx = c.x[i]! - x;
      const dz = c.z[i]! - z;
      bestD2 = dx * dx + dz * dz;
    }
    const j = bestI;
    const j1 = Math.min(c.count - 1, j + 1);
    const tx = c.tx[j]! + (c.tx[j1]! - c.tx[j]!) * bestT;
    const tz = c.tz[j]! + (c.tz[j1]! - c.tz[j]!) * bestT;
    const px = c.x[j]! + (c.x[j1]! - c.x[j]!) * bestT;
    const pz = c.z[j]! + (c.z[j1]! - c.z[j]!) * bestT;
    out.idx = j;
    out.s = (j + bestT) * c.step;
    out.d = Math.sqrt(bestD2);
    // Right vector = (-tz, tx).
    out.lat = (x - px) * -tz + (z - pz) * tx;
    return out;
  }

  nearest(x: number, z: number, out: NearestResult = { idx: 0, s: 0, lat: 0, d: 0 }): NearestResult {
    // Cheap coarse estimate first; only run the fine ring search when the line is close.
    const fi = Math.max(0, this.far.nearest(x, z, 1e9));
    const c = this.course;
    const approx = Math.hypot(c.x[fi]! - x, c.z[fi]! - z);
    if (approx > 900) return this.refine(x, z, fi, 70, out);
    let i = this.fine.nearest(x, z, approx + 140);
    if (i < 0) i = fi;
    return this.refine(x, z, i, 6, out);
  }

  /** Kernel-averaged course fields. Continuous everywhere (compact Wendland-style kernel). */
  fields(x: number, z: number, out: CourseFields): CourseFields {
    const near = this.nearest(x, z, NEAREST);
    out.d = near.d;
    out.s = near.s;
    out.lat = near.lat;
    out.idx = near.idx;
    const sigma = Math.max(TERRAIN.kernelSigma, near.d * TERRAIN.kernelGrowth);
    // Blend between sample densities so the result stays continuous as sigma grows.
    const acc = this.acc;
    const acc2 = this.acc2;
    if (sigma <= 60) this.kernel(this.fine, x, z, sigma, acc);
    else if (sigma < 80) this.blend(this.fine, this.coarse, (sigma - 60) / 20, x, z, sigma);
    else if (sigma <= 350) this.kernel(this.coarse, x, z, sigma, acc);
    else if (sigma < 450) this.blend(this.coarse, this.far, (sigma - 350) / 100, x, z, sigma);
    else this.kernel(this.far, x, z, sigma, acc);
    void acc2;
    const c = this.course;
    if (acc[0]! <= 1e-9) {
      const i = near.idx;
      out.E = c.y[i]!;
      out.hw = c.hw[i]!;
      out.walls = c.walls[i]!;
      out.rough = c.rough[i]!;
      out.bumps = c.bumps[i]!;
      out.forest = c.forest[i]!;
      out.rocks = c.rocks[i]!;
      out.flat = c.flat[i]!;
      return out;
    }
    const inv = 1 / acc[0]!;
    out.E = acc[1]! * inv;
    out.hw = acc[2]! * inv;
    out.walls = acc[3]! * inv;
    out.rough = acc[4]! * inv;
    out.bumps = acc[5]! * inv;
    out.forest = acc[6]! * inv;
    out.rocks = acc[7]! * inv;
    out.flat = acc[8]! * inv;
    return out;
  }

  private kernel(hash: SampleHash, x: number, z: number, sigma: number, acc: Float64Array): void {
    acc.fill(0);
    this.accumulate(hash, x, z, sigma, acc);
  }

  private blend(a: SampleHash, b: SampleHash, t: number, x: number, z: number, sigma: number): void {
    this.kernel(a, x, z, sigma, this.acc);
    this.kernel(b, x, z, sigma, this.acc2);
    for (let k = 0; k < 9; k++) this.acc[k] = this.acc[k]! * (1 - t) + this.acc2[k]! * t;
  }

  /** acc = [sumW, E, hw, walls, rough, bumps, forest, rocks, flat] (unnormalized). */
  private accumulate(hash: SampleHash, x: number, z: number, sigma: number, acc: Float64Array): void {
    const c = this.course;
    const R = sigma * 2.5;
    const R2 = R * R;
    hash.forEachInRadius(x, z, R, (i) => {
      const dx = c.x[i]! - x;
      const dz = c.z[i]! - z;
      const r2 = dx * dx + dz * dz;
      if (r2 >= R2) return;
      const q = 1 - r2 / R2;
      const w = q * q;
      acc[0] += w;
      acc[1] += w * c.y[i]!;
      acc[2] += w * c.hw[i]!;
      acc[3] += w * c.walls[i]!;
      acc[4] += w * c.rough[i]!;
      acc[5] += w * c.bumps[i]!;
      acc[6] += w * c.forest[i]!;
      acc[7] += w * c.rocks[i]!;
      acc[8] += w * c.flat[i]!;
    });
  }
}

const NEAREST: NearestResult = { idx: 0, s: 0, lat: 0, d: 0 };

/**
 * Tracks a rider's progress along the course. Searches a window around the last index so it
 * never jumps to a neighbouring switchback leg; falls back to a global search only when the
 * rider is clearly closer to another part of the course.
 */
export class ProgressTracker {
  idx = 0;
  readonly result: NearestResult = { idx: 0, s: 0, lat: 0, d: 0 };
  private tmp: NearestResult = { idx: 0, s: 0, lat: 0, d: 0 };

  constructor(private readonly query: CourseQuery) {}

  reset(s: number): void {
    this.idx = clamp(Math.round(s / this.query.course.step), 0, this.query.course.count - 1);
  }

  update(x: number, z: number): NearestResult {
    const local = this.query.refine(x, z, this.idx, 100, this.result);
    if (local.d > 90) {
      const global = this.query.nearest(x, z, this.tmp);
      if (global.d < local.d - 40) Object.assign(this.result, global);
    }
    this.idx = this.result.idx;
    return this.result;
  }
}
