import { createNoise2D } from 'simplex-noise';
import { MAPS, type MapConfig, type MapId } from '../config/maps';
import { SURFACE_INDEX, SURFACES, type SurfaceId } from '../config/surfaces';
import { TERRAIN } from '../config/terrain';
import { clamp, smoothstep } from '../utils/math';
import { makeRng } from '../utils/rng';
import { BIOMES, hexToRgb, type BiomeDef } from './Biome';
import { generateCourse, type CourseData } from './CourseGenerator';
import { CourseQuery, emptyFields, type CourseFields } from './CourseQuery';
import { carveFeature, featureHeight, FeatureIndex, inWater, isCarveFeature, waterLevel, type KernelPoint } from './Features';

type Noise = (x: number, y: number) => number;

/** Lattice cache entry layout. */
const L_D = 0, L_S = 1, L_LAT = 2, L_E = 3, L_HW = 4, L_WALLS = 5, L_ROUGH = 6, L_BUMPS = 7, L_FOREST = 8, L_ROCKS = 9, L_FLAT = 10, L_IDX = 11;
const L_SIZE = 12;

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * The single source of truth for the ground: height, surface type, colour and vegetation
 * density at any global (x, z). Pure (no DOM / three.js scene), shared by the terrain worker
 * (meshes + colliders) and the main thread (spawns, camera clamping, props, pickups).
 */
export class TerrainSampler {
  readonly map: MapConfig;
  readonly course: CourseData;
  readonly query: CourseQuery;
  readonly features: FeatureIndex;
  readonly biome: BiomeDef;
  readonly startX: number;
  readonly startZ: number;
  private nRidge: Noise;
  private nDetail: Noise;
  private nFar: Noise;
  private nBump: Noise;
  private nPatch: Noise;
  private lattice = new Map<number, Float32Array>();
  private tmpFields = emptyFields();
  private kp: KernelPoint;
  private surfaceLinear: [number, number, number][];
  private lowland: [number, number, number];
  private forestTint: [number, number, number];
  private rockLinear: [number, number, number];
  private snowLinear: [number, number, number];
  private sectionWeights: { id: number; w: number }[][];

  constructor(mapId: MapId, course?: CourseData) {
    this.map = MAPS[mapId];
    this.course = course ?? generateCourse(this.map);
    this.query = new CourseQuery(this.course);
    this.features = new FeatureIndex(this.course.features);
    this.biome = BIOMES[this.map.biome];
    this.startX = this.course.x[0]!;
    this.startZ = this.course.z[0]!;
    const seed = this.map.seed;
    this.nRidge = createNoise2D(makeRng(`${seed}:ridge`));
    this.nDetail = createNoise2D(makeRng(`${seed}:detail`));
    this.nFar = createNoise2D(makeRng(`${seed}:far`));
    this.nBump = createNoise2D(makeRng(`${seed}:bump`));
    this.nPatch = createNoise2D(makeRng(`${seed}:patch`));
    this.kp = { x: 0, z: 0, cs: 0, cl: 0, noise: this.nDetail };
    const lin = (hex: string): [number, number, number] => hexToRgb(hex).map(srgbToLinear) as [number, number, number];
    this.surfaceLinear = SURFACES.map((s) => lin(this.biome.surfaceColors[s]));
    this.lowland = lin(this.biome.lowlandTint);
    this.forestTint = lin(this.biome.forestTint);
    this.rockLinear = lin(this.biome.rock);
    this.snowLinear = lin(this.biome.surfaceColors.powder);
    this.sectionWeights = this.map.sections.map((sec) => {
      const entries = Object.entries(sec.surfaces) as [SurfaceId, number][];
      const total = entries.reduce((a, [, w]) => a + w, 0) || 1;
      return entries.map(([id, w]) => ({ id: SURFACE_INDEX[id], w: w / total }));
    });
  }

  /** Free the field cache (main thread calls this occasionally). */
  trimCache(max = 120000): void {
    if (this.lattice.size > max) this.lattice.clear();
  }

  private latticePoint(i: number, j: number): Float32Array {
    const key = (i + 1048576) * 2097152 + (j + 1048576);
    let e = this.lattice.get(key);
    if (e) return e;
    const step = TERRAIN.latticeStep;
    const f = this.query.fields(i * step, j * step, this.tmpFields);
    e = new Float32Array(L_SIZE);
    e[L_D] = f.d;
    e[L_S] = f.s;
    e[L_LAT] = f.lat;
    e[L_E] = f.E;
    e[L_HW] = f.hw;
    e[L_WALLS] = f.walls;
    e[L_ROUGH] = f.rough;
    e[L_BUMPS] = f.bumps;
    e[L_FOREST] = f.forest;
    e[L_ROCKS] = f.rocks;
    e[L_FLAT] = f.flat;
    e[L_IDX] = f.idx;
    this.lattice.set(key, e);
    return e;
  }

