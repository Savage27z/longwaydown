import * as THREE from 'three';
import { bikeMaterials, cable, chain, chainring, coil, joint, oval, tube, wheel } from './bikeParts';
import { mergeByMaterial } from './mergeParts';

/**
 * Motocross bike. Origin on the ground between the wheels, +Z forward, +X = rider's left.
 * Aluminium twin-spar frame, upside-down fork, coil rear shock, plastics in the primary colour
 * with secondary graphics and white number boards. Named nodes: wheelFront, wheelRear, steer,
 * forkSlider, swingarm, seat, gripL, gripR, pegL, pegR.
 */
export const MOTO_DIMS = { wheelRadius: 0.37, wheelbase: 1.45 };

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Thin moulded panel: a side-view outline (z, y) extruded across X, centred on `x`. */
function panel(outline: [number, number][], depth: number, x: number, mat: THREE.Material, bevel = 0.012): THREE.Mesh {
  const shape = new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.002, depth - bevel * 2), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
  // Shape lies in XY (x = our z) and extrudes along +Z; turn it so the extrusion runs along X.
  g.rotateY(-Math.PI / 2);
  g.translate(x + depth / 2 - bevel, 0, 0);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

export function buildMotorbike(primary: string, secondary: string): THREE.Group {
  const m = bikeMaterials(primary, secondary);
  const white = new THREE.MeshPhongMaterial({ color: '#f2f5f8', shininess: 60 });
  const alu = new THREE.MeshPhongMaterial({ color: '#b9c0c8', shininess: 90, specular: '#cccccc' });
  const gold = new THREE.MeshPhongMaterial({ color: '#d9a640', shininess: 110, specular: '#fff0c0' });
  const root = new THREE.Group();
  root.name = 'motorbike';
  const R = MOTO_DIMS.wheelRadius;
  const rearAxle = V(0, R, -MOTO_DIMS.wheelbase / 2);
  const frontAxle = V(0, R, MOTO_DIMS.wheelbase / 2);
  const head = V(0, 1.0, 0.45);
  const headLow = V(0, 0.82, 0.5);
  const pivot = V(0, 0.5, -0.12);

  // ---- Frame: twin aluminium spars round the engine, cradle rails, subframe ----
  const body = new THREE.Group();
  for (const s of [1, -1]) {
    const top = V(0.05 * s, 0.95, 0.42);
    const bend = V(0.12 * s, 0.84, 0.02);
    body.add(oval(top, bend, 0.045, 0.04, 0.42, alu));
    body.add(oval(bend, pivot.clone().setX(0.1 * s), 0.04, 0.036, 0.42, alu));
    body.add(joint(bend, 0.036, alu));
    body.add(tube(V(0.04 * s, 0.32, 0.24), V(0.06 * s, 0.28, -0.08), 0.018, alu));
    body.add(tube(V(0.06 * s, 0.28, -0.08), pivot.clone().setX(0.09 * s), 0.018, alu));
    body.add(tube(V(0.1 * s, 0.86, -0.08), V(0.08 * s, 0.93, -0.6), 0.016, alu));
    body.add(tube(V(0.09 * s, 0.62, -0.16), V(0.08 * s, 0.9, -0.52), 0.013, alu));
    // Swingarm pivot boss.
    body.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 12).rotateZ(Math.PI / 2).translate(0.11 * s, pivot.y, pivot.z), alu));
  }
  body.add(oval(headLow.clone().add(V(0, -0.02, -0.02)), V(0, 0.32, 0.24), 0.034, 0.028, 0.6, alu));
  // Steering head.
  body.add(tube(headLow.clone().add(V(0, -0.03, 0.01)), head.clone().add(V(0, 0.02, 0)), 0.035, alu));

  // ---- Engine: crankcase, cylinder with fins, head, covers, radiators ----
  body.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.2, 16).rotateZ(Math.PI / 2).translate(0, 0.42, 0.02), m.dark));
  body.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(0, 0.42, -0.1), m.dark));
  body.add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 16).rotateZ(Math.PI / 2).translate(-0.115, 0.42, 0.04), gold));
  body.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 12).rotateZ(Math.PI / 2).translate(0.115, 0.44, -0.04), m.metal));
  const cyl = new THREE.Group();
  cyl.add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.15), m.metal));
  for (let i = 0; i < 6; i++) cyl.add(new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.012, 0.18).translate(0, -0.08 + i * 0.03, 0), m.metal));
  cyl.add(new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.08, 0.17).translate(0, 0.13, 0), m.dark));
  cyl.rotation.x = 0.28;
  cyl.position.set(0, 0.64, 0.1);
  cyl.updateMatrix();
  for (const c of cyl.children) {
    const mesh = c as THREE.Mesh;
    body.add(new THREE.Mesh(mesh.geometry.applyMatrix4(cyl.matrix), mesh.material));
  }
  for (const s of [1, -1]) {
    body.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.2).rotateX(-0.2).translate(0.1 * s, 0.76, 0.27), m.dark));
  }
  // Airbox under the seat.
  body.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.32).translate(0, 0.78, -0.32), m.dark));

  // ---- Exhaust: header round the front of the engine, silencer up under the side panel ----
  body.add(cable([V(-0.02, 0.7, 0.2), V(-0.04, 0.62, 0.3), V(-0.1, 0.46, 0.27), V(-0.15, 0.42, 0.1), V(-0.17, 0.5, -0.1), V(-0.19, 0.68, -0.3)], 0.024, m.metal));
  body.add(oval(V(-0.19, 0.7, -0.3), V(-0.19, 0.86, -0.74), 0.052, 0.046, 0.8, alu));
  body.add(new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.04, 0.05, 12).translate(0, 0.025, 0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(0, 0.16, -0.44).normalize())).translate(-0.19, 0.86, -0.74), m.dark));

  // ---- Rear shock (static): coil over a damper, frame top to the linkage ----
  const shockTop = V(0, 0.86, -0.16);
  const shockLow = V(0, 0.46, -0.24);
  body.add(tube(shockTop, shockTop.clone().lerp(shockLow, 0.55), 0.03, m.dark));
  body.add(tube(shockTop.clone().lerp(shockLow, 0.45), shockLow, 0.014, m.chrome));
  body.add(coil(shockTop.clone().lerp(shockLow, 0.12), shockTop.clone().lerp(shockLow, 0.88), 0.042, 0.008, 8, m.accent));
  body.add(tube(shockTop.clone().add(V(0.05, -0.02, 0.02)), shockTop.clone().add(V(0.05, -0.18, 0.02)), 0.022, gold));

  // ---- Bodywork ----
  // Seat: long and flat, rising onto the tank; secondary-colour cover with a grippy top band.
  body.add(panel([[0.25, 0.94], [0.26, 1.0], [0.12, 1.005], [-0.55, 0.985], [-0.66, 0.965], [-0.64, 0.92], [-0.3, 0.92], [0.1, 0.92]], 0.22, 0, m.accent, 0.02));
  body.add(panel([[0.12, 1.012], [-0.5, 0.995], [-0.5, 0.985], [0.12, 1.0]], 0.16, 0, m.dark, 0.006));
  // Tank under the shrouds.
  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), m.paint);
  tank.scale.set(0.9, 0.62, 1.25);
  tank.position.set(0, 0.92, 0.27);
  body.add(tank);
  for (const s of [1, -1]) {
    // Radiator shroud: the big wing beside the tank, with a graphic panel on it.
    const shroud = panel([[0.47, 1.0], [0.52, 0.88], [0.45, 0.68], [0.28, 0.6], [0.08, 0.68], [0.02, 0.88], [0.16, 0.98]], 0.022, 0.15 * s, m.paint);
    shroud.rotation.z = -0.08 * s;
    body.add(shroud);
    const graphic = panel([[0.42, 0.93], [0.45, 0.85], [0.38, 0.72], [0.24, 0.68], [0.14, 0.78], [0.2, 0.9]], 0.006, 0.168 * s, m.accent, 0.003);
    graphic.rotation.z = -0.08 * s;
    body.add(graphic);
    // Side number board under the seat.
    body.add(panel([[-0.12, 0.93], [-0.56, 0.955], [-0.64, 0.84], [-0.34, 0.7], [-0.1, 0.74]], 0.018, 0.13 * s, white));
    body.add(panel([[-0.22, 0.88], [-0.48, 0.9], [-0.5, 0.82], [-0.25, 0.78]], 0.004, 0.141 * s, m.accent, 0.002));
  }
  // Rear fender sweeping up past the wheel.
  body.add(panel([[-0.45, 0.965], [-0.8, 0.995], [-1.1, 1.06], [-1.12, 1.03], [-0.82, 0.955], [-0.5, 0.915]], 0.22, 0, m.paint, 0.015));
  mergeByMaterial(body);
  root.add(body);
  const seat = new THREE.Object3D();
  seat.name = 'seat';
  seat.position.set(0, 1.01, -0.12);
  root.add(seat);
  for (const [name, s] of [['pegL', 1], ['pegR', -1]] as const) {
    const peg = new THREE.Group();
    peg.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.022, 0.055), m.metal));
    for (let i = 0; i < 4; i++) peg.add(new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.06).translate(-0.04 + i * 0.027, 0.014, 0), m.dark));
    peg.position.set(0.19 * s, 0.38, -0.08);
    mergeByMaterial(peg);
    root.add(peg);
    const marker = new THREE.Object3D();
    marker.name = name;
    marker.position.set(0.19 * s, 0.4, -0.06);
    root.add(marker);
  }
  // Brake pedal (right) and gear lever (left).
  root.add(tube(V(-0.15, 0.38, -0.02), V(-0.17, 0.4, 0.16), 0.01, m.dark));
  root.add(tube(V(0.15, 0.44, -0.02), V(0.17, 0.46, 0.14), 0.01, m.dark));

  // ---- Swingarm + rear wheel ----
  const swing = new THREE.Group();
  swing.name = 'swingarm';
  swing.position.copy(pivot);
  root.add(swing);
  const rel = rearAxle.clone().sub(pivot);
  for (const s of [1, -1]) {
    swing.add(oval(V(0.085 * s, 0, 0), rel.clone().setX(0.085 * s), 0.045, 0.03, 0.42, alu));
    swing.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.06).translate(0.085 * s, rel.y, rel.z), alu));
  }
  swing.add(tube(V(0.085, 0, 0.03), V(-0.085, 0, 0.03), 0.03, alu));
  // Chain slider, sprockets, chain, rear disc and caliper.
  swing.add(oval(V(0.1, 0.03, -0.02), rel.clone().lerp(V(0, 0, 0), 0.55).setX(0.1).add(V(0, 0.03, 0)), 0.02, 0.016, 0.6, m.dark));
  const sprocket = chainring(0.11, 48, m.metal);
  sprocket.position.copy(rel).setX(0.1);
  swing.add(sprocket);
  swing.add(chain(V(0, -0.05, 0.12), rel, 0.045, 0.112, 0.1, m.dark));
  swing.add(new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.012, 4, 28).rotateY(Math.PI / 2).translate(-0.085, rel.y, rel.z), m.chrome));
  swing.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.07).translate(-0.095, rel.y + 0.09, rel.z + 0.05), m.dark));
  mergeByMaterial(swing);
  const wr = wheel(R, 0.05, true, m, false, m.chrome, m.dark);
  wr.name = 'wheelRear';
  wr.position.copy(rel);
  swing.add(wr);

  // ---- Steering: triple clamps, upside-down fork, front fender, number plate, bars ----
  const steer = new THREE.Group();
  steer.name = 'steer';
  steer.position.copy(headLow);
  steer.userData.axis = head.clone().sub(headLow).normalize();
  root.add(steer);
  const L = (v: THREE.Vector3) => v.clone().sub(headLow);
  const slider = new THREE.Group();
  slider.name = 'forkSlider';
  steer.add(slider);
  steer.add(new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.05, 0.1).translate(0, 0.14, -0.02), m.accent));
  steer.add(new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.06, 0.11).translate(0, -0.05, 0.01), m.accent));
  const topClamp = L(head).add(V(0, -0.04, 0.0));
  const axleL = L(frontAxle);
  for (const s of [1, -1]) {
    // Fat outer tubes in the clamps, gold inner tubes sliding below, plastic guards in front.
    const outerTop = topClamp.clone().setX(0.105 * s);
    const outerEnd = outerTop.clone().lerp(axleL.clone().setX(0.105 * s), 0.5);
    steer.add(tube(outerTop, outerEnd, 0.034, m.dark, 0.032));
    const innerTop = outerTop.clone().lerp(axleL.clone().setX(0.105 * s), 0.42);
    slider.add(tube(innerTop, axleL.clone().setX(0.105 * s).add(V(0, 0.05, 0)), 0.026, gold));
    slider.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.06).translate(0.105 * s, axleL.y + 0.02, axleL.z), m.dark));
    const guardA = outerTop.clone().lerp(axleL.clone().setX(0.105 * s), 0.6).add(V(0, 0, 0.035));
    const guardB = axleL.clone().setX(0.105 * s).add(V(0, 0.09, 0.04));
    slider.add(oval(guardA, guardB, 0.03, 0.026, 0.55, white));
  }
  // Front disc and caliper on the left leg.
  slider.add(new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.014, 4, 32).rotateY(Math.PI / 2).translate(0.075, axleL.y, axleL.z), m.chrome));
  slider.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.06).translate(0.085, axleL.y + 0.1, axleL.z - 0.06), m.dark));
  // Front fender off the lower clamp, high above the wheel.
  steer.add(panel([[-0.24, -0.08], [-0.05, -0.015], [0.2, -0.005], [0.42, -0.05], [0.55, -0.12], [0.53, -0.14], [0.4, -0.08], [0.2, -0.035], [-0.05, -0.045], [-0.22, -0.11]], 0.15, 0, m.paint, 0.01));
  // Number plate in front of the bars.
  steer.add(panel([[0.06, 0.33], [0.16, 0.06], [0.14, 0.05], [0.04, 0.32]], 0.25, 0, white, 0.008));
  steer.add(panel([[0.072, 0.29], [0.15, 0.085], [0.16, 0.09], [0.082, 0.295]], 0.15, 0, m.accent, 0.003));
  const barY = L(head).y + 0.1;
  const barZ = L(head).z - 0.05;
  steer.add(tube(V(0.42, barY, barZ), V(-0.42, barY, barZ), 0.014, m.dark));
  steer.add(tube(V(0.18, barY + 0.035, barZ), V(-0.18, barY + 0.035, barZ), 0.018, m.accent));
  for (const [name, s] of [['gripL', 1], ['gripR', -1]] as const) {
    steer.add(tube(V(0.31 * s, barY, barZ), V(0.43 * s, barY, barZ), 0.021, m.rubber));
    steer.add(tube(V(0.27 * s, barY, barZ + 0.01), V(0.36 * s, barY - 0.01, barZ + 0.09), 0.007, m.metal));
    steer.add(tube(V(0.0, barY, barZ), V(0.0, barY - 0.08, barZ + 0.02), 0.025, m.dark));
    const marker = new THREE.Object3D();
    marker.name = name;
    marker.position.set(0.37 * s, barY, barZ);
    steer.add(marker);
  }
  mergeByMaterial(slider);
  const wf = wheel(R, 0.045, true, m, false, m.chrome, m.dark);
  wf.name = 'wheelFront';
  wf.position.copy(axleL);
  slider.add(wf);
  mergeByMaterial(steer);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return root;
}
