/// <reference lib="webworker" />
import type { MapId } from '../config/maps';
import { buildBackdrop, buildTile, type TileRequest } from './TileBuilder';
import { TerrainSampler } from './TerrainSampler';

/**
 * Terrain worker: owns its own deterministic copy of the course + sampler and builds tile
 * geometry/collider data off the main thread.
 */
export type WorkerIn =
  | { type: 'init'; mapId: MapId }
  | { type: 'tile'; req: TileRequest }
  | { type: 'backdrop'; spacing: number; margin: number };

const ctx = self as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null;
};

let sampler: TerrainSampler | null = null;

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    if (!sampler || sampler.map.id !== msg.mapId) sampler = new TerrainSampler(msg.mapId);
    ctx.postMessage({ type: 'ready', mapId: msg.mapId });
    return;
  }
  if (!sampler) throw new Error('terrain worker used before init');
  if (msg.type === 'tile') {
    const t0 = performance.now();
    const r = buildTile(sampler, msg.req);
    sampler.trimCache(60000);
    const transfer: Transferable[] = [r.positions.buffer, r.normals.buffer, r.colors.buffer, r.index.buffer, r.heights.buffer, r.surfaces.buffer, ...r.props.map((p) => p.buffer)];
    ctx.postMessage({ type: 'tile', result: r, ms: performance.now() - t0 }, transfer);
  } else if (msg.type === 'backdrop') {
    const r = buildBackdrop(sampler, msg.spacing, msg.margin);
    ctx.postMessage({ type: 'backdrop', result: r }, [r.positions.buffer, r.normals.buffer, r.colors.buffer]);
  }
};
