import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { ModelOptions } from '../models/ModelLoader';
import { Bicycle } from './Bicycle';
import type { TransferState } from './Vehicle';

/** Mountain bike: the bicycle with longer, softer suspension and better rough-ground grip (see config). */
export class MountainBike extends Bicycle {
  constructor(physics: PhysicsWorld, state: TransferState, paint: ModelOptions = { primary: '#3ec8ff', secondary: '#ffd23f' }) {
    super(physics, state, 'mountainBike', paint);
  }
}
