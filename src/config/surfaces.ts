/** Ground surface types. The numeric index is what terrain tiles store per vertex. */
/** Appended in order: tiles store these indices, so new ids only ever go at the end. */
export const SURFACES = ['powder', 'packed', 'ice', 'rock', 'grass', 'dirt', 'mud', 'gravel', 'water', 'trail'] as const;
export type SurfaceId = (typeof SURFACES)[number];

export const SURFACE_INDEX: Record<SurfaceId, number> = Object.fromEntries(SURFACES.map((s, i) => [s, i])) as Record<SurfaceId, number>;

/** Snow for snow-only vehicles. The trail is groomed snow on snow maps (they're disabled elsewhere). */
export const SNOW_SURFACES: ReadonlySet<SurfaceId> = new Set(['powder', 'packed', 'ice', 'trail']);

export interface SurfacePhysics {
  /** Lateral grip multiplier (1 = nominal). */
  grip: number;
  /** Rolling resistance (m/s^2 at nominal). */
  rolling: number;
  /** Extra drag from soft ground (fraction of speed lost per second). */
  softDrag: number;
  /** Bumpiness 0..1, drives camera shake / suspension noise. */
  rough: number;
}

/** Baseline surface physics. Vehicles multiply these with their own per-surface modifiers. */
export const SURFACE_PHYSICS: Record<SurfaceId, SurfacePhysics> = {
  powder: { grip: 0.8, rolling: 0.9, softDrag: 0.09, rough: 0.15 },
  packed: { grip: 1.0, rolling: 0.25, softDrag: 0.0, rough: 0.1 },
  ice: { grip: 0.35, rolling: 0.08, softDrag: 0.0, rough: 0.05 },
  rock: { grip: 0.9, rolling: 0.5, softDrag: 0.01, rough: 0.7 },
  grass: { grip: 0.85, rolling: 0.55, softDrag: 0.02, rough: 0.25 },
  dirt: { grip: 0.95, rolling: 0.35, softDrag: 0.0, rough: 0.3 },
  mud: { grip: 0.5, rolling: 1.2, softDrag: 0.12, rough: 0.35 },
  gravel: { grip: 0.7, rolling: 0.45, softDrag: 0.02, rough: 0.55 },
  water: { grip: 0.6, rolling: 1.6, softDrag: 0.22, rough: 0.2 },
  // The groomed trail: the fast, grippy line.
  trail: { grip: 1.15, rolling: 0.12, softDrag: 0.0, rough: 0.04 },
};
