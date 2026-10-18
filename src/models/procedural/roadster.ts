import * as THREE from 'three';
import { bikeMaterials } from './bikeParts';
import { mergeByMaterial } from './mergeParts';

/**
 * Volt Roadster: an unbranded take on the 2026 electric hypercar roadster with cold-gas thrusters.
 * Low faceted wedge, dark bronze glass canopy, flying-buttress tail whose deck lifts into a wing,
 * thin light bars front and rear, a diffuser with four rear nozzles and a ring of down/side
 * nozzles (the single-seat "air" spec). Origin at the body centre, +Z forward, +X left, ground at
 * y = -0.48. Named nodes: wheelFL/FR/RL/RR, steeringWheel (gripL / gripR), seat, pedalL, pedalR,
 * wing, and jet groups jetDown / jetSide / jetRear whose `plume` children show the gas.
 */
export const ROADSTER = {
  wheelX: 0.84,
  wheelZ: 1.32,
  wheelY: -0.12,
  wheelRadius: 0.36,
  wheelWidth: 0.3,
  halfWidth: 0.99,
  halfLength: 2.2,
};

/** Body cross-section parameters at a station along Z (half-widths and heights, model-local m). */
interface Station {
  z: number;
  /** Shoulder: widest point of the flank. */
  hw: number;
  ysh: number;
  /** Underside height. */
  yb: number;
  /** Beltline (canopy base / fender top). */
  hwB: number;
  yB: number;
  /** Roof edge (or bonnet/deck mid-point outside the canopy). */
  hwR: number;
  yR: number;
  /** Centreline top. */
  yC: number;
}

// prettier-ignore
const KEYS: Station[] = [
  { z: -2.2, hw: 0.84, ysh: 0.06, yb: -0.18, hwB: 0.74, yB: 0.29, hwR: 0.4, yR: 0.29, yC: 0.29 },
  { z: -1.95, hw: 0.95, ysh: 0.07, yb: -0.28, hwB: 0.8, yB: 0.37, hwR: 0.42, yR: 0.35, yC: 0.34 },
  { z: -1.55, hw: 0.99, ysh: 0.08, yb: -0.34, hwB: 0.8, yB: 0.45, hwR: 0.44, yR: 0.41, yC: 0.39 },
  { z: -1.15, hw: 0.99, ysh: 0.07, yb: -0.34, hwB: 0.79, yB: 0.44, hwR: 0.5, yR: 0.5, yC: 0.49 },
  { z: -0.55, hw: 0.93, ysh: 0.05, yb: -0.34, hwB: 0.8, yB: 0.32, hwR: 0.6, yR: 0.64, yC: 0.7 },
  { z: 0.05, hw: 0.9, ysh: 0.03, yb: -0.34, hwB: 0.8, yB: 0.24, hwR: 0.58, yR: 0.6, yC: 0.66 },
  { z: 0.6, hw: 0.93, ysh: 0.01, yb: -0.34, hwB: 0.8, yB: 0.2, hwR: 0.52, yR: 0.44, yC: 0.47 },
  { z: 1.05, hw: 0.96, ysh: 0.0, yb: -0.33, hwB: 0.8, yB: 0.2, hwR: 0.42, yR: 0.24, yC: 0.25 },
  { z: 1.6, hw: 0.96, ysh: -0.02, yb: -0.32, hwB: 0.82, yB: 0.15, hwR: 0.42, yR: 0.17, yC: 0.18 },
  { z: 2.0, hw: 0.92, ysh: -0.04, yb: -0.3, hwB: 0.82, yB: 0.03, hwR: 0.42, yR: 0.05, yC: 0.05 },
  { z: 2.2, hw: 0.82, ysh: -0.06, yb: -0.26, hwB: 0.76, yB: -0.04, hwR: 0.4, yR: -0.03, yC: -0.03 },
];
/** Canopy glass: side windows/screen between these Z, the centre panel runs further back (rear window). */
const GLASS_SIDE: [number, number] = [-1.15, 1.05];
const GLASS_CENTRE: [number, number] = [-1.6, 1.05];
const ARCH_RADIUS = 0.41;

