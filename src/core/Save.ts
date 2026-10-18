import type { Difficulty } from '../config/race';
import type { KeyBindings, PadBindings } from '../config/controls';
import type { QualityPreset } from '../config/graphics';
import type { MapId } from '../config/maps';
import { DEFAULT_LOOK, type RiderLook } from '../config/riders';
import type { VehicleId } from '../config/vehicles';

/** Versioned localStorage save. Bump SAVE_VERSION and add a migration when the shape changes. */
export const SAVE_VERSION = 1;
const KEY = 'long-way-down:save';

export interface BestTime {
  time: number;
  splits: number[];
  date: string;
}

export interface SaveData {
  version: number;
  settings: {
    quality: QualityPreset;
    masterVolume: number;
    musicVolume: number;
    sfxVolume: number;
    invertY: boolean;
    /** Degrees added to every camera FOV. */
    fovOffset: number;
    /** Race bot difficulty. */
    difficulty: Difficulty;
    /** Dev / testing: every vehicle, map and cosmetic unlocked. */
    unlockAll: boolean;
    keys: Partial<KeyBindings>;
    pad: Partial<PadBindings>;
  };
  progress: {
    bestTimes: Partial<Record<MapId, BestTime>>;
    finishes: Partial<Record<MapId, number>>;
    runsStarted: number;
    totalDistance: number;
    snowDistance: number;
    totalTrickScore: number;
    unlockedVehicles: VehicleId[];
    unlockedMaps: MapId[];
    unlockedCosmetics: string[];
    collectibles: string[];
  };
  /** Name shown to other riders online. */
  name: string;
  look: RiderLook;
  /** Vehicle paint per vehicle (unset = the vehicle's default). */
  paint: Partial<Record<VehicleId, { primary: string; secondary: string }>>;
  firstPlayDone: boolean;
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    settings: { quality: 'medium', masterVolume: 0.8, musicVolume: 0.6, sfxVolume: 0.8, invertY: false, fovOffset: 0, difficulty: 'normal', unlockAll: false, keys: {}, pad: {} },
    progress: {
      bestTimes: {},
      finishes: {},
      runsStarted: 0,
      totalDistance: 0,
      snowDistance: 0,
      totalTrickScore: 0,
      unlockedVehicles: ['bicycle'],
      unlockedMaps: ['snowPeak'],
      unlockedCosmetics: [],
      collectibles: [],
    },
    name: '',
    look: { ...DEFAULT_LOOK },
    paint: {},
    firstPlayDone: false,
  };
}

/** version -> function upgrading data from that version to version + 1. */
const MIGRATIONS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {};

function merge<T>(base: T, over: unknown): T {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return (over ?? base) as T;
  const out = { ...(base as Record<string, unknown>) };
  if (over && typeof over === 'object') {
    for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
      const b = (base as Record<string, unknown>)[k];
      out[k] = b !== undefined && typeof b === 'object' && b !== null && !Array.isArray(b) ? merge(b, v) : v;
    }
  }
  return out as T;
}

export class Save {
  data: SaveData;

  constructor() {
    this.data = this.load();
  }

  private load(): SaveData {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultSave();
      let d = JSON.parse(raw) as Record<string, unknown>;
      let v = typeof d.version === 'number' ? d.version : 0;
      while (v < SAVE_VERSION && MIGRATIONS[v]) {
        d = MIGRATIONS[v]!(d);
        v++;
      }
      // Fill any fields added since (defaults), keep stored values.
      const merged = merge(defaultSave(), d);
      merged.version = SAVE_VERSION;
      return merged;
    } catch {
      return defaultSave();
    }
  }

  write(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Storage unavailable (private mode / quota): keep playing without persistence.
    }
  }

  reset(): void {
    this.data = defaultSave();
    this.write();
  }

  isMapUnlocked(id: MapId): boolean {
    return this.data.progress.unlockedMaps.includes(id) || unlockAllEnabled() || this.data.settings.unlockAll;
  }

  /** The player's paint for a vehicle as model options (unset colours = defaults). */
  paintFor(id: VehicleId): { primary?: string; secondary?: string } | undefined {
    const p = this.data.paint[id];
    return p ? { primary: p.primary || undefined, secondary: p.secondary || undefined } : undefined;
  }
}

/** Dev / testing: `?unlockall` in the URL unlocks everything (never written to the save). */
export function unlockAllEnabled(): boolean {
  return new URLSearchParams(location.search).has('unlockall');
}
