import * as THREE from 'three';
import { MAPS, type MapId } from '../config/maps';
import { COLLECTIBLES, STATIONS } from '../config/progression';
import { VEHICLES, type VehicleId } from '../config/vehicles';
import type { PlayerController } from '../player/PlayerController';
import { makeRng } from '../utils/rng';
import type { World } from './World';

interface Token {
  key: string;
  pos: THREE.Vector3;
  obj: THREE.Group | null;
  found: boolean;
}

interface Station {
  vehicle: VehicleId;
  s: number;
  pos: THREE.Vector3;
  heading: number;
  obj: THREE.Group | null;
  used: boolean;
}

/** What each map's stations lend (in course order); snow-only ones only on snow. */
const STATION_VEHICLES: Record<MapId, VehicleId[]> = {
  snowPeak: ['snowboard', 'motorbike', 'roadster'],
  greenRidge: ['motorbike', 'car', 'flyingCar'],
};

const _p = new THREE.Vector3();
const DRAW = 260;

/**
 * Exploration and borrowing, for the local rider:
 * - hidden tokens well off the trail (each found once, ever; saved as `${map}:${k}`);
 * - vehicle stations across the trail that lend a vehicle for the rest of the run.
 */
export class Secrets {
  readonly tokens: Token[] = [];
  readonly stations: Station[] = [];
  onToken: ((key: string) => void) | null = null;
  onStation: ((vehicle: VehicleId) => void) | null = null;
  private tokenGeo = new THREE.OctahedronGeometry(0.75, 0);
  private beamGeo = new THREE.CylinderGeometry(0.35, 0.35, 60, 8, 1, true).translate(0, 30, 0);
  private tokenMat = new THREE.MeshStandardMaterial({ color: '#ffcf3a', emissive: '#b37a00', emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.25 });
  private beamMat = new THREE.MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  private own: { dispose(): void }[] = [];
  private time = 0;

  constructor(
    world: World,
    private readonly parent: THREE.Object3D,
    found: (key: string) => boolean,
  ) {
    const c = world.course;
    const map = MAPS[world.mapId];
    const rng = makeRng(`secrets:${world.mapId}`);
    const landed = c.sectionStart[Math.min(c.sectionStart.length - 1, map.launch.sections - 1)] ?? 0;
    const from = landed + 300;
    const span = c.length - 500 - from;
    for (let k = 0; k < COLLECTIBLES.perMap; k++) {
      // One per stretch so they spread down the whole mountain.
      const s = from + span * ((k + 0.2 + rng() * 0.6) / COLLECTIBLES.perMap);
      const lat = (rng() < 0.5 ? -1 : 1) * (COLLECTIBLES.offMin + rng() * (COLLECTIBLES.offMax - COLLECTIBLES.offMin));
      const pos = new THREE.Vector3();
      world.courseAt(s, lat, pos);
      pos.y += 1.3;
      const key = `${world.mapId}:${k}`;
      this.tokens.push({ key, pos, obj: null, found: found(key) });
    }
    STATIONS.at.forEach((f, k) => {
      const vehicle = STATION_VEHICLES[world.mapId as MapId][k];
      if (!vehicle || (VEHICLES[vehicle].snowOnly && map.biome !== 'snow')) return;
      let s = Math.max(from, c.length * f);
      // Keep clear of jump lips and landings.
      const near = c.features.find((x) => Math.abs(x.s - s) < 60);
      if (near) s = near.s + 60;
      const pos = new THREE.Vector3();
      const heading = world.courseAt(s, 0, pos);
      this.stations.push({ vehicle, s, pos, heading, obj: null, used: false });
    });
  }

  /** New run: stations lend again (tokens stay found). */
  reset(): void {
    for (const st of this.stations) st.used = false;
  }

  private buildToken(t: Token): THREE.Group {
    const g = new THREE.Group();
    const gem = new THREE.Mesh(this.tokenGeo, this.tokenMat);
    gem.name = 'gem';
    g.add(gem);
    g.add(new THREE.Mesh(this.beamGeo, this.beamMat));
    g.position.copy(t.pos);
    this.parent.add(g);
    return g;
  }

  private buildStation(st: Station): THREE.Group {
    const g = new THREE.Group();
    const post = new THREE.MeshLambertMaterial({ color: '#20262e' });
    const accent = new THREE.MeshLambertMaterial({ color: '#ff5a1f' });
    const half = STATIONS.radius;
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), post);
      p.position.set(side * half, 3, 0);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.46), accent);
      band.position.set(side * half, 1.2, 0);
      g.add(p, band);
    }
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 96;
    const x = cv.getContext('2d')!;
    x.fillStyle = '#ff5a1f';
    x.fillRect(0, 0, 512, 96);
    x.fillStyle = '#ffffff';
    x.font = 'bold 30px sans-serif';
    x.textAlign = 'center';
    x.fillText('VEHICLE STATION', 256, 38);
    x.font = 'bold 34px sans-serif';
    x.fillText(VEHICLES[st.vehicle].name.toUpperCase(), 256, 80);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const banner = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const b = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, (half * 2 * 96) / 512), banner);
    b.position.y = 5.4;
    b.rotation.y = Math.PI;
    g.add(b);
    g.position.copy(st.pos);
    g.rotation.y = st.heading;
    this.own.push(post, accent, banner, tex);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) this.own.push(m.geometry);
    });
    this.parent.add(g);
    return g;
  }

  update(dt: number, cameraGlobal: THREE.Vector3, rider: PlayerController | null): void {
    this.time += dt;
    const near = (p: THREE.Vector3) => Math.abs(p.x - cameraGlobal.x) < DRAW && Math.abs(p.z - cameraGlobal.z) < DRAW;
    for (const t of this.tokens) {
      const show = !t.found && near(t.pos);
      if (show && !t.obj) t.obj = this.buildToken(t);
      else if (!show && t.obj) {
        t.obj.removeFromParent();
        t.obj = null;
      }
      if (t.obj) {
        const gem = t.obj.getObjectByName('gem')!;
        gem.rotation.y = this.time * 2;
        gem.position.y = Math.sin(this.time * 2.5) * 0.2;
        t.obj.updateMatrixWorld(true);
      }
    }
    for (const st of this.stations) {
      const show = near(st.pos);
      if (show && !st.obj) st.obj = this.buildStation(st);
      else if (!show && st.obj) {
        st.obj.removeFromParent();
        st.obj = null;
      }
    }
    if (!rider || rider.state !== 'riding') return;
    rider.globalPosition(_p);
    for (const t of this.tokens) {
      if (t.found || _p.distanceTo(t.pos) > COLLECTIBLES.radius) continue;
      t.found = true;
      this.onToken?.(t.key);
    }
    const s = rider.progress.result.s;
    for (const st of this.stations) {
      if (st.used || Math.abs(st.s - s) > 2.5 || Math.abs(rider.progress.result.lat) > STATIONS.radius + 1) continue;
      st.used = true;
      this.onStation?.(st.vehicle);
    }
  }

  dispose(): void {
    for (const t of this.tokens) t.obj?.removeFromParent();
    for (const st of this.stations) st.obj?.removeFromParent();
    this.tokenGeo.dispose();
    this.beamGeo.dispose();
    this.tokenMat.dispose();
    this.beamMat.dispose();
    for (const o of this.own) o.dispose();
  }
}
