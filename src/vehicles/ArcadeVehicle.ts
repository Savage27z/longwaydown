import * as THREE from 'three';
import { SNOW_SURFACES, SURFACE_PHYSICS, SURFACES, type SurfaceId } from '../config/surfaces';
import { RIDING, type VehicleId } from '../config/vehicles';
import { Group, groups, GROUND_QUERY, type PhysicsWorld } from '../physics/PhysicsWorld';
import { R } from '../physics/rapier';
import { InterpolatedTransform } from '../utils/Interp';
import { clamp, damp, lerp, wrapAngle } from '../utils/math';
import { Vehicle, type TransferState, type VehicleContext, type VehicleInput } from './Vehicle';

const UP = new THREE.Vector3(0, 1, 0);
const TWO_PI = Math.PI * 2;
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * Arcade ground physics shared by bikes, boards and skis: a rotation-locked dynamic sphere with
 * two suspension rays, speed-preserving carving grip, surface-dependent rolling/soft drag,
 * quadratic aero drag, hops, and free air rotation for tricks. Orientation is controller state
 * (heading + smoothed ground normal), so the rider can never tip over by accident.
 */
export abstract class ArcadeVehicle extends Vehicle {
  heading = 0;
  readonly normal = new THREE.Vector3(0, 1, 0);
  readonly groundNormal = new THREE.Vector3(0, 1, 0);
  grounded = false;
  airTime = 0;
  groundTime = 0;
  lean = 0;
  yawRate = 0;
  trickPitch = 0;
  trickYaw = 0;
  grabTime = 0;
  maxHeight = 0;
  surface: SurfaceId = 'packed';
  /** Allow landing backwards (boards). */
  protected allowSwitch = false;
  protected tuck = false;
  protected jumpGrace = 0;
  /** Buffered jump press (s left) and whether the coyote jump was used this airtime. */
  protected jumpBufferT = 0;
  protected coyoteUsed = false;
  protected perpDist = 0;
  protected visualDrop = 0;
  protected airGroundDist = Infinity;
  protected readonly airGroundNormal = new THREE.Vector3(0, 1, 0);
  protected readonly interp = new InterpolatedTransform();
  protected readonly prevQuat = new THREE.Quaternion();
  protected readonly currQuat = new THREE.Quaternion();
  protected readonly v = new THREE.Vector3();
  protected readonly f = new THREE.Vector3();
  protected readonly r = new THREE.Vector3();
  protected readonly vt = new THREE.Vector3();
  protected tangentSpeedBefore = 0;
  /** Subclasses (flyers) can override the gravity scale; null = stats.gravityScale. */
  protected gravityOverride: number | null = null;
  /** Most recent ground distance (air), exposed for flight models. */
  get groundDistance(): number {
    return this.grounded ? this.perpDist : this.airGroundDist;
  }
  protected tookOff = false;
  protected lastAlpha = 1;

