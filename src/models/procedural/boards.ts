import * as THREE from 'three';
import { bikeMaterials, tube } from './bikeParts';
import { mergeByMaterial } from './mergeParts';

/** Snowboard and skis. Origin on the snow under the rider, +Z forward. */

/**
 * Board outline in (across, along) with a sidecut and rounded tips: `waist` wide in the middle,
 * `tipW` at the contact points `contact` from the centre, rounded off to `length`.
 */
function outline(length: number, waist: number, tipW: number, contact: number): THREE.Shape {
  const hl = length / 2;
  const pts: THREE.Vector2[] = [];
  const steps = 14;
  // Right edge, tail contact to nose contact (sidecut: a parabola through the waist).
  for (let i = 0; i <= steps; i++) {
    const z = -contact + (i / steps) * contact * 2;
    const t = z / contact;
    pts.push(new THREE.Vector2((waist + (tipW - waist) * t * t) / 2, z));
  }
  // Nose: half-ellipse from the right contact point over to the left.
  for (let i = 1; i < steps; i++) {
    const a = (i / steps) * Math.PI;
    pts.push(new THREE.Vector2(Math.cos(a) * (tipW / 2), contact + Math.sin(a) * (hl - contact)));
  }
  for (let i = 0; i <= steps; i++) {
    const z = contact - (i / steps) * contact * 2;
    const t = z / contact;
    pts.push(new THREE.Vector2(-(waist + (tipW - waist) * t * t) / 2, z));
  }
  for (let i = 1; i < steps; i++) {
    const a = Math.PI + (i / steps) * Math.PI;
    pts.push(new THREE.Vector2(Math.cos(a) * (tipW / 2), -contact + Math.sin(a) * (hl - contact)));
  }
  return new THREE.Shape(pts);
}

/** Plank with a graphic top sheet (texture over the board), dark edges, tips bent up. */
function plank(length: number, waist: number, tipW: number, contact: number, thick: number, tipRise: number, top: THREE.Material, edge: THREE.Material): THREE.Mesh {
  const g = new THREE.ExtrudeGeometry(outline(length, waist, tipW, contact), { depth: thick, bevelEnabled: false, curveSegments: 8 });
  // Caps get UVs from the outline: map them 0..1 over the board for the top-sheet texture.
  const uv = g.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tipW + 0.5, uv.getY(i) / length + 0.5);
  g.rotateX(Math.PI / 2);
  const pos = g.attributes.position!;
  const hl = length / 2;
  const bend = hl - contact;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const t = Math.max(0, (Math.abs(z) - contact) / bend);
    pos.setY(i, pos.getY(i) + t * t * tipRise);
  }
  g.computeVertexNormals();
  g.translate(0, thick, 0);
  // ExtrudeGeometry groups: 0 = top/bottom caps, 1 = side walls.
  const mesh = new THREE.Mesh(g, [top, edge]);
  mesh.castShadow = true;
  return mesh;
}

/** Top-sheet graphics, cached per colour scheme (materials don't dispose their maps). */
const sheets = new Map<string, THREE.Texture>();
function topSheet(kind: 'board' | 'ski', primary: string, secondary: string): THREE.Texture {
  const key = `${kind}:${primary}:${secondary}`;
  const hit = sheets.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = kind === 'board' ? 256 : 64;
  c.height = 1024;
  const x = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  x.fillStyle = primary;
  x.fillRect(0, 0, W, H);
  if (kind === 'board') {
    // Diagonal bands, a ring emblem between the bindings and a dark fade at the tips.
    x.fillStyle = secondary;
    for (let i = -4; i < 12; i++) {
      x.beginPath();
      x.moveTo(0, i * 110);
      x.lineTo(W, i * 110 - 140);
      x.lineTo(W, i * 110 - 140 + 34);
      x.lineTo(0, i * 110 + 34);
      x.fill();
    }
    x.fillStyle = primary;
    x.fillRect(W * 0.12, H * 0.36, W * 0.76, H * 0.28);
    x.strokeStyle = secondary;
    x.lineWidth = 14;
    x.beginPath();
    x.arc(W / 2, H / 2, W * 0.28, 0, Math.PI * 2);
    x.stroke();
    x.fillStyle = '#ffffff';
    x.beginPath();
    x.arc(W / 2, H / 2, W * 0.12, 0, Math.PI * 2);
    x.fill();
  } else {
    // Ski: a long secondary stripe with chevrons near the tip.
    x.fillStyle = secondary;
    x.fillRect(W * 0.38, H * 0.08, W * 0.24, H * 0.84);
    for (let i = 0; i < 6; i++) {
      const y = H * 0.12 + i * 34;
      x.beginPath();
      x.moveTo(W * 0.1, y + 24);
      x.lineTo(W / 2, y);
      x.lineTo(W * 0.9, y + 24);
      x.lineTo(W * 0.9, y + 36);
      x.lineTo(W / 2, y + 12);
      x.lineTo(W * 0.1, y + 36);
      x.fill();
    }
  }
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(10,14,20,0.55)');
  g.addColorStop(0.12, 'rgba(10,14,20,0)');
  g.addColorStop(0.88, 'rgba(10,14,20,0)');
  g.addColorStop(1, 'rgba(10,14,20,0.55)');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  sheets.set(key, tex);
  return tex;
}

