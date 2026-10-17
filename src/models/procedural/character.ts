import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Procedural stylized humanoid with a pivot hierarchy. Character space: +Y up, +Z forward,
 * +X = the character's left. Limbs are modelled along local -Y from their joint.
 * Swap for a .glb by providing a model with the same bone names (see ModelLoader).
 */

export const BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulderL',
  'elbowL',
  'handL',
  'shoulderR',
  'elbowR',
  'handR',
  'hipL',
  'kneeL',
  'footL',
  'hipR',
  'kneeR',
  'footR',
] as const;
export type BoneName = (typeof BONES)[number];

export const MATERIAL_SLOTS = ['skin', 'top', 'topAccent', 'pants', 'gloves', 'boots', 'helmet', 'visor', 'backpack'] as const;
export type MaterialSlot = (typeof MATERIAL_SLOTS)[number];

export const LIMBS = {
  upperArm: 0.28,
  forearm: 0.26,
  thigh: 0.44,
  shin: 0.43,
  hipsHeight: 0.95,
};

export interface CharacterRig {
  root: THREE.Group;
  bones: Record<BoneName, THREE.Object3D>;
  materials: Record<MaterialSlot, THREE.MeshLambertMaterial>;
  /** Attachment groups for swappable accessories. */
  slots: { helmet: THREE.Group; goggles: THREE.Group; back: THREE.Group; torso: THREE.Group };
}

type Part = { geo: THREE.BufferGeometry; mat: MaterialSlot };

/** Collects primitive parts per bone, then merges them per material (fewer draw calls). */
class PartList {
  parts = new Map<THREE.Object3D, Part[]>();

  add(bone: THREE.Object3D, mat: MaterialSlot, geo: THREE.BufferGeometry, pos: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0]): void {
    geo.scale(...scale);
    geo.rotateX(rot[0]);
    geo.rotateY(rot[1]);
    geo.rotateZ(rot[2]);
    geo.translate(...pos);
    let list = this.parts.get(bone);
    if (!list) this.parts.set(bone, (list = []));
    list.push({ geo, mat });
  }

  build(materials: Record<MaterialSlot, THREE.Material>): void {
    for (const [bone, list] of this.parts) {
      const byMat = new Map<MaterialSlot, THREE.BufferGeometry[]>();
      for (const p of list) {
        const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
        let arr = byMat.get(p.mat);
        if (!arr) byMat.set(p.mat, (arr = []));
        arr.push(g);
      }
      for (const [mat, geos] of byMat) {
        const merged = mergeGeometries(geos, false);
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, materials[mat]);
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        bone.add(mesh);
      }
    }
  }
}

const sphere = (r: number, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const cyl = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 4, 12);