  constructor(id: VehicleId, physics: PhysicsWorld, state: TransferState) {
    super(id);
    const RAPIER = R();
    const s = this.stats;
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().lockRotations().setCcdEnabled(true).setCanSleep(false).setTranslation(state.position.x, state.position.y, state.position.z),
    );
    physics.world.createCollider(
      RAPIER.ColliderDesc.ball(s.colliderRadius)
        .setMass(s.mass)
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0)
        .setCollisionGroups(groups(Group.VEHICLE, Group.TERRAIN | Group.PROP)),
      this.body,
    );
    this.place(state);
  }

  place(state: TransferState): void {
    const p = state.position;
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.body.setLinvel({ x: state.velocity.x, y: state.velocity.y, z: state.velocity.z }, true);
    this.heading = state.heading;
    this.normal.copy(UP);
    this.trickPitch = 0;
    this.trickYaw = 0;
    this.grabTime = 0;
    this.airTime = 0;
    this.lean = 0;
    this.jumpGrace = 0;
    this.interp.snap(p.x, p.y, p.z);
    this.interp.capture(this.body);
    this.computeQuat();
    this.prevQuat.copy(this.currQuat);
    this.visualDrop = this.stats.rideHeight;
  }

  transfer(): TransferState {
    const t = this.body.translation();
    const v = this.body.linvel();
    return { position: new THREE.Vector3(t.x, t.y, t.z), velocity: new THREE.Vector3(v.x, v.y, v.z), heading: this.heading };
  }

  /** Subclass hook for special inputs (pedalling animation, carving, wheelies...). */
  protected preStep(_dt: number, _input: VehicleInput, _ctx: VehicleContext): void {}

  /** How much of the physical lean into turns is shown (bikes/boards lean in; cars roll on springs instead). */
  protected leanFactor = 1;
  /** Cars: brake from (near) standstill engages reverse, up to reverseMax (m/s). */
  protected canReverse = false;
  protected reverseMax = 7;

  fixedUpdate(dt: number, input: VehicleInput, ctx: VehicleContext): void {
    const s = this.stats;
    const phys = ctx.physics;
    const mods = ctx.mods;
    this.prevQuat.copy(this.currQuat);
    this.preStep(dt, input, ctx);
    const t = this.body.translation();
    const lv = this.body.linvel();
    const v = this.v.set(lv.x, lv.y, lv.z);
    this.jumpGrace = Math.max(0, this.jumpGrace - dt);
    this.jumpBufferT = this.jumpTrigger(input) ? RIDING.jumpBuffer : Math.max(0, this.jumpBufferT - dt);

    // --- Ground probes (front / rear) ---
    const hx = Math.sin(this.heading);
    const hz = Math.cos(this.heading);
    const reach = s.rideHeight + s.travel;
    let hits = 0;
    let distSum = 0;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let hitX = t.x;
    let hitZ = t.z;
    for (const k of [-0.5, 0.5]) {
      const ox = t.x + hx * k * s.wheelbase;
      const oz = t.z + hz * k * s.wheelbase;
      const hit = phys.raycast(ox, t.y + 0.4, oz, 0, -1, 0, reach + 0.4, GROUND_QUERY, this.body);
      if (!hit) continue;
      hits++;
      distSum += hit.distance - 0.4;
      nx += hit.nx;
      ny += hit.ny;
      nz += hit.nz;
      hitX = hit.x;
      hitZ = hit.z;
    }
    const wasGrounded = this.grounded;
    let grounded = hits > 0 && this.jumpGrace <= 0;
    if (hits > 0) this.groundNormal.set(nx, ny, nz).normalize();
    const dist = hits > 0 ? distSum / hits : reach;

    if (!grounded) {
      const hit = phys.raycast(t.x, t.y, t.z, 0, -1, 0, RIDING.landingAlignDistance + 40, GROUND_QUERY, this.body);
      this.airGroundDist = hit ? hit.distance : Infinity;
      if (hit) this.airGroundNormal.set(hit.nx, hit.ny, hit.nz);
    }

    // --- Smoothed frame normal ---
    // In the air the vehicle follows its arc (nose up off the lip, nose down into the landing),
    // then lines up with the landing slope when it gets close.
    const targetN = grounded ? this.groundNormal : this.airGroundDist < RIDING.landingAlignDistance ? this.airGroundNormal : this.arcNormal(v);
    const nRate = grounded ? RIDING.normalSmoothing : this.airGroundDist < RIDING.landingAlignDistance ? 10 : RIDING.arcFollow;
    this.normal.lerp(targetN, 1 - Math.exp(-nRate * dt)).normalize();
    const n = this.normal;

    // --- Landing / takeoff ---
    if (grounded && !wasGrounded && this.airTime > 0.25) {
      if (!this.evaluateLanding(v)) return;
    }

    // --- Surface ---
    if (hits > 0) this.surface = SURFACES[ctx.world.surfaceLocal(hitX, hitZ)] ?? 'packed';
    const sp = SURFACE_PHYSICS[this.surface];
    const sm = s.surface[this.surface] ?? {};
    // Boards/skis on anything but snow: barely any glide and poor edge grip.
    const offSnow = s.snowOnly && !SNOW_SURFACES.has(this.surface) ? 1 : 0;

    this.boostingFlag(input.boost && mods.boostAvailable);
    if (grounded) {
      this.groundStep(dt, input, ctx, v, n, dist, sp.grip * (sm.grip ?? 1) * (offSnow ? 0.5 : 1), sp.rolling * (sm.rolling ?? 1) + offSnow * 5, sp.softDrag * (sm.drag ?? 1) + offSnow * 0.25);
      if (this.jumpBufferT > 0 && this.groundTime > 0.03 && s.jumpSpeed > 0) {
        this.doJump(v, n);
        grounded = false;
        this.coyoteUsed = true;
      }
    } else {
      // Coyote time: a late press right after leaving a lip still pops (ollie off kickers).
      if (this.jumpBufferT > 0 && !this.coyoteUsed && this.airTime < RIDING.coyoteTime && s.jumpSpeed > 0) {
        this.doJump(v, n);
        this.coyoteUsed = true;
      }
      if (!this.flightStep(dt, input, ctx, v)) this.airStep(dt, input, v);
    }

    // --- Aero drag + soft top speed (both ground and air) ---
    const speed = v.length();
    const aeroK = s.aero * (this.tuck ? s.tuckAero : 1);
    v.multiplyScalar(Math.max(0, 1 - aeroK * speed * dt));
    const top = (this.telemetry.boosting ? s.boostTopSpeed : s.topSpeed) * mods.topSpeedMul;
    if (speed > top) v.multiplyScalar(1 - Math.min(0.08, (speed - top) * 0.12 * dt));

    this.body.setLinvel(v, true);
    const airMul = grounded ? 1 : RIDING.airGravityMul;
    this.body.setGravityScale((this.gravityOverride ?? s.gravityScale * airMul) * mods.gravityMul, true);

    // --- Bookkeeping ---
    this.grounded = grounded;
    if (grounded) {
      this.groundTime += dt;
      this.airTime = 0;
      this.tookOff = false;
      if (this.jumpGrace <= 0) this.coyoteUsed = false;
    } else {
      this.groundTime = 0;
      this.airTime += dt;
      if (this.airGroundDist !== Infinity) this.maxHeight = Math.max(this.maxHeight, this.airGroundDist - s.rideHeight);
      if (!this.tookOff && this.airTime > 0.25) {
        this.tookOff = true;
        this.hooks.onTakeoff?.();
      }
    }
    this.perpDist = dist * Math.max(0.3, n.y);
    // Tangential speed before the physics step, for impact (crash) detection.
    this.tangentSpeedBefore = v.clone().addScaledVector(n, -v.dot(n)).length();
    this.computeQuat();
    this.updateTelemetry(v, n);
  }

  /** Normal perpendicular to the flight path in the heading's vertical plane (pitch only). */
  private arcNormal(v: THREE.Vector3): THREE.Vector3 {
    const hx = Math.sin(this.heading);
    const hz = Math.cos(this.heading);
    const along = v.x * hx + v.z * hz;
    const pitch = clamp(Math.atan2(v.y, Math.max(1, Math.abs(along))), -RIDING.arcMaxPitch, RIDING.arcMaxPitch);
    const c = Math.cos(pitch);
    const s = Math.sin(pitch);
    return this.arcN.set(-hx * s, c, -hz * s);
  }
  private readonly arcN = new THREE.Vector3();

  private doJump(v: THREE.Vector3, n: THREE.Vector3): void {
    const vn = v.dot(n);
    v.addScaledVector(n, Math.max(0, -vn) + this.stats.jumpSpeed * this.jumpMultiplier());
    this.jumpGrace = RIDING.jumpGrace;
    this.jumpBufferT = 0;
  }

  /** When does a jump fire? Default: on press. (The motorbike preloads and fires on release.) */
  protected jumpTrigger(input: VehicleInput): boolean {
    return input.jumpPressed;
  }

  /** Extra visual pitch on the ground (wheelies); nose up = negative. */
  protected extraPitch = 0;

  /** Model-local position of a named node, in the character mount frame. */
  protected partLocal(root: THREE.Object3D, name: string, out: THREE.Vector3): THREE.Vector3 {
    const o = root.getObjectByName(name);
    if (!o) return out.set(0, 1, 0);
    o.getWorldPosition(out);
    return this.mount.worldToLocal(out);
  }

  /** Flight hook: return true to replace the default air step (hover car, wingsuit). */
  protected flightStep(_dt: number, _input: VehicleInput, _ctx: VehicleContext, _v: THREE.Vector3): boolean {
    return false;
  }

  /** Jump strength multiplier hook (charged hops etc.). */
  protected jumpMultiplier(): number {
    return 1;
  }

  protected boostingFlag(on: boolean): void {
    this.telemetry.boosting = on;
  }

  private groundStep(dt: number, input: VehicleInput, ctx: VehicleContext, v: THREE.Vector3, n: THREE.Vector3, dist: number, surfGrip: number, rolling: number, softDrag: number): void {
    const s = this.stats;
    const mods = ctx.mods;
    let vn = v.dot(n);
    const vt = this.vt.copy(v).addScaledVector(n, -vn);
    const spd = vt.length();

    // Steering: yaw rate falls off with speed.
    const turn = lerp(s.turnRateLow, s.turnRateHigh, clamp(spd / s.turnSpeedRef, 0, 1));
    this.yawRate = -input.steer * turn * this.steerMultiplier(input);
    this.heading = wrapAngle(this.heading + this.yawRate * dt);
    const f = this.f.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    f.addScaledVector(n, -f.dot(n)).normalize();
    this.r.crossVectors(f, n);

    // Carving: rotate planar velocity toward the heading, limited by grip (speed-preserving).
    const gripG = (mods.gripOverride ? 1.6 : surfGrip) * s.grip * mods.gripMul * this.gripMultiplier(input);
    if (spd > 0.3) {
      const sign = vt.dot(f) >= 0 ? 1 : -1;
      _x.copy(f).multiplyScalar(sign);
      const sinA = new THREE.Vector3().crossVectors(vt, _x).dot(n) / spd;
      const cosA = vt.dot(_x) / spd;
      const alpha = Math.atan2(sinA, cosA);
      const maxRate = (gripG * 9.81) / Math.max(spd, 3);
      const rot = clamp(alpha, -maxRate * dt, maxRate * dt);
      vt.applyAxisAngle(n, rot);
      const slip = Math.abs(alpha - rot);
      if (slip > 0.02) vt.multiplyScalar(1 - Math.min(0.5, s.skidDrag * Math.sin(Math.min(slip, Math.PI / 2)) * dt));
    }

    // Longitudinal: propulsion, brakes, rolling + soft-snow drag.
    let vf = vt.dot(f);
    let a = 0;
    const prop = s.propulsionMaxSpeed;
    if (input.throttle > 0 && vf < prop) a += s.accel * input.throttle * Math.sqrt(Math.max(0, 1 - Math.max(0, vf) / prop));
    this.tuck = input.throttle > 0.5 && vf > prop * 0.9;
    if (this.telemetry.boosting) a += s.boostAccel;
    // Reverse gear: brake held while (nearly) stopped or already rolling backwards.
    const reversing = this.canReverse && input.brake > 0.1 && input.throttle < 0.1 && vf < 1;
    if (reversing && vf > -this.reverseMax) a -= s.accel * 0.6 * input.brake;
    vt.addScaledVector(f, a * dt);
    vf = vt.dot(f);
    const resist = rolling + softDrag * Math.abs(vf) + (input.brake > 0 && !reversing ? s.brake * input.brake : 0);
    if (Math.abs(vf) <= resist * dt) vt.addScaledVector(f, -vf);
    else vt.addScaledVector(f, -Math.sign(vf) * resist * dt);

    // Suspension spring along the ground normal (light "stick" when extended).
    const perp = dist * Math.max(0.3, n.y);
    const comp = s.rideHeight - perp;
    let springA = s.spring * comp - s.damping * vn;
    if (comp < 0) {
      const stick = lerp(RIDING.crestStick, RIDING.crestStickFast, clamp(spd / RIDING.crestStickSpeed, 0, 1));
      springA = vn > 1.5 ? 0 : Math.max(springA * 0.35, -stick);
    }
    vn += springA * dt;
    this.telemetry.compression = clamp(comp / s.travel, 0, 1);

    v.copy(vt).addScaledVector(n, vn);
  }

  /** Subclass hook: lateral grip multiplier (handbrake drifts). */
  protected gripMultiplier(_input: VehicleInput): number {
    return 1;
  }

  /** Subclass hook: e.g. skis carve tighter when tucked. */
  protected steerMultiplier(_input: VehicleInput): number {
    return 1;
  }

  protected airStep(dt: number, input: VehicleInput, v: THREE.Vector3): void {
    const s = this.stats;
    this.heading = wrapAngle(this.heading - input.steer * s.airSteer * dt);
    this.trickPitch += input.pitch * s.airPitchRate * dt;
    this.trickYaw -= input.spin * s.airSpinRate * dt;
    if (input.trick) this.grabTime += dt;
    // Landing assist near the ground: settle toward the nearest clean orientation.
    if (this.airGroundDist < RIDING.landingAlignDistance) {
      const k = RIDING.landingAssist;
      if (Math.abs(input.pitch) < 0.1) this.trickPitch = damp(this.trickPitch, Math.round(this.trickPitch / TWO_PI) * TWO_PI, k, dt);
      const yawStep = this.allowSwitch ? Math.PI : TWO_PI;
      if (Math.abs(input.spin) < 0.1) this.trickYaw = damp(this.trickYaw, Math.round(this.trickYaw / yawStep) * yawStep, k, dt);
    }
    if (this.telemetry.boosting) {
      _x.set(Math.sin(this.heading), 0, Math.cos(this.heading));
      v.addScaledVector(_x, s.boostAccel * 0.5 * dt);
    }
    this.yawRate = 0;
    this.tuck = false;
  }

  /** Returns false if the landing crashed (and wasn't absorbed). */
  protected evaluateLanding(v: THREE.Vector3): boolean {
    const s = this.stats;
    const upVis = _x.set(0, 1, 0).applyQuaternion(this.currQuat);
    const angle = THREE.MathUtils.radToDeg(upVis.angleTo(this.groundNormal));
    const impact = -v.dot(this.groundNormal);
    const yawOff = wrapAngle(this.trickYaw);
    const absYaw = Math.abs(yawOff);
    const backwards = absYaw > Math.PI - 1.0;
    const sideways = absYaw > 1.0 && absYaw < Math.PI - 1.0;
    let reason = '';
    if (angle > s.crashAngleDeg) reason = 'bad landing';
    else if (impact > s.crashImpact) reason = 'hard landing';
    else if (sideways || (backwards && !this.allowSwitch)) reason = 'sideways landing';
    const info = {
      airTime: this.airTime,
      impact,
      flips: Math.round(this.trickPitch / TWO_PI),
      spins: Math.round(this.trickYaw / Math.PI),
      grabTime: this.grabTime,
      height: this.maxHeight,
      switchLanding: backwards && this.allowSwitch,
    };
    this.trickPitch = 0;
    this.trickYaw = 0;
    this.grabTime = 0;
    this.maxHeight = 0;
    if (reason) {
      const absorbed = this.hooks.onCrash?.(reason) ?? false;
      if (!absorbed) return false;
    } else {
      if (backwards) this.heading = wrapAngle(this.heading + yawOff);
      this.hooks.onLand?.(info);
    }
    return true;
  }

  afterStep(): void {
    this.interp.capture(this.body);
    // Landings are judged by evaluateLanding; ignore the contact settling right after touchdown.
    if (this.grounded && this.groundTime < 0.15) return;
    // Impact detection: sudden loss of tangential speed (trees, rocks, structures).
    const lv = this.body.linvel();
    const after = new THREE.Vector3(lv.x, lv.y, lv.z);
    after.addScaledVector(this.normal, -after.dot(this.normal));
    const loss = this.tangentSpeedBefore - after.length();
    if (loss > this.stats.crashDecel) this.hooks.onCrash?.('impact');
  }

  protected computeQuat(): void {
    const n = this.normal;
    const f = this.f.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    f.addScaledVector(n, -f.dot(n)).normalize();
    _x.crossVectors(n, f).normalize();
    _m.makeBasis(_x, n, f);
    this.currQuat.setFromRotationMatrix(_m);
    const spd = this.telemetry.speed;
    const targetLean = this.grounded ? clamp(-Math.atan2(spd * this.yawRate, 9.81), -0.75, 0.75) * this.leanFactor : 0;
    this.lean = damp(this.lean, targetLean, 8, 1 / 60);
    _q.setFromEuler(_e.set(this.trickPitch + this.extraPitch, this.trickYaw, this.lean, 'YXZ'));
    this.currQuat.multiply(_q);
  }

  private updateTelemetry(v: THREE.Vector3, n: THREE.Vector3): void {
    const tel = this.telemetry;
    tel.speed = v.length();
    tel.forwardSpeed = v.dot(this.f);
    tel.grounded = this.grounded;
    tel.airTime = this.airTime;
    tel.surface = this.surface;
    tel.heading = this.heading;
    if (!this.grounded) tel.compression = 0;
    void n;
  }

  render(dt: number, alpha: number): void {
    this.lastAlpha = alpha;
    this.interp.position(alpha, this.model.position);
    this.model.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    const s = this.stats;
    const target = this.grounded ? clamp(this.perpDist, s.rideHeight - s.travel, s.rideHeight + 0.05) : s.rideHeight;
    this.visualDrop = damp(this.visualDrop, target, 25, dt);
    _x.set(0, 1, 0).applyQuaternion(this.model.quaternion);
    this.model.position.addScaledVector(_x, -this.visualDrop);
    this.animate(dt);
  }

  /** Subclass visuals (wheels, cranks...). */
  protected abstract animate(dt: number): void;

  renderPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.interp.position(this.lastAlpha, out);
  }

  renderQuaternion(out: THREE.Quaternion): THREE.Quaternion {
    return out.copy(this.model.quaternion);
  }

  shiftOrigin(dx: number, dy: number, dz: number): void {
    this.interp.shift(dx, dy, dz);
  }

  dispose(physics: PhysicsWorld): void {
    physics.world.removeRigidBody(this.body);
    this.model.removeFromParent();
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[];
      for (const x of Array.isArray(mat) ? mat : [mat]) x.dispose();
    });
  }
}
