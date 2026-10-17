import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { createModel, type ModelOptions } from '../models/ModelLoader';
import { BIKE_DIMS } from '../models/procedural/bicycle';
import type { PoseTargets } from '../player/Character';
import { clamp, damp } from '../utils/math';
import { ArcadeVehicle } from './ArcadeVehicle';
import type { TransferState, VehicleInput } from './Vehicle';

const TWO_PI = Math.PI * 2;
const _v = new THREE.Vector3();

/** Pedal bike (also the base for the mountain bike). Light, nimble; gravity does most of the work. */
export class Bicycle extends ArcadeVehicle {
  protected parts: Record<string, THREE.Object3D> = {};
  private crankAngle = 0;
  private wheelAngle = 0;
  private steerVis = 0;
  private throttle = 0;
  private steerIn = 0;
  private pedaling = false;
  private steerAxis = new THREE.Vector3(0, 1, 0);

  constructor(physics: PhysicsWorld, state: TransferState, id: 'bicycle' | 'mountainBike' = 'bicycle', paint: ModelOptions = {}) {
    super(id, physics, state);
    const m = createModel(`vehicle:${id}`, paint);
    this.model.add(m);
    for (const name of ['wheelFront', 'wheelRear', 'steer', 'crank', 'pedalL', 'pedalR', 'seat', 'gripL', 'gripR', 'forkSlider']) {
      const o = m.getObjectByName(name);
      if (o) this.parts[name] = o;
    }
    const axis = this.parts.steer?.userData.axis as THREE.Vector3 | undefined;
    if (axis) this.steerAxis.copy(axis);
  }

  protected override preStep(_dt: number, input: VehicleInput): void {
    this.throttle = input.throttle;
    this.steerIn = input.steer;
  }

  protected animate(dt: number): void {
    const p = this.parts;
    const fwd = this.telemetry.forwardSpeed;
    this.wheelAngle += (fwd / BIKE_DIMS.wheelRadius) * dt;
    if (p.wheelFront) p.wheelFront.rotation.x = this.wheelAngle;
    if (p.wheelRear) p.wheelRear.rotation.x = this.wheelAngle;

    this.pedaling = this.throttle > 0.1 && fwd < this.stats.propulsionMaxSpeed * 1.25;
    if (this.pedaling) {
      this.crankAngle += Math.max(4, (fwd / BIKE_DIMS.wheelRadius) * 0.42) * dt;
    } else {
      // Coasting: pedals level, leading foot forward.
      const level = Math.round(this.crankAngle / Math.PI) * Math.PI;
      this.crankAngle = damp(this.crankAngle, level, 8, dt);
    }
    this.crankAngle %= TWO_PI * 64;
    if (p.crank) p.crank.rotation.x = this.crankAngle;
    if (p.pedalL) p.pedalL.rotation.x = -this.crankAngle;
    if (p.pedalR) p.pedalR.rotation.x = -(this.crankAngle + Math.PI);

    const speedFade = 1 - clamp(this.telemetry.speed / 18, 0, 0.75);
    this.steerVis = damp(this.steerVis, -this.steerIn * 0.45 * speedFade, 10, dt);
    if (p.steer) p.steer.quaternion.setFromAxisAngle(this.steerAxis, this.steerVis);
    if (p.forkSlider && this.id === 'mountainBike') {
      p.forkSlider.position.copy(this.steerAxis).multiplyScalar(-this.telemetry.compression * 0.09);
    }
  }

  private local(name: string, out: THREE.Vector3): THREE.Vector3 {
    const o = this.parts[name];
    if (!o) return out.set(0, 1, 0);
    o.getWorldPosition(out);
    return this.mount.worldToLocal(out);
  }

  pose(out: PoseTargets, input: VehicleInput): PoseTargets {
    this.model.updateMatrixWorld(true);
    const tuck = this.tuck ? 1 : 0;
    const comp = this.telemetry.compression;
    const coastingFast = !this.pedaling && this.telemetry.speed > 6 && this.grounded;
    const seat = this.local('seat', _v);
    out.hips.set(0, seat.y + 0.1 - comp * 0.12 - tuck * 0.06 + (coastingFast ? 0.1 : 0), seat.z - 0.02 - tuck * 0.05 + (coastingFast ? 0.08 : 0));
    out.hipsRot.set(0.25 + tuck * 0.15, 0, 0);
    out.spine.set(0.35 + tuck * 0.35 + comp * 0.15, 0, -this.lean * 0.3);
    out.chest.set(0.1 + tuck * 0.15, 0, 0);
    out.head.set(-(0.55 + tuck * 0.45), -this.steerVis * 0.4, 0);
    const grab = !this.grounded && input.trick;
    if (grab) {
      // "No-hander": arms out wide.
      out.handL = null;
      out.handR = null;
      out.freeArm.pitch = 1.3;
      out.freeArm.spread = 1.2;
      out.freeArm.bend = 0.2;
    } else {
      out.handL = this.local('gripL', out.handL ?? new THREE.Vector3());
      out.handR = this.local('gripR', out.handR ?? new THREE.Vector3());
    }
    this.local('pedalL', out.footL).y += 0.07;
    this.local('pedalR', out.footR).y += 0.07;
    out.kneePole.set(0, 0.3, 1);
    out.elbowPole.set(0.5, -0.4, -1);
    out.footYaw = 0;
    return out;
  }
}
