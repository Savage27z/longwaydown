import { CatmullRomCurve3, Vector3 } from 'three';
import { createNoise2D } from 'simplex-noise';
import type { MapConfig } from '../config/maps';
import { TERRAIN } from '../config/terrain';
import { clamp, DEG, wrapAngle } from '../utils/math';
import { makeRng } from '../utils/rng';
import { placeFeatures, type CourseFeature } from './Features';

/**
 * The generated course: a Catmull-Rom spline resampled every TERRAIN.sampleStep metres, with
 * per-sample corridor parameters. Pure + deterministic (seeded), so the main thread and the
 * terrain workers each build an identical copy from the map config.
 */
export interface CourseData {
  mapId: string;
  step: number;
  count: number;
  length: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** Unit tangent in XZ. */
  tx: Float32Array;
  tz: Float32Array;
  /** Corridor half-width (m). */
  hw: Float32Array;
  walls: Float32Array;
  rough: Float32Array;
  bumps: Float32Array;
  forest: Float32Array;
  rocks: Float32Array;
  flat: Float32Array;
  /** Signed curvature (1/m, + = turning right). */
  curvature: Float32Array;
  section: Uint8Array;
  sectionStart: number[];
  features: CourseFeature[];
  checkpoints: number[];
  markers: number[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  summitElevation: number;
  finishElevation: number;
  fallX: number;
  fallZ: number;
}

interface RawPath {
  x: number[];
  z: number[];
  sec: number[];
  s: number[];
}

function buildRawPath(map: MapConfig, noise: (x: number, y: number) => number): RawPath {
  const ds = TERRAIN.pathStep;
  const fall = map.fallDirection;
  const maxDev = map.maxDeviationDeg * DEG;
  const out: RawPath = { x: [], z: [], sec: [], s: [] };
  let x = 0;
  let z = 0;
  let theta = fall;
  let s = 0;
  map.sections.forEach((sec, si) => {
    const steps = Math.max(1, Math.round(sec.length / ds));
    for (let k = 0; k < steps; k++) {
      const ls = k * ds;
      let target: number;
      let maxTurn: number;
      if (sec.switchbacks) {
        const leg = Math.floor(ls / sec.switchbacks.legLength);
        const sign = leg % 2 === 0 ? 1 : -1;
        target = fall + sign * sec.switchbacks.angleDeg * DEG;
        maxTurn = ds / TERRAIN.hairpinRadius;
      } else {
        const slow = noise(s / 900, si * 13.7 + 0.5);
        const fast = noise(s / 230, si * 7.1 + 100);
        target = fall + maxDev * sec.curviness * (0.75 * slow + 0.45 * fast);
        maxTurn = ds / TERRAIN.minTurnRadius;
      }
      const dev = clamp(wrapAngle(target - fall), -maxDev, maxDev);
      theta += clamp(wrapAngle(fall + dev - theta), -maxTurn, maxTurn);
      theta = fall + clamp(wrapAngle(theta - fall), -maxDev, maxDev);
      out.x.push(x);
      out.z.push(z);
      out.sec.push(si);
      out.s.push(s);
      x += Math.sin(theta) * ds;
      z += Math.cos(theta) * ds;
      s += ds;
    }
  });
  out.x.push(x);
  out.z.push(z);
  out.sec.push(map.sections.length - 1);
  out.s.push(s);
  return out;
}

/** Centered moving average using prefix sums (window = +/- half points). */
function smooth(values: Float64Array, half: number): Float64Array<ArrayBuffer> {
  const n = values.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + values[i]!;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n - 1, i + half);
    out[i] = (prefix[b + 1]! - prefix[a]!) / (b - a + 1);
  }
  return out;
}

