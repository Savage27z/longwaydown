import * as THREE from 'three';
import type { SurfaceId } from '../config/surfaces';
import type { VehicleId } from '../config/vehicles';
import { events } from '../core/Events';

const MAX = 1400;

/** How each surface sprays: colour, particles per metre travelled, kick-up speed, size, life. */
interface SurfaceSpray {
  color: string;
  perM: number;
  up: number;
  size: number;
  life: number;
  heavy?: boolean;
}

const SURF: Partial<Record<SurfaceId, SurfaceSpray>> = {
  dirt: { color: '#b08a60', perM: 1.4, up: 2.4, size: 0.9, life: 1 },
  trail: { color: '#bb9468', perM: 1.2, up: 2.2, size: 0.85, life: 1 },
  gravel: { color: '#b9b5ad', perM: 1, up: 2.4, size: 0.7, life: 0.8 },
  mud: { color: '#4a3826', perM: 1.4, up: 3, size: 0.35, life: 0.6, heavy: true },
  grass: { color: '#6fa04a', perM: 0.25, up: 1.6, size: 0.3, life: 0.5 },
  powder: { color: '#f4f8ff', perM: 1.6, up: 3.2, size: 0.8, life: 1.1 },
  packed: { color: '#eef3fa', perM: 0.8, up: 2.2, size: 0.55, life: 0.8 },
  ice: { color: '#dfeffa', perM: 0.35, up: 1.5, size: 0.35, life: 0.5 },
  water: { color: '#e8f4ff', perM: 2.4, up: 4.2, size: 0.7, life: 0.9, heavy: true },
};
/** On snow maps the trail is groomed snow. */
const SNOW_TRAIL: SurfaceSpray = { color: '#f2f6fc', perM: 1.0, up: 2.6, size: 0.6, life: 0.9 };

const BOARDS = new Set<VehicleId>(['snowboard', 'skis']);
const CARS = new Set<VehicleId>(['car', 'roadster']);
const NONE = new Set<VehicleId>(['wingsuit', 'flyingCar']);

export interface SprayRider {
  vehicle: VehicleId;
  /** Contact point under the vehicle (local), heading, speed (m/s), surface, grounded, steer (-1..1). */
  pos: THREE.Vector3;
  heading: number;
  speed: number;
  surface: SurfaceId;
  grounded: boolean;
  steer: number;
  /** Fractional particles carried between frames. */
  carry: number;
}

const _c = new THREE.Color();

/**
 * Dust, mud, grass bits, snow plumes and water splashes kicked up behind wheels, boards and skis.
 * One pooled point cloud with per-particle colour, size and fade (soft round sprites).
 */
export class Spray {
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private size = new Float32Array(MAX);
  private alpha = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private age = new Float32Array(MAX);
  private heavy = new Uint8Array(MAX);
  private next = 0;
  private points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private tex: THREE.Texture;
  private off: () => void;

  constructor(scene: THREE.Scene, private readonly snowMap: boolean) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(c);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.tex }, scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vColor; varying float vAlpha; uniform float scale;
        void main() {
          vColor = color; vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vColor; varying float vAlpha;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.off = events.on('origin:shift', ({ dx, dy, dz }) => {
      for (let i = 0; i < MAX; i++) {
        this.pos[i * 3] -= dx;
        this.pos[i * 3 + 1] -= dy;
        this.pos[i * 3 + 2] -= dz;
      }
    });
  }

  /** Viewport height drives point size (call on resize / each frame, cheap). */
  setViewport(heightPx: number, fovDeg: number): void {
    this.mat.uniforms.scale!.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: string, size: number, life: number, heavy: boolean): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    _c.set(color).convertSRGBToLinear();
    const v = 0.9 + Math.random() * 0.2;
    this.col.set([_c.r * v, _c.g * v, _c.b * v], i * 3);
    this.size[i] = size * (0.7 + Math.random() * 0.6);
    this.life[i] = life * (0.7 + Math.random() * 0.6);
    this.age[i] = 0;
    this.alpha[i] = 1;
    this.heavy[i] = heavy ? 1 : 0;
  }

  /** Kick up spray behind a rider this frame. */
  emit(r: SprayRider, dt: number): void {
    if (!r.grounded || r.speed < 4 || NONE.has(r.vehicle) || r.vehicle === 'onFoot') return;
    const s = r.surface === 'trail' && this.snowMap ? SNOW_TRAIL : SURF[r.surface];
    if (!s) return;
    const board = BOARDS.has(r.vehicle);
    // Boards and skis throw a big plume when carving hard.
    const carve = board ? 1 + Math.abs(r.steer) * 2.5 : 1;
    r.carry += r.speed * dt * s.perM * carve * (CARS.has(r.vehicle) ? 1.6 : 1);
    const fx = Math.sin(r.heading);
    const fz = Math.cos(r.heading);
    while (r.carry >= 1) {
      r.carry -= 1;
      // Rear contact (two wheels on cars), a touch behind.
      const lat = CARS.has(r.vehicle) ? (Math.random() < 0.5 ? -0.8 : 0.8) : (Math.random() - 0.5) * 0.3;
      const back = CARS.has(r.vehicle) ? 1.3 : board ? 0.5 : 0.6;
      const x = r.pos.x - fx * back + fz * lat;
      const z = r.pos.z - fz * back - fx * lat;
      const out = board ? -r.steer * r.speed * 0.25 : (Math.random() - 0.5) * 2;
      const kick = r.speed * (0.18 + Math.random() * 0.12);
      this.spawn(x, r.pos.y + 0.15, z, -fx * kick + fz * out, s.up * (0.6 + Math.random() * 0.8), -fz * kick - fx * out, s.color, s.size, s.life, !!s.heavy);
    }
  }

  /** One-off burst (landings, splashing into water). */
  burst(r: SprayRider, strength: number): void {
    const s = r.surface === 'trail' && this.snowMap ? SNOW_TRAIL : SURF[r.surface];
    if (!s || NONE.has(r.vehicle)) return;
    const n = Math.min(60, Math.round(10 + strength * 6));
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * (2 + strength * 0.4);
      this.spawn(r.pos.x, r.pos.y + 0.1, r.pos.z, Math.cos(a) * sp, s.up * (0.5 + Math.random()), Math.sin(a) * sp, s.color, s.size * 1.2, s.life, !!s.heavy);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX; i++) {
      if (this.alpha[i] === 0) continue;
      this.age[i] += dt;
      const k = this.age[i]! / this.life[i]!;
      if (k >= 1) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      const g = this.heavy[i] ? 14 : 5;
      this.vel[i * 3 + 1] -= g * dt;
      const drag = 1 - Math.min(0.9, 2.2 * dt);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2]! * dt;
      // Grow a little as it disperses, fade out over the second half of its life.
      this.alpha[i] = Math.min(1, 2 * (1 - k)) * 0.8;
      this.size[i] *= 1 + dt * 0.8;
    }
    for (const n of ['position', 'color', 'size', 'alpha']) (this.geo.attributes[n] as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.off();
    this.points.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}
