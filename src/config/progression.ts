import type { MapId } from './maps';
import type { OutfitId } from './riders';
import type { VehicleId } from './vehicles';

/**
 * Progression: every unlock rule lives here (vehicles, outfits, goggles), plus the customization
 * palettes, hidden collectibles and in-run vehicle stations.
 */

/** What the rules can look at (a view of the save's progress). */
export interface ProgressView {
  finishes: Partial<Record<MapId, number>>;
  bestTimes: Partial<Record<MapId, { time: number }>>;
  totalDistance: number;
  totalTrickScore: number;
  collectibles: string[];
}

export interface UnlockRule {
  /** Shown on locked items and in the unlock pop-up. */
  how: string;
  test: (p: ProgressView) => boolean;
}

const finished = (m: MapId) => (p: ProgressView) => (p.finishes[m] ?? 0) > 0;
const collected = (n: number) => (p: ProgressView) => p.collectibles.length >= n;

/** Vehicles: the bicycle is always yours; everything else unlocks by milestones. */
export const VEHICLE_UNLOCKS: Partial<Record<VehicleId, UnlockRule>> = {
  mountainBike: { how: 'Finish Snow Peak', test: finished('snowPeak') },
  snowboard: { how: 'Finish Snow Peak', test: finished('snowPeak') },
  skis: { how: 'Finish Snow Peak', test: finished('snowPeak') },
  motorbike: { how: 'Ride 40 km in total', test: (p) => p.totalDistance >= 40000 },
  car: { how: 'Score 25,000 trick points in total', test: (p) => p.totalTrickScore >= 25000 },
  roadster: { how: 'Finish Snow Peak in under 12:00', test: (p) => (p.bestTimes.snowPeak?.time ?? Infinity) < 720 },
  flyingCar: { how: 'Finish both mountains', test: (p) => finished('snowPeak')(p) && finished('greenRidge')(p) },
};

/** Outfits (each part: helmet/head, top, pants, shoes) that start locked. */
export const OUTFIT_UNLOCKS: Partial<Record<OutfitId, UnlockRule>> = {
  Swat: { how: 'Finish any run', test: (p) => Object.values(p.finishes).some((n) => (n ?? 0) > 0) },
  Worker: { how: 'Finish Green Ridge', test: finished('greenRidge') },
  Punk: { how: 'Score 15,000 trick points in total', test: (p) => p.totalTrickScore >= 15000 },
  Suit: { how: 'Find 4 hidden tokens', test: collected(4) },
  King: { how: 'Find all 10 hidden tokens', test: collected(10) },
};

export type GogglesStyle = 'none' | 'goggles' | 'shades';
export const GOGGLES: { id: GogglesStyle; label: string; unlock?: UnlockRule }[] = [
  { id: 'none', label: 'None' },
  { id: 'goggles', label: 'Ski goggles' },
  { id: 'shades', label: 'Shades', unlock: { how: 'Find 2 hidden tokens', test: collected(2) } },
];

export type BodyType = 'slim' | 'regular' | 'strong';
export const BODY_TYPES: { id: BodyType; label: string; width: number }[] = [
  { id: 'slim', label: 'Slim', width: 0.9 },
  { id: 'regular', label: 'Regular', width: 1 },
  { id: 'strong', label: 'Strong', width: 1.12 },
];

/** Skin tones: base and the pack's darker shade for each. */
export const SKIN_TONES: [string, string][] = [
  ['#f3d2b8', '#e2b99c'],
  ['#e8b98f', '#d4a074'],
  ['#c98e62', '#b37a50'],
  ['#9c6a45', '#875a39'],
  ['#6e4a30', '#5d3e28'],
  ['#4a3221', '#3d291b'],
];

/** Swatches offered for every colour slot (a custom picker is there too). */
export const PALETTE = [
  '#ff5a1f', '#ff4d6d', '#ffd23f', '#4ade80', '#3ec8ff', '#2f6bff', '#b06cff', '#f4f8ff',
  '#9aa3ad', '#3a3f47', '#1b1f26', '#7a4a2c', '#2f5a45', '#c9a24a',
];

/** Hidden tokens: this many per map, well off the trail, found by exploring. */
export const COLLECTIBLES = {
  perMap: 5,
  /** Off the line this far (m), clear of the start and finish. */
  offMin: 22,
  offMax: 40,
  radius: 3,
};

/** In-run vehicle stations: drive through one to borrow a vehicle you haven't unlocked, for this run. */
export const STATIONS = {
  /** Where along the course (fraction of its length). */
  at: [0.22, 0.48, 0.74],
  radius: 7,
};
