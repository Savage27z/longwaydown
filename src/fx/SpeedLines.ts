import * as THREE from 'three';

export const SPEED_LINES = {
  count: 90,
  /** Lines start fading in above this speed (km/h) and reach full strength at fullKmh. */
  startKmh: 60,
  fullKmh: 140,
  maxOpacity: 0.55,
  nearZ: 2,
  farZ: 30,
  /** Streak width as a fraction of its distance (constant on-screen thickness). */
  width: 0.006,
  /** Soft blue-grey reads on both bright snow and sky. */
  color: [0.6, 0.7, 0.85] as [number, number, number],
};

/**
 * Radial speed streaks in camera space: thin tapered quads flying toward the camera, hugging
 * the screen edges. One draw call, invisible below cruising speed.
 */
export class SpeedLines {
  private mesh: THREE.Mesh;
  private positions: Float32Array;
  private colors: Float32Array;
  private z: Float32Array;
  /** Camera-space radius of each streak (m). */
  private u: Float32Array;
  private angle: Float32Array;
  private material: THREE.MeshBasicMaterial;

  constructor(camera: THREE.Camera) {
    const n = SPEED_LINES.count;
    this.positions = new Float32Array(n * 4 * 3);
    this.colors = new Float32Array(n * 4 * 4);
    this.z = new Float32Array(n);
    this.u = new Float32Array(n);
    this.angle = new Float32Array(n);
    const index: number[] = [];
    for (let i = 0; i < n; i++) {
      this.respawn(i, true);
      const b = i * 4;
      index.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));
    geo.setIndex(index);
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: false, fog: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
    this.mesh.visible = false;
    camera.add(this.mesh);
  }

  private respawn(i: number, scatter: boolean): void {
    this.z[i] = scatter ? SPEED_LINES.nearZ + Math.random() * (SPEED_LINES.farZ - SPEED_LINES.nearZ) : SPEED_LINES.farZ;
    // Fixed camera-space radius: streaks sweep outward toward the screen edge as they approach.
    this.u[i] = 2.4 + Math.random() * 4;
    this.angle[i] = Math.random() * Math.PI * 2;
  }

  update(dt: number, speedMs: number): void {
    const kmh = speedMs * 3.6;
    const strength = Math.min(1, Math.max(0, (kmh - SPEED_LINES.startKmh) / (SPEED_LINES.fullKmh - SPEED_LINES.startKmh)));
    this.mesh.visible = strength > 0.01;
    if (!this.mesh.visible) return;
    const len = 2 + speedMs * 0.14;
    const p = this.positions;
    const c = this.colors;
    const [cr, cg, cb] = SPEED_LINES.color;
    const a = SPEED_LINES.maxOpacity * strength;
    for (let i = 0; i < SPEED_LINES.count; i++) {
      this.z[i] -= speedMs * 1.5 * dt;
      if (this.z[i]! < SPEED_LINES.nearZ) this.respawn(i, false);
      const z = this.z[i]!;
      const zt = z + len;
      const ca = Math.cos(this.angle[i]!);
      const sa = Math.sin(this.angle[i]!) * 0.7;
      const u = this.u[i]!;
      // Perpendicular (in screen plane) to the radial direction.
      const px = -sa;
      const py = ca;
      const pl = Math.hypot(px, py) || 1;
      const wh = (SPEED_LINES.width * z) / pl;
      const wt = (SPEED_LINES.width * 0.2 * zt) / pl;
      const hx = ca * u;
      const hy = sa * u;
      const tx = hx;
      const ty = hy;
      const o = i * 12;
      p[o] = hx + px * wh;
      p[o + 1] = hy + py * wh;
      p[o + 2] = -z;
      p[o + 3] = hx - px * wh;
      p[o + 4] = hy - py * wh;
      p[o + 5] = -z;
      p[o + 6] = tx + px * wt;
      p[o + 7] = ty + py * wt;
      p[o + 8] = -zt;
      p[o + 9] = tx - px * wt;
      p[o + 10] = ty - py * wt;
      p[o + 11] = -zt;
      // Only near the screen edges: fade out streaks close to the vanishing point.
      const screenR = u / z;
      const edge = Math.min(1, Math.max(0, (screenR - 0.3) / 0.25));
      const fade = Math.min(1, (SPEED_LINES.farZ - z) / 6) * a * edge;
      const co = i * 16;
      c.set([cr, cg, cb, fade, cr, cg, cb, fade, cr, cg, cb, 0, cr, cg, cb, 0], co);
    }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
