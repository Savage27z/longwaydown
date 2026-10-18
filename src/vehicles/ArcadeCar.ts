import * as THREE from 'three';
import { GROUND_QUERY } from '../physics/PhysicsWorld';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { PoseTargets } from '../player/Character';
import type { VehicleId } from '../config/vehicles';
import { clamp, damp } from '../utils/math';
import { ArcadeVehicle } from './ArcadeVehicle';
import type { TransferState, VehicleContext, VehicleInput } from './Vehicle';

const _o = new THREE.Vector3();
const _up = new THREE.Vector3();

/** Where a car model's wheels sit (model-local, +X left, +Z forward). */
export interface CarLayout {
  wheels: { name: string; x: number; z: number; front: boolean }[];
  /** Wheel hub height and radius at rest (model-local), and visual suspension travel (m). */
  hubY: number;
  radius: number;
  travel: number;
  /** Lift applied to the model so the tyres touch the ground at rest. */
  modelLift: number;
  steeringWheel?: string;
  /** Visual front-wheel lock (rad) and steering-wheel turns per unit of lock. */
  maxSteer: number;
  steeringRatio: number;
}

/**
 * Four-wheel arcade car on the same controller as the bikes: predictable, can't flip by itself,
 * handbrake drifts (Space). Per-wheel ground rays drive the visual suspension and the chassis
 * rolls/pitches on its springs while the wheels stay planted.
 */
export abstract class ArcadeCar extends ArcadeVehicle {
  protected readonly m: THREE.Object3D;
  protected readonly chassis = new THREE.Group();
  private wheelNodes: (THREE.Object3D | undefined)[];
  private wheelOffset: number[];
  private wheelVis: number[];
  private wheelSpin = 0;
  private steerVis = 0;
  private roll = 0;
  private pitch = 0;
  private lastFwd = 0;
  private lonAcc = 0;
  protected steerIn = 0;
  protected throttleIn = 0;
  protected brakeIn = 0;
  protected handbrake = false;

  constructor(id: VehicleId, physics: PhysicsWorld, state: TransferState, model: THREE.Object3D, protected readonly layout: CarLayout) {
    super(id, physics, state);
    this.leanFactor = 0;
    this.canReverse = true;
    this.trickPivot = 0.2;
    this.m = model;
    model.position.y = layout.modelLift;
    // Split the wheels from the body so the chassis can roll on its springs.
    const wheelNames = new Set(layout.wheels.map((w) => w.name));
    for (const child of [...model.children]) if (!wheelNames.has(child.name)) this.chassis.add(child);
    model.add(this.chassis);
    this.model.add(model);
    this.wheelNodes = layout.wheels.map((w) => model.getObjectByName(w.name));
    this.wheelOffset = layout.wheels.map(() => 0);
    this.wheelVis = layout.wheels.map(() => 0);
  }

  protected override preStep(_dt: number, input: VehicleInput, ctx: VehicleContext): void {
    this.steerIn = input.steer;
    this.throttleIn = input.throttle;
    this.brakeIn = input.brake;
    this.handbrake = input.jumpHeld;
    this.probeWheels(ctx);
  }

  /** Handbrake: the rear steps out (less grip) and the car rotates faster. */
  protected override gripMultiplier(): number {
    return this.handbrake && this.telemetry.speed > 5 ? 0.32 : 1;
  }

  protected override steerMultiplier(): number {
    return this.handbrake ? 1.6 : 1;
  }

