import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Collapse a group's direct mesh children into one mesh per material, baking each child's
 * local transform. Child groups (moving parts) are left untouched. Cuts draw calls a lot for
 * detailed procedural models.
 */
export function mergeByMaterial(group: THREE.Object3D, castShadow = true): void {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const remove: THREE.Mesh[] = [];
  for (const child of group.children) {
    const m = child as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || m.name) continue;
    m.updateMatrix();
    let g = m.geometry.clone().applyMatrix4(m.matrix);
    if (g.index) g = g.toNonIndexed();
    for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
    let list = byMat.get(m.material);
    if (!list) byMat.set(m.material, (list = []));
    list.push(g);
    remove.push(m);
  }
  for (const m of remove) {
    group.remove(m);
    m.geometry.dispose();
  }
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}
