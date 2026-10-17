import type { SurfaceId } from './surfaces';

export type VehicleId = 'bicycle' | 'mountainBike' | 'motorbike' | 'car' | 'flyingCar' | 'jet' | 'snowboard' | 'skis';
export const VEHICLE_IDS: VehicleId[] = ['bicycle', 'mountainBike', 'motorbike', 'car', 'flyingCar', 'jet', 'snowboard', 'skis'];

export interface SurfaceMod {
  grip?: number;
  rolling?: number;
  drag?: number;
}

/**
 * Arcade vehicle tuning. Units: metres, seconds, m/s, m/s^2. Every value is live-tunable in the
 * dev panel (objects are read each physics step, never cached).
 */
export interface VehicleStats {
  name: string;
  /** Mass used for collisions (kg). Handling below is mass-independent. */
  mass: number;
  /** Soft top speed: extra drag above this (m/s). */
  topSpeed: number;
  /** Propulsion acceleration at standstill (m/s^2). */
  accel: number;
  /** Propulsion fades out toward this speed (pedalling spins out; engines have a higher limit). */
  propulsionMaxSpeed: number;
  brake: number;
  /** Quadratic air drag coefficient (1/m). */
  aero: number;
  /** Aero multiplier while tucking (holding accelerate above propulsion speed). */
  tuckAero: number;
  /** Lateral grip as a multiple of g. */
  grip: number;
  /** Speed lost per second while sliding sideways (fraction at 90 deg slip). */
  skidDrag: number;
  /** Yaw rate at low / high speed (rad/s) and the speed where it reaches the high value. */
  turnRateLow: number;
  turnRateHigh: number;
  turnSpeedRef: number;
  /** Air rotation rates (rad/s) for flips / spins, and air steering. */
  airPitchRate: number;
  airSpinRate: number;
  airSteer: number;
  /** Jump / hop vertical speed (m/s). */
  jumpSpeed: number;
  gravityScale: number;
  boostAccel: number;
  boostTopSpeed: number;
  /** Suspension. */
  rideHeight: number;
  travel: number;
  spring: number;
  damping: number;
  colliderRadius: number;
  wheelbase: number;
  /** Crash thresholds. */
  crashImpact: number;
  crashAngleDeg: number;
  crashDecel: number;
  /** Per-surface multipliers on top of the baseline surface physics. */
  surface: Partial<Record<SurfaceId, SurfaceMod>>;
  /** Only works on snow (boards / skis). */
  snowOnly?: boolean;
}

const base: Omit<VehicleStats, 'name'> = {
  mass: 90,
  // Arcade-fast: ~125 km/h coasting on a typical slope, ~137 km/h soft cap, more with boost.
  topSpeed: 38,
  // Pedalling adds speed all the way up (diminishing), ~83 km/h on the flat.
  accel: 6,
  propulsionMaxSpeed: 24,
  brake: 11,
  aero: 0.0019,
  tuckAero: 0.7,
  grip: 2.1,
  skidDrag: 1.4,
  turnRateLow: 2.8,
  turnRateHigh: 1.35,
  turnSpeedRef: 30,
  airPitchRate: 5.6,
  airSpinRate: 6.2,
  airSteer: 1.0,
  jumpSpeed: 5.4,
  gravityScale: 1.5,
  boostAccel: 12,
  boostTopSpeed: 48,
  rideHeight: 0.62,
  travel: 0.4,
  spring: 150,
  damping: 14,
  colliderRadius: 0.38,
  wheelbase: 1.1,
  crashImpact: 26,
  crashAngleDeg: 68,
  crashDecel: 20,
  surface: {
    // Studded snow tyres: snow is slower than packed, but not hopeless.
    powder: { rolling: 0.4, drag: 0.35, grip: 1.0 },
    ice: { grip: 1.35 },
    water: { drag: 0.9 },
  },
};

