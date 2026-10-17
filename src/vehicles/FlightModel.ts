import * as THREE from 'three';
import type { FlightStats } from '../config/vehicles';
import { clamp, damp, wrapAngle } from '../utils/math';
import type { RideModifiers, VehicleInput } from './Vehicle';

const _fwd = new THREE.Vector3();
const _axis = new THREE.Vector3();

/**
 * Arcade flight shared by the hover car and the jet. Owns pitch/bank and a 0..1 meter
 * (flight energy / fuel). The vehicle owns heading and the rigid body.
 *
 * Controls: W thrust, S air-brake, A/D yaw (banks), arrows pitch (up = nose down),
 * Space climbs, Shift boosts.
 */
export class FlightModel {
  pitch = 0;
  bank = 0;
  meter = 1;
  thrusting = false;

  constructor(private readonly stats: () => FlightStats) {}

  /** Returns the new heading. Mutates `v` (world velocity). */
  step(dt: number, input: VehicleInput, v: THREE.Vector3, heading: number, heightAboveGround: number, mods: RideModifiers, boostAccel: number): number {
    const f = this.stats();
    // Yaw + bank.
    const yawRate = -input.steer * f.yawRate;
    heading = wrapAngle(heading + yawRate * dt);
    this.bank = damp(this.bank, clamp(input.steer * f.bankMax, -f.bankMax, f.bankMax), 4, dt);
    // Pitch: Space climbs, arrows pitch (forward = nose down); level out when idle.
    const pitchIn = (input.jumpHeld ? 1 : 0) - input.pitch;
    if (Math.abs(pitchIn) > 0.05) this.pitch = clamp(this.pitch + pitchIn * f.pitchRate * dt, -1.1, 1.0);
    else this.pitch = damp(this.pitch, 0, 0.8, dt);

    const speed = v.length();
    _fwd.set(Math.sin(heading) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(heading) * Math.cos(this.pitch));

    // Thrust (fades toward max speed), boost, air brake.
    this.thrusting = input.throttle > 0.05 && this.meter > 0;
    if (this.thrusting) {
      const fade = Math.max(0, 1 - speed / f.maxSpeed);
      v.addScaledVector(_fwd, f.thrust * input.throttle * (0.25 + 0.75 * fade) * dt);
      this.meter = Math.max(0, this.meter - f.drain * dt * (0.3 + 0.7 * input.throttle));
    }
    if (input.boost && mods.boostAvailable && this.meter > 0) v.addScaledVector(_fwd, boostAccel * dt);
    if (input.brake > 0) v.multiplyScalar(1 - Math.min(0.5, input.brake * 0.9 * dt));

    // Lift: velocity swings toward the nose; gravity is partly cancelled with airspeed.
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
      this.pitch = damp(this.pitch, -0.3, 1.5, dt);
    }
    // Low gliding recharges (jet): only while not thrusting.
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
    return out.setFromEuler(new THREE.Euler(-this.pitch, heading, this.bank, 'YXZ'));
  }
}
