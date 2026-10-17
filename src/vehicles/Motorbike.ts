import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { createModel, type ModelOptions } from '../models/ModelLoader';
import { MOTO_DIMS } from '../models/procedural/motorbike';
import type { PoseTargets } from '../player/Character';
import { clamp, damp } from '../utils/math';
import { ArcadeVehicle } from './ArcadeVehicle';
import type { TransferState, VehicleInput } from './Vehicle';

const _v = new THREE.Vector3();
const WRIST = new THREE.Vector3(0, 0.03, -0.05);

/** Dirt bike: strong engine, wheelies (W + pitch back), preloaded jumps (hold Space, release). */
export class Motorbike extends ArcadeVehicle {
  private m: THREE.Object3D;
  private wheelAngle = 0;
  private steerVis = 0;
  private steerAxis = new THREE.Vector3(0, 1, 0);
  private wheelie = 0;
  private charge = 0;
  private release = false;
  private throttleIn = 0;
  private steerIn = 0;
  private pitchIn = 0;
  private holdingJump = false;

  constructor(physics: PhysicsWorld, state: TransferState, paint: ModelOptions = { primary: '#ffd23f', secondary: '#1b2b40' }) {
    super('motorbike', physics, state);
    this.m = createModel('vehicle:motorbike', paint);
    this.model.add(this.m);
    const axis = this.m.getObjectByName('steer')?.userData.axis as THREE.Vector3 | undefined;
    if (axis) this.steerAxis.copy(axis);
  }

  protected override preStep(dt: number, input: VehicleInput): void {
    this.throttleIn = input.throttle;
    this.steerIn = input.steer;
    this.pitchIn = input.pitch;
    // Preload: hold Space to compress, release to pop (stronger the longer you held, up to 0.6 s).
    this.release = false;
    if (input.jumpHeld && this.grounded) {
      this.holdingJump = true;
      this.charge = Math.min(1, this.charge + dt / 0.6);
    } else if (this.holdingJump) {
      this.holdingJump = false;
      this.release = true;
    } else {
      this.charge = Math.max(0, this.charge - dt * 3);
    }
    // Wheelie: throttle + pitch back on the ground.
    const want = this.grounded && input.throttle > 0.5 && input.pitch < -0.3 && this.telemetry.speed > 4 ? 0.55 : 0;
    this.wheelie = damp(this.wheelie, want, want > 0 ? 3 : 6, dt);
    this.extraPitch = -this.wheelie;
  }

  protected override jumpTrigger(_input: VehicleInput): boolean {
    return this.release;
  }

  protected override jumpMultiplier(): number {
    const k = 0.75 + this.charge * 0.85;
    this.charge = 0;
    return k;
  }

  protected animate(dt: number): void {
    const fwd = this.telemetry.forwardSpeed;
    this.wheelAngle += (fwd / MOTO_DIMS.wheelRadius) * dt;
    const wf = this.m.getObjectByName('wheelFront');
    const wr = this.m.getObjectByName('wheelRear');
    if (wf) wf.rotation.x = this.wheelAngle;
    // Rear wheel spins a bit faster under power (wheelspin).
    if (wr) wr.rotation.x = this.wheelAngle * (1 + this.throttleIn * 0.08);
    const fade = 1 - clamp(this.telemetry.speed / 25, 0, 0.8);
    this.steerVis = damp(this.steerVis, -this.steerIn * 0.5 * fade, 10, dt);
    this.m.getObjectByName('steer')?.quaternion.setFromAxisAngle(this.steerAxis, this.steerVis);
    const comp = this.telemetry.compression + this.charge * 0.4;
    const slider = this.m.getObjectByName('forkSlider');
    if (slider) slider.position.copy(this.steerAxis).multiplyScalar(-Math.min(1, comp) * 0.14);
    const swing = this.m.getObjectByName('swingarm');
    if (swing) swing.rotation.x = -Math.min(1, comp) * 0.18;
  }

  pose(out: PoseTargets, input: VehicleInput): PoseTargets {
    this.model.updateMatrixWorld(true);
    const comp = this.telemetry.compression;
    // Stand on the pegs in the air, over rough ground and while preloading; sit when cruising.
    const stand = !this.grounded || this.charge > 0.1 || comp > 0.4 ? 1 : 0.15;
    const seat = this.partLocal(this.m, 'seat', _v);
    out.hips.set(0, seat.y + 0.04 + stand * 0.22 - this.charge * 0.18, seat.z - 0.04 + stand * 0.08 - this.wheelie * 0.15);
    out.hipsRot.set(0.35 + stand * 0.15, 0, 0);
    out.spine.set(0.35 + stand * 0.12 - this.wheelie * 0.4, 0, -this.lean * 0.3);
    out.chest.set(0.12, -this.steerVis * 0.3, 0);
    out.head.set(-0.75 + this.wheelie * 0.4, -this.steerVis * 0.4, 0);
    if (!this.grounded && input.trick) {
      // "Superman": hands on, legs off — approximated with arms forward and feet trailing.
      out.handL = this.partLocal(this.m, 'gripL', out.handL ?? new THREE.Vector3()).add(WRIST);
      out.handR = this.partLocal(this.m, 'gripR', out.handR ?? new THREE.Vector3()).add(WRIST);
      out.footL.set(0.25, seat.y + 0.15, seat.z - 0.9);
      out.footR.set(-0.25, seat.y + 0.15, seat.z - 0.9);
      out.hips.y += 0.15;
      out.hipsRot.x = 1.1;
    } else {
      out.handL = this.partLocal(this.m, 'gripL', out.handL ?? new THREE.Vector3()).add(WRIST);
      out.handR = this.partLocal(this.m, 'gripR', out.handR ?? new THREE.Vector3()).add(WRIST);
      this.partLocal(this.m, 'pegL', out.footL).y += 0.07;
      this.partLocal(this.m, 'pegR', out.footR).y += 0.07;
    }
    out.kneePole.set(0.35, 0.2, 1);
    out.elbowPole.set(0.9, -0.2, -0.4);
    out.footYaw = 0;
    out.mirrorPoles = true;
    void this.pitchIn;
    return out;
  }
}
