import * as THREE from 'three';
import { MAPS, type MapId } from '../config/maps';
import { TERRAIN } from '../config/terrain';
import { WORLD } from '../config/world';
import { addStatic, disposeObject } from '../utils/dispose';
import type { TerrainSampler } from './TerrainSampler';

/** Rows every metre along the trail, segments of this many metres. */
const SEG_LEN = 48;
const COLS = 13;
/** Half width of the ribbon: the textured trail fades out over its outer ~10% each side. */
const HALF = TERRAIN.trailHalfWidth + 1.3;
/** Texture repeat along the trail (m): the 256x512 texture keeps square texels across 2*HALF. */
const TILE_LEN = HALF * 4;
const AHEAD = 650;
const BEHIND = 120;
/** Grid spacing of the terrain mesh per LOD. */
const GRIDS = WORLD.lodSegments.map((n) => WORLD.chunkSize / n);
const ICE = new THREE.Color('#bfe2f5');

/**
 * A textured strip laid exactly on the terrain along the groomed trail (corduroy on snow, packed
 * dirt with ruts and stones on alpine maps), so the line reads crisply at speed instead of as a
 * soft vertex-colour band. Heights and normals follow the drawn terrain tile's own triangles
 * (LOD0 or LOD1), and a segment is rebuilt when a tile under it changes LOD.
 */
export class TrailRibbon {
  private readonly material: THREE.MeshLambertMaterial;
  private readonly live = new Map<number, THREE.Mesh>();
  private readonly hCache = new Map<number, number>();
  private readonly sections: { trailSurface?: string }[];
  private checkTimer = 0;
  private readonly snow: boolean;

