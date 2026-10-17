import * as THREE from 'three';
import type { VehicleId } from '../config/vehicles';
import { buildBicycle } from './procedural/bicycle';
import { buildMotorbike } from './procedural/motorbike';
import { buildBuggy } from './procedural/buggy';
import { buildHoverCar } from './procedural/flyers';
import { buildSkis, buildSnowboard } from './procedural/boards';
import { BONES, buildCharacterRig, MATERIAL_SLOTS, type BoneName, type CharacterRig, type MaterialSlot } from './procedural/character';

/**
 * The single entry point for models. Everything is procedural by default; to swap any model
 * for a .glb, register a URL (e.g. `registerGlb('vehicle:car', '/models/car.glb')`) and call
 * `preloadModels()` during loading. GLB files must use the same node names as the procedural
 * builders (wheels, pedals, bones...) so the gameplay code can find their parts.
 */
export type ModelId = 'character' | `vehicle:${VehicleId}`;

export interface ModelOptions {
  primary?: string;
  secondary?: string;
}

type Builder = (opt: Required<ModelOptions>) => THREE.Object3D;

const builders: Partial<Record<ModelId, Builder>> = {
  'vehicle:bicycle': (o) => buildBicycle({ mtb: false, primary: o.primary, secondary: o.secondary }),
  'vehicle:mountainBike': (o) => buildBicycle({ mtb: true, primary: o.primary, secondary: o.secondary }),
  'vehicle:motorbike': (o) => buildMotorbike(o.primary, o.secondary),
  'vehicle:car': (o) => buildBuggy(o.primary, o.secondary),
  'vehicle:flyingCar': (o) => buildHoverCar(o.primary, o.secondary),
  'vehicle:snowboard': (o) => buildSnowboard(o.primary, o.secondary),
  'vehicle:skis': (o) => buildSkis(o.primary, o.secondary),
};

const glbUrls: Partial<Record<ModelId, string>> = {};
const glbCache = new Map<ModelId, THREE.Object3D>();

export function registerBuilder(id: ModelId, builder: Builder): void {
  builders[id] = builder;
}

export function registerGlb(id: ModelId, url: string): void {
  glbUrls[id] = url;
}

/** Load any registered .glb overrides (call behind the loading screen). */
export async function preloadModels(): Promise<void> {
  const entries = Object.entries(glbUrls) as [ModelId, string][];
  if (entries.length === 0) return;
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  await Promise.all(
    entries.map(async ([id, url]) => {
      const gltf = await loader.loadAsync(url);
      gltf.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
      });
      glbCache.set(id, gltf.scene);
    }),
  );
}

/** Create a model instance (sync). Paint colours apply to materials named `paint:primary/secondary`. */
export function createModel(id: ModelId, opt: ModelOptions = {}): THREE.Object3D {
  const o: Required<ModelOptions> = { primary: opt.primary ?? '#ff5a1f', secondary: opt.secondary ?? '#1b2b40' };
  const cached = glbCache.get(id);
  if (cached) {
    const clone = cached.clone(true);
    applyPaint(clone, o);
    return clone;
  }
  const b = builders[id];
  if (!b) throw new Error(`No model builder for ${id}`);
  return b(o);
}

export function applyPaint(root: THREE.Object3D, o: ModelOptions): void {
  root.traverse((n) => {
    const m = (n as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
    if (!m || Array.isArray(m)) return;
    if (m.name === 'paint:primary' && o.primary) m.color.set(o.primary);
    if (m.name === 'paint:secondary' && o.secondary) m.color.set(o.secondary);
  });
}

let riderPack: THREE.Object3D | null = null;
let riderPackPromise: Promise<THREE.Object3D | null> | null = null;

/** Load the skinned rider pack (CC0 Quaternius outfits). Resolves null if unavailable. */
export function loadRiderPack(url: string): Promise<THREE.Object3D | null> {
  if (!riderPackPromise) {
    riderPackPromise = (async () => {
      try {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const gltf = await new GLTFLoader().loadAsync(url);
        riderPack = gltf.scene;
        return riderPack;
      } catch (e) {
        console.warn('[ModelLoader] rider pack unavailable, using procedural rider:', e);
        return null;
      }
    })();
  }
  return riderPackPromise;
}

export function getRiderPack(): THREE.Object3D | null {
  return riderPack;
}

/** Character rig: procedural, or a .glb with matching bone names and `slot:<name>` materials. */
export function createCharacterRig(): CharacterRig {
  const cached = glbCache.get('character');
  if (!cached) return buildCharacterRig();
  const root = cached.clone(true) as THREE.Group;
  const procedural = buildCharacterRig();
  const bones = {} as Record<BoneName, THREE.Object3D>;
  for (const b of BONES) bones[b] = root.getObjectByName(b) ?? procedural.bones[b];
  const materials = { ...procedural.materials };
  root.traverse((n) => {
    const m = (n as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
    if (!m || Array.isArray(m) || !m.name.startsWith('slot:')) return;
    const slot = m.name.slice(5) as MaterialSlot;
    if ((MATERIAL_SLOTS as readonly string[]).includes(slot)) materials[slot] = m;
  });
  return { root, bones, materials, slots: procedural.slots };
}
