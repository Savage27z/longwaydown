import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { OutfitId, RiderLook } from '../config/riders';
import { Character } from '../player/Character';
import { makePose, type PoseTargets } from '../player/rig/pose';
import { makeRng } from '../utils/rng';
import { getRiderPack } from './ModelLoader';
import { box, structureMaterial, type Structure } from './procedural/structures';

/** Lighter outfits only (the space suit, armour and royal outfits are 8–11k triangles). */
const CROWD_OUTFITS: OutfitId[] = ['Casual', 'Casual2', 'Beach', 'Farmer', 'Punk', 'Suit', 'Worker'];
const LOOKS = 8;
/** Cheer cycle: everyone flips between two poses at this rate (Hz) while the rider is near. */
const CHEER_HZ = 2.6;
const CHEER_RANGE = 260;

type PoseFn = (p: PoseTargets) => void;

const stand: PoseFn = (p) => {
  p.hips.set(0, 0.93, 0);
  p.footL.set(0.13, 0.08, 0.02);
  p.footR.set(-0.13, 0.08, 0.02);
  p.kneePole.set(0, 0, 1);
  p.elbowPole.set(0, -0.3, -1);
  p.handL = null;
  p.handR = null;
};
const arms = (p: PoseTargets, l: [number, number, number], r: [number, number, number]) => {
  [p.armL.pitch, p.armL.spread, p.armL.bend] = l;
  [p.armR.pitch, p.armR.spread, p.armR.bend] = r;
};
/** Pose pairs a spectator alternates between: arms up, waving, clapping, fist pumping. */
const POSE_PAIRS: [PoseFn, PoseFn][] = [
  [(p) => (stand(p), arms(p, [2.7, 0.5, 0.2], [2.7, 0.5, 0.2]), p.head.set(-0.2, 0, 0)), (p) => (stand(p), arms(p, [2.2, 0.9, 0.5], [2.2, 0.9, 0.5]), p.hips.y += 0.06)],
  [(p) => (stand(p), arms(p, [0.1, 0.2, 0.3], [2.6, 0.7, 0.3])), (p) => (stand(p), arms(p, [0.1, 0.2, 0.3], [2.5, 1.3, 0.4]))],
  [(p) => (stand(p), arms(p, [1.1, -0.15, 1.3], [1.1, -0.15, 1.3])), (p) => (stand(p), arms(p, [1.0, 0.35, 1.1], [1.0, 0.35, 1.1]))],
  [(p) => (stand(p), arms(p, [0.15, 0.25, 0.4], [2.9, 0.2, 0.9])), (p) => (stand(p), arms(p, [0.15, 0.25, 0.4], [2.3, 0.3, 1.6]), p.spine.set(0.1, 0, 0))],
];

/** looks[look][pair][frame] -> baked, coloured, static geometry (character-local, feet at y = 0). */
let baked: THREE.BufferGeometry[][][] | null = null;
const _v = new THREE.Vector3();

