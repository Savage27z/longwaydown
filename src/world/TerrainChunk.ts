import * as THREE from 'three';
import { WORLD } from '../config/world';
import { Group, groups, type PhysicsWorld } from '../physics/PhysicsWorld';
import { R, type RapierNS } from '../physics/rapier';
import { addStatic } from '../utils/dispose';
import type { PropLibrary } from './Props';
import { PROP_KINDS, PROP_STRIDE, type TileResult } from './TileBuilder';

const TREE_KIND = PROP_KINDS.indexOf('tree');
const ROCK_KIND = PROP_KINDS.indexOf('rock');
const PEBBLE_KIND = PROP_KINDS.indexOf('pebble');

/** One streamed terrain tile: render mesh, instanced props, and (LOD0) Rapier colliders. */
export class TerrainChunk {
  readonly key: string;
  readonly ix: number;
  readonly iz: number;
  readonly lod: number;
  readonly segs: number;
  readonly group = new THREE.Group();
  readonly surfaces: Uint8Array;
  readonly minY: number;
  readonly maxY: number;
  private mesh: THREE.Mesh;
  private props: THREE.InstancedMesh[];
  private heights: Float32Array;
  private propData: Float32Array[];
  private body: RapierNS.RigidBody | null = null;
  /** Prop colliders still waiting to be created (spread over frames). */
  private colliderCursor = 0;
  private colliderList: { kind: number; i: number }[] = [];
  /** Positions of collidable obstacles (global x, y, z, radius) for near-miss checks. */
  readonly obstacles: Float32Array;

  constructor(r: TileResult, material: THREE.Material, lib: PropLibrary, parent: THREE.Object3D, castShadows: boolean) {
    this.ix = r.ix;
    this.iz = r.iz;
    this.lod = r.lod;
    this.key = `${r.ix},${r.iz}`;
    this.segs = r.segs;
    this.surfaces = r.surfaces;
    this.heights = r.heights;
    this.propData = r.props;
    this.minY = r.minY;
    this.maxY = r.maxY;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(r.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(r.colors, 3, true));
    geo.setIndex(new THREE.BufferAttribute(r.index, 1));
    const S = WORLD.chunkSize;
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, r.minY - WORLD.skirtDepth, 0), new THREE.Vector3(S, r.maxY, S));
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.group.add(this.mesh);

    this.props = lib.buildTileProps(r.props, r.lod, castShadows && r.lod === 0);
    for (const p of this.props) this.group.add(p);
    this.group.position.set(r.ix * S, 0, r.iz * S);
    this.group.name = `tile ${this.key} L${r.lod}`;
    addStatic(parent, this.group);

    const obstacles: number[] = [];
    for (const kind of [TREE_KIND, ROCK_KIND]) {
      const d = r.props[kind];
      if (!d) continue;
      for (let i = 0; i < d.length; i += PROP_STRIDE) {
        obstacles.push(d[i]! + r.ix * S, d[i + 1]!, d[i + 2]! + r.iz * S, kind === TREE_KIND ? 0.35 * d[i + 4]! : 1.0 * d[i + 4]!);
      }
    }
    this.obstacles = new Float32Array(obstacles);
  }

  get hasPhysics(): boolean {
    return this.body !== null;
  }

  get collidersPending(): boolean {
    return this.body !== null && this.colliderCursor < this.colliderList.length;
  }

  /** Create the fixed body + heightfield. Prop colliders are added gradually by `stepColliders`. */
  addPhysics(physics: PhysicsWorld, origin: THREE.Vector3): void {
    if (this.body || this.lod !== 0) return;
    const RAPIER = R();
    const S = WORLD.chunkSize;
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(this.ix * S - origin.x, -origin.y, this.iz * S - origin.z),
    );
    const desc = RAPIER.ColliderDesc.heightfield(this.segs, this.segs, this.heights, { x: S, y: 1, z: S }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES)
      .setTranslation(S / 2, 0, S / 2)
      .setFriction(0.8)
      .setCollisionGroups(groups(Group.TERRAIN, Group.ALL));
    const c = physics.world.createCollider(desc, this.body);
    c.setActiveEvents(RAPIER.ActiveEvents.NONE);
    this.colliderList = [];
    for (const kind of [TREE_KIND, ROCK_KIND, PEBBLE_KIND]) {
      const d = this.propData[kind];
      if (!d) continue;
      for (let i = 0; i < d.length; i += PROP_STRIDE) this.colliderList.push({ kind, i });
    }
    this.colliderCursor = 0;
  }

  /** Create up to `budget` prop colliders. Returns how many were created. */
  stepColliders(physics: PhysicsWorld, budget: number): number {
    if (!this.body) return 0;
    const RAPIER = R();
    let made = 0;
    while (made < budget && this.colliderCursor < this.colliderList.length) {
      const { kind, i } = this.colliderList[this.colliderCursor++]!;
      const d = this.propData[kind]!;
      const x = d[i]!;
      const y = d[i + 1]!;
      const z = d[i + 2]!;
      const sc = d[i + 4]!;
      let desc: RapierNS.ColliderDesc;
      if (kind === TREE_KIND) desc = RAPIER.ColliderDesc.cylinder(2.2 * sc, 0.32 * sc).setTranslation(x, y + 2.2 * sc, z);
      else if (kind === ROCK_KIND) desc = RAPIER.ColliderDesc.ball(0.85 * sc).setTranslation(x, y + 0.35 * sc, z);
      else desc = RAPIER.ColliderDesc.ball(0.42 * sc).setTranslation(x, y + 0.1 * sc, z);
      desc.setFriction(0.5).setCollisionGroups(groups(Group.PROP, Group.ALL));
      physics.world.createCollider(desc, this.body);
      made++;
    }
    return made;
  }

  removePhysics(physics: PhysicsWorld): void {
    if (!this.body) return;
    physics.world.removeRigidBody(this.body);
    this.body = null;
    this.colliderList = [];
    this.colliderCursor = 0;
  }

  /** Surface index at a global point inside this tile (nearest grid vertex). */
  surfaceAt(gx: number, gz: number): number {
    const S = WORLD.chunkSize;
    const n = this.segs + 1;
    const i = Math.min(this.segs, Math.max(0, Math.round(((gx - this.ix * S) / S) * this.segs)));
    const j = Math.min(this.segs, Math.max(0, Math.round(((gz - this.iz * S) / S) * this.segs)));
    return this.surfaces[j * n + i]!;
  }

  setShadows(cast: boolean): void {
    for (const p of this.props) if (p.userData.kind !== 'pebble') p.castShadow = cast && this.lod === 0;
  }

  dispose(physics: PhysicsWorld): void {
    this.removePhysics(physics);
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    for (const p of this.props) p.dispose();
  }
}
