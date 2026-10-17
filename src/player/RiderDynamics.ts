import * as THREE from 'three';
import { BODY_MOTION, SWITCH_HOP, type BodyMotion } from '../config/riderMotion';
import type { VehicleId } from '../config/vehicles';
import type { VehicleInput } from '../vehicles/Vehicle';
import { clamp, damp, wrapAngle } from '../utils/math';
import { setArms, type FreeArm, type PoseTargets } from './rig/pose';

const _a = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _l = new THREE.Vector3();
const TWO_PI = Math.PI * 2;

/** What the body layer needs to know each render frame. */
export interface MotionFrame {
  vehicle: VehicleId;
  /** Vehicle orientation (render). */
  quaternion: THREE.Quaternion;
  input: VehicleInput;
  speed: number;
  grounded: boolean;
  heading: number;
  /** Height of the vehicle above the ground (m) and vertical speed (m/s), for landing prediction. */
  height: number;
  vy: number;
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Rotate a small tilt given in the vehicle frame (about X = pitch, Z = roll) into a yawed body frame. */
function addTilt(e: THREE.Euler, tx: number, tz: number, yaw: number): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  e.x += tx * c - tz * s;
  e.z += tx * s + tz * c;
}

/** Smooth 1D noise from a few incommensurate sines (-1..1). */
function wobble(t: number, seed: number): number {
  return Math.sin(t * 23.7 + seed) * 0.5 + Math.sin(t * 37.1 + seed * 2.3) * 0.3 + Math.sin(t * 13.3 + seed * 4.1) * 0.2;
}

/**
 * Makes the rider ride the vehicle instead of being glued to it. The body is a damped spring
 * between hands and feet: landings compress it, braking throws it forward, corners push it
 * out, rough ground shakes it and weightlessness floats it. On top: takeoff pop, air tuck,
 * reaching for the landing, a torso throw into flips/spins, eyes kept level, and a hop when
 * switching vehicles. Works on any vehicle's pose, in the vehicle frame (x left, y up, z forward).
 */
export class RiderDynamics {
  /** Body offset from the posed position and its velocity (vehicle frame). */
  readonly offset = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private prevV = new THREE.Vector3();
  private primed = false;
  /** Slowly adapting "normal" vertical load, so steady slopes don't read as compression. */
  private baseY = 14.7;
  private wasGrounded = true;
  private time = 0;
  private airT = 0;
  private air = 0;
  private tuck = 0;
  private reach = 0;
  private lastHeading = 0;
  private yawRate = 0;
  private spinThrow = 0;
  private pitchThrow = 0;
  private hopT = 1;
  private glance = 0;
  private glanceTarget = 0;
  private glanceTimer = 2;

  /** Forget motion history (respawn, teleport, vehicle switch). */
  reset(): void {
    this.primed = false;
    this.offset.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.air = this.tuck = this.reach = this.airT = 0;
    this.spinThrow = this.pitchThrow = 0;
  }

  /** Play the switch hop (off one vehicle, onto the next). */
  hop(): void {
    this.hopT = 0;
  }

  /** After every physics step: the felt acceleration drives the body spring. */
  step(dt: number, vehicle: VehicleId, velocity: Vec3Like, quat: THREE.Quaternion, gravity: number, grounded: boolean, rough: number, speed: number): void {
    const p = BODY_MOTION[vehicle];
    this.time += dt;
    if (!this.primed) {
      this.prevV.set(velocity.x, velocity.y, velocity.z);
      this.primed = true;
      this.wasGrounded = grounded;
      return;
    }
    // Specific force (what the rider's inner ear feels), in the vehicle frame.
    _a.set(velocity.x - this.prevV.x, velocity.y - this.prevV.y, velocity.z - this.prevV.z).divideScalar(dt);
    this.prevV.set(velocity.x, velocity.y, velocity.z);
    _a.y += gravity;
    _a.applyQuaternion(_q.copy(quat).invert());
    const takeoff = this.wasGrounded && !grounded;
    this.wasGrounded = grounded;
    if (grounded) this.baseY += (clamp(_a.y, gravity * 0.5, gravity * 1.3) - this.baseY) * (1 - Math.exp(-dt / 1.2));
    let dx = clamp(_a.x, -90, 90);
    let dy = clamp(_a.y - this.baseY, -90, 90);
    let dz = clamp(_a.z, -90, 90);
    if (takeoff) {
      // A jump adds its speed in one step: that is the rider's own push, so pop up instead of squashing.
      dx = dy = dz = 0;
      this.vel.y += p.pop;
    }
    const w = TWO_PI * p.freq;
    const k = w * w;
    const c = 2 * p.damping * w;
    const o = this.offset;
    const v = this.vel;
    const buzz = grounded ? p.buzz * rough * clamp(speed / 22, 0, 1) * wobble(this.time, 1.7) : 0;
    v.x += (-p.gain[0] * dx - k * o.x - c * v.x) * dt;
    v.y += (-p.gain[1] * dy - k * o.y - c * v.y + buzz) * dt;
    v.z += (-p.gain[2] * dz - k * o.z - c * v.z) * dt;
    o.addScaledVector(v, dt);
    this.limit(p);
  }

  private limit(p: BodyMotion): void {
    const o = this.offset;
    const v = this.vel;
    if (Math.abs(o.x) > p.maxLat) {
      o.x = Math.sign(o.x) * p.maxLat;
      v.x *= -0.2;
    }
    if (o.y < -p.maxDown || o.y > p.maxUp) {
      o.y = clamp(o.y, -p.maxDown, p.maxUp);
      v.y *= -0.2;
    }
    if (Math.abs(o.z) > p.maxFore) {
      o.z = Math.sign(o.z) * p.maxFore;
      v.z *= -0.2;
    }
  }

