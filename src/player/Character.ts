import * as THREE from 'three';
import { DEFAULT_LOOK, type RiderLook } from '../config/riders';
import { getRiderPack } from '../models/ModelLoader';
import { gltfRig } from './rig/gltfRig';
import { proceduralRig } from './rig/proceduralRig';
import { applyFlail, applyPose, type RigBinding } from './rig/RigBinding';
import { makePose, type PoseTargets } from './rig/pose';

export { makePose, type PoseTargets };

const _eye = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * The rider. Uses the CC0 skinned rider pack when loaded (falls back to the procedural rig),
 * blends toward pose targets and solves limb IK every frame.
 */
export class Character {
  readonly root: THREE.Group;
  readonly binding: RigBinding;
  readonly usesPack: boolean;
  private cur = makePose();
  private hasPose = false;
  private opacity = 1;
  private flailT = 0;

  constructor(look: RiderLook = DEFAULT_LOOK) {
    const pack = getRiderPack();
    const fromPack = pack ? gltfRig(pack, look) : null;
    this.binding = fromPack ?? proceduralRig();
    this.usesPack = !!fromPack;
    this.root = this.binding.root;
  }

  /** Smoothly approach `target` (rate in 1/s) and apply it. */
  update(dt: number, target: PoseTargets, rate = 14): void {
    const k = this.hasPose ? 1 - Math.exp(-rate * dt) : 1;
    this.hasPose = true;
    const c = this.cur;
    c.hips.lerp(target.hips, k);
    lerpEuler(c.hipsRot, target.hipsRot, k);
    lerpEuler(c.spine, target.spine, k);
    lerpEuler(c.chest, target.chest, k);
    lerpEuler(c.head, target.head, k);
    c.handL = lerpOpt(c.handL, target.handL, k);
    c.handR = lerpOpt(c.handR, target.handR, k);
    c.footL.lerp(target.footL, k);
    c.footR.lerp(target.footR, k);
    c.kneePole.lerp(target.kneePole, k);
    c.elbowPole.lerp(target.elbowPole, k);
    c.freeArm.pitch += (target.freeArm.pitch - c.freeArm.pitch) * k;
    c.freeArm.spread += (target.freeArm.spread - c.freeArm.spread) * k;
    c.freeArm.bend += (target.freeArm.bend - c.freeArm.bend) * k;
    c.footYaw += (target.footYaw - c.footYaw) * k;
    applyPose(this.binding, c);
  }

  /** Crash tumble: limbs flail (root orientation is driven by the ragdoll body). */
  flail(dt: number): void {
    this.flailT += dt;
    applyFlail(this.binding, this.flailT);
  }

  resetFlail(): void {
    this.flailT = 0;
    this.hasPose = false;
  }

  setOpacity(a: number): void {
    if (a === this.opacity) return;
    this.opacity = a;
    for (const m of this.binding.materials) {
      m.transparent = a < 1;
      m.opacity = a;
      m.depthWrite = a >= 1;
    }
  }

  setHeadVisible(v: boolean): void {
    for (const o of this.binding.headParts) o.visible = v;
  }

  /** Approximate eye position (world). */
  headPosition(out: THREE.Vector3): THREE.Vector3 {
    this.binding.head.getWorldPosition(out);
    return out.add(_eye.set(0, 0.1, 0).applyQuaternion(this.root.getWorldQuaternion(_q)));
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  dispose(): void {
    this.binding.dispose();
  }
}

function lerpEuler(a: THREE.Euler, b: THREE.Euler, k: number): void {
  a.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
}

function lerpOpt(a: THREE.Vector3 | null, b: THREE.Vector3 | null, k: number): THREE.Vector3 | null {
  if (!b) return null;
  if (!a) return b.clone();
  return a.lerp(b, k);
}