export const VEHICLES: Record<VehicleId, VehicleStats> = {
  bicycle: { ...base, name: 'Bicycle', surface: { ...base.surface } },
  mountainBike: {
    ...base,
    name: 'Mountain Bike',
    topSpeed: 41,
    accel: 6.6,
    propulsionMaxSpeed: 26,
    grip: 2.3,
    travel: 0.52,
    spring: 120,
    damping: 12,
    crashImpact: 30,
    surface: { ...base.surface, rock: { rolling: 0.5, grip: 1.15 }, gravel: { rolling: 0.6, grip: 1.15 } },
  },
  motorbike: {
    ...base,
    name: 'Motorbike',
    mass: 180,
    topSpeed: 44,
    accel: 12,
    propulsionMaxSpeed: 42,
    brake: 13,
    aero: 0.0016,
    grip: 2.2,
    turnRateLow: 2.4,
    turnRateHigh: 1.2,
    turnSpeedRef: 34,
    airPitchRate: 4.5,
    airSpinRate: 4.5,
    jumpSpeed: 5.4,
    boostAccel: 14,
    boostTopSpeed: 52,
    rideHeight: 0.72,
    travel: 0.5,
    spring: 130,
    damping: 12,
    colliderRadius: 0.45,
    wheelbase: 1.45,
    crashImpact: 28,
    crashAngleDeg: 65,
    crashDecel: 24,
    surface: { powder: { rolling: 0.7, drag: 0.6 }, dirt: { grip: 1.2 }, mud: { grip: 1.1, drag: 0.6 }, ice: { grip: 1.2 }, water: { drag: 0.8 } },
  },
  car: {
    ...base,
    name: 'Buggy',
    mass: 950,
    topSpeed: 46,
    accel: 11,
    propulsionMaxSpeed: 46,
    brake: 14,
    aero: 0.0012,
    grip: 2,
    jumpSpeed: 0,
    boostAccel: 12,
    boostTopSpeed: 54,
    /** Chassis centre above the ground at rest. */
    rideHeight: 0.85,
    crashImpact: 34,
    crashAngleDeg: 80,
    crashDecel: 30,
    surface: {},
  },
  flyingCar: {
    ...base,
    name: 'Hover Car',
    mass: 800,
    topSpeed: 48,
    accel: 11,
    propulsionMaxSpeed: 45,
    brake: 12,
    aero: 0.0014,
    grip: 1.8,
    skidDrag: 1.0,
    turnRateLow: 2.2,
    turnRateHigh: 1.1,
    airSteer: 1.4,
    airPitchRate: 1.5,
    airSpinRate: 1.5,
    jumpSpeed: 6.5,
    boostAccel: 12,
    boostTopSpeed: 56,
    rideHeight: 0.95,
    travel: 0.5,
    spring: 120,
    damping: 14,
    colliderRadius: 0.75,
    wheelbase: 2.2,
    crashImpact: 32,
    crashAngleDeg: 70,
    crashDecel: 28,
    surface: { powder: { rolling: 0.2, drag: 0.1 }, water: { drag: 0.1, rolling: 0.2 }, mud: { drag: 0.2 } },
  },
  jet: {
    ...base,
    name: 'Jet',
    mass: 140,
    topSpeed: 58,
    accel: 3,
    propulsionMaxSpeed: 8,
    brake: 6,
    aero: 0.0011,
    grip: 0.8,
    skidDrag: 0.8,
    turnRateLow: 1.6,
    turnRateHigh: 0.7,
    airSteer: 1.1,
    airPitchRate: 1.6,
    airSpinRate: 1.6,
    jumpSpeed: 8,
    boostAccel: 10,
    boostTopSpeed: 66,
    rideHeight: 0.55,
    travel: 0.3,
    colliderRadius: 0.5,
    wheelbase: 1.0,
    crashImpact: 22,
    crashAngleDeg: 70,
    crashDecel: 22,
    surface: { powder: { rolling: 2 }, packed: { rolling: 2 }, grass: { rolling: 1.5 } },
  },
  snowboard: {
    ...base,
    name: 'Snowboard',
    topSpeed: 36,
    accel: 1.5,
    propulsionMaxSpeed: 3,
    aero: 0.0019,
    tuckAero: 0.8,
    grip: 2.0,
    skidDrag: 2.2,
    turnRateLow: 2.6,
    turnRateHigh: 1.45,
    airPitchRate: 6,
    airSpinRate: 7.5,
    jumpSpeed: 5.4,
    rideHeight: 0.38,
    travel: 0.25,
    colliderRadius: 0.32,
    wheelbase: 1.1,
    crashAngleDeg: 66,
    snowOnly: true,
    surface: { powder: { rolling: 0.15, drag: 0.12, grip: 1.15 }, packed: { rolling: 0.1 }, ice: { grip: 0.6 } },
  },
  skis: {
    ...base,
    name: 'Skis',
    topSpeed: 40,
    accel: 2,
    propulsionMaxSpeed: 4,
    aero: 0.0016,
    tuckAero: 0.6,
    grip: 2.3,
    skidDrag: 2.0,
    turnRateLow: 2.4,
    turnRateHigh: 1.5,
    airPitchRate: 5,
    airSpinRate: 6.2,
    jumpSpeed: 4.8,
    rideHeight: 0.36,
    travel: 0.25,
    colliderRadius: 0.32,
    wheelbase: 1.4,
    snowOnly: true,
    surface: { powder: { rolling: 0.2, drag: 0.18 }, packed: { rolling: 0.08 }, ice: { grip: 0.7 } },
  },
};

