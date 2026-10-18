import * as THREE from 'three';
import { RIDING } from '../config/vehicles';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { PoseTargets } from '../player/Character';
import { createModel, type ModelOptions } from '../models/ModelLoader';
import { ROADSTER } from '../models/procedural/roadster';
import { clamp, damp } from '../utils/math';
import { ArcadeCar } from './ArcadeCar';
import type { TransferState, VehicleContext, VehicleInput } from './Vehicle';

const G = 9.81;
const TWO_PI = Math.PI * 2;
/**
 * Cold-gas thruster tank (0..1). Like the real car's stunt demo it doesn't fly: the thrusters
 * launch big jumps, help flip and spin, hold a short hover and cushion the landing. The tank
 * refills itself (an on-board compressor), faster on the ground.
 */
const TANK = {
  launchCost: 0.34,
  /** Jump speed multiplier when the launch thrusters fire (6.5 m/s hop -> ~12 m/s). */
  launchMul: 1.85,
  hoverDrain: 0.5,
  cushionDrain: 0.55,
  spinDrain: 0.08,
  refillGround: 0.22,
  refillAir: 0.04,
  /** Hover holds roughly this sink rate (m/s). */
  hoverSink: -1,
  /** Auto-cushion: below this height (m), approaching the ground faster than `cushionFrom` (m/s)... */
  cushionHeight: 6,
  cushionFrom: 7,
  /** ...brakes the approach toward this speed. */
  cushionTo: 3.5,
  /** Extra flip/spin rate from the side jets (rad/s at full stick). */
  sidePitch: 2.4,
  sideSpin: 1.6,
};
const PUFF_LIFE = 1.4;
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();

/**
 * Volt Roadster: an unbranded electric hypercar in the style of the 2026 thruster roadster.
 * Grippy (fan downforce glues it to crests), Space fires the cold-gas thrusters for a big jump,
 * hold Space in the air to hover briefly, stick + side jets for flips and spins, Shift fires the
 * rear thrusters for acceleration. Landings are cushioned automatically while there is gas.
 */
export class Roadster extends ArcadeCar {
  private charge = 1;
  private burst = 0;
  private downJet = 0;
  private sideJet = 0;
  private wingUp = 0;
  private time = 0;
  private readonly jets: Record<'jetDown' | 'jetSide' | 'jetRear', THREE.Object3D[]> = { jetDown: [], jetSide: [], jetRear: [] };
  private wing: THREE.Object3D | undefined;
  /** Cold-gas cloud left on the ground at launch and after a cushioned landing (world-fixed). */
  private readonly puff: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  private readonly puffAt = new THREE.Vector3();
  private puffT = PUFF_LIFE;
  private puffPending = false;
  private cushioned = false;

