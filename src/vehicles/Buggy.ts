import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { createModel, type ModelOptions } from '../models/ModelLoader';
import { BUGGY } from '../models/procedural/buggy';
import { ArcadeCar } from './ArcadeCar';
import type { TransferState } from './Vehicle';

/** Off-road buggy: grippy, drifts on the handbrake, soaks up rough ground. */
export class Buggy extends ArcadeCar {
  constructor(physics: PhysicsWorld, state: TransferState, paint: ModelOptions = { primary: '#ff5a1f', secondary: '#20262e' }) {
    super('car', physics, state, createModel('vehicle:car', paint), {
      wheels: [
        { name: 'wheelFL', x: BUGGY.wheelX, z: BUGGY.wheelZ, front: true },
        { name: 'wheelFR', x: -BUGGY.wheelX, z: BUGGY.wheelZ, front: true },
        { name: 'wheelRL', x: BUGGY.wheelX, z: -BUGGY.wheelZ, front: false },
        { name: 'wheelRR', x: -BUGGY.wheelX, z: -BUGGY.wheelZ, front: false },
      ],
      hubY: BUGGY.wheelY,
      radius: BUGGY.wheelRadius,
      travel: 0.22,
      modelLift: BUGGY.wheelRadius - BUGGY.wheelY,
      steeringWheel: 'steeringWheel',
      maxSteer: 0.5,
      steeringRatio: 2.4,
    });
  }
}