function stationAt(z: number): Station {
  let i = 0;
  while (i < KEYS.length - 2 && z > KEYS[i + 1]!.z) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const t = THREE.MathUtils.clamp((z - a.z) / (b.z - a.z), 0, 1);
  const out = { ...a };
  for (const k of Object.keys(a) as (keyof Station)[]) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Wheel-arch ceiling height at z (or -Infinity outside both arches). */
function archAt(z: number): number {
  let y = -Infinity;
  for (const wz of [ROADSTER.wheelZ, -ROADSTER.wheelZ]) {
    const d = z - wz;
    if (Math.abs(d) < ARCH_RADIUS) y = Math.max(y, ROADSTER.wheelY + Math.sqrt(ARCH_RADIUS * ARCH_RADIUS - d * d));
  }
  return y;
}

/** Half cross-section (x >= 0), bottom centre round to top centre. */
function section(z: number): [number, number][] {
  const s = stationAt(z);
  const xIn = s.hw - 0.36;
  const yA = Math.max(s.yb, archAt(z));
  const yShoulder = Math.max(s.ysh, yA + 0.015);
  const q3: [number, number] = [s.hw - 0.06, yA];
  const q4: [number, number] = [s.hw, yShoulder];
  return [
    [0, s.yb],
    [xIn, s.yb],
    [xIn, yA],
    q3,
    [q3[0] + (q4[0] - q3[0]) * 0.3, q3[1] + (q4[1] - q3[1]) * 0.3],
    q4,
    [s.hwB, Math.max(s.yB, yA + 0.025)],
    [s.hwR, s.yR],
    [0, s.yC],
  ];
}

/** Stations: the keys plus fine steps across the wheel arches so they read round. */
function stationZs(): number[] {
  const zs = new Set(KEYS.map((k) => k.z));
  for (const wz of [ROADSTER.wheelZ, -ROADSTER.wheelZ]) {
    for (let i = 0; i <= 12; i++) zs.add(wz - ARCH_RADIUS + (i / 12) * ARCH_RADIUS * 2);
    zs.add(wz - ARCH_RADIUS - 0.001);
    zs.add(wz + ARCH_RADIUS + 0.001);
  }
  for (const g of [...GLASS_SIDE, ...GLASS_CENTRE]) zs.add(g);
  return [...zs].sort((a, b) => a - b);
}

type Slot = 'dark' | 'trim' | 'paint' | 'glass';

/** Faceted body hull lofted through the stations, split by material slot. */
function hull(): Record<Slot, THREE.BufferGeometry> {
  const out: Record<Slot, number[]> = { dark: [], trim: [], paint: [], glass: [] };
  const zs = stationZs();
  const secs = zs.map(section);
  const slotFor = (k: number, zMid: number): Slot => {
    if (k <= 2) return 'dark';
    if (k === 3) return 'trim';
    if (k === 6 && zMid > GLASS_SIDE[0] && zMid < GLASS_SIDE[1]) return 'glass';
    if (k === 7 && zMid > GLASS_CENTRE[0] && zMid < GLASS_CENTRE[1]) return 'glass';
    return 'paint';
  };
  const tri = (slot: Slot, a: number[], b: number[], c: number[]) => out[slot].push(...a, ...b, ...c);
  for (let i = 0; i < zs.length - 1; i++) {
    const z0 = zs[i]!;
    const z1 = zs[i + 1]!;
    const s0 = secs[i]!;
    const s1 = secs[i + 1]!;
    for (let k = 0; k < s0.length - 1; k++) {
      const slot = slotFor(k, (z0 + z1) / 2);
      for (const side of [1, -1]) {
        const A = [s0[k]![0] * side, s0[k]![1], z0];
        const B = [s0[k + 1]![0] * side, s0[k + 1]![1], z0];
        const C = [s1[k + 1]![0] * side, s1[k + 1]![1], z1];
        const D = [s1[k]![0] * side, s1[k]![1], z1];
        if (side > 0) {
          tri(slot, A, B, C);
          tri(slot, A, C, D);
        } else {
          tri(slot, A, C, B);
          tri(slot, A, D, C);
        }
      }
    }
  }
  // End caps (nose and tail faces).
  for (const [sec, z, dir] of [
    [secs[0]!, zs[0]!, -1],
    [secs[secs.length - 1]!, zs[zs.length - 1]!, 1],
  ] as const) {
    const cy = sec.reduce((a, p) => a + p[1], 0) / sec.length;
    for (let k = 0; k < sec.length - 1; k++) {
      for (const side of [1, -1]) {
        const c = [0, cy, z];
        const p = [sec[k]![0] * side, sec[k]![1], z];
        const q = [sec[k + 1]![0] * side, sec[k + 1]![1], z];
        if (side * dir > 0) tri('paint', c, p, q);
        else tri('paint', c, q, p);
      }
    }
  }
  const geos = {} as Record<Slot, THREE.BufferGeometry>;
  for (const slot of Object.keys(out) as Slot[]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out[slot], 3));
    g.computeVertexNormals();
    geos[slot] = g;
  }
  return geos;
}

