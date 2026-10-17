import * as THREE from 'three';
import { mergeByMaterial } from './mergeParts';

/** Reusable detailed bicycle parts. All parts are built around their own origin. */

export interface BikeMaterials {
  paint: THREE.Material;
  accent: THREE.Material;
  dark: THREE.Material;
  rubber: THREE.Material;
  metal: THREE.Material;
  chrome: THREE.Material;
}

export function bikeMaterials(primary: string, secondary: string): BikeMaterials {
  const paint = new THREE.MeshPhongMaterial({ color: primary, shininess: 70, specular: '#555555' });
  paint.name = 'paint:primary';
  const accent = new THREE.MeshPhongMaterial({ color: secondary, shininess: 60, specular: '#444444' });
  accent.name = 'paint:secondary';
  return {
    paint,
    accent,
    dark: new THREE.MeshPhongMaterial({ color: '#1d2127', shininess: 25 }),
    rubber: new THREE.MeshLambertMaterial({ color: '#202226' }),
    metal: new THREE.MeshPhongMaterial({ color: '#9aa3ad', shininess: 80, specular: '#888888' }),
    chrome: new THREE.MeshPhongMaterial({ color: '#d6dde4', shininess: 120, specular: '#ffffff' }),
  };
}

/** Cylinder between two points. */
export function tube(a: THREE.Vector3, b: THREE.Vector3, r0: number, mat: THREE.Material, r1 = r0, seg = 12): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

export function joint(p: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat);
  m.position.copy(p);
  return m;
}

/** Torus tyre with a knobbly tread (radial displacement pattern). Axis = local X. */
function tyre(radius: number, width: number, mtb: boolean, mat: THREE.Material): THREE.Mesh {
  const tubular = 72;
  const radial = 10;
  const g = new THREE.TorusGeometry(radius - width, width, radial, tubular);
  const pos = g.attributes.position!;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ang = Math.atan2(v.y, v.x);
    const r = Math.hypot(v.x, v.y);
    // Only the outer half of the tube gets knobs.
    if (r > radius - width * 0.6) {
      const knob = Math.max(0, Math.sin(ang * (tubular / 2))) * (mtb ? 0.012 : 0.004);
      const s = (r + knob) / r;
      v.x *= s;
      v.y *= s;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.rotation.y = Math.PI / 2;
  return m;
}

/** Complete wheel: treaded tyre, double-wall rim, crossed spokes, hub, optional disc rotor. */
export function wheel(radius: number, width: number, mtb: boolean, m: BikeMaterials, disc: boolean): THREE.Group {
  const g = new THREE.Group();
  g.add(tyre(radius, width, mtb, m.rubber));
  const rimR = radius - width * 2;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(rimR, 0.014, 6, 48), m.dark);
  rim.rotation.y = Math.PI / 2;
  g.add(rim);
  const rimWall = new THREE.Mesh(new THREE.CylinderGeometry(rimR + 0.004, rimR + 0.004, 0.026, 48, 1, true), m.metal);
  rimWall.rotation.z = Math.PI / 2;
  g.add(rimWall);
  // Hub with flanges.
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.11, 10), m.metal);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  for (const x of [0.04, -0.04]) {
    const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.006, 14), m.chrome);
    fl.rotation.z = Math.PI / 2;
    fl.position.x = x;
    g.add(fl);
  }
  // 24 crossed spokes, alternating flange side.
  const n = 24;
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const a0 = (i / n) * Math.PI * 2;
    const a1 = a0 + side * 0.35;
    const p0 = new THREE.Vector3(0.04 * side, Math.sin(a0) * 0.032, Math.cos(a0) * 0.032);
    const p1 = new THREE.Vector3(0.006 * side, Math.sin(a1) * (rimR - 0.006), Math.cos(a1) * (rimR - 0.006));
    g.add(tube(p0, p1, 0.0022, m.chrome, 0.0022, 4));
  }
  if (disc) {
    const rotor = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.009, 4, 24), m.chrome);
    rotor.rotation.y = Math.PI / 2;
    rotor.position.x = -0.055;
    g.add(rotor);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.05, 0.008), m.metal);
      arm.position.set(-0.055, Math.sin(a) * 0.035, Math.cos(a) * 0.035);
      arm.rotation.x = -a;
      g.add(arm);
    }
  }
  mergeByMaterial(g);
  return g;
}

/** Toothed chainring (gear), axis = local X. */
export function chainring(radius: number, teeth: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  for (let i = 0; i <= teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? radius + 0.006 : radius - 0.002;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, radius * 0.6, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.005, bevelEnabled: false });
  g.translate(0, 0, -0.0025);
  const m = new THREE.Mesh(g, mat);
  m.rotation.y = Math.PI / 2;
  return m;
}

/** Rear cassette: stacked cogs. */
export function cassette(m: BikeMaterials): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const cog = chainring(0.025 + i * 0.006, 11 + i * 3, i % 2 ? m.chrome : m.metal);
    cog.position.x = -0.022 - i * 0.004;
    g.add(cog);
  }
  mergeByMaterial(g);
  return g;
}

/** Closed chain loop between chainring (front) and cassette (rear) in the bike's YZ plane. */
export function chain(front: THREE.Vector3, rear: THREE.Vector3, rf: number, rr: number, x: number, mat: THREE.Material): THREE.Mesh {
  const pts: THREE.Vector3[] = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI / 2 - (i / steps) * Math.PI;
    pts.push(new THREE.Vector3(x, front.y + Math.sin(a) * rf, front.z + Math.cos(a) * rf));
  }
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 - (i / steps) * Math.PI;
    pts.push(new THREE.Vector3(x, rear.y + Math.sin(a) * rr, rear.z + Math.cos(a) * rr));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.004, 4, true), mat);
}

/** Sculpted saddle (wide back, narrow nose). +Z = nose. */
export function saddle(mat: THREE.Material, rails: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.12);
  shape.bezierCurveTo(0.075, -0.12, 0.08, -0.05, 0.035, 0.02);
  shape.bezierCurveTo(0.02, 0.07, 0.02, 0.12, 0.012, 0.14);
  shape.lineTo(-0.012, 0.14);
  shape.bezierCurveTo(-0.02, 0.12, -0.02, 0.07, -0.035, 0.02);
  shape.bezierCurveTo(-0.08, -0.05, -0.075, -0.12, 0, -0.12);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 3, curveSegments: 10 });
  // Shape Y (length) -> +Z (nose forward); extrusion depth goes downward.
  geo.rotateX(Math.PI / 2);
  const top = new THREE.Mesh(geo, mat);
  top.position.y = 0.035;
  g.add(top);
  for (const x of [0.02, -0.02]) g.add(tube(new THREE.Vector3(x, -0.03, -0.08), new THREE.Vector3(x, -0.03, 0.09), 0.003, rails, 0.003, 4));
  mergeByMaterial(g);
  return g;
}

/** Flat pedal with pins. */
export function pedal(m: BikeMaterials): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.016, 0.1), m.dark));
  for (const x of [-0.04, 0.04]) {
    for (const z of [-0.042, 0, 0.042]) {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.026, 4), m.chrome);
      pin.position.set(x, 0, z);
      g.add(pin);
    }
  }
  mergeByMaterial(g);
  return g;
}
