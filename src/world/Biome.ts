import type { BiomeId } from '../config/maps';
import type { SurfaceId } from '../config/surfaces';

/** Visual + ambient definition of a biome. Pure data (also used inside the terrain worker). */
export interface BiomeDef {
  id: BiomeId;
  surfaceColors: Record<SurfaceId, string>;
  /** Steep-rock color and the tint that thin snow / dry grass fades toward at low altitude. */
  lowlandTint: string;
  /**
   * Elevation bands as fractions of the map's descent (0 = summit, 1 = finish), so they follow
   * each map's own summit and drop: lowland colours below lowlandFrac, snow caps above
   * snowlineFrac (-1 = none), trees below treelineFrac.
   */
  lowlandFrac: number;
  snowlineFrac: number;
  forestTint: string;
  treelineFrac: number;
  sky: {
    zenith: string;
    horizon: string;
    sunColor: string;
    sunIntensity: number;
    sunElevationDeg: number;
    sunAzimuthDeg: number;
    hemiSky: string;
    hemiGround: string;
    hemiIntensity: number;
    exposure: number;
    fogNear: number;
  };
  trees: { foliage: string[]; trunk: string; snowTips: boolean; broadleafShare: number };
  rock: string;
  ambientParticles: 'snow' | 'pollen';
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  snow: {
    id: 'snow',
    surfaceColors: {
      powder: '#eef3fa',
      packed: '#d9e3ee',
      ice: '#97c6e6',
      rock: '#7a838f',
      grass: '#8a9a6a',
      dirt: '#8d7a63',
      mud: '#6c5a47',
      gravel: '#9a9690',
      water: '#5b8fb0',
      trail: '#a9bdd4',
    },
    lowlandTint: '#b9c2b0',
    lowlandFrac: 0.8,
    snowlineFrac: -1,
    forestTint: '#33503f',
    treelineFrac: 0.3,
    sky: {
      zenith: '#2a66b3',
      horizon: '#c9def2',
      sunColor: '#ffe6c7',
      sunIntensity: 2.4,
      sunElevationDeg: 26,
      sunAzimuthDeg: 125,
      hemiSky: '#a9c8f0',
      hemiGround: '#46566a',
      hemiIntensity: 1.7,
      exposure: 1.0,
      fogNear: 260,
    },
    trees: { foliage: ['#2f5a45', '#355f49', '#2a5140'], trunk: '#5a4234', snowTips: true, broadleafShare: 0 },
    rock: '#727c88',
    ambientParticles: 'snow',
  },
  alpine: {
    id: 'alpine',
    surfaceColors: {
      powder: '#f4f8fc',
      packed: '#e2e8ee',
      ice: '#b6d9ec',
      rock: '#87857f',
      grass: '#79b153',
      dirt: '#a07a52',
      mud: '#6d5038',
      gravel: '#aba596',
      water: '#4f8db3',
      trail: '#b88a5c',
    },
    lowlandTint: '#8fb85a',
    lowlandFrac: 0.86,
    snowlineFrac: 0.08,
    forestTint: '#2f5a2c',
    treelineFrac: 0.22,
    sky: {
      zenith: '#4a86cf',
      horizon: '#f2dcc0',
      sunColor: '#ffdcae',
      sunIntensity: 2.8,
      sunElevationDeg: 22,
      sunAzimuthDeg: 235,
      hemiSky: '#e8f0ff',
      hemiGround: '#5d6b45',
      hemiIntensity: 1.0,
      exposure: 1.0,
      fogNear: 300,
    },
    trees: { foliage: ['#3d7a35', '#4a8a3a', '#2f6a35', '#567f2e'], trunk: '#5e4330', snowTips: false, broadleafShare: 0.55 },
    rock: '#8a877f',
    ambientParticles: 'pollen',
  },
};

/** Parse '#rrggbb' -> [r, g, b] in 0..1 (sRGB). */
export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
