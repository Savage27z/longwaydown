import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { createModel, type ModelOptions } from '../models/ModelLoader';
import { BIKE_DIMS } from '../models/procedural/bicycle';
import { setArms, type PoseTargets } from '../player/Character';
import { clamp, damp } from '../utils/math';
import { ArcadeVehicle } from './ArcadeVehicle';
import type { TransferState, VehicleInput } from './Vehicle';

const TWO_PI = Math.PI * 2;
const _v = new THREE.Vector3();
const WRIST_OFFSET = new THREE.Vector3(0, 0.025, -0.045);

/** Pedal bike (also the base for the mountain bike). Light, nimble; gravity does most of the work. */
export class Bicycle extends ArcadeVehicle {
  protected parts: Record<string, THREE.Object3D> = {};
  private crankAngle = 0;
  private wheelAngle = 0;
  private steerVis = 0;
  private throttle = 0;
  private steerIn = 0;
  private pedaling = false;
  private boostIn = false;
  /** Smoothed 0..1 amounts for pedalling and out-of-the-saddle sprinting. */
  private pedalAmt = 0;
  private sprintAmt = 0;
  private rock = 0;
  private standAmt = 0;
  private steerAxis = new THREE.Vector3(0, 1, 0);
  private rockQ = new THREE.Quaternion();
  private static readonly FWD = new THREE.Vector3(0, 0, 1);

  constructor(physics: PhysicsWorld, state: TransferState, id: 'bicycle' | 'mountainBike' = 'bicycle', paint: ModelOptions = {}) {
    super(id, physics, state);
    // Show most, not all, of the physical lean: big leans at moderate speed looked unreal.
    this.leanFactor = 0.75;
    const m = createModel(`vehicle:${id}`, paint);
    this.model.add(m);
    for (const name of ['wheelFront', 'wheelRear', 'steer', 'crank', 'pedalL', 'pedalR', 'seat', 'gripL', 'gripR', 'forkSlider', 'swingarm']) {
      const o = m.getObjectByName(name);
      if (o) this.parts[name] = o;
    }
    const axis = this.parts.steer?.userData.axis as THREE.Vector3 | undefined;
    if (axis) this.steerAxis.copy(axis);
  }

  protected override preStep(_dt: number, input: VehicleInput): void {
    this.throttle = input.throttle;
    this.steerIn = input.steer;
    this.boostIn = input.boost;
  }

  protected animate(dt: number): void {
    const p = this.parts;
    const fwd = this.telemetry.forwardSpeed;
    this.wheelAngle += (fwd / BIKE_DIMS.wheelRadius) * dt;
    if (p.wheelFront) p.wheelFront.rotation.x = this.wheelAngle;
    if (p.wheelRear) p.wheelRear.rotation.x = this.wheelAngle;

    // Pedal whenever the rider is putting power down (accelerate or boost), at any speed.
    const sprinting = this.telemetry.boosting || (this.boostIn && this.throttle > 0.1);
    this.pedaling = this.throttle > 0.1 || sprinting;
    this.pedalAmt = damp(this.pedalAmt, this.pedaling ? 1 : 0, 8, dt);
    this.sprintAmt = damp(this.sprintAmt, sprinting && this.grounded ? 1 : 0, 6, dt);
    const coastingFast = !this.pedaling && this.telemetry.speed > 6 && this.grounded;
    this.standAmt = damp(this.standAmt, coastingFast || !this.grounded ? 1 : 0, 6, dt);
    if (this.pedaling) {
      // Cadence follows speed (big gear), clamped to a believable 65-150 rpm; sprints spin faster.
      const revPerSec = clamp(Math.abs(fwd) / 5.5, 1.1, 2.4) + this.sprintAmt * 0.5;
      this.crankAngle += revPerSec * TWO_PI * dt;
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
    // Full-suspension rear end: the frame drops on its springs, the swingarm keeps the wheel down.
    if (p.swingarm) p.swingarm.rotation.x = -this.telemetry.compression * 0.1;
    // Out-of-the-saddle sprint: the bike rocks side to side with each pedal stroke.
    this.rock = Math.sin(this.crankAngle) * 0.13 * this.sprintAmt;
    if (Math.abs(this.rock) > 1e-4) this.model.quaternion.multiply(this.rockQ.setFromAxisAngle(Bicycle.FWD, this.rock));
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
    const seat = this.local('seat', _v);
    // Attack position when coasting fast or in the air: up off the saddle, weight back, elbows out.
    const stand = this.standAmt;
    const sprint = this.sprintAmt;
    const pedal = this.pedalAmt * (1 - sprint);
    const ca = this.crankAngle;
    // Seated pedalling: hips rock with each stroke, shoulders counter the rock.
    const sway = Math.sin(ca) * pedal;
    // Hip joints sit a little above the saddle top.
    out.hips.set(
      sway * 0.012 - this.rock * 0.25,
      seat.y + 0.05 - comp * 0.14 - tuck * 0.07 + stand * 0.12 + sprint * 0.16 + Math.abs(Math.cos(ca)) * 0.012 * pedal,
      seat.z - 0.02 - tuck * 0.06 - stand * 0.03 + sprint * 0.1,
    );
    const hipPitch = 0.4 + tuck * 0.12 + stand * 0.05 + sprint * 0.1;
    const spinePitch = 0.42 + tuck * 0.28 + comp * 0.18 + stand * 0.08 + sprint * 0.08;
    const chestPitch = 0.16 + tuck * 0.1;
    out.hipsRot.set(hipPitch, 0, sway * 0.06);
    out.spine.set(spinePitch, 0, -this.lean * 0.25 - sway * 0.05 - this.rock * 0.7);
    out.chest.set(chestPitch, -this.steerVis * 0.25 + Math.sin(ca) * 0.06 * (pedal + sprint), 0);
    // Keep the eyes on the trail.
    out.head.set(-(hipPitch + spinePitch + chestPitch) * 0.85, -this.steerVis * 0.5, this.lean * 0.15);
    const grab = !this.grounded && input.trick;
    if (grab) {
      // "No-hander": arms out wide.
      out.handL = null;
      out.handR = null;
      setArms(out, 1.3, 1.2, 0.2);
    } else {
      // Wrists sit just behind and above the grips.
      out.handL = this.local('gripL', out.handL ?? new THREE.Vector3()).add(WRIST_OFFSET);
      out.handR = this.local('gripR', out.handR ?? new THREE.Vector3()).add(WRIST_OFFSET);
    }
    this.local('pedalL', out.footL).y += 0.07;
    this.local('pedalR', out.footR).y += 0.07;
    out.kneePole.set(0.12, 0.25, 1);
    out.elbowPole.set(0.8, -0.35, -0.45);
    out.footYaw = 0;
    out.mirrorPoles = true;
    return out;
  }
}
