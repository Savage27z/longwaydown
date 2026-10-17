import * as THREE from 'three';
import { buildCharacterRig, LIMBS } from '../../models/procedural/character';
import { buildDefaultHeadgear } from '../../models/procedural/accessories';
import { DOWN_BONE } from '../../utils/ik';
import type { Limb, RigBinding } from './RigBinding';

/** Binding for the built-in procedural rider (fallback when the .glb rider is unavailable). */
export function proceduralRig(): RigBinding {
  const rig = buildCharacterRig();
  buildDefaultHeadgear(rig);
  const b = rig.bones;
  const id = () => new THREE.Quaternion();
  const limb = (upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, l1: number, l2: number, frontSign: 1 | -1, side: 1 | -1): Limb => ({
    upper,
    lower,
    end,
    l1,
    l2,
    upperAxes: DOWN_BONE,
    lowerAxes: DOWN_BONE,
    frontSign,
    endMode: 'child',
    endRest: id(),
    side,
  });
  const flail = [b.spine, b.head, b.shoulderL, b.shoulderR, b.elbowL, b.elbowR, b.hipL, b.hipR, b.kneeL, b.kneeR].map((bone, i) => ({ bone, rest: id(), amp: i < 2 ? 0.45 : 1.1 }));
  return {
    root: rig.root,
    pelvis: b.hips,
    pelvisToHips: new THREE.Vector3(0, -0.06, 0),
    torso: [
      { bone: b.hips, rest: id(), key: 'hips' },
      { bone: b.spine, rest: id(), key: 'spine' },
      { bone: b.chest, rest: id(), key: 'chest' },
      { bone: b.neck, rest: id(), key: 'neck' },
      { bone: b.head, rest: id(), key: 'head' },
    ],
    armL: limb(b.shoulderL, b.elbowL, b.handL, LIMBS.upperArm, LIMBS.forearm, -1, 1),
    armR: limb(b.shoulderR, b.elbowR, b.handR, LIMBS.upperArm, LIMBS.forearm, -1, -1),
    legL: limb(b.hipL, b.kneeL, b.footL, LIMBS.thigh, LIMBS.shin, 1, 1),
    legR: limb(b.hipR, b.kneeR, b.footR, LIMBS.thigh, LIMBS.shin, 1, -1),
    head: b.head,
    headParts: [b.head],
    materials: Object.values(rig.materials),
    flail,
    dispose() {
      rig.root.removeFromParent();
      rig.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      for (const m of Object.values(rig.materials)) m.dispose();
    },
  };
}
