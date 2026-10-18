import { GOGGLES, OUTFIT_UNLOCKS, VEHICLE_UNLOCKS, type GogglesStyle, type ProgressView } from '../config/progression';
import { OUTFIT_LABELS, type OutfitId } from '../config/riders';
import { VEHICLES, type VehicleId } from '../config/vehicles';
import type { Save } from '../core/Save';

export interface Unlock {
  kind: 'vehicle' | 'outfit' | 'goggles';
  id: string;
  name: string;
}

/** Unlock state from the save + the rules in config/progression.ts (and the unlock-all toggle). */
export class Progression {
  constructor(private readonly save: Save) {}

  private get view(): ProgressView {
    return this.save.data.progress;
  }

  get unlockAll(): boolean {
    return this.save.data.settings.unlockAll || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('unlockall'));
  }

  vehicleUnlocked(id: VehicleId): boolean {
    const rule = VEHICLE_UNLOCKS[id];
    return this.unlockAll || !rule || this.save.data.progress.unlockedVehicles.includes(id) || rule.test(this.view);
  }

  outfitUnlocked(id: OutfitId): boolean {
    const rule = OUTFIT_UNLOCKS[id];
    return this.unlockAll || !rule || this.save.data.progress.unlockedCosmetics.includes(`outfit:${id}`) || rule.test(this.view);
  }

  gogglesUnlocked(id: GogglesStyle): boolean {
    const g = GOGGLES.find((x) => x.id === id);
    return this.unlockAll || !g?.unlock || this.save.data.progress.unlockedCosmetics.includes(`goggles:${id}`) || g.unlock.test(this.view);
  }

  /**
   * Record anything newly earned (call after the progress changes: a finish, a token) and
   * return it for the pop-ups. Unlocks are stored, so they stay even if a rule changes.
   */
  collectNew(): Unlock[] {
    const p = this.save.data.progress;
    const out: Unlock[] = [];
    for (const [id, rule] of Object.entries(VEHICLE_UNLOCKS) as [VehicleId, NonNullable<(typeof VEHICLE_UNLOCKS)[VehicleId]>][]) {
      if (!p.unlockedVehicles.includes(id) && rule.test(this.view)) {
        p.unlockedVehicles.push(id);
        out.push({ kind: 'vehicle', id, name: VEHICLES[id].name });
      }
    }
    for (const [id, rule] of Object.entries(OUTFIT_UNLOCKS) as [OutfitId, NonNullable<(typeof OUTFIT_UNLOCKS)[OutfitId]>][]) {
      const key = `outfit:${id}`;
      if (!p.unlockedCosmetics.includes(key) && rule.test(this.view)) {
        p.unlockedCosmetics.push(key);
        out.push({ kind: 'outfit', id, name: `${OUTFIT_LABELS[id]} outfit` });
      }
    }
    for (const g of GOGGLES) {
      const key = `goggles:${g.id}`;
      if (g.unlock && !p.unlockedCosmetics.includes(key) && g.unlock.test(this.view)) {
        p.unlockedCosmetics.push(key);
        out.push({ kind: 'goggles', id: g.id, name: g.label });
      }
    }
    if (out.length) this.save.write();
    return out;
  }
}
