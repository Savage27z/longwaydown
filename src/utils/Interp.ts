import * as THREE from 'three';
import type { RapierNS } from '../physics/rapier';

/**
 * Previous/current physics transforms for render interpolation.
 * Call `capture()` after every physics step and `apply()` once per render frame.
 */
export class InterpolatedTransform {
  readonly prevPos = new THREE.Vector3();
  readonly currPos = new THREE.Vector3();
  readonly prevQuat = new THREE.Quaternion();
  readonly currQuat = new THREE.Quaternion();
  private primed = false;

  capture(body: RapierNS.RigidBody): void {
    const t = body.translation();
    const r = body.rotation();
    this.capturePose(t.x, t.y, t.z, r.x, r.y, r.z, r.w);
  }

  capturePose(x: number, y: number, z: number, qx = 0, qy = 0, qz = 0, qw = 1): void {
    if (!this.primed) {
      this.currPos.set(x, y, z);
      this.currQuat.set(qx, qy, qz, qw);
      this.primed = true;
    }
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.currPos.set(x, y, z);
    this.currQuat.set(qx, qy, qz, qw);
  }

  /** Snap (no interpolation smear), e.g. after teleport/respawn. */
  snap(x: number, y: number, z: number): void {
    this.prevPos.set(x, y, z);
    this.currPos.set(x, y, z);
  }

  shift(dx: number, dy: number, dz: number): void {
    this.prevPos.x -= dx;
    this.prevPos.y -= dy;
    this.prevPos.z -= dz;
    this.currPos.x -= dx;
    this.currPos.y -= dy;
    this.currPos.z -= dz;
  }

  position(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    return out.lerpVectors(this.prevPos, this.currPos, alpha);
  }

  quaternion(alpha: number, out: THREE.Quaternion): THREE.Quaternion {
    return out.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
  }

  apply(obj: THREE.Object3D, alpha: number, rotation = true): void {
    obj.position.lerpVectors(this.prevPos, this.currPos, alpha);
    if (rotation) obj.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
  }
}
