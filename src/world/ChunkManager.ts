import * as THREE from 'three';
import type { GraphicsSettings } from '../config/graphics';
import type { MapId } from '../config/maps';
import { WORLD } from '../config/world';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { shared } from '../utils/dispose';
import type { PropLibrary } from './Props';
import { TerrainChunk } from './TerrainChunk';
import type { TerrainSampler } from './TerrainSampler';
import type { TileRequest, TileResult } from './TileBuilder';
import { WorkerPool } from './WorkerPool';

interface Want {
  ix: number;
  iz: number;
  lod: number;
  priority: number;
}

/**
 * Streams terrain tiles around the focus point:
 * - LOD0 (mesh + heightfield + prop colliders): tiles along the corridor from 1 chunk behind
 *   to WORLD.chunksAhead chunks ahead, plus everything within WORLD.physicsRadius.
 * - LOD1 (mesh only): the rest within the graphics preset's near radius.
 * Results arrive from worker threads and are finalized under a per-frame budget.
 */
export class ChunkManager {
  readonly tiles = new Map<string, TerrainChunk>();
  readonly material: THREE.MeshLambertMaterial;
  private pool: WorkerPool;
  private ready: TileResult[] = [];
  private nextId = 1;
  private wanted = new Map<string, Want>();
  private planTimer = 0;
  private focus = new THREE.Vector3();
  stats = { built: 0, disposed: 0, lastBuildMs: 0 };

