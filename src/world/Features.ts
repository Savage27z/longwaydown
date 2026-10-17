import type { FeatureType, MapConfig } from '../config/maps';
import { clamp, smoothstep } from '../utils/math';
import type { Rng } from '../utils/rng';
import type { CourseData } from './CourseGenerator';

/** A placed course feature: terrain kernel and/or a prop, in a local frame at (x, z). */
export interface CourseFeature {
  id: number;
  type: FeatureType;
  s: number;
  section: number;
  /** Global center (on the line + lateral offset). */
  x: number;
  y: number;
  z: number;
  /** Along-track unit vector. */
  tx: number;
  tz: number;
  lateral: number;
  /** Across-track size (m). */
  width: number;
  /** Along-track size (m). */
  length: number;
  height: number;
  /** Secondary size (gap depth, roller wavelength, river depth...). */
  depth: number;
  /** +1 right / -1 left (cliff side, overlook side). */
  side: number;
  /** River crossing skew (radians). */
  angle: number;
  /** Corridor half-width at placement. */
  hw: number;
  /** Bounding radius for spatial culling. */
  radius: number;
}

interface Dims {
  length: number;
  width: number;
  height: number;
  depth: number;
  /** Along-track space reserved so features don't overlap. 0 = may overlap. */
  occupy: number;
  /** Max |curvature| allowed at placement. */
  maxCurv: number;
  lateral: number;
}

function dims(type: FeatureType, size: number, hw: number, rng: Rng): Dims {
  const lat = (k: number) => (rng() - 0.5) * 2 * hw * k;
  switch (type) {
    case 'jump':
      return { length: 16 * size, width: 12, height: 3 * size, depth: 0, occupy: 70, maxCurv: 1 / 140, lateral: lat(0.3) };
    case 'kicker':
      return { length: 8, width: 6, height: 1.5, depth: 0, occupy: 30, maxCurv: 1 / 100, lateral: lat(0.45) };
    case 'roller':
      return { length: 140, width: hw * 2, height: 1.4, depth: 28, occupy: 160, maxCurv: 1 / 250, lateral: 0 };
    case 'gap':
      return { length: 16, width: 14, height: 2.6, depth: 4.5, occupy: 90, maxCurv: 1 / 160, lateral: lat(0.2) };
    case 'rockGarden':
      return { length: 130, width: hw * 1.6, height: 0.9, depth: 0, occupy: 150, maxCurv: 1 / 120, lateral: 0 };
    case 'cliffDrop':
      return { length: 70, width: hw, height: 9 * size, depth: 0, occupy: 130, maxCurv: 1 / 220, lateral: 0 };
    case 'arch':
      return { length: 10, width: hw * 2 + 16, height: 30, depth: 0, occupy: 30, maxCurv: 1 / 200, lateral: 0 };
    case 'tunnel':
      return { length: 90, width: 15, height: 16, depth: 0, occupy: 150, maxCurv: 1 / 450, lateral: 0 };
    case 'overlook':
      return { length: 420, width: 90, height: 160, depth: 0, occupy: 0, maxCurv: 1 / 300, lateral: 0 };
    case 'ramp':
      return { length: 7, width: 5, height: 2.2, depth: 0, occupy: 30, maxCurv: 1 / 100, lateral: lat(0.4) };
    case 'logs':
      return { length: 12, width: 1, height: 0.45, depth: 0, occupy: 25, maxCurv: 1 / 90, lateral: lat(0.45) };
    case 'river':
      return { length: 900, width: 22, height: 0, depth: 6, occupy: 90, maxCurv: 1 / 250, lateral: 0 };
    case 'ford':
      return { length: 500, width: 18, height: 0, depth: 1.1, occupy: 60, maxCurv: 1 / 200, lateral: 0 };
  }
}

