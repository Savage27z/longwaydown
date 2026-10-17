import * as THREE from 'three';
import { merge, paint, paintFaces, translate } from './geometry';

/**
 * Course structures built from primitives. Each builder returns a render object in a local
 * frame (origin on the ground, +Z = along the course, +X = rider's left) plus collider specs
 * in that same frame.
 */

export type Vec3T = [number, number, number];
export type ColliderSpec =
  | { type: 'cuboid'; half: Vec3T; pos: Vec3T; rotY?: number; rotX?: number }
  | { type: 'cylinder'; halfHeight: number; radius: number; pos: Vec3T; rotX?: number; rotZ?: number }
  | { type: 'ball'; radius: number; pos: Vec3T }
  | { type: 'convex'; points: Float32Array; pos: Vec3T }
  | { type: 'trimesh'; vertices: Float32Array; indices: Uint32Array; pos: Vec3T };

export interface Structure {
  object: THREE.Object3D;
  colliders: ColliderSpec[];
  /** Materials created specifically for this structure (disposed with it). */
  ownMaterials?: THREE.Material[];
}

let sharedMat: THREE.MeshLambertMaterial | null = null;
/** Shared vertex-colour flat material for all structures. */
export function structureMaterial(): THREE.MeshLambertMaterial {
  if (!sharedMat) {
    sharedMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    sharedMat.userData.shared = true;
  }
  return sharedMat;
}

function mesh(geo: THREE.BufferGeometry, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, structureMaterial());
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function box(w: number, h: number, d: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  return paint(translate(new THREE.BoxGeometry(w, h, d), x, y, z), color);
}

/** Wedge ramp: rises along +Z from 0 to `height` over `length`. */
export function ramp(length: number, height: number, width: number, color = '#c98b4e'): Structure {
  const hw = width / 2;
  const pts = [
    [-hw, 0, 0], [hw, 0, 0], [-hw, 0, length], [hw, 0, length], [-hw, height, length], [hw, height, length],
  ];
  const geo = new THREE.BufferGeometry();
  const tris = [
    [0, 4, 2], [1, 3, 5], // sides
    [0, 1, 5], [0, 5, 4], // slope
    [2, 4, 5], [2, 5, 3], // back
    [0, 2, 3], [0, 3, 1], // bottom
  ];
  const pos: number[] = [];
  for (const t of tris) for (const i of t) pos.push(...(pts[i] as number[]));
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const base = new THREE.Color(color);
  const stripe = new THREE.Color('#ffd23f');
  const painted = paintFaces(geo, (_x, y, z, f, out) => {
    out.copy(base);
    if (f >= 2 && f <= 3 && z > length - 0.9 && y > height - 0.4) out.copy(stripe);
  });
  const object = new THREE.Group();
  object.add(mesh(merge([painted])));
  const points = new Float32Array(pts.flat());
  return { object, colliders: [{ type: 'convex', points, pos: [0, 0, 0] }] };
}

/** A log lying along the course (rideable / grindable). */
export function log(length: number, radius: number): Structure {
  const g = new THREE.CylinderGeometry(radius, radius * 1.08, length, 7);
  g.rotateX(Math.PI / 2);
  g.translate(0, radius, 0);
  const object = new THREE.Group();
  const bark = new THREE.Color('#6a4a32');
  const cut = new THREE.Color('#c8a274');
  object.add(
    mesh(
      merge([
        paintFaces(g, (_x, _y, z, _f, out) => {
          out.copy(Math.abs(z) > length / 2 - 0.05 ? cut : bark);
        }),
      ]),
    ),
  );
  return { object, colliders: [{ type: 'cylinder', halfHeight: length / 2, radius, pos: [0, radius, 0], rotX: Math.PI / 2 }] };
}

