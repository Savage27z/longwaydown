import * as THREE from 'three';
import { bikeMaterials, cassette, chain, chainring, joint, pedal, saddle, tube, wheel } from './bikeParts';
import { mergeByMaterial } from './mergeParts';

/**
 * Detailed bicycle / mountain bike. Origin on the ground between the wheels, +Z forward,
 * +X = rider's left. Named nodes used by the vehicle: wheelFront, wheelRear, steer, crank,
 * pedalL, pedalR, seat, gripL, gripR, forkSlider.
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
  const root = new THREE.Group();
  root.name = opt.mtb ? 'mountainBike' : 'bicycle';
  const R = BIKE_DIMS.wheelRadius;
  const tyreW = opt.mtb ? 0.052 : 0.03;
  const rearAxle = V(0, R, -BIKE_DIMS.wheelbase / 2);
  const frontAxle = V(0, R, BIKE_DIMS.wheelbase / 2);
  const bb = BIKE_DIMS.bottomBracket.clone();
  const seatCluster = V(0, 0.8, -0.24);
  const headTop = V(0, 0.93, 0.33);
  const headBottom = V(0, 0.73, 0.385);
  const tr = opt.mtb ? 0.026 : 0.018;

  // ---- Frame (static, merged) ----
  const frame = new THREE.Group();
  frame.add(tube(bb, seatCluster, tr, m.paint));
  frame.add(tube(seatCluster, headTop.clone().add(V(0, -0.035, 0.01)), tr * 0.95, m.paint, tr * 0.9));
  frame.add(tube(bb, headBottom, tr * 1.25, m.paint, tr * 1.05));
  frame.add(tube(headBottom.clone().add(V(0, -0.02, 0.01)), headTop.clone().add(V(0, 0.015, -0.004)), tr * 1.25, m.accent));
  frame.add(joint(bb, tr * 1.5, m.paint));
  frame.add(joint(seatCluster, tr * 1.1, m.paint));
  frame.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 12).rotateZ(Math.PI / 2).translate(bb.x, bb.y, bb.z), m.dark));
  for (const x of [0.055, -0.055]) {
    frame.add(tube(bb.clone().setX(x * 0.6), rearAxle.clone().setX(x), tr * 0.62, m.paint, tr * 0.5));
    frame.add(tube(seatCluster.clone().add(V(x * 0.4, -0.02, -0.01)), rearAxle.clone().setX(x), tr * 0.5, m.paint, tr * 0.45));
    frame.add(joint(rearAxle.clone().setX(x), tr * 0.6, m.dark));
  }
  // Decal bands in the secondary colour.
  for (const t of [0.35, 0.62]) {
    const p = bb.clone().lerp(headBottom, t);
    frame.add(tube(p.clone().addScaledVector(headBottom.clone().sub(bb).normalize(), -0.02), p, tr * 1.32, m.accent));
  }
  // Seatpost + saddle.
  // Sized for the rider's ~0.94 m legs: near-full extension at the bottom of the stroke.
  const postTop = seatCluster.clone().add(V(0, 0.22, -0.075));
  frame.add(tube(seatCluster, postTop, 0.014, m.metal));
  frame.add(joint(seatCluster.clone().add(V(0, 0.01, 0)), 0.02, m.dark));
  mergeByMaterial(frame);
  root.add(frame);
  const sad = saddle(m.dark, m.metal);
  sad.position.copy(postTop);
  root.add(sad);
  const seat = new THREE.Object3D();
  seat.name = 'seat';
  seat.position.copy(postTop).add(V(0, 0.06, -0.02));
  root.add(seat);

  // ---- Drivetrain ----
  const cas = cassette(m);
  cas.position.copy(rearAxle);
  root.add(cas);
  const ringR = 0.085;
  root.add(chain(bb, rearAxle, ringR + 0.003, 0.05, -0.062, m.metal));
  const derailleur = new THREE.Group();
  derailleur.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.03), m.dark));
  for (const y of [-0.025, -0.07]) {
    const pulley = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 10).rotateZ(Math.PI / 2), m.metal);
    pulley.position.y = y;
    derailleur.add(pulley);
  }
  derailleur.position.copy(rearAxle).add(V(-0.065, -0.05, 0.01));
  mergeByMaterial(derailleur);
  root.add(derailleur);

  // ---- Wheels ----
  const wr = wheel(R, tyreW, opt.mtb, m, true);
  wr.name = 'wheelRear';
  wr.position.copy(rearAxle);
  root.add(wr);

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
  const crownL = L(headBottom.clone().add(V(0, -0.02, 0)));
  if (opt.mtb) {
    steer.add(new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.035, 0.05).translate(crownL.x, crownL.y, crownL.z), m.accent));
    for (const x of [0.07, -0.07]) {
      const top = crownL.clone().setX(x);
      const mid = L(headBottom.clone().lerp(frontAxle, 0.5)).setX(x);
      steer.add(tube(top, mid, 0.018, m.chrome));
      forkSlider.add(tube(L(headBottom.clone().lerp(frontAxle, 0.38)).setX(x), L(frontAxle).setX(x), 0.024, m.dark, 0.022));
    }
    const arch = L(headBottom.clone().lerp(frontAxle, 0.42));
    forkSlider.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.03).translate(arch.x, arch.y, arch.z + 0.02), m.dark));
  } else {
    for (const x of [0.055, -0.055]) steer.add(tube(crownL.clone().setX(x * 0.6), L(frontAxle).setX(x), 0.016, m.paint, 0.01));
    steer.add(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.045).translate(crownL.x, crownL.y, crownL.z), m.paint));
  }
  // Front brake caliper.
  const cal = L(frontAxle).add(V(-0.065, 0.05, -0.04));
  forkSlider.add(new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.05, 0.035).translate(cal.x, cal.y, cal.z), m.dark));
  mergeByMaterial(forkSlider);
  const wf = wheel(R, tyreW, opt.mtb, m, true);
  wf.name = 'wheelFront';
  wf.position.copy(L(frontAxle));
  forkSlider.add(wf);

  // Stem + riser bar + grips + levers.
  // Tall stem + riser bar: the rider's arms are short, so the bars come up and back.
  const stemEnd = L(V(0, 1.08, 0.35));
  steer.add(tube(L(headTop), stemEnd, 0.017, m.dark));
  const barW = opt.mtb ? 0.38 : 0.3;
  const barY = stemEnd.y + (opt.mtb ? 0.045 : 0.03);
  for (const s of [1, -1]) {
    steer.add(tube(stemEnd, V(barW * 0.45 * s, barY, stemEnd.z - 0.01), 0.011, m.dark));
    steer.add(tube(V(barW * 0.45 * s, barY, stemEnd.z - 0.01), V(barW * s, barY + 0.01, stemEnd.z - 0.035), 0.011, m.dark));
    const grip = tube(V((barW - 0.11) * s, barY + 0.008, stemEnd.z - 0.03), V(barW * s, barY + 0.01, stemEnd.z - 0.035), 0.017, m.accent);
    steer.add(grip);
    steer.add(tube(V((barW - 0.13) * s, barY + 0.01, stemEnd.z - 0.025), V((barW - 0.06) * s, barY - 0.01, stemEnd.z + 0.06), 0.005, m.metal));
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
    arm.add(tube(V(0.075 * side, 0, 0), V(0.085 * side, 0, BIKE_DIMS.crankLength), 0.011, m.dark, 0.009, 6));
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