/** Distribute each section's feature specs along the course, avoiding overlaps and tight turns. */
export function placeFeatures(map: MapConfig, course: CourseData, rng: Rng): CourseFeature[] {
  const out: CourseFeature[] = [];
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => taken.every(([x, y]) => b < x || a > y);
  const startGuard = 140;
  const endGuard = 280;

  map.sections.forEach((sec, si) => {
    const s0 = course.sectionStart[si]!;
    const s1 = course.sectionStart[si + 1] ?? course.length;
    for (const spec of sec.features) {
      const spots: number[] = [];
      if (spec.every) {
        for (let s = s0 + spec.every * (0.4 + rng() * 0.4); s < s1 - 40; s += spec.every * (0.75 + rng() * 0.5)) spots.push(s);
      } else {
        const c = spec.count ?? 1;
        for (let k = 0; k < c; k++) spots.push(s0 + ((s1 - s0) * (k + 0.5 + (rng() - 0.5) * 0.4)) / c);
      }
      for (const want of spots) {
        for (let tries = 0; tries < 10; tries++) {
          const s = want + tries * 18;
          if (s < startGuard || s > course.length - endGuard || s > s1) break;
          const i = clamp(Math.round(s / course.step), 0, course.count - 1);
          const hw = course.hw[i]!;
          const d = dims(spec.type, spec.size ?? 1, hw, rng);
          if (Math.abs(course.curvature[i]!) > d.maxCurv) continue;
          const half = d.occupy / 2;
          if (d.occupy > 0 && !free(s - half, s + half)) continue;
          if (d.occupy > 0) taken.push([s - half, s + half]);
          const tx = course.tx[i]!;
          const tz = course.tz[i]!;
          // Right vector = (-tz, tx).
          const fx = course.x[i]! - tz * d.lateral;
          const fz = course.z[i]! + tx * d.lateral;
          out.push({
            id: out.length,
            type: spec.type,
            s,
            section: si,
            x: fx,
            y: course.y[i]!,
            z: fz,
            tx,
            tz,
            lateral: d.lateral,
            width: d.width,
            length: d.length,
            height: d.height,
            depth: d.depth,
            side: rng() < 0.5 ? -1 : 1,
            angle: (rng() - 0.5) * 0.7,
            hw,
            radius: Math.hypot(d.length, d.width) / 2 + 60 + (spec.type === 'overlook' ? hw + 120 : 0),
          });
          break;
        }
      }
    }
  });
  out.sort((a, b) => a.s - b.s);
  out.forEach((f, i) => (f.id = i));
  return out;
}

/** Inputs a feature kernel may need at a ground point. */
export interface KernelPoint {
  x: number;
  z: number;
  /** Course distance / signed lateral offset of the nearest line point. */
  cs: number;
  cl: number;
  noise: (x: number, y: number) => number;
}

function windowed(u: number, len: number, ramp: number): number {
  return smoothstep(-len / 2, -len / 2 + ramp, u) * (1 - smoothstep(len / 2 - ramp, len / 2, u));
}

/** Additive terrain height contribution of one feature at a point. */
export function featureHeight(f: CourseFeature, p: KernelPoint): number {
  const dx = p.x - f.x;
  const dz = p.z - f.z;
  const u = dx * f.tx + dz * f.tz;
  const v = -dx * f.tz + dz * f.tx;
  switch (f.type) {
    case 'jump':
    case 'kicker':
    case 'gap': {
      const L = f.length;
      if (u < -L - 2 || u > (f.type === 'gap' ? f.depth * 4 + 4 : 4)) return 0;
      const m = 1 - smoothstep(f.width / 2 - 1.5, f.width / 2 + 3, Math.abs(v));
      if (m <= 0) return 0;
      let h = u <= 0 ? f.height * Math.pow(clamp((u + L) / L, 0, 1), 2.2) : f.height * (1 - smoothstep(0, 2.2, u));
      if (f.type === 'gap' && u > 0) {
        const G = f.depth * 3.2;
        if (u < G) h -= f.depth * Math.sin((Math.PI * u) / G);
      }
      return h * m;
    }
    case 'roller': {
      const cu = p.cs - f.s;
      if (Math.abs(cu) > f.length / 2) return 0;
      const m = 1 - smoothstep(f.hw - 4, f.hw + 8, Math.abs(p.cl));
      return f.height * Math.sin((Math.PI * 2 * cu) / f.depth) * windowed(cu, f.length, 25) * m;
    }
    case 'rockGarden': {
      const cu = p.cs - f.s;
      if (Math.abs(cu) > f.length / 2) return 0;
      const m = 1 - smoothstep(f.width / 2 - 6, f.width / 2 + 4, Math.abs(p.cl));
      if (m <= 0) return 0;
      const n = p.noise(p.x / 3.2, p.z / 3.2) * 0.5 + 0.5;
      return f.height * n * n * 2 * windowed(cu, f.length, 20) * m;
    }
    case 'cliffDrop': {
      if (u < -f.length - 2 || u > 4) return 0;
      const sv = v * f.side;
      const sm = smoothstep(-3, 3, sv) * (1 - smoothstep(f.width - 4, f.width + 12, sv));
      if (sm <= 0) return 0;
      const plateau = smoothstep(-f.length, -f.length + 30, u) * (1 - smoothstep(-1.2, 1.2, u));
      return f.height * plateau * sm;
    }
    case 'tunnel': {
      const L = f.length;
      if (Math.abs(u) > L / 2 + 16) return 0;
      const w = smoothstep(-L / 2 - 15, -L / 2, u) * (1 - smoothstep(L / 2, L / 2 + 15, u));
      const av = Math.abs(v);
      const o = smoothstep(f.width / 2, f.width / 2 + 8, av) * (1 - smoothstep(f.hw + 20, f.hw + 70, av));
      return f.height * w * o;
    }
    case 'overlook': {
      const cu = p.cs - f.s;
      if (Math.abs(cu) > f.length / 2) return 0;
      const d = p.cl * f.side - (f.hw + 5);
      if (d <= 0) return 0;
      return -f.height * smoothstep(0, f.width, d) * windowed(cu, f.length, 90);
    }
    default:
      return 0;
  }
}

