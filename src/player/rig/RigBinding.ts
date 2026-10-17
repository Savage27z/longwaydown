import * as THREE from 'three';
import { solveTwoBone, type BoneAxes } from '../../utils/ik';
import type { PoseTargets } from './pose';

/**
 * Maps the game's pose model onto a concrete skeleton (procedural or a skinned .glb).
 * All "rest" rotations are bind-pose world rotations relative to the character root.
 */
export type TorsoKey = 'hips' | 'spine' | 'spineHalf' | 'chest' | 'neck' | 'head';

export interface TorsoBone {
  bone: THREE.Object3D;
  rest: THREE.Quaternion;
  key: TorsoKey;
}

export interface Limb {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  end: THREE.Object3D;
  l1: number;
  l2: number;
  upperAxes: BoneAxes;
  lowerAxes: BoneAxes;
  /** +1 legs (knee faces the pole), -1 arms (elbow points away from the limb's front). */
  frontSign: 1 | -1;
  /** 'child': end is parented to `lower`; 'free': end is a separate bone placed at the chain end. */
  endMode: 'child' | 'free';
  endRest: THREE.Quaternion;
  /** Shoulder/hip root used for free (un-targeted) arm swings. */
  side: 1 | -1;
}

export interface RigBinding {
  root: THREE.Group;
  pelvis: THREE.Object3D;
  /** Offset from the pelvis bone origin to the leg-root midpoint (character frame, bind pose). */
  pelvisToHips: THREE.Vector3;
  torso: TorsoBone[];
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
  head: THREE.Object3D;
  /** Objects hidden in first-person view. */
  headParts: THREE.Object3D[];
  materials: THREE.Material[];
  /** Bones that wobble during a crash tumble, with their rest local rotations. */
  flail: { bone: THREE.Object3D; rest: THREE.Quaternion; amp: number }[];
  dispose(): void;
}

const _rootQ = new THREE.Quaternion();
const _chain = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _half = new THREE.Euler();

function setWorldRotation(bone: THREE.Object3D, world: THREE.Quaternion): void {
  bone.parent!.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(world));
  bone.updateMatrixWorld(true);
}

/** Apply a pose (vehicle-local targets) to a bound skeleton. */
export function applyPose(b: RigBinding, p: PoseTargets): void {
  b.root.updateMatrixWorld(true);
  b.root.getWorldQuaternion(_rootQ);

  // Torso chain: accumulate pose rotations (character frame) and apply on top of bind rest.
  _chain.identity();
  for (const t of b.torso) {
    switch (t.key) {
      case 'hips':
        _chain.setFromEuler(p.hipsRot);
        break;
      case 'spine':
        _chain.multiply(_q.setFromEuler(p.spine));
        break;
      case 'spineHalf':
        _chain.multiply(_q.setFromEuler(_half.set(p.spine.x * 0.5, p.spine.y * 0.5, p.spine.z * 0.5)));
        break;
      case 'chest':
        _chain.multiply(_q.setFromEuler(p.chest));
        break;
      case 'head':
        _chain.multiply(_q.setFromEuler(p.head));
        break;
      case 'neck':
        break;
    }
    if (t.bone === b.pelvis) {
      // Place the pelvis so the hip joints land on the pose's hip point.
      _v.copy(b.pelvisToHips).applyQuaternion(_chain);
      _t.copy(p.hips).sub(_v);
      b.root.localToWorld(_t);
      b.pelvis.parent!.worldToLocal(_t);
      b.pelvis.position.copy(_t);
    }
    _q.copy(_rootQ).multiply(_chain).multiply(t.rest);
    setWorldRotation(t.bone, _q);
  }

  // Legs.
  for (const [leg, target, side] of [
    [b.legL, p.footL, 1],
    [b.legR, p.footR, -1],
  ] as const) {
    _t.copy(target);
    b.root.localToWorld(_t);
    _pole.set(p.kneePole.x * (p.mirrorPoles ? side : 1), p.kneePole.y, p.kneePole.z).applyQuaternion(_rootQ);
    const end = solveTwoBone(leg.upper, leg.lower, leg.l1, leg.l2, _t, _pole, leg.upperAxes, leg.lowerAxes, leg.frontSign);
    if (leg.endMode === 'free') {
      leg.end.parent!.worldToLocal(end);
      leg.end.position.copy(end);
    }
    _q.copy(_rootQ).multiply(_qp.setFromEuler(_e.set(0, p.footYaw, 0))).multiply(leg.endRest);
    setWorldRotation(leg.end, _q);
  }

  // Arms.
  for (const [arm, target] of [
    [b.armL, p.handL],
    [b.armR, p.handR],
  ] as const) {
    const side = arm.side;
    if (target) {
      _t.copy(target);
      b.root.localToWorld(_t);
    } else {
      // Free arm: swing a straight-ish arm from the shoulder.
      arm.upper.getWorldPosition(_t);
      b.root.worldToLocal(_t);
      _v.set(0, -1, 0).applyEuler(_e.set(-p.freeArm.pitch, 0, side * p.freeArm.spread, 'XZY'));
      _t.addScaledVector(_v, (arm.l1 + arm.l2) * Math.cos(p.freeArm.bend * 0.5) * 0.98);
      b.root.localToWorld(_t);
    }
    _pole.set(p.elbowPole.x * (p.mirrorPoles ? side : 1), p.elbowPole.y, p.elbowPole.z).applyQuaternion(_rootQ);
    solveTwoBone(arm.upper, arm.lower, arm.l1, arm.l2, _t, _pole, arm.upperAxes, arm.lowerAxes, arm.frontSign);
    if (arm.endMode === 'free') {
      arm.lower.updateMatrixWorld(true);
    }
  }
  b.root.updateMatrixWorld(true);
}

/** Crash tumble: limbs wobble around their rest rotations; the pelvis sits at the root. */
export function applyFlail(b: RigBinding, t: number): void {
  b.pelvis.position.set(0, 0, 0);
  let k = 0;
  for (const f of b.flail) {
    const s = (fr: number, ph: number) => Math.sin(t * fr + ph + k * 1.7) * f.amp;
    f.bone.quaternion.copy(f.rest).multiply(_q.setFromEuler(_e.set(s(9, 0), s(7, 1) * 0.6, s(8, 2))));
    k++;
  }
  b.root.updateMatrixWorld(true);
}
