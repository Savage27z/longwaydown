import type { BiomeId } from './maps';
import type { VehicleId } from './vehicles';

/** Races against bots: grid, ghost streaming, pace and rubber-banding. */
export const RACE = {
  /** Bots on the grid with the player (8 riders in total). */
  bots: 7,
  /** Start grid: riders per row, spacing across a row and between rows (m). */
  gridPerRow: 4,
  gridSpacing: 3.4,
  gridRowGap: 4.5,
  /** The local player's grid slot (front row, middle). */
  playerSlot: 1,
  /** Bots without a terrain collider under them (or this far ahead, m) go ghost: they coast along the line. */
  ghostProbeAhead: 25,
  /** A ghost stays a ghost at least this long (s) before colliders can take it back. */
  ghostHold: 3,
  /** Pace (progress along the course) learning rate while physical (1/s). */
  paceRate: 0.25,
  /**
   * Typical progress along the course with boost (km/h), measured from bot races on both maps:
   * the pace a bot uses before it has learned its own, and the band its ghost pace stays within.
   */
  nominalPace: {
    bicycle: 128,
    mountainBike: 140,
    motorbike: 155,
    car: 158,
    roadster: 162,
    flyingCar: 145,
    snowboard: 140,
    skis: 140,
    wingsuit: 110,
    onFoot: 20,
  } as Record<VehicleId, number>,
  /** Ghost pace stays within this band around the nominal pace. */
  ghostPaceBand: [0.88, 1.1] as [number, number],
  /** Rubber band: up to ±push on pace / boost use when a bot is `bandDistance` m ahead of or behind the player. */
  bandDistance: 450,
  bandPush: 0.07,
  /** Bots beyond this distance from the camera skip the character pose (m) and beyond the second aren't drawn. */
  detailRange: 260,
  drawRange: 1600,
  /** Name tags over riders within this distance (m). */
  nameTagRange: 160,
};

export const BOT_NAMES = ['Mila', 'Kai', 'Noor', 'Ravi', 'Jun', 'Ines', 'Theo', 'Sami', 'Lena', 'Omar', 'Yuki', 'Bea', 'Arlo', 'Zara'];

/** Paint pairs (primary, secondary) per bot. */
export const BOT_PAINTS: [string, string][] = [
  ['#ff4d6d', '#1b2b40'],
  ['#3ec8ff', '#ffd23f'],
  ['#4ade80', '#20262e'],
  ['#ffd23f', '#1b2b40'],
  ['#b06cff', '#f4f8ff'],
  ['#ff8a3d', '#20262e'],
  ['#f4f8ff', '#ff4d6d'],
];

/** Each bot's ground vehicle (what its wingsuit lands on), by map biome. */
export const BOT_VEHICLES: Record<BiomeId, VehicleId[]> = {
  alpine: ['mountainBike', 'motorbike', 'mountainBike', 'bicycle', 'car', 'mountainBike', 'motorbike'],
  snow: ['snowboard', 'skis', 'snowboard', 'mountainBike', 'skis', 'motorbike', 'snowboard'],
};

/** Skill spread: bot k gets level BOT_LEVELS[k] (1 = clean lines, lots of boost). */
export const BOT_LEVELS = [0.98, 0.93, 0.9, 0.86, 0.82, 0.78, 0.74];
