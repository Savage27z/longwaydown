import * as THREE from 'three';
import { merge, paint, translate } from './geometry';
import { box, structureMaterial, type ColliderSpec, type Structure } from './structures';

/** Farmland dressing: post-and-rail fences, round hay bales, barns. Local frame as structures.ts. */

const mesh = (g: THREE.BufferGeometry, cast = true) => {
  const m = new THREE.Mesh(g, structureMaterial());
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
};

/** A run of wooden post-and-rail fence along local Z, `length` m long. */
export function fenceRun(length: number): Structure {
  const parts: THREE.BufferGeometry[] = [];
  const wood = '#8a6a48';
  const n = Math.max(2, Math.round(length / 2.6));
  for (let k = 0; k <= n; k++) parts.push(box(0.14, 1.25, 0.14, '#6f543a', 0, 0.62, -length / 2 + (k / n) * length));
  for (const y of [0.55, 1.05]) parts.push(box(0.06, 0.12, length, wood, 0, y, 0));
  const object = new THREE.Group();
  object.add(mesh(merge(parts)));
  return { object, colliders: [{ type: 'cuboid', half: [0.12, 0.65, length / 2], pos: [0, 0.65, 0] }] };
}

/**
 * A fence following a path (points relative to the structure origin, on the ground): a post at
 * every point and two rails between neighbours, merged into one mesh, one thin collider per span.
 */
export function fencePath(pts: THREE.Vector3[]): Structure {
  const parts: THREE.BufferGeometry[] = [];
  const colliders: ColliderSpec[] = [];
  for (const p of pts) parts.push(box(0.14, 1.25, 0.14, '#6f543a', p.x, p.y + 0.62, p.z));
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const tilt = -Math.atan2(b.y - a.y, len);
    for (const y of [0.55, 1.05]) {
      const g = new THREE.BoxGeometry(0.06, 0.12, Math.hypot(len, b.y - a.y));
      g.rotateX(tilt);
      g.rotateY(yaw);
      parts.push(translate(paint(g, '#8a6a48'), (a.x + b.x) / 2, (a.y + b.y) / 2 + y, (a.z + b.z) / 2));
    }
    colliders.push({ type: 'cuboid', half: [0.12, 0.65, len / 2], pos: [(a.x + b.x) / 2, (a.y + b.y) / 2 + 0.65, (a.z + b.z) / 2], rotY: yaw });
  }
  const object = new THREE.Group();
  object.add(mesh(merge(parts)));
  return { object, colliders };
}

/** A few round hay bales lying on their sides, some stacked. */
export function hayBales(count: number, seed: number): Structure {
  const parts: THREE.BufferGeometry[] = [];
  const colliders: ColliderSpec[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < count; k++) {
    const r = 0.75;
    const x = (rnd() - 0.5) * 6;
    const z = (rnd() - 0.5) * 6;
    const stacked = k > 1 && rnd() < 0.3;
    const y = stacked ? r * 2.6 : r;
    const g = new THREE.CylinderGeometry(r, r, 1.2, 14, 1);
    g.rotateZ(Math.PI / 2);
    g.rotateY(rnd() * Math.PI);
    // Straw colour with a darker spiral face.
    parts.push(translate(paint(g, k % 3 === 0 ? '#d9b65c' : '#cfa94e'), x, y, z));
    if (!stacked) colliders.push({ type: 'ball', radius: r, pos: [x, y, z] });
  }
  const object = new THREE.Group();
  object.add(mesh(merge(parts)));
  return { object, colliders };
}

/** Red barn with white trim and a dark gambrel-ish roof. Faces +X (toward the trail). */
export function barn(w: number, d: number, h: number): Structure {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(w, h, d, '#a8322a', 0, h / 2, 0));
  // Roof: two slabs meeting at the ridge.
  const roofW = w * 0.62;
  for (const side of [1, -1]) {
    const g = new THREE.BoxGeometry(roofW, 0.25, d + 0.8);
    g.rotateZ(side * 0.62);
    parts.push(translate(paint(g, '#3c3a3a'), side * w * 0.24, h + roofW * 0.3, 0));
  }
  // Big door with white cross trim on the trail side, small windows.
  parts.push(box(0.08, h * 0.6, d * 0.35, '#f2ece0', w / 2 + 0.02, h * 0.3, 0));
  parts.push(box(0.1, h * 0.55, d * 0.3, '#7e221d', w / 2 + 0.05, h * 0.3, 0));
  for (const z of [-d * 0.32, d * 0.32]) parts.push(box(0.08, 0.9, 0.9, '#f2ece0', w / 2 + 0.02, h * 0.7, z));
  for (const z of [-d / 2, d / 2]) parts.push(box(w + 0.1, 0.15, 0.1, '#f2ece0', 0, h, z));
  const object = new THREE.Group();
  object.add(mesh(merge(parts)));
  return { object, colliders: [{ type: 'cuboid', half: [w / 2, h / 2, d / 2], pos: [0, h / 2, 0] }] };
}