  /** Course fields at a point, bilinearly interpolated from the cached lattice. */
  fieldsAt(x: number, z: number, out: CourseFields): CourseFields {
    const step = TERRAIN.latticeStep;
    const gx = x / step;
    const gz = z / step;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const a = this.latticePoint(i, j);
    const b = this.latticePoint(i + 1, j);
    const c = this.latticePoint(i, j + 1);
    const d = this.latticePoint(i + 1, j + 1);
    const w0 = (1 - fx) * (1 - fz);
    const w1 = fx * (1 - fz);
    const w2 = (1 - fx) * fz;
    const w3 = fx * fz;
    const lerp4 = (k: number) => a[k]! * w0 + b[k]! * w1 + c[k]! * w2 + d[k]! * w3;
    out.d = lerp4(L_D);
    out.s = lerp4(L_S);
    out.lat = lerp4(L_LAT);
    out.E = lerp4(L_E);
    out.hw = lerp4(L_HW);
    out.walls = lerp4(L_WALLS);
    out.rough = lerp4(L_ROUGH);
    out.bumps = lerp4(L_BUMPS);
    out.forest = lerp4(L_FOREST);
    out.rocks = lerp4(L_ROCKS);
    out.flat = lerp4(L_FLAT);
    const nearest = fx < 0.5 ? (fz < 0.5 ? a : c) : fz < 0.5 ? b : d;
    out.idx = nearest[L_IDX]!;
    return out;
  }

  private ridged(x: number, z: number): number {
    const r = 1 - Math.abs(this.nRidge(x, z));
    return r * r;
  }

  heightAt(x: number, z: number): number {
    return this.heightWith(x, z, this.fieldsAt(x, z, this.tmpFields));
  }

  /** Height given precomputed fields (avoids a second lattice lookup). */
  heightWith(x: number, z: number, F: CourseFields): number {
    const T = TERRAIN;
    const dOut = Math.max(0, F.d - F.hw);
    const flatK = 1 - F.flat;
    let h = F.E;
    const dc = Math.min(F.d, F.hw);
    h += (T.halfPipe * dc * dc * flatK) / Math.max(F.hw, 1);
    if (F.walls >= 0) {
      const q = dOut / T.wallLength;
      h += F.walls * (T.wallLinear * dOut + T.wallHeight * (1 - Math.exp(-q * q)));
    } else {
      const q = dOut / T.ridgeLength;
      h += F.walls * (T.ridgeLinear * dOut + T.ridgeHeight * (1 - Math.exp(-q * q)));
    }
    const rr = F.rough * smoothstep(0, 140, dOut);
    if (rr > 0) {
      h += rr * (this.ridged(x / T.roughRidgedScale, z / T.roughRidgedScale) * T.roughRidgedAmp + this.nDetail(x / T.roughDetailScale, z / T.roughDetailScale) * T.roughDetailAmp);
    }
    const far = smoothstep(T.farStart, T.farFull, dOut);
    if (far > 0) {
      const fs = T.farScale;
      const fbm = this.nFar(x / fs, z / fs) + 0.5 * this.nFar((x / fs) * 2.1 + 17, (z / fs) * 2.1) + 0.25 * this.nFar((x / fs) * 4.3 + 41, (z / fs) * 4.3);
      h += far * (fbm * T.farAmp * 0.6 + this.ridged(x / T.farRidgedScale + 9, z / T.farRidgedScale) * T.farRidgedAmp);
    }
    if (F.bumps > 0 && flatK > 0) {
      const inC = 1 - smoothstep(F.hw - 6, F.hw + 10, F.d);
      const n = this.nBump(x / T.bumpScale, z / T.bumpScale) * T.bumpAmp + this.nBump(x / T.bumpDetailScale + 31, z / T.bumpDetailScale) * T.bumpDetailAmp;
      h += F.bumps * flatK * n * (0.35 + 0.65 * inC);
    }
    // Behind the start the summit falls away.
    const fwd = (x - this.startX) * this.course.fallX + (z - this.startZ) * this.course.fallZ;
    if (fwd < 0) h -= smoothstep(0, 400, -fwd) * -fwd * T.summitFalloff;

    const feats = this.features.at(x, z);
    if (feats.length) {
      const kp = this.kp;
      kp.x = x;
      kp.z = z;
      kp.cs = F.s;
      kp.cl = F.lat;
      for (let k = 0; k < feats.length; k++) {
        const f = feats[k]!;
        if (!isCarveFeature(f)) h += featureHeight(f, kp);
      }
      for (let k = 0; k < feats.length; k++) {
        const f = feats[k]!;
        if (!isCarveFeature(f)) continue;
        const c = carveFeature(f, x, z);
        if (c) h += (Math.min(h, c.bed) - h) * c.weight;
      }
    }
    return h;
  }

  /** Water surface level at a point, or null. */
  waterAt(x: number, z: number): number | null {
    for (const f of this.features.at(x, z)) {
      if (isCarveFeature(f) && inWater(f, x, z)) return waterLevel(f);
    }
    return null;
  }

