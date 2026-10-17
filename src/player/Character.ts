import * as THREE from 'three';
import { LIMBS, type CharacterRig, type MaterialSlot } from '../models/procedural/character';
import { createCharacterRig } from '../models/ModelLoader';
import { solveTwoBone } from '../utils/ik';
import { buildDefaultHeadgear } from '../models/procedural/accessories';

/** A full-body pose expressed in the vehicle's local frame (+Z forward, +Y up, +X left). */
export interface PoseTargets {
  hips: THREE.Vector3;
  hipsRot: THREE.Euler;
  spine: THREE.Euler;
  chest: THREE.Euler;
  head: THREE.Euler;
  /** Hand targets; null = free arms (use freeArm angles). */
  handL: THREE.Vector3 | null;
  handR: THREE.Vector3 | null;
  footL: THREE.Vector3;
  footR: THREE.Vector3;
  kneePole: THREE.Vector3;
  elbowPole: THREE.Vector3;
  /** Free arm: shoulder pitch (forward +), spread (outward +), elbow bend. */
  freeArm: { pitch: number; spread: number; bend: number };
  /** Foot yaw relative to the vehicle (boards stand sideways). */
  footYaw: number;
}

export function makePose(): PoseTargets {
  return {
    hips: new THREE.Vector3(0, LIMBS.hipsHeight, 0),
    hipsRot: new THREE.Euler(),
    spine: new THREE.Euler(),
    chest: new THREE.Euler(),
    head: new THREE.Euler(),
    handL: null,
    handR: null,
    footL: new THREE.Vector3(0.1, 0.08, 0),
    footR: new THREE.Vector3(-0.1, 0.08, 0),
    kneePole: new THREE.Vector3(0, 0, 1),
    elbowPole: new THREE.Vector3(0, -0.3, -1),
    freeArm: { pitch: 0.1, spread: 0.15, bend: 0.3 },
    footYaw: 0,
  };
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _e = new THREE.Euler();

/** Procedural rider: blends toward pose targets and solves limb IK every frame. */
export class Character {
  readonly rig: CharacterRig;
  readonly root: THREE.Group;
  private cur = makePose();
  private hasPose = false;
  private opacity = 1;
  private flailT = 0;

  constructor() {
    this.rig = createCharacterRig();
    this.root = this.rig.root;
    buildDefaultHeadgear(this.rig);
  }

  setColor(slot: MaterialSlot, color: THREE.ColorRepresentation): void {
    this.rig.materials[slot].color.set(color);
  }

  /** Smoothly approach `target` (rate in 1/s; Infinity snaps) and apply it. */
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
    this.apply(c);
  }

  private apply(p: PoseTargets): void {
    const b = this.rig.bones;
    b.hips.position.copy(p.hips);
    b.hips.quaternion.setFromEuler(p.hipsRot);
    b.spine.quaternion.setFromEuler(p.spine);
    b.chest.quaternion.setFromEuler(p.chest);
    b.neck.quaternion.identity();
    b.head.quaternion.setFromEuler(p.head);
    this.root.updateMatrixWorld(true);
    this.root.getWorldQuaternion(_q);

    // Legs.
    for (const [side, hip, knee, foot, target] of [
      [1, b.hipL, b.kneeL, b.footL, p.footL],
      [-1, b.hipR, b.kneeR, b.footR, p.footR],
    ] as const) {
      this.root.localToWorld(_v.copy(target));
      _pole.set(p.kneePole.x * side, p.kneePole.y, p.kneePole.z).applyQuaternion(_q);
      solveTwoBone(hip, knee, LIMBS.thigh, LIMBS.shin, _v, _pole);
      // Keep feet level with the vehicle (plus stance yaw).
      foot.parent!.getWorldQuaternion(_q2);
      _e.set(0, p.footYaw, 0);
      foot.quaternion.copy(_q2.invert().multiply(_q).multiply(new THREE.Quaternion().setFromEuler(_e)));
    }

    // Arms.
    for (const [side, sh, el, hand, target] of [
      [1, b.shoulderL, b.elbowL, b.handL, p.handL],
      [-1, b.shoulderR, b.elbowR, b.handR, p.handR],
    ] as const) {
      if (target) {
        this.root.localToWorld(_v2.copy(target));
        _pole.set(p.elbowPole.x * side, p.elbowPole.y, p.elbowPole.z).applyQuaternion(_q);
        solveTwoBone(sh, el, LIMBS.upperArm, LIMBS.forearm, _v2, _pole);
      } else {
        sh.quaternion.setFromEuler(_e.set(-p.freeArm.pitch, 0, side * p.freeArm.spread, 'XZY'));
        el.quaternion.setFromEuler(_e.set(-p.freeArm.bend, 0, 0));
      }
      hand.quaternion.identity();
    }
    this.root.updateMatrixWorld(true);
  }

  /** Crash tumble: limbs flail around (root orientation is driven by the ragdoll body). */
  flail(dt: number): void {
    this.flailT += dt;
    const t = this.flailT;
    const b = this.rig.bones;
    b.hips.position.set(0, 0, 0);
    b.hips.quaternion.identity();
    const s = (f: number, ph: number, a: number) => Math.sin(t * f + ph) * a;
    b.spine.rotation.set(s(7, 0, 0.5), s(5, 1, 0.4), s(6, 2, 0.3));
    b.head.rotation.set(s(9, 1, 0.4), s(8, 2, 0.5), 0);
    b.shoulderL.rotation.set(s(11, 0, 2), 0, 0.6 + s(9, 1, 0.8));
    b.shoulderR.rotation.set(s(10, 2, 2), 0, -0.6 - s(8, 0, 0.8));
    b.elbowL.rotation.set(-0.5 + s(12, 1, 0.6), 0, 0);
    b.elbowR.rotation.set(-0.5 + s(13, 2, 0.6), 0, 0);
    b.hipL.rotation.set(s(8, 0, 1.1), 0, 0.2);
    b.hipR.rotation.set(s(9, 3, 1.1), 0, -0.2);
    b.kneeL.rotation.set(0.6 + s(10, 1, 0.5), 0, 0);
    b.kneeR.rotation.set(0.6 + s(11, 0, 0.5), 0, 0);
    this.root.updateMatrixWorld(true);
  }

  resetFlail(): void {
    this.flailT = 0;
    this.hasPose = false;
  }

  setOpacity(a: number): void {
    if (a === this.opacity) return;
    this.opacity = a;
    for (const m of Object.values(this.rig.materials)) {
      m.transparent = a < 1;
      m.opacity = a;
      m.depthWrite = a >= 1;
    }
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of Object.values(this.rig.materials)) m.dispose();
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
