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
  topSpeed: 27,
  accel: 5.5,
  propulsionMaxSpeed: 10,
  brake: 9,
  aero: 0.0032,
  tuckAero: 0.78,
  grip: 1.5,
  skidDrag: 1.6,
  turnRateLow: 2.6,
  turnRateHigh: 1.05,
  turnSpeedRef: 24,
  airPitchRate: 5.2,
  airSpinRate: 6.0,
  airSteer: 0.9,
  jumpSpeed: 4.6,
  gravityScale: 1.25,
  boostAccel: 9,
  boostTopSpeed: 36,
  rideHeight: 0.62,
  travel: 0.38,
  spring: 140,
  damping: 13,
  colliderRadius: 0.38,
  wheelbase: 1.1,
  crashImpact: 19,
  crashAngleDeg: 58,
  crashDecel: 15,
  surface: {
    // Studded snow tyres: snow is slower than packed, but not hopeless.
    powder: { rolling: 0.55, drag: 0.5, grip: 1.0 },
    ice: { grip: 1.4 },
    water: { drag: 0.9 },
  },
};

export const VEHICLES: Record<VehicleId, VehicleStats> = {
  bicycle: { ...base, name: 'Bicycle', surface: { ...base.surface } },
  mountainBike: {
    ...base,
    name: 'Mountain Bike',
    topSpeed: 30,
    accel: 6.2,
    propulsionMaxSpeed: 11,
    grip: 1.65,
    travel: 0.5,
    spring: 110,
    damping: 11,
    crashImpact: 23,
    surface: { ...base.surface, rock: { rolling: 0.5, grip: 1.15 }, gravel: { rolling: 0.6, grip: 1.15 } },
  },
  motorbike: { ...base, name: 'Motorbike', mass: 200, topSpeed: 38, accel: 11, propulsionMaxSpeed: 34, brake: 12, grip: 1.55, jumpSpeed: 5.5, crashImpact: 22, surface: { ...base.surface, dirt: { grip: 1.15 }, mud: { grip: 1.2, drag: 0.7 } } },
  car: { ...base, name: 'Buggy', mass: 900, topSpeed: 42, accel: 9, propulsionMaxSpeed: 40, brake: 12, grip: 1.3, jumpSpeed: 0, crashImpact: 30, surface: {} },
  flyingCar: { ...base, name: 'Hover Car', mass: 700, topSpeed: 44, accel: 10, propulsionMaxSpeed: 42, grip: 1.2, jumpSpeed: 7, crashImpact: 30, surface: {} },
  jet: { ...base, name: 'Jet', mass: 300, topSpeed: 75, accel: 18, propulsionMaxSpeed: 75, crashImpact: 26, surface: {} },
  snowboard: { ...base, name: 'Snowboard', topSpeed: 30, accel: 1.5, propulsionMaxSpeed: 3, grip: 1.4, jumpSpeed: 5, snowOnly: true, surface: {} },
  skis: { ...base, name: 'Skis', topSpeed: 33, accel: 1.8, propulsionMaxSpeed: 3.5, grip: 1.55, jumpSpeed: 4.6, snowOnly: true, surface: {} },
};

/** Gameplay-wide tunables for riding. */
export const RIDING = {
  /** Seconds after a jump during which springs are ignored (lets the hop leave the ground). */
  jumpGrace: 0.18,
  /** Air-to-ground normal blending (1/s). */
  normalSmoothing: 18,
  /** Distance to ground below which the rider pre-aligns to the landing slope (m). */
  landingAlignDistance: 6,
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
