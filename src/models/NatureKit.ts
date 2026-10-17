import * as THREE from 'three';

/** One drawable part of a kit model (a tree is bark + leaves). */
export interface KitPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshLambertMaterial;
}

/** Model key (see scripts/build-nature.mjs PICKS) -> parts. */
export type NatureKit = Map<string, KitPart[]>;

let kit: NatureKit | null = null;
let promise: Promise<NatureKit | null> | null = null;

/** Lambert like the rest of the world; foliage keeps its cut-out texture and the kit's baked vertex shading. */
function toLambert(src: THREE.Material): THREE.MeshLambertMaterial {
  const m = src as THREE.MeshStandardMaterial;
  return new THREE.MeshLambertMaterial({
    name: m.name,
    color: m.color.clone(),
    map: m.map,
    vertexColors: m.vertexColors,
    alphaTest: m.alphaTest,
    side: THREE.DoubleSide,
  });
}

/**
 * Load the CC0 Quaternius nature models (trees, rocks, bushes, grass). Shared for the session,
 * like the rider pack. Resolves null if unavailable (procedural props are used instead).
 */
export function loadNatureKit(url: string): Promise<NatureKit | null> {
  if (!promise) {
    promise = (async () => {
      try {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const gltf = await new GLTFLoader().loadAsync(url);
        const out: NatureKit = new Map();
        const materials = new Map<THREE.Material, THREE.MeshLambertMaterial>();
        for (const root of gltf.scene.children) {
          const parts: KitPart[] = [];
          root.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const src = mesh.material as THREE.Material;
            let mat = materials.get(src);
            if (!mat) materials.set(src, (mat = toLambert(src)));
            // Session-wide: tiles and maps come and go, the kit stays.
            mat.userData.shared = true;
            mesh.geometry.userData.shared = true;
            parts.push({ geometry: mesh.geometry, material: mat });
          });
          out.set(root.name, parts);
        }
        kit = out;
        return kit;
      } catch (e) {
        console.warn('[NatureKit] unavailable, using procedural props:', e);
        return null;
      }
    })();
  }
  return promise;
}

export function getNatureKit(): NatureKit | null {
  return kit;
}
