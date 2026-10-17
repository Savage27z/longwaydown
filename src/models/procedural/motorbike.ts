import * as THREE from 'three';
import { bikeMaterials, joint, tube, wheel } from './bikeParts';
import { mergeByMaterial } from './mergeParts';

/**
 * Dirt bike. Origin on the ground between the wheels, +Z forward, +X = rider's left.
 * Named nodes: wheelFront, wheelRear, steer, forkSlider, swingarm, seat, gripL, gripR, pegL, pegR.
 */
export const MOTO_DIMS = { wheelRadius: 0.37, wheelbase: 1.45 };

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function buildMotorbike(primary: string, secondary: string): THREE.Group {
  const m = bikeMaterials(primary, secondary);
  const white = new THREE.MeshPhongMaterial({ color: '#f2f5f8', shininess: 60 });
  const root = new THREE.Group();
  root.name = 'motorbike';
  const R = MOTO_DIMS.wheelRadius;
  const rearAxle = V(0, R, -MOTO_DIMS.wheelbase / 2);
  const frontAxle = V(0, R, MOTO_DIMS.wheelbase / 2);
  const head = V(0, 1.0, 0.45);
  const headLow = V(0, 0.82, 0.5);
  const pivot = V(0, 0.5, -0.12);

  // ---- Frame, engine, bodywork ----
  const body = new THREE.Group();
  for (const x of [0.07, -0.07]) {
    body.add(tube(head.clone().setX(x * 0.5), V(x, 0.82, -0.05), 0.022, m.dark));
    body.add(tube(V(x, 0.82, -0.05), pivot.clone().setX(x), 0.022, m.dark));
    body.add(tube(headLow.clone().setX(x * 0.5), V(x, 0.32, 0.18), 0.02, m.dark));
    body.add(tube(V(x, 0.32, 0.18), pivot.clone().setX(x), 0.02, m.dark));
    body.add(tube(V(x, 0.82, -0.05), V(x * 1.3, 0.88, -0.55), 0.016, m.dark));
  }
  body.add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.36).translate(0, 0.47, 0.04), m.metal));
  body.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.2).rotateX(0.2).translate(0, 0.66, 0.12), m.metal));
  for (let i = 0; i < 5; i++) body.add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.22).translate(0, 0.6 + i * 0.03, 0.12), m.dark));
  // Exhaust: header pipe sweeping back to a muffler on the right.
  body.add(tube(V(-0.06, 0.62, 0.2), V(-0.16, 0.42, 0.05), 0.025, m.chrome));
  body.add(tube(V(-0.16, 0.42, 0.05), V(-0.17, 0.62, -0.35), 0.028, m.chrome));
  body.add(tube(V(-0.17, 0.66, -0.4), V(-0.17, 0.8, -0.72), 0.055, m.metal));
  // Tank + shrouds.
  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), m.paint);
  tank.scale.set(0.95, 0.7, 1.45);
  tank.position.set(0, 0.93, 0.18);
  body.add(tank);
  for (const x of [0.13, -0.13]) {
    const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.36).rotateX(-0.25).translate(x, 0.86, 0.3), m.accent);
    body.add(shroud);
  }
  // Long flat seat, rear fender, side number plates.
  body.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.86).rotateX(0.04).translate(0, 0.96, -0.2), m.dark));
  body.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.6).rotateX(0.25).translate(0, 0.92, -0.78), m.paint));
  for (const x of [0.12, -0.12]) body.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.34).translate(x, 0.8, -0.45), white));
  mergeByMaterial(body);
  root.add(body);
  const seat = new THREE.Object3D();
  seat.name = 'seat';
  seat.position.set(0, 1.01, -0.12);
  root.add(seat);
  for (const [name, x] of [['pegL', 0.19], ['pegR', -0.19]] as const) {
    const peg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.05), m.chrome);
    peg.position.set(x, 0.38, -0.08);
    root.add(peg);
    const marker = new THREE.Object3D();
    marker.name = name;
    marker.position.set(x, 0.4, -0.06);
    root.add(marker);
  }

  // ---- Swingarm + rear wheel ----
  const swing = new THREE.Group();
  swing.name = 'swingarm';
  swing.position.copy(pivot);
  root.add(swing);
  const rel = rearAxle.clone().sub(pivot);
  for (const x of [0.07, -0.07]) swing.add(tube(V(x, 0, 0), rel.clone().setX(x), 0.026, m.metal, 0.02));
  swing.add(tube(V(0, 0.05, 0.02), V(0, 0.36, 0.08), 0.03, m.accent));
  mergeByMaterial(swing);
  const wr = wheel(R, 0.06, true, m, true);
  wr.name = 'wheelRear';
  wr.position.copy(rel);
  swing.add(wr);

  // ---- Steering: forks, front wheel, fender, bars ----
  const steer = new THREE.Group();
  steer.name = 'steer';
  steer.position.copy(headLow);
  steer.userData.axis = head.clone().sub(headLow).normalize();
  root.add(steer);
  const L = (v: THREE.Vector3) => v.clone().sub(headLow);
  const slider = new THREE.Group();
  slider.name = 'forkSlider';
  steer.add(slider);
  steer.add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.08).translate(0, 0.12, -0.02), m.metal));
  steer.add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.08).translate(0, -0.04, 0.01), m.metal));
  for (const x of [0.1, -0.1]) {
    steer.add(tube(L(head).setX(x), L(headLow.clone().lerp(frontAxle, 0.45)).setX(x), 0.024, m.chrome));
    slider.add(tube(L(headLow.clone().lerp(frontAxle, 0.35)).setX(x), L(frontAxle).setX(x), 0.032, m.dark, 0.028));
  }
  const fender = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.6).rotateX(-0.15).translate(0, 0, 0), m.paint);
  fender.position.copy(L(frontAxle)).add(V(0, R + 0.08, 0.05));
  slider.add(fender);
  slider.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.03).rotateX(-0.35).translate(0, 0.07, 0.07), white));
  mergeByMaterial(slider);
  const wf = wheel(R, 0.055, true, m, true);
  wf.name = 'wheelFront';
  wf.position.copy(L(frontAxle));
  slider.add(wf);
  const barY = L(head).y + 0.1;
  const barZ = L(head).z - 0.05;
  steer.add(tube(V(0.42, barY, barZ), V(-0.42, barY, barZ), 0.014, m.dark));
  for (const [name, s] of [['gripL', 1], ['gripR', -1]] as const) {
    steer.add(tube(V(0.32 * s, barY, barZ), V(0.42 * s, barY, barZ), 0.02, m.rubber));
    const marker = new THREE.Object3D();
    marker.name = name;
    marker.position.set(0.37 * s, barY, barZ);
    steer.add(marker);
  }
  steer.add(joint(L(head).add(V(0, 0.05, 0)), 0.03, m.dark));
  mergeByMaterial(steer);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return root;
}
