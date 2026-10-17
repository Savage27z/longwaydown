import * as THREE from 'three';
import type { KitPart, NatureKit } from '../models/NatureKit';
import { shared } from '../utils/dispose';
import type { BiomeDef } from './Biome';
import { HERO_FLAG, PROP_KINDS, PROP_STRIDE, type PropKind } from './TileBuilder';
import { broadleafTree, bush, markerPole, pineTree, rock } from '../models/procedural/props';

/** A drawable piece of a prop, with a scale that brings the model to the game's unit size. */
interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  norm: number;
}

/** Kit rocks are ~3.5 m across; procedural rocks (and their colliders) are unit-radius. */
const ROCK_NORM = 1 / 1.75;
// One model per kind: every extra variant is another draw call per tile (twice with shadows).
// Instances vary by scale and rotation instead. The other picks stay in nature.glb for later use.
const PINES = ['pine_a'];
const BROADLEAVES = ['broadleaf_a'];
const ROCKS = ['rock_b'];

/** Pick one of `n` sub-variants from a 0..1 variant value without correlating with it. */
const pick = (variant: number, n: number) => Math.min(n - 1, Math.floor(((variant * 7.31) % 1) * n));

/**
 * Shared prop geometry/materials, and per-tile InstancedMesh creation. Each tile gets its own
 * InstancedMeshes (shared geometry), so tiles are culled independently.
 *
 * With the CC0 nature kit loaded, near (LOD0) tiles use its trees, bushes and grass and every
 * tile uses its rocks; far tiles keep the cheap low-poly procedural trees.
 */
export class PropLibrary {
  readonly material: THREE.MeshLambertMaterial;
  private geos: Record<string, THREE.BufferGeometry> = {};
  private poleColors = [new THREE.Color('#ff5a1f'), new THREE.Color('#2f7cff')];
  private kit = new Map<string, Part[]>();
  /** Per-biome material variants of the kit's shared materials (ours to dispose). */
  private tinted: THREE.Material[] = [];

  constructor(
    readonly biome: BiomeDef,
    nature: NatureKit | null = null,
  ) {
    this.material = shared(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    const g = (key: string, geo: THREE.BufferGeometry) => (this.geos[key] = shared(geo));
    g('tree:high', pineTree(biome, 'high'));
    g('tree:low', pineTree(biome, 'low'));
    g('leaf:high', broadleafTree(biome, 'high'));
    g('leaf:low', broadleafTree(biome, 'low'));
    g('rock', rock(biome, 7));
    g('pebble', rock(biome, 23));
    g('pole', markerPole());
    g('bush', bush(biome));
    if (nature) this.adoptKit(nature);
  }

  /** Take the kit's parts, tinting rock and foliage for this biome. */
  private adoptKit(nature: NatureKit): void {
    const tints = new Map<THREE.Material, THREE.Material>();
    const tint = (part: KitPart): THREE.Material => {
      const m = part.material;
      const isRock = m.name === 'Rocks';
      const isPine = m.name === 'Leaves_Pine';
      if (!isRock && !(isPine && this.biome.trees.snowTips)) return m;
      let t = tints.get(m);
      if (!t) {
        const c = m.clone();
        c.userData.shared = true;
        // Rocks take the biome's rock colour; snowy pines get a cold, frosted cast.
        c.color.set(isRock ? this.biome.rock : '#d5e2e6');
        this.tinted.push(c);
        tints.set(m, (t = c));
      }
      return t;
    };
    for (const [key, parts] of nature) {
      const norm = key.startsWith('rock') ? ROCK_NORM : 1;
      this.kit.set(
        key,
        parts.map((p) => ({ geometry: p.geometry, material: tint(p), norm })),
      );
    }
  }

  /** Cached: instances are grouped by Part identity, so each key must always return the same object. */
  private proceduralParts = new Map<string, Part[]>();
  private procedural(key: string): Part[] {
    let parts = this.proceduralParts.get(key);
    if (!parts) this.proceduralParts.set(key, (parts = [{ geometry: this.geos[key]!, material: this.material, norm: 1 }]));
    return parts;
  }

  /** Parts for one prop instance. Empty = not drawn at this LOD. `hero`: a tree right by the trail. */
  parts(kind: PropKind, lod: number, variant: number, hero = false): Part[] {
    const near = lod === 0;
    const kit = (key: string) => this.kit.get(key);
    switch (kind) {
      case 'tree': {
        const leaf = variant < this.biome.trees.broadleafShare;
        if (near && hero) {
          const keys = leaf ? BROADLEAVES : PINES;
          const parts = kit(keys[pick(variant, keys.length)]!);
          if (parts) return parts;
        }
        return this.procedural(`${leaf ? 'leaf' : 'tree'}:${near ? 'high' : 'low'}`);
      }
      case 'rock':
        return kit(ROCKS[pick(variant, ROCKS.length)]!) ?? this.procedural('rock');
      case 'pebble':
        if (!near) return [];
        return kit(ROCKS[pick(variant, ROCKS.length)]!) ?? this.procedural('pebble');
      case 'pole':
        return near ? this.procedural('pole') : [];
      case 'bush':
        // The kit's bush uses red "twisted tree" foliage, which reads wrong on these maps.
        return this.procedural('bush');
      case 'grass': {
        if (!near) return [];
        const key = variant < 0.12 ? 'flowers' : variant < 0.62 ? 'grass_a' : 'grass_b';
        return kit(key) ?? [];
      }
    }
  }

  /** Build InstancedMeshes for one tile's prop arrays. Positions are tile-local. */
  buildTileProps(props: Float32Array[], lod: number, castShadow: boolean): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    PROP_KINDS.forEach((kind, k) => {
      const data = props[k];
      if (!data || data.length === 0) return;
      // Group instances by drawable part (a kit tree is two parts: bark and leaves).
      const groups = new Map<Part, number[]>();
      for (let i = 0; i < data.length; i += PROP_STRIDE) {
        const raw = data[i + 5]!;
        const hero = raw >= HERO_FLAG;
        for (const part of this.parts(kind, lod, hero ? raw - HERO_FLAG : raw, hero)) {
          let list = groups.get(part);
          if (!list) groups.set(part, (list = []));
          list.push(i);
        }
      }
      for (const [part, idxs] of groups) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, idxs.length);
        idxs.forEach((i, n) => {
          const scale = data[i + 4]! * part.norm;
          const raw = data[i + 5]!;
          const variant = raw >= HERO_FLAG ? raw - HERO_FLAG : raw;
          p.set(data[i]!, data[i + 1]!, data[i + 2]!);
          q.setFromAxisAngle(up, data[i + 3]!);
          if (kind === 'rock' || kind === 'pebble') s.set(scale * (0.8 + variant * 0.5), scale * (0.7 + (1 - variant) * 0.5), scale);
          else s.set(scale, scale * (kind === 'tree' ? 0.85 + variant * 0.35 : 1), scale);
          m.compose(p, q, s);
          mesh.setMatrixAt(n, m);
          if (kind === 'pole') mesh.setColorAt(n, this.poleColors[variant > 0.5 ? 1 : 0]!);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = castShadow && kind !== 'pebble' && kind !== 'grass';
        mesh.receiveShadow = kind === 'rock';
        mesh.userData.kind = kind;
        out.push(mesh);
      }
    });
    return out;
  }

  dispose(): void {
    // Kit geometry/materials are shared for the session; only our biome tints are ours.
    for (const g of Object.values(this.geos)) g.dispose();
    for (const t of this.tinted) t.dispose();
    this.material.dispose();
  }
}
