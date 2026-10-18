/** Phase 6: boost meter, trick scoring, near-misses, pickups and buffs. */

export const BOOST = {
  /** Meter at the start of a run (0..1). */
  start: 0.5,
  /** Drain while boosting (per second). */
  drain: 0.22,
  /** Always trickling back (per second), plus extra while fast and not boosting. */
  passive: 0.012,
  speedGain: 0.025,
  speedFrom: 28,
  /** Per second of air time on landing. */
  perAirSecond: 0.06,
  /** Per trick point (a 1000-point trick fills 0.25), capped per landing. */
  perPoint: 0.00025,
  perLandingMax: 0.4,
  nearMiss: 0.07,
};

export const TRICKS = {
  /** Air shorter than this is a hop, not a trick (s). */
  minAir: 0.6,
  airPerSecond: 100,
  flip: 500,
  /** Per half spin (180°). */
  halfSpin: 150,
  /** A held grab longer than this counts (s). */
  grabMin: 0.3,
  grab: 200,
  grabPerSecond: 200,
  switchLanding: 100,
  bigAirHeight: 8,
  bigAir: 150,
  /** Combo: next landing within this many seconds keeps the chain; multiplier caps at maxMult. */
  comboWindow: 4,
  maxMult: 5,
  nearMissPoints: 50,
};

export const NEAR_MISS = {
  /** Passing this close (m, beyond the obstacle's radius) without touching it, at speed. */
  margin: 3,
  minSpeed: 14,
  cooldown: 0.8,
};

export type PickupKind = 'boost' | 'freeze' | 'grip' | 'speed' | 'lowGravity' | 'shield';

/** Pickups along the trail and the buffs they give. */
export const PICKUPS = {
  spacing: 320,
  /** Skip the start run-up and the finish straight (m). */
  firstS: 400,
  endGap: 250,
  /** Keep clear of jump lips (m along the course). */
  featureClear: 35,
  radius: 2.6,
  /** Kinds and their weights. */
  weights: { boost: 5, freeze: 1, grip: 1.5, speed: 1.5, lowGravity: 1, shield: 1 } as Record<PickupKind, number>,
  boostFill: 0.5,
  freezeSeconds: 4,
  /** Buff durations (s) and strengths. */
  grip: 8,
  speed: 6,
  speedMul: 1.15,
  lowGravity: 8,
  gravityMul: 0.72,
  shield: 25,
  /** Drawn within this distance of the camera (m). */
  drawRange: 700,
};

export const PICKUP_STYLE: Record<PickupKind, { color: string; label: string; glyph: string }> = {
  boost: { color: '#3ec8ff', label: 'Boost', glyph: '⚡' },
  freeze: { color: '#b9e8ff', label: 'Time Freeze', glyph: '❄' },
  grip: { color: '#4ade80', label: 'Grip', glyph: '◆' },
  speed: { color: '#ff5a1f', label: 'Speed', glyph: '»' },
  lowGravity: { color: '#b06cff', label: 'Low Gravity', glyph: '☾' },
  shield: { color: '#ffd23f', label: 'Shield', glyph: '⛨' },
};
