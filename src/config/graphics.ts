export type QualityPreset = 'low' | 'medium' | 'high';

export interface GraphicsSettings {
  /** Multiplier on devicePixelRatio, then capped by maxPixelRatio. */
  pixelRatioScale: number;
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Half-size of the sun's shadow frustum around the player (m). */
  shadowExtent: number;
  /** Streamed LOD1 tile radius around the player (m). */
  nearRadius: number;
  /** Fog far distance (m). */
  fogFar: number;
  /** 0..1 multipliers. */
  grassDensity: number;
  treeDensity: number;
  particleScale: number;
  postFx: boolean;
  antialias: boolean;
}

export const GRAPHICS_PRESETS: Record<QualityPreset, GraphicsSettings> = {
  low: {
    pixelRatioScale: 0.75,
    maxPixelRatio: 1,
    shadows: false,
    shadowMapSize: 1024,
    shadowExtent: 70,
    nearRadius: 420,
    fogFar: 3200,
    grassDensity: 0.2,
    treeDensity: 0.55,
    particleScale: 0.35,
    postFx: false,
    antialias: false,
  },
  medium: {
    pixelRatioScale: 1,
    maxPixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    shadowExtent: 90,
    nearRadius: 620,
    fogFar: 5200,
    grassDensity: 0.55,
    treeDensity: 0.8,
    particleScale: 0.7,
    postFx: false,
    antialias: true,
  },
  high: {
    pixelRatioScale: 1,
    maxPixelRatio: 2,
    shadows: true,
    shadowMapSize: 4096,
    shadowExtent: 120,
    nearRadius: 820,
    fogFar: 7500,
    grassDensity: 1,
    treeDensity: 1,
    particleScale: 1,
    postFx: true,
    antialias: true,
  },
};
