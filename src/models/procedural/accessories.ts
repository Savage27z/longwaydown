import * as THREE from 'three';
import type { CharacterRig } from './character';

/** Default headgear (ski helmet + goggles). The customization phase adds the other styles. */
export function buildDefaultHeadgear(rig: CharacterRig): void {
  const { materials, slots } = rig;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.145, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.58), materials.helmet);
  shell.scale.set(1, 0.95, 1.12);
  shell.position.set(0, 0.15, 0.0);
  shell.castShadow = true;
  slots.helmet.add(shell);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.055, 0.2), materials.topAccent);
  strap.position.set(0, 0.165, 0.02);
  slots.goggles.add(strap);
  const lens = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.075, 0.05), materials.visor);
  lens.position.set(0, 0.165, 0.12);
  slots.goggles.add(lens);
}