  constructor(
    mapId: MapId,
    private readonly sampler: TerrainSampler,
    private readonly physics: PhysicsWorld,
    private readonly parent: THREE.Object3D,
    private readonly props: PropLibrary,
    private readonly origin: THREE.Vector3,
    private graphics: GraphicsSettings,
  ) {
    this.material = shared(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.pool = new WorkerPool(mapId, (r, ms) => {
      this.stats.lastBuildMs = ms;
      this.ready.push(r);
    });
  }

  get workers(): WorkerPool {
    return this.pool;
  }

  setGraphics(g: GraphicsSettings): void {
    this.graphics = g;
    for (const t of this.tiles.values()) t.setShadows(g.shadows);
    this.planTimer = 0;
  }

  /** Global surface index at (x, z) from loaded tile data, or the sampler as a fallback. */
  surfaceAt(gx: number, gz: number): number {
    const S = WORLD.chunkSize;
    const t = this.tiles.get(`${Math.floor(gx / S)},${Math.floor(gz / S)}`);
    if (t) return t.surfaceAt(gx, gz);
    return this.sampler.surfaceAt(gx, gz);
  }

  /** Is there a physics collider under this global point? */
  hasPhysicsAt(gx: number, gz: number): boolean {
    const S = WORLD.chunkSize;
    return this.tiles.get(`${Math.floor(gx / S)},${Math.floor(gz / S)}`)?.hasPhysics ?? false;
  }

  /** Recompute the wanted tile set for a focus (global) and course progress (m). */
  plan(focusGlobal: THREE.Vector3, progressS: number): void {
    this.focus.copy(focusGlobal);
    const S = WORLD.chunkSize;
    const want = new Map<string, Want>();
    const add = (ix: number, iz: number, lod: number, priority: number) => {
      const k = `${ix},${iz}`;
      const cur = want.get(k);
      if (!cur || lod < cur.lod || (lod === cur.lod && priority < cur.priority)) want.set(k, { ix, iz, lod, priority });
    };

    // LOD0 along the corridor (behind -> ahead).
    const c = this.sampler.course;
    const s0 = Math.max(0, progressS - WORLD.chunksBehind * S);
    const s1 = Math.min(c.length, progressS + WORLD.chunksAhead * S);
    for (let s = s0; s <= s1; s += 16) {
      const i = Math.min(c.count - 1, Math.round(s / c.step));
      const r = c.hw[i]! + WORLD.corridorTilePad;
      const x = c.x[i]!;
      const z = c.z[i]!;
      const ahead = Math.abs(s - progressS);
      for (let ix = Math.floor((x - r) / S); ix <= Math.floor((x + r) / S); ix++) {
        for (let iz = Math.floor((z - r) / S); iz <= Math.floor((z + r) / S); iz++) add(ix, iz, 0, ahead);
      }
    }
    // LOD0 around the focus.
    const pr = WORLD.physicsRadius;
    const fx = focusGlobal.x;
    const fz = focusGlobal.z;
    for (let ix = Math.floor((fx - pr) / S); ix <= Math.floor((fx + pr) / S); ix++) {
      for (let iz = Math.floor((fz - pr) / S); iz <= Math.floor((fz + pr) / S); iz++) {
        const d = distToTile(fx, fz, ix, iz);
        if (d <= pr) add(ix, iz, 0, d * 0.5);
      }
    }
    // LOD1 ring.
    const nr = this.graphics.nearRadius;
    for (let ix = Math.floor((fx - nr) / S); ix <= Math.floor((fx + nr) / S); ix++) {
      for (let iz = Math.floor((fz - nr) / S); iz <= Math.floor((fz + nr) / S); iz++) {
        const d = distToTile(fx, fz, ix, iz);
        if (d <= nr) add(ix, iz, 1, 400 + d);
      }
    }
    this.wanted = want;

    // Queue missing/upgrade jobs by priority.
    const jobs: (TileRequest & { priority: number })[] = [];
    for (const [k, w] of want) {
      const t = this.tiles.get(k);
      if (t && t.lod <= w.lod) continue;
      const running = this.pool.runningLod(k);
      if (running !== undefined && running <= w.lod) continue;
      if (this.ready.some((r) => r.ix === w.ix && r.iz === w.iz && r.lod <= w.lod)) continue;
      jobs.push({ id: this.nextId++, ix: w.ix, iz: w.iz, lod: w.lod, treeDensity: this.graphics.treeDensity, priority: w.priority });
    }
    // Downgrade far LOD0 tiles to save triangles/colliders.
    for (const [k, t] of this.tiles) {
      const w = want.get(k);
      if (t.lod === 0 && w && w.lod === 1 && this.pool.runningLod(k) === undefined) {
        jobs.push({ id: this.nextId++, ix: t.ix, iz: t.iz, lod: 1, treeDensity: this.graphics.treeDensity, priority: 2000 });
      }
    }
    jobs.sort((a, b) => a.priority - b.priority);
    // Queued-but-unstarted jobs are replaced on every plan, so nothing goes stale.
    this.pool.setQueue(jobs.slice(0, 48).map(({ priority: _p, ...req }) => req));

    // Unload tiles far outside the wanted set (hysteresis margin).
    for (const [k, t] of this.tiles) {
      if (want.has(k)) continue;
      const d = distToTile(fx, fz, t.ix, t.iz);
      if (d > nr + 200) {
        t.dispose(this.physics);
        this.tiles.delete(k);
        this.stats.disposed++;
      }
    }
  }

  /** Per frame: replan periodically and finalize finished tiles within budget. */
  update(dt: number, focusGlobal: THREE.Vector3, progressS: number): void {
    this.planTimer -= dt;
    const moved = focusGlobal.distanceToSquared(this.focus) > 48 * 48;
    if (this.planTimer <= 0 || moved) {
      this.planTimer = 0.4;
      this.plan(focusGlobal, progressS);
    }
    this.finalize(WORLD.buildsPerFrame);
    this.stepColliders(400);
  }

  finalize(budget: number): number {
    let done = 0;
    while (done < budget && this.ready.length) {
      const r = this.ready.shift()!;
      const k = `${r.ix},${r.iz}`;
      const w = this.wanted.get(k);
      if (!w) continue; // no longer needed
      const old = this.tiles.get(k);
      // Keep the existing tile if it is at least as close to the wanted LOD.
      if (old && Math.abs(old.lod - w.lod) <= Math.abs(r.lod - w.lod)) continue;
      const chunk = new TerrainChunk(r, this.material, this.props, this.parent, this.graphics.shadows);
      if (r.lod === 0) chunk.addPhysics(this.physics, this.origin);
      if (old) old.dispose(this.physics);
      this.tiles.set(k, chunk);
      this.stats.built++;
      done++;
    }
    return done;
  }

  private stepColliders(budget: number): void {
    // Nearest tiles first.
    let left = budget;
    const list = [...this.tiles.values()].filter((t) => t.collidersPending);
    list.sort((a, b) => distToTile(this.focus.x, this.focus.z, a.ix, a.iz) - distToTile(this.focus.x, this.focus.z, b.ix, b.iz));
    for (const t of list) {
      if (left <= 0) break;
      left -= t.stepColliders(this.physics, left);
    }
  }

  /** Block until every wanted tile near the focus is built (loading screen). */
  async preload(focusGlobal: THREE.Vector3, progressS: number, onProgress: (p: number) => void): Promise<void> {
    await this.pool.whenReady();
    this.plan(focusGlobal, progressS);
    const total = Math.max(1, this.wanted.size);
    while (true) {
      this.finalize(64);
      const missing = [...this.wanted].filter(([k, w]) => {
        const t = this.tiles.get(k);
        return !t || t.lod > w.lod;
      }).length;
      onProgress(1 - missing / total);
      if (missing === 0) break;
      if (this.pool.pending === 0 && this.ready.length === 0) this.plan(focusGlobal, progressS);
      await new Promise((r) => setTimeout(r, 30));
    }
    // Finish prop colliders near the start.
    while ([...this.tiles.values()].some((t) => t.collidersPending)) this.stepColliders(5000);
  }

  /** All obstacle arrays (global x,y,z,r) of LOD0 tiles near a point. */
  obstaclesNear(gx: number, gz: number): Float32Array[] {
    const S = WORLD.chunkSize;
    const out: Float32Array[] = [];
    const ix = Math.floor(gx / S);
    const iz = Math.floor(gz / S);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const t = this.tiles.get(`${ix + dx},${iz + dz}`);
        if (t && t.lod === 0) out.push(t.obstacles);
      }
    }
    return out;
  }

  get counts(): { lod0: number; lod1: number; physics: number; pending: number } {
    let lod0 = 0;
    let lod1 = 0;
    let physics = 0;
    for (const t of this.tiles.values()) {
      if (t.lod === 0) lod0++;
      else lod1++;
      if (t.hasPhysics) physics++;
    }
    return { lod0, lod1, physics, pending: this.pool.pending + this.ready.length };
  }

  dispose(): void {
    for (const t of this.tiles.values()) t.dispose(this.physics);
    this.tiles.clear();
    this.pool.dispose();
    this.material.dispose();
  }
}

function distToTile(x: number, z: number, ix: number, iz: number): number {
  const S = WORLD.chunkSize;
  const cx = Math.max(ix * S, Math.min(x, (ix + 1) * S));
  const cz = Math.max(iz * S, Math.min(z, (iz + 1) * S));
  return Math.hypot(x - cx, z - cz);
}
