import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import type { Game, GameMode } from '../core/Game';
import { R, type RapierNS } from '../physics/rapier';
import { Group, groups } from '../physics/PhysicsWorld';
import { InterpolatedTransform } from '../utils/Interp';
import { makeRng } from '../utils/rng';
import { clamp, damp, dampAngle } from '../utils/math';

const SIZE = 256;
const SEGS = 128;

/** Phase-1 sandbox: a noisy heightfield slope and a capsule you can push around. */
export class TestScene implements GameMode {
  readonly tuning = {
    moveForce: 38,
    jumpImpulse: 6.5,
    linearDamping: 0.35,
    cameraDistance: 8,
    cameraHeight: 3.2,
  };
  heightfieldCheck = { maxError: -1, samples: 0 };

  private body: RapierNS.RigidBody;
  private capsule: THREE.Group;
  private interp = new InterpolatedTransform();
  private sun: THREE.DirectionalLight;
  private noise = createNoise2D(makeRng('test-slope'));
  private camYaw = 0;
  private orbitYaw = 0;
  private orbitPitch = 0.25;
  private heading = 0;
  private grounded = false;
  private objects: THREE.Object3D[] = [];
  private tmp = new THREE.Vector3();

  constructor(private readonly game: Game) {
    const { scene } = game.renderer;
    scene.background = new THREE.Color('#9cc7ea');
    scene.fog = new THREE.Fog('#9cc7ea', 120, 700);

    const hemi = new THREE.HemisphereLight('#dbeeff', '#5a6b7a', 1.1);
    this.sun = new THREE.DirectionalLight('#fff3dd', 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -60;
    sc.right = 60;
    sc.top = 60;
    sc.bottom = -60;
    sc.near = 1;
    sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(hemi, this.sun, this.sun.target);
    this.objects.push(hemi, this.sun, this.sun.target);

    this.buildTerrain();
    this.buildObstacles();

    const RAPIER = R();
    const spawnY = this.height(0, -100) + 3;
    this.body = game.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, spawnY, -100).lockRotations().setLinearDamping(this.tuning.linearDamping).setCcdEnabled(true),
    );
    game.physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.5, 0.4).setMass(1).setFriction(0.4).setCollisionGroups(groups(Group.VEHICLE, Group.ALL)),
      this.body,
    );
    this.capsule = this.buildCapsuleMesh();
    scene.add(this.capsule);
    this.objects.push(this.capsule);
    this.interp.capture(this.body);
  }

  /** Analytic height used for both the mesh and the heightfield collider. */
  height(x: number, z: number): number {
    return -0.22 * z + 5 * Math.sin(x * 0.045) * Math.cos(z * 0.035) + 2.2 * this.noise(x * 0.02, z * 0.02) + 0.5 * this.noise(x * 0.1, z * 0.1);
  }

  private buildTerrain(): void {
    const RAPIER = R();
    const n = SEGS + 1;
    const step = SIZE / SEGS;
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const heights = new Float32Array(n * n);
    const snow = new THREE.Color('#f2f7ff');
    const rock = new THREE.Color('#7d8794');
    const c = new THREE.Color();
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = -SIZE / 2 + ix * step;
        const z = -SIZE / 2 + iz * step;
        const h = this.height(x, z);
        const i = iz * n + ix;
        positions[i * 3] = x;
        positions[i * 3 + 1] = h;
        positions[i * 3 + 2] = z;
        // Rapier heightfield: column-major (nrows+1)x(ncols+1); rows run along Z, columns along X.
        heights[ix * n + iz] = h;
        const slope = Math.abs(this.height(x + 1, z) - h) + Math.abs(this.height(x, z + 1) - h - -0.22);
        c.copy(snow).lerp(rock, clamp((slope - 0.35) * 2, 0, 1));
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
    }
    const index: number[] = [];
    for (let iz = 0; iz < SEGS; iz++) {
      for (let ix = 0; ix < SEGS; ix++) {
        const a = iz * n + ix;
        const b = a + 1;
        const d = a + n;
        const e = d + 1;
        index.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.game.renderer.scene.add(mesh);
    this.objects.push(mesh);

    const body = this.game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.game.physics.world.createCollider(
      RAPIER.ColliderDesc.heightfield(SEGS, SEGS, heights, { x: SIZE, y: 1, z: SIZE }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES)
        .setFriction(0.6)
        .setCollisionGroups(groups(Group.TERRAIN, Group.ALL)),
      body,
    );
  }

  private buildObstacles(): void {
    const RAPIER = R();
    const rng = makeRng('test-obstacles');
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const staticMat = new THREE.MeshLambertMaterial({ color: '#5b6b7c', flatShading: true });
    const dynMat = new THREE.MeshLambertMaterial({ color: '#ff8a3d', flatShading: true });
    for (let i = 0; i < 26; i++) {
      const x = (rng() - 0.5) * 200;
      const z = (rng() - 0.5) * 200;
      const sx = 1 + rng() * 4;
      const sy = 0.6 + rng() * 2.5;
      const sz = 1 + rng() * 4;
      const dynamic = i % 3 === 0;
      const y = this.height(x, z) + sy / 2 + (dynamic ? 2 : -0.2);
      const mesh = new THREE.Mesh(boxGeo, dynamic ? dynMat : staticMat);
      mesh.scale.set(sx, sy, sz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const desc = dynamic ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed();
      const body = this.game.physics.world.createRigidBody(desc.setTranslation(x, y, z));
      this.game.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setDensity(0.4).setCollisionGroups(groups(Group.PROP, Group.ALL)),
        body,
      );
      mesh.position.set(x, y, z);
      mesh.userData.body = body;
      this.game.renderer.scene.add(mesh);
      this.objects.push(mesh);
    }
  }

  private buildCapsuleMesh(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1, 6, 12), new THREE.MeshLambertMaterial({ color: '#ff5a1f' }));
    body.castShadow = true;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.5), new THREE.MeshLambertMaterial({ color: '#1b2b40' }));
    nose.position.set(0, 0.35, 0.45);
    g.add(body, nose);
    return g;
  }

  /** Raycast the collider at grid vertices and compare against the mesh heights. */
  private verifyHeightfield(): void {
    let maxErr = 0;
    let samples = 0;
    const step = SIZE / SEGS;
    for (let k = 0; k < 64; k++) {
      const ix = 1 + ((k * 37) % (SEGS - 1));
      const iz = 1 + ((k * 53) % (SEGS - 1));
      const x = -SIZE / 2 + ix * step;
      const z = -SIZE / 2 + iz * step;
      const hit = this.game.physics.raycast(x, 400, z, 0, -1, 0, 1000, groups(Group.ALL, Group.TERRAIN));
      if (!hit) continue;
      maxErr = Math.max(maxErr, Math.abs(hit.y - this.height(x, z)));
      samples++;
    }
    this.heightfieldCheck = { maxError: maxErr, samples };
    if (maxErr > 0.01) console.warn(`[TestScene] heightfield/mesh mismatch: max error ${maxErr.toFixed(3)} m`);
    else console.info(`[TestScene] heightfield matches mesh (${samples} samples, max error ${maxErr.toExponential(1)} m)`);
  }

  fixedUpdate(): void {
    const input = this.game.input;
    const t = this.body.translation();
    const hit = this.game.physics.raycast(t.x, t.y, t.z, 0, -1, 0, 1.25, undefined, this.body);
    this.grounded = hit !== null;

    const throttle = input.axis('brake', 'accelerate');
    const steer = input.axis('steerLeft', 'steerRight');
    this.heading -= steer * 2.2 * (1 / 60);
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const force = this.tuning.moveForce * (this.grounded ? 1 : 0.25);
    this.body.setLinearDamping(this.tuning.linearDamping);
    // Rapier user forces persist across steps until reset.
    this.body.resetForces(true);
    this.body.addForce({ x: fx * throttle * force, y: 0, z: fz * throttle * force }, true);
    if (this.grounded && input.stepPressed('jump')) {
      this.body.applyImpulse({ x: 0, y: this.tuning.jumpImpulse * this.body.mass(), z: 0 }, true);
    }
    if (input.stepPressed('respawn')) {
      this.body.setTranslation({ x: 0, y: this.height(0, -100) + 3, z: -100 }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.interp.snap(0, this.height(0, -100) + 3, -100);
    }
  }

  afterStep(): void {
    // Scene queries only see new colliders after the first step.
    if (this.heightfieldCheck.samples === 0) this.verifyHeightfield();
    this.interp.capture(this.body);
  }

  update(realDt: number, _simDt: number, alpha: number): void {
    this.interp.apply(this.capsule, alpha, false);
    this.capsule.rotation.y = this.heading;
    for (const o of this.objects) {
      const b = o.userData.body as RapierNS.RigidBody | undefined;
      if (b && b.isDynamic()) {
        const p = b.translation();
        const q = b.rotation();
        o.position.set(p.x, p.y, p.z);
        o.quaternion.set(q.x, q.y, q.z, q.w);
      }
    }

    const input = this.game.input;
    if (input.mouseDown) {
      this.orbitYaw -= input.mouseDX * 0.005;
      this.orbitPitch = clamp(this.orbitPitch + input.mouseDY * 0.004, -0.2, 1.2);
    } else {
      this.orbitYaw = damp(this.orbitYaw, 0, 2, realDt);
    }
    this.orbitYaw -= input.rightStick.x * 2.5 * realDt;
    this.camYaw = dampAngle(this.camYaw, this.heading, 4, realDt);

    const cam = this.game.renderer.camera;
    const target = this.capsule.position;
    const yaw = this.camYaw + this.orbitYaw;
    const dist = this.tuning.cameraDistance;
    const desired = this.tmp.set(
      target.x - Math.sin(yaw) * dist * Math.cos(this.orbitPitch),
      target.y + this.tuning.cameraHeight + Math.sin(this.orbitPitch) * dist,
      target.z - Math.cos(yaw) * dist * Math.cos(this.orbitPitch),
    );
    desired.y = Math.max(desired.y, this.height(desired.x, desired.z) + 1.2);
    cam.position.lerp(desired, 1 - Math.exp(-10 * realDt));
    cam.lookAt(target.x, target.y + 1, target.z);

    this.sun.position.set(target.x + 60, target.y + 120, target.z + 40);
    this.sun.target.position.copy(target);
  }

  devTuning(): Record<string, Record<string, unknown>> {
    return { 'Test scene': this.tuning };
  }

  /** Dev telemetry. */
  telemetry(): { x: number; y: number; z: number; speed: number; grounded: boolean } {
    const t = this.body.translation();
    const v = this.body.linvel();
    return { x: t.x, y: t.y, z: t.z, speed: Math.hypot(v.x, v.y, v.z), grounded: this.grounded };
  }

  dispose(): void {
    for (const o of this.objects) o.removeFromParent();
  }
}
