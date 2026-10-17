import type { VehicleId } from '../config/vehicles';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { Bicycle } from './Bicycle';
import { Buggy } from './Buggy';
import { FlyingCar } from './FlyingCar';
import { Motorbike } from './Motorbike';
import { MountainBike } from './MountainBike';
import { OnFoot } from './OnFoot';
import { Skis } from './Skis';
import { Snowboard } from './Snowboard';
import type { TransferState, Vehicle } from './Vehicle';
import { Wingsuit } from './Wingsuit';

/** Create a vehicle by id. New vehicles register here. */
export function createVehicle(id: VehicleId, physics: PhysicsWorld, state: TransferState): Vehicle {
  switch (id) {
    case 'bicycle':
      return new Bicycle(physics, state);
    case 'mountainBike':
      return new MountainBike(physics, state);
    case 'motorbike':
      return new Motorbike(physics, state);
    case 'car':
      return new Buggy(physics, state);
    case 'flyingCar':
      return new FlyingCar(physics, state);
    case 'snowboard':
      return new Snowboard(physics, state);
    case 'skis':
      return new Skis(physics, state);
    case 'wingsuit':
      return new Wingsuit(physics, state);
    case 'onFoot':
      return new OnFoot(physics, state);
  }
}
