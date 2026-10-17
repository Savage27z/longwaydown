import type { VehicleId } from './vehicles';

/**
 * How the rider's body moves on each vehicle. The body is a damped spring hanging between the
 * hands and feet: accelerations (landings, braking, corners, bumps, weightlessness) push it
 * around, the limbs absorb it through IK, and air phases (pop, tuck, reach, absorb) play on top.
 * Offsets are in the vehicle frame: x = left, y = up, z = forward.
 */
export interface BodyMotion {
  /** Body spring frequency (Hz) and damping ratio. */
  freq: number;
  damping: number;
  /** How hard accelerations shove the body (lateral, vertical, fore/aft). */
  gain: [number, number, number];
  /** Offset limits (m). */
  maxLat: number;
  maxDown: number;
  maxUp: number;
  maxFore: number;
  /** Share of the offset that moves the hips (standing ≈ 1, seated ≈ 0.2); the rest becomes torso sway. */
  hipsShare: number;
  /** Torso pitch / roll (rad) per metre of body offset. */
  torsoPitch: number;
  torsoRoll: number;
  /** Fraction of the vehicle's pitch/roll the head cancels to keep the eyes level. */
  headLevel: number;
  /** Head turns into corners (rad per rad/s of yaw rate). */
  headTurn: number;
  /** Air: tuck (hips toward the feet, m), reach for the landing (m) and arm lift (rad, free arms). */
  airTuck: number;
  airReach: number;
  /** Air: hips shift back (m) to pull the bike up under the body. */
  airBack: number;
  airArms: number;
  /** Takeoff pop: upward body speed (m/s). */
  pop: number;
  /** Rough-ground vibration (m/s² at full roughness and speed). */
  buzz: number;
  /** Torso throw into air pitch / spin input (rad). */
  airThrow: number;
  /** Extra crouch and forward lean at speed (m at full speed). */
  speedCrouch: number;
}

const bike: BodyMotion = {
  freq: 2.1,
  damping: 0.42,
  gain: [0.5, 0.7, 0.6],
  maxLat: 0.09,
  maxDown: 0.26,
  maxUp: 0.09,
  maxFore: 0.13,
  hipsShare: 0.85,
  torsoPitch: 1.6,
  torsoRoll: 1.4,
  headLevel: 0.55,
  headTurn: 0.22,
  airTuck: 0.11,
  airReach: 0.1,
  airBack: 0.13,
  airArms: 0,
  pop: 1.0,
  buzz: 70,
  airThrow: 0.4,
  speedCrouch: 0.05,
};

const seated: BodyMotion = {
  ...bike,
  freq: 1.5,
  damping: 0.38,
  gain: [0.55, 0.4, 0.55],
  maxLat: 0.13,
  maxDown: 0.06,
  maxUp: 0.07,
  maxFore: 0.13,
  hipsShare: 0.18,
  torsoPitch: 2.6,
  torsoRoll: 2.6,
  headLevel: 0.35,
  headTurn: 0.3,
  airTuck: 0,
  airReach: 0,
  airBack: 0,
  pop: 0.35,
  buzz: 90,
  airThrow: 0.15,
  speedCrouch: 0,
};

const snow: BodyMotion = {
  ...bike,
  freq: 1.9,
  damping: 0.4,
  gain: [0.55, 0.6, 0.55],
  maxLat: 0.1,
  maxDown: 0.26,
  maxUp: 0.08,
  maxFore: 0.12,
  hipsShare: 1,
  torsoPitch: 1.3,
  torsoRoll: 1.3,
  headLevel: 0.6,
  headTurn: 0.35,
  airTuck: 0.24,
  airReach: 0.08,
  airBack: 0,
  airArms: 0.8,
  pop: 1.1,
  buzz: 40,
  airThrow: 0.55,
  speedCrouch: 0.07,
};

export const BODY_MOTION: Record<VehicleId, BodyMotion> = {
  bicycle: bike,
  mountainBike: { ...bike, maxDown: 0.25, buzz: 60 },
  motorbike: { ...bike, gain: [0.5, 0.75, 0.7], maxDown: 0.28, maxFore: 0.16, airTuck: 0.1, airBack: 0.15, buzz: 80, pop: 1.1 },
  car: seated,
  flyingCar: { ...seated, buzz: 10, freq: 1.2 },
  snowboard: snow,
  onFoot: { ...bike, gain: [0.3, 0.4, 0.3], maxDown: 0.12, hipsShare: 1, airTuck: 0.08, airReach: 0.06, airBack: 0, airArms: 0.4, pop: 0.6, buzz: 10, speedCrouch: 0 },
  wingsuit: { ...seated, hipsShare: 0.3, torsoPitch: 1, torsoRoll: 1.4, headLevel: 0.2, headTurn: 0.25, buzz: 4, airThrow: 0.2, airArms: 0 },
  skis: { ...snow, airTuck: 0.24, airArms: 0.55, headTurn: 0.25 },
};

/** Vehicle switch: the rider hops off one vehicle and drops onto the next. */
export const SWITCH_HOP = {
  duration: 0.42,
  height: 0.55,
};
