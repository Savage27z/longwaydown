import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { setArms, type PoseTargets } from '../player/Character';
import { clamp, damp } from '../utils/math';
import { ArcadeVehicle } from './ArcadeVehicle';
import { emptyInput, type TransferState, type VehicleContext, type VehicleInput } from './Vehicle';

/** Speed the runner keeps without input (m/s); W sprints up to the stats' top speed. */
const JOG_SPEED = 7;
const TWO_PI = Math.PI * 2;

/**
 * The race start: riders jog along the summit plateau (W to sprint, A/D to steer, Space to jump)
 * and run off the edge, where the wingsuit deploys. No vehicle model; the rider is the vehicle.
 */
export class OnFoot extends ArcadeVehicle {
  /** Keep jogging without input (the run-up). */
  autoJog = true;
  private readonly inp = emptyInput();
  private phase = 0;
  private stride = 0;
  private sprint = 0;
  private air = 0;

  constructor(physics: PhysicsWorld, state: TransferState) {
    super('onFoot', physics, state);
  }

  override fixedUpdate(dt: number, input: VehicleInput, ctx: VehicleContext): void {
    Object.assign(this.inp, input);
    const sprinting = input.throttle > 0.3;
    if (this.autoJog && !sprinting && input.brake < 0.1) this.inp.throttle = this.telemetry.speed < JOG_SPEED ? 0.8 : 0;
    super.fixedUpdate(dt, this.inp, ctx);
  }

  protected animate(dt: number): void {
    const speed = this.telemetry.speed;
    // Cadence rises with speed; strides lengthen toward a sprint.
    const cadence = clamp(1.3 + speed * 0.17, 1.3, 3.1);
    this.stride = damp(this.stride, clamp(speed / 9, 0, 1), 6, dt);
    this.sprint = damp(this.sprint, clamp((speed - JOG_SPEED) / 3, 0, 1), 4, dt);
    this.air = damp(this.air, this.grounded ? 0 : 1, 8, dt);
    if (this.stride > 0.02) this.phase = (this.phase + cadence * TWO_PI * dt) % (TWO_PI * 64);
  }

  pose(out: PoseTargets): PoseTargets {
    const k = this.stride;
    const a = this.phase;
    const reach = 0.28 + this.sprint * 0.14;
    const lift = 0.14 + this.sprint * 0.1;
    // Feet swing fore/aft out of phase; the foot swinging forward (z rising) is the lifted one.
    for (const [foot, side, ph] of [
      [out.footL, 1, a],
      [out.footR, -1, a + Math.PI],
    ] as const) {
      foot.set(side * 0.11, 0.08 + Math.max(0, -Math.sin(ph)) * lift * k, Math.cos(ph) * reach * k);
    }
    // Bounce twice per cycle, lean into the run.
    const bounce = Math.abs(Math.sin(a)) * 0.035 * k;
    out.hips.set(0, 0.93 - 0.05 * k + bounce, -0.02);
    out.hipsRot.set(0.05 + 0.1 * k, Math.sin(a) * 0.12 * k, 0);
    out.spine.set(0.08 + 0.14 * k + this.sprint * 0.08, -Math.sin(a) * 0.1 * k, -this.lean * 0.3);
    out.chest.set(0.02, -Math.sin(a) * 0.12 * k, 0);
    out.head.set(-(0.1 + 0.2 * k), 0, 0);
    // Arms pump opposite the legs, elbows bent; flung out wide when airborne.
    out.handL = null;
    out.handR = null;
    setArms(out, 0, 0.18, 0.4 + 1.0 * k);
    out.armL.pitch = -Math.cos(a) * 0.75 * k;
    out.armR.pitch = Math.cos(a) * 0.75 * k;
    out.armL.spread += this.air * 0.9;
    out.armR.spread += this.air * 0.9;
    out.kneePole.set(0, 0.1, 1);
    out.elbowPole.set(0.3, 0, -1);
    out.footYaw = 0;
    out.mirrorPoles = true;
    return out;
  }
}