/** Freeze a posed skinned character into one static geometry with its material colours as vertex colours. */
function bakeCharacter(c: Character): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  c.root.updateMatrixWorld(true);
  c.root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.visible) return;
    const src = mesh.geometry;
    const pos = src.attributes.position!;
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      mesh.applyBoneTransform(i, _v).applyMatrix4(mesh.matrixWorld);
      out[i * 3] = _v.x;
      out[i * 3 + 1] = _v.y;
      out[i * 3 + 2] = _v.z;
    }
    const colors = new Float32Array(pos.count * 3);
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
    const ranges = src.groups.length ? src.groups : [{ start: 0, count: src.index ? src.index.count : pos.count, materialIndex: 0 }];
    for (const r of ranges) {
      const col = mats[r.materialIndex ?? 0]?.color ?? new THREE.Color(0.6, 0.6, 0.6);
      for (let k = r.start; k < r.start + r.count; k++) {
        const vi = src.index ? src.index.getX(k) : k;
        colors[vi * 3] = col.r;
        colors[vi * 3 + 1] = col.g;
        colors[vi * 3 + 2] = col.b;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(out, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (src.index) g.setIndex(src.index.clone());
    parts.push(g);
  });
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** Bake the spectator looks and poses once per session (needs the rider pack). */
function bakeAll(): THREE.BufferGeometry[][][] | null {
  if (baked) return baked;
  if (!getRiderPack()) return null;
  const rng = makeRng('crowd-looks');
  const any = () => CROWD_OUTFITS[Math.floor(rng() * CROWD_OUTFITS.length)]!;
  baked = [];
  for (let l = 0; l < LOOKS; l++) {
    const look: RiderLook = { head: any(), body: any(), legs: any(), feet: any(), backpack: false };
    const c = new Character(look);
    const perLook: THREE.BufferGeometry[][] = [];
    for (const pair of POSE_PAIRS) {
      perLook.push(
        pair.map((fn) => {
          const pose = makePose();
          fn(pose);
          c.update(1, pose, 1000);
          return bakeCharacter(c);
        }),
      );
    }
    c.dispose();
    baked.push(perLook);
  }
  return baked;
}

/**
 * A crowd of spectators in a few loose rows behind a barrier, facing +X (the trail).
 * `length` is how far the crowd stretches along Z. Both cheer frames are merged meshes,
 * so a crowd costs one draw call, and it cheers (flips frames) while the rider is near.
 */
export function crowd(people: number, length: number, seed: string, barrier = true): Structure {
  const object = new THREE.Group();
  const colliders: Structure['colliders'] = [];
  const looks = bakeAll();
  const material = structureMaterial();
  const extras: THREE.BufferGeometry[] = [];
  if (barrier) {
    // Low fence between the crowd and the trail.
    extras.push(box(0.12, 1.0, length + 2, '#f2f2f2', 0.6, 0.5, 0));
    for (let z = -length / 2; z <= length / 2; z += 2.5) extras.push(box(0.14, 1.1, 0.14, '#d64545', 0.6, 0.55, z));
    colliders.push({ type: 'cuboid', half: [0.2, 0.6, length / 2 + 1], pos: [0.6, 0.6, 0] });
  }
  if (extras.length) object.add(new THREE.Mesh(mergeGeometries(extras, false)!, material));
  if (!looks) return { object, colliders };

  const rng = makeRng(seed);
  const frames: THREE.BufferGeometry[][] = [[], []];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  for (let k = 0; k < people; k++) {
    const row = Math.floor(rng() * 3);
    const x = -0.6 - row * 1.1 - rng() * 0.5;
    const z = (rng() - 0.5) * length;
    // Face the trail (+X), give or take.
    q.setFromAxisAngle(up, Math.PI / 2 + (rng() - 0.5) * 0.9);
    const sc = 0.94 + rng() * 0.12;
    m.compose(new THREE.Vector3(x, 0, z), q, s.set(sc, sc, sc));
    const look = looks[Math.floor(rng() * looks.length)]!;
    const pair = look[Math.floor(rng() * look.length)]!;
    // Half the crowd is in the other half of the cycle, so the cheering ripples.
    const flip = rng() < 0.5 ? 1 : 0;
    frames[0]!.push(pair[flip]!.clone().applyMatrix4(m));
    frames[1]!.push(pair[1 - flip]!.clone().applyMatrix4(m));
  }
  const meshes = frames.map((list) => {
    const mesh = new THREE.Mesh(mergeGeometries(list, false)!, material);
    for (const g of list) g.dispose();
    mesh.castShadow = true;
    object.add(mesh);
    return mesh;
  });
  meshes[1]!.visible = false;
  let t = rng();
  return {
    object,
    colliders,
    tick(dt: number, distance: number) {
      // People are only worth drawing up close.
      const show = distance < 450;
      if (distance > CHEER_RANGE) {
        meshes[0]!.visible = show;
        meshes[1]!.visible = false;
        return;
      }
      t += dt * CHEER_HZ;
      const f = Math.floor(t) % 2;
      meshes[0]!.visible = show && f === 0;
      meshes[1]!.visible = show && f === 1;
    },
  };
}
