import * as THREE from 'three';
import { bikeMaterials, tube } from './bikeParts';
import { mergeByMaterial } from './mergeParts';

/**
 * Original futuristic designs (no real brands or vehicles).
 * Hover car origin: ground under the centre, +Z forward. Named: pads (glow group), seat, gripL, gripR, footL, footR.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function marker(parent: THREE.Object3D, name: string, x: number, y: number, z: number): void {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  parent.add(o);
}

export function buildHoverCar(primary: string, secondary: string): THREE.Group {
  const m = bikeMaterials(primary, secondary);
  const root = new THREE.Group();
  root.name = 'hovercar';
  const body = new THREE.Group();
  // Side profile extruded across the width: low wedge nose, raised tail.
  const profile = new THREE.Shape();
  profile.moveTo(-2.1, 0.0);
  profile.lineTo(2.2, 0.0);
  profile.quadraticCurveTo(2.45, 0.05, 2.1, 0.32);
  profile.lineTo(0.6, 0.55);
  profile.lineTo(-1.6, 0.62);
  profile.quadraticCurveTo(-2.15, 0.6, -2.1, 0.0);
  const shell = new THREE.ExtrudeGeometry(profile, { depth: 1.7, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2, curveSegments: 8 });
  shell.translate(0, 0, -0.85);
  shell.rotateY(-Math.PI / 2);
  shell.translate(0, 0.55, 0);
  body.add(new THREE.Mesh(shell, m.paint));
  // Accent side skirts and a tail fin pair.
  for (const s of [1, -1]) {
    body.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 3.6).translate(s * 0.93, 0.66, 0), m.accent));
    const fin = new THREE.Shape();
    fin.moveTo(0, 0);
    fin.lineTo(0.55, 0);
    fin.lineTo(0.15, 0.55);
    fin.lineTo(0, 0.55);
    const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.05, bevelEnabled: false });
    fg.rotateY(-Math.PI / 2);
    fg.translate(s * 0.62, 1.15, -1.95);
    body.add(new THREE.Mesh(fg, m.accent));
  }
  mergeByMaterial(body);
  root.add(body);
  // Tinted canopy.
  const canopyMat = new THREE.MeshPhongMaterial({ color: '#79d8ff', transparent: true, opacity: 0.55, shininess: 120, specular: '#ffffff' });
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), canopyMat);
  canopy.scale.set(1.15, 0.75, 1.9);
  canopy.position.set(0, 1.1, 0.05);
  root.add(canopy);
  // Seat, yoke, light strips.
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.55).translate(0, 1.12, -0.35), m.dark));
  const yoke = tube(V(0.22, 1.42, 0.55), V(-0.22, 1.42, 0.55), 0.025, m.dark);
  root.add(yoke);
  root.add(tube(V(0, 1.2, 0.85), V(0, 1.42, 0.55), 0.03, m.dark));
  marker(root, 'seat', 0, 1.2, -0.35);
  marker(root, 'gripL', 0.2, 1.42, 0.55);
  marker(root, 'gripR', -0.2, 1.42, 0.55);
  marker(root, 'footL', 0.18, 0.95, 0.55);
  marker(root, 'footR', -0.18, 0.95, 0.55);
  const glowMat = new THREE.MeshBasicMaterial({ color: '#56e6ff' });
  const pads = new THREE.Group();
  pads.name = 'pads';
  for (const [x, z] of [[0.8, 1.4], [-0.8, 1.4], [0.8, -1.35], [-0.8, -1.35]] as const) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.14, 16), m.dark);
    pad.position.set(x, 0.5, z);
    root.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 6, 20), glowMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.42, z);
    pads.add(ring);
  }
  for (const s of [1, -1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 2.8), glowMat);
    strip.position.set(s * 0.97, 0.78, 0.1);
    pads.add(strip);
  }
  root.add(pads);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material !== canopyMat && (o as THREE.Mesh).material !== glowMat) (o as THREE.Mesh).castShadow = true;
  });
  return root;
}
