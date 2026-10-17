import * as THREE from 'three';
import { Group, groups, type PhysicsWorld } from '../physics/PhysicsWorld';
import { R, type RapierNS } from '../physics/rapier';
import { addStatic, disposeObject } from '../utils/dispose';
import { makeRng } from '../utils/rng';
import { waterLevel } from './Features';
import type { TerrainSampler } from './TerrainSampler';
import {
  bridge,
  checkpointGate,
  finishArch,
  house,
  kmSign,
  lipFlags,
  log,
  ramp,
  rockArch,
  startArea,
  tunnelShell,
  viewpoint,
  waterPlane,
  type ColliderSpec,
  type Structure,
} from '../models/procedural/structures';

interface PropItem {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  build: () => Structure;
  live: { s: Structure; body: RapierNS.RigidBody | null } | null;
}

const VISUAL_RADIUS = 1100;
const PHYSICS_RADIUS = 380;

/** Unique course-attached structures (start, signs, ramps, arches, tunnel, bridges, finish), streamed by distance. */
export class CourseProps {
  private items: PropItem[] = [];
  private timer = 0;
  readonly startS = 24;
  readonly finishS: number;

  constructor(
    sampler: TerrainSampler,
    private readonly parent: THREE.Object3D,
    private readonly physics: PhysicsWorld,
    private readonly origin: THREE.Vector3,
    primaryColor = '#ff5a1f',
  ) {
    const c = sampler.course;
    this.finishS = c.length - 80;
    const at = (s: number) => Math.min(c.count - 1, Math.max(0, Math.round(s / c.step)));
    const headingAt = (i: number) => Math.atan2(c.tx[i]!, c.tz[i]!);
    const gradeAt = (i: number) => {
      const a = Math.max(0, i - 5);
      const b = Math.min(c.count - 1, i + 5);
      return Math.atan2(c.y[a]! - c.y[b]!, (b - a) * c.step);
    };
    const add = (x: number, y: number, z: number, heading: number, pitch: number, build: () => Structure) =>
      this.items.push({ x, y, z, heading, pitch, build, live: null });
    const h = (x: number, z: number) => sampler.heightAt(x, z);

    // Start area.
    {
      const i = at(this.startS);
      add(c.x[i]!, h(c.x[i]!, c.z[i]!) + 0.05, c.z[i]!, headingAt(i), 0, () => startArea(primaryColor));
    }
    // Distance signs on the right edge.
    c.markers.forEach((s, k) => {
      const i = at(s);
      const off = c.hw[i]! + 5;
      const x = c.x[i]! - c.tz[i]! * off;
      const z = c.z[i]! + c.tx[i]! * off;
      add(x, h(x, z), z, headingAt(i), 0, () => kmSign(k + 1, (c.length - s) / 1000, primaryColor));
    });

    // Checkpoint gates across the line.
    c.checkpoints.forEach((s, k) => {
      const i = at(s);
      add(c.x[i]!, h(c.x[i]!, c.z[i]!) - 0.3, c.z[i]!, headingAt(i), 0, () => checkpointGate(Math.min(c.hw[i]! * 2 - 6, 60), k + 1, '#1f8fff'));
    });

    // Features.
    for (const f of c.features) {
      const i = at(f.s);
      const heading = Math.atan2(f.tx, f.tz);
      const pitch = gradeAt(i);
      switch (f.type) {
        case 'jump':
        case 'gap':
        case 'kicker': {
          const lx = -f.tz * (f.width / 2 + 1);
          const lz = f.tx * (f.width / 2 + 1);
          const y = Math.min(h(f.x + lx, f.z + lz), h(f.x - lx, f.z - lz));
          add(f.x, y, f.z, heading, 0, () => lipFlags(f.width + 2, f.type === 'gap' ? '#ff4d6d' : '#ffd23f'));
          break;
        }
        case 'cliffDrop': {
          // Warning flags on the cliff edge side.
          const off = (f.width / 2) * f.side;
          const x = f.x - f.tz * off;
          const z = f.z + f.tx * off;
          add(x, h(x, z), z, heading, 0, () => lipFlags(f.width - 4, '#ff4d6d'));
          break;
        }
        case 'ramp': {
          const back = -f.length / 2;
          const x = f.x + f.tx * back;
          const z = f.z + f.tz * back;
          const y = Math.min(h(x, z), h(f.x + f.tx * f.length * 0.5, f.z + f.tz * f.length * 0.5) + Math.tan(pitch) * f.length) - 0.15;
          add(x, y, z, heading, pitch, () => ramp(f.length, f.height, f.width));
          break;
        }
        case 'logs':
          add(f.x, h(f.x, f.z) - 0.08, f.z, heading, pitch, () => log(f.length, f.height));
          break;
        case 'arch': {
          const R2 = f.width / 2;
          const y = Math.min(h(f.x, f.z), h(f.x - f.tz * R2, f.z + f.tx * R2), h(f.x + f.tz * R2, f.z - f.tx * R2)) - 2;
          add(f.x, y, f.z, heading, 0, () => rockArch(f.width, f.height, sampler.biome.rock));
          break;
        }
        case 'tunnel':
          add(f.x, h(f.x, f.z), f.z, heading, pitch, () => tunnelShell(f.length, f.width / 2 + 0.5, sampler.biome.id === 'snow' ? '#a9c4dc' : '#7f7a70'));
          break;
        case 'overlook': {
          const off = (f.hw + 4) * f.side;
          const x = f.x - f.tz * off;
          const z = f.z + f.tx * off;
          add(x, h(x, z), z, heading + (f.side < 0 ? Math.PI : 0), 0, viewpoint);
          break;
        }
        case 'river':
        case 'ford': {
          const cs = Math.cos(f.angle);
          const sn = Math.sin(f.angle);
          const rx = -f.tz * cs + f.tx * sn;
          const rz = f.tx * cs + f.tz * sn;
          const water = sampler.biome.surfaceColors.water;
          add(f.x, waterLevel(f), f.z, Math.atan2(rx, rz), 0, () => waterPlane(f.width + 6, f.length - 220, water));
          if (f.type === 'river') add(f.x, f.y + 0.35, f.z, heading, pitch, () => bridge(f.width + 22, 10));
          break;
        }
        default:
          break;
      }
    }

    // Finish arch + village.
    {
      const i = at(this.finishS);
      add(c.x[i]!, h(c.x[i]!, c.z[i]!) - 0.5, c.z[i]!, headingAt(i), 0, () => finishArch(c.hw[i]! * 2 + 10, primaryColor));
      const rng = makeRng(`${sampler.map.seed}:village`);
      const walls = sampler.biome.id === 'snow' ? ['#a0522d', '#8b5a3c', '#c2a27c', '#7a4a2c'] : ['#f1e4c8', '#e6d2a8', '#c9b48e', '#f4efe2'];
      const roofs = sampler.biome.id === 'snow' ? ['#e8eef5', '#dfe7ef'] : ['#a33b2b', '#7e2f24', '#4f4f55'];
      for (let k = 0; k < 16; k++) {
        const s = c.length - 560 + k * 33 + rng() * 10;
        const j = at(s);
        const side = k % 2 === 0 ? 1 : -1;
        const off = (c.hw[j]! + 14 + rng() * 26) * side;
        const x = c.x[j]! - c.tz[j]! * off;
        const z = c.z[j]! + c.tx[j]! * off;
        const facing = Math.atan2(c.tz[j]! * side, -c.tx[j]! * side);
        const w = 7 + rng() * 5;
        const d = 7 + rng() * 6;
        const hh = 4 + rng() * 3;
        const wall = walls[k % walls.length]!;
        const roof = roofs[k % roofs.length]!;
        add(x, h(x, z) - 0.3, z, facing, 0, () => house(w, d, hh, wall, roof));
      }
    }
  }

