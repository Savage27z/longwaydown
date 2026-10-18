import type { VehicleId } from '../config/vehicles';
import { damp } from '../utils/math';
import type { PoseTargets } from './rig/pose';

const BIKES = new Set<VehicleId>(['bicycle', 'mountainBike', 'motorbike']);
const BOARDS = new Set<VehicleId>(['snowboard', 'skis']);

/**
 * Body language for air tricks, layered over the vehicle's pose: riders tuck into flips and
 * spins (hips drop, chest folds over the bike or board, arms pull in) and look into the
 * rotation, then open up again for the landing.
 */
export class TrickPose {
  private tuck = 0;
  private look = 0;

  apply(out: PoseTargets, dt: number, vehicle: VehicleId, airborne: boolean, pitchVel: number, yawVel: number, pitchRate: number, spinRate: number): void {
    const flip = pitchRate > 0 ? Math.min(1, Math.abs(pitchVel) / pitchRate) : 0;
    const spin = spinRate > 0 ? Math.min(1, Math.abs(yawVel) / spinRate) : 0;
    const rotating = airborne ? Math.max(flip, spin * 0.8) : 0;
    this.tuck = damp(this.tuck, rotating, rotating > this.tuck ? 10 : 6, dt);
    // Head turns into a spin, and tips back to spot the landing through a backflip.
    this.look = damp(this.look, airborne ? Math.sign(yawVel) * spin : 0, 8, dt);
    const t = this.tuck;
    if (t < 0.01 && Math.abs(this.look) < 0.01) return;
    if (BIKES.has(vehicle)) {
      // Pull the bike up into the body: hips sink toward the saddle, chest over the bars.
      out.hips.y -= 0.12 * t;
      out.hips.z += 0.06 * t;
      out.spine.x += 0.35 * t;
      out.chest.x += 0.15 * t;
      out.head.x -= 0.25 * t * Math.sign(pitchVel || 1);
    } else if (BOARDS.has(vehicle)) {
      // Knees to the chest over the board, arms tucked.
      out.hips.y -= 0.3 * t;
      out.spine.x += 0.4 * t;
      out.chest.x += 0.15 * t;
      if (!out.handL) {
        out.armL.spread *= 1 - 0.6 * t;
        out.armL.bend += 0.8 * t;
      }
      if (!out.handR) {
        out.armR.spread *= 1 - 0.6 * t;
        out.armR.bend += 0.8 * t;
      }
    } else if (vehicle === 'onFoot') {
      out.hips.y -= 0.25 * t;
      out.spine.x += 0.3 * t;
    }
    out.head.y -= this.look * 0.6;
  }

  reset(): void {
    this.tuck = 0;
    this.look = 0;
  }
}
