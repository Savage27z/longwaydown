import type { LandInfo } from '../vehicles/Vehicle';

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
  'camera:mode': { mode: 'chase' | 'helmet' };
}

export const events = new EventBus<GameEvents>();
