import * as THREE from 'three';
import { BODY_TYPES, GOGGLES, OUTFIT_UNLOCKS, PALETTE, SKIN_TONES, VEHICLE_UNLOCKS } from '../config/progression';
import { OUTFIT_LABELS, OUTFITS, type OutfitId, type RiderColors, type RiderLook } from '../config/riders';
import { VEHICLE_IDS, VEHICLES, type VehicleId } from '../config/vehicles';
import type { Save } from '../core/Save';
import type { Progression } from '../gameplay/Progression';
import { createModel } from '../models/ModelLoader';
import { Character, makePose } from '../player/Character';
import { VEHICLE_ICONS } from './icons';

/** Vehicles that take paint (the wingsuit and running are the rider). */
const PAINTABLE = VEHICLE_IDS.filter((v) => v !== 'wingsuit');

const LOCK = '🔒';

function standPose() {
  const p = makePose();
  p.hips.set(0, 0.97, 0);
  p.footL.set(0.13, 0.08, 0.02);
  p.footR.set(-0.13, 0.08, 0.02);
  p.kneePole.set(0, 0.1, 1);
  p.mirrorPoles = true;
  p.elbowPole.set(0, -0.3, -1);
  p.armL.pitch = p.armR.pitch = 0.15;
  p.armL.spread = p.armR.spread = 0.25;
  p.armL.bend = p.armR.bend = 0.25;
  p.handL = null;
  p.handR = null;
  return p;
}

/**
 * Customize: rider (helmet, goggles, top, pants, shoes, gloves, backpack, skin, hair, body type)
 * and vehicle paint, with a live rotating 3D preview, locked items showing how to unlock them,
 * and Randomize. Everything saves as you change it.
 */