  /** One ground ray per wheel: how far each tyre is pushed up (+) or hangs down (-). */
  private probeWheels(ctx: VehicleContext): void {
    const L = this.layout;
    const t = this.body.translation();
    _up.set(0, 1, 0).applyQuaternion(this.currQuat);
    const reach = L.radius + L.travel + 0.6;
    L.wheels.forEach((w, i) => {
      if (!this.grounded) {
        this.wheelOffset[i] = -L.travel;
        return;
      }
      // Hub in world space: body centre, down to the model origin (ground), then up to the hub.
      _o.set(w.x, L.hubY + L.modelLift, w.z).applyQuaternion(this.currQuat);
      _o.x += t.x - _up.x * this.stats.rideHeight;
      _o.y += t.y - _up.y * this.stats.rideHeight + 0.5;
      _o.z += t.z - _up.z * this.stats.rideHeight;
      const hit = ctx.physics.raycast(_o.x, _o.y, _o.z, 0, -1, 0, reach, GROUND_QUERY, this.body);
      this.wheelOffset[i] = hit ? clamp(L.radius - (hit.distance - 0.5), -L.travel, L.travel * 0.8) : -L.travel;
    });
  }

  protected animate(dt: number): void {
    const L = this.layout;
    const fwd = this.telemetry.forwardSpeed;
    this.wheelSpin += (fwd / L.radius) * dt;
    const fade = 1 - clamp(this.telemetry.speed / 45, 0, 0.6);
    this.steerVis = damp(this.steerVis, -this.steerIn * L.maxSteer * fade, 10, dt);
    L.wheels.forEach((w, i) => {
      const node = this.wheelNodes[i];
      if (!node) return;
      this.wheelVis[i] = damp(this.wheelVis[i]!, this.wheelOffset[i]!, 22, dt);
      node.position.y = L.hubY + this.wheelVis[i]!;
      node.rotation.set(0, 0, 0);
      if (w.front) node.rotateY(this.steerVis);
      node.rotateX(this.wheelSpin);
    });
    if (L.steeringWheel) {
      const sw = this.chassis.getObjectByName(L.steeringWheel);
      if (sw) sw.rotation.z = this.steerVis * L.steeringRatio;
    }
    // Body on its springs: rolls out of corners, squats under power, dives under braking.
    if (dt > 0) this.lonAcc = damp(this.lonAcc, (fwd - this.lastFwd) / dt, 6, dt);
    this.lastFwd = fwd;
    const lat = this.grounded ? this.telemetry.speed * this.yawRate : 0;
    this.roll = damp(this.roll, clamp(lat * 0.009, -0.09, 0.09), 5, dt);
    this.pitch = damp(this.pitch, clamp(-this.lonAcc * 0.006, -0.07, 0.07) + this.telemetry.compression * 0.02, 5, dt);
    const avg = this.wheelVis.reduce((a, b) => a + b, 0) / Math.max(1, this.wheelVis.length);
    this.chassis.position.y = avg * 0.6;
    this.chassis.rotation.set(this.pitch, 0, this.roll);
    this.animateExtras(dt);
  }

  /** Model-specific animation (lights, thrusters...). */
  protected animateExtras(_dt: number): void {}

  /** Seated driver: hands on the wheel, feet on the pedals. */
  pose(out: PoseTargets): PoseTargets {
    this.model.updateMatrixWorld(true);
    this.partLocal(this.m, 'seat', out.hips).y += 0.12;
    out.hipsRot.set(-0.35, 0, 0);
    out.spine.set(0.1, 0, 0);
    out.chest.set(0.05, 0, 0);
    out.head.set(0.15, this.steerVis * 0.6, 0);
    out.handL = this.partLocal(this.m, 'gripL', out.handL ?? new THREE.Vector3());
    out.handR = this.partLocal(this.m, 'gripR', out.handR ?? new THREE.Vector3());
    // Right foot on the gas, left foot on the brake.
    this.partLocal(this.m, 'pedalL', out.footL).z += this.brakeIn * 0.06;
    this.partLocal(this.m, 'pedalR', out.footR).z += this.throttleIn * 0.06;
    out.footL.y -= this.brakeIn * 0.03;
    out.footR.y -= this.throttleIn * 0.03;
    out.kneePole.set(0.15, 1, 0.6);
    out.elbowPole.set(0.6, -0.6, -0.4);
    out.footYaw = 0;
    out.mirrorPoles = true;
    return out;
  }
}
