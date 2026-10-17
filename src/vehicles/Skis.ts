import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { createModel, type ModelOptions } from '../models/ModelLoader';
import type { PoseTargets } from '../player/Character';
import { damp } from '../utils/math';
import { ArcadeVehicle } from './ArcadeVehicle';
import type { TransferState, VehicleInput } from './Vehicle';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

/** Skis: fastest straight-line on snow (tuck), tight carves, poles planted in turns. Snow only. */
export class Skis extends ArcadeVehicle {
  private m: THREE.Object3D;
  private steerIn = 0;
  private brakeIn = 0;
  private plow = 0;
  private hands = { l: new THREE.Vector3(), r: new THREE.Vector3() };

  constructor(physics: PhysicsWorld, state: TransferState, paint: ModelOptions = { primary: '#ff4d6d', secondary: '#ffffff' }) {
    super('skis', physics, state);
    this.m = createModel('vehicle:skis', paint);
    this.model.add(this.m);
  }

  protected override preStep(_dt: number, input: VehicleInput): void {
    this.steerIn = input.steer;
    this.brakeIn = input.brake;
  }

  /** Tighter carving when not tucked. */
  protected override steerMultiplier(): number {
    return this.tuck ? 0.75 : 1.1;
  }

  protected animate(dt: number): void {
    // Snowplough when braking: tips together, tails apart.
    this.plow = damp(this.plow, this.grounded ? this.brakeIn * 0.35 : 0, 7, dt);
    const l = this.m.getObjectByName('skiL');
    const r = this.m.getObjectByName('skiR');
    if (l) l.rotation.set(0, -this.plow, this.steerIn * 0.15);
    if (r) r.rotation.set(0, this.plow, this.steerIn * 0.15);
    // Poles hang from the hands toward the snow behind.
    for (const [name, hand] of [['poleL', this.hands.l], ['poleR', this.hands.r]] as const) {
      const pole = this.m.getObjectByName(name);
      if (!pole) continue;
      pole.position.copy(hand);
      _a.set(hand.x * 1.4, -1, this.tuck ? -1.4 : -0.45).normalize();
      _q.setFromUnitVectors(DOWN, _a);
      pole.quaternion.copy(_q);
    }
  }

  pose(out: PoseTargets, input: VehicleInput): PoseTargets {
    this.model.updateMatrixWorld(true);
    const comp = this.telemetry.compression;
    const tuck = this.tuck ? 1 : 0;
    const crouch = 0.1 + comp * 0.15 + tuck * 0.22;
    this.partLocal(this.m, 'footL', out.footL);
    this.partLocal(this.m, 'footR', out.footR);
    out.hips.set(this.steerIn * -0.06, 0.88 - crouch, -0.06 - tuck * 0.08);
    out.hipsRot.set(0.25 + tuck * 0.35, 0, 0);
    out.spine.set(0.25 + tuck * 0.5, 0, -this.lean * 0.4);
    out.chest.set(0.08, 0, 0);
    out.head.set(-(0.45 + tuck * 0.75), 0, 0);
    const grab = !this.grounded && input.trick;
    if (grab) {
      out.handL = null;
      out.handR = null;
      out.freeArm.pitch = 1.3;
      out.freeArm.spread = 0.3;
      out.freeArm.bend = 1.2;
    } else {
      // Hands forward at the hips (tucked: tucked in front of the knees).
      out.handL = (out.handL ?? new THREE.Vector3()).set(0.26, out.hips.y + 0.2 - tuck * 0.15, 0.35 + tuck * 0.1);
      out.handR = (out.handR ?? new THREE.Vector3()).set(-0.26, out.hips.y + 0.2 - tuck * 0.15, 0.35 + tuck * 0.1);
      this.hands.l.copy(out.handL);
      this.hands.r.copy(out.handR);
    }
    out.kneePole.set(0.1, 0.2, 1);
    out.elbowPole.set(0.7, -0.4, -0.5);
    out.footYaw = 0;
    out.mirrorPoles = true;
    void _b;
    return out;
  }
}
