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
  /** Ghost pace stays within this band around the nominal pace (before skill and slips). */
  ghostPaceBand: [0.8, 1.0] as [number, number],
  /** Rubber band at `bandDistance` m from the player: ease off by up to `bandEase` when ahead, push by up to `bandPush` when behind. */
  bandDistance: 350,
  bandEase: 0.14,
  bandPush: 0.08,
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

/** Each bot's starting ground vehicle (what its wingsuit lands on), by map biome. */
export const BOT_VEHICLES: Record<BiomeId, VehicleId[]> = {
  alpine: ['mountainBike', 'motorbike', 'mountainBike', 'bicycle', 'car', 'mountainBike', 'motorbike'],
  snow: ['snowboard', 'skis', 'snowboard', 'mountainBike', 'skis', 'motorbike', 'snowboard'],
};

/** Skill spread: bot k gets level BOT_LEVELS[k] (1 would be flawless; nobody is). */
export const BOT_LEVELS = [0.9, 0.84, 0.78, 0.72, 0.66, 0.6, 0.54];

/** How human the bots ride: mistake rates, missed lips, fumbled airs, boost use. */
export const BOT_MISTAKES = {
  /** Slips per second (wide line, lift, nervous brake, wobble): base + (1 - level) * skillRate. */
  baseRate: 0.03,
  skillRate: 0.09,
  /** Chance per jump of misjudging the lip and not popping it (scaled by 1.3 - level). */
  missLipChance: 0.35,
  /** Chance per take-off of fumbling the air, which often ends in a crash (scaled by 1.2 - level). */
  fumbleChance: 0.1,
  /** Share of straights boosted: base + level * skill (capped at 0.9). */
  boostBase: 0.15,
  boostSkill: 0.45,
  /** Ghosts lose time the same way: slow-downs (factor, seconds) and crashes (seconds stopped). */
  ghostSlowFactor: 0.45,
  ghostSlowTime: [1.5, 3.5] as [number, number],
  ghostCrashRate: 0.006,
  ghostCrashTime: 6,
};

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

/**
 * Bot difficulty. `level` shifts every bot's skill; `mistakes` scales how often they slip,
 * miss lips and fumble airs; `boost` scales how often they boost; `pace` scales ghost pace;
 * `ease` is how hard they back off when ahead of the player.
 */
export const DIFFICULTY: Record<Difficulty, { label: string; level: number; mistakes: number; boost: number; pace: number; ease: number }> = {
  easy: { label: 'Easy', level: -0.2, mistakes: 1.7, boost: 0.45, pace: 0.86, ease: 0.25 },
  normal: { label: 'Normal', level: 0, mistakes: 1, boost: 1, pace: 1, ease: 0.14 },
  hard: { label: 'Hard', level: 0.1, mistakes: 0.55, boost: 1.4, pace: 1.05, ease: 0.07 },
};

/** Ground vehicles each bot may switch between (its first is the one it starts on), by biome. */
export const BOT_GARAGES: Record<BiomeId, VehicleId[][]> = {
  alpine: [
    ['mountainBike', 'motorbike'],
    ['motorbike', 'car', 'mountainBike'],
    ['mountainBike', 'bicycle'],
    ['bicycle', 'mountainBike', 'roadster'],
    ['car', 'motorbike'],
    ['mountainBike', 'car'],
    ['motorbike', 'mountainBike', 'bicycle'],
  ],
  snow: [
    ['snowboard', 'skis', 'motorbike'],
    ['skis', 'snowboard'],
    ['snowboard', 'mountainBike'],
    ['mountainBike', 'skis', 'motorbike'],
    ['skis', 'car'],
    ['motorbike', 'snowboard'],
    ['snowboard', 'skis'],
  ],
};

/** When bots change vehicle: chance at each checkpoint, and chance to pull the wingsuit on a big air. */
export const BOT_SWITCH = {
  atCheckpoint: 0.45,
  wingsuitOnAir: 0.35,
  /** Height above the ground (m) an air needs before the wingsuit comes out. */
  wingsuitHeight: 10,
  /** Minimum seconds between a bot's switches. */
  cooldown: 20,
};
