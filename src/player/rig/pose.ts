import * as THREE from 'three';

/**
 * A full-body pose expressed in the vehicle's local frame (+Z forward, +Y up, +X left).
 * `hips` is the midpoint between the two hip joints (leg roots).
 */
export interface PoseTargets {
  hips: THREE.Vector3;
  hipsRot: THREE.Euler;
  spine: THREE.Euler;
  chest: THREE.Euler;
  head: THREE.Euler;
  /** Hand (wrist) targets; null = free arms (use freeArm angles). */
  handL: THREE.Vector3 | null;
  handR: THREE.Vector3 | null;
  /** Ankle targets. */
  footL: THREE.Vector3;
  footR: THREE.Vector3;
  kneePole: THREE.Vector3;
  elbowPole: THREE.Vector3;
  /** Free arms (used when the hand target is null): shoulder pitch (forward +), spread (outward +), elbow bend. */
  armL: FreeArm;
  armR: FreeArm;
  /** Foot yaw relative to the vehicle (boards stand sideways). */
  footYaw: number;
  /** Mirror pole X per side (symmetric stances). Boards turn it off: both knees point the same way. */
  mirrorPoles: boolean;
}

export interface FreeArm {
  pitch: number;
  spread: number;
  bend: number;
}

/** Set both free arms at once. */
export function setArms(p: PoseTargets, pitch: number, spread: number, bend: number): void {
  p.armL.pitch = p.armR.pitch = pitch;
  p.armL.spread = p.armR.spread = spread;
  p.armL.bend = p.armR.bend = bend;
}

export function makePose(): PoseTargets {
  return {
    hips: new THREE.Vector3(0, 0.9, 0),
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
    armL: { pitch: 0.1, spread: 0.15, bend: 0.3 },
    armR: { pitch: 0.1, spread: 0.15, bend: 0.3 },
    footYaw: 0,
    mirrorPoles: true,
  };
}