/** River/ford local frame: along-river `a`, across-river `b`. */
function riverFrame(f: CourseFeature, x: number, z: number): { a: number; b: number } {
  const dx = x - f.x;
  const dz = z - f.z;
  const c = Math.cos(f.angle);
  const s = Math.sin(f.angle);
  // River direction = right vector rotated toward the tangent by `angle`.
  const rx = -f.tz * c + f.tx * s;
  const rz = f.tx * c + f.tz * s;
  return { a: dx * rx + dz * rz, b: dx * -rz + dz * rx };
}

export function isCarveFeature(f: CourseFeature): boolean {
  return f.type === 'river' || f.type === 'ford';
}

/** Channel bed elevation and blend weight for carve features (river/ford). */
export function carveFeature(f: CourseFeature, x: number, z: number): { bed: number; weight: number } | null {
  const { a, b } = riverFrame(f, x, z);
  const halfW = f.width / 2;
  if (Math.abs(b) > halfW + 10 || Math.abs(a) > f.length / 2) return null;
  const weight = (1 - smoothstep(halfW - 2, halfW + 10, Math.abs(b))) * (1 - smoothstep(f.length / 2 - 120, f.length / 2, Math.abs(a)));
  if (weight <= 0) return null;
  const t = clamp(Math.abs(b) / (halfW + 2), 0, 1);
  const bed = f.y - f.depth * (1 - t * t);
  return { bed, weight };
}

/** Water surface elevation for carve features (constant per feature). */
export function waterLevel(f: CourseFeature): number {
  return f.type === 'river' ? f.y - f.depth + 1.8 : f.y - f.depth + 0.55;
}

/** Is the point inside this feature's water footprint? */
export function inWater(f: CourseFeature, x: number, z: number): boolean {
  const { a, b } = riverFrame(f, x, z);
  return Math.abs(b) < f.width / 2 + 2 && Math.abs(a) < f.length / 2 - 100;
}

/** Spatial hash of features for fast per-point lookup. */
export class FeatureIndex {
  private cells = new Map<number, CourseFeature[]>();
  private readonly cell = 256;

  constructor(readonly features: CourseFeature[]) {
    for (const f of features) {
      const r = f.radius + (isCarveFeature(f) ? f.length / 2 : 0);
      const x0 = Math.floor((f.x - r) / this.cell);
      const x1 = Math.floor((f.x + r) / this.cell);
      const z0 = Math.floor((f.z - r) / this.cell);
      const z1 = Math.floor((f.z + r) / this.cell);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = key(cx, cz);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(f);
        }
      }
    }
  }

  at(x: number, z: number): readonly CourseFeature[] {
    return this.cells.get(key(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? EMPTY;
  }

  /** All features overlapping an axis-aligned box. */
  inBox(minX: number, minZ: number, maxX: number, maxZ: number): CourseFeature[] {
    const set = new Set<CourseFeature>();
    for (let cx = Math.floor(minX / this.cell); cx <= Math.floor(maxX / this.cell); cx++) {
      for (let cz = Math.floor(minZ / this.cell); cz <= Math.floor(maxZ / this.cell); cz++) {
        for (const f of this.cells.get(key(cx, cz)) ?? EMPTY) set.add(f);
      }
    }
    return [...set];
  }
}

const EMPTY: CourseFeature[] = [];

function key(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}