/** Natural rock arch spanning the corridor. */
export function rockArch(span: number, height: number, color: string): Structure {
  const R = span / 2;
  const torus = new THREE.TorusGeometry(R, 4.5, 5, 14, Math.PI);
  torus.scale(1, height / R, 1);
  const base = new THREE.Color(color);
  const dark = base.clone().multiplyScalar(0.8);
  const object = new THREE.Group();
  object.add(mesh(merge([paintFaces(torus, (_x, _y, _z, f, out) => out.copy(f % 4 === 0 ? dark : base))])));
  object.children[0]!.position.y = -2;
  return {
    object,
    colliders: [
      { type: 'cylinder', halfHeight: 10, radius: 5, pos: [R, 6, 0] },
      { type: 'cylinder', halfHeight: 10, radius: 5, pos: [-R, 6, 0] },
    ],
  };
}

/** Half-cylinder tunnel shell along +Z, with ceiling lights. */
export function tunnelShell(length: number, radius: number, wallColor: string): Structure {
  const g = new THREE.CylinderGeometry(radius, radius, length, 14, 1, true, -Math.PI / 2, Math.PI);
  // Axis Y -> Z with the half-arc on top (open side down).
  g.rotateX(-Math.PI / 2);
  g.translate(0, -0.5, 0);
  const object = new THREE.Group();
  const base = new THREE.Color(wallColor);
  const shell = merge([paintFaces(g, (_x, _y, _z, f, out) => out.copy(base).multiplyScalar(f % 2 ? 0.9 : 1))]);
  const m = new THREE.Mesh(shell, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  m.receiveShadow = true;
  object.add(m);
  const lightMat = new THREE.MeshBasicMaterial({ color: '#fff3c4' });
  for (let z = -length / 2 + 6; z < length / 2; z += 9) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 2.2), lightMat);
    l.position.set(0, radius - 0.9, z);
    object.add(l);
  }
  // Trimesh collider from the shell itself so jumps can clip the ceiling.
  const pos = shell.attributes.position!;
  const vertices = new Float32Array(pos.array);
  const indices = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) indices[i] = i;
  return { object, colliders: [{ type: 'trimesh', vertices, indices, pos: [0, 0, 0] }], ownMaterials: [m.material as THREE.Material, lightMat] };
}

/** Start area: deck, gate with banner, hut, flags. */
export function startArea(primary: string): Structure {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(26, 1, 30, '#8b6a4a', 0, -0.4, -6));
  // Gate posts + banner.
  parts.push(box(1, 7, 1, '#2b3442', 9, 3.5, 4));
  parts.push(box(1, 7, 1, '#2b3442', -9, 3.5, 4));
  parts.push(box(19, 2, 0.4, primary, 0, 6.6, 4));
  parts.push(box(17, 0.4, 0.5, '#ffffff', 0, 5.4, 4));
  // Hut.
  parts.push(box(8, 4.5, 7, '#a0522d', 13, 2.25, -14));
  const roof = new THREE.ConeGeometry(6.4, 3.2, 4);
  roof.rotateY(Math.PI / 4);
  roof.scale(1, 1, 0.9);
  parts.push(paint(translate(roof, 13, 6.1, -14), '#e8eef5'));
  parts.push(box(1.6, 2.6, 0.2, '#3a2a1e', 13, 1.3, -10.4));
  // Flags.
  const flagColors = [primary, '#ffd23f', '#3ec8ff', '#4ade80', '#ff4d6d'];
  for (let i = 0; i < 10; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const z = -16 + Math.floor(i / 2) * 6;
    parts.push(box(0.15, 5, 0.15, '#dfe6ee', side * 14, 2.5, z));
    parts.push(box(0.1, 1.2, 1.8, flagColors[i % flagColors.length]!, side * 14, 4.3, z + 0.95));
  }
  const object = new THREE.Group();
  object.add(mesh(merge(parts)));
  return {
    object,
    colliders: [
      { type: 'cuboid', half: [13, 0.5, 15], pos: [0, -0.4, -6] },
      { type: 'cuboid', half: [4, 2.25, 3.5], pos: [13, 2.25, -14] },
      { type: 'cylinder', halfHeight: 3.5, radius: 0.6, pos: [9, 3.5, 4] },
      { type: 'cylinder', halfHeight: 3.5, radius: 0.6, pos: [-9, 3.5, 4] },
    ],
  };
}