  constructor(physics: PhysicsWorld, state: TransferState, paint: ModelOptions = { primary: '#e3e5e8', secondary: '#3a3f47' }) {
    super('roadster', physics, state, createModel('vehicle:roadster', paint), {
      wheels: [
        { name: 'wheelFL', x: ROADSTER.wheelX, z: ROADSTER.wheelZ, front: true },
        { name: 'wheelFR', x: -ROADSTER.wheelX, z: ROADSTER.wheelZ, front: true },
        { name: 'wheelRL', x: ROADSTER.wheelX, z: -ROADSTER.wheelZ, front: false },
        { name: 'wheelRR', x: -ROADSTER.wheelX, z: -ROADSTER.wheelZ, front: false },
      ],
      hubY: ROADSTER.wheelY,
      radius: ROADSTER.wheelRadius,
      travel: 0.08,
      modelLift: ROADSTER.wheelRadius - ROADSTER.wheelY,
      steeringWheel: 'steeringWheel',
      maxSteer: 0.5,
      steeringRatio: 1.8,
    });
    for (const key of Object.keys(this.jets) as (keyof typeof this.jets)[]) {
      this.m.getObjectByName(key)?.traverse((o) => {
        if (o.name === 'plume') this.jets[key].push(o);
      });
    }
    this.wing = this.m.getObjectByName('wing');
    this.puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: '#f2f5f7', transparent: true, opacity: 0, depthWrite: false }));
    this.puff.visible = false;
    this.model.add(this.puff);
    // Suction fans: stays glued over crests where other cars go light.
    this.crestStickMul = 1.8;
    this.telemetry.flightMeter = 1;
  }

  protected override preStep(dt: number, input: VehicleInput, ctx: VehicleContext): void {
    super.preStep(dt, input, ctx);
    // Space is the thruster jump on the roadster, not the handbrake.
    this.handbrake = false;
    this.burst = Math.max(0, this.burst - dt);
    if (this.grounded) {
      if (this.cushioned) this.puffPending = true;
      this.cushioned = false;
      this.downJet = 0;
      this.sideJet = 0;
      this.charge = Math.min(1, this.charge + TANK.refillGround * dt);
    }
    this.telemetry.flightMeter = this.charge;
  }

  /** Fan downforce: a little more cornering grip than a normal sports car. */
  protected override gripMultiplier(): number {
    return 1.15;
  }

  /** The jump fires the launch thrusters when there is gas for it (plain hop otherwise). */
  protected override jumpMultiplier(): number {
    if (this.charge < TANK.launchCost) return 1;
    this.charge -= TANK.launchCost;
    this.burst = 0.45;
    this.puffPending = true;
    return TANK.launchMul;
  }

  /** Air: hover, landing cushion and side jets on top of the normal air controls. */
  protected override flightStep(dt: number, input: VehicleInput, _ctx: VehicleContext, v: THREE.Vector3): boolean {
    const gAir = G * this.stats.gravityScale * RIDING.airGravityMul;
    const h = this.airGroundDist;
    // The down jets are fixed to the car: they only hold it up while it is roughly upright.
    const upright = Math.max(0, _up.set(0, 1, 0).applyQuaternion(this.currQuat).y);
    let down = 0;
    let firing = false;
    if (this.charge > 0 && this.burst < 0.2 && upright > 0.2) {
      if (input.jumpHeld) {
        // Hover: thrust to hold a slow sink, a couple of seconds at most.
        const a = clamp((TANK.hoverSink - v.y) * 4 + gAir, 0, gAir * 1.6) * upright;
        v.y += a * dt;
        down = a / (gAir * 1.6);
        this.charge -= TANK.hoverDrain * dt * down;
        firing = a > 0;
      } else if (h < TANK.cushionHeight) {
        // Cushion: brake the approach toward the landing slope.
        const n = this.airGroundNormal;
        const approach = -v.dot(n);
        if (approach > TANK.cushionFrom) {
          const a = Math.min((approach - TANK.cushionTo) * 5, gAir * 2.2) * upright;
          v.y += a * dt;
          this.charge -= TANK.cushionDrain * dt * (a / (gAir * 2.2));
          down = a / (gAir * 2.2);
          firing = true;
          this.cushioned = true;
        }
      }
    }
    // Side jets: faster flips and spins while there is gas.
    const rot = Math.max(Math.abs(input.pitch), Math.abs(input.spin));
    if (this.charge > 0 && rot > 0.1) {
      this.trickPitch += input.pitch * TANK.sidePitch * dt;
      this.trickYaw -= input.spin * TANK.sideSpin * dt;
      this.charge -= TANK.spinDrain * dt * rot;
      firing = true;
    } else if (this.charge > 0 && h < 10) {
      // Hands off near the ground: the nozzle ring rolls it back onto its wheels.
      this.trickPitch = damp(this.trickPitch, Math.round(this.trickPitch / TWO_PI) * TWO_PI, 4, dt);
      this.trickYaw = damp(this.trickYaw, Math.round(this.trickYaw / TWO_PI) * TWO_PI, 4, dt);
    }
    if (!firing) this.charge += TANK.refillAir * dt;
    this.charge = clamp(this.charge, 0, 1);
    this.downJet = down;
    this.sideJet = this.charge > 0 ? rot : 0;
    // The normal air step still runs (steer, trick input, boost, landing assist).
    return false;
  }

  /** Reclined low in the tub, like a race car. */
  override pose(out: PoseTargets): PoseTargets {
    super.pose(out);
    out.hipsRot.set(-0.6, 0, 0);
    out.spine.set(0.12, 0, 0);
    return out;
  }

  protected override animateExtras(dt: number): void {
    this.time += dt;
    const air = !this.grounded;
    const fast = this.telemetry.speed > 24;
    this.wingUp = damp(this.wingUp, air || fast || this.telemetry.boosting ? 1 : 0, 4, dt);
    if (this.wing) {
      this.wing.position.y = 0.31 + this.wingUp * 0.34;
      this.wing.rotation.x = -this.wingUp * 0.14;
    }
    this.animatePuff(dt);
    const levels = {
      jetDown: Math.max(this.burst > 0 ? 1 : 0, this.downJet),
      jetSide: this.sideJet,
      jetRear: this.telemetry.boosting ? 1 : 0,
    };
    for (const key of Object.keys(this.jets) as (keyof typeof this.jets)[]) {
      const lv = levels[key];
      this.jets[key].forEach((p, i) => {
        p.visible = lv > 0.05;
        if (!p.visible) return;
        const flicker = 1 + Math.sin(this.time * 47 + i * 1.7) * 0.12;
        const len = (key === 'jetDown' ? 1.6 : 1.0) * (0.4 + lv * 0.8) * flicker;
        p.scale.set(0.7 + lv * 0.6, len, 0.7 + lv * 0.6);
      });
    }
  }

  private animatePuff(dt: number): void {
    if (this.puffPending) {
      this.puffPending = false;
      // The model origin sits on the ground under the car.
      this.puffAt.copy(this.model.position);
      this.puffT = 0;
    }
    this.puffT += dt;
    const k = this.puffT / PUFF_LIFE;
    this.puff.visible = k < 1;
    if (!this.puff.visible) return;
    // Keep the cloud fixed in the world while the car flies off.
    _q.copy(this.model.quaternion).invert();
    this.puff.quaternion.copy(_q);
    this.puff.position.copy(this.puffAt).sub(this.model.position).applyQuaternion(_q);
    const r = 1.2 + Math.sqrt(k) * 3.6;
    this.puff.scale.set(r, r * 0.32, r);
    this.puff.material.opacity = 0.55 * (1 - k) * (1 - k);
  }
}
