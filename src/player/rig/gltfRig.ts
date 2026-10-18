import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { partMeshName, type RiderLook } from '../../config/riders';
import type { BoneAxes } from '../../utils/ik';
import type { Limb, RigBinding, TorsoBone } from './RigBinding';
import { dress } from './dress';

const FORWARD = new THREE.Vector3(0, 0, 1);

/** glTF node names lose '.' when loaded (PropertyBinding.sanitizeNodeName). Try both spellings. */
function findBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return root.getObjectByName(name) ?? root.getObjectByName(name.replace(/\./g, '')) ?? null;
}

interface Bind {
  pos: THREE.Vector3;
  rot: THREE.Quaternion;
}

/**
 * Build a rider from the merged Quaternius pack (see scripts/build-riders.mjs): keep only the
 * chosen outfit parts, clone their materials (for per-rider recolouring), and derive bone axes,
 * lengths and rest rotations from the skin's bind pose so the shared IK/pose code can drive it.
 */
export function gltfRig(source: THREE.Object3D, look: RiderLook): RigBinding | null {
  const scene = cloneSkinned(source) as THREE.Group;
  const root = new THREE.Group();
  root.name = 'character';
  root.add(scene);

  const wanted = new Set([partMeshName(look.head, 'Head'), partMeshName(look.body, 'Body'), partMeshName(look.legs, 'Legs'), partMeshName(look.feet, 'Feet')]);
  if (look.backpack) wanted.add('Backpack');
  // Parts are top-level nodes (a Group per multi-material mesh, or a SkinnedMesh) named after the part.
  const meshes: THREE.SkinnedMesh[] = [];
  const parts = new Map<string, THREE.Object3D>();
  for (const child of [...scene.children]) {
    let hasSkin = false;
    child.traverse((o) => (hasSkin ||= (o as THREE.SkinnedMesh).isSkinnedMesh === true));
    if (!hasSkin) continue;
    if (!wanted.has(child.name)) {
      child.removeFromParent();
      continue;
    }
    parts.set(child.name, child);
    child.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
    });
  }
  if (meshes.length === 0) return null;

  const materials: THREE.Material[] = [];
  for (const m of meshes) {
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => {
      const c = x.clone();
      materials.push(c);
      return c;
    });
    m.material = Array.isArray(m.material) ? mats : mats[0]!;
    m.castShadow = true;
    m.receiveShadow = false;
    m.frustumCulled = false;
  }

  // All parts share one skin in the pack: bind them to a single skeleton (one bone texture,
  // one update per frame instead of one per part).
  const skeleton = meshes[0]!.skeleton;
  for (const m of meshes.slice(1)) {
    const own = m.skeleton;
    m.bind(skeleton, m.bindMatrix);
    if (own !== skeleton) own.dispose();
  }
  // Bind-pose world transforms of every bone, from the skin's inverse bind matrices.
  const bind = new Map<THREE.Object3D, Bind>();
  const m4 = new THREE.Matrix4();
  skeleton.bones.forEach((bone, i) => {
    m4.copy(skeleton.boneInverses[i]!).invert();
    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    m4.decompose(pos, rot, new THREE.Vector3());
    bind.set(bone, { pos, rot });
  });

  const need = (name: string) => {
    const b = findBone(scene, name);
    if (!b || !bind.has(b)) throw new Error(`rider rig: missing bone ${name}`);
    return b;
  };
  let bones: Record<string, THREE.Object3D>;
  try {
    bones = Object.fromEntries(
      ['Body', 'Abdomen', 'Torso', 'Chest', 'Neck', 'Head', 'UpperArm.L', 'LowerArm.L', 'Wrist.L', 'UpperArm.R', 'LowerArm.R', 'Wrist.R', 'UpperLeg.L', 'LowerLeg.L', 'Foot.L', 'UpperLeg.R', 'LowerLeg.R', 'Foot.R'].map((n) => [n, need(n)]),
    );
  } catch (e) {
    console.warn(String(e));
    return null;
  }

  // Face +Z: if the feet point backwards in the bind pose, turn the model around.
  const footDir = new THREE.Vector3(0, 1, 0).applyQuaternion(bind.get(bones['Foot.L']!)!.rot);
  const turn = new THREE.Quaternion();
  if (footDir.z < 0) {
    turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    scene.quaternion.premultiply(turn);
  }
  const B = (b: THREE.Object3D): Bind => {
    const x = bind.get(b)!;
    return { pos: x.pos.clone().applyQuaternion(turn), rot: turn.clone().multiply(x.rot) };
  };

  const axes = (from: THREE.Object3D, to: THREE.Object3D): BoneAxes => {
    const a = B(from);
    const inv = a.rot.clone().invert();
    const axis = B(to).pos.clone().sub(a.pos).applyQuaternion(inv).normalize();
    const front = FORWARD.clone().applyQuaternion(inv);
    return { axis, front };
  };
  const limb = (u: string, l: string, e: string, frontSign: 1 | -1, endMode: 'child' | 'free', side: 1 | -1): Limb => {
    const upper = bones[u]!;
    const lower = bones[l]!;
    const end = bones[e]!;
    return {
      upper,
      lower,
      end,
      l1: B(upper).pos.distanceTo(B(lower).pos),
      l2: B(lower).pos.distanceTo(B(end).pos),
      upperAxes: axes(upper, lower),
      lowerAxes: axes(lower, end),
      frontSign,
      endMode,
      endRest: B(end).rot,
      side,
    };
  };

  const torsoKeys: [string, TorsoBone['key']][] = [
    ['Body', 'hips'],
    ['Abdomen', 'spineHalf'],
    ['Torso', 'spineHalf'],
    ['Chest', 'chest'],
    ['Neck', 'neck'],
    ['Head', 'head'],
  ];
  const torso = torsoKeys.map(([n, key]) => ({ bone: bones[n]!, rest: B(bones[n]!).rot, key }));
  const hipMid = B(bones['UpperLeg.L']!).pos.add(B(bones['UpperLeg.R']!).pos).multiplyScalar(0.5);
  const pelvisToHips = hipMid.sub(B(bones.Body!).pos);

  const flailNames = ['Abdomen', 'Chest', 'Head', 'UpperArm.L', 'UpperArm.R', 'LowerArm.L', 'LowerArm.R', 'UpperLeg.L', 'UpperLeg.R', 'LowerLeg.L', 'LowerLeg.R'];
  const flail = flailNames.map((n, i) => ({ bone: bones[n]!, rest: bones[n]!.quaternion.clone(), amp: i < 3 ? 0.35 : 0.9 }));
  const headPart = parts.get(partMeshName(look.head, 'Head'));
  // Style (colours, skin, goggles, gloves, body type) on top of the outfit parts.
  const extras = dress(
    root,
    {
      Head: headPart,
      Body: parts.get(partMeshName(look.body, 'Body')),
      Legs: parts.get(partMeshName(look.legs, 'Legs')),
      Feet: parts.get(partMeshName(look.feet, 'Feet')),
    },
    bones,
    look,
  );
  const goggles = extras.filter((o) => o.parent === bones.Head);

  return {
    root,
    pelvis: bones.Body!,
    pelvisToHips,
    torso,
    armL: limb('UpperArm.L', 'LowerArm.L', 'Wrist.L', -1, 'child', 1),
    armR: limb('UpperArm.R', 'LowerArm.R', 'Wrist.R', -1, 'child', -1),
    legL: limb('UpperLeg.L', 'LowerLeg.L', 'Foot.L', 1, 'free', 1),
    legR: limb('UpperLeg.R', 'LowerLeg.R', 'Foot.R', 1, 'free', -1),
    head: bones.Head!,
    headParts: [...(headPart ? [headPart] : []), ...goggles],
    materials,
    flail,
    dispose() {
      root.removeFromParent();
      for (const m of materials) m.dispose();
      for (const o of extras)
        o.traverse((x) => {
          const mesh = x as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        });
      skeleton.dispose();
      // Geometry is shared with the cached pack and stays alive.
    },
  };
}
