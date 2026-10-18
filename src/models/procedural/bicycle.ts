import * as THREE from 'three';
import { bikeMaterials, cable, cassette, chain, chainring, coil, joint, oval, pedal, saddle, tube, wheel } from './bikeParts';
import { mergeByMaterial } from './mergeParts';

/**
 * Modern bikes: the bicycle is a hardtail trail bike, the mountain bike a full-suspension enduro
 * bike (coil shock, rocker link, moving rear end). Origin on the ground between the wheels, +Z
 * forward, +X = rider's left. Named nodes used by the vehicle: wheelFront, wheelRear, steer,
 * crank, pedalL, pedalR, seat, gripL, gripR, forkSlider, swingarm (mountain bike).
 */
export interface BikeOptions {
  mtb: boolean;
  primary: string;
  secondary: string;
}

export const BIKE_DIMS = {
  wheelRadius: 0.35,
  wheelbase: 1.12,
  crankLength: 0.17,
  bottomBracket: new THREE.Vector3(0, 0.31, -0.06),
};

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function buildBicycle(opt: BikeOptions): THREE.Group {
  const m = bikeMaterials(opt.primary, opt.secondary);
  const gold = new THREE.MeshPhongMaterial({ color: '#d9a640', shininess: 110, specular: '#fff0c0' });
  const root = new THREE.Group();
  root.name = opt.mtb ? 'mountainBike' : 'bicycle';
  const R = BIKE_DIMS.wheelRadius;
  // Tyre tube radius: a 2.4" enduro tyre and a 1.8" trail tyre.
  const tyreW = opt.mtb ? 0.031 : 0.023;
  const rearAxle = V(0, R, -BIKE_DIMS.wheelbase / 2);
  const frontAxle = V(0, R, BIKE_DIMS.wheelbase / 2);
  const bb = BIKE_DIMS.bottomBracket.clone();
  const seatCluster = V(0, 0.8, -0.24);
  const headTop = V(0, 0.93, 0.33);
  const headBottom = V(0, 0.73, 0.385);
  const onSeatTube = (y: number) => bb.clone().lerp(seatCluster, (y - bb.y) / (seatCluster.y - bb.y));
  const k = opt.mtb ? 1.25 : 1;

  // ---- Front triangle (static, merged): fat hydroformed down tube, sloping top tube ----
  const frame = new THREE.Group();
  const ttEnd = onSeatTube(0.69);
  frame.add(oval(bb, headBottom.clone().add(V(0, 0.02, -0.01)), 0.03 * k, 0.026 * k, 0.72, m.paint));
  frame.add(oval(headTop.clone().add(V(0, -0.04, 0.005)), ttEnd, 0.022 * k, 0.019 * k, 0.8, m.paint));
  frame.add(oval(bb, seatCluster, 0.022 * k, 0.019 * k, 0.9, m.paint));
  // Head tube (tapered) and the bottom bracket shell.
  frame.add(tube(headBottom.clone().add(V(0, -0.03, 0.012)), headTop.clone().add(V(0, 0.015, -0.004)), 0.03 * k, m.paint, 0.026 * k));
  frame.add(joint(bb, 0.036 * k, m.paint));
  frame.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 12).rotateZ(Math.PI / 2).translate(bb.x, bb.y, bb.z), m.dark));
  // Two-tone down tube: a secondary-colour panel on its lower half.
  frame.add(oval(bb.clone().lerp(headBottom, 0.22), bb.clone().lerp(headBottom, 0.62), 0.031 * k, 0.029 * k, 0.74, m.accent));
  // Seat clamp + dropper post (black lower, silver stanchion) + saddle.
  const postTop = seatCluster.clone().add(V(0, 0.22, -0.075));
  frame.add(joint(seatCluster.clone().add(V(0, 0.01, 0)), 0.024 * k, m.dark));
  frame.add(tube(seatCluster, seatCluster.clone().lerp(postTop, 0.45), 0.017, m.dark));
  frame.add(tube(seatCluster.clone().lerp(postTop, 0.45), postTop, 0.014, opt.mtb ? m.chrome : m.dark));

  // ---- Rear end ----
  // Hardtail: stays welded to the front triangle. Full suspension: a swingarm on a main pivot
  // behind the bottom bracket, driven through a rocker on the seat tube into a coil shock.
  const pivot = opt.mtb ? V(0, 0.4, -0.12) : bb.clone();
  const rear = new THREE.Group();
  rear.name = opt.mtb ? 'swingarm' : '';
  rear.position.copy(pivot);
  const P = (v: THREE.Vector3) => v.clone().sub(pivot);
  const stayTop = opt.mtb ? V(0, 0.66, -0.3) : onSeatTube(0.7);
  for (const x of [0.065, -0.065]) {
    rear.add(oval(P(pivot.clone().setX(x * 0.6)), P(rearAxle.clone().setX(x)), 0.02 * k, 0.014 * k, 0.75, m.paint));
    rear.add(oval(P(stayTop.clone().setX(x * 0.5)), P(rearAxle.clone().setX(x)), 0.016 * k, 0.012 * k, 0.8, m.paint));
    rear.add(joint(P(rearAxle.clone().setX(x)), 0.017, m.dark));
  }
  // Seatstay bridge and the rear brake caliper.
  rear.add(tube(P(stayTop.clone().lerp(rearAxle, 0.25).setX(0.05)), P(stayTop.clone().lerp(rearAxle, 0.25).setX(-0.05)), 0.009, m.paint));
  rear.add(new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.05, 0.04).translate(...P(rearAxle.clone().add(V(-0.065, 0.06, 0.05))).toArray()), m.dark));
  const cas = cassette(m);
  cas.position.copy(P(rearAxle));
  rear.add(cas);
  const ringR = 0.085;
  rear.add(chain(P(bb), P(rearAxle), ringR + 0.003, 0.05, -0.062, m.metal));
  const derailleur = new THREE.Group();
  derailleur.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.03), m.dark));
  for (const y of [-0.025, -0.07]) {
    const pulley = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 10).rotateZ(Math.PI / 2), m.metal);
    pulley.position.y = y;
    derailleur.add(pulley);
  }
  derailleur.position.copy(P(rearAxle)).add(V(-0.065, -0.05, 0.01));
  mergeByMaterial(derailleur);
  rear.add(derailleur);
  if (opt.mtb) {
    // Main pivot hardware, rocker plates (seat tube pivot -> shock eye / seatstays) and the shock.
    frame.add(joint(pivot, 0.03, m.dark));
    const rockerPivot = onSeatTube(0.62);
    const shockTop = V(0, 0.665, -0.1);
    const shockBottom = bb.clone().lerp(headBottom, 0.3);
    for (const x of [0.03, -0.03]) {
      frame.add(oval(shockTop.clone().setX(x), stayTop.clone().setX(x), 0.022, 0.018, 0.5, m.accent));
    }
    frame.add(joint(rockerPivot, 0.024, m.dark));
    frame.add(joint(stayTop, 0.02, m.dark));
    frame.add(tube(shockBottom, shockBottom.clone().lerp(shockTop, 0.62), 0.022, m.dark));
    frame.add(tube(shockBottom.clone().lerp(shockTop, 0.5), shockTop, 0.012, m.chrome));
    frame.add(coil(shockBottom.clone().lerp(shockTop, 0.18), shockBottom.clone().lerp(shockTop, 0.8), 0.028, 0.005, 7, m.accent));
    frame.add(joint(shockTop, 0.016, m.dark));
    frame.add(joint(shockBottom, 0.018, m.dark));
  } else {
    // Hardtail: stays meet the seat tube; small dropout plates.
    frame.add(joint(stayTop, 0.02, m.paint));
  }
  mergeByMaterial(rear);
  root.add(rear);
  mergeByMaterial(frame);
  root.add(frame);
  const sad = saddle(m.dark, m.metal);
  sad.position.copy(postTop);
  root.add(sad);
  const seat = new THREE.Object3D();
  seat.name = 'seat';
  seat.position.copy(postTop).add(V(0, 0.06, -0.02));
  root.add(seat);

  // ---- Wheels (black spokes on the mountain bike) ----
  const spokeMat = opt.mtb ? m.dark : m.chrome;
  const rimMat = opt.mtb ? m.dark : m.metal;
  const wr = wheel(R, tyreW, true, m, true, spokeMat, rimMat);
  wr.name = 'wheelRear';
  wr.position.copy(P(rearAxle));
  rear.add(wr);

  // ---- Steering assembly (pivots on the head tube axis) ----
  const steer = new THREE.Group();
  steer.name = 'steer';
  steer.position.copy(headBottom);
  const axis = headTop.clone().sub(headBottom).normalize();
  steer.userData.axis = axis;
  root.add(steer);
  const L = (v: THREE.Vector3) => v.clone().sub(headBottom);
  const forkSlider = new THREE.Group();
  forkSlider.name = 'forkSlider';
  steer.add(forkSlider);
  const crownL = L(headBottom.clone().add(V(0, -0.025, 0)));
  // Suspension fork: crown, stanchions (gold on the enduro bike), lowers with the arch in front.
  const fw = opt.mtb ? 0.075 : 0.065;
  steer.add(new THREE.Mesh(new THREE.BoxGeometry(fw * 2 + 0.05, 0.04, 0.06).translate(crownL.x, crownL.y, crownL.z), m.dark));
  for (const x of [fw, -fw]) {
    steer.add(tube(crownL.clone().setX(x), L(headBottom.clone().lerp(frontAxle, 0.55)).setX(x), opt.mtb ? 0.019 : 0.016, opt.mtb ? gold : m.dark));
    forkSlider.add(tube(L(headBottom.clone().lerp(frontAxle, 0.4)).setX(x), L(frontAxle).setX(x), opt.mtb ? 0.026 : 0.021, m.dark, opt.mtb ? 0.023 : 0.019));
  }
  const arch = L(headBottom.clone().lerp(frontAxle, 0.44));
  forkSlider.add(new THREE.Mesh(new THREE.BoxGeometry(fw * 2 + 0.02, 0.03, 0.035).translate(arch.x, arch.y, arch.z + 0.025), m.dark));
  // Front brake caliper.
  const cal = L(frontAxle).add(V(-0.065, 0.05, -0.04));
  forkSlider.add(new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.05, 0.035).translate(cal.x, cal.y, cal.z), m.dark));
  mergeByMaterial(forkSlider);
  const wf = wheel(R, tyreW, true, m, true, spokeMat, rimMat);
  wf.name = 'wheelFront';
  wf.position.copy(L(frontAxle));
  forkSlider.add(wf);

  // Stem + riser bar + lock-on grips + levers + hoses.
  // Tall stem + riser bar: the rider's arms are short, so the bars come up and back.
  const stemEnd = L(V(0, 1.08, 0.35));
  steer.add(tube(L(headTop), stemEnd, 0.019, m.dark));
  steer.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 12).translate(...L(headTop).add(V(0, 0.02, 0)).toArray()), m.dark));
  const barW = opt.mtb ? 0.39 : 0.33;
  const barY = stemEnd.y + (opt.mtb ? 0.045 : 0.03);
  for (const s of [1, -1]) {
    steer.add(tube(stemEnd, V(barW * 0.45 * s, barY, stemEnd.z - 0.01), 0.012, m.dark));
    steer.add(tube(V(barW * 0.45 * s, barY, stemEnd.z - 0.01), V(barW * s, barY + 0.01, stemEnd.z - 0.035), 0.011, m.dark));
    steer.add(tube(V((barW - 0.12) * s, barY + 0.008, stemEnd.z - 0.03), V(barW * s, barY + 0.01, stemEnd.z - 0.035), 0.018, m.rubber));
    steer.add(tube(V((barW - 0.125) * s, barY + 0.008, stemEnd.z - 0.03), V((barW - 0.11) * s, barY + 0.009, stemEnd.z - 0.031), 0.02, m.accent));
    steer.add(tube(V((barW - 0.14) * s, barY + 0.01, stemEnd.z - 0.025), V((barW - 0.06) * s, barY - 0.01, stemEnd.z + 0.06), 0.006, m.metal));
    // Brake hose: lever, a loop in front of the bars, down into the frame by the head tube.
    steer.add(cable([V((barW - 0.14) * s, barY + 0.01, stemEnd.z - 0.02), V(0.12 * s, barY + 0.04, stemEnd.z + 0.12), V(0.05 * s, stemEnd.y - 0.12, stemEnd.z + 0.08), L(headTop).add(V(0.035 * s, -0.12, 0.02))], 0.004, m.dark));
    const marker = new THREE.Object3D();
    marker.name = s === 1 ? 'gripL' : 'gripR';
    marker.position.set((barW - 0.055) * s, barY + 0.01, stemEnd.z - 0.033);
    steer.add(marker);
  }
  mergeByMaterial(steer);

  // ---- Crank + pedals (pedals counter-rotate to stay level) ----
  const crank = new THREE.Group();
  crank.name = 'crank';
  crank.position.copy(bb);
  root.add(crank);
  const ring = chainring(ringR, 32, m.dark);
  ring.position.x = -0.062;
  crank.add(ring);
  for (const [name, side, phase] of [['pedalL', 1, 0], ['pedalR', -1, Math.PI]] as const) {
    const arm = new THREE.Group();
    arm.rotation.x = phase;
    crank.add(arm);
    arm.add(oval(V(0.075 * side, 0, 0), V(0.085 * side, 0, BIKE_DIMS.crankLength), 0.016, 0.012, 0.6, m.dark, 8));
    const p = pedal(m);
    p.name = name;
    p.position.set(0.13 * side, 0, BIKE_DIMS.crankLength);
    arm.add(p);
  }

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return root;
}