  constructor(
    private readonly sampler: TerrainSampler,
    private readonly parent: THREE.Object3D,
    /** LOD of the terrain tile drawn at a global point. */
    private readonly lodAt: (gx: number, gz: number) => number,
  ) {
    const snow = (this.snow = sampler.biome.id === 'snow');
    this.material = new THREE.MeshLambertMaterial({
      map: trailTexture(snow, sampler.biome.surfaceColors.trail),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.material.userData.shared = true;
    this.sections = MAPS[sampler.course.mapId as MapId].sections;
  }

  /** Keep segments around the rider's progress built (at most `budget` new ones per call). */
  update(progressS: number, budget = 2, dt = 0): void {
    const c = this.sampler.course;
    // Tiles upgrade from LOD1 to LOD0 as the rider approaches: re-lay segments that sat on them.
    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = 0.4;
      for (const [k, mesh] of this.live) {
        if (this.signature(mesh.userData.probes as number[]) === mesh.userData.sig) continue;
        mesh.removeFromParent();
        disposeObject(mesh);
        this.live.delete(k);
      }
    }
    const first = Math.max(0, Math.floor((progressS - BEHIND) / SEG_LEN));
    const last = Math.min(Math.floor((c.length - 1) / SEG_LEN), Math.floor((progressS + AHEAD) / SEG_LEN));
    for (const [k, mesh] of this.live) {
      if (k >= first && k <= last) continue;
      mesh.removeFromParent();
      disposeObject(mesh);
      this.live.delete(k);
    }
    // Nearest segments first (after a respawn the one under the rider matters most).
    const here = Math.floor(progressS / SEG_LEN);
    const order: number[] = [];
    for (let k = first; k <= last; k++) if (!this.live.has(k)) order.push(k);
    order.sort((a, b) => Math.abs(a - here) - Math.abs(b - here));
    for (const k of order) {
      if (budget <= 0) break;
      const mesh = this.build(k);
      if (mesh) {
        // The world root only refreshes matrices on origin shifts: compute this one now.
        addStatic(this.parent, mesh);
        this.live.set(k, mesh);
      }
      budget--;
    }
    if (this.hCache.size > 60000) this.hCache.clear();
  }

  dispose(): void {
    for (const mesh of this.live.values()) {
      mesh.removeFromParent();
      disposeObject(mesh);
    }
    this.live.clear();
    this.material.map?.dispose();
    this.material.dispose();
  }

  /** LODs of the tiles under a segment's probe points, as a comparable string. */
  private signature(probes: number[]): string {
    let sig = '';
    for (let p = 0; p < probes.length; p += 2) sig += this.lodAt(probes[p]!, probes[p + 1]!);
    return sig;
  }

  /** Terrain height at a grid vertex (global grid indices) of the given grid spacing, cached. */
  private grid = GRIDS[0]!;
  private gridH(i: number, j: number): number {
    const key = (i * 131071 + j) * 4 + (this.grid === GRIDS[0] ? 0 : 1);
    let h = this.hCache.get(key);
    if (h === undefined) {
      h = this.sampler.heightAt(i * this.grid, j * this.grid);
      this.hCache.set(key, h);
    }
    return h;
  }

  /** Height and shading normal of the terrain mesh at (x, z): same triangles, same normals. */
  private meshAt(x: number, z: number, lod: number, n: THREE.Vector3): number {
    const GRID = (this.grid = GRIDS[lod] ?? GRIDS[0]!);
    const gi = Math.floor(x / GRID);
    const gj = Math.floor(z / GRID);
    const fx = x / GRID - gi;
    const fz = z / GRID - gj;
    // Cells split (a, d, b) / (b, d, e) like TileBuilder's index buffer.
    let h: number;
    const ha = this.gridH(gi, gj);
    const hb = this.gridH(gi + 1, gj);
    const hd = this.gridH(gi, gj + 1);
    const he = this.gridH(gi + 1, gj + 1);
    if (fx + fz <= 1) {
      h = ha + (hb - ha) * fx + (hd - ha) * fz;
      n.copy(this.gridN(gi, gj)).multiplyScalar(1 - fx - fz).addScaledVector(this.gridN(gi + 1, gj), fx).addScaledVector(this.gridN(gi, gj + 1), fz);
    } else {
      h = he + (hd - he) * (1 - fx) + (hb - he) * (1 - fz);
      n.copy(this.gridN(gi + 1, gj + 1)).multiplyScalar(fx + fz - 1).addScaledVector(this.gridN(gi, gj + 1), 1 - fx).addScaledVector(this.gridN(gi + 1, gj), 1 - fz);
    }
    n.normalize();
    return h;
  }

  private readonly _n = new THREE.Vector3();
  private gridN(i: number, j: number): THREE.Vector3 {
    const gx = (this.gridH(i + 1, j) - this.gridH(i - 1, j)) / (2 * this.grid);
    const gz = (this.gridH(i, j + 1) - this.gridH(i, j - 1)) / (2 * this.grid);
    return this._n.set(-gx, 1, -gz).normalize().clone();
  }

  private build(k: number): THREE.Mesh | null {
    const c = this.sampler.course;
    const s0 = k * SEG_LEN;
    const rows = Math.min(SEG_LEN, Math.floor(c.length - 1 - s0)) + 1;
    if (rows < 2) return null;
    const i0 = Math.round(s0 / c.step);
    const ox = c.x[i0]!;
    const oz = c.z[i0]!;
    const oy = this.sampler.heightAt(ox, oz);
    const pos = new Float32Array(rows * COLS * 3);
    const nor = new Float32Array(rows * COLS * 3);
    const uv = new Float32Array(rows * COLS * 2);
    const col = new Float32Array(rows * COLS * 4);
    const n = new THREE.Vector3();
    // Probe points (every 8 m along the centre) whose tile LODs decide when to rebuild.
    const probes: number[] = [];
    for (let r = 0; r < rows; r++) {
      const s = s0 + r;
      // Interpolate between course samples (they're coarser than the rows).
      const f = Math.min(c.count - 1.001, s / c.step);
      const i = Math.floor(f);
      const w = f - i;
      const cx = c.x[i]! + (c.x[i + 1]! - c.x[i]!) * w;
      const cz = c.z[i]! + (c.z[i + 1]! - c.z[i]!) * w;
      const tx = c.tx[i]! + (c.tx[i + 1]! - c.tx[i]!) * w;
      const tz = c.tz[i]! + (c.tz[i + 1]! - c.tz[i]!) * w;
      const tl = Math.hypot(tx, tz) || 1;
      // Lateral axis (+ = the rider's right), matching CourseProps' edge offsets.
      const lx = -tz / tl;
      const lz = tx / tl;
      const sec = this.sections[c.section[i]!];
      const ice = sec?.trailSurface === 'ice';
      const wet = this.sampler.waterAt(cx, cz) !== null;
      // Dirt trails disappear under the snow cap on alpine summits (the terrain paints it white).
      const cap = this.snow ? 0 : this.sampler.snowCapAt(cx, cz, this.sampler.heightAt(cx, cz));
      if (r % 8 === 0 || r === rows - 1) probes.push(cx + lx * HALF, cz + lz * HALF, cx - lx * HALF, cz - lz * HALF);
      for (let q = 0; q < COLS; q++) {
        const t = q / (COLS - 1);
        const lat = (t * 2 - 1) * HALF;
        const x = cx + lx * lat;
        const z = cz + lz * lat;
        const h = this.meshAt(x, z, this.lodAt(x, z), n) + 0.02;
        const v = r * COLS + q;
        pos[v * 3] = x - ox;
        pos[v * 3 + 1] = h - oy;
        pos[v * 3 + 2] = z - oz;
        nor[v * 3] = n.x;
        nor[v * 3 + 1] = n.y;
        nor[v * 3 + 2] = n.z;
        uv[v * 2] = t;
        uv[v * 2 + 1] = s / TILE_LEN;
        const tint = ice ? ICE : null;
        col[v * 4] = tint ? tint.r : 1;
        col[v * 4 + 1] = tint ? tint.g : 1;
        col[v * 4 + 2] = tint ? tint.b : 1;
        // No trail over open water (bridges carry it there).
        col[v * 4 + 3] = wet ? 0 : 1 - cap;
      }
    }
    const index: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let q = 0; q < COLS - 1; q++) {
        const a = r * COLS + q;
        const b = a + 1;
        const d = a + COLS;
        const e = d + 1;
        index.push(a, b, d, b, e, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setIndex(index);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.userData.probes = probes;
    mesh.userData.sig = this.signature(probes);
    mesh.position.set(ox, oy, oz);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    return mesh;
  }
}

/** Tileable trail texture: u across the trail (edges fade out), v along it (one tile = TILE_LEN m). */
function trailTexture(snow: boolean, base: string): THREE.Texture {
  const W = 256;
  const H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d')!;
  x.fillStyle = base;
  x.fillRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Draw wrapped vertically so the tile repeats seamlessly along the trail.
  const wrapped = (fn: (dy: number) => void) => [0, -H, H].forEach(fn);
  if (snow) {
    // Corduroy: fine ridges along the trail, groomer-pass seams, a few board and ski tracks.
    // Groomer passes: three lanes in slightly different tones, darker seams between them.
    x.fillStyle = 'rgba(255,255,255,0.10)';
    x.fillRect(0, 0, W * 0.36, H);
    x.fillRect(W * 0.64, 0, W * 0.36, H);
    for (let u = 0; u < W; u += 4) {
      x.fillStyle = 'rgba(255,255,255,0.15)';
      x.fillRect(u, 0, 2, H);
      x.fillStyle = 'rgba(30,50,85,0.12)';
      x.fillRect(u + 2, 0, 2, H);
    }
    x.fillStyle = 'rgba(30,50,90,0.22)';
    for (const u of [0.36, 0.64]) x.fillRect(u * W - 3, 0, 6, H);
    x.lineWidth = 3;
    for (let k = 0; k < 5; k++) {
      const u0 = 0.2 + rnd() * 0.6;
      const amp = 6 + rnd() * 14;
      const per = 1 + Math.floor(rnd() * 2);
      const ph = rnd() * Math.PI * 2;
      x.strokeStyle = k % 2 ? 'rgba(60,85,120,0.16)' : 'rgba(255,255,255,0.22)';
      x.beginPath();
      for (let y = 0; y <= H; y += 8) {
        const px = u0 * W + Math.sin((y / H) * Math.PI * 2 * per + ph) * amp;
        if (y === 0) x.moveTo(px, y);
        else x.lineTo(px, y);
      }
      x.stroke();
    }
    // Pushed-up snow along the edges: brighter.
    for (const [u0, u1] of [[0, 0.16], [0.84, 1]] as const) {
      const g = x.createLinearGradient(u0 * W, 0, u1 * W, 0);
      const out = u0 === 0;
      g.addColorStop(out ? 0 : 1, 'rgba(255,255,255,0.45)');
      g.addColorStop(out ? 1 : 0, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(u0 * W, 0, (u1 - u0) * W, H);
    }
  } else {
    // Packed dirt: darker worn racing line and tyre ruts, loose lighter dirt at the edges, stones.
    const line = x.createLinearGradient(0, 0, W, 0);
    line.addColorStop(0.2, 'rgba(60,35,15,0)');
    line.addColorStop(0.5, 'rgba(60,35,15,0.18)');
    line.addColorStop(0.8, 'rgba(60,35,15,0)');
    x.fillStyle = line;
    x.fillRect(0, 0, W, H);
    for (const u of [0.38, 0.45, 0.55, 0.62]) {
      x.fillStyle = 'rgba(50,28,12,0.22)';
      x.fillRect(u * W - 3, 0, 6, H);
    }
    for (let k = 0; k < 1400; k++) {
      const px = rnd() * W;
      const py = rnd() * H;
      const r = 0.6 + rnd() * 1.4;
      const light = rnd() < 0.55;
      x.fillStyle = light ? `rgba(225,210,185,${0.35 + rnd() * 0.4})` : `rgba(55,35,20,${0.25 + rnd() * 0.35})`;
      wrapped((dy) => {
        x.beginPath();
        x.arc(px, py + dy, r, 0, Math.PI * 2);
        x.fill();
      });
    }
    for (const [u0, u1] of [[0, 0.18], [0.82, 1]] as const) {
      const g = x.createLinearGradient(u0 * W, 0, u1 * W, 0);
      const out = u0 === 0;
      g.addColorStop(out ? 0 : 1, 'rgba(200,165,120,0.5)');
      g.addColorStop(out ? 1 : 0, 'rgba(200,165,120,0)');
      x.fillStyle = g;
      x.fillRect(u0 * W, 0, (u1 - u0) * W, H);
    }
  }
  // Fade the outer edges to transparent so the strip melts into the terrain colour.
  const img = x.getImageData(0, 0, W, H);
  for (let u = 0; u < W; u++) {
    const t = u / (W - 1);
    const e = Math.min(1, Math.min(t, 1 - t) / 0.1);
    const a = Math.round(255 * e * e * (3 - 2 * e));
    for (let y = 0; y < H; y++) img.data[(y * W + u) * 4 + 3] = Math.min(img.data[(y * W + u) * 4 + 3]!, a);
  }
  x.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