function wheel(m: ReturnType<typeof bikeMaterials>, spokeMat: THREE.Material): THREE.Group {
  const R = ROADSTER.wheelRadius;
  const W = ROADSTER.wheelWidth;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, W, 28).rotateZ(Math.PI / 2), m.rubber));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.76, R * 0.76, W + 0.01, 28).rotateZ(Math.PI / 2), m.dark));
  // Black turbine wheel: six angled blades and a centre cap on both faces.
  for (let i = 0; i < 6; i++) {
    const blade = new THREE.BoxGeometry(W + 0.03, R * 0.62, 0.06).translate(0, R * 0.36, 0.03);
    blade.rotateX((i / 6) * Math.PI * 2 + 0.25);
    g.add(new THREE.Mesh(blade, spokeMat));
  }
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.16, R * 0.16, W + 0.05, 12).rotateZ(Math.PI / 2), m.metal));
  mergeByMaterial(g);
  return g;
}

/** A nozzle with its gas plume (apex at the nozzle, pointing along local -Y, scaled by the vehicle). */
function nozzle(m: ReturnType<typeof bikeMaterials>, gas: THREE.Material, plumeGeo: THREE.BufferGeometry, pos: [number, number, number], rot: [number, number, number]): THREE.Group {
  const n = new THREE.Group();
  n.position.set(...pos);
  n.rotation.set(...rot);
  n.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.09, 10).translate(0, -0.02, 0), m.metal));
  const plume = new THREE.Mesh(plumeGeo, gas);
  plume.name = 'plume';
  plume.visible = false;
  plume.renderOrder = 2;
  n.add(plume);
  return n;
}

