import * as THREE from 'three';
import { Group, groups, type PhysicsWorld } from '../physics/PhysicsWorld';
import { R, type RapierNS } from '../physics/rapier';
import { InterpolatedTransform } from '../utils/Interp';
import type { Character } from './Character';

const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();

/**
 * "Ragdoll-lite": the character is detached into one tumbling capsule body while its limbs
 * flail procedurally. Cheap, readable, and never gets stuck in a pose.
 */
export class Ragdoll {
  readonly body: RapierNS.RigidBody;
  private interp = new InterpolatedTransform();
  time = 0;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly character: Character,
    scene: THREE.Object3D,
    velocity: THREE.Vector3,
  ) {
    const RAPIER = R();
    const root = character.root;
    scene.attach(root);
    root.getWorldPosition(_p);
    root.getWorldQuaternion(_q);
    const center = _p.clone().add(new THREE.Vector3(0, 0.9, 0).applyQuaternion(_q));
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(center.x, center.y + 0.3, center.z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setLinvel(velocity.x * 0.75, Math.max(velocity.y, 0) + 3, velocity.z * 0.75)
        .setAngvel({ x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 10 })
        .setLinearDamping(0.25)
        .setAngularDamping(0.6)
        .setCcdEnabled(true),
    );
    physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.45, 0.28).setMass(75).setFriction(0.7).setRestitution(0.25).setCollisionGroups(groups(Group.DEBRIS, Group.TERRAIN | Group.PROP)),
      this.body,
    );
    this.interp.capture(this.body);
    this.interp.capture(this.body);
    character.resetFlail();
  }

  afterStep(dt: number): void {
    this.time += dt;
    this.interp.capture(this.body);
  }

  render(dt: number, alpha: number): void {
    const root = this.character.root;
    this.interp.position(alpha, root.position);
    this.interp.quaternion(alpha, root.quaternion);
    // While flailing the hips sit at the root origin, i.e. at the body centre.
    this.character.flail(dt);
  }

  shiftOrigin(dx: number, dy: number, dz: number): void {
    this.interp.shift(dx, dy, dz);
  }

  dispose(): void {
    this.physics.world.removeRigidBody(this.body);
  }
}
