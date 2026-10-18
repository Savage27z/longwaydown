import * as THREE from 'three';
import type { SurfaceId } from '../config/surfaces';
import { VEHICLES, type VehicleId, type VehicleStats } from '../config/vehicles';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { RapierNS } from '../physics/rapier';
import type { PoseTargets } from '../player/Character';
import type { World } from '../world/World';

/** Per-step control input, already merged from keyboard/gamepad. */
export interface VehicleInput {
  throttle: number;
  brake: number;
  /** -1 left .. +1 right */
  steer: number;
  /** -1 pitch back .. +1 pitch forward (air) */
  pitch: number;
  /** -1 spin left .. +1 spin right (air) */
  spin: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
  boost: boolean;
  trick: boolean;
  /** Throw a bottle / stone this step. */
  throwPressed: boolean;
}

export function emptyInput(): VehicleInput {
  return { throttle: 0, brake: 0, steer: 0, pitch: 0, spin: 0, jumpPressed: false, jumpHeld: false, boost: false, trick: false, throwPressed: false };
}

/** Modifiers from buffs / boost, applied by the vehicle each step. */
export interface RideModifiers {
  topSpeedMul: number;
  gripMul: number;
  /** Max grip regardless of surface (Grip buff). */
  gripOverride: boolean;
  gravityMul: number;
  /** Boost meter has fuel this step. */
  boostAvailable: boolean;
}

export function defaultMods(): RideModifiers {
  return { topSpeedMul: 1, gripMul: 1, gripOverride: false, gravityMul: 1, boostAvailable: true };
}

export interface VehicleContext {
  physics: PhysicsWorld;
  world: World;
  mods: RideModifiers;
}

export interface LandInfo {
  airTime: number;
  /** Speed into the ground along the normal (m/s). */
  impact: number;
  /** Signed full flips (+ = front flips) and half spins (180s). */
  flips: number;
  spins: number;
  grabTime: number;
  /** Max height above ground during the jump (m). */
  height: number;
  /** Landed backwards (switch) — boards only. */
  switchLanding: boolean;
}

export interface VehicleHooks {
  onTakeoff?: () => void;
  onLand?: (info: LandInfo) => void;
  /** Return true if the crash was absorbed (Shield buff). */
  onCrash?: (reason: string) => boolean;
}

export interface TransferState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  heading: number;
}

export interface VehicleTelemetry {
  speed: number;
  forwardSpeed: number;
  grounded: boolean;
  airTime: number;
  surface: SurfaceId;
  compression: number;
  heading: number;
  boosting: boolean;
  /** 0..1 flight/fuel meter for flying vehicles, -1 when not applicable. */
  flightMeter: number;
  /** In powered/gliding flight (hover car, wingsuit). */
  flying: boolean;
}

/** Serializable snapshot for ghosts / netcode. */
export interface VehicleSnapshot {
  vehicle: VehicleId;
  pos: [number, number, number];
  rot: [number, number, number, number];
  vel: [number, number, number];
  heading: number;
}

/** Base class for everything the player can ride. Vehicles know nothing about UI. */
export abstract class Vehicle {
  /** Visual root (local/simulation coordinates). */
  readonly model = new THREE.Group();
  /** Character attachment frame inside the model. */
  readonly mount = new THREE.Group();
  readonly hooks: VehicleHooks = {};
  readonly telemetry: VehicleTelemetry = {
    speed: 0,
    forwardSpeed: 0,
    grounded: false,
    airTime: 0,
    surface: 'packed',
    compression: 0,
    heading: 0,
    boosting: false,
    flightMeter: -1,
    flying: false,
  };
  body!: RapierNS.RigidBody;

  constructor(readonly id: VehicleId) {
    this.model.add(this.mount);
  }

  get stats(): VehicleStats {
    return VEHICLES[this.id];
  }

  /** Before the physics step. */
  abstract fixedUpdate(dt: number, input: VehicleInput, ctx: VehicleContext): void;
  /** After the physics step. */
  abstract afterStep(dt: number, ctx: VehicleContext): void;
  /** Per render frame: interpolate and animate the model. */
  abstract render(dt: number, alpha: number): void;
  /** Character pose for the current state (vehicle-local frame). */
  abstract pose(out: PoseTargets, input: VehicleInput): PoseTargets;
  abstract transfer(): TransferState;
  abstract place(state: TransferState): void;
  /** Render-interpolated position (local). */
  abstract renderPosition(out: THREE.Vector3): THREE.Vector3;
  /** Render-interpolated orientation. */
  abstract renderQuaternion(out: THREE.Quaternion): THREE.Quaternion;
  abstract shiftOrigin(dx: number, dy: number, dz: number): void;
  /** Solid to other riders (off for ghosts, which coast through everything). */
  setSolid(_on: boolean): void {}
  abstract dispose(physics: PhysicsWorld): void;
  /** Called right after a mid-ride switch put this vehicle in place. */
  onSwitchedIn(_airborne: boolean): void {}

  snapshot(): VehicleSnapshot {
    const t = this.body.translation();
    const v = this.body.linvel();
    const q = this.model.quaternion;
    return { vehicle: this.id, pos: [t.x, t.y, t.z], rot: [q.x, q.y, q.z, q.w], vel: [v.x, v.y, v.z], heading: this.telemetry.heading };
  }
}
