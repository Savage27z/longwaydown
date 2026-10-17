import * as THREE from 'three';
import { CAMERA, CAMERA_PROFILES, type CameraProfile, type CameraView } from '../config/camera';
import type { VehicleId } from '../config/vehicles';
import type { Input } from '../core/Input';
import { clamp, damp, dampAngle } from '../utils/math';

export interface CameraTarget {
  /** Rider body centre (local coords). */
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  heading: number;
  /** Vehicle up / forward for the helmet cam. */
  quaternion: THREE.Quaternion;
  /** Head position for the helmet cam. */
  head: THREE.Vector3;
  grounded: boolean;
  /** Flying (hover car / jet in flight). */
  flying: boolean;
  boosting: boolean;
  vehicle: VehicleId;
  /** Ground height under a local point. */
  groundAt: (x: number, z: number) => number;
}

const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _side = new THREE.Vector3();
const _focus = new THREE.Vector3();

/**
 * Third-person chase camera with per-vehicle profiles, speed-based FOV, trauma shake,
 * mouse/stick orbit that springs back, terrain clearance, and a helmet (first-person) mode.
 * Smoothing is applied to the offset from the rider, so the camera never lags at speed.
 */
export class ChaseCamera {
  mode: CameraView = 'chase';
  trauma = 0;
  /** Settings: degrees added to every FOV, and inverted vertical orbit. */
  fovOffset = 0;
  invertY = false;
  private profile: CameraProfile = { ...CAMERA_PROFILES.bicycle };
  private yaw = 0;
  private orbitYaw = 0;
  private orbitPitch = 0;
  private lastOrbit = -10;
  private offset = new THREE.Vector3(0, 2, -5);
  private lookOffset = new THREE.Vector3();
  private fov = 70;
  private time = 0;
  private primed = false;
  private focusY = 0;
  private focusVY = 0;
  private air = 0;
  private roll = 0;
  private flightPitch = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
  ) {}

  /** Cycle chase -> far -> first person. */
  toggleMode(): CameraView {
    this.mode = this.mode === 'chase' ? 'far' : this.mode === 'far' ? 'first' : 'chase';
    const near = this.mode === 'first' ? CAMERA.firstPersonNear : CAMERA.thirdPersonNear;
    this.camera.near = near;
    this.camera.updateProjectionMatrix();
    return this.mode;
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Cinematic orbit (intro / finish): keeps swinging around the rider until stopped. */
  orbit(dt: number, speed: number, pitch = 0.3): void {
    this.orbitYaw += speed * dt;
    this.orbitPitch = damp(this.orbitPitch, pitch, 2, dt);
    this.lastOrbit = this.time;
  }

  /** Stop any orbit and swing back behind the rider. */
  release(): void {
    this.lastOrbit = -10;
  }

  /** Jump straight behind the rider (respawns, teleports). */
  snap(): void {
    this.primed = false;
  }

  update(dt: number, t: CameraTarget, allowStickOrbit: boolean): void {
    this.time += dt;
    const target = CAMERA_PROFILES[t.vehicle];
    // Blend profiles smoothly when switching vehicles.
    const k = 1 - Math.exp(-3 * dt);
    for (const key of Object.keys(target) as (keyof CameraProfile)[]) this.profile[key] += (target[key] - this.profile[key]) * k;
    const p = this.profile;

    const speed = t.velocity.length();
    const kmh = speed * 3.6;
    _dir.set(t.velocity.x, 0, t.velocity.z);
    const travelYaw = _dir.lengthSq() > 9 ? Math.atan2(_dir.x, _dir.z) : t.heading;

    // Orbit input.
    const inp = this.input;
    let orbiting = false;
    if (inp.mouseDown && (inp.mouseDX !== 0 || inp.mouseDY !== 0)) {
      this.orbitYaw -= inp.mouseDX * CAMERA.mouseSensitivity;
      this.orbitPitch = clamp(this.orbitPitch + inp.mouseDY * CAMERA.mouseSensitivity * (this.invertY ? -1 : 1), -0.35, 1.0);
      orbiting = true;
    }
    if (allowStickOrbit && (inp.rightStick.x !== 0 || inp.rightStick.y !== 0)) {
      this.orbitYaw -= inp.rightStick.x * CAMERA.stickSpeed * dt;
      this.orbitPitch = clamp(this.orbitPitch + inp.rightStick.y * CAMERA.stickSpeed * 0.6 * dt * (this.invertY ? -1 : 1), -0.35, 1.0);
      orbiting = true;
    }
    if (orbiting) this.lastOrbit = this.time;
    else if (this.time - this.lastOrbit > CAMERA.orbitReturnDelay) {
      this.orbitYaw = damp(this.orbitYaw, 0, CAMERA.orbitReturnSpeed, dt);
      this.orbitPitch = damp(this.orbitPitch, 0, CAMERA.orbitReturnSpeed, dt);
    }

    if (!this.primed) {
      this.yaw = travelYaw;
      this.fov = p.fovBase;
      this.focusY = t.position.y;
      this.focusVY = t.velocity.y;
    }
    this.followVertical(dt, t);
    this.yaw = dampAngle(this.yaw, travelYaw, p.yawFollow, dt);

    if (this.mode === 'first') {
      this.updateFirstPerson(dt, t, kmh);
      return;
    }
    this.camera.up.set(0, 1, 0);

    const far = this.mode === 'far';
    this.air = damp(this.air, t.grounded || t.flying ? 0 : 1, t.grounded ? 3 : 1.5, dt);
    const dist = (p.distance + (p.distancePerSpeed * kmh) / 100) * (far ? CAMERA.farDistance : 1) * (1 + this.air * CAMERA.airPullBack);
    const yaw = this.yaw + this.orbitYaw;
    // Flyers: swing above the path when diving, below it when climbing.
    const hs = Math.hypot(t.velocity.x, t.velocity.z);
    const pathPitch = t.flying && speed > 4 ? Math.atan2(t.velocity.y, hs) : 0;
    this.flightPitch = damp(this.flightPitch, pathPitch, 2.5, dt);
    const pitch = clamp(Math.atan2(p.height * (far ? CAMERA.farHeight : 1), dist) + this.orbitPitch - this.flightPitch * CAMERA.flightPitchFollow, -0.3, 1.25);
    _desired.set(-Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, -Math.cos(yaw) * Math.cos(pitch) * dist);
    if (!this.primed) this.offset.copy(_desired);
    const f = 1 - Math.exp(-p.follow * dt);
    this.offset.lerp(_desired, f);

    const cam = this.camera;
    _focus.set(t.position.x, this.focusY, t.position.z);
    cam.position.copy(_focus).add(this.offset);
    const ground = t.groundAt(cam.position.x, cam.position.z);
    if (cam.position.y < ground + CAMERA.minClearance) cam.position.y = ground + CAMERA.minClearance;

    _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const ahead = p.lookAhead * clamp(speed / 20, 0, 1);
    _look.set(_fwd.x * ahead, p.lookHeight, _fwd.z * ahead);
    if (!this.primed) this.lookOffset.copy(_look);
    this.lookOffset.lerp(_look, 1 - Math.exp(-6 * dt));
    // Aim between the lagging camera height and the rider, so the rider rises/drops in frame.
    _look.copy(t.position).add(this.lookOffset);
    _look.y -= (t.position.y - this.focusY) * 0.45;

    this.applyShake(dt);
    cam.lookAt(_look);
    this.applyLeanRoll(dt, t);
    this.applyRoll();
    this.setFov(dt, p.fovBase + (p.fovPerSpeed * kmh) / 100 + (t.boosting ? CAMERA.boostFov : 0), p.fovMax + (t.boosting ? CAMERA.boostFov : 0));
    this.primed = true;
  }

  /** Rider's-eye view: sits at the head, follows the bike's pitch and half of its lean. */
  private updateFirstPerson(dt: number, t: CameraTarget, kmh: number): void {
    const cam = this.camera;
    _fwd.set(0, 0, 1).applyQuaternion(t.quaternion);
    _up.set(0, 1, 0).applyQuaternion(t.quaternion);
    // Slightly behind/above the eyes so the bars and hands sit at the bottom of the frame.
    cam.position.copy(t.head).addScaledVector(_fwd, -0.06).addScaledVector(_up, 0.07);
    _fwd.applyAxisAngle(_up, this.orbitYaw);
    _look.copy(cam.position).addScaledVector(_fwd, 12);
    _look.addScaledVector(_up, -2.7 - this.orbitPitch * 6);
    cam.up.set(0, 1, 0).lerp(_up, 0.45).normalize();
    this.applyShake(dt * 1.5);
    cam.lookAt(_look);
    this.setFov(dt, CAMERA.firstPersonFov + (CAMERA.firstPersonFovPerSpeed * kmh) / 100, CAMERA.firstPersonFov + 20);
    this.primed = true;
  }

  /** Vertical spring with velocity feed-forward (see CAMERA.verticalStiffness). */
  private followVertical(dt: number, t: CameraTarget): void {
    const k = t.grounded || t.flying ? CAMERA.verticalStiffness : CAMERA.airStiffness;
    const c = 2 * CAMERA.verticalDamping * Math.sqrt(k);
    const h = Math.min(dt, 1 / 30);
    this.focusVY += (k * (t.position.y - this.focusY) + c * (t.velocity.y - this.focusVY)) * h;
    this.focusY += this.focusVY * h;
    const lag = t.position.y - this.focusY;
    if (Math.abs(lag) > CAMERA.maxVerticalLag) this.focusY = t.position.y - Math.sign(lag) * CAMERA.maxVerticalLag;
  }

  /** Roll a little with the bike's lean or the flyer's bank. */
  private applyLeanRoll(dt: number, t: CameraTarget): void {
    _side.set(1, 0, 0).applyQuaternion(t.quaternion);
    const lean = Math.asin(clamp(_side.y, -1, 1));
    const target = t.flying ? lean * CAMERA.bankRoll : t.grounded ? lean * CAMERA.leanRoll : 0;
    this.roll = damp(this.roll, target, 4, dt);
    if (Math.abs(this.roll) > 1e-4) this.camera.rotateZ(-this.roll);
  }

  private applyShake(dt: number): void {
    this.trauma = Math.max(0, this.trauma - CAMERA.shakeDecay * dt);
    const s = this.trauma * this.trauma;
    if (s <= 0) return;
    const n = (f: number, o: number) => Math.sin(this.time * f + o) * Math.sin(this.time * f * 0.53 + o * 2.1);
    const amp = CAMERA.shakeMaxOffset * s;
    this.camera.position.x += n(31, 0) * amp;
    this.camera.position.y += n(27, 1) * amp;
    this.camera.position.z += n(23, 2) * amp;
  }

  private applyRoll(): void {
    const s = this.trauma * this.trauma;
    if (s > 0) this.camera.rotateZ(Math.sin(this.time * 19) * CAMERA.shakeMaxRoll * s);
  }

  private setFov(dt: number, target: number, max: number): void {
    this.fov = damp(this.fov, Math.min(max, target) + this.fovOffset, 3, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
