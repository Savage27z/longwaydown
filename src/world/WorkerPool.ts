import type { MapId } from '../config/maps';
import type { BackdropResult, TileRequest, TileResult } from './TileBuilder';
import type { WorkerIn } from './terrain.worker';

interface Slot {
  worker: Worker;
  busy: boolean;
  ready: boolean;
  job: TileRequest | null;
}

/** Small pool of terrain workers with a priority queue of tile jobs. */
export class WorkerPool {
  private slots: Slot[] = [];
  private queue: TileRequest[] = [];
  private onTile: (r: TileResult, ms: number) => void;
  private backdropResolve: ((r: BackdropResult) => void) | null = null;
  private readyResolve: (() => void) | null = null;
  private readyPromise: Promise<void>;
  /** Rolling average build time (ms). */
  avgMs = 0;

  constructor(mapId: MapId, onTile: (r: TileResult, ms: number) => void) {
    this.onTile = onTile;
    this.readyPromise = new Promise((res) => (this.readyResolve = res));
    const cores = navigator.hardwareConcurrency || 4;
    const count = cores >= 6 ? 3 : cores >= 4 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
      const slot: Slot = { worker, busy: false, ready: false, job: null };
      worker.onmessage = (e: MessageEvent) => this.onMessage(slot, e.data);
      worker.onerror = (e) => console.error('[terrain worker]', e.message);
      this.post(slot, { type: 'init', mapId });
      this.slots.push(slot);
    }
  }

  get size(): number {
    return this.slots.length;
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  get pending(): number {
    return this.queue.length + this.slots.filter((s) => s.busy).length;
  }

  /** LOD of the job currently being built for a tile key, if any. */
  runningLod(key: string): number | undefined {
    for (const s of this.slots) if (s.job && `${s.job.ix},${s.job.iz}` === key) return s.job.lod;
    return undefined;
  }

  /** Replace the queued (not yet started) jobs; caller passes them sorted by priority. */
  setQueue(jobs: TileRequest[]): void {
    this.queue = jobs;
    this.pump();
  }

  buildBackdrop(spacing: number, margin: number): Promise<BackdropResult> {
    return new Promise((res) => {
      this.backdropResolve = res;
      // Use the last worker so the first ones stay free for tiles.
      const slot = this.slots[this.slots.length - 1]!;
      slot.busy = true;
      this.post(slot, { type: 'backdrop', spacing, margin });
    });
  }

  private post(slot: Slot, msg: WorkerIn): void {
    slot.worker.postMessage(msg);
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (!slot.ready || slot.busy) continue;
      const job = this.queue.shift();
      if (!job) return;
      slot.busy = true;
      slot.job = job;
      this.post(slot, { type: 'tile', req: job });
    }
  }

  private onMessage(slot: Slot, data: { type: string; result?: unknown; ms?: number }): void {
    if (data.type === 'ready') {
      slot.ready = true;
      if (this.slots.every((s) => s.ready)) this.readyResolve?.();
    } else if (data.type === 'tile') {
      slot.busy = false;
      slot.job = null;
      const ms = data.ms ?? 0;
      this.avgMs = this.avgMs === 0 ? ms : this.avgMs * 0.9 + ms * 0.1;
      this.onTile(data.result as TileResult, ms);
    } else if (data.type === 'backdrop') {
      slot.busy = false;
      this.backdropResolve?.(data.result as BackdropResult);
      this.backdropResolve = null;
    }
    this.pump();
  }

  dispose(): void {
    for (const s of this.slots) s.worker.terminate();
    this.slots = [];
    this.queue = [];
  }
}
