import { TERRAIN } from '../config/terrain';
import { WORLD } from '../config/world';
import { hash3 } from '../utils/rng';
import { emptyFields, type CourseFields } from './CourseQuery';
import type { TerrainSampler } from './TerrainSampler';

/** Prop kinds scattered per tile (the main thread maps these to instanced meshes). */
export const PROP_KINDS = ['tree', 'rock', 'pole', 'bush', 'pebble'] as const;
export type PropKind = (typeof PROP_KINDS)[number];
/** Floats per prop instance: x, y, z (tile-local), rotY, scale, variant. */
export const PROP_STRIDE = 6;

export interface TileRequest {
  id: number;
  ix: number;
  iz: number;
  lod: number;
  treeDensity: number;
}

export interface TileResult {
  id: number;
  ix: number;
  iz: number;
  lod: number;
  segs: number;
  /** Tile-local x/z, global y. Grid (segs+1)^2 then skirt ring. */
  positions: Float32Array;
  normals: Float32Array;
  colors: Uint8Array;
  index: Uint16Array | Uint32Array;
  /** Column-major (rows along Z) heights for the Rapier heightfield. */
  heights: Float32Array;
  /** Surface index per grid vertex, row-major (iz * n + ix). */
  surfaces: Uint8Array;
  minY: number;
  maxY: number;
  props: Float32Array[];
}

const F = emptyFields();

/** Build one terrain tile: mesh arrays, collider heights, surfaces and prop scatter. */
export function buildTile(sampler: TerrainSampler, req: TileRequest): TileResult {
  const S = WORLD.chunkSize;
  const segs = WORLD.lodSegments[req.lod] ?? 64;
  const n = segs + 1;
  const step = S / segs;
  const x0 = req.ix * S;
  const z0 = req.iz * S;

  // Heights with a 1-vertex border for seamless normals.
  const nb = n + 2;
  const hb = new Float64Array(nb * nb);
  for (let j = 0; j < nb; j++) {
    for (let i = 0; i < nb; i++) {
      hb[j * nb + i] = sampler.heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
    }
  }
  const H = (i: number, j: number) => hb[(j + 1) * nb + (i + 1)]!;

  const ringCount = 4 * segs;
  const vCount = n * n + ringCount;
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const colors = new Uint8Array(vCount * 3);
  const heights = new Float32Array(n * n);
  const surfaces = new Uint8Array(n * n);
  const col = [0, 0, 0];
  let minY = Infinity;
  let maxY = -Infinity;

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      const x = x0 + i * step;
      const z = z0 + j * step;
      const h = H(i, j);
      const gx = (H(i + 1, j) - H(i - 1, j)) / (2 * step);
      const gz = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
      const slope = Math.hypot(gx, gz);
      positions[v * 3] = i * step;
      positions[v * 3 + 1] = h;
      positions[v * 3 + 2] = j * step;
      const inv = 1 / Math.hypot(gx, 1, gz);
      normals[v * 3] = -gx * inv;
      normals[v * 3 + 1] = inv;
      normals[v * 3 + 2] = -gz * inv;
      heights[i * n + j] = h;
      sampler.fieldsAt(x, z, F);
      const surf = sampler.surfaceWith(x, z, F, h, slope);
      surfaces[v] = surf;
      sampler.colorWith(x, z, F, h, slope, surf, col, 0);
      colors[v * 3] = Math.min(255, col[0]! * 255);
      colors[v * 3 + 1] = Math.min(255, col[1]! * 255);
      colors[v * 3 + 2] = Math.min(255, col[2]! * 255);
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
    }
  }

  // Skirt ring: border vertices duplicated downward. Order: north (j=0), east (i=n-1), south, west.
  const border: number[] = [];
  for (let i = 0; i < n - 1; i++) border.push(i); // north, x increasing
  for (let j = 0; j < n - 1; j++) border.push(j * n + (n - 1)); // east, z increasing
  for (let i = n - 1; i > 0; i--) border.push((n - 1) * n + i); // south, x decreasing
  for (let j = n - 1; j > 0; j--) border.push(j * n); // west, z decreasing
  const skirtBase = n * n;
  border.forEach((src, k) => {
    const dst = skirtBase + k;
    positions[dst * 3] = positions[src * 3]!;
    positions[dst * 3 + 1] = positions[src * 3 + 1]! - WORLD.skirtDepth;
    positions[dst * 3 + 2] = positions[src * 3 + 2]!;
    for (let c = 0; c < 3; c++) {
      normals[dst * 3 + c] = normals[src * 3 + c]!;
      colors[dst * 3 + c] = colors[src * 3 + c]!;
    }
  });

  const triCount = segs * segs * 2 + ringCount * 2;
  const index = vCount > 65535 ? new Uint32Array(triCount * 3) : new Uint16Array(triCount * 3);
  let t = 0;
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * n + i;
      const b = a + 1;
      const d = a + n;
      const e = d + 1;
      index[t++] = a;
      index[t++] = d;
      index[t++] = b;
      index[t++] = b;
      index[t++] = d;
      index[t++] = e;
    }
  }
  // The border walks the perimeter clockwise when viewed from above, so (A, B, A') faces outward.
  for (let k = 0; k < ringCount; k++) {
    const a = border[k]!;
    const b = border[(k + 1) % ringCount]!;
    const sa = skirtBase + k;
    const sb = skirtBase + ((k + 1) % ringCount);
    index[t++] = a;
    index[t++] = b;
    index[t++] = sa;
    index[t++] = b;
    index[t++] = sb;
    index[t++] = sa;
  }

  const props = scatterProps(sampler, req, x0, z0);
  return { id: req.id, ix: req.ix, iz: req.iz, lod: req.lod, segs, positions, normals, colors, index, heights, surfaces, minY, maxY, props };
}