export function customizeScreen(save: Save, progression: Progression, onChange: () => void, onBack: () => void): { el: HTMLElement; dispose: () => void } {
  const el = document.createElement('div');
  el.className = 'menu-panel wide card customize';
  el.innerHTML = `<h2 class="menu-heading">Customize</h2>
    <div class="cz">
      <div class="cz-preview"><canvas></canvas><div class="cz-hint">Drag to turn</div></div>
      <div class="cz-side">
        <div class="cz-tabs"><button class="btn small primary" data-tab="rider"><span>Rider</span></button><button class="btn small" data-tab="vehicle"><span>Vehicle paint</span></button></div>
        <div class="cz-body"></div>
      </div>
    </div>
    <div class="row"><button class="btn small" data-random><span>Randomize</span></button><button class="btn small primary" data-back><span>Done</span></button></div>`;
  const body = el.querySelector('.cz-body') as HTMLDivElement;
  let tab: 'rider' | 'vehicle' = 'rider';
  let vehicle: VehicleId = 'bicycle';
  const look = (): RiderLook => save.data.look;
  const colors = (): RiderColors => (save.data.look.colors ??= {});

  // ---- 3D preview ----
  const canvas = el.querySelector('canvas') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#e6f0ff', '#5d6658', 1.4));
  const sun = new THREE.DirectionalLight('#fff4e2', 2.2);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.6, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#2a3442' }));
  scene.add(disc);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  const turn = new THREE.Group();
  scene.add(turn);
  let character: Character | null = null;
  let model: THREE.Object3D | null = null;
  let yaw = 0.5;
  let dragging = false;
  let lastX = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - lastX) * 0.01;
    lastX = e.clientX;
  });
  canvas.addEventListener('pointerup', () => (dragging = false));

  const rebuild = () => {
    if (character) {
      character.root.removeFromParent();
      character.dispose();
      character = null;
    }
    if (model) {
      model.removeFromParent();
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          for (const x of Array.isArray(m.material) ? m.material : [m.material]) x.dispose();
        }
      });
      model = null;
    }
    if (tab === 'rider') {
      character = new Character(look());
      character.update(1, standPose(), 1000);
      turn.add(character.root);
      camera.position.set(0, 1.15, 4.2);
      camera.lookAt(0, 0.95, 0);
    } else {
      model = createModel(`vehicle:${vehicle}`, save.paintFor(vehicle) ?? {});
      const box = new THREE.Box3().setFromObject(model);
      model.position.y = -box.min.y;
      turn.add(model);
      const size = box.getSize(new THREE.Vector3()).length();
      camera.position.set(0, size * 0.5, size * 1.6);
      camera.lookAt(0, size * 0.15, 0);
    }
  };

  let raf = 0;
  let last = performance.now();
  const frame = (t: number) => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (!dragging) yaw += dt * 0.35;
    turn.rotation.y = yaw;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w && h && (canvas.width !== Math.round(w * devicePixelRatio) || canvas.height !== Math.round(h * devicePixelRatio))) {
      renderer.setPixelRatio(devicePixelRatio);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const changed = (rebuildPreview = true) => {
    save.write();
    onChange();
    if (rebuildPreview) rebuild();
    render();
  };

  // ---- Controls ----
  const chips = <T extends string>(label: string, options: { id: T; label: string; locked?: string }[], current: T | undefined, pick: (id: T) => void) => {
    const row = document.createElement('div');
    row.className = 'cz-row';
    row.innerHTML = `<div class="cz-label">${label}</div><div class="cz-chips"></div>`;
    const box = row.querySelector('.cz-chips')!;
    for (const o of options) {
      const b = document.createElement('button');
      b.className = `chip${o.id === current ? ' on' : ''}${o.locked ? ' locked' : ''}`;
      b.innerHTML = o.locked ? `${LOCK} ${o.label}` : o.label;
      if (o.locked) b.title = o.locked;
      else b.addEventListener('click', () => pick(o.id));
      box.appendChild(b);
    }
    body.appendChild(row);
  };
  const swatches = (label: string, current: string | undefined, pick: (c: string | undefined) => void) => {
    const row = document.createElement('div');
    row.className = 'cz-row';
    row.innerHTML = `<div class="cz-label">${label}</div><div class="cz-swatches"></div>`;
    const box = row.querySelector('.cz-swatches')!;
    const def = document.createElement('button');
    def.className = `sw def${current ? '' : ' on'}`;
    def.title = 'Default';
    def.textContent = '∅';
    def.addEventListener('click', () => pick(undefined));
    box.appendChild(def);
    for (const c of PALETTE) {
      const b = document.createElement('button');
      b.className = `sw${current === c ? ' on' : ''}`;
      b.style.background = c;
      b.addEventListener('click', () => pick(c));
      box.appendChild(b);
    }
    const custom = document.createElement('input');
    custom.type = 'color';
    custom.value = current ?? '#ffffff';
    custom.title = 'Custom colour';
    custom.addEventListener('input', () => pick(custom.value));
    box.appendChild(custom);
    body.appendChild(row);
  };
  const outfitOptions = () =>
    OUTFITS.map((id) => ({ id, label: OUTFIT_LABELS[id], locked: progression.outfitUnlocked(id) ? undefined : OUTFIT_UNLOCKS[id]?.how }));
  const setColor = (k: keyof RiderColors) => (c: string | undefined) => {
    if (c) colors()[k] = c;
    else delete colors()[k];
    changed();
  };

  const render = () => {
    // Rebuilding drops focus: put it back on the same control (gamepad / keyboard use).
    const controls = () => [...body.querySelectorAll<HTMLElement>('button, input')];
    const focused = controls().indexOf(document.activeElement as HTMLElement);
    body.innerHTML = '';
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('primary', (b as HTMLElement).dataset.tab === tab));
    if (tab === 'rider') {
      const L = look();
      const C = colors();
      chips<OutfitId>('Helmet / head', outfitOptions(), L.head, (id) => ((L.head = id), changed()));
      swatches('Helmet colour', C.helmet, setColor('helmet'));
      chips('Goggles', GOGGLES.map((g) => ({ id: g.id, label: g.label, locked: progression.gogglesUnlocked(g.id) ? undefined : g.unlock?.how })), L.goggles ?? 'none', (id) => ((L.goggles = id), changed()));
      swatches('Lens tint', C.lens, setColor('lens'));
      chips<OutfitId>('Top', outfitOptions(), L.body, (id) => ((L.body = id), changed()));
      swatches('Top colour', C.top, setColor('top'));
      swatches('Top accent', C.top2, setColor('top2'));
      chips<OutfitId>('Pants', outfitOptions(), L.legs, (id) => ((L.legs = id), changed()));
      swatches('Pants colour', C.pants, setColor('pants'));
      chips<OutfitId>('Shoes / boots', outfitOptions(), L.feet, (id) => ((L.feet = id), changed()));
      swatches('Shoe colour', C.shoes, setColor('shoes'));
      chips('Gloves', [{ id: 'off', label: 'None' }, { id: 'on', label: 'Gloves' }], L.gloves ? 'on' : 'off', (id) => ((L.gloves = id === 'on'), changed()));
      swatches('Glove colour', C.gloves, setColor('gloves'));
      chips('Backpack', [{ id: 'off', label: 'None' }, { id: 'on', label: 'Backpack' }], L.backpack ? 'on' : 'off', (id) => ((L.backpack = id === 'on'), changed()));
      chips('Skin tone', [{ id: '-1', label: 'Default' }, ...SKIN_TONES.map((t, i) => ({ id: String(i), label: `<i class="tone" style="background:${t[0]}"></i>` }))], String(L.skin ?? -1), (id) => {
        const n = Number(id);
        if (n < 0) delete L.skin;
        else L.skin = n;
        changed();
      });
      swatches('Hair colour', C.hair, setColor('hair'));
      chips('Body type', BODY_TYPES.map((b) => ({ id: b.id, label: b.label })), L.bodyType ?? 'regular', (id) => ((L.bodyType = id), changed()));
    } else {
      chips(
        'Vehicle',
        PAINTABLE.map((id) => ({ id, label: `${VEHICLE_ICONS[id] ?? ''}<span>${VEHICLES[id].name}</span>`, locked: progression.vehicleUnlocked(id) ? undefined : VEHICLE_UNLOCKS[id]?.how })),
        vehicle,
        (id) => {
          vehicle = id;
          rebuild();
          render();
        },
      );
      const p = save.data.paint[vehicle];
      const setPaint = (key: 'primary' | 'secondary') => (c: string | undefined) => {
        const cur = save.data.paint[vehicle] ?? { primary: '', secondary: '' };
        cur[key] = c ?? '';
        if (!cur.primary && !cur.secondary) delete save.data.paint[vehicle];
        else save.data.paint[vehicle] = cur;
        changed();
      };
      swatches('Primary', p?.primary || undefined, setPaint('primary'));
      swatches('Secondary', p?.secondary || undefined, setPaint('secondary'));
    }
    if (focused >= 0) controls()[focused]?.focus({ preventScroll: true });
  };

  const randomize = () => {
    const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;
    const free = OUTFITS.filter((o) => progression.outfitUnlocked(o));
    const L = look();
    L.head = pick(free);
    L.body = pick(free);
    L.legs = pick(free);
    L.feet = pick(free);
    L.backpack = Math.random() < 0.4;
    L.gloves = Math.random() < 0.5;
    L.goggles = pick(GOGGLES.filter((g) => progression.gogglesUnlocked(g.id)).map((g) => g.id));
    L.skin = Math.floor(Math.random() * SKIN_TONES.length);
    L.bodyType = pick(BODY_TYPES).id;
    L.colors = { helmet: pick(PALETTE), top: pick(PALETTE), top2: pick(PALETTE), pants: pick(PALETTE), shoes: pick(PALETTE), gloves: pick(PALETTE), lens: pick(PALETTE) };
    if (tab === 'vehicle') save.data.paint[vehicle] = { primary: pick(PALETTE), secondary: pick(PALETTE) };
    changed();
  };

  el.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      tab = (b as HTMLElement).dataset.tab as typeof tab;
      rebuild();
      render();
    }),
  );
  el.querySelector('[data-random]')!.addEventListener('click', randomize);
  el.querySelector('[data-back]')!.addEventListener('click', onBack);
  rebuild();
  render();

  return {
    el,
    dispose() {
      cancelAnimationFrame(raf);
      if (character) character.dispose();
      model?.removeFromParent();
      disc.geometry.dispose();
      (disc.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}
