import * as THREE from 'three';
import { CAMERA, CAMERA_PROFILES, type CameraProfile } from '../config/camera';
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
  vehicle: VehicleId;
  /** Ground height under a local point. */
  groundAt: (x: number, z: number) => number;
}

const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/**
 * Third-person chase camera with per-vehicle profiles, speed-based FOV, trauma shake,
 * mouse/stick orbit that springs back, terrain clearance, and a helmet (first-person) mode.
 * Smoothing is applied to the offset from the rider, so the camera never lags at speed.
 */
export class ChaseCamera {
  mode: 'chase' | 'helmet' = 'chase';
  trauma = 0;
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

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
  ) {}

  toggleMode(): 'chase' | 'helmet' {
    this.mode = this.mode === 'chase' ? 'helmet' : 'chase';
    return this.mode;
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
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
      this.orbitPitch = clamp(this.orbitPitch + inp.mouseDY * CAMERA.mouseSensitivity, -0.35, 1.0);
      orbiting = true;
    }
    if (allowStickOrbit && (inp.rightStick.x !== 0 || inp.rightStick.y !== 0)) {
      this.orbitYaw -= inp.rightStick.x * CAMERA.stickSpeed * dt;
      this.orbitPitch = clamp(this.orbitPitch + inp.rightStick.y * CAMERA.stickSpeed * 0.6 * dt, -0.35, 1.0);
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
    }
    this.yaw = dampAngle(this.yaw, travelYaw, p.yawFollow, dt);

    if (this.mode === 'helmet') {
      this.updateHelmet(dt, t, kmh);
      return;
    }

    const dist = p.distance + (p.distancePerSpeed * kmh) / 100;
    const yaw = this.yaw + this.orbitYaw;
    const pitch = Math.atan2(p.height, dist) + this.orbitPitch;
    _desired.set(-Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, -Math.cos(yaw) * Math.cos(pitch) * dist);
    if (!this.primed) this.offset.copy(_desired);
    const f = 1 - Math.exp(-p.follow * dt);
    this.offset.lerp(_desired, f);

    const cam = this.camera;
    cam.position.copy(t.position).add(this.offset);
    const ground = t.groundAt(cam.position.x, cam.position.z);
    if (cam.position.y < ground + CAMERA.minClearance) cam.position.y = ground + CAMERA.minClearance;

    _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const ahead = p.lookAhead * clamp(speed / 20, 0, 1);
    _look.set(_fwd.x * ahead, p.lookHeight, _fwd.z * ahead);
    if (!this.primed) this.lookOffset.copy(_look);
    this.lookOffset.lerp(_look, 1 - Math.exp(-6 * dt));
    _look.copy(t.position).add(this.lookOffset);

    this.applyShake(dt);
    cam.lookAt(_look);
    this.applyRoll();
    this.setFov(dt, p.fovBase + (p.fovPerSpeed * kmh) / 100, p.fovMax);
    this.primed = true;
  }

  private updateHelmet(dt: number, t: CameraTarget, kmh: number): void {
    const cam = this.camera;
    cam.position.copy(t.head);
    _fwd.set(0, 0, 1).applyQuaternion(t.quaternion);
    _fwd.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.orbitYaw);
    _look.copy(cam.position).addScaledVector(_fwd, 10);
    _look.y += -0.6 + this.orbitPitch * -4;
    this.applyShake(dt);
    cam.lookAt(_look);
    this.applyRoll();
    this.setFov(dt, CAMERA.helmetFov + kmh * 0.08, CAMERA.helmetFov + 18);
    this.primed = true;
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
    this.fov = damp(this.fov, Math.min(max, target), 3, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