  /** Surface type index at a point. `slope` is rise/run (|grad h|). */
  surfaceWith(x: number, z: number, F: CourseFields, h: number, slope: number): number {
    const water = this.waterAt(x, z);
    if (water !== null && h < water + 0.05) return SURFACE_INDEX.water;
    if (slope > TERRAIN.rockSlope) return SURFACE_INDEX.rock;
    const secIdx = this.course.section[clamp(Math.round(F.idx), 0, this.course.count - 1)]!;
    const sec = this.map.sections[secIdx]!;
    const edge = F.hw + this.nPatch(x / 35, z / 35) * 6;
    if (F.d < edge) {
      const r = clamp((this.nPatch(x / 55 + 100, z / 55) * 0.5 + 0.5) * 0.85 + (this.nPatch(x / 9, z / 9) * 0.5 + 0.5) * 0.15, 0, 0.9999);
      let acc = 0;
      for (const { id, w } of this.sectionWeights[secIdx]!) {
        acc += w;
        if (r < acc) return id;
      }
      return this.sectionWeights[secIdx]![0]!.id;
    }
    // Occasional rocky outcrops off the line, only where it is already fairly steep.
    if (F.rough > 0.55 && slope > 0.45 && this.nPatch(x / 70 + 300, z / 70) > 0.5) return SURFACE_INDEX.rock;
    return SURFACE_INDEX[sec.offSurface];
  }

  /** Main-thread convenience: surface at a point (computes slope by finite differences). */
  surfaceAt(x: number, z: number): number {
    const F = this.fieldsAt(x, z, this.tmpFields);
    const h = this.heightWith(x, z, F);
    const hx = this.heightAt(x + 1, z) - h;
    const hz = this.heightAt(x, z + 1) - h;
    const F2 = this.fieldsAt(x, z, this.tmpFields);
    return this.surfaceWith(x, z, F2, h, Math.hypot(hx, hz));
  }

  /** Linear-space vertex colour. Writes 3 floats into `out` at `o`. */
  colorWith(x: number, z: number, F: CourseFields, h: number, slope: number, surface: number, out: Float32Array | number[], o: number): void {
    const base = this.surfaceLinear[surface]!;
    let r = base[0];
    let g = base[1];
    let b = base[2];
    const v = 1 + this.nPatch(x / 13 + 7, z / 13) * 0.035 + this.nDetail(x / 3.1, z / 3.1) * 0.02;
    r *= v;
    g *= v;
    b *= v;
    const dOut = Math.max(0, F.d - F.hw);
    // Dense forest floor reads darker from a distance.
    const forestShade = F.forest * smoothstep(10, 60, dOut) * 0.22 * (surface === SURFACE_INDEX.rock ? 0 : 1);
    if (forestShade > 0) {
      r += (this.forestTint[0] - r) * forestShade;
      g += (this.forestTint[1] - g) * forestShade;
      b += (this.forestTint[2] - b) * forestShade;
    }
    // Thinning snow / lowland colour at low altitude (off the line).
    const low = smoothstep(this.biome.lowlandBelow + 250, this.biome.lowlandBelow - 250, h) * smoothstep(0, 20, dOut) * 0.75;
    if (low > 0 && surface !== SURFACE_INDEX.rock && surface !== SURFACE_INDEX.water) {
      r += (this.lowland[0] - r) * low;
      g += (this.lowland[1] - g) * low;
      b += (this.lowland[2] - b) * low;
    }
    // Snow caps on high alpine peaks.
    const cap = smoothstep(this.biome.snowlineAbove - 150, this.biome.snowlineAbove + 150, h + this.nPatch(x / 90, z / 90) * 80) * (1 - smoothstep(0.9, 1.4, slope));
    if (cap > 0) {
      r += (this.snowLinear[0] - r) * cap;
      g += (this.snowLinear[1] - g) * cap;
      b += (this.snowLinear[2] - b) * cap;
    }
    // Steep faces trend toward rock even below the rock threshold.
    const steep = smoothstep(0.55, TERRAIN.rockSlope, slope) * 0.6;
    if (steep > 0 && surface !== SURFACE_INDEX.rock) {
      r += (this.rockLinear[0] - r) * steep;
      g += (this.rockLinear[1] - g) * steep;
      b += (this.rockLinear[2] - b) * steep;
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }

  /** Tree density 0..1 at a point (before the graphics density multiplier). */
  treeDensity(x: number, z: number, F: CourseFields, h: number, slope: number): number {
    if (slope > 0.85) return 0;
    const reach = F.hw * (1 - 0.35 * F.forest);
    const off = smoothstep(reach - 4, reach + 10, F.d);
    const patch = smoothstep(-0.35, 0.45, this.nPatch(x / 140 + 50, z / 140 - 20));
    const line = 1 - smoothstep(this.biome.treeline - 200, this.biome.treeline + 200, h);
    return clamp(F.forest * off * (0.35 + 0.65 * patch) * line + 0.015 * off * line, 0, 1);
  }

  rockDensity(F: CourseFields, slope: number): number {
    const off = 0.25 + 0.75 * smoothstep(F.hw - 5, F.hw + 25, F.d);
    return clamp(F.rocks * off * (0.6 + slope * 0.6) * (1 - F.flat * 0.95), 0, 1);
  }
}
