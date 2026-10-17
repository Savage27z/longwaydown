/**
 * Lazy Rapier loader. The WASM (inlined as base64 by the -compat build) lives in its own chunk
 * and is only fetched behind the loading screen. Modules call `R()` at runtime after boot.
 */
import type * as RapierNS from '@dimforge/rapier3d-compat';

export type Rapier = typeof RapierNS;
export type { RapierNS };

let rapier: Rapier | null = null;

export async function loadRapier(): Promise<Rapier> {
  if (rapier) return rapier;
  const mod = await import('@dimforge/rapier3d-compat');
  await mod.init();
  rapier = mod;
  return mod;
}

export function R(): Rapier {
  if (!rapier) throw new Error('Rapier used before loadRapier() resolved');
  return rapier;
}
