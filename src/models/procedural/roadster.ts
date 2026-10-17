import * as THREE from 'three';
import { bikeMaterials } from './bikeParts';
import { mergeByMaterial } from './mergeParts';

/**
 * Volt Roadster: an original, sleek electric two-seater (no real brand). Origin at the body
 * centre, +Z forward, +X left. Its wheels fold flat and glow as thrusters to fly.
 * Named nodes: wheelFL, wheelFR, wheelRL, wheelRR (each with a `thruster` child),
 * steeringWheel (with gripL / gripR), seat, pedalL, pedalR.
 */
export const ROADSTER = {
  wheelX: 0.86,
  wheelZ: 1.32,
  wheelY: -0.12,
  wheelRadius: 0.36,
  wheelWidth: 0.3,
  halfWidth: 0.92,
  halfLength: 2.15,
};

/** Side silhouette (z, y): long low nose, cab-forward cowl, short rear deck. */
const OUTER: [number, number][] = [
  [-2.15, -0.1], [-2.2, 0.16], [-2.05, 0.36], [-1.6, 0.46], [-0.8, 0.5], [0.15, 0.48], [0.7, 0.4],
  [1.35, 0.26], [1.95, 0.12], [2.2, -0.02], [2.15, -0.16], [1.7, -0.24], [-1.7, -0.24],
];
/** Centre section: same, but dipping into the open cockpit between z -0.95 and 0.45. */
const CENTRE: [number, number][] = [
  [-2.15, -0.1], [-2.2, 0.16], [-2.05, 0.36], [-1.6, 0.46], [-1.05, 0.48], [-0.95, 0.02], [0.45, 0.02], [0.6, 0.4],
  [1.35, 0.26], [1.95, 0.12], [2.2, -0.02], [2.15, -0.16], [1.7, -0.24], [-1.7, -0.24],
];

/** Extrude a (z, y) silhouette across X between x0 and x1 with soft edges. */
function slab(profile: [number, number][], x0: number, x1: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y)));
  const bevel = 0.06;
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0 - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
  // Shape lies in XY (x = our z); extrusion runs along +Z. Turn it so the extrusion runs along X.
  g.rotateY(-Math.PI / 2);
  g.translate(x1 - bevel, 0, 0);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

function wheel(m: ReturnType<typeof bikeMaterials>, glow: THREE.Material, side: number): THREE.Group {
  const R = ROADSTER.wheelRadius;
  const W = ROADSTER.wheelWidth;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, W, 24).rotateZ(Math.PI / 2), m.rubber));
  // Aero rim: a flat disc with five slots.
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.72, R * 0.72, W + 0.02, 24).rotateZ(Math.PI / 2), m.dark));
  for (let i = 0; i < 5; i++) {
    const slot = new THREE.BoxGeometry(W + 0.04, 0.05, R * 0.55).translate(0, 0, R * 0.3);
    slot.rotateX((i / 5) * Math.PI * 2);
    g.add(new THREE.Mesh(slot, m.metal));
  }
  mergeByMaterial(g);
  // Thruster ring on the outer face: lit when the wheel folds flat to fly.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.82, 0.045, 6, 24).rotateY(Math.PI / 2), glow);
  ring.position.x = side * (W / 2 + 0.02);
  ring.name = 'thruster';
  ring.visible = false;
  g.add(ring);
  return g;
}

export function buildRoadster(primary: string, secondary: string): THREE.Group {
  const m = bikeMaterials(primary, secondary);
  const glow = new THREE.MeshBasicMaterial({ color: '#7fe8ff' });
  const tail = new THREE.MeshBasicMaterial({ color: '#ff2d3a' });
  const head = new THREE.MeshBasicMaterial({ color: '#f4fbff' });
  const glass = new THREE.MeshPhongMaterial({ color: '#1a2633', shininess: 120, specular: '#aab6c4', transparent: true, opacity: 0.55 });
  const root = new THREE.Group();
  root.name = 'roadster';
  const hw = ROADSTER.halfWidth;

  const body = new THREE.Group();
  // Sides at full height, centre dipped into the cockpit.
  body.add(slab(OUTER, -hw, -hw + 0.32, m.paint));
  body.add(slab(OUTER, hw - 0.32, hw, m.paint));
  body.add(slab(CENTRE, -hw + 0.3, hw - 0.3, m.paint));
  // Dark lower skirt / diffuser.
  body.add(new THREE.Mesh(new THREE.BoxGeometry(hw * 2 - 0.1, 0.12, 3.9).translate(0, -0.26, 0), m.dark));
  // Cockpit tub, two bucket seats and a centre spine.
  body.add(new THREE.Mesh(new THREE.BoxGeometry(hw * 2 - 0.66, 0.06, 1.35).translate(0, 0.04, -0.25), m.dark));
  for (const x of [0.32, -0.32]) {
    body.add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.5).translate(x, 0.12, -0.42), m.dark));
    body.add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.12).rotateX(-0.22).translate(x, 0.42, -0.72), m.dark));
  }
  body.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 1.2).translate(0, 0.14, -0.2), m.accent));
  mergeByMaterial(body);
  root.add(body);

  // Raked windscreen in a thin frame.
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 - 0.5, 0.42), glass);
  screen.rotation.x = -1.0;
  screen.position.set(0, 0.6, 0.52);
  root.add(screen);
  // Full-width light bar up front, thin tail strip behind (the EV look).
  root.add(new THREE.Mesh(new THREE.BoxGeometry(hw * 2 - 0.3, 0.04, 0.04).translate(0, 0.08, 2.16), head));
  for (const x of [0.62, -0.62]) root.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.04).translate(x, 0.14, 2.08), head));
  root.add(new THREE.Mesh(new THREE.BoxGeometry(hw * 2 - 0.2, 0.05, 0.04).translate(0, 0.3, -2.19), tail));

  // Steering wheel (yoke) on a short column, grips as children so the hands turn it.
  const sw = new THREE.Group();
  sw.name = 'steeringWheel';
  sw.position.set(0.32, 0.42, 0.22);
  sw.rotation.x = -1.1;
  sw.add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 6, 16, Math.PI).rotateZ(Math.PI), m.dark));
  sw.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.03), m.dark));
  for (const [name, x] of [['gripL', 0.15], ['gripR', -0.15]] as const) {
    const gp = new THREE.Object3D();
    gp.name = name;
    gp.position.set(x, 0, 0);
    sw.add(gp);
  }
  root.add(sw);
  const seat = new THREE.Object3D();
  seat.name = 'seat';
  seat.position.set(0.32, 0.12, -0.42);
  root.add(seat);
  for (const [name, x] of [['pedalL', 0.42], ['pedalR', 0.22]] as const) {
    const p = new THREE.Object3D();
    p.name = name;
    p.position.set(x, 0.02, 0.85);
    root.add(p);
  }

  for (const [name, x, z] of [
    ['wheelFL', 1, 1],
    ['wheelFR', -1, 1],
    ['wheelRL', 1, -1],
    ['wheelRR', -1, -1],
  ] as const) {
    const w = wheel(m, glow, x);
    w.name = name;
    w.position.set(x * ROADSTER.wheelX, ROADSTER.wheelY, z * ROADSTER.wheelZ);
    root.add(w);
  }
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.material !== glow && mesh.material !== glass) mesh.castShadow = true;
  });
  return root;
}
