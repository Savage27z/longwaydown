import * as THREE from 'three';
import type { CharacterRig } from './character';

function add(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0]): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.scale.set(...scale);
  m.rotation.set(...rot);
  m.castShadow = true;
  group.add(m);
  return m;
}

/** Default headgear: rounded ski helmet with vents + wrap-around goggles. */
export function buildDefaultHeadgear(rig: CharacterRig): void {
  const { materials, slots } = rig;
  // Shell covers the top/back of the head; the face stays open.
  add(slots.helmet, new THREE.SphereGeometry(0.132, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), materials.helmet, [0, 0.13, -0.006], [1, 1.02, 1.1]);
  add(slots.helmet, new THREE.TorusGeometry(0.128, 0.012, 6, 24, Math.PI * 1.3), materials.topAccent, [0, 0.135, -0.004], [1, 1, 1.1], [Math.PI / 2, 0, Math.PI * 0.85]);
  for (const x of [-0.035, 0.035]) add(slots.helmet, new THREE.BoxGeometry(0.014, 0.008, 0.11), materials.topAccent, [x, 0.258, -0.01], [1, 1, 1], [0.25, 0, 0]);
  // Goggles: curved strap + lens.
  const strap = new THREE.CylinderGeometry(0.124, 0.124, 0.042, 22, 1, true, -Math.PI * 0.55, Math.PI * 1.1);
  add(slots.goggles, strap, materials.topAccent, [0, 0.148, 0.004], [1, 1, 1.05]);
  const lens = new THREE.CylinderGeometry(0.127, 0.127, 0.052, 18, 1, true, -Math.PI * 0.28, Math.PI * 0.56);
  add(slots.goggles, lens, materials.visor, [0, 0.15, 0.006], [1, 1, 1.07]);
  for (const m of [materials.topAccent, materials.visor]) m.side = THREE.DoubleSide;
}
