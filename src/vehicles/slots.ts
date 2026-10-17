import type { BiomeId } from '../config/maps';
import { VEHICLE_IDS, VEHICLES, type VehicleId } from '../config/vehicles';

export interface VehicleSlot {
  id: VehicleId;
  enabled: boolean;
  /** Why the slot is disabled ("Snow only", "Locked"). */
  reason?: string;
}

/** Which vehicles can be picked on this map (biome rules; unlock gating arrives with progression). */
export function vehicleSlots(biome: BiomeId, unlocked: (id: VehicleId) => boolean = () => true): VehicleSlot[] {
  return VEHICLE_IDS.map((id) => {
    if (!unlocked(id)) return { id, enabled: false, reason: 'Locked' };
    if (VEHICLES[id].snowOnly && biome !== 'snow') return { id, enabled: false, reason: 'Snow only' };
    return { id, enabled: true };
  });
}
