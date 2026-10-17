import * as THREE from 'three';

/**
 * Bicycle / mountain bike. Origin on the ground between the wheels, +Z forward.
 * Named nodes used by the vehicle: wheelFront, wheelRear, steer, crank, pedalL, pedalR,
 * seat, gripL, gripR, forkSlider.
 */
export interface BikeOptions {
  mtb: boolean;
  primary: string;
  secondary: string;
}

export const BIKE_DIMS = {
  wheelRadius: 0.34,
  wheelbase: 1.1,
  crankLength: 0.17,
  bottomBracket: new THREE.Vector3(0, 0.3, -0.08),
};

function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}

function wheel(radius: number, tyre: number, tyreMat: THREE.Material, rimMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.TorusGeometry(radius - tyre, tyre, 6, 18), tyreMat);
  t.rotation.y = Math.PI / 2;
  t.castShadow = true;
  g.add(t);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius - tyre * 2.1, 0.012, 4, 18), rimMat);
  rim.rotation.y = Math.PI / 2;
  g.add(rim);
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.008, (radius - tyre * 2) * 2, 0.012), rimMat);
    s.rotation.x = (i / 6) * Math.PI;
    g.add(s);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 6), rimMat);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  return g;
}

export function buildBicycle(opt: BikeOptions): THREE.Group {
  const root = new THREE.Group();
  root.name = opt.mtb ? 'mountainBike' : 'bicycle';
  const paint = new THREE.MeshLambertMaterial({ color: opt.primary, flatShading: true });
  const accent = new THREE.MeshLambertMaterial({ color: opt.secondary, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: '#22262c', flatShading: true });
  const metal = new THREE.MeshLambertMaterial({ color: '#b8c0c8', flatShading: true });
  paint.name = 'paint:primary';
  accent.name = 'paint:secondary';

  const R = BIKE_DIMS.wheelRadius;
  const tyre = opt.mtb ? 0.055 : 0.035;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const rearAxle = V(0, R, -BIKE_DIMS.wheelbase / 2);
  const frontAxle = V(0, R, BIKE_DIMS.wheelbase / 2);
  const bb = BIKE_DIMS.bottomBracket.clone();
  const seatTop = V(0, 0.84, -0.27);
  const headTop = V(0, 0.9, 0.35);
  const headBottom = V(0, 0.7, 0.41);
  const tr = opt.mtb ? 0.032 : 0.022;

  const frame = new THREE.Group();
  frame.name = 'frame';
  frame.add(tube(bb, seatTop, tr, paint));
  frame.add(tube(seatTop.clone().add(V(0, -0.03, 0.02)), headTop, tr, paint));
  frame.add(tube(bb, headBottom, tr * 1.15, paint));
  frame.add(tube(headBottom, headTop, tr * 1.2, accent));
  for (const x of [0.05, -0.05]) {
    frame.add(tube(bb.clone().setX(x), rearAxle.clone().setX(x), tr * 0.6, paint));
    frame.add(tube(seatTop.clone().add(V(x, -0.04, 0)), rearAxle.clone().setX(x), tr * 0.6, paint));
  }
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.26), dark);
  saddle.position.copy(seatTop).add(V(0, 0.06, -0.02));
  frame.add(saddle);
  frame.add(tube(seatTop, saddle.position, 0.014, metal));
  const seat = new THREE.Object3D();
  seat.name = 'seat';
  seat.position.copy(saddle.position).add(V(0, 0.04, 0));
  frame.add(seat);
  root.add(frame);

  const wr = wheel(R, tyre, dark, metal);
  wr.name = 'wheelRear';
  wr.position.copy(rearAxle);
  root.add(wr);

  // Steering assembly pivots around the head tube axis.
  const steer = new THREE.Group();
  steer.name = 'steer';
  steer.position.copy(headBottom);
  const axis = headTop.clone().sub(headBottom).normalize();
  steer.userData.axis = axis;
  root.add(steer);
  const local = (v: THREE.Vector3) => v.clone().sub(headBottom);
  const forkSlider = new THREE.Group();
  forkSlider.name = 'forkSlider';
  steer.add(forkSlider);
  for (const x of [0.06, -0.06]) {
    if (opt.mtb) {
      steer.add(tube(local(headBottom).setX(x), local(headBottom.clone().lerp(frontAxle, 0.45)).setX(x), 0.024, accent));
      forkSlider.add(tube(local(headBottom.clone().lerp(frontAxle, 0.4)).setX(x), local(frontAxle).setX(x), 0.017, metal));
    } else {
      steer.add(tube(local(headBottom).setX(x), local(frontAxle).setX(x), 0.014, paint));
    }
  }
  const wf = wheel(R, tyre, dark, metal);
  wf.name = 'wheelFront';
  wf.position.copy(local(frontAxle));
  forkSlider.add(wf);
  const stemTop = V(0, 1.0, 0.31);
  steer.add(tube(local(headTop), local(stemTop), 0.016, dark));
  const barW = opt.mtb ? 0.36 : 0.3;
  steer.add(tube(local(stemTop).setX(barW), local(stemTop).setX(-barW), 0.014, dark));
  for (const [name, x] of [['gripL', barW - 0.05], ['gripR', -(barW - 0.05)]] as const) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), accent);
    grip.rotation.z = Math.PI / 2;
    grip.position.copy(local(stemTop)).setX(x);
    steer.add(grip);
    const marker = new THREE.Object3D();
    marker.name = name;
    marker.position.copy(grip.position);
    steer.add(marker);
  }

  // Crank + pedals (pedals counter-rotate to stay level).
  const crank = new THREE.Group();
  crank.name = 'crank';
  crank.position.copy(bb);
  root.add(crank);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.015, 10), metal);
  ring.rotation.z = Math.PI / 2;
  ring.position.x = -0.06;
  crank.add(ring);
  for (const [name, side, phase] of [['pedalL', 1, 0], ['pedalR', -1, Math.PI]] as const) {
    const arm = new THREE.Group();
    arm.rotation.x = phase;
    crank.add(arm);
    const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, BIKE_DIMS.crankLength), metal);
    armMesh.position.set(0.08 * side, 0, BIKE_DIMS.crankLength / 2);
    arm.add(armMesh);
    const pedal = new THREE.Group();
    pedal.name = name;
    pedal.position.set(0.12 * side, 0, BIKE_DIMS.crankLength);
    arm.add(pedal);
    const pm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.07), dark);
    pedal.add(pm);
  }
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return root;
}
