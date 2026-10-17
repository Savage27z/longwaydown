import type { SurfaceId } from './surfaces';

/**
 * A map is seed + biome + an ordered list of sections. Adding a third map is mostly adding a
 * new entry here (plus a biome if it needs new visuals).
 */

export type MapId = 'snowPeak' | 'greenRidge';
export type BiomeId = 'snow' | 'alpine';

export type FeatureType =
  | 'jump'
  | 'roller'
  | 'gap'
  | 'rockGarden'
  | 'cliffDrop'
  | 'kicker'
  | 'arch'
  | 'tunnel'
  | 'overlook'
  | 'ramp'
  | 'logs'
  | 'river'
  | 'ford';

export interface FeatureSpec {
  type: FeatureType;
  /** Average spacing (m) for repeating features. */
  every?: number;
  /** Or: a fixed number spread across the section. */
  count?: number;
  /** Size multiplier (1 = default). */
  size?: number;
}

export interface SectionSpec {
  name: string;
  length: number;
  /** Average downhill grade (0.25 = 25% = 25 m drop per 100 m). */
  grade: number;
  /** +/- slow variation of the grade; can dip below zero for short uphill rollers. */
  gradeVar: number;
  /** Heading wander strength (0..1). */
  curviness: number;
  /** Zig-zag hairpins across the fall line instead of free wander. */
  switchbacks?: { legLength: number; angleDeg: number };
  /** Rideable corridor width range (m). */
  width: [number, number];
  /** >0: walls rise beside the corridor (gully). <0: ground falls away (ridge). */
  walls: number;
  /** Off-corridor roughness (rocky noise amplitude multiplier). */
  roughness: number;
  /** In-corridor bump amplitude multiplier. */
  bumps: number;
  /** Surface mix on the line (weights). */
  surfaces: Partial<Record<SurfaceId, number>>;
  /** Surface off the line (before slope/rock rules). */
  offSurface: SurfaceId;
  /** 0..1 tree density off the line. */
  forest: number;
  /** 0..1 scattered rock density. */
  rocks: number;
  /** Flatten the corridor completely (frozen lake). */
  flat?: boolean;
  features: FeatureSpec[];
}

export interface MapConfig {
  id: MapId;
  name: string;
  tagline: string;
  seed: string;
  biome: BiomeId;
  summitElevation: number;
  totalDrop: number;
  /** Heading (radians) the course generally descends toward. 0 = +Z. */
  fallDirection: number;
  /** Max heading deviation from the fall direction (keeps the path from looping). */
  maxDeviationDeg: number;
  checkpointSpacing: number;
  markerSpacing: number;
  sections: SectionSpec[];
}

