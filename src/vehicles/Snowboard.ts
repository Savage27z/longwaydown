import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { createModel, type ModelOptions } from '../models/ModelLoader';
import type { PoseTargets } from '../player/Character';
import { damp } from '../utils/math';
import { ArcadeVehicle } from './ArcadeVehicle';
import type { TransferState, VehicleInput } from './Vehicle';

/** Snowboard: carves on its edges, spins big, lands switch. Snow only. */
export class Snowboard extends ArcadeVehicle {
  private m: THREE.Object3D;
  private steerIn = 0;
  private brakeIn = 0;
  private edge = 0;
  private skid = 0;
  /** Smoothed turn (-1 heel side .. +1 toe side) for the upper body. */
  private turn = 0;
  private grab = 0;
  private trickIn = false;
  private grabHand = new THREE.Vector3();

  constructor(physics: PhysicsWorld, state: TransferState, paint: ModelOptions = { primary: '#3ec8ff', secondary: '#ff5a1f' }) {
    super('snowboard', physics, state);
    this.allowSwitch = true;
    this.m = createModel('vehicle:snowboard', paint);
    this.model.add(this.m);
  }

  protected override preStep(_dt: number, input: VehicleInput): void {
    this.steerIn = input.steer;
    this.brakeIn = input.brake;
    this.trickIn = input.trick;
  }

  protected animate(dt: number): void {
    // The board digs onto its edge in carves and slews sideways when braking (skid stop).
    this.edge = damp(this.edge, this.grounded ? this.steerIn * 0.22 : 0, 8, dt);
    this.skid = damp(this.skid, this.grounded ? this.brakeIn * 0.9 : 0, 6, dt);
    this.turn = damp(this.turn, this.grounded ? this.steerIn : 0, 5, dt);
    this.grab = damp(this.grab, !this.grounded && this.trickIn ? 1 : 0, 10, dt);
    this.m.rotation.set(0, this.skid, this.edge);
  }

  pose(out: PoseTargets): PoseTargets {
    this.model.updateMatrixWorld(true);
    const comp = this.telemetry.compression;
    const turn = this.turn;
    // Deeper knees when carving hard; hips drop to the inside of the turn (toe side = rider's front).
    const crouch = 0.12 + comp * 0.15 + (this.tuck ? 0.1 : 0) + Math.abs(turn) * 0.08 + this.grab * 0.12;
    // Regular stance: left foot forward (toward the nose), facing the board's right side.
    this.partLocal(this.m, 'footL', out.footL);
    this.partLocal(this.m, 'footR', out.footR);
    out.hips.set(-this.edge * 0.5, 0.86 - crouch, 0);
    // (Toe/heel lean comes from the hips shift and the spine; hipsRot.z would tip toward nose/tail.)
    out.hipsRot.set(0.15 + crouch * 0.4, -Math.PI / 2 + this.skid * 0.3, 0);
    // Upper body leads the turn and faces a little down the hill.
    out.spine.set(0.15 + crouch * 0.5 + turn * 0.18, 0.25 + turn * 0.15, 0);
    out.chest.set(0.05, 0.2 + turn * 0.12, 0);
    out.head.set(-0.2, 0.95 - turn * 0.1, 0);
    // Balance arms: lead arm out over the nose, trailing arm low and back; both reach to the toes
    // in toe-side turns and pull back on heel-side turns.
    out.handL = null;
    out.handR = null;
    out.armL.pitch = 0.3 + turn * 0.35;
    out.armL.spread = 0.85 - turn * 0.15;
    out.armL.bend = 0.35;
    out.armR.pitch = 0.1 + turn * 0.3;
    out.armR.spread = 0.5 + Math.abs(turn) * 0.2;
    out.armR.bend = 0.5;
    if (this.grab > 0.05) {
      // Indy: the back hand grabs the toe edge between the feet, front arm out for style.
      const g = this.grab;
      out.handR = g >= 0.6 ? this.grabHand.set(-0.16, 0.12, (out.footL.z + out.footR.z) * 0.5) : null;
      out.armL.pitch = 0.7 * g + out.armL.pitch * (1 - g);
      out.armL.spread = 1.25 * g + out.armL.spread * (1 - g);
    }
    // Knees both point toward the chest side.
    out.kneePole.set(-1, 0.25, 0.1);
    out.elbowPole.set(0, -0.4, -1);
    out.footYaw = -Math.PI / 2 + 0.25;
    out.mirrorPoles = false;
    return out;
  }
}
