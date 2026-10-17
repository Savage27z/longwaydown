import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { createModel, type ModelOptions } from '../models/ModelLoader';
import type { PoseTargets } from '../player/Character';
import { damp } from '../utils/math';
import { ArcadeVehicle } from './ArcadeVehicle';
import type { TransferState, VehicleInput } from './Vehicle';

const _v = new THREE.Vector3();

/** Snowboard: carves on its edges, spins big, lands switch. Snow only. */
export class Snowboard extends ArcadeVehicle {
  private m: THREE.Object3D;
  private steerIn = 0;
  private brakeIn = 0;
  private edge = 0;
  private skid = 0;

  constructor(physics: PhysicsWorld, state: TransferState, paint: ModelOptions = { primary: '#3ec8ff', secondary: '#ff5a1f' }) {
    super('snowboard', physics, state);
    this.allowSwitch = true;
    this.m = createModel('vehicle:snowboard', paint);
    this.model.add(this.m);
  }

  protected override preStep(_dt: number, input: VehicleInput): void {
    this.steerIn = input.steer;
    this.brakeIn = input.brake;
  }

  protected animate(dt: number): void {
    // The board digs onto its edge in carves and slews sideways when braking (skid stop).
    this.edge = damp(this.edge, this.grounded ? this.steerIn * 0.22 : 0, 8, dt);
    this.skid = damp(this.skid, this.grounded ? this.brakeIn * 0.9 : 0, 6, dt);
    this.m.rotation.set(0, this.skid, this.edge);
  }

  pose(out: PoseTargets, input: VehicleInput): PoseTargets {
    this.model.updateMatrixWorld(true);
    const comp = this.telemetry.compression;
    const crouch = 0.12 + comp * 0.15 + (this.tuck ? 0.1 : 0);
    // Regular stance: left foot forward, chest toward the rider's right (heelside behind).
    this.partLocal(this.m, 'footL', out.footL);
    this.partLocal(this.m, 'footR', out.footR);
    out.hips.set(0, 0.86 - crouch, 0);
    out.hipsRot.set(0.15 + crouch * 0.4, -Math.PI / 2 + this.skid * 0.3, this.steerIn * 0.25);
    out.spine.set(0.15 + crouch * 0.5, 0.25, 0);
    out.chest.set(0.05, 0.2, 0);
    out.head.set(-0.2, 0.95, 0);
    out.handL = null;
    out.handR = null;
    const grab = !this.grounded && input.trick;
    out.freeArm.pitch = grab ? 1.2 : 0.35;
    out.freeArm.spread = grab ? 0.2 : 0.75;
    out.freeArm.bend = grab ? 1.0 : 0.45;
    // Knees both point toward the chest side.
    out.kneePole.set(-1, 0.25, 0.1);
    out.elbowPole.set(0, -0.4, -1);
    out.footYaw = -Math.PI / 2 + 0.25;
    out.mirrorPoles = false;
    if (grab) out.hips.y -= 0.2;
    void _v;
    return out;
  }
}
