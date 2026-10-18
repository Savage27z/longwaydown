import type { VehicleId } from '../config/vehicles';
import type { ModelOptions } from '../models/ModelLoader';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { Bicycle } from './Bicycle';
import { Roadster } from './Roadster';
import { Buggy } from './Buggy';
import { FlyingCar } from './FlyingCar';
import { Motorbike } from './Motorbike';
import { MountainBike } from './MountainBike';
import { OnFoot } from './OnFoot';
import { Skis } from './Skis';
import { Snowboard } from './Snowboard';
import type { TransferState, Vehicle } from './Vehicle';
import { Wingsuit } from './Wingsuit';

/** Create a vehicle by id (optionally in a rider's paint). New vehicles register here. */
export function createVehicle(id: VehicleId, physics: PhysicsWorld, state: TransferState, paint?: ModelOptions): Vehicle {
  switch (id) {
    case 'bicycle':
      return new Bicycle(physics, state, 'bicycle', paint);
    case 'mountainBike':
      return new MountainBike(physics, state, paint);
    case 'motorbike':
      return new Motorbike(physics, state, paint);
    case 'car':
      return new Buggy(physics, state, paint);
    case 'roadster':
      return new Roadster(physics, state, paint);
    case 'flyingCar':
      return new FlyingCar(physics, state, paint);
    case 'snowboard':
      return new Snowboard(physics, state, paint);
    case 'skis':
      return new Skis(physics, state, paint);
    case 'wingsuit':
      return new Wingsuit(physics, state);
    case 'onFoot':
      return new OnFoot(physics, state);
  }
}