  get count(): number {
    return this.items.length;
  }

  get liveCount(): number {
    return this.items.filter((i) => i.live).length;
  }

  update(dt: number, focusGlobal: THREE.Vector3, force = false): void {
    this.timer -= dt;
    if (this.timer > 0 && !force) return;
    this.timer = 0.5;
    for (const it of this.items) {
      const d = Math.hypot(it.x - focusGlobal.x, it.z - focusGlobal.z);
      if (d < VISUAL_RADIUS && !it.live) this.spawn(it);
      else if (d > VISUAL_RADIUS + 200 && it.live) this.despawn(it);
      if (!it.live) continue;
      if (d < PHYSICS_RADIUS && !it.live.body && it.live.s.colliders.length) it.live.body = this.makeBody(it);
      else if (d > PHYSICS_RADIUS + 120 && it.live.body) {
        this.physics.world.removeRigidBody(it.live.body);
        it.live.body = null;
      }
    }
  }

  private spawn(it: PropItem): void {
    const s = it.build();
    s.object.position.set(it.x, it.y, it.z);
    s.object.rotation.set(it.pitch, it.heading, 0, 'YXZ');
    addStatic(this.parent, s.object);
    it.live = { s, body: null };
  }

  private despawn(it: PropItem): void {
    if (!it.live) return;
    if (it.live.body) this.physics.world.removeRigidBody(it.live.body);
    it.live.s.object.removeFromParent();
    disposeObject(it.live.s.object);
    for (const m of it.live.s.ownMaterials ?? []) {
      (m as THREE.MeshLambertMaterial).map?.dispose();
      m.dispose();
    }
    it.live = null;
  }

  private makeBody(it: PropItem): RapierNS.RigidBody {
    const RAPIER = R();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(it.pitch, it.heading, 0, 'YXZ'));
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(it.x - this.origin.x, it.y - this.origin.y, it.z - this.origin.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    for (const spec of it.live!.s.colliders) {
      const desc = colliderDesc(spec);
      if (!desc) continue;
      desc.setCollisionGroups(groups(Group.PROP, Group.ALL)).setFriction(0.7);
      this.physics.world.createCollider(desc, body);
    }
    return body;
  }

  dispose(): void {
    for (const it of this.items) this.despawn(it);
    this.items = [];
  }
}

function colliderDesc(spec: ColliderSpec): RapierNS.ColliderDesc | null {
  const RAPIER = R();
  const eq = (x: number, y: number, z: number) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
    return { x: q.x, y: q.y, z: q.z, w: q.w };
  };
  switch (spec.type) {
    case 'cuboid':
      return RAPIER.ColliderDesc.cuboid(...spec.half)
        .setTranslation(...spec.pos)
        .setRotation(eq(spec.rotX ?? 0, spec.rotY ?? 0, 0));
    case 'cylinder':
      return RAPIER.ColliderDesc.cylinder(spec.halfHeight, spec.radius)
        .setTranslation(...spec.pos)
        .setRotation(eq(spec.rotX ?? 0, 0, spec.rotZ ?? 0));
    case 'ball':
      return RAPIER.ColliderDesc.ball(spec.radius).setTranslation(...spec.pos);
    case 'convex':
      return RAPIER.ColliderDesc.convexHull(spec.points)?.setTranslation(...spec.pos) ?? null;
    case 'trimesh':
      return RAPIER.ColliderDesc.trimesh(spec.vertices, spec.indices).setTranslation(...spec.pos);
  }
}
