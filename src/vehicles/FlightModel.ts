import * as THREE from 'three';
import type { FlightStats } from '../config/vehicles';
import { clamp, damp, wrapAngle } from '../utils/math';
import type { VehicleInput } from './Vehicle';

const _fwd = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _e = new THREE.Euler();

/**
 * Arcade flight shared by every flyer (hover car, wingsuit). Attitude control rather than
 * rate control: the stick commands a nose angle and a bank, and both settle back to neutral
 * when released, so you can't end up in an unrecoverable dive by holding a key too long.
 *
 *   A / D        bank and turn (coordinated: the turn rate follows the bank)
 *   W / ↑        dive (gain speed)        S / ↓   pull up / flare (trade speed for height)
 *   Shift        thrust (powered flyers, uses the meter)
 *   Space        climb (hover car, uses the meter)
 *
 * Assists: stall recovery (nose down when too slow) and a gentle nose-up just above the terrain.
 * The vehicle owns heading and the rigid body; this owns pitch, bank and the 0..1 meter.
 */
export class FlightModel {
  pitch = 0;
  bank = 0;
  meter = 1;
  thrusting = false;

  constructor(private readonly stats: () => FlightStats) {}

  /** Returns the new heading. Mutates `v` (world velocity). */
  step(dt: number, input: VehicleInput, v: THREE.Vector3, heading: number, heightAboveGround: number): number {
    const f = this.stats();
    const speed = v.length();

    // Bank and a coordinated turn.
    this.bank = damp(this.bank, clamp(input.steer, -1, 1) * f.bankMax, f.bankResponse, dt);
    heading = wrapAngle(heading - (this.bank / f.bankMax) * f.yawRate * dt);

    // Attitude: W/↑ dive, S/↓ climb, neutral when released, plus assists.
    const dive = Math.max(input.throttle, Math.max(0, input.pitch));
    const climb = Math.max(input.brake, Math.max(0, -input.pitch));
    let target = f.neutralPitch + climb * f.pitchUp - dive * f.pitchDown;
    const slow = f.stallSpeed * 1.15;
    if (speed < slow) target = Math.min(target, f.neutralPitch - 0.3 * (1 - speed / slow));
    if (heightAboveGround < f.groundAssist && v.y < 0) target = Math.max(target, f.neutralPitch + 0.3 * (1 - heightAboveGround / f.groundAssist));
    this.pitch = damp(this.pitch, clamp(target, -1.2, 0.9), f.pitchResponse, dt);
    _fwd.set(Math.sin(heading) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(heading) * Math.cos(this.pitch));

    // Thrust (Shift) and climb (Space) burn the meter.
    this.thrusting = false;
    if (f.thrust > 0 && input.boost && this.meter > 0) {
      const fade = Math.max(0, 1 - speed / f.maxSpeed);
      v.addScaledVector(_fwd, f.thrust * (0.3 + 0.7 * fade) * dt);
      this.meter = Math.max(0, this.meter - f.drain * dt);
      this.thrusting = true;
    }
    if (f.climb > 0 && input.jumpHeld && this.meter > 0) {
      v.y += f.climb * dt;
      this.meter = Math.max(0, this.meter - f.drain * 0.6 * dt);
      this.thrusting = true;
    }

    // Lift: the flight path swings toward the nose; part of gravity is cancelled with airspeed.
    const liftK = Math.min(1, (speed / f.stallSpeed) ** 2);
    if (speed > 0.5) {
      _axis.crossVectors(v, _fwd);
      const s = _axis.length();
      if (s > 1e-6) {
        const angle = Math.atan2(s, v.dot(_fwd));
        v.applyAxisAngle(_axis.divideScalar(s), Math.min(angle, f.align * liftK * dt));
      }
    }
    v.y += 9.81 * f.gravity * f.lift * liftK * dt;

    // Soft ceiling above the terrain.
    if (heightAboveGround > f.ceiling) {
      const over = heightAboveGround - f.ceiling;
      v.y -= Math.min(15, over * 0.6) * dt * 4;
    }
    // Low gliding recharges the meter (when configured): only while not thrusting.
    if (f.lowGlideRecharge > 0 && !this.thrusting && heightAboveGround < f.lowGlideHeight) {
      this.meter = Math.min(1, this.meter + f.lowGlideRecharge * dt);
    }
    return heading;
  }

  recharge(dt: number): void {
    this.meter = Math.min(1, this.meter + this.stats().groundRecharge * dt);
  }

  /** Visual orientation for flight (nose up = negative X rotation). */
  quaternion(heading: number, out: THREE.Quaternion): THREE.Quaternion {
    return out.setFromEuler(_e.set(-this.pitch, heading, this.bank, 'YXZ'));
  }
}
