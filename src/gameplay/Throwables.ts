import * as THREE from 'three';
import { THROW } from '../config/stunts';
import type { PlayerController } from '../player/PlayerController';

export interface ThrowRider {
  id: string;
  name: string;
  rider: PlayerController;
  local: boolean;
}

interface Projectile {
  from: ThrowRider;
  target: ThrowRider | null;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  t: number;
  mesh: THREE.Object3D;
  spin: THREE.Vector3;
}

interface Burst {
  mesh: THREE.Sprite;
  t: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _f = new THREE.Vector3();

/**
 * Thrown bottles and stones (after Downhill Domination's homing water bottles): a rider with
 * ammo throws at the nearest rider ahead in a forward cone; the throw arcs and homes in, and a
 * hit knocks the target off (a real crash) unless a Shield takes it. Works in local coordinates.
 */
export class Throwables {
  private flying: Projectile[] = [];
  private bursts: Burst[] = [];
  private bottleGeo: THREE.BufferGeometry;
  private stoneGeo = new THREE.DodecahedronGeometry(0.11, 0);
  private glass = new THREE.MeshLambertMaterial({ color: '#3fae5c', transparent: true, opacity: 0.85 });
  private rock = new THREE.MeshLambertMaterial({ color: '#8a857c', flatShading: true });
  private flash = new THREE.SpriteMaterial({ color: '#ffffff', transparent: true, depthWrite: false });
  /** Called on every hit (for the HUD / run): who threw, who got hit, and whether a shield saved them. */
  onHit: ((from: ThrowRider, to: ThrowRider, blocked: boolean) => void) | null = null;

  constructor(private readonly scene: THREE.Object3D) {
    // Bottle: body, shoulder and neck as one lathe.
    const pts = [
      [0, -0.13],
      [0.045, -0.13],
      [0.05, -0.11],
      [0.05, 0.03],
      [0.03, 0.08],
      [0.016, 0.1],
      [0.016, 0.15],
      [0, 0.15],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    this.bottleGeo = new THREE.LatheGeometry(pts, 10);
  }

  /**
   * Auto-aim: anyone close (within closeRange, any direction: beside, behind, ahead) first,
   * nearest wins; otherwise the nearest rider ahead within range and the forward cone.
   */
  pickTarget(from: ThrowRider, riders: ThrowRider[]): ThrowRider | null {
    const v = from.rider.vehicle;
    v.renderPosition(_a);
    const h = v.telemetry.heading;
    _f.set(Math.sin(h), 0, Math.cos(h));
    let close: ThrowRider | null = null;
    let closeD = Infinity;
    let ahead: ThrowRider | null = null;
    let aheadD = Infinity;
    for (const o of riders) {
      if (o === from || o.rider.ghost || o.rider.state !== 'riding') continue;
      o.rider.vehicle.renderPosition(_b).sub(_a);
      const d = _b.length();
      if (d > THROW.range) continue;
      if (d <= THROW.closeRange) {
        if (d < closeD) {
          closeD = d;
          close = o;
        }
        continue;
      }
      _b.y = 0;
      if (_b.normalize().dot(_f) < Math.cos(THROW.cone)) continue;
      if (d < aheadD) {
        aheadD = d;
        ahead = o;
      }
    }
    return close ?? ahead;
  }

  /** Velocity that closes on the target: its own velocity plus `chase` m/s straight at it. */
  private chaseVelocity(target: ThrowRider, from: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    target.rider.vehicle.renderPosition(_b);
    _b.y += 1;
    _b.sub(from).setLength(THROW.chase);
    const tl = target.rider.vehicle.body.linvel();
    return out.set(tl.x, tl.y, tl.z).add(_b);
  }

  /** Throw from a rider (ammo already spent). */
  throw(from: ThrowRider, riders: ThrowRider[]): void {
    const target = this.pickTarget(from, riders);
    const v = from.rider.vehicle;
    const pos = v.renderPosition(new THREE.Vector3());
    pos.y += 1.3;
    const lv = v.body.linvel();
    const h = v.telemetry.heading;
    const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
    if (target) {
      // Straight at them, moving with them: a little loft for the look.
      this.chaseVelocity(target, pos, vel);
      vel.y += 3;
    } else vel.add(_f.set(Math.sin(h), 0.35, Math.cos(h)).multiplyScalar(THROW.speed));
    const stone = Math.random() < 0.4;
    const mesh = new THREE.Mesh(stone ? this.stoneGeo : this.bottleGeo, stone ? this.rock : this.glass);
    mesh.castShadow = true;
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.flying.push({ from, target, pos, vel, t: 0, mesh, spin: new THREE.Vector3(Math.random() * 12, Math.random() * 6, Math.random() * 12) });
  }

  update(dt: number, riders: ThrowRider[], groundAt: (x: number, z: number) => number): void {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const p = this.flying[i]!;
      p.t += dt;
      // Homing: chase in the target's moving frame (its velocity + a closing speed), so a throw
      // at a rider doing 40 m/s still catches them.
      const tracking = p.target && p.target.rider.state === 'riding' && !p.target.rider.ghost;
      if (tracking) {
        p.target!.rider.vehicle.renderPosition(_b);
        _b.y += 1;
        if (_b.distanceTo(p.pos) < THROW.hitRadius) {
          this.hit(p, p.target!);
          this.flying.splice(i, 1);
          continue;
        }
        p.vel.lerp(this.chaseVelocity(p.target!, p.pos, _f), Math.min(1, THROW.homing * dt));
      } else p.vel.y -= THROW.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      // Untargeted throws can still clip anyone in the way.
      if (!p.target) {
        for (const o of riders) {
          if (o === p.from || o.rider.ghost || o.rider.state !== 'riding') continue;
          o.rider.vehicle.renderPosition(_b);
          _b.y += 1;
          if (_b.distanceTo(p.pos) < THROW.hitRadius) {
            this.hit(p, o);
            this.flying.splice(i, 1);
            break;
          }
        }
        if (this.flying[i] !== p) continue;
      }
      if (p.t > THROW.maxFlight || p.pos.y < groundAt(p.pos.x, p.pos.z)) {
        this.smash(p.pos);
        p.mesh.removeFromParent();
        this.flying.splice(i, 1);
      }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.t += dt;
      const k = b.t / 0.35;
      b.mesh.scale.setScalar(0.4 + k * 1.6);
      b.mesh.material.opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        b.mesh.removeFromParent();
        b.mesh.material.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  private hit(p: Projectile, to: ThrowRider): void {
    this.smash(p.pos);
    p.mesh.removeFromParent();
    const blocked = !to.rider.knockOut(`hit by ${p.from.name}`);
    this.onHit?.(p.from, to, blocked);
  }

  private smash(at: THREE.Vector3): void {
    const s = new THREE.Sprite(this.flash.clone());
    s.position.copy(at);
    s.renderOrder = 4;
    this.scene.add(s);
    this.bursts.push({ mesh: s, t: 0 });
  }

  /** New run: nothing in the air. */
  clear(): void {
    for (const p of this.flying) p.mesh.removeFromParent();
    this.flying = [];
  }

  dispose(): void {
    this.clear();
    for (const b of this.bursts) b.mesh.removeFromParent();
    this.bottleGeo.dispose();
    this.stoneGeo.dispose();
    this.glass.dispose();
    this.rock.dispose();
    this.flash.dispose();
  }
}
