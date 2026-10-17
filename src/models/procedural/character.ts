import * as THREE from 'three';

/**
 * Procedural low-poly humanoid with a pivot hierarchy. Character space: +Y up, +Z forward,
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
  upperArm: 0.29,
  forearm: 0.27,
  thigh: 0.44,
  shin: 0.43,
  hipsHeight: 0.96,
};

export interface CharacterRig {
  root: THREE.Group;
  bones: Record<BoneName, THREE.Object3D>;
  materials: Record<MaterialSlot, THREE.MeshLambertMaterial>;
  /** Attachment groups for swappable accessories. */
  slots: { helmet: THREE.Group; goggles: THREE.Group; back: THREE.Group; torso: THREE.Group };
}

function capsule(r: number, len: number, mat: THREE.Material, y: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 2, 7), mat);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function buildCharacterRig(): CharacterRig {
  const mat = (color: string) => new THREE.MeshLambertMaterial({ color, flatShading: true });
  const materials = {
    skin: mat('#e0ac83'),
    top: mat('#ff5a1f'),
    topAccent: mat('#1b2b40'),
    pants: mat('#2b3442'),
    gloves: mat('#1b2b40'),
    boots: mat('#3a3f47'),
    helmet: mat('#f4f8ff'),
    visor: mat('#ffb340'),
    backpack: mat('#3ec8ff'),
  } satisfies Record<MaterialSlot, THREE.MeshLambertMaterial>;
  materials.visor.emissive = new THREE.Color('#5a3200');

  const root = new THREE.Group();
  root.name = 'character';
  const j = (name: BoneName, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const o = new THREE.Group();
    o.name = name;
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };

  const hips = j('hips', root, 0, LIMBS.hipsHeight, 0);
  hips.add(box(0.34, 0.17, 0.21, materials.pants, 0, -0.02, 0));
  const spine = j('spine', hips, 0, 0.07, 0);
  const torso = new THREE.Group();
  torso.name = 'torsoSlot';
  spine.add(torso);
  torso.add(box(0.33, 0.24, 0.2, materials.top, 0, 0.12, 0));
  const chest = j('chest', spine, 0, 0.23, 0);
  chest.add(box(0.42, 0.3, 0.24, materials.top, 0, 0.15, 0));
  chest.add(box(0.43, 0.06, 0.25, materials.topAccent, 0, 0.08, 0));
  const neck = j('neck', chest, 0, 0.31, 0);
  neck.add(capsule(0.055, 0.1, materials.skin, 0.03));
  const head = j('head', neck, 0, 0.07, 0);
  head.add(box(0.2, 0.23, 0.22, materials.skin, 0, 0.12, 0.01));
  const helmet = new THREE.Group();
  helmet.name = 'helmetSlot';
  head.add(helmet);
  const goggles = new THREE.Group();
  goggles.name = 'gogglesSlot';
  head.add(goggles);
  const back = new THREE.Group();
  back.name = 'backSlot';
  chest.add(back);

  for (const side of [1, -1] as const) {
    const s = side === 1 ? 'L' : 'R';
    const sh = j(`shoulder${s}` as BoneName, chest, 0.24 * side, 0.25, 0);
    sh.add(capsule(0.062, LIMBS.upperArm, materials.top, -LIMBS.upperArm / 2));
    const el = j(`elbow${s}` as BoneName, sh, 0, -LIMBS.upperArm, 0);
    el.add(capsule(0.055, LIMBS.forearm, materials.top, -LIMBS.forearm / 2));
    const hand = j(`hand${s}` as BoneName, el, 0, -LIMBS.forearm, 0);
    hand.add(box(0.08, 0.1, 0.09, materials.gloves, 0, -0.04, 0.01));
    const hp = j(`hip${s}` as BoneName, hips, 0.1 * side, -0.06, 0);
    hp.add(capsule(0.085, LIMBS.thigh, materials.pants, -LIMBS.thigh / 2));
    const kn = j(`knee${s}` as BoneName, hp, 0, -LIMBS.thigh, 0);
    kn.add(capsule(0.07, LIMBS.shin, materials.pants, -LIMBS.shin / 2));
    const ft = j(`foot${s}` as BoneName, kn, 0, -LIMBS.shin, 0);
    ft.add(box(0.12, 0.1, 0.28, materials.boots, 0, -0.03, 0.06));
  }

  const bones = {} as Record<BoneName, THREE.Object3D>;
  for (const b of BONES) bones[b] = root.getObjectByName(b)!;
  return { root, bones, materials, slots: { helmet, goggles, back, torso } };
}