  /** Per render frame: layer the body motion onto the vehicle's pose. */
  apply(out: PoseTargets, dt: number, m: MotionFrame): void {
    const p = BODY_MOTION[m.vehicle];
    if (dt > 0) this.yawRate = damp(this.yawRate, clamp(wrapAngle(m.heading - this.lastHeading) / dt, -4, 4), 8, dt);
    this.lastHeading = m.heading;

    // --- Air phases: pop (from the spring), tuck, reach for the landing, absorb (from the spring) ---
    const airborne = !m.grounded;
    this.airT = airborne ? this.airT + dt : 0;
    const ttg = airborne && m.vy < -0.5 && Number.isFinite(m.height) ? Math.max(0, m.height) / -m.vy : Infinity;
    const wantTuck = airborne && this.airT > 0.1 && ttg > 0.3 ? 1 : 0;
    const wantReach = airborne && this.airT > 0.2 && ttg <= 0.3 ? 1 : 0;
    this.tuck = damp(this.tuck, wantTuck, 7, dt);
    this.reach = damp(this.reach, wantReach, 10, dt);
    this.air = damp(this.air, airborne ? 1 : 0, airborne ? 5 : 10, dt);
    this.spinThrow = damp(this.spinThrow, airborne ? m.input.spin : 0, 6, dt);
    this.pitchThrow = damp(this.pitchThrow, airborne ? m.input.pitch : 0, 6, dt);

    // --- Body position ---
    const o = this.offset;
    const h = p.hipsShare;
    const speedK = clamp((m.speed - 12) / 25, 0, 1) * (airborne ? 0 : 1);
    const crouch = p.speedCrouch * speedK;
    out.hips.x += o.x * h;
    out.hips.y += o.y * Math.min(1, h * 1.3) - this.tuck * p.airTuck + this.reach * p.airReach - crouch;
    out.hips.z += o.z * h - this.pitchThrow * 0.06 * h - this.tuck * p.airBack;

    // --- Torso: what the hips don't take, the spine does (seated riders sway, standing riders bend) ---
    const sway = 0.4 + (1 - h) * 0.9;
    const tx = o.z * p.torsoPitch * sway + Math.max(0, -o.y) * 1.3 + this.tuck * (0.12 + p.airBack * 2.5) + this.pitchThrow * p.airThrow + crouch * 2.5;
    const tz = -o.x * p.torsoRoll * sway;
    const hipsYaw = out.hipsRot.y;
    addTilt(out.spine, tx * 0.6, tz * 0.6, hipsYaw);
    addTilt(out.chest, tx * 0.4, tz * 0.4, hipsYaw + out.spine.y);
    // Wind up into spins: shoulders lead, head leads further.
    out.chest.y -= this.spinThrow * p.airThrow;
    // Breathing.
    out.chest.x += Math.sin(this.time * 1.9) * 0.012;

    // --- Head: keep the eyes level, look into turns and down at the landing, glance around when slow ---
    _f.set(0, 0, 1).applyQuaternion(m.quaternion);
    _l.set(1, 0, 0).applyQuaternion(m.quaternion);
    const vPitch = Math.asin(clamp(_f.y, -1, 1));
    const vRoll = Math.asin(clamp(_l.y, -1, 1));
    const lookDown = airborne ? clamp(-m.vy * 0.045, 0, 0.35) * this.air : 0;
    const headYaw = hipsYaw + out.spine.y + out.chest.y;
    // Riders look down the trail, not at the horizon: only half the slope is cancelled.
    addTilt(out.head, vPitch * p.headLevel * 0.5 - tx * 0.75 + lookDown, -vRoll * p.headLevel - tz * 0.75, headYaw);
    this.updateGlance(dt, m);
    out.head.y += clamp(this.yawRate * p.headTurn, -0.5, 0.5) - this.spinThrow * p.airThrow * 0.7 + this.glance;

    // --- Free arms balance (boards, skis, no-handers) ---
    if (!out.handL) this.balanceArm(out.armL, p, 1);
    if (!out.handR) this.balanceArm(out.armR, p, -1);

    this.applyHop(out, dt);
  }

  private balanceArm(arm: FreeArm, p: BodyMotion, side: number): void {
    const o = this.offset;
    arm.spread += this.air * p.airArms * 0.6 + Math.max(0, -o.y) * 1.6 + o.x * side * 2.5;
    arm.pitch += this.air * p.airArms * 0.35 - o.z * 2.5 + this.pitchThrow * 0.3;
    arm.bend += this.tuck * 0.3;
  }

  private updateGlance(dt: number, m: MotionFrame): void {
    this.glanceTimer -= dt;
    const calm = m.grounded && m.speed < 9;
    if (this.glanceTimer <= 0) {
      this.glanceTimer = 1.8 + Math.random() * 2.5;
      this.glanceTarget = calm ? (Math.random() - 0.5) * 0.9 : 0;
    }
    if (!calm) this.glanceTarget = 0;
    this.glance = damp(this.glance, this.glanceTarget, 3, dt);
  }

  /** Switch hop: an arc up and back down with the feet off and arms out. */
  private applyHop(out: PoseTargets, dt: number): void {
    if (this.hopT >= 1) return;
    this.hopT = Math.min(1, this.hopT + dt / SWITCH_HOP.duration);
    const s = Math.sin(this.hopT * Math.PI);
    out.hips.y += s * SWITCH_HOP.height;
    out.footL.y += s * SWITCH_HOP.height * 0.55;
    out.footR.y += s * SWITCH_HOP.height * 0.55;
    out.spine.x -= s * 0.2;
    if (this.hopT < 0.8) {
      out.handL = null;
      out.handR = null;
      setArms(out, 0.5, 0.75 + s * 0.4, 0.5);
    }
  }
}
