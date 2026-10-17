import * as THREE from 'three';
import { WORLD } from '../config/world';
import { events } from '../core/Events';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

/**
 * Keeps simulation coordinates small on a 20 km course. `origin` is the global position of
 * local (0,0,0). When the focus drifts more than WORLD.originShiftDistance from it, everything
 * local is translated back: the world root (static content in global coords), every physics
 * body, and any listener of the `origin:shift` event (camera, interpolation buffers, fx).
 */
export class FloatingOrigin {
  readonly origin = new THREE.Vector3();
  shifts = 0;

  constructor(
    private readonly worldRoot: THREE.Object3D,
    private readonly physics: PhysicsWorld,
    private readonly camera: THREE.Camera,
  ) {
    this.apply();
  }

  toGlobal(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(local).add(this.origin);
  }

  toLocal(global: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(global).sub(this.origin);
  }

  /** Set the origin directly (on map load), before any local objects exist. */
  reset(x: number, y: number, z: number): void {
    this.origin.set(x, y, z);
    this.apply();
  }

  /** Check the focus (local coords) and shift if needed. Returns true if a shift happened. */
  update(focusLocal: THREE.Vector3): boolean {
    const d = Math.hypot(focusLocal.x, focusLocal.z);
    if (d < WORLD.originShiftDistance && Math.abs(focusLocal.y) < WORLD.originShiftDistance) return false;
    // Snap to a coarse grid so repeated shifts don't accumulate odd fractions.
    const dx = Math.round(focusLocal.x / 16) * 16;
    const dy = Math.round(focusLocal.y / 16) * 16;
    const dz = Math.round(focusLocal.z / 16) * 16;
    this.shift(dx, dy, dz);
    return true;
  }

  shift(dx: number, dy: number, dz: number): void {
    this.origin.x += dx;
    this.origin.y += dy;
    this.origin.z += dz;
    this.apply();
    this.physics.shiftOrigin(dx, dy, dz);
    this.camera.position.x -= dx;
    this.camera.position.y -= dy;
    this.camera.position.z -= dz;
    this.shifts++;
    events.emit('origin:shift', { dx, dy, dz });
  }

  private apply(): void {
    this.worldRoot.position.set(-this.origin.x, -this.origin.y, -this.origin.z);
    this.worldRoot.updateMatrix();
    this.worldRoot.updateMatrixWorld(true);
  }
}
