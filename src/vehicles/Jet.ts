import * as THREE from 'three';
import { FLIGHT } from '../config/vehicles';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { createModel, type ModelOptions } from '../models/ModelLoader';
import type { PoseTargets } from '../player/Character';
import { damp } from '../utils/math';
import { ArcadeVehicle } from './ArcadeVehicle';
import { FlightModel } from './FlightModel';
import type { TransferState, VehicleContext, VehicleInput } from './Vehicle';

/**
 * Jet wing: the rider flies prone under a small turbine wing. Very fast, but fuel only refills
 * on the ground or while gliding (not thrusting) close to the terrain.
 */
export class Jet extends ArcadeVehicle {
  private m: THREE.Object3D;
  readonly flight = new FlightModel(() => FLIGHT.jet);
  private throttleIn = 0;
  private pitchIn = 0;
  private time = 0;
  private kick = 0;

  constructor(physics: PhysicsWorld, state: TransferState, paint: ModelOptions = { primary: '#20262e', secondary: '#ff5a1f' }) {
    super('jet', physics, state);
    this.m = createModel('vehicle:jet', paint);
    this.model.add(this.m);
    this.telemetry.flightMeter = 1;
  }

  protected override preStep(dt: number, input: VehicleInput): void {
    this.throttleIn = input.throttle;
    this.pitchIn = input.pitch;
    if (this.grounded) {
      this.gravityOverride = null;
      this.flight.recharge(dt);
      this.flight.pitch = 0.25;
      this.flight.bank = 0;
    }
    this.telemetry.flightMeter = this.flight.meter;
    this.telemetry.flying = !this.grounded;
  }

  /** Always fly while airborne (gliding when out of fuel). */
  protected override flightStep(dt: number, input: VehicleInput, ctx: VehicleContext, v: THREE.Vector3): boolean {
    const h = Number.isFinite(this.groundDistance) ? this.groundDistance : 200;
    this.heading = this.flight.step(dt, input, v, this.heading, h, ctx.mods, this.stats.boostAccel);
    this.gravityOverride = FLIGHT.jet.gravity;
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
    // Legs scissor-kick: lazy while gliding, quicker under thrust; still on the ground.
    const rate = 4.5 + this.throttleIn * 3.5;
    const amp = this.grounded ? 0 : 0.05 + (1 - this.throttleIn) * 0.06;
    this.kick = damp(this.kick, Math.sin(this.time * rate) * amp, 12, dt);
    const ex = this.m.getObjectByName('exhaust');
    if (ex) {
      const on = this.flight.meter > 0 ? 0.25 + this.throttleIn * 0.95 : 0.05;
      const k = damp(ex.scale.z, on, 10, dt);
      ex.scale.set(1, 1, k);
      ex.visible = k > 0.08;
    }
  }

  pose(out: PoseTargets): PoseTargets {
    this.model.updateMatrixWorld(true);
    // Prone along +Z under the wing, head up, legs trailing, hands on the wing handles.
    this.partLocal(this.m, 'seat', out.hips);
    out.hipsRot.set(Math.PI / 2 - 0.12, 0, 0);
    out.spine.set(0.05, 0, this.flight.bank * 0.2);
    out.chest.set(0, 0, 0);
    out.head.set(-1.25, 0, 0);
    out.handL = this.partLocal(this.m, 'gripL', out.handL ?? new THREE.Vector3());
    out.handR = this.partLocal(this.m, 'gripR', out.handR ?? new THREE.Vector3());
    this.partLocal(this.m, 'footL', out.footL).y += this.kick;
    this.partLocal(this.m, 'footR', out.footR).y -= this.kick;
    // Arch the back when pulling up, pike when diving; the bank twists the shoulders.
    const pull = this.grounded ? 0 : this.pitchIn;
    out.spine.x += pull * 0.16;
    out.chest.x += pull * 0.1;
    out.head.x += pull * 0.12;
    out.chest.y += this.flight.bank * 0.15;
    out.kneePole.set(0, -1, 0.1);
    out.elbowPole.set(0.8, 0.6, -0.2);
    out.footYaw = 0;
    out.mirrorPoles = true;
    return out;
  }
}