/** Gameplay-wide tunables for riding. */
export const RIDING = {
  /** Seconds after a jump during which springs are ignored (lets the hop leave the ground). */
  jumpGrace: 0.18,
  /** Jump input buffer before touching ground / coyote time after leaving a lip (s). */
  jumpBuffer: 0.2,
  coyoteTime: 0.16,
  /** Steering input ramp (per second) for keyboard-friendly smoothing. */
  steerRise: 7,
  steerFall: 11,
  /** Landing assist strength near the ground (1/s). */
  landingAssist: 5.5,
  /** Air-to-ground normal blending (1/s). */
  normalSmoothing: 18,
  /** Distance to ground below which the rider pre-aligns to the landing slope (m). */
  landingAlignDistance: 10,
  /** Respawn speed after crashes / resets (m/s). */
  respawnSpeed: 8,
  crashDuration: 2.1,
  crashPenalty: 3,
  /** Off-course / stuck auto reset. */
  outOfBoundsDistance: 450,
  fallBelowCourse: 60,
  stuckSpeed: 0.8,
  stuckTime: 6,
};

/** Arcade flight tuning for the hover car and the jet. */
export interface FlightStats {
  /** Thrust acceleration (m/s^2) and the speed it fades out toward. */
  thrust: number;
  maxSpeed: number;
  /** Below this speed lift fades (stall). */
  stallSpeed: number;
  /** Fraction of gravity cancelled by lift at full speed. */
  lift: number;
  /** How fast velocity turns toward the nose (1/s). */
  align: number;
  pitchRate: number;
  yawRate: number;
  bankMax: number;
  /** Gravity scale while flying. */
  gravity: number;
  /** Meter drain while thrusting / recharge on the ground (per second, 0..1). */
  drain: number;
  groundRecharge: number;
  /** Recharge while gliding (not thrusting) this close to the terrain (m). 0 = never. */
  lowGlideRecharge: number;
  lowGlideHeight: number;
  /** Soft altitude ceiling above the terrain (m). */
  ceiling: number;
}

export const FLIGHT: Record<'flyingCar' | 'jet', FlightStats> = {
  flyingCar: { thrust: 12, maxSpeed: 50, stallSpeed: 12, lift: 0.85, align: 2.4, pitchRate: 1.3, yawRate: 1.1, bankMax: 0.55, gravity: 0.6, drain: 1 / 9, groundRecharge: 1 / 5, lowGlideRecharge: 0, lowGlideHeight: 0, ceiling: 110 },
  // Fast, but fuel only comes back while gliding low: overusing it loses time to clean riding.
  jet: { thrust: 18, maxSpeed: 58, stallSpeed: 18, lift: 0.95, align: 2.0, pitchRate: 1.5, yawRate: 1.0, bankMax: 0.9, gravity: 0.8, drain: 1 / 20, groundRecharge: 1 / 4, lowGlideRecharge: 1 / 6, lowGlideHeight: 15, ceiling: 150 },
};
