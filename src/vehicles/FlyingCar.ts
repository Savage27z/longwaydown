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
 * Futuristic hover car: hovers on four glowing pads; press Space to lift off and fly while the
 * flight meter lasts (it recharges on the ground). Original design, no real brands.
 */
export class FlyingCar extends ArcadeVehicle {
  private m: THREE.Object3D;
  readonly flight = new FlightModel(() => FLIGHT.flyingCar);
  private flying = false;
  private liftoff = false;
  private time = 0;
  private steerIn = 0;
  private qTmp = new THREE.Quaternion();

  constructor(physics: PhysicsWorld, state: TransferState, paint: ModelOptions = { primary: '#e8edf2', secondary: '#3ec8ff' }) {
    super('flyingCar', physics, state);
    this.m = createModel('vehicle:flyingCar', paint);
    this.model.add(this.m);
    this.telemetry.flightMeter = 1;
  }

  /** Switched in mid-air: go straight into flight if there is charge. */
  override onSwitchedIn(airborne: boolean): void {
    if (airborne && this.flight.meter > 0.12) {
      this.liftoff = true;
      this.flight.pitch = 0;
    }
  }

  protected override preStep(dt: number, input: VehicleInput): void {
    this.steerIn = input.steer;
    if (this.grounded) {
      this.flying = false;
      this.gravityOverride = null;
      this.flight.recharge(dt);
      this.flight.pitch = 0;
      this.flight.bank = 0;
      if (input.jumpPressed && this.flight.meter > 0.12) this.liftoff = true;
    }
    this.telemetry.flightMeter = this.flight.meter;
    this.telemetry.flying = this.flying && !this.grounded;
  }

  protected override flightStep(dt: number, input: VehicleInput, _ctx: VehicleContext, v: THREE.Vector3): boolean {
    if (this.liftoff) {
      this.flying = true;
      this.liftoff = false;
    }
    if (!this.flying || this.flight.meter <= 0) {
      this.flying = false;
      this.gravityOverride = null;
      return false;
    }
    const h = Number.isFinite(this.groundDistance) ? this.groundDistance : 200;
    this.heading = this.flight.step(dt, input, v, this.heading, h);
    this.gravityOverride = FLIGHT.flyingCar.gravity;
    // Flying drains the meter a little even without thrust (keeping the pads lit).
    this.flight.meter = Math.max(0, this.flight.meter - dt * 0.03);
    return true;
  }

  protected override computeQuat(): void {
    if (this.flight && this.flying && !this.grounded) {
      this.flight.quaternion(this.heading, this.currQuat);
      return;
    }
    super.computeQuat();
  }

  protected animate(dt: number): void {
    this.time += dt;
    // Gentle hover bob and a lean into turns.
    this.m.position.y = Math.sin(this.time * 2.6) * 0.035;
    const roll = damp(this.m.rotation.z, this.grounded ? this.steerIn * 0.08 : 0, 6, dt);
    this.m.rotation.z = roll;
    const pads = this.m.getObjectByName('pads');
    if (pads) {
      const k = this.flying ? 1.25 + (this.flight.thrusting ? 0.2 : 0) : 1;
      pads.scale.setScalar(damp(pads.scale.x, k, 6, dt));
    }
    void this.qTmp;
  }

  pose(out: PoseTargets): PoseTargets {
    this.model.updateMatrixWorld(true);
    const seat = this.partLocal(this.m, 'seat', out.hips);
    seat.y += 0.08;
    out.hipsRot.set(0.15, 0, 0);
    out.spine.set(-0.05, 0, -this.lean * 0.2);
    out.chest.set(0, 0, 0);
    out.head.set(-0.1, -this.steerIn * 0.3, 0);
    out.handL = this.partLocal(this.m, 'gripL', out.handL ?? new THREE.Vector3());
    out.handR = this.partLocal(this.m, 'gripR', out.handR ?? new THREE.Vector3());
    this.partLocal(this.m, 'footL', out.footL);
    this.partLocal(this.m, 'footR', out.footR);
    out.kneePole.set(0.1, 0.4, 1);
    out.elbowPole.set(0.6, -0.5, -0.6);
    out.footYaw = 0;
    out.mirrorPoles = true;
    return out;
  }
}
