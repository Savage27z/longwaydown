import * as THREE from 'three';
import { SURFACES } from '../config/surfaces';
import { Group, groups, type PhysicsWorld } from '../physics/PhysicsWorld';
import { R, type RapierNS } from '../physics/rapier';
import { createModel, type ModelOptions } from '../models/ModelLoader';
import { BUGGY } from '../models/procedural/buggy';
import type { PoseTargets } from '../player/Character';
import { InterpolatedTransform } from '../utils/Interp';
import { clamp, damp } from '../utils/math';
import { Vehicle, type TransferState, type VehicleContext, type VehicleInput } from './Vehicle';

export const CAR = {
  maxSteer: 0.55,
  steerSpeedFalloff: 40,
  suspensionRest: 0.42,
  suspensionTravel: 0.32,
  stiffness: 32,
  compression: 3.4,
  relaxation: 4.2,
  maxSuspensionForce: 60000,
  frictionSlip: 2.6,
  sideStiffness: 1.1,
  driftSideStiffness: 0.32,
  brakeForce: 40,
  /** Reverse gear speed cap (m/s). */
  reverseMax: 7,
  airControl: 2.2,
  antiRoll: 4,
  downforce: 0.45,
  gravityScale: 1.4,
  uprightDelay: 1.5,
};

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _r = new THREE.Vector3();
const WHEELS: [number, number][] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];
const WHEEL_NAMES = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];

/**
 * Off-road buggy on Rapier's DynamicRayCastVehicleController: 4 raycast wheels with suspension,
 * all-wheel drive, Space = handbrake drift, air control, anti-roll + downforce, auto-righting.
 */
export class Car extends Vehicle {
  private controller: RapierNS.DynamicRayCastVehicleController;
  private interp = new InterpolatedTransform();
  private m: THREE.Object3D;
  private wheels: THREE.Object3D[];
  private steer = 0;
  private upsideTimer = 0;
  private heading = 0;
  private lastAlpha = 1;
  private tangentBefore = 0;
  private airTime = 0;
  private inAir = false;
  private airPitch = 0;
  private airSpin = 0;
  private maxHeight = 0;