/** Deterministic per-global-cell scatter, independent of LOD so props never pop on LOD swaps. */
function scatterProps(sampler: TerrainSampler, req: TileRequest, x0: number, z0: number): Float32Array[] {
  const S = WORLD.chunkSize;
  const seed = 1337;
  const lists: number[][] = PROP_KINDS.map(() => []);
  const push = (kind: number, x: number, y: number, z: number, rot: number, scale: number, variant: number) => {
    lists[kind]!.push(x - x0, y, z - z0, rot, scale, variant);
  };
  const slopeAt = (x: number, z: number, h: number) => Math.hypot(sampler.heightAt(x + 1, z) - h, sampler.heightAt(x, z + 1) - h);

  // Trees + bushes on a 7 m jittered grid.
  const tc = 7;
  for (let cz = Math.floor(z0 / tc); cz < Math.floor((z0 + S) / tc); cz++) {
    for (let cx = Math.floor(x0 / tc); cx < Math.floor((x0 + S) / tc); cx++) {
      const r0 = hash3(cx, cz, 1, seed);
      if (r0 > 0.75) continue; // most cells are empty anyway; cheap early out
      const x = (cx + hash3(cx, cz, 2, seed)) * tc;
      const z = (cz + hash3(cx, cz, 3, seed)) * tc;
      if (x < x0 || x >= x0 + S || z < z0 || z >= z0 + S) continue;
      sampler.fieldsAt(x, z, F);
      const h = sampler.heightWith(x, z, F);
      if (sampler.waterAt(x, z) !== null) continue;
      const slope = slopeAt(x, z, h);
      const dens = sampler.treeDensity(x, z, F, h, slope) * req.treeDensity;
      if (r0 / 0.75 < dens) {
        const variant = hash3(cx, cz, 4, seed);
        push(0, x, h, z, hash3(cx, cz, 5, seed) * Math.PI * 2, 0.75 + hash3(cx, cz, 6, seed) * 0.7, variant);
      } else if (r0 / 0.75 < dens * 1.25 + 0.01) {
        push(3, x, h, z, hash3(cx, cz, 5, seed) * Math.PI * 2, 0.6 + hash3(cx, cz, 6, seed) * 0.6, hash3(cx, cz, 4, seed));
      }
    }
  }

  // Rocks on a 15 m grid.
  const rc = 15;
  for (let cz = Math.floor(z0 / rc); cz < Math.floor((z0 + S) / rc); cz++) {
    for (let cx = Math.floor(x0 / rc); cx < Math.floor((x0 + S) / rc); cx++) {
      const r0 = hash3(cx, cz, 11, seed);
      const x = (cx + hash3(cx, cz, 12, seed)) * rc;
      const z = (cz + hash3(cx, cz, 13, seed)) * rc;
      if (x < x0 || x >= x0 + S || z < z0 || z >= z0 + S) continue;
      sampler.fieldsAt(x, z, F);
      const h = sampler.heightWith(x, z, F);
      const slope = slopeAt(x, z, h);
      if (r0 < sampler.rockDensity(F, slope) * 0.6) {
        push(1, x, h - 0.4, z, hash3(cx, cz, 14, seed) * Math.PI * 2, 0.7 + Math.pow(hash3(cx, cz, 15, seed), 2) * 2.6, hash3(cx, cz, 16, seed));
      }
    }
  }

  // Rock gardens: dense pebbles/boulders on the line.
  for (const f of sampler.features.inBox(x0, z0, x0 + S, z0 + S)) {
    if (f.type !== 'rockGarden') continue;
    const pc = 6;
    for (let cz = Math.floor(z0 / pc); cz < Math.floor((z0 + S) / pc); cz++) {
      for (let cx = Math.floor(x0 / pc); cx < Math.floor((x0 + S) / pc); cx++) {
        const x = (cx + hash3(cx, cz, 21, seed)) * pc;
        const z = (cz + hash3(cx, cz, 22, seed)) * pc;
        if (x < x0 || x >= x0 + S || z < z0 || z >= z0 + S) continue;
        sampler.fieldsAt(x, z, F);
        if (Math.abs(F.s - f.s) > f.length / 2 - 10 || Math.abs(F.lat) > f.width / 2) continue;
        if (hash3(cx, cz, 23, seed) > 0.22) continue;
        const h = sampler.heightWith(x, z, F);
        push(4, x, h - 0.15, z, hash3(cx, cz, 24, seed) * Math.PI * 2, 0.5 + hash3(cx, cz, 25, seed) * 0.9, hash3(cx, cz, 26, seed));
      }
    }
  }

  // Trail marker poles along both edges of the groomed trail.
  const course = sampler.course;
  const every = Math.max(1, Math.round(TERRAIN.poleSpacing / course.step));
  const startI = Math.round(60 / course.step);
  for (let i = startI; i < course.count - 20; i += every) {
    const cxp = course.x[i]!;
    const czp = course.z[i]!;
    if (cxp < x0 - 80 || cxp > x0 + S + 80 || czp < z0 - 80 || czp > z0 + S + 80) continue;
    const hw = TERRAIN.trailHalfWidth + TERRAIN.trailShoulder + 0.8;
    for (const side of [-1, 1]) {
      const x = cxp - course.tz[i]! * hw * side;
      const z = czp + course.tx[i]! * hw * side;
      if (x < x0 || x >= x0 + S || z < z0 || z >= z0 + S) continue;
      if (sampler.waterAt(x, z) !== null) continue;
      push(2, x, sampler.heightAt(x, z), z, Math.atan2(course.tx[i]!, course.tz[i]!), 1, side < 0 ? 0 : 1);
    }
  }

  return lists.map((l) => new Float32Array(l));
}