export function buildRoadster(primary: string, secondary: string): THREE.Group {
  const m = bikeMaterials(primary, secondary);
  const glass = new THREE.MeshPhongMaterial({ color: '#1f1915', specular: '#e8d6c2', shininess: 140, transparent: true, opacity: 0.8 });
  const head = new THREE.MeshBasicMaterial({ color: '#f4fbff' });
  const tail = new THREE.MeshBasicMaterial({ color: '#ff2232' });
  const plate = new THREE.MeshLambertMaterial({ color: '#c9cdd2' });
  const spoke = new THREE.MeshPhongMaterial({ color: '#2b2f35', shininess: 60, specular: '#666666' });
  const gas = new THREE.MeshBasicMaterial({ color: '#eef4f8', transparent: true, opacity: 0.5, depthWrite: false });
  const root = new THREE.Group();
  root.name = 'roadster';

  const body = new THREE.Group();
  const h = hull();
  body.add(new THREE.Mesh(h.paint, m.paint), new THREE.Mesh(h.trim, m.accent), new THREE.Mesh(h.dark, m.dark));
  // Cabin tub under the canopy (keeps the inside dark instead of see-through; the driver sits
  // low in it, reclined) and the dash.
  body.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 2.1).translate(0, -0.04, -0.1), m.dark));
  body.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.3).translate(0, 0.22, 0.42), m.dark));
  // Nose: dark intake under a full-width light bar. Tail: thin light strip, blank plate, diffuser.
  body.add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.06).translate(0, -0.19, 2.19), m.dark));
  body.add(new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.024, 0.03).translate(0, -0.05, 2.205), head));
  body.add(new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.03, 0.03).translate(0, 0.235, -2.205), tail));
  body.add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.11, 0.03).translate(0, 0.1, -2.205), plate));
  body.add(new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.17, 0.4).translate(0, -0.12, -2.02), m.dark));
  mergeByMaterial(body);
  root.add(body);
  const canopy = new THREE.Mesh(h.glass, glass);
  canopy.renderOrder = 1;
  root.add(canopy);

  // Active rear wing: lies flush on the tail deck, lifts on two struts at speed and in the air.
  const wing = new THREE.Group();
  wing.name = 'wing';
  wing.position.set(0, 0.31, -1.9);
  wing.add(new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.04, 0.5), m.paint));
  wing.add(new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.02, 0.025).translate(0, 0.0, -0.26), tail));
  for (const x of [0.45, -0.45]) wing.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.12).translate(x, -0.2, 0.05), m.dark));
  mergeByMaterial(wing);
  root.add(wing);

  // Cold-gas nozzles: four facing down at the corners, two firing sideways from the sills,
  // four in the diffuser facing back (acceleration).
  // Apex at the nozzle, spreading along -Y (unit length, scaled per frame by the vehicle).
  const plumeGeo = new THREE.ConeGeometry(0.2, 1, 10, 1, true).translate(0, -0.5, 0);
  const jets: Record<'jetDown' | 'jetSide' | 'jetRear', THREE.Group> = { jetDown: new THREE.Group(), jetSide: new THREE.Group(), jetRear: new THREE.Group() };
  for (const [name, g] of Object.entries(jets)) {
    g.name = name;
    root.add(g);
  }
  for (const x of [0.7, -0.7]) for (const z of [1.9, -1.88]) jets.jetDown.add(nozzle(m, gas, plumeGeo, [x, -0.3, z], [0, 0, 0]));
  for (const side of [1, -1]) jets.jetSide.add(nozzle(m, gas, plumeGeo, [side * 0.9, -0.26, 0.1], [0, 0, side * (Math.PI / 2 - 0.35)]));
  for (const x of [-0.42, -0.14, 0.14, 0.42]) jets.jetRear.add(nozzle(m, gas, plumeGeo, [x, -0.1, -2.24], [Math.PI / 2, 0, 0]));

  // Centre yoke and seat markers (the air-spec car is a single-seater).
  const sw = new THREE.Group();
  sw.name = 'steeringWheel';
  sw.position.set(0, 0.2, 0.04);
  sw.rotation.x = -1.15;
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
  seat.position.set(0, -0.26, -0.42);
  root.add(seat);
  for (const [name, x] of [['pedalL', 0.12], ['pedalR', -0.12]] as const) {
    const p = new THREE.Object3D();
    p.name = name;
    p.position.set(x, -0.2, 0.42);
    root.add(p);
  }

  for (const [name, x, z] of [
    ['wheelFL', 1, 1],
    ['wheelFR', -1, 1],
    ['wheelRL', 1, -1],
    ['wheelRR', -1, -1],
  ] as const) {
    const w = wheel(m, spoke);
    w.name = name;
    w.position.set(x * ROADSTER.wheelX, ROADSTER.wheelY, z * ROADSTER.wheelZ);
    root.add(w);
  }
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = mesh.material !== glass && mesh.material !== gas && mesh.material !== head && mesh.material !== tail;
  });
  return root;
}
