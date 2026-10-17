import * as THREE from 'three';
import { bikeMaterials, joint, tube } from './bikeParts';
import { mergeByMaterial } from './mergeParts';

/**
 * Off-road buggy. Origin at the chassis body centre, +Z forward, +X = left.
 * Named nodes: wheelFL, wheelFR, wheelRL, wheelRR (each a group spun about X and steered about Y),
 * steeringWheel, seat, gripL, gripR, pedalL, pedalR.
 */
export const BUGGY = {
  halfWidth: 0.95,
  halfLength: 1.9,
  halfHeight: 0.35,
  wheelX: 0.98,
  wheelZ: 1.35,
  wheelY: -0.2,
  wheelRadius: 0.46,
  wheelWidth: 0.36,
};

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function chunkyWheel(m: ReturnType<typeof bikeMaterials>): THREE.Group {
  const g = new THREE.Group();
  const R = BUGGY.wheelRadius;
  const W = BUGGY.wheelWidth;
  const tyre = new THREE.CylinderGeometry(R, R, W, 20, 1);
  // Knobbly tread: push alternate rim vertices out.
  const pos = tyre.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > R * 0.98) {
      const a = Math.atan2(z, x);
      const k = 1 + (Math.round(a / (Math.PI / 10)) % 2 === 0 ? 0.04 : 0);
      pos.setXYZ(i, x * k, pos.getY(i), z * k);
    }
  }
  tyre.computeVertexNormals();
  tyre.rotateZ(Math.PI / 2);
  g.add(new THREE.Mesh(tyre, m.rubber));
  const rim = new THREE.CylinderGeometry(R * 0.6, R * 0.6, W + 0.02, 12).rotateZ(Math.PI / 2);
  g.add(new THREE.Mesh(rim, m.accent));
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.BoxGeometry(W + 0.04, 0.05, R * 1.05);
    spoke.rotateX((i / 5) * Math.PI);
    g.add(new THREE.Mesh(spoke, m.dark));
  }
  mergeByMaterial(g);
  return g;
}

export function buildBuggy(primary: string, secondary: string): THREE.Group {
  const m = bikeMaterials(primary, secondary);
  const glow = new THREE.MeshBasicMaterial({ color: '#fff4c2' });
  const root = new THREE.Group();
  root.name = 'buggy';
  const hw = BUGGY.halfWidth;
  const hl = BUGGY.halfLength;
  const body = new THREE.Group();
  // Floor pan + side pods.
  body.add(new THREE.Mesh(new THREE.BoxGeometry(hw * 1.6, 0.12, hl * 1.7).translate(0, -0.25, -0.05), m.dark));
  for (const x of [hw * 0.82, -hw * 0.82]) body.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, hl * 1.1).translate(x, -0.1, -0.1), m.paint));
  // Nose + bumper.
  const nose = new THREE.Mesh(new THREE.BoxGeometry(hw * 1.5, 0.28, 0.9).rotateX(0.18).translate(0, -0.05, hl - 0.55), m.paint);
  body.add(nose);
  body.add(tube(V(hw * 0.75, -0.12, hl + 0.05), V(-hw * 0.75, -0.12, hl + 0.05), 0.05, m.dark));
  // Roll cage.
  const cage = (a: THREE.Vector3, b: THREE.Vector3) => body.add(tube(a, b, 0.045, m.accent));
  const top = 0.85;
  const fx = 0.62;
  const rx = 0.7;
  const cz = 0.55;
  const bz = -0.75;
  for (const s of [1, -1]) {
    cage(V(s * hw * 0.8, -0.15, hl - 0.9), V(s * fx, top, cz));
    cage(V(s * hw * 0.8, -0.15, bz - 0.1), V(s * rx, top, bz));
    cage(V(s * fx, top, cz), V(s * rx, top, bz));
    cage(V(s * hw * 0.8, 0.15, bz - 0.1), V(s * hw * 0.8, 0.15, hl - 0.9));
    body.add(joint(V(s * fx, top, cz), 0.06, m.accent));
    body.add(joint(V(s * rx, top, bz), 0.06, m.accent));
  }
  cage(V(fx, top, cz), V(-fx, top, cz));
  cage(V(rx, top, bz), V(-rx, top, bz));
  cage(V(rx, top, bz), V(-rx, 0.0, bz - 0.2));
  // Engine + exhausts at the back, seat, light bar.
  body.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.42, 0.7).translate(0, 0.0, -hl + 0.45), m.metal));
  for (const x of [0.25, -0.25]) body.add(tube(V(x, 0.05, -hl + 0.15), V(x, 0.3, -hl - 0.1), 0.05, m.chrome));
  body.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.6).translate(0, -0.05, -0.25), m.dark));
  body.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 0.12).rotateX(-0.12).translate(0, 0.3, -0.55), m.dark));
  body.add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.1).translate(0, top + 0.08, cz), m.dark));
  for (const x of [-0.36, -0.12, 0.12, 0.36]) body.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.04).translate(x, top + 0.08, cz + 0.06), glow));
  mergeByMaterial(body);
  root.add(body);

  // Steering wheel on a column.
  const column = tube(V(0, 0.0, 0.55), V(0, 0.35, 0.3), 0.03, m.dark);
  root.add(column);
  const sw = new THREE.Group();
  sw.name = 'steeringWheel';
  sw.position.set(0, 0.38, 0.28);
  sw.rotation.x = -0.9;
  sw.add(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 6, 18), m.dark));
  sw.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.03), m.dark));
  for (const [name, x] of [['gripL', 0.16], ['gripR', -0.16]] as const) {
    const g = new THREE.Object3D();
    g.name = name;
    g.position.set(x, 0, 0);
    sw.add(g);
  }
  root.add(sw);
  const seat = new THREE.Object3D();
  seat.name = 'seat';
  seat.position.set(0, 0.02, -0.28);
  root.add(seat);
  for (const [name, x] of [['pedalL', 0.12], ['pedalR', -0.12]] as const) {
    const p = new THREE.Object3D();
    p.name = name;
    p.position.set(x, -0.15, 0.85);
    root.add(p);
  }

  for (const [name, x, z] of [
    ['wheelFL', 1, 1],
    ['wheelFR', -1, 1],
    ['wheelRL', 1, -1],
    ['wheelRR', -1, -1],
  ] as const) {
    const w = chunkyWheel(m);
    w.name = name;
    w.position.set(x * BUGGY.wheelX, BUGGY.wheelY, z * BUGGY.wheelZ);
    root.add(w);
  }
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return root;
}
