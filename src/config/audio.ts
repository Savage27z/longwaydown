import type { SurfaceId } from './surfaces';
import type { VehicleId } from './vehicles';

/**
 * Procedural audio tuning (Web Audio, no files needed). Drop a track URL into `music` to loop
 * it on the music bus (e.g. '/audio/theme.mp3' in /public).
 */
export const AUDIO = {
  music: '' as string,
  /** Overall loudness of the continuous layers before the sfx volume. */
  wind: { minSpeed: 3, fullSpeed: 40, gain: 0.32, airBoost: 1.5 },
  roll: { fullSpeed: 25, gain: 0.26 },
  engine: { gain: 0.16 },
  /** Seconds the continuous layers take to follow the ride (smoothing). */
  smooth: 0.08,
};

/** How each surface sounds under wheels / boards: a filtered noise band. */
export const SURFACE_SOUND: Record<SurfaceId, { type: BiquadFilterType; freq: number; q: number; gain: number; grain: number }> = {
  powder: { type: 'lowpass', freq: 900, q: 0.7, gain: 0.8, grain: 0.15 },
  packed: { type: 'bandpass', freq: 1600, q: 0.9, gain: 0.75, grain: 0.35 },
  trail: { type: 'bandpass', freq: 1300, q: 0.8, gain: 0.7, grain: 0.3 },
  ice: { type: 'highpass', freq: 3200, q: 0.6, gain: 0.55, grain: 0.05 },
  rock: { type: 'bandpass', freq: 2200, q: 1.4, gain: 0.8, grain: 0.7 },
  grass: { type: 'lowpass', freq: 1100, q: 0.6, gain: 0.55, grain: 0.2 },
  dirt: { type: 'bandpass', freq: 700, q: 0.8, gain: 0.8, grain: 0.4 },
  mud: { type: 'lowpass', freq: 420, q: 1.2, gain: 0.9, grain: 0.5 },
  gravel: { type: 'highpass', freq: 2400, q: 0.7, gain: 0.9, grain: 0.9 },
  water: { type: 'bandpass', freq: 500, q: 0.5, gain: 1.1, grain: 0.6 },
};

/**
 * Engines: `base`/`top` = frequency (Hz) at rest and at top speed, `gears` sawtooth shifts,
 * `wave` the main oscillator. Vehicles not listed have no engine (bikes, boards, wingsuit).
 */
export const ENGINE_SOUND: Partial<Record<VehicleId, { base: number; top: number; topSpeed: number; gears: number; wave: OscillatorType; filter: number; gain: number }>> = {
  motorbike: { base: 70, top: 260, topSpeed: 38, gears: 5, wave: 'sawtooth', filter: 1400, gain: 1 },
  car: { base: 48, top: 170, topSpeed: 34, gears: 4, wave: 'sawtooth', filter: 900, gain: 1.1 },
  roadster: { base: 220, top: 900, topSpeed: 45, gears: 1, wave: 'sine', filter: 3000, gain: 0.55 },
  flyingCar: { base: 95, top: 240, topSpeed: 40, gears: 1, wave: 'triangle', filter: 1800, gain: 0.8 },
};
