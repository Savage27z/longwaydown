import * as THREE from 'three';
import { bikeMaterials, tube } from './bikeParts';
import { mergeByMaterial } from './mergeParts';

/** Snowboard and skis. Origin on the snow under the rider, +Z forward. */

/** Plank with upturned tips: length along Z. */
function plank(length: number, width: number, thick: number, tipRise: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  const hl = length / 2;
  const hw = width / 2;
  shape.moveTo(-hw, -hl + hw);
  shape.quadraticCurveTo(-hw, -hl, 0, -hl);
  shape.quadraticCurveTo(hw, -hl, hw, -hl + hw);
  shape.lineTo(hw * 0.92, 0);
  shape.lineTo(hw, hl - hw);
  shape.quadraticCurveTo(hw, hl, 0, hl);
  shape.quadraticCurveTo(-hw, hl, -hw, hl - hw);
  shape.lineTo(-hw * 0.92, 0);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 8 });
  g.rotateX(Math.PI / 2);
  // Bend the tips up.
  const pos = g.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const t = Math.max(0, (Math.abs(z) - (hl - 0.22)) / 0.22);
    pos.setY(i, pos.getY(i) + t * t * tipRise);
  }
  g.computeVertexNormals();
  g.translate(0, thick, 0);
  return new THREE.Mesh(g, mat);
}

export function buildSnowboard(primary: string, secondary: string): THREE.Group {
  const m = bikeMaterials(primary, secondary);
  const root = new THREE.Group();
  root.name = 'snowboard';
  const board = new THREE.Group();
  board.add(plank(1.55, 0.29, 0.025, 0.09, m.paint));
  // Graphic stripe + bindings.
  board.add(new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.004, 0.18).translate(0, 0.028, 0), m.accent));
  for (const z of [0.25, -0.25]) {
    board.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.13).translate(0, 0.05, z), m.dark));
    board.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.03).translate(0, 0.1, z - 0.07), m.dark));
  }
  mergeByMaterial(board);
  root.add(board);
  for (const [name, z] of [['footL', 0.25], ['footR', -0.25]] as const) {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(0, 0.12, z);
    root.add(o);
  }
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return root;
}

export function buildSkis(primary: string, secondary: string): THREE.Group {
  const m = bikeMaterials(primary, secondary);
  const root = new THREE.Group();
  root.name = 'skis';
  for (const [name, x] of [['skiL', 0.12], ['skiR', -0.12]] as const) {
    const ski = new THREE.Group();
    ski.name = name;
    ski.add(plank(1.75, 0.085, 0.02, 0.1, m.paint));
    ski.add(new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.003, 0.5).translate(0, 0.022, 0.4), m.accent));
    ski.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.3).translate(0, 0.045, -0.02), m.dark));
    mergeByMaterial(ski);
    ski.position.x = x;
    root.add(ski);
    const foot = new THREE.Object3D();
    foot.name = name === 'skiL' ? 'footL' : 'footR';
    foot.position.set(x, 0.12, 0);
    root.add(foot);
  }
  // Poles are positioned every frame by the vehicle (they follow the hands).
  for (const name of ['poleL', 'poleR']) {
    const pole = new THREE.Group();
    pole.name = name;
    pole.add(tube(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1.15, 0), 0.01, m.metal, 0.01, 6));
    const basket = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 4, 10).rotateX(Math.PI / 2).translate(0, -1.05, 0), m.dark);
    pole.add(basket);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6).translate(0, -0.04, 0), m.accent);
    pole.add(grip);
    root.add(pole);
  }
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return root;
}
