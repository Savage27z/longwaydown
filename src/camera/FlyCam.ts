import * as THREE from 'three';
import type { Input } from '../core/Input';
import { clamp, damp } from '../utils/math';
import type { World } from '../world/World';

/**
 * Free-flying inspection camera with an autopilot that flies the whole course.
 * W/S forward/back, A/D strafe, Space up, Q down, Shift fast, drag to look.
 */
export class FlyCam {
  readonly tuning = {
    speed: 40,
    fastMultiplier: 8,
    autopilot: false,
    autopilotSpeed: 100,
    autopilotHeight: 22,
    jumpToKm: 0,
  };
  yaw = 0;
  pitch = -0.15;
  /** Course distance the autopilot is at. */
  autoS = 0;
  private vel = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private look = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
    private readonly world: World,
  ) {}

  /** Place the camera above the course at distance s (m), looking down the line. */
  teleport(s: number, height = 30): void {
    const g = this.world.globalAt(s, this.tmp);
    this.world.origin.toLocal(g, this.camera.position);
    this.camera.position.y += height;
    this.yaw = this.world.headingAt(s);
    this.pitch = -0.2;
    this.autoS = s;
    this.vel.set(0, 0, 0);
    this.apply();
  }

  update(dt: number): void {
    const t = this.tuning;
    if (t.autopilot) {
      this.autopilot(dt);
      return;
    }
    const inp = this.input;
    if (inp.mouseDown) {
      this.yaw -= inp.mouseDX * 0.004;
      this.pitch = clamp(this.pitch - inp.mouseDY * 0.004, -1.5, 1.5);
    }
    this.yaw -= inp.rightStick.x * 2 * dt;
    this.pitch = clamp(this.pitch - inp.rightStick.y * 1.5 * dt, -1.5, 1.5);
    const fwd = inp.axis('brake', 'accelerate');
    const strafe = inp.axis('steerLeft', 'steerRight');
    const up = inp.value('jump') - inp.value('vehicleWheel');
    const speed = t.speed * (inp.isDown('boost') ? t.fastMultiplier : 1);
    const f = this.tmp.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const target = new THREE.Vector3().addScaledVector(f, fwd * speed).addScaledVector(right, strafe * speed);
    target.y += up * speed;
    this.vel.x = damp(this.vel.x, target.x, 6, dt);
    this.vel.y = damp(this.vel.y, target.y, 6, dt);
    this.vel.z = damp(this.vel.z, target.z, 6, dt);
    this.camera.position.addScaledVector(this.vel, dt);
    const ground = this.world.groundLocal(this.camera.position.x, this.camera.position.z);
    if (this.camera.position.y < ground + 1.5) this.camera.position.y = ground + 1.5;
    this.apply();
  }

  private autopilot(dt: number): void {
    const t = this.tuning;
    const c = this.world.course;
    this.autoS = Math.min(c.length - 1, this.autoS + t.autopilotSpeed * dt);
    if (this.autoS >= c.length - 1) t.autopilot = false;
    const g = this.world.globalAt(this.autoS, this.tmp);
    const p = this.world.origin.toLocal(g, new THREE.Vector3());
    p.y += t.autopilotHeight;
    this.camera.position.lerp(p, 1 - Math.exp(-8 * dt));
    if (this.camera.position.distanceTo(p) > 200) this.camera.position.copy(p);
    const ahead = this.world.origin.toLocal(this.world.globalAt(Math.min(c.length - 1, this.autoS + 90), this.tmp), this.look);
    this.camera.lookAt(ahead);
    this.yaw = Math.atan2(ahead.x - this.camera.position.x, ahead.z - this.camera.position.z);
  }

  private apply(): void {
    const p = this.camera.position;
    this.look.set(p.x + Math.sin(this.yaw) * Math.cos(this.pitch), p.y + Math.sin(this.pitch), p.z + Math.cos(this.yaw) * Math.cos(this.pitch));
    this.camera.lookAt(this.look);
  }
}