/** Finish arch spanning the line. */
export function finishArch(span: number, primary: string): Structure {
  const R = span / 2;
  const t = new THREE.TorusGeometry(R, 1.4, 6, 24, Math.PI);
  t.scale(1, 0.55, 1);
  const object = new THREE.Group();
  const stripes = [new THREE.Color(primary), new THREE.Color('#ffffff')];
  object.add(mesh(merge([paintFaces(t, (x, _y, _z, _f, out) => out.copy(stripes[Math.abs(Math.floor((x + R) / 3)) % 2]!))])));
  const banner = box(span * 0.5, 2.4, 0.4, '#0d1b2a', 0, R * 0.55 - 0.6, 0);
  object.add(mesh(merge([banner])));
  return {
    object,
    colliders: [
      { type: 'cylinder', halfHeight: 3, radius: 1.5, pos: [R, 2, 0] },
      { type: 'cylinder', halfHeight: 3, radius: 1.5, pos: [-R, 2, 0] },
    ],
  };
}

/** Small chalet/house. */
export function house(w: number, d: number, h: number, wall: string, roofColor: string): Structure {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(w, h, d, wall, 0, h / 2, 0));
  const roof = new THREE.CylinderGeometry(w * 0.62, w * 0.62, d + 0.6, 3, 1);
  roof.rotateX(Math.PI / 2);
  roof.rotateZ(Math.PI);
  roof.scale(1, 0.55, 1);
  parts.push(paint(translate(roof, 0, h + w * 0.17, 0), roofColor));
  parts.push(box(w * 0.18, h * 0.45, 0.15, '#3a2a1e', 0, h * 0.22, d / 2 + 0.05));
  parts.push(box(w * 0.2, w * 0.2, 0.12, '#bfe3ff', w * 0.28, h * 0.62, d / 2 + 0.05));
  parts.push(box(w * 0.2, w * 0.2, 0.12, '#bfe3ff', -w * 0.28, h * 0.62, d / 2 + 0.05));
  const object = new THREE.Group();
  object.add(mesh(merge(parts)));
  return { object, colliders: [{ type: 'cuboid', half: [w / 2, h / 2 + 1, d / 2], pos: [0, h / 2, 0] }] };
}

/** Wooden bridge deck spanning `length` along +Z. */
export function bridge(length: number, width: number): Structure {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(width, 0.5, length, '#8b6a4a', 0, -0.25, 0));
  for (const side of [-1, 1]) {
    parts.push(box(0.25, 1.1, length, '#5e4330', (side * width) / 2, 0.55, 0));
    for (let z = -length / 2; z <= length / 2; z += 4) parts.push(box(0.3, 1.3, 0.3, '#4a3426', (side * width) / 2, 0.45, z));
  }
  const object = new THREE.Group();
  object.add(mesh(merge(parts)));
  return {
    object,
    colliders: [
      { type: 'cuboid', half: [width / 2, 0.25, length / 2], pos: [0, -0.25, 0] },
      { type: 'cuboid', half: [0.15, 0.6, length / 2], pos: [width / 2, 0.6, 0] },
      { type: 'cuboid', half: [0.15, 0.6, length / 2], pos: [-width / 2, 0.6, 0] },
    ],
  };
}

