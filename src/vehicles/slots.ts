import { WINGSUIT_RULES } from '../config/gameplay';
import type { BiomeId } from '../config/maps';
import { VEHICLE_IDS, VEHICLES, type VehicleId } from '../config/vehicles';

export interface VehicleSlot {
  id: VehicleId;
  enabled: boolean;
  /** Why the slot is disabled ("Snow only", "Locked"). */
  reason?: string;
}

/**
 * Which vehicles can be picked right now: biome rules, the wingsuit's altitude rule (`height` =
 * metres above the ground, 0 when grounded) and unlocks (gating arrives with progression).
 */
export function vehicleSlots(biome: BiomeId, height = 0, unlocked: (id: VehicleId) => boolean = () => true): VehicleSlot[] {
  return VEHICLE_IDS.map((id) => {
    if (!unlocked(id)) return { id, enabled: false, reason: 'Locked' };
    if (VEHICLES[id].snowOnly && biome !== 'snow') return { id, enabled: false, reason: 'Snow only' };
    if (id === 'wingsuit' && height < WINGSUIT_RULES.wheelMinHeight) return { id, enabled: false, reason: 'Need altitude' };
    return { id, enabled: true };
  });
}