export function buildCharacterRig(): CharacterRig {
  const mat = (color: string) => new THREE.MeshLambertMaterial({ color });
  const materials = {
    skin: mat('#d9a27a'),
    top: mat('#ff5a1f'),
    topAccent: mat('#16233a'),
    pants: mat('#28303d'),
    gloves: mat('#16233a'),
    boots: mat('#2e333b'),
    helmet: mat('#f2f6fb'),
    visor: mat('#ffb340'),
    backpack: mat('#3ec8ff'),
  } satisfies Record<MaterialSlot, THREE.MeshLambertMaterial>;
  materials.visor.emissive = new THREE.Color('#6a3a00');

  const root = new THREE.Group();
  root.name = 'character';
  const j = (name: BoneName, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const o = new THREE.Group();
    o.name = name;
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const P = new PartList();

  // Torso.
  const hips = j('hips', root, 0, LIMBS.hipsHeight, 0);
  P.add(hips, 'pants', sphere(0.16), [0, -0.02, 0], [1.08, 0.72, 0.78]);
  const spine = j('spine', hips, 0, 0.06, 0);
  P.add(spine, 'top', cyl(0.152, 0.148, 0.26), [0, 0.12, 0], [1, 1, 0.72]);
  P.add(spine, 'topAccent', cyl(0.158, 0.158, 0.05), [0, 0.0, 0], [1, 1, 0.74]);
  const torsoSlot = new THREE.Group();
  torsoSlot.name = 'torsoSlot';
  spine.add(torsoSlot);
  const chest = j('chest', spine, 0, 0.22, 0);
  P.add(chest, 'top', cyl(0.2, 0.158, 0.3), [0, 0.14, 0], [1, 1, 0.7]);
  P.add(chest, 'top', sphere(0.2), [0, 0.29, 0], [1, 0.42, 0.7]);
  P.add(chest, 'topAccent', cyl(0.198, 0.19, 0.045), [0, 0.12, 0], [1, 1, 0.72]);
  P.add(chest, 'topAccent', new THREE.BoxGeometry(0.018, 0.3, 0.01), [0, 0.15, 0.142]);
  P.add(chest, 'topAccent', new THREE.TorusGeometry(0.068, 0.028, 6, 14), [0, 0.335, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
  const neck = j('neck', chest, 0, 0.33, 0);
  P.add(neck, 'skin', cyl(0.048, 0.052, 0.09, 10), [0, 0.02, 0]);
  const head = j('head', neck, 0, 0.06, 0);
  P.add(head, 'skin', sphere(0.112, 16, 12), [0, 0.12, 0.005], [0.95, 1.08, 1.0]);
  P.add(head, 'skin', sphere(0.022, 8, 6), [0, 0.105, 0.112], [0.9, 1.1, 1]);
  P.add(head, 'skin', sphere(0.025, 8, 6), [0.105, 0.115, 0], [0.5, 1, 0.8]);
  P.add(head, 'skin', sphere(0.025, 8, 6), [-0.105, 0.115, 0], [0.5, 1, 0.8]);
  const helmet = new THREE.Group();
  helmet.name = 'helmetSlot';
  head.add(helmet);
  const goggles = new THREE.Group();
  goggles.name = 'gogglesSlot';
  head.add(goggles);
  const back = new THREE.Group();
  back.name = 'backSlot';
  chest.add(back);

  // Limbs.
  for (const side of [1, -1] as const) {
    const s = side === 1 ? 'L' : 'R';
    const sh = j(`shoulder${s}` as BoneName, chest, 0.205 * side, 0.27, 0);
    P.add(sh, 'top', sphere(0.072), [0, -0.01, 0]);
    P.add(sh, 'top', capsule(0.062, LIMBS.upperArm), [0, -LIMBS.upperArm / 2, 0]);
    const el = j(`elbow${s}` as BoneName, sh, 0, -LIMBS.upperArm, 0);
    P.add(el, 'top', sphere(0.056), [0, 0, 0]);
    P.add(el, 'top', cyl(0.056, 0.047, LIMBS.forearm - 0.03), [0, -(LIMBS.forearm - 0.03) / 2, 0]);
    P.add(el, 'topAccent', cyl(0.05, 0.05, 0.035), [0, -LIMBS.forearm + 0.03, 0]);
    const hand = j(`hand${s}` as BoneName, el, 0, -LIMBS.forearm, 0);
    P.add(hand, 'gloves', sphere(0.048, 10, 8), [0, -0.05, 0.005], [0.85, 1.35, 1.05]);
    P.add(hand, 'gloves', capsule(0.018, 0.07), [0.03 * side, -0.035, 0.03], [1, 1, 1], [0.6, 0, -0.5 * side]);

    const hp = j(`hip${s}` as BoneName, hips, 0.095 * side, -0.05, 0);
    P.add(hp, 'pants', sphere(0.088), [0, -0.01, 0]);
    P.add(hp, 'pants', cyl(0.086, 0.066, LIMBS.thigh), [0, -LIMBS.thigh / 2, 0]);
    const kn = j(`knee${s}` as BoneName, hp, 0, -LIMBS.thigh, 0);
    P.add(kn, 'pants', sphere(0.067), [0, 0, 0.005]);
    P.add(kn, 'pants', cyl(0.066, 0.052, LIMBS.shin - 0.1), [0, -(LIMBS.shin - 0.1) / 2, 0]);
    const ft = j(`foot${s}` as BoneName, kn, 0, -LIMBS.shin, 0);
    P.add(ft, 'boots', cyl(0.06, 0.064, 0.13), [0, 0.05, 0]);
    P.add(ft, 'boots', capsule(0.058, 0.27), [0, -0.035, 0.05], [1.05, 0.85, 1], [Math.PI / 2, 0, 0]);
    P.add(ft, 'topAccent', new THREE.BoxGeometry(0.115, 0.022, 0.28), [0, -0.083, 0.05]);
  }

  P.build(materials);
  const bones = {} as Record<BoneName, THREE.Object3D>;
  for (const b of BONES) bones[b] = root.getObjectByName(b)!;
  return { root, bones, materials, slots: { helmet, goggles, back, torso: torsoSlot } };
}
