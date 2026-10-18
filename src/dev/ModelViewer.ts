import * as THREE from 'three';
import { createModel, type ModelId } from '../models/ModelLoader';

/**
 * Dev-only model contact sheet: renders vehicle models in isolation (no world, no physics) from
 * a few angles and saves the sheet through the dev server's /__shot endpoint.
 *   /src/dev/models.html?ids=motorbike,mountainBike&name=bikes&cell=420
 * Sets document.title to "done <path>" when the sheet is saved.
 */
const params = new URLSearchParams(location.search);
const ids = (params.get('ids') ?? 'bicycle,mountainBike,motorbike,snowboard,skis').split(',');
const name = params.get('name') ?? 'models';
const cell = Number(params.get('cell') ?? 420);
const ch = Math.round(cell * 0.72);
// yaw 0 = looking at the nose (+Z), pitch up from the ground.
const ANGLES: { yaw: number; pitch: number }[] = [
  { yaw: 0.75, pitch: 0.28 },
  { yaw: Math.PI / 2, pitch: 0.06 },
  { yaw: Math.PI - 0.7, pitch: 0.32 },
  { yaw: 0.35, pitch: 1.0 },
];

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(cell, ch);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#b9cfe2');
scene.add(new THREE.HemisphereLight('#dfeeff', '#5f6b52', 1.1));
const sun = new THREE.DirectionalLight('#fff3e0', 2.2);
sun.position.set(6, 10, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -4;
sc.right = sc.top = 4;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(12, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#8d9a78' }));
ground.receiveShadow = true;
scene.add(ground);
const camera = new THREE.PerspectiveCamera(32, cell / ch, 0.05, 100);

const sheet = document.createElement('canvas');
sheet.width = cell * ANGLES.length;
sheet.height = ch * ids.length;
const ctx = sheet.getContext('2d')!;
ctx.font = 'bold 15px sans-serif';

/** The paints the vehicles use in game (their constructor defaults). */
const PAINT: Record<string, { primary: string; secondary: string }> = {
  mountainBike: { primary: '#3ec8ff', secondary: '#ffd23f' },
  motorbike: { primary: '#ffd23f', secondary: '#1b2b40' },
  snowboard: { primary: '#3ec8ff', secondary: '#ff5a1f' },
  skis: { primary: '#ff4d6d', secondary: '#ffffff' },
  car: { primary: '#ff5a1f', secondary: '#20262e' },
  roadster: { primary: '#e3e5e8', secondary: '#3a3f47' },
};
const box = new THREE.Box3();
const centre = new THREE.Vector3();
const size = new THREE.Vector3();
ids.forEach((id, row) => {
  const model = createModel(`vehicle:${id}` as ModelId, PAINT[id] ?? {});
  // Cars sit with their origin at the body centre; everything else stands on its origin.
  box.setFromObject(model);
  model.position.y = -box.min.y;
  scene.add(model);
  box.setFromObject(model);
  box.getCenter(centre);
  box.getSize(size);
  const radius = size.length() / 2;
  const dist = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.95;
  ANGLES.forEach((a, col) => {
    camera.position.set(centre.x + Math.sin(a.yaw) * Math.cos(a.pitch) * dist, centre.y + Math.sin(a.pitch) * dist, centre.z + Math.cos(a.yaw) * Math.cos(a.pitch) * dist);
    camera.lookAt(centre);
    renderer.render(scene, camera);
    ctx.drawImage(renderer.domElement, col * cell, row * ch);
  });
  ctx.fillStyle = '#102030';
  ctx.fillText(id, 8, row * ch + 20);
  scene.remove(model);
});

fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: sheet.toDataURL('image/jpeg', 0.88) })
  .then((r) => (document.title = r.ok ? `done .shots/${name}.jpg` : `failed ${r.status}`))
  .catch((e) => (document.title = `failed ${String(e)}`));
