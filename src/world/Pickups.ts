import * as THREE from 'three';
import { MAPS, type MapId } from '../config/maps';
import { PICKUP_STYLE, PICKUPS, type PickupKind } from '../config/stunts';
import type { PlayerController } from '../player/PlayerController';
import { makeRng } from '../utils/rng';
import type { World } from './World';

interface Pickup {
  kind: PickupKind;
  s: number;
  lat: number;
  pos: THREE.Vector3;
  obj: THREE.Group | null;
  phase: number;
  /** Collected by the local rider (hidden for them). */
  taken: boolean;
}

export interface PickupRider {
  id: string;
  rider: PlayerController;
  local: boolean;
}

const _p = new THREE.Vector3();

/**
 * Glowing pickups along the trail (boost refills and buffs). Every rider collects each pickup
 * once per run; the local rider's collected ones disappear for them. Placed deterministically
 * per map, clear of jump lips.
 */
export class Pickups {
  readonly list: Pickup[] = [];
  private collected = new Map<string, Set<number>>();
  private parts = new Map<PickupKind, { orb: THREE.Material; ring: THREE.Material; icon: THREE.SpriteMaterial }>();
  private orbGeo = new THREE.SphereGeometry(0.6, 18, 14);
  private ringGeo = new THREE.TorusGeometry(1.05, 0.08, 6, 32);
  private time = 0;

  constructor(
    world: World,
    private readonly parent: THREE.Object3D,
  ) {
    const c = world.course;
    const rng = makeRng(`pickups:${world.mapId}`);
    const kinds = Object.entries(PICKUPS.weights) as [PickupKind, number][];
    const total = kinds.reduce((a, [, w]) => a + w, 0);
    const pick = () => {
      let r = rng() * total;
      for (const [k, w] of kinds) if ((r -= w) <= 0) return k;
      return 'boost';
    };
    // Start where riders are back on the ground: after the wingsuit glide off the summit.
    const map = MAPS[world.mapId as MapId];
    const landed = c.sectionStart[Math.min(c.sectionStart.length - 1, map.launch.sections - 1)] ?? 0;
    let slot = 0;
    for (let s = Math.max(PICKUPS.firstS, landed + 200); s < c.length - PICKUPS.endGap; s += PICKUPS.spacing * (0.85 + rng() * 0.3)) {
      // Jump zones: push the pair past the landing instead of dropping it.
      const f = c.features.find((x) => Math.abs(x.s - s) < PICKUPS.featureClear);
      if (f) s = f.s + PICKUPS.featureClear;
      // A pair across the trail, one each side, so you choose your line; every third pair
      // carries a bottle crate so everyone has ammo early and often.
      const kindsHere: PickupKind[] = [slot % 3 === 1 ? 'bottle' : pick(), pick()];
      if (rng() < 0.5) kindsHere.reverse();
      [-1, 1].forEach((side, k) => {
        const lat = side * PICKUPS.pairLat + (rng() - 0.5) * 0.8;
        const pos = new THREE.Vector3();
        world.courseAt(s, lat, pos);
        pos.y += 1.4;
        this.list.push({ kind: kindsHere[k]!, s, lat, pos, obj: null, phase: rng() * Math.PI * 2, taken: false });
      });
      slot++;
    }
  }

  /** New run: everyone can collect everything again. */
  reset(): void {
    this.collected.clear();
    for (const p of this.list) {
      p.taken = false;
      if (p.obj) p.obj.visible = true;
    }
  }

  private material(kind: PickupKind) {
    let m = this.parts.get(kind);
    if (!m) {
      const st = PICKUP_STYLE[kind];
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const x = cv.getContext('2d')!;
      x.fillStyle = '#ffffff';
      x.font = 'bold 44px sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(st.glyph, 32, 35);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      m = {
        orb: new THREE.MeshBasicMaterial({ color: st.color, transparent: true, opacity: 0.8 }),
        ring: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }),
        icon: new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
      };
      this.parts.set(kind, m);
    }
    return m;
  }

  private build(p: Pickup): THREE.Group {
    const m = this.material(p.kind);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.orbGeo, m.orb));
    const ring = new THREE.Mesh(this.ringGeo, m.ring);
    ring.name = 'ring';
    g.add(ring);
    const icon = new THREE.Sprite(m.icon);
    icon.scale.setScalar(0.95);
    icon.renderOrder = 3;
    g.add(icon);
    g.position.copy(p.pos);
    g.visible = !p.taken;
    this.parent.add(g);
    return g;
  }

  /**
   * Per frame: stream the visuals near the camera (global position), animate them, and let
   * riders collect. Ghost riders collect by passing the pickup's spot on the line.
   */
  update(dt: number, cameraGlobal: THREE.Vector3, riders: PickupRider[]): void {
    this.time += dt;
    const range = PICKUPS.drawRange;
    for (const p of this.list) {
      const near = Math.abs(p.pos.x - cameraGlobal.x) < range && Math.abs(p.pos.z - cameraGlobal.z) < range;
      if (near && !p.obj) p.obj = this.build(p);
      else if (!near && p.obj) {
        p.obj.removeFromParent();
        p.obj = null;
      }
      if (p.obj?.visible) {
        p.obj.position.y = p.pos.y + Math.sin(this.time * 2 + p.phase) * 0.18;
        p.obj.getObjectByName('ring')!.rotation.set(Math.PI / 2 + Math.sin(this.time + p.phase) * 0.4, this.time * 1.6, 0);
        p.obj.updateMatrixWorld(true);
      }
    }
    for (const r of riders) {
      let got = this.collected.get(r.id);
      if (!got) this.collected.set(r.id, (got = new Set()));
      const rider = r.rider;
      if (rider.state !== 'riding') continue;
      const s = rider.progress.result.s;
      if (!rider.ghost) rider.globalPosition(_p);
      this.list.forEach((p, i) => {
        if (got!.has(i) || Math.abs(p.s - s) > 8) return;
        const hit = rider.ghost ? Math.abs(p.lat - rider.progress.result.lat) < 3 && Math.abs(p.s - s) < 3 : _p.distanceTo(p.pos) < PICKUPS.radius;
        if (!hit) return;
        got!.add(i);
        rider.perks.pickup(p.kind);
        if (r.local) {
          p.taken = true;
          if (p.obj) p.obj.visible = false;
        }
      });
    }
  }

  dispose(): void {
    for (const p of this.list) p.obj?.removeFromParent();
    this.orbGeo.dispose();
    this.ringGeo.dispose();
    for (const m of this.parts.values()) {
      m.orb.dispose();
      m.ring.dispose();
      m.icon.map?.dispose();
      m.icon.dispose();
    }
  }
}