/** Distance sign with a canvas texture ("12 KM"). */
export function kmSign(km: number, remainingKm: number, primary: string): Structure {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0d1b2a';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = primary;
  ctx.fillRect(0, 0, 256, 14);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'italic 900 58px Arial Black, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${km} KM`, 128, 78);
  ctx.font = '700 20px Arial, sans-serif';
  ctx.fillStyle = '#9fb3c8';
  ctx.fillText(`${remainingKm.toFixed(1)} km to go`, 128, 110);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const boardMat = new THREE.MeshLambertMaterial({ map: tex });
  const object = new THREE.Group();
  const post = mesh(merge([box(0.3, 4, 0.3, '#2b3442', -1.6, 2, 0), box(0.3, 4, 0.3, '#2b3442', 1.6, 2, 0)]));
  object.add(post);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.1), boardMat);
  board.position.set(0, 4.2, -0.18);
  board.rotation.y = Math.PI; // face riders coming down (+Z travel -> face -Z)
  const back = mesh(merge([box(4.4, 2.3, 0.3, '#1b2b40', 0, 4.2, 0)]));
  object.add(back, board);
  return { object, colliders: [{ type: 'cuboid', half: [2.2, 2.5, 0.3], pos: [0, 2.5, 0] }], ownMaterials: [boardMat] };
}

/** Pair of small warning flags marking a jump/gap lip. */
export function lipFlags(width: number, color: string): Structure {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    parts.push(box(0.1, 2.2, 0.1, '#ffffff', (side * width) / 2, 1.1, 0));
    parts.push(box(0.06, 0.6, 0.9, color, (side * width) / 2, 1.9, -0.45));
  }
  const object = new THREE.Group();
  object.add(mesh(merge(parts), false));
  return { object, colliders: [] };
}

/** Viewpoint: short fence + bench at the corridor edge. */
export function viewpoint(): Structure {
  const parts: THREE.BufferGeometry[] = [];
  for (let z = -8; z <= 8; z += 4) parts.push(box(0.25, 1.2, 0.25, '#5e4330', 0, 0.6, z));
  parts.push(box(0.15, 0.15, 16.5, '#8b6a4a', 0, 1.1, 0));
  parts.push(box(0.15, 0.15, 16.5, '#8b6a4a', 0, 0.6, 0));
  parts.push(box(1.6, 0.15, 3.2, '#8b6a4a', 2.2, 0.55, 0));
  parts.push(box(0.3, 0.55, 0.3, '#5e4330', 2.2, 0.27, -1.3));
  parts.push(box(0.3, 0.55, 0.3, '#5e4330', 2.2, 0.27, 1.3));
  const object = new THREE.Group();
  object.add(mesh(merge(parts)));
  return { object, colliders: [{ type: 'cuboid', half: [0.2, 0.7, 8.2], pos: [0, 0.7, 0] }] };
}

/** Translucent water ribbon (rivers / fords), length along +Z in the local frame. */
export function waterPlane(width: number, length: number, color: string): Structure {
  const geo = new THREE.PlaneGeometry(width, length, 1, 8);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.78 });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  const object = new THREE.Group();
  object.add(m);
  return { object, colliders: [], ownMaterials: [mat] };
}

/** Checkpoint gate: two inflatable-style posts and a banner reading "CHECKPOINT n". */
export function checkpointGate(span: number, index: number, color: string): Structure {
  const parts: THREE.BufferGeometry[] = [];
  const half = span / 2;
  for (const side of [-1, 1]) {
    parts.push(paint(translate(new THREE.CylinderGeometry(0.55, 0.7, 7, 10), side * half, 3.5, 0), color));
    parts.push(paint(translate(new THREE.SphereGeometry(0.6, 10, 6), side * half, 7.1, 0), '#ffffff'));
  }
  const object = new THREE.Group();
  object.add(mesh(merge(parts)));
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'italic 900 56px Arial Black, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`CHECKPOINT ${index}`, 256, 50);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(span, span * (96 / 512)), mat);
  banner.position.y = 6.2;
  banner.rotation.y = Math.PI;
  object.add(banner);
  return {
    object,
    colliders: [
      { type: 'cylinder', halfHeight: 3.5, radius: 0.65, pos: [half, 3.5, 0] },
      { type: 'cylinder', halfHeight: 3.5, radius: 0.65, pos: [-half, 3.5, 0] },
    ],
    ownMaterials: [mat],
  };
}
