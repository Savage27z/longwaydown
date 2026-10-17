import * as THREE from 'three';
import { events, type Vec3Like } from '../core/Events';

const COUNT = 56;
const LIFE = 0.75;
const FLASH_LIFE = 0.22;

function softDot(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.65)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Smoke puff + white flash played when the rider swaps vehicles. One pooled burst. */
export class Puff {
  private points: THREE.Points;
  private flash: THREE.Sprite;
  private pos: Float32Array;
  private vel = new Float32Array(COUNT * 3);
  private t = LIFE;
  private tex = softDot();
  private offs: (() => void)[] = [];

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(COUNT * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({ size: 1.1, map: this.tex, transparent: true, depthWrite: false, color: 0xf2f4f7, opacity: 0 });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    this.flash.visible = false;
    scene.add(this.points, this.flash);
    this.offs.push(
      events.on('player:switch', ({ position }) => this.play(position)),
      events.on('origin:shift', ({ dx, dy, dz }) => {
        this.points.position.x -= dx;
        this.points.position.y -= dy;
        this.points.position.z -= dz;
        this.flash.position.x -= dx;
        this.flash.position.y -= dy;
        this.flash.position.z -= dz;
      }),
    );
  }

  play(at: Vec3Like): void {
    this.t = 0;
    this.points.position.set(at.x, at.y, at.z);
    this.flash.position.set(at.x, at.y + 0.4, at.z);
    for (let i = 0; i < COUNT; i++) {
      // Random direction, biased outward and up.
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = 2.5 + Math.random() * 3.5;
      this.vel[i * 3] = r * Math.cos(a) * sp;
      this.vel[i * 3 + 1] = Math.abs(u) * sp * 0.6 + 0.8;
      this.vel[i * 3 + 2] = r * Math.sin(a) * sp;
      this.pos[i * 3] = this.vel[i * 3]! * 0.08;
      this.pos[i * 3 + 1] = this.vel[i * 3 + 1]! * 0.08;
      this.pos[i * 3 + 2] = this.vel[i * 3 + 2]! * 0.08;
    }
    this.points.visible = true;
    this.flash.visible = true;
  }

  update(dt: number): void {
    if (this.t >= LIFE) return;
    this.t += dt;
    const k = Math.min(1, this.t / LIFE);
    const drag = Math.exp(-3.5 * dt);
    for (let i = 0; i < COUNT * 3; i++) {
      this.vel[i] = this.vel[i]! * drag;
      this.pos[i] = this.pos[i]! + this.vel[i]! * dt;
    }
    this.points.geometry.attributes.position!.needsUpdate = true;
    const pm = this.points.material as THREE.PointsMaterial;
    pm.opacity = 0.85 * (1 - k) * Math.min(1, this.t * 12);
    pm.size = 0.9 + k * 1.8;
    const f = Math.min(1, this.t / FLASH_LIFE);
    (this.flash.material as THREE.SpriteMaterial).opacity = 0.9 * (1 - f);
    this.flash.scale.setScalar(1.5 + f * 5);
    this.flash.visible = f < 1;
    if (this.t >= LIFE) this.points.visible = false;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.points.removeFromParent();
    this.flash.removeFromParent();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    (this.flash.material as THREE.Material).dispose();
    this.tex.dispose();
  }
}
