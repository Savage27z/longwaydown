import type { VehicleId } from '../config/vehicles';
import type { LandInfo } from '../vehicles/Vehicle';
import type { RunResults, RunState } from '../gameplay/Run';
import type { PickupKind } from '../config/stunts';

/** Typed event bus. Systems emit; UI/audio/fx listen. Nothing holds direct references across layers. */

type Handler<T> = (payload: T) => void;

export class EventBus<M extends object> {
  private handlers = new Map<keyof M, Set<Handler<never>>>();

  on<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler<never>);
    return () => this.off(type, fn);
  }

  once<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof M>(type: K, fn: Handler<M[K]>): void {
    this.handlers.get(type)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) (fn as Handler<M[K]>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface GameEvents {
  'state:change': { from: string; to: string };
  'origin:shift': { dx: number; dy: number; dz: number };
  'settings:change': { key: string };
  'quality:change': { preset: string };
  'player:takeoff': Record<string, never>;
  'player:land': LandInfo;
  'player:crash': { reason: string; penalty: number };
  'player:respawn': { reason: string };
  /** Vehicle swapped in place; position is local (simulation) coordinates. */
  'player:switch': { from: VehicleId; to: VehicleId; position: Vec3Like };
  'wheel:toggle': { open: boolean };
  'camera:mode': { mode: 'chase' | 'far' | 'first' };
  'run:state': { state: RunState };
  'run:countdown': { n: number };
  'run:checkpoint': { index: number; count: number; time: number; delta: number | null };
  'run:penalty': { seconds: number; reason: string };
  'run:finish': { results: RunResults };
  /** A trick landed (points before the combo multiplier) and the combo it now belongs to. */
  'trick:land': { name: string; points: number; mult: number; combo: number };
  'trick:bank': { points: number };
  'trick:lost': { points: number };
  'rider:nearMiss': { points: number };
  'rider:pickup': { kind: PickupKind };
}

export const events = new EventBus<GameEvents>();
