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
  // Teardrop pod turned on a lathe (nose at +Z), flattened into a low lozenge.
  const profile: [number, number][] = [
    [0, -2.1], [0.32, -2.06], [0.66, -1.75], [0.86, -1.1], [0.92, -0.2], [0.88, 0.7], [0.66, 1.5], [0.32, 2.02], [0, 2.18],
  ];
  const pod = new THREE.LatheGeometry(profile.map(([r, t]) => new THREE.Vector2(r, t)), 28);
  pod.rotateX(Math.PI / 2);
  pod.scale(1, 0.52, 1);
  pod.translate(0, 0.78, 0);
  body.add(new THREE.Mesh(pod, m.paint));
  // Contrast belly and a stripe down each flank.
  const belly = new THREE.LatheGeometry(profile.map(([r, t]) => new THREE.Vector2(r * 0.97, t * 0.97)), 28, Math.PI * 0.6, Math.PI * 0.8);
  belly.rotateX(Math.PI / 2);
  belly.scale(1, 0.5, 1);
  belly.translate(0, 0.76, 0);
  body.add(new THREE.Mesh(belly, m.dark));
  for (const s of [1, -1]) body.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 2.6).translate(s * 0.9, 0.86, -0.1), m.accent));
  // Cockpit opening and a pair of small swept fins at the tail.
  body.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 20).scale(1, 1, 1.6).translate(0, 1.2, -0.25), m.dark));
  for (const s of [1, -1]) {
    const fin = new THREE.Shape();
    fin.moveTo(0, 0);
    fin.lineTo(0.6, 0);
    fin.lineTo(0.12, 0.42);
    fin.lineTo(0, 0.42);
    const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.04, bevelEnabled: false });
    fg.rotateY(-Math.PI / 2);
    fg.rotateZ(s * 0.35);
    fg.translate(s * 0.45, 1.02, -1.75);
    body.add(new THREE.Mesh(fg, m.accent));
  }
  mergeByMaterial(body);
  root.add(body);
  // Wraparound tinted windscreen in front of the driver.
  const canopyMat = new THREE.MeshPhongMaterial({ color: '#79d8ff', transparent: true, opacity: 0.5, shininess: 120, specular: '#ffffff' });
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 8, -Math.PI * 0.35, Math.PI * 0.7, 0, Math.PI / 2), canopyMat);
  canopy.scale.set(1.05, 0.62, 1.15);
  canopy.position.set(0, 1.18, 0.2);
  root.add(canopy);
  // Seat low in the pod, yoke ahead.
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.12, 0.5).translate(0, 0.98, -0.42), m.dark));
  root.add(tube(V(0.2, 1.3, 0.42), V(-0.2, 1.3, 0.42), 0.025, m.dark));
  root.add(tube(V(0, 1.12, 0.7), V(0, 1.3, 0.42), 0.03, m.dark));
  marker(root, 'seat', 0, 1.02, -0.42);
  marker(root, 'gripL', 0.18, 1.3, 0.42);
  marker(root, 'gripR', -0.18, 1.3, 0.42);
  marker(root, 'footL', 0.16, 0.86, 0.5);
  marker(root, 'footR', -0.16, 0.86, 0.5);
  // Four hover pads under the hull, plus light strips (the 'pads' group pulses).
  const glowMat = new THREE.MeshBasicMaterial({ color: '#56e6ff' });
  const pads = new THREE.Group();
  pads.name = 'pads';
  for (const [x, z] of [[0.62, 1.15], [-0.62, 1.15], [0.66, -1.1], [-0.66, -1.1]] as const) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.12, 18), m.dark);
    pad.position.set(x, 0.48, z);
    root.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 6, 20), glowMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.41, z);
    pads.add(ring);
  }
  for (const s of [1, -1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 2.2), glowMat);
    strip.position.set(s * 0.86, 0.68, 0.0);
    pads.add(strip);
  }
  pads.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.05).translate(0, 0.86, -2.04), glowMat));
  root.add(pads);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material !== canopyMat && (o as THREE.Mesh).material !== glowMat) (o as THREE.Mesh).castShadow = true;
  });
  return root;
}
