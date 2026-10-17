import * as THREE from 'three';

const _a = new THREE.Vector3();
const _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _k = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();

/** Orient `bone` (modelled along local -Y, local +Z = front) so it points along world `dir`. */
function aimBone(bone: THREE.Object3D, dir: THREE.Vector3, front: THREE.Vector3): void {
  _y.copy(dir).negate();
  _z.copy(front).addScaledVector(_y, -front.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  _qw.setFromRotationMatrix(_m);
  bone.parent!.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_qw));
  bone.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK (hip-knee-ankle, shoulder-elbow-wrist). `upper` is the root joint,
 * `lower` the middle joint (child of upper, offset l1 along -Y). Target and pole are world space.
 */
export function solveTwoBone(upper: THREE.Object3D, lower: THREE.Object3D, l1: number, l2: number, target: THREE.Vector3, pole: THREE.Vector3): void {
  upper.getWorldPosition(_a);
  _t.copy(target);
  _dir.subVectors(_t, _a);
  const dist = THREE.MathUtils.clamp(_dir.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  _dir.normalize();
  _pole.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, 0, 1).addScaledVector(_dir, -_dir.z);
  _pole.normalize();
  const cosA = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _u.copy(_dir).multiplyScalar(cosA).addScaledVector(_pole, sinA).normalize();
  _k.copy(_a).addScaledVector(_u, l1);
  _w.copy(_a).addScaledVector(_dir, dist).sub(_k).normalize();
  aimBone(upper, _u, _pole);
  aimBone(lower, _w, _pole);
}