export function generateCourse(map: MapConfig): CourseData {
  const rng = makeRng(map.seed);
  const noise = createNoise2D(rng);
  const raw = buildRawPath(map, noise);
  const n = raw.x.length;
  const ds = TERRAIN.pathStep;

  // --- Per raw point section parameters (then smoothed so sections blend) ---
  const fields = {
    grade: new Float64Array(n),
    hw: new Float64Array(n),
    walls: new Float64Array(n),
    rough: new Float64Array(n),
    bumps: new Float64Array(n),
    forest: new Float64Array(n),
    rocks: new Float64Array(n),
    flat: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const si = raw.sec[i]!;
    const sec = map.sections[si]!;
    const s = raw.s[i]!;
    fields.grade[i] = sec.grade + sec.gradeVar * noise(s / 260, 777 + si * 3.1);
    const wn = 0.5 + 0.5 * noise(s / 380, 50 + si * 3.3);
    fields.hw[i] = (sec.width[0] + (sec.width[1] - sec.width[0]) * wn) / 2;
    fields.walls[i] = sec.walls;
    fields.rough[i] = sec.roughness;
    fields.bumps[i] = sec.bumps;
    fields.forest[i] = sec.forest;
    fields.rocks[i] = sec.rocks;
    fields.flat[i] = sec.flat ? 1 : 0;
  }
  const half = Math.round(TERRAIN.sectionBlend / ds);
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    fields[key] = smooth(fields[key], key === 'flat' ? Math.round(half * 0.6) : half);
  }

  // --- Elevation profile, normalized to the configured total drop ---
  const elev = new Float64Array(n);
  elev[0] = 0;
  for (let i = 1; i < n; i++) elev[i] = elev[i - 1]! - fields.grade[i - 1]! * ds;
  const rawDrop = -elev[n - 1]!;
  const scale = map.totalDrop / Math.max(1, rawDrop);
  for (let i = 0; i < n; i++) elev[i] = map.summitElevation + elev[i]! * scale;

  // --- Catmull-Rom spline through control points ---
  const every = Math.max(1, Math.round(TERRAIN.controlSpacing / ds));
  const ctrlIdx: number[] = [];
  for (let i = 0; i < n; i += every) ctrlIdx.push(i);
  if (ctrlIdx[ctrlIdx.length - 1] !== n - 1) ctrlIdx.push(n - 1);
  const ctrl = ctrlIdx.map((i) => new Vector3(raw.x[i], elev[i], raw.z[i]));
  const curve = new CatmullRomCurve3(ctrl, false, 'centripetal');
  curve.arcLengthDivisions = ctrl.length * 12;
  const length = curve.getLength();
  const step = TERRAIN.sampleStep;
  const count = Math.floor(length / step) + 1;

  const course: CourseData = {
    mapId: map.id,
    step,
    count,
    length,
    x: new Float64Array(count),
    y: new Float64Array(count),
    z: new Float64Array(count),
    tx: new Float32Array(count),
    tz: new Float32Array(count),
    hw: new Float32Array(count),
    walls: new Float32Array(count),
    rough: new Float32Array(count),
    bumps: new Float32Array(count),
    forest: new Float32Array(count),
    rocks: new Float32Array(count),
    flat: new Float32Array(count),
    curvature: new Float32Array(count),
    section: new Uint8Array(count),
    sectionStart: [],
    features: [],
    checkpoints: [],
    markers: [],
    bounds: { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
    summitElevation: map.summitElevation,
    finishElevation: map.summitElevation - map.totalDrop,
    fallX: Math.sin(map.fallDirection),
    fallZ: Math.cos(map.fallDirection),
  };

  const p = new Vector3();
  const t = new Vector3();
  let lastSec = -1;
  for (let i = 0; i < count; i++) {
    const u = Math.min(1, (i * step) / length);
    const ct = curve.getUtoTmapping(u, 0);
    curve.getPoint(ct, p);
    curve.getTangent(ct, t);
    course.x[i] = p.x;
    course.y[i] = p.y;
    course.z[i] = p.z;
    const tl = Math.hypot(t.x, t.z) || 1;
    course.tx[i] = t.x / tl;
    course.tz[i] = t.z / tl;
    // Spline parameter maps linearly onto control points, hence onto raw path indices.
    const ri = clamp(Math.round(ct * (ctrl.length - 1) * every), 0, n - 1);
    course.hw[i] = fields.hw[ri]!;
    course.walls[i] = fields.walls[ri]!;
    course.rough[i] = fields.rough[ri]!;
    course.bumps[i] = fields.bumps[ri]!;
    course.forest[i] = fields.forest[ri]!;
    course.rocks[i] = fields.rocks[ri]!;
    course.flat[i] = fields.flat[ri]!;
    const si = raw.sec[ri]!;
    course.section[i] = si;
    if (si !== lastSec) {
      while (course.sectionStart.length <= si) course.sectionStart.push(i * step);
      lastSec = si;
    }
    const b = course.bounds;
    b.minX = Math.min(b.minX, p.x);
    b.maxX = Math.max(b.maxX, p.x);
    b.minZ = Math.min(b.minZ, p.z);
    b.maxZ = Math.max(b.maxZ, p.z);
  }
  while (course.sectionStart.length < map.sections.length) course.sectionStart.push(length);

  // Signed curvature from tangent heading change over +/- 4 samples.
  const k = 4;
  for (let i = 0; i < count; i++) {
    const a = Math.max(0, i - k);
    const b = Math.min(count - 1, i + k);
    const h0 = Math.atan2(course.tx[a]!, course.tz[a]!);
    const h1 = Math.atan2(course.tx[b]!, course.tz[b]!);
    // Heading decreasing = turning right (see vehicle heading convention).
    course.curvature[i] = -wrapAngle(h1 - h0) / Math.max(step, (b - a) * step);
  }

  course.features = placeFeatures(map, course, makeRng(`${map.seed}:features`));

  // First checkpoint at the bottom of the wingsuit face, then evenly spaced.
  const firstCheckpoint = course.sectionStart[map.launch.sections] ?? map.checkpointSpacing;
  for (let s = firstCheckpoint; s < length - 300; s += map.checkpointSpacing) course.checkpoints.push(s);
  for (let s = map.markerSpacing; s < length - 100; s += map.markerSpacing) course.markers.push(s);
  return course;
}

/** Sample index nearest to a distance along the course. */
export function indexAt(course: CourseData, s: number): number {
  return clamp(Math.round(s / course.step), 0, course.count - 1);
}
