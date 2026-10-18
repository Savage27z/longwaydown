import type { SurfaceId } from './surfaces';

export type VehicleId = 'bicycle' | 'mountainBike' | 'motorbike' | 'car' | 'roadster' | 'flyingCar' | 'snowboard' | 'skis' | 'wingsuit' | 'onFoot';
/** Everything the vehicle wheel offers, in slot order (on foot is only used for the race start). */
export const VEHICLE_IDS: VehicleId[] = ['bicycle', 'mountainBike', 'motorbike', 'car', 'roadster', 'flyingCar', 'snowboard', 'skis', 'wingsuit'];
/** Ground vehicle used after a wingsuit landing until the rider has picked one themselves. */
export const DEFAULT_GROUND_VEHICLE: VehicleId = 'mountainBike';

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
  // Speed follows the slope: ~80 km/h on gentle trail, ~115 km/h cap on steep runs, ~145 boosting.
  topSpeed: 32,
  // Pedalling adds speed all the way up (diminishing), ~83 km/h on the flat.
  accel: 6,
  propulsionMaxSpeed: 24,
  brake: 11,
  aero: 0.005,
  tuckAero: 0.7,
  grip: 2.5,
  skidDrag: 1.4,
  turnRateLow: 3.2,
  turnRateHigh: 1.65,
  turnSpeedRef: 30,
  airPitchRate: 5.6,
  airSpinRate: 6.2,
  airSteer: 1.0,
  jumpSpeed: 6.2,
  gravityScale: 1.5,
  boostAccel: 12,
  boostTopSpeed: 40,
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
  // The race start: jog along the summit plateau (W sprints) and leap off the edge.
  onFoot: {
    ...base,
    name: 'On Foot',
    mass: 80,
    topSpeed: 10,
    accel: 8,
    propulsionMaxSpeed: 10,
    brake: 14,
    tuckAero: 1,
    grip: 3.5,
    skidDrag: 2,
    turnRateLow: 3.2,
    turnRateHigh: 2.6,
    turnSpeedRef: 10,
    airPitchRate: 0,
    airSpinRate: 0,
    airSteer: 0.6,
    jumpSpeed: 4.5,
    boostAccel: 0,
    boostTopSpeed: 10,
    rideHeight: 0.5,
    travel: 0.25,
    spring: 120,
    damping: 14,
    colliderRadius: 0.3,
    wheelbase: 0.4,
    crashImpact: 22,
    crashAngleDeg: 85,
    crashDecel: 14,
    surface: {},
  },
  // Flies with FLIGHT.wingsuit; aero sets the glide speed (~130 km/h neutral, ~175 diving).
  wingsuit: {
    ...base,
    name: 'Wingsuit',
    mass: 85,
    topSpeed: 70,
    accel: 0,
    propulsionMaxSpeed: 1,
    tuckAero: 1,
    aero: 0.0037,
    grip: 1,
    airPitchRate: 0,
    airSpinRate: 0,
    jumpSpeed: 0,
    gravityScale: 1,
    boostAccel: 0,
    boostTopSpeed: 70,
    rideHeight: 0.4,
    colliderRadius: 0.35,
    wheelbase: 0.6,
    crashImpact: 18,
    crashAngleDeg: 88,
    crashDecel: 24,
    surface: {},
  },
  mountainBike: {
    ...base,
    name: 'Mountain Bike',
    topSpeed: 34,
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
    topSpeed: 38,
    accel: 12,
    propulsionMaxSpeed: 42,
    brake: 13,
    aero: 0.0035,
    grip: 2.6,
    turnRateLow: 2.8,
    turnRateHigh: 1.5,
    turnSpeedRef: 34,
    airPitchRate: 4.5,
    airSpinRate: 4.5,
    jumpSpeed: 5.4,
    boostAccel: 14,
    boostTopSpeed: 45,
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
    topSpeed: 40,
    accel: 11,
    propulsionMaxSpeed: 46,
    brake: 15,
    aero: 0.003,
    tuckAero: 1,
    // Tyres bite harder than bike wheels; the handbrake cuts this for drifts.
    grip: 2.7,
    skidDrag: 0.9,
    turnRateLow: 2.5,
    turnRateHigh: 1.2,
    turnSpeedRef: 32,
    airPitchRate: 2.6,
    airSpinRate: 2.8,
    airSteer: 0.4,
    // Space is the handbrake, not a hop.
    jumpSpeed: 0,
    boostAccel: 12,
    boostTopSpeed: 47,
    /** Body centre above the ground at rest. */
    rideHeight: 0.85,
    travel: 0.35,
    spring: 110,
    damping: 12,
    colliderRadius: 0.55,
    wheelbase: 2.7,
    crashImpact: 34,
    crashAngleDeg: 80,
    crashDecel: 30,
    surface: { powder: { rolling: 0.6, drag: 0.5 }, rock: { grip: 1.1 }, mud: { grip: 1.1, drag: 0.6 } },
  },
  // Unbranded thruster hypercar: grippy sports car; Space fires cold-gas thrusters (jump, hover, cushion).
  roadster: {
    ...base,
    name: 'Volt Roadster',
    mass: 1100,
    topSpeed: 42,
    accel: 15,
    propulsionMaxSpeed: 42,
    brake: 16,
    aero: 0.0028,
    tuckAero: 1,
    grip: 2.9,
    skidDrag: 0.9,
    turnRateLow: 2.6,
    turnRateHigh: 1.3,
    turnSpeedRef: 32,
    airPitchRate: 2.2,
    airSpinRate: 2.4,
    airSteer: 0.5,
    jumpSpeed: 6.5,
    // Shift: the rear diffuser thrusters.
    boostAccel: 16,
    boostTopSpeed: 50,
    rideHeight: 0.62,
    travel: 0.28,
    spring: 120,
    damping: 13,
    colliderRadius: 0.5,
    wheelbase: 2.64,
    crashImpact: 32,
    crashAngleDeg: 78,
    crashDecel: 30,
    surface: { powder: { rolling: 0.8, drag: 0.6 }, mud: { grip: 0.9, drag: 0.6 } },
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
  snowboard: {
    ...base,
    name: 'Snowboard',
    topSpeed: 31,
    accel: 1.5,
    propulsionMaxSpeed: 3,
    aero: 0.0048,
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
    topSpeed: 34,
    accel: 2,
    propulsionMaxSpeed: 4,
    aero: 0.0042,
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
  /** Keyboard steering ramp (per second): just enough to avoid twitching. Sticks are not ramped. */
  steerRise: 22,
  steerFall: 26,
  /** Gravity multiplier while airborne (not flying): snappy, weighty arcs. */
  airGravityMul: 1.35,
  /** Landing assist strength near the ground (1/s). */
  landingAssist: 5.5,
  /** Air-to-ground normal blending (1/s). */
  normalSmoothing: 18,
  /** In the air the vehicle pitches to follow its flight path at this rate (1/s), up to arcMaxPitch (rad). */
  arcFollow: 4,
  arcMaxPitch: 0.75,
  /** Pull that keeps the wheels on the ground over crests (m/s²): firm when slow, light at speed
   *  so fast riders get air off rollers and lips. Fades between 0 and crestStickSpeed (m/s). */
  crestStick: 12,
  crestStickFast: 8,
  crestStickSpeed: 26,
  /** Distance to ground below which the rider pre-aligns to the landing slope (m). */
  landingAlignDistance: 4,
  /** Respawn speed after crashes / resets (m/s). */
  respawnSpeed: 8,
  /** Max time a respawned rider is held in place waiting for the terrain collider to stream in (s). */
  spawnGroundWait: 4,
  crashDuration: 2.1,
  crashPenalty: 3,
  /** Off-course / stuck auto reset. */
  outOfBoundsDistance: 450,
  fallBelowCourse: 60,
  stuckSpeed: 0.8,
  stuckTime: 6,
};

/**
 * Arcade flight tuning (hover car, wingsuit). One control scheme for every flyer:
 * A/D bank-and-turn (wings level themselves), W/↑ dive, S/↓ pull up / flare (the nose returns to
 * its neutral attitude when released), Shift thrust, Space climb (hover car).
 */
export interface FlightStats {
  /** Thrust while holding Shift (m/s²), fading toward maxSpeed. 0 = unpowered (wingsuit). */
  thrust: number;
  maxSpeed: number;
  /** Space while flying: vertical climb (m/s²), uses the meter. 0 = none. */
  climb: number;
  /** Below this speed the wings stop working: lift fades and the nose is pushed down. */
  stallSpeed: number;
  /** Fraction of gravity cancelled by lift at full speed (0 for a pure glider). */
  lift: number;
  /** How fast the flight path turns toward the nose (1/s). */
  align: number;
  /** Nose attitude (rad, + = up): neutral (no input), and how far W/S move it. */
  neutralPitch: number;
  pitchUp: number;
  pitchDown: number;
  /** How quickly the nose reaches the commanded attitude (1/s). */
  pitchResponse: number;
  /** Turn rate at full bank (rad/s), max bank (rad), bank response (1/s). */
  yawRate: number;
  bankMax: number;
  bankResponse: number;
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
  /** Below this height (m) while sinking, the nose is eased up (terrain safety). */
  groundAssist: number;
}

export type FlyerId = 'flyingCar' | 'wingsuit';

export const FLIGHT: Record<FlyerId, FlightStats> = {
  flyingCar: {
    thrust: 12, maxSpeed: 50, climb: 9, stallSpeed: 10, lift: 0.9, align: 2.6,
    neutralPitch: 0, pitchUp: 0.45, pitchDown: 0.6, pitchResponse: 3,
    yawRate: 1.1, bankMax: 0.5, bankResponse: 4, gravity: 0.6,
    drain: 1 / 9, groundRecharge: 1 / 5, lowGlideRecharge: 0, lowGlideHeight: 0, ceiling: 110, groundAssist: 4,
  },
  // Pure glider, steeper than a real suit (~1.7:1 at the neutral attitude) so a flight comes down
  // within a minute or so on these slopes. Dive for speed, flare to stretch the glide.
  wingsuit: {
    thrust: 0, maxSpeed: 70, climb: 0, stallSpeed: 15, lift: 0, align: 2.0,
    neutralPitch: -0.53, pitchUp: 0.6, pitchDown: 0.5, pitchResponse: 2.5,
    yawRate: 0.9, bankMax: 0.75, bankResponse: 4, gravity: 1,
    drain: 0, groundRecharge: 0, lowGlideRecharge: 0, lowGlideHeight: 0, ceiling: 600, groundAssist: 6,
  },
};
