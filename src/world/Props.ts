import * as THREE from 'three';
import { shared } from '../utils/dispose';
import type { BiomeDef } from './Biome';
import { PROP_KINDS, PROP_STRIDE, type PropKind } from './TileBuilder';
import { broadleafTree, bush, markerPole, pineTree, rock } from '../models/procedural/props';

/**
 * Shared prop geometry/materials, and per-tile InstancedMesh creation. Each tile gets its own
 * InstancedMesh per kind (shared geometry), so tiles are culled independently.
 */
export class PropLibrary {
  readonly material: THREE.MeshLambertMaterial;
  private geos: Record<string, THREE.BufferGeometry> = {};
  private poleColors = [new THREE.Color('#ff5a1f'), new THREE.Color('#2f7cff')];

  constructor(readonly biome: BiomeDef) {
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
  }

  geometry(kind: PropKind, lod: number, variant: number): THREE.BufferGeometry {
    switch (kind) {
      case 'tree': {
        const leaf = variant < this.biome.trees.broadleafShare;
        return this.geos[`${leaf ? 'leaf' : 'tree'}:${lod === 0 ? 'high' : 'low'}`]!;
      }
      case 'rock':
        return this.geos.rock!;
      case 'pebble':
        return this.geos.pebble!;
      case 'pole':
        return this.geos.pole!;
      case 'bush':
        return this.geos.bush!;
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
      if (lod > 0 && (kind === 'pebble' || kind === 'pole')) return; // tiny at distance
      // Trees can be split into two geometries (pine / broadleaf) by variant.
      const groups = new Map<THREE.BufferGeometry, number[]>();
      for (let i = 0; i < data.length; i += PROP_STRIDE) {
        const geo = this.geometry(kind, lod, data[i + 5]!);
        let list = groups.get(geo);
        if (!list) groups.set(geo, (list = []));
        list.push(i);
      }
      for (const [geo, idxs] of groups) {
        const mesh = new THREE.InstancedMesh(geo, this.material, idxs.length);
        idxs.forEach((i, n) => {
          const scale = data[i + 4]!;
          const variant = data[i + 5]!;
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
        mesh.castShadow = castShadow && kind !== 'pebble';
        mesh.receiveShadow = kind === 'rock';
        mesh.userData.kind = kind;
        out.push(mesh);
      }
    });
    return out;
  }

  dispose(): void {
    for (const g of Object.values(this.geos)) g.dispose();
    this.material.dispose();
  }
}
