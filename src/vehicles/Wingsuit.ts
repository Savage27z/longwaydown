import type * as THREE from 'three';
import { FLIGHT } from '../config/vehicles';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { PoseTargets } from '../player/Character';
import { damp } from '../utils/math';
import { ArcadeVehicle } from './ArcadeVehicle';
import { FlightModel } from './FlightModel';
import type { TransferState, VehicleContext, VehicleInput } from './Vehicle';

/**
 * Wingsuit: an unpowered glider (~2.6:1). Dive (W) for speed, flare (S) to stretch the glide,
 * A/D to bank. Deployed at the race start and any time the rider is high enough in the air.
 * Touching down hands over to a ground vehicle (the rider controller does the swap).
 */
export class Wingsuit extends ArcadeVehicle {
  readonly flight = new FlightModel(() => FLIGHT.wingsuit);
  private time = 0;
  private diveIn = 0;
  private flareIn = 0;
  private dive = 0;
  private flare = 0;

  constructor(physics: PhysicsWorld, state: TransferState) {
    super('wingsuit', physics, state);
    this.telemetry.flightMeter = -1;
  }

  /** Deployed in the air: start nose-down so the suit builds airspeed. */
  override onSwitchedIn(): void {
    this.flight.pitch = -0.6;
    this.flight.bank = 0;
  }

  protected override preStep(_dt: number, input: VehicleInput): void {
    this.diveIn = Math.max(input.throttle, Math.max(0, input.pitch));
    this.flareIn = Math.max(input.brake, Math.max(0, -input.pitch));
    if (this.grounded) this.gravityOverride = null;
    this.telemetry.flying = !this.grounded;
  }

  protected override flightStep(dt: number, input: VehicleInput, _ctx: VehicleContext, v: THREE.Vector3): boolean {
    const h = Number.isFinite(this.groundDistance) ? this.groundDistance : 400;
    this.heading = this.flight.step(dt, input, v, this.heading, h);
    this.gravityOverride = FLIGHT.wingsuit.gravity;
    return true;
  }

  protected override computeQuat(): void {
    // `flight` is unset while the base constructor places the body.
    if (this.flight && !this.grounded) {
      this.flight.quaternion(this.heading, this.currQuat);
      return;
    }
    super.computeQuat();
  }

  protected animate(dt: number): void {
    this.time += dt;
    this.dive = damp(this.dive, this.diveIn, 5, dt);
    this.flare = damp(this.flare, this.flareIn, 5, dt);
  }

  pose(out: PoseTargets): PoseTargets {
    const t = this.time;
    const flare = this.flare;
    const dive = this.dive;
    // Prone along +Z, chest down, legs spread in a V behind, arms out and swept back.
    out.hips.set(0, 0.42, -0.1);
    out.hipsRot.set(Math.PI / 2 - 0.08 - flare * 0.35, 0, 0);
    // Pike to dive, arch to flare; the bank twists the shoulders.
    out.spine.set(dive * 0.18 - flare * 0.22, 0, this.flight.bank * 0.3);
    out.chest.set(dive * 0.08 - flare * 0.1, this.flight.bank * 0.15, 0);
    out.head.set(-1.2 + dive * 0.25 + flare * 0.2, 0, 0);
    const legSpread = 0.3 - dive * 0.12;
    out.footL.set(legSpread, 0.4 - flare * 0.25, -1.02 + flare * 0.15);
    out.footR.set(-legSpread, 0.4 - flare * 0.25, -1.02 + flare * 0.15);
    out.handL = null;
    out.handR = null;
    // The suit buzzes a little in the airflow.
    const buzz = Math.sin(t * 23) * 0.015 + Math.sin(t * 37) * 0.01;
    for (const arm of [out.armL, out.armR]) {
      arm.pitch = -0.35 + flare * 0.45 - dive * 0.35 + buzz;
      arm.spread = 1.3 - dive * 0.45;
      arm.bend = 0.08;
    }
    out.kneePole.set(0, -1, 0.1);
    out.elbowPole.set(0, 1, -0.3);
    out.footYaw = 0;
    out.mirrorPoles = true;
    return out;
  }
}
