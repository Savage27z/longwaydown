import type { VehicleId } from '../config/vehicles';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { Bicycle } from './Bicycle';
import type { TransferState, Vehicle } from './Vehicle';

/** Create a vehicle by id. New vehicles register here. */
export function createVehicle(id: VehicleId, physics: PhysicsWorld, state: TransferState): Vehicle {
  switch (id) {
    case 'bicycle':
      return new Bicycle(physics, state, 'bicycle');
    case 'mountainBike':
      return new Bicycle(physics, state, 'mountainBike', { primary: '#3ec8ff', secondary: '#ffd23f' });
    default:
      // Remaining vehicles arrive in phase 5; fall back to the bicycle so nothing breaks.
      return new Bicycle(physics, state, 'bicycle');
  }
}
