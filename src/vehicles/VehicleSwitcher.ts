import { SWITCH } from '../config/gameplay';
import { MAPS, type BiomeId } from '../config/maps';
import { VEHICLES, type VehicleId } from '../config/vehicles';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { World } from '../world/World';
import { createVehicle } from './factory';
import type { Vehicle } from './Vehicle';

export function mapBiome(world: World): BiomeId {
  return MAPS[world.mapId].biome;
}

/**
 * Builds the replacement vehicle at the old one's pose: same position and heading, velocity
 * clamped to the new top speed, and put back on the ground when the switch happened close to it.
 * The caller detaches the rider first; the old vehicle is disposed here.
 */
export function swapVehicle(old: Vehicle, id: VehicleId, physics: PhysicsWorld, world: World): Vehicle {
  const state = old.transfer();
  const next = VEHICLES[id];
  const max = next.topSpeed * SWITCH.velocityClamp;
  if (state.velocity.length() > max) state.velocity.setLength(max);
  const p = state.position;
  const ground = world.groundLocal(p.x, p.z);
  const clearance = p.y - ground - old.stats.rideHeight;
  const airborne = clearance > SWITCH.groundSnap;
  if (airborne) p.y += next.rideHeight - old.stats.rideHeight;
  else {
    p.y = ground + next.rideHeight + 0.15;
    // Don't drive the new body into the slope.
    if (state.velocity.y < 0) state.velocity.y *= 0.5;
  }
  // Build first so a failure leaves the old vehicle intact (vehicles never collide with each other).
  const v = createVehicle(id, physics, state);
  old.dispose(physics);
  v.onSwitchedIn(airborne);
  return v;
}