/** Backdrop: the whole map at low resolution (one big low-poly mesh). */
export interface BackdropResult {
  originX: number;
  originZ: number;
  nx: number;
  nz: number;
  spacing: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Uint8Array;
}

export function buildBackdrop(sampler: TerrainSampler, spacing: number, margin: number): BackdropResult {
  const b = sampler.course.bounds;
  const originX = Math.floor((b.minX - margin) / spacing) * spacing;
  const originZ = Math.floor((b.minZ - margin) / spacing) * spacing;
  const nx = Math.ceil((b.maxX + margin - originX) / spacing) + 1;
  const nz = Math.ceil((b.maxZ + margin - originZ) / spacing) + 1;
  const hs = new Float32Array(nx * nz);
  const fields: CourseFields[] = new Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = originX + i * spacing;
      const z = originZ + j * spacing;
      const f = sampler.query.fields(x, z, emptyFields());
      fields[j * nx + i] = f;
      hs[j * nx + i] = sampler.heightWith(x, z, f);
    }
  }
  const positions = new Float32Array(nx * nz * 3);
  const normals = new Float32Array(nx * nz * 3);
  const colors = new Uint8Array(nx * nz * 3);
  const col = [0, 0, 0];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const v = j * nx + i;
      const h = hs[v]!;
      const hl = hs[j * nx + Math.max(0, i - 1)]!;
      const hr = hs[j * nx + Math.min(nx - 1, i + 1)]!;
      const hd = hs[Math.max(0, j - 1) * nx + i]!;
      const hu = hs[Math.min(nz - 1, j + 1) * nx + i]!;
      const gx = (hr - hl) / (2 * spacing);
      const gz = (hu - hd) / (2 * spacing);
      const slope = Math.hypot(gx, gz);
      positions[v * 3] = i * spacing;
      positions[v * 3 + 1] = h;
      positions[v * 3 + 2] = j * spacing;
      const inv = 1 / Math.hypot(gx, 1, gz);
      normals[v * 3] = -gx * inv;
      normals[v * 3 + 1] = inv;
      normals[v * 3 + 2] = -gz * inv;
      const x = originX + i * spacing;
      const z = originZ + j * spacing;
      const fv = fields[v]!;
      const surf = sampler.surfaceWith(x, z, fv, h, slope);
      sampler.colorWith(x, z, fv, h, slope, surf, col, 0);
      // Forested areas read as dark green from afar (individual trees aren't drawn there).
      const forest = sampler.treeDensity(x, z, fv, h, slope) * 0.85;
      const tint = [0.03, 0.07, 0.045];
      colors[v * 3] = Math.min(255, (col[0]! + (tint[0]! - col[0]!) * forest) * 255);
      colors[v * 3 + 1] = Math.min(255, (col[1]! + (tint[1]! - col[1]!) * forest) * 255);
      colors[v * 3 + 2] = Math.min(255, (col[2]! + (tint[2]! - col[2]!) * forest) * 255);
    }
  }
  return { originX, originZ, nx, nz, spacing, positions, normals, colors };
}
