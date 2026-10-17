import { WORLD } from '../config/world';
import { R, type RapierNS } from './rapier';

/** Collision membership bits. */
export const Group = {
  TERRAIN: 1 << 0,
  PROP: 1 << 1,
  VEHICLE: 1 << 2,
  DEBRIS: 1 << 3,
  ALL: 0xffff,
} as const;

/** Rapier interaction groups: high 16 bits = membership, low 16 = filter. */
export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

/** What ground probes (wheels, suspension, camera) should hit. */
export const GROUND_QUERY = groups(Group.ALL, Group.TERRAIN | Group.PROP);
export const TERRAIN_ONLY_QUERY = groups(Group.ALL, Group.TERRAIN);

export interface RayHit {
  /** Hit point (local/physics coordinates). */
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  distance: number;
  collider: RapierNS.Collider;
}

export class PhysicsWorld {
  readonly world: RapierNS.World;
  readonly events: RapierNS.EventQueue;
  private ray: RapierNS.Ray;
  private hit: RayHit = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, distance: 0, collider: null as unknown as RapierNS.Collider };

  constructor() {
    const RAPIER = R();
    this.world = new RAPIER.World({ x: 0, y: WORLD.gravity, z: 0 });
    this.world.timestep = 1 / WORLD.physicsHz;
    this.events = new RAPIER.EventQueue(true);
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step(this.events);
  }

  setGravity(y: number): void {
    this.world.gravity = { x: 0, y, z: 0 };
  }

  /**
   * Cast a ray; returns a shared hit object (copy it if you need to keep it) or null.
   * `dir` must be normalized.
   */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    filterGroups: number = GROUND_QUERY,
    exclude?: RapierNS.RigidBody,
  ): RayHit | null {
    this.ray.origin = { x: ox, y: oy, z: oz };
    this.ray.dir = { x: dx, y: dy, z: dz };
    const res = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, filterGroups, undefined, exclude);
    if (!res) return null;
    const h = this.hit;
    h.distance = res.timeOfImpact;
    h.x = ox + dx * res.timeOfImpact;
    h.y = oy + dy * res.timeOfImpact;
    h.z = oz + dz * res.timeOfImpact;
    h.nx = res.normal.x;
    h.ny = res.normal.y;
    h.nz = res.normal.z;
    h.collider = res.collider;
    return h;
  }

  /** Floating origin: translate every body by -delta. Colliders without a parent are moved too. */
  shiftOrigin(dx: number, dy: number, dz: number): void {
    this.world.bodies.forEach((b) => {
      const t = b.translation();
      b.setTranslation({ x: t.x - dx, y: t.y - dy, z: t.z - dz }, false);
      if (b.isKinematic()) b.setNextKinematicTranslation({ x: t.x - dx, y: t.y - dy, z: t.z - dz });
    });
    this.world.colliders.forEach((c) => {
      if (c.parent()) return;
      const t = c.translation();
      c.setTranslation({ x: t.x - dx, y: t.y - dy, z: t.z - dz });
    });
  }

  dispose(): void {
    this.events.free();
    this.world.free();
  }
}
