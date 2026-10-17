import * as THREE from 'three';
import { merge, paint, paintFaces, translate } from './geometry';
import { box, structureMaterial, type ColliderSpec, type Structure } from './structures';

/** Race-event dressing: inflatable arches with banners, pop-up tents and feather flags. */

const mesh = (g: THREE.BufferGeometry, shadow = true) => {
  const m = new THREE.Mesh(g, structureMaterial());
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
};

/** Unlit text banner (readable in any light). */
function banner(text: string, width: number, height: number, bg: string, fg = '#ffffff', checker = false): { mesh: THREE.Mesh; material: THREE.Material } {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.max(64, Math.round((1024 * height) / width));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (checker) {
    const sq = canvas.height / 4;
    for (let y = 0; y < 4; y++) for (let x = 0; x * sq < canvas.width; x++) if ((x + y) % 2 === 0) ctx.fillRect(x * sq, y * sq, sq, sq);
    ctx.fillStyle = '#ffffff';
    for (let y = 0; y < 4; y++) for (let x = 0; x * sq < canvas.width; x++) if ((x + y) % 2 === 1) ctx.fillRect(x * sq, y * sq, sq, sq);
    ctx.fillStyle = 'rgba(13,27,42,0.85)';
    ctx.fillRect(canvas.width * 0.2, canvas.height * 0.12, canvas.width * 0.6, canvas.height * 0.76);
  }
  ctx.fillStyle = fg;
  ctx.font = `italic 900 ${Math.round(canvas.height * 0.62)}px Arial Black, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height * 0.54);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // Single-sided: arches carry one panel per face, so the text never reads mirrored.
  const material = new THREE.MeshBasicMaterial({ map: tex });
  return { mesh: new THREE.Mesh(new THREE.PlaneGeometry(width, height), material), material };
}

/**
 * Inflatable arch spanning the trail (local X), banner on top facing riders coming down (-Z side).
 * Two-tone segments, weighted feet.
 */
export function eventArch(span: number, label: string, color: string, accent = '#ffffff', checker = false): Structure {
  const R = span / 2;
  const tube = 0.95;
  const torus = new THREE.TorusGeometry(R, tube, 10, 28, Math.PI);
  torus.scale(1, 0.62, 1);
  const a = new THREE.Color(color);
  const b = new THREE.Color(accent);
  const parts: THREE.BufferGeometry[] = [paintFaces(torus, (x, _y, _z, _f, out) => out.copy(Math.abs(Math.floor((x + R) / 2.4)) % 2 === 0 ? a : b))];
  for (const side of [-1, 1]) parts.push(box(2.4, 0.6, 2.4, '#2b3442', side * R, 0.3, 0));
  const object = new THREE.Group();
  object.add(mesh(merge(parts)));
  const top = R * 0.62;
  const bw = Math.min(span * 0.62, 16);
  const ban = banner(label, bw, bw * 0.16, color, '#ffffff', checker);
  // Riders coming down see the -Z face; spectators below see the +Z face.
  ban.mesh.position.set(0, top - 0.6, -(tube + 0.15));
  ban.mesh.rotation.y = Math.PI;
  object.add(ban.mesh);
  const back = new THREE.Mesh(ban.mesh.geometry, ban.material);
  back.position.set(0, top - 0.6, tube + 0.15);
  object.add(back);
  const colliders: ColliderSpec[] = [
    { type: 'cylinder', halfHeight: 2, radius: tube + 0.2, pos: [R, 2, 0] },
    { type: 'cylinder', halfHeight: 2, radius: tube + 0.2, pos: [-R, 2, 0] },
  ];
  return { object, colliders, ownMaterials: [ban.material] };
}

/** 3x3 m pop-up canopy tent with a coloured valance and a table. */
export function popupTent(color: string, accent = '#ffffff'): Structure {
  const parts: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[-1.45, -1.45], [1.45, -1.45], [-1.45, 1.45], [1.45, 1.45]] as const) parts.push(box(0.08, 2.3, 0.08, '#d7dde4', x, 1.15, z));
  const roof = new THREE.ConeGeometry(2.25, 0.9, 4, 1);
  roof.rotateY(Math.PI / 4);
  parts.push(paint(translate(roof, 0, 2.75, 0), color));
  for (const [w, d, x, z] of [[3, 0.05, 0, 1.5], [3, 0.05, 0, -1.5], [0.05, 3, 1.5, 0], [0.05, 3, -1.5, 0]] as const) parts.push(box(w, 0.35, d, accent, x, 2.15, z));
  parts.push(box(2, 0.08, 0.8, '#f4f4f4', 0, 0.85, 0.6));
  parts.push(box(0.06, 0.85, 0.06, '#9aa3ad', -0.9, 0.42, 0.3), box(0.06, 0.85, 0.06, '#9aa3ad', 0.9, 0.42, 0.3));
  const object = new THREE.Group();
  object.add(mesh(merge(parts)));
  return { object, colliders: [{ type: 'cuboid', half: [1.5, 1.4, 1.5], pos: [0, 1.4, 0] }] };
}

/** Tall feather flag (curved banner on a pole). */
export function featherFlag(color: string): Structure {
  const parts: THREE.BufferGeometry[] = [box(0.06, 4.4, 0.06, '#d7dde4', 0, 2.2, 0)];
  // Banner: stacked slices bowing out like a feather.
  for (let k = 0; k < 6; k++) {
    const y = 1.3 + k * 0.5;
    const bow = Math.sin((k / 5) * Math.PI) * 0.25;
    const w = 0.75 - Math.max(0, k - 3) * 0.12;
    parts.push(box(0.03, 0.5, w, color, 0, y, w / 2 + 0.04 + bow));
  }
  const object = new THREE.Group();
  object.add(mesh(merge(parts), false));
  return { object, colliders: [] };
}

/** The start: arch across the trail, tents and flags along the run-up (no deck). */
export function startArea(primary: string, trailHalf: number): Structure {
  const arch = eventArch(trailHalf * 2 + 5, 'START', primary, '#ffd23f');
  const object = new THREE.Group();
  object.add(arch.object);
  const colliders = [...arch.colliders];
  const own = [...(arch.ownMaterials ?? [])];
  const colors = ['#3ec8ff', primary, '#4ade80', '#ffd23f', '#ff4d6d'];
  for (const side of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const t = popupTent(colors[(k + (side > 0 ? 0 : 2)) % colors.length]!);
      const x = side * (trailHalf + 9 + k * 4.2);
      t.object.position.set(x, 0, -6 - k * 2);
      object.add(t.object);
      for (const c of t.colliders) if (c.type === 'cuboid') colliders.push({ ...c, pos: [c.pos[0] + x, c.pos[1], c.pos[2] - 6 - k * 2] });
    }
    for (let k = 0; k < 4; k++) {
      const f = featherFlag(colors[(k + (side > 0 ? 1 : 3)) % colors.length]!);
      f.object.position.set(side * (trailHalf + 3.5), 0, 6 + k * 9);
      f.object.rotation.y = side > 0 ? Math.PI : 0;
      object.add(f.object);
    }
  }
  return { object, colliders, ownMaterials: own };
}
