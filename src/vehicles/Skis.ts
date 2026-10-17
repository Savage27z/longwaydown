import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { createModel, type ModelOptions } from '../models/ModelLoader';
import { setArms, type PoseTargets } from '../player/Character';
import { damp } from '../utils/math';
import { ArcadeVehicle } from './ArcadeVehicle';
import type { TransferState, VehicleInput } from './Vehicle';

const _a = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);
/** Pole plant cycle (s): reach forward, tip planted while the body passes, recover. */
const PLANT_TIME = 0.55;

/** Pole plant phase -> hand offset forward/down and how far forward the tip points. */
function plantCurve(phase: number): { fwd: number; down: number; tip: number; w: number } {
  if (phase >= 1) return { fwd: 0, down: 0, tip: 0, w: 0 };
  const w = Math.sin(Math.PI * Math.min(1, phase)) ** 0.5;
  let fwd: number;
  if (phase < 0.25) fwd = (phase / 0.25) * 0.24;
  else if (phase < 0.7) fwd = 0.24 - ((phase - 0.25) / 0.45) * 0.4;
  else fwd = -0.16 * (1 - (phase - 0.7) / 0.3);
  const down = phase < 0.25 ? (phase / 0.25) * 0.12 : phase < 0.7 ? 0.12 : 0.12 * (1 - (phase - 0.7) / 0.3);
  return { fwd, down, tip: fwd * 1.6, w };
}

/** Skis: fastest straight-line on snow (tuck), tight carves, poles planted in turns. Snow only. */
export class Skis extends ArcadeVehicle {
  private m: THREE.Object3D;
  private steerIn = 0;
  private brakeIn = 0;
  private throttleIn = 0;
  private trickIn = false;
  private plow = 0;
  private turn = 0;
  private lastTurnSign = 0;
  private poleTimer = 0;
  private plant = { l: 1, r: 1 };
  private hands = { l: new THREE.Vector3(), r: new THREE.Vector3() };
  private tips = { l: 0, r: 0 };

  constructor(physics: PhysicsWorld, state: TransferState, paint: ModelOptions = { primary: '#ff4d6d', secondary: '#ffffff' }) {
    super('skis', physics, state);
    this.m = createModel('vehicle:skis', paint);
    this.model.add(this.m);
  }

  protected override preStep(_dt: number, input: VehicleInput): void {
    this.steerIn = input.steer;
    this.brakeIn = input.brake;
    this.throttleIn = input.throttle;
    this.trickIn = input.trick;
  }

  /** Tighter carving when not tucked. */
  protected override steerMultiplier(): number {
    return this.tuck ? 0.75 : 1.1;
  }

  protected animate(dt: number): void {
    // Snowplough when braking: tips together, tails apart.
    this.plow = damp(this.plow, this.grounded ? this.brakeIn * 0.35 : 0, 7, dt);
    this.turn = damp(this.turn, this.grounded ? this.steerIn : 0, 6, dt);
    const l = this.m.getObjectByName('skiL');
    const r = this.m.getObjectByName('skiR');
    // Skis roll onto their edges in carves.
    if (l) l.rotation.set(0, -this.plow, this.turn * 0.3);
    if (r) r.rotation.set(0, this.plow, this.turn * 0.3);
    this.updatePlants(dt);
    // Poles hang from the hands; a planted pole points its tip forward into the snow.
    for (const [name, hand, tip] of [
      ['poleL', this.hands.l, this.tips.l],
      ['poleR', this.hands.r, this.tips.r],
    ] as const) {
      const pole = this.m.getObjectByName(name);
      if (!pole) continue;
      pole.position.copy(hand);
      const idleZ = this.tuck ? -1.4 : !this.grounded ? -0.9 : -0.45;
      _a.set(hand.x * (this.grounded ? 1.4 : 2.2), -1, idleZ + tip).normalize();
      _q.setFromUnitVectors(DOWN, _a);
      pole.quaternion.copy(_q);
    }
  }

  /** Plant the inside pole when a turn starts; double-pole when pushing off slowly. */
  private updatePlants(dt: number): void {
    const s = this.steerIn;
    const sign = Math.abs(s) > 0.35 ? Math.sign(s) : 0;
    const riding = this.grounded && this.telemetry.speed > 3 && !this.tuck;
    if (riding && sign !== 0 && sign !== this.lastTurnSign) {
      // Steer right = right turn = right (inside) pole.
      if (sign > 0) this.plant.r = 0;
      else this.plant.l = 0;
    }
    if (sign !== 0) this.lastTurnSign = sign;
    else if (Math.abs(s) < 0.1) this.lastTurnSign = 0;
    this.poleTimer -= dt;
    if (this.grounded && this.throttleIn > 0.5 && this.telemetry.speed < 14 && this.poleTimer <= 0) {
      this.plant.l = this.plant.r = 0;
      this.poleTimer = 0.95;
    }
    this.plant.l = Math.min(1, this.plant.l + dt / PLANT_TIME);
    this.plant.r = Math.min(1, this.plant.r + dt / PLANT_TIME);
  }

  pose(out: PoseTargets): PoseTargets {
    this.model.updateMatrixWorld(true);
    const comp = this.telemetry.compression;
    const tuck = this.tuck ? 1 : 0;
    const turn = this.turn;
    const crouch = 0.1 + comp * 0.15 + tuck * 0.22 + Math.abs(turn) * 0.05;
    this.partLocal(this.m, 'footL', out.footL);
    this.partLocal(this.m, 'footR', out.footR);
    // Angulation: hips drop to the inside of the turn while the upper body stays quiet and keeps
    // facing down the fall line (the outside of the turn).
    out.hips.set(-turn * 0.11, 0.88 - crouch, -0.06 - tuck * 0.08);
    out.hipsRot.set(0.25 + tuck * 0.35, turn * 0.1, 0);
    out.spine.set(0.25 + tuck * 0.5, turn * 0.15, -this.lean * 0.4 + turn * 0.12);
    out.chest.set(0.08, turn * 0.1, 0);
    out.head.set(-(0.45 + tuck * 0.75), 0, 0);
    const air = !this.grounded;
    if (air && this.trickIn) {
      // Mute grab: both hands to the skis.
      out.handL = null;
      out.handR = null;
      setArms(out, 1.3, 0.3, 1.2);
    } else {
      const hy = out.hips.y + 0.2 - tuck * 0.15;
      const hz = 0.35 + tuck * 0.1;
      const hl = (out.handL ??= new THREE.Vector3());
      const hr = (out.handR ??= new THREE.Vector3());
      if (air) {
        // Poles out wide for balance.
        hl.set(0.42, hy + 0.12, 0.25);
        hr.set(-0.42, hy + 0.12, 0.25);
      } else {
        const pl = plantCurve(this.plant.l);
        const pr = plantCurve(this.plant.r);
        hl.set(0.26 + pl.w * 0.06, hy - pl.down, hz + pl.fwd);
        hr.set(-0.26 - pr.w * 0.06, hy - pr.down, hz + pr.fwd);
        this.tips.l = pl.tip * 1.8;
        this.tips.r = pr.tip * 1.8;
      }
      if (air) this.tips.l = this.tips.r = 0;
      this.hands.l.copy(hl);
      this.hands.r.copy(hr);
    }
    out.kneePole.set(0.1, 0.2, 1);
    out.elbowPole.set(0.7, -0.4, -0.5);
    out.footYaw = 0;
    out.mirrorPoles = true;
    return out;
  }
}