export const MAPS: Record<MapId, MapConfig> = {
  snowPeak: {
    id: 'snowPeak',
    name: 'Snow Peak',
    tagline: 'From a jagged summit, through powder, ice and pine, to the village below.',
    seed: 'snow-peak-v1',
    biome: 'snow',
    summitElevation: 4500,
    totalDrop: 4000,
    fallDirection: 0,
    maxDeviationDeg: 68,
    checkpointSpacing: 2000,
    markerSpacing: 1000,
    sections: [
      { name: 'Summit', length: 420, grade: 0.06, gradeVar: 0.02, curviness: 0.15, width: [95, 110], walls: 0.35, roughness: 0.8, bumps: 0.2, surfaces: { packed: 1 }, offSurface: 'powder', forest: 0, rocks: 0.3, features: [] },
      {
        name: 'Powder Fields', length: 4320, grade: 0.25, gradeVar: 0.06, curviness: 0.6, width: [120, 150], walls: 0.5, roughness: 0.5, bumps: 1,
        surfaces: { powder: 0.55, packed: 0.45 }, offSurface: 'powder', forest: 0, rocks: 0.12,
        features: [{ type: 'jump', every: 280 }, { type: 'roller', every: 520 }, { type: 'ramp', every: 600 }, { type: 'kicker', count: 4 }],
      },
      {
        name: 'Ridgeline', length: 2400, grade: 0.14, gradeVar: 0.04, curviness: 0.35, width: [60, 75], walls: -0.8, roughness: 0.9, bumps: 0.6,
        surfaces: { packed: 0.7, powder: 0.2, rock: 0.1 }, offSurface: 'powder', forest: 0, rocks: 0.2,
        features: [{ type: 'overlook', count: 1 }, { type: 'jump', every: 380 }, { type: 'kicker', count: 2 }],
      },
      {
        name: 'Couloir', length: 1440, grade: 0.42, gradeVar: 0.05, curviness: 0.25, width: [60, 80], walls: 1.6, roughness: 1.1, bumps: 0.9,
        surfaces: { powder: 0.7, packed: 0.2, rock: 0.1 }, offSurface: 'rock', forest: 0, rocks: 0.5,
        features: [{ type: 'rockGarden', count: 2 }, { type: 'cliffDrop', count: 1 }, { type: 'arch', count: 1 }],
      },
      {
        name: 'Icy Switchbacks', length: 3000, grade: 0.19, gradeVar: 0.03, curviness: 0.1, switchbacks: { legLength: 330, angleDeg: 58 }, width: [60, 72], walls: 0.6, roughness: 0.7, bumps: 0.4,
        surfaces: { ice: 0.65, packed: 0.35 }, offSurface: 'packed', forest: 0.12, rocks: 0.2,
        features: [{ type: 'ramp', count: 2 }, { type: 'kicker', count: 3 }],
      },
      {
        name: 'Pine Forest', length: 4800, grade: 0.17, gradeVar: 0.05, curviness: 0.55, width: [70, 100], walls: 0.5, roughness: 0.5, bumps: 0.8,
        surfaces: { packed: 0.6, powder: 0.4 }, offSurface: 'powder', forest: 0.85, rocks: 0.25,
        features: [{ type: 'jump', every: 340 }, { type: 'gap', count: 3 }, { type: 'logs', every: 500 }, { type: 'arch', count: 1 }, { type: 'rockGarden', count: 1 }],
      },
      {
        name: 'Frozen Lake', length: 1800, grade: 0.012, gradeVar: 0.004, curviness: 0.25, width: [140, 150], walls: 0.15, roughness: 0.3, bumps: 0, flat: true,
        surfaces: { ice: 1 }, offSurface: 'powder', forest: 0.08, rocks: 0.05,
        features: [{ type: 'kicker', count: 3 }],
      },
      {
        name: 'Lower Slopes', length: 4200, grade: 0.14, gradeVar: 0.05, curviness: 0.6, width: [90, 130], walls: 0.45, roughness: 0.6, bumps: 0.8,
        surfaces: { packed: 0.55, powder: 0.25, rock: 0.2 }, offSurface: 'packed', forest: 0.45, rocks: 0.35,
        features: [{ type: 'cliffDrop', count: 1 }, { type: 'tunnel', count: 1 }, { type: 'jump', every: 320 }, { type: 'roller', every: 600 }, { type: 'overlook', count: 1 }],
      },
      { name: 'Finish Village', length: 720, grade: 0.05, gradeVar: 0.01, curviness: 0.1, width: [110, 130], walls: 0.25, roughness: 0.3, bumps: 0.2, surfaces: { packed: 1 }, offSurface: 'packed', forest: 0.15, rocks: 0.05, features: [] },
    ],
  },
  greenRidge: {
    id: 'greenRidge',
    name: 'Green Ridge',
    tagline: 'Meadows, scree and singletrack, across the river and home through the farms.',
    seed: 'green-ridge-v1',
    biome: 'alpine',
    summitElevation: 3900,
    totalDrop: 3500,
    fallDirection: Math.PI / 2,
    maxDeviationDeg: 70,
    checkpointSpacing: 2000,
    markerSpacing: 1000,
    sections: [
      { name: 'Rocky Summit', length: 390, grade: 0.07, gradeVar: 0.02, curviness: 0.15, width: [95, 110], walls: 0.4, roughness: 1, bumps: 0.3, surfaces: { rock: 0.5, gravel: 0.3, grass: 0.2 }, offSurface: 'rock', forest: 0, rocks: 0.4, features: [] },
      {
        name: 'Alpine Meadows', length: 4700, grade: 0.19, gradeVar: 0.06, curviness: 0.6, width: [120, 150], walls: 0.45, roughness: 0.5, bumps: 0.9,
        surfaces: { grass: 0.75, dirt: 0.25 }, offSurface: 'grass', forest: 0.05, rocks: 0.15,
        features: [{ type: 'jump', every: 300 }, { type: 'roller', every: 480 }, { type: 'ramp', every: 700 }, { type: 'kicker', count: 2 }],
      },
      {
        name: 'Rocky Scree', length: 2240, grade: 0.28, gradeVar: 0.05, curviness: 0.4, width: [80, 110], walls: 0.9, roughness: 1.1, bumps: 1,
        surfaces: { gravel: 0.55, rock: 0.35, dirt: 0.1 }, offSurface: 'gravel', forest: 0, rocks: 0.6,
        features: [{ type: 'rockGarden', count: 3 }, { type: 'cliffDrop', count: 1 }],
      },
      {
        name: 'Cliffside Trail', length: 2800, grade: 0.17, gradeVar: 0.04, curviness: 0.45, width: [60, 70], walls: -0.6, roughness: 1, bumps: 0.6,
        surfaces: { dirt: 0.8, rock: 0.2 }, offSurface: 'rock', forest: 0.05, rocks: 0.3,
        features: [{ type: 'overlook', count: 2 }, { type: 'jump', every: 420 }, { type: 'tunnel', count: 1 }],
      },
      {
        name: 'Forest Singletrack', length: 4480, grade: 0.14, gradeVar: 0.05, curviness: 0.9, width: [60, 75], walls: 0.5, roughness: 0.5, bumps: 0.9,
        surfaces: { dirt: 0.7, mud: 0.15, grass: 0.15 }, offSurface: 'grass', forest: 0.95, rocks: 0.25,
        features: [{ type: 'logs', every: 400 }, { type: 'jump', every: 320 }, { type: 'gap', count: 3 }, { type: 'arch', count: 1 }],
      },
      {
        name: 'River Valley', length: 3360, grade: 0.055, gradeVar: 0.02, curviness: 0.5, width: [100, 140], walls: 0.35, roughness: 0.4, bumps: 0.5,
        surfaces: { grass: 0.5, dirt: 0.3, mud: 0.2 }, offSurface: 'grass', forest: 0.35, rocks: 0.15,
        features: [{ type: 'river', count: 3 }, { type: 'ford', count: 2 }],
      },
      {
        name: 'Farmland Hills', length: 5040, grade: 0.075, gradeVar: 0.07, curviness: 0.45, width: [110, 150], walls: 0.25, roughness: 0.3, bumps: 0.7,
        surfaces: { grass: 0.8, dirt: 0.2 }, offSurface: 'grass', forest: 0.12, rocks: 0.05,
        features: [{ type: 'roller', every: 380 }, { type: 'kicker', count: 5 }, { type: 'jump', every: 400 }],
      },
      { name: 'Finish Town', length: 670, grade: 0.04, gradeVar: 0.01, curviness: 0.1, width: [110, 130], walls: 0.2, roughness: 0.3, bumps: 0.2, surfaces: { dirt: 0.5, gravel: 0.5 }, offSurface: 'grass', forest: 0.1, rocks: 0.02, features: [] },
    ],
  },
};

export const MAP_ORDER: MapId[] = ['snowPeak', 'greenRidge'];