  constructor(
    private readonly physics: PhysicsWorld,
    state: TransferState,
    paint: ModelOptions = { primary: '#ff5a1f', secondary: '#20262e' },
  ) {
    super('car');
    const RAPIER = R();
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true).setCanSleep(false).setAngularDamping(0.8).setLinearDamping(0.02),
    );
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(BUGGY.halfWidth * 0.95, BUGGY.halfHeight, BUGGY.halfLength * 0.95)
        .setMass(this.stats.mass * 0.6)
        .setFriction(0.4)
        .setRestitution(0.05)
        .setCollisionGroups(groups(Group.VEHICLE, Group.TERRAIN | Group.PROP)),
      this.body,
    );
    // Low centre of mass keeps it planted.
    this.body.setAdditionalMassProperties(this.stats.mass * 0.4, { x: 0, y: -0.45, z: 0 }, { x: 400, y: 450, z: 250 }, { x: 0, y: 0, z: 0, w: 1 }, true);
    this.controller = physics.world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    WHEELS.forEach(([x, z], i) => {
      this.controller.addWheel({ x: x * BUGGY.wheelX, y: BUGGY.wheelY + 0.25, z: z * BUGGY.wheelZ }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, CAR.suspensionRest, BUGGY.wheelRadius);
      this.controller.setWheelSuspensionStiffness(i, CAR.stiffness);
      this.controller.setWheelSuspensionCompression(i, CAR.compression);
      this.controller.setWheelSuspensionRelaxation(i, CAR.relaxation);
      this.controller.setWheelMaxSuspensionTravel(i, CAR.suspensionTravel);
      this.controller.setWheelMaxSuspensionForce(i, CAR.maxSuspensionForce);
      this.controller.setWheelFrictionSlip(i, CAR.frictionSlip);
      this.controller.setWheelSideFrictionStiffness(i, CAR.sideStiffness);
    });
    this.m = createModel('vehicle:car', paint);
    this.model.add(this.m);
    this.wheels = WHEEL_NAMES.map((n) => this.m.getObjectByName(n)!);
    this.place(state);
  }

  place(state: TransferState): void {
    const p = state.position;
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    _q.setFromAxisAngle(_u.set(0, 1, 0), state.heading);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setLinvel({ x: state.velocity.x, y: state.velocity.y, z: state.velocity.z }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.heading = state.heading;
    this.steer = 0;
    this.upsideTimer = 0;
    this.airTime = 0;
    this.inAir = false;
    this.interp.snap(p.x, p.y, p.z);
    this.interp.capture(this.body);
    this.interp.capture(this.body);
  }

  transfer(): TransferState {
    const t = this.body.translation();
    const v = this.body.linvel();
    return { position: new THREE.Vector3(t.x, t.y, t.z), velocity: new THREE.Vector3(v.x, v.y, v.z), heading: this.heading };
  }

  private axes(): void {
    const r = this.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _f.set(0, 0, 1).applyQuaternion(_q);
    _u.set(0, 1, 0).applyQuaternion(_q);
    _r.crossVectors(_f, _u);
  }

  fixedUpdate(dt: number, input: VehicleInput, ctx: VehicleContext): void {
    const s = this.stats;
    const c = this.controller;
    const mass = this.body.mass();
    this.axes();
    const speed = c.currentVehicleSpeed();
    const lv = this.body.linvel();
    _v.set(lv.x, lv.y, lv.z);
    let contacts = 0;
    for (let i = 0; i < 4; i++) if (c.wheelIsInContact(i)) contacts++;
    const grounded = contacts > 0;

    // Steering (less lock at speed).
    const target = -input.steer * CAR.maxSteer * (1 - Math.min(0.7, Math.abs(speed) / CAR.steerSpeedFalloff));
    this.steer = damp(this.steer, target, 10, dt);
    c.setWheelSteering(0, this.steer);
    c.setWheelSteering(1, this.steer);

    // Engine (AWD), brakes/reverse, handbrake drift.
    const reverse = input.brake > 0.1 && speed < 1;
    const reversePower = reverse && speed > -CAR.reverseMax ? input.brake * 0.6 : 0;
    const drive = (input.throttle - reversePower) * s.accel * mass * (speed < s.propulsionMaxSpeed ? 1 : 0.15);
    const brake = input.brake > 0.1 && (!reverse || speed < -CAR.reverseMax) ? input.brake * CAR.brakeForce : 0;
    const handbrake = input.jumpHeld;
    for (let i = 0; i < 4; i++) {
      c.setWheelEngineForce(i, drive / 4);
      c.setWheelBrake(i, i >= 2 && handbrake ? CAR.brakeForce * 0.6 : brake);
      c.setWheelSideFrictionStiffness(i, i >= 2 && handbrake ? CAR.driftSideStiffness : CAR.sideStiffness);
    }

    // Boost, aero drag, downforce.
    this.telemetry.boosting = input.boost && ctx.mods.boostAvailable;
    if (this.telemetry.boosting) this.body.applyImpulse({ x: _f.x * s.boostAccel * mass * dt, y: _f.y * s.boostAccel * mass * dt, z: _f.z * s.boostAccel * mass * dt }, true);
    const sp = _v.length();
    const top = (this.telemetry.boosting ? s.boostTopSpeed : s.topSpeed) * ctx.mods.topSpeedMul;
    const dragK = s.aero * sp + (sp > top ? (sp - top) * 0.03 : 0);
    this.body.applyImpulse({ x: -_v.x * dragK * mass * dt, y: -_v.y * dragK * mass * dt, z: -_v.z * dragK * mass * dt }, true);
    if (grounded) {
      const down = CAR.downforce * sp * sp * dt;
      this.body.applyImpulse({ x: -_u.x * down * mass * 0.01, y: -_u.y * down * mass * 0.01, z: -_u.z * down * mass * 0.01 }, true);
      // Anti-roll: damp spin about the forward axis.
      const w = this.body.angvel();
      const roll = w.x * _f.x + w.y * _f.y + w.z * _f.z;
      const k = -roll * CAR.antiRoll * dt * 300;
      this.body.applyTorqueImpulse({ x: _f.x * k, y: _f.y * k, z: _f.z * k }, true);
    } else {
      // Air control: pitch forward = nose down (torque about -right), spin right = negative yaw.
      const pitch = -input.pitch * CAR.airControl * dt * 400;
      const spin = -input.spin * CAR.airControl * dt * 400;
      this.body.applyTorqueImpulse({ x: _r.x * pitch + _u.x * spin, y: _r.y * pitch + _u.y * spin, z: _r.z * pitch + _u.z * spin }, true);
    }
    this.body.setGravityScale(CAR.gravityScale * ctx.mods.gravityMul, true);

    c.updateVehicle(dt, undefined, groups(Group.ALL, Group.TERRAIN | Group.PROP));

    // On the roof or side: a roll-over crash (a Shield buff turns it into an auto-right).
    if (_u.y < 0.25 && contacts === 0 && (sp < 6 || this.airTime > 0.6)) this.upsideTimer += dt;
    else this.upsideTimer = 0;
    if (this.upsideTimer > (sp < 6 ? CAR.uprightDelay : 0.5)) {
      this.upsideTimer = 0;
      if (this.hooks.onCrash?.('rolled') ?? true) {
        const t = this.body.translation();
        this.place({ position: new THREE.Vector3(t.x, t.y + 1.2, t.z), velocity: new THREE.Vector3(), heading: this.heading });
      }
    }

    this.heading = Math.atan2(_f.x, _f.z);
    this.trackAir(dt, grounded, ctx);
    const tel = this.telemetry;
    tel.speed = sp;
    tel.forwardSpeed = speed;
    tel.grounded = grounded;
    tel.airTime = this.airTime;
    tel.heading = this.heading;
    let comp = 0;
    for (let i = 0; i < 4; i++) comp += 1 - clamp((c.wheelSuspensionLength(i) ?? CAR.suspensionRest) / CAR.suspensionRest, 0, 1);
    tel.compression = comp / 4;
    const t = this.body.translation();
    tel.surface = SURFACES[ctx.world.surfaceLocal(t.x, t.z)] ?? 'packed';
    this.tangentBefore = _v.clone().addScaledVector(_u, -_v.dot(_u)).length();
  }

  /** Air time, flips/spins (from the body's own rotation) and takeoff/landing hooks. */
  private trackAir(dt: number, grounded: boolean, ctx: VehicleContext): void {
    const w = this.body.angvel();
    if (!grounded) {
      if (this.airTime === 0) {
        this.airPitch = 0;
        this.airSpin = 0;
        this.maxHeight = 0;
      }
      this.airTime += dt;
      // Pitch about -right (nose down = +), spin about up (right = +).
      this.airPitch -= (w.x * _r.x + w.y * _r.y + w.z * _r.z) * dt;
      this.airSpin -= (w.x * _u.x + w.y * _u.y + w.z * _u.z) * dt;
      const t = this.body.translation();
      this.maxHeight = Math.max(this.maxHeight, t.y - ctx.world.groundLocal(t.x, t.z) - this.stats.rideHeight);
      if (this.airTime > 0.15 && !this.inAir) {
        this.inAir = true;
        this.hooks.onTakeoff?.();
      }
      return;
    }
    if (this.inAir) {
      this.inAir = false;
      const n = this.controller.wheelContactNormal(0) ?? { x: 0, y: 1, z: 0 };
      this.hooks.onLand?.({
        airTime: this.airTime,
        impact: Math.max(0, -(_v.x * n.x + _v.y * n.y + _v.z * n.z)),
        flips: Math.round(this.airPitch / (Math.PI * 2)),
        spins: Math.round(this.airSpin / Math.PI),
        grabTime: 0,
        height: this.maxHeight,
        switchLanding: false,
      });
    }
    this.airTime = 0;
  }

  afterStep(): void {
    this.interp.capture(this.body);
    const lv = this.body.linvel();
    _v.set(lv.x, lv.y, lv.z);
    const after = _v.addScaledVector(_u, -_v.dot(_u)).length();
    if (this.tangentBefore - after > this.stats.crashDecel) this.hooks.onCrash?.('impact');
  }

  render(dt: number, alpha: number): void {
    this.lastAlpha = alpha;
    this.interp.apply(this.model, alpha);
    const c = this.controller;
    this.wheels.forEach((w, i) => {
      const len = c.wheelSuspensionLength(i) ?? CAR.suspensionRest;
      w.position.y = BUGGY.wheelY + 0.25 - len;
      w.rotation.set(0, 0, 0);
      w.rotateY(c.wheelSteering(i) ?? 0);
      w.rotateX(c.wheelRotation(i) ?? 0);
    });
    const sw = this.m.getObjectByName('steeringWheel');
    if (sw) sw.rotation.z = damp(sw.rotation.z, this.steer * 2.2, 12, dt);
  }

  pose(out: PoseTargets): PoseTargets {
    this.model.updateMatrixWorld(true);
    const local = (name: string, o: THREE.Vector3) => {
      const n = this.m.getObjectByName(name);
      if (!n) return o;
      n.getWorldPosition(o);
      return this.mount.worldToLocal(o);
    };
    local('seat', out.hips).y += 0.12;
    out.hipsRot.set(-0.35, 0, 0);
    out.spine.set(0.1, 0, 0);
    out.chest.set(0.05, 0, 0);
    out.head.set(0.15, this.steer * 0.6, 0);
    out.handL = local('gripL', out.handL ?? new THREE.Vector3());
    out.handR = local('gripR', out.handR ?? new THREE.Vector3());
    local('pedalL', out.footL);
    local('pedalR', out.footR);
    out.kneePole.set(0.15, 1, 0.6);
    out.elbowPole.set(0.6, -0.6, -0.4);
    out.footYaw = 0;
    out.mirrorPoles = true;
    return out;
  }

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
    physics.world.removeVehicleController(this.controller);
    physics.world.removeRigidBody(this.body);
    this.model.removeFromParent();
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[];
      for (const x of Array.isArray(mat) ? mat : [mat]) x.dispose();
    });
    void this.physics;
  }
}
