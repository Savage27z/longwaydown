import * as THREE from 'three';
import { BODY_TYPES, SKIN_TONES } from '../../config/progression';
import type { OutfitPart, RiderLook } from '../../config/riders';

/** Pack material names that aren't clothing: never recoloured as a garment. */
const SKINLIKE = new Set(['Skin', 'Skin_Darker', 'Eye', 'Eyebrows', 'Moustache', 'Earrings']);
const HAIR = new Set(['Hair', 'Hair_White']);

type Mat = THREE.MeshStandardMaterial;

/** A part's garment materials, biggest first (by triangles using them). */
function garments(part: THREE.Object3D): Mat[] {
  const use = new Map<Mat, number>();
  part.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as Mat[];
    const g = m.geometry;
    const total = g.index ? g.index.count : g.attributes.position!.count;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: total, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0];
      if (!mat || SKINLIKE.has(mat.name) || HAIR.has(mat.name) || mat.name === 'Visor') continue;
      use.set(mat, (use.get(mat) ?? 0) + gr.count);
    }
  });
  return [...use.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
}

function each(root: THREE.Object3D, fn: (m: Mat) => void): void {
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    for (const x of (Array.isArray(m.material) ? m.material : [m.material]) as Mat[]) fn(x);
  });
}

/**
 * Apply a rider's style to a freshly built pack character (materials already cloned per rider):
 * slot colours, skin tone, hair, lens tint, body width, and the extra goggles and gloves.
 * `parts` maps Head/Body/Legs/Feet to the kept part nodes. Returns the extra objects created.
 */
export function dress(
  root: THREE.Object3D,
  parts: Partial<Record<OutfitPart, THREE.Object3D>>,
  bones: Record<string, THREE.Object3D>,
  look: RiderLook,
): THREE.Object3D[] {
  const c = look.colors ?? {};
  const set = (m: Mat | undefined, col: string | undefined) => {
    if (m && col) m.color.set(col);
  };
  if (parts.Head) {
    const g = garments(parts.Head);
    set(g[0], c.helmet);
  }
  if (parts.Body) {
    const g = garments(parts.Body);
    set(g[0], c.top);
    set(g[1], c.top2);
  }
  if (parts.Legs) set(garments(parts.Legs)[0], c.pants);
  if (parts.Feet) set(garments(parts.Feet)[0], c.shoes);
  const tone = look.skin !== undefined ? SKIN_TONES[look.skin] : undefined;
  each(root, (m) => {
    if (tone && m.name === 'Skin') m.color.set(tone[0]);
    if (tone && m.name === 'Skin_Darker') m.color.set(tone[1]);
    if (c.hair && HAIR.has(m.name)) m.color.set(c.hair);
    if (c.lens && m.name === 'Visor') m.color.set(c.lens);
  });

  // Body type: wider or narrower torso (children compensate so arms and head keep their size).
  const width = BODY_TYPES.find((b) => b.id === look.bodyType)?.width ?? 1;
  if (width !== 1) {
    for (const name of ['Torso', 'Chest']) {
      const b = bones[name];
      if (!b) continue;
      b.scale.set(width, 1, width);
      for (const ch of b.children) if (ch !== bones.Chest) ch.scale.set(1 / width, 1, 1 / width);
    }
  }

  const extras: THREE.Object3D[] = [];
  root.updateMatrixWorld(true);
  const local = (o: THREE.Object3D, bone: THREE.Object3D) => {
    // Place in character space, then keep that world transform under the bone.
    root.add(o);
    o.updateMatrixWorld(true);
    bone.attach(o);
    extras.push(o);
  };

  if (look.goggles && look.goggles !== 'none' && parts.Head && bones.Head) {
    const box = new THREE.Box3().setFromObject(parts.Head);
    const eyeY = box.min.y + (box.max.y - box.min.y) * 0.62;
    const front = box.max.z;
    const g = new THREE.Group();
    const lens = new THREE.MeshPhongMaterial({ color: c.lens ?? (look.goggles === 'shades' ? '#1b1f26' : '#ff8a3d'), shininess: 120, specular: '#ffffff' });
    const frame = new THREE.MeshLambertMaterial({ color: look.goggles === 'shades' ? '#1b1f26' : c.helmet ?? '#20262e' });
    if (look.goggles === 'goggles') {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.075, 0.04), frame));
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.02), lens);
      l.position.z = 0.016;
      g.add(l);
      // Strap round the back of the head.
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 4, 20), frame);
      strap.rotation.x = Math.PI / 2;
      strap.position.z = -0.09;
      strap.scale.set(1.05, 1.15, 1);
      g.add(strap);
    } else {
      for (const x of [0.04, -0.04]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.035, 0.012), lens);
        l.position.x = x;
        g.add(l);
      }
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.008, 0.012).translate(0, 0.016, 0), frame));
    }
    g.position.set(0, eyeY, front - 0.005);
    local(g, bones.Head);
  }

  if (look.gloves) {
    const mat = new THREE.MeshLambertMaterial({ color: c.gloves ?? '#1b1f26' });
    for (const side of ['L', 'R']) {
      const wrist = bones[`Wrist.${side}`];
      const elbow = bones[`LowerArm.${side}`];
      if (!wrist || !elbow) continue;
      const wp = wrist.getWorldPosition(new THREE.Vector3());
      const dir = wp.clone().sub(elbow.getWorldPosition(new THREE.Vector3())).normalize();
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.085), mat);
      glove.position.copy(wp.addScaledVector(dir, 0.055));
      glove.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      root.worldToLocal(glove.position);
      local(glove, wrist);
    }
  }
  return extras;
}
