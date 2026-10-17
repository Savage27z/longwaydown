import * as THREE from 'three';

/** A bone's own conventions: which local axis points along the bone and which is its "front". */
export interface BoneAxes {
  axis: THREE.Vector3;
  front: THREE.Vector3;
}

export const DOWN_BONE: BoneAxes = { axis: new THREE.Vector3(0, -1, 0), front: new THREE.Vector3(0, 0, 1) };

const _a = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _k = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _lx = new THREE.Vector3();
const _ly = new THREE.Vector3();
const _lz = new THREE.Vector3();
const _hinge = new THREE.Vector3();
const _f = new THREE.Vector3();
const _lf = new THREE.Vector3();
const _mT = new THREE.Matrix4();
const _mL = new THREE.Matrix4();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();

/**
 * Orient `bone` so its local `axes.axis` points along world `dir` and its local `axes.front`
 * points (as close as possible) along world `front`.
 */
export function aimBone(bone: THREE.Object3D, dir: THREE.Vector3, front: THREE.Vector3, axes: BoneAxes): void {
  _y.copy(dir).normalize();
  _z.copy(front).addScaledVector(_y, -front.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z);
  _mT.makeBasis(_x, _y, _z);
  _ly.copy(axes.axis).normalize();
  _lz.copy(axes.front).addScaledVector(_ly, -axes.front.dot(_ly)).normalize();
  _lx.crossVectors(_ly, _lz);
  _mL.makeBasis(_lx, _ly, _lz).transpose();
  _mT.multiply(_mL);
  _qw.setFromRotationMatrix(_mT);
  bone.parent!.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_qw));
  bone.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK (hip-knee-ankle, shoulder-elbow-wrist). Target and pole are world space;
 * the middle joint bends toward the pole. `frontSign` = +1 if the limb's front faces the pole
 * (legs: knees forward), -1 if it faces away (arms: elbows back). The lower bone shares the
 * upper bone's hinge axis, so skinned limbs don't twist.
 */
export function solveTwoBone(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  l1: number,
  l2: number,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  upperAxes: BoneAxes = DOWN_BONE,
  lowerAxes: BoneAxes = DOWN_BONE,
  frontSign = 1,
): THREE.Vector3 {
  upper.getWorldPosition(_a);
  _dir.subVectors(target, _a);
  const dist = THREE.MathUtils.clamp(_dir.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  _dir.normalize();
  _pole.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, 0, 1).addScaledVector(_dir, -_dir.z);
  _pole.normalize();
  const cosA = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _u.copy(_dir).multiplyScalar(cosA).addScaledVector(_pole, sinA).normalize();
  _k.copy(_a).addScaledVector(_u, l1);
  const end = _a.clone().addScaledVector(_dir, dist);
  _w.copy(end).sub(_k).normalize();
  // Upper: front toward (or away from) the pole, projected off the bone.
  _f.copy(_pole).multiplyScalar(frontSign);
  _f.addScaledVector(_u, -_f.dot(_u)).normalize();
  aimBone(upper, _u, _f, upperAxes);
  // Lower: same hinge axis as the upper bone.
  _hinge.crossVectors(_u, _f);
  _lf.crossVectors(_hinge, _w);
  aimBone(lower, _w, _lf, lowerAxes);
  return end;
}
