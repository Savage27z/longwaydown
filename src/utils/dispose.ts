import * as THREE from 'three';

/**
 * Dispose geometries/materials under an object. Anything flagged `userData.shared = true`
 * (on the mesh, its geometry or its material) is left alone because other objects reuse it.
 */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj.userData.shared) return;
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && !mesh.geometry.userData.shared) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) {
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        if (!m.userData.shared) m.dispose();
      }
    }
    if ((obj as THREE.InstancedMesh).isInstancedMesh) (obj as THREE.InstancedMesh).dispose();
  });
}

/** Mark a geometry or material as shared so disposeObject skips it. */
export function shared<T extends THREE.BufferGeometry | THREE.Material>(thing: T): T {
  thing.userData.shared = true;
  return thing;
}