/** Strap binding with a highback; built with the toes along -X, heel at +X. */
function binding(m: ReturnType<typeof bikeMaterials>): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.018, 0.13).translate(-0.01, 0.034, 0), m.dark));
  // Side walls (heel cup) and the highback behind the heel, leaning forward.
  for (const z of [0.066, -0.066]) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.012).translate(0, 0.06, z), m.dark));
  const hb = new THREE.CylinderGeometry(0.068, 0.07, 0.24, 12, 1, true, Math.PI / 2 - 1.4, 2.8);
  hb.translate(0, 0.12, 0);
  hb.rotateZ(0.28);
  hb.translate(0.055, 0.04, 0);
  g.add(new THREE.Mesh(hb, m.dark));
  // Ankle and toe straps arching over the boot.
  g.add(new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.016, 5, 12, Math.PI).rotateY(Math.PI / 2).translate(0.01, 0.08, 0), m.accent));
  g.add(new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 5, 12, Math.PI).rotateY(Math.PI / 2).translate(-0.1, 0.045, 0), m.accent));
  mergeByMaterial(g);
  return g;
}

export function buildSnowboard(primary: string, secondary: string): THREE.Group {
  const m = bikeMaterials(primary, secondary);
  const top = new THREE.MeshPhongMaterial({ map: topSheet('board', primary, secondary), shininess: 60, specular: '#666666' });
  const root = new THREE.Group();
  root.name = 'snowboard';
  root.add(plank(1.55, 0.25, 0.295, 0.58, 0.014, 0.08, top, m.dark));
  for (const [name, z] of [['footL', 0.25], ['footR', -0.25]] as const) {
    // Stance angle matches the rider's foot yaw (toes toward -X, angled slightly to the nose).
    const b = binding(m);
    b.rotation.y = 0.25;
    b.position.z = z;
    root.add(b);
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(0, 0.12, z);
    root.add(o);
  }
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return root;
}

export function buildSkis(primary: string, secondary: string): THREE.Group {
  const m = bikeMaterials(primary, secondary);
  const top = new THREE.MeshPhongMaterial({ map: topSheet('ski', primary, secondary), shininess: 70, specular: '#777777' });
  const root = new THREE.Group();
  root.name = 'skis';
  for (const [name, x] of [['skiL', 0.12], ['skiR', -0.12]] as const) {
    const ski = new THREE.Group();
    ski.name = name;
    // Twin-tip freeride ski: rockered both ends.
    ski.add(plank(1.78, 0.088, 0.118, 0.66, 0.016, 0.09, top, m.dark));
    const parts = new THREE.Group();
    // Riser plate, toe piece, heel piece with its brake arms.
    parts.add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.42).translate(0, 0.022, 0), m.dark));
    parts.add(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.045, 0.08).translate(0, 0.045, 0.19), m.dark));
    parts.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.07, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 0.05, 0.225), m.metal));
    parts.add(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.06, 0.1).translate(0, 0.052, -0.2), m.dark));
    parts.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.05).translate(0, 0.088, -0.18), m.accent));
    for (const s of [1, -1]) parts.add(tube(new THREE.Vector3(0.03 * s, 0.03, -0.16), new THREE.Vector3(0.05 * s, 0.01, -0.06), 0.004, m.metal));
    mergeByMaterial(parts);
    ski.add(parts);
    ski.position.x = x;
    root.add(ski);
    const foot = new THREE.Object3D();
    foot.name = name === 'skiL' ? 'footL' : 'footR';
    foot.position.set(x, 0.12, 0);
    root.add(foot);
  }
  // Poles are positioned every frame by the vehicle (they follow the hands).
  for (const name of ['poleL', 'poleR']) {
    const pole = new THREE.Group();
    pole.name = name;
    pole.add(tube(new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0, -1.12, 0), 0.009, m.metal, 0.006, 8));
    pole.add(new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.006, 0.05, 6).translate(0, -1.15, 0), m.metal));
    pole.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 12).translate(0, -1.04, 0), m.dark));
    pole.add(new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.015, 0.15, 10).translate(0, -0.04, 0), m.rubber));
    pole.add(new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.02, 10).translate(0, 0.035, 0), m.accent));
    pole.add(new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.005, 4, 12).translate(0, 0.0, 0.02), m.dark));
    mergeByMaterial(pole);
    root.add(pole);
  }
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return root;
}
