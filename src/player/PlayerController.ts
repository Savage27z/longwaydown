import * as THREE from 'three';
import { SWITCH, WINGSUIT_RULES } from '../config/gameplay';
import { MAPS } from '../config/maps';
import { SURFACE_PHYSICS } from '../config/surfaces';
import { WORLD } from '../config/world';
import { DEFAULT_GROUND_VEHICLE, RIDING, VEHICLES, type VehicleId } from '../config/vehicles';
import type { RiderLook } from '../config/riders';
import { events, type GameEvents } from '../core/Events';
import type { ModelOptions } from '../models/ModelLoader';
import type { Game } from '../core/Game';
import { ProgressTracker } from '../world/CourseQuery';
import type { World } from '../world/World';
import { GROUND_QUERY } from '../physics/PhysicsWorld';
import { createVehicle } from '../vehicles/factory';
import { swapVehicle } from '../vehicles/VehicleSwitcher';
import { defaultMods, emptyInput, type TransferState, type Vehicle, type VehicleContext, type VehicleSnapshot } from '../vehicles/Vehicle';
import { Character, makePose } from './Character';
import { LocalInput, type InputSource } from './InputSource';
import { Ragdoll } from './Ragdoll';
import { RiderDynamics, type MotionFrame } from './RiderDynamics';
import { WingsuitMembrane } from './WingsuitMembrane';

export type PlayerState = 'riding' | 'crashed';

/** Serializable player state (ghost replays / future multiplayer). */
export interface PlayerSnapshot extends VehicleSnapshot {
  t: number;
  state: PlayerState;
  progress: number;
}

/** Rider events. The local rider's go on the global bus (HUD, camera, run); every rider's go to `onEvent`. */
export type RiderEvent = 'player:takeoff' | 'player:land' | 'player:crash' | 'player:respawn' | 'player:switch';

export interface RiderOptions {
  /** Where the controls come from (default: this machine's keyboard / gamepad). */
  source?: InputSource;
  /** The rider at this machine: owns the global events and the camera. Default true. */
  local?: boolean;
  look?: RiderLook;
  /** Paint for every vehicle this rider spawns (vehicle defaults when unset). */
  paint?: ModelOptions;
}

const _v = new THREE.Vector3();
const _g = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * One rider: input source -> active vehicle -> character pose, plus crash / respawn flow. The
 * player at this machine and the bots are the same class with different input sources (a
 * remote player would be another source). Non-local riders can drop into a light "ghost" mode
 * where they coast along the course line, for stretches with no terrain colliders around them.
 */
export class PlayerController {
  vehicle: Vehicle;
  readonly character: Character;
  readonly local: boolean;
  readonly source: InputSource;
  readonly paint: ModelOptions | undefined;
  onEvent: (<K extends RiderEvent>(type: K, payload: GameEvents[K]) => void) | null = null;
  /** Ghost mode (non-local riders far from the local one): no physics, coast along the line. */
  ghost = false;
  /** Coasting speed along the course while a ghost (m/s), set by the race. */
  ghostSpeed = 0;
  private ghostS = 0;
  private ghostLat = 0;
  /** Body motion layered on top of the vehicle's pose. */
  readonly motion = new RiderDynamics();
  readonly membrane: WingsuitMembrane;
  /** Where a wingsuit landing hands over to: the last ground vehicle ridden. */
  lastGround: VehicleId = DEFAULT_GROUND_VEHICLE;
  readonly progress: ProgressTracker;
  readonly input = emptyInput();
  readonly ctx: VehicleContext;
  state: PlayerState = 'riding';
  /** Set by the run while the countdown is on (no throttle/steer). */
  frozen = false;
  /** After the finish line: coast to a stop. */
  autoBrake = false;
  /** Where automatic resets (off course, stuck, fell) put the rider; defaults to current progress. */
  resetS: (() => number) | null = null;
  /** Dev/AI hook: rewrite the input after it is read from devices. */
  inputOverride: ((input: typeof this.input) => void) | null = null;
  /** Lets the camera hide the head in helmet view. */
  headVisible = true;
  /** Off for far riders: only the vehicle is placed, the character keeps its last pose. */
  detail = true;
  private pose = makePose();
  private ragdoll: Ragdoll | null = null;
  private crashTimer = 0;
  private stuckTimer = 0;
  private offShift: () => void;
  private simTime = 0;
  /** After a respawn: hold the rider in place until the ground's collider has streamed in. */
  private spawnHold: TransferState | null = null;
  private spawnWait = 0;
  /** Pop-in animation after a switch (0..1, 1 = done). */
  private popT = 1;

  constructor(
    private readonly game: Game,
    private readonly world: World,
    vehicleId: VehicleId,
    spawnS: number,
    opts: RiderOptions = {},
  ) {
    this.local = opts.local ?? true;
    this.source = opts.source ?? new LocalInput(game.input);
    this.paint = opts.paint;
    this.character = new Character(opts.look);
    this.ctx = { physics: game.physics, world, mods: defaultMods() };
    this.progress = new ProgressTracker(world.query);
    this.progress.reset(spawnS);
    this.vehicle = createVehicle(vehicleId, game.physics, this.spawnState(spawnS, 0), this.paint);
    this.attachVehicle(this.vehicle);
    this.membrane = new WingsuitMembrane(this.character.binding);
    this.offShift = events.on('origin:shift', ({ dx, dy, dz }) => {
      this.vehicle.shiftOrigin(dx, dy, dz);
      this.ragdoll?.shiftOrigin(dx, dy, dz);
      this.spawnHold?.position.set(this.spawnHold.position.x - dx, this.spawnHold.position.y - dy, this.spawnHold.position.z - dz);
    });
  }

  /** Spawn transform `lat` m right of the course line at distance s (local coordinates). */
  spawnState(s: number, speed: number, lat = 0, lift = 0.4): TransferState {
    const heading = this.world.courseAt(s, lat, _g);
    const pos = this.world.origin.toLocal(_g, new THREE.Vector3());
    pos.y += this.vehicle ? this.vehicle.stats.rideHeight + lift : 1.1;
    const vel = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(speed);
    return { position: pos, velocity: vel, heading };
  }

  private emit<K extends RiderEvent>(type: K, payload: GameEvents[K]): void {
    if (this.local) events.emit(type, payload);
    this.onEvent?.(type, payload);
  }

  private attachVehicle(v: Vehicle): void {
    this.game.renderer.scene.add(v.model);
    v.mount.add(this.character.root);
    this.character.root.position.set(0, 0, 0);
    this.character.root.quaternion.identity();
    v.hooks.onCrash = (reason) => this.onCrash(reason);
    v.hooks.onLand = (info) => this.emit('player:land', info);
    v.hooks.onTakeoff = () => this.emit('player:takeoff', {});
  }

  /** Ground vehicles a wingsuit landing can hand over to. */
  private static readonly GROUND = new Set<VehicleId>(['bicycle', 'mountainBike', 'motorbike', 'car', 'snowboard', 'skis']);

  /**
   * Swap the ridden vehicle in place (keeps position, heading and most of the speed).
   * `silent`: no hop, pop or switch event (resets, the race start).
   */
  switchTo(id: VehicleId, opts: { silent?: boolean; hop?: boolean } = {}): boolean {
    if (this.state !== 'riding' || id === this.vehicle.id) return false;
    if (PlayerController.GROUND.has(id)) this.lastGround = id;
    const from = this.vehicle.id;
    // Detach the rider first: disposing the old vehicle disposes everything under its model.
    this.character.root.removeFromParent();
    try {
      this.vehicle = swapVehicle(this.vehicle, id, this.game.physics, this.world, this.paint);
    } finally {
      this.attachVehicle(this.vehicle);
    }
    this.motion.reset();
    if (opts.silent) return true;
    this.popT = 0;
    if (opts.hop ?? true) this.motion.hop();
    const p = this.vehicle.transfer().position;
    this.emit('player:switch', { from, to: id, position: { x: p.x, y: p.y, z: p.z } });
    return true;
  }

  /** Vehicle body height above the terrain under it (m). */
  heightAboveGround(): number {
    const v = this.vehicle;
    if (v.telemetry.grounded) return 0;
    const t = v.body.translation();
    return t.y - this.world.groundLocal(t.x, t.z) - v.stats.rideHeight;
  }

  /** The ground vehicle a wingsuit lands on (respects snow-only rules). */
  landingVehicle(): VehicleId {
    const id = this.lastGround;
    return VEHICLES[id].snowOnly && MAPS[this.world.mapId].biome !== 'snow' ? DEFAULT_GROUND_VEHICLE : id;
  }

  /** Race start: the summit plateau (before the edge) is walked, not ridden. */
  private onPlateau(s: number): boolean {
    return s < MAPS[this.world.mapId].launch.edgeS - 2;
  }

  /** Absorb-able crash entry point. Returns true if the crash was ignored. */
  private onCrash(reason: string): boolean {
    if (this.state !== 'riding') return true;
    this.state = 'crashed';
    this.crashTimer = 0;
    const v = this.vehicle.transfer().velocity;
    this.ragdoll = new Ragdoll(this.game.physics, this.character, this.game.renderer.scene, v);
    // Park the vehicle where it fell.
    this.vehicle.body.setLinvel({ x: v.x * 0.2, y: 0, z: v.z * 0.2 }, true);
    this.emit('player:crash', { reason, penalty: RIDING.crashPenalty });
    return false;
  }

  /** Put the rider back on the course line at distance s (`lat` m to its right). */
  respawnAt(s: number, speed = RIDING.respawnSpeed, reason = 'respawn', lat = 0): void {
    this.endRagdoll();
    this.ghost = false;
    const c = this.world.course;
    const sClamped = Math.max(5, Math.min(c.length - 5, s));
    this.progress.reset(sClamped);
    // The tracker only refines on the next update: report the new spot straight away.
    const r = this.progress.result;
    r.idx = this.progress.idx;
    r.s = sClamped;
    r.lat = lat;
    r.d = Math.abs(lat);
    this.state = 'riding';
    if (this.onPlateau(sClamped) && this.vehicle.id !== 'onFoot') this.switchTo('onFoot', { silent: true });
    // A wingsuit can't stand on the ground: respawn on the ground vehicle instead.
    else if (!this.onPlateau(sClamped) && (this.vehicle.id === 'wingsuit' || this.vehicle.id === 'onFoot')) this.switchTo(this.landingVehicle(), { silent: true });
    const spawn = this.spawnState(sClamped, speed, lat);
    this.vehicle.place(spawn);
    this.spawnHold = spawn;
    this.spawnWait = RIDING.spawnGroundWait;
    this.motion.reset();
    this.stuckTimer = 0;
    this.emit('player:respawn', { reason });
  }

  /** Become a ghost at the current progress, coasting at `speed` (never the local rider). */
  enterGhost(speed: number): void {
    if (this.local || this.ghost) return;
    const r = this.progress.result;
    this.endRagdoll();
    this.state = 'riding';
    this.spawnHold = null;
    // A ghost rides its ground vehicle: runners past the plateau and wingsuits land straight away.
    if (this.vehicle.id === 'wingsuit' || (this.vehicle.id === 'onFoot' && !this.onPlateau(r.s))) this.switchTo(this.landingVehicle(), { silent: true });
    this.ghost = true;
    this.ghostS = r.s;
    this.ghostLat = Math.max(-4, Math.min(4, r.lat));
    this.ghostSpeed = speed;
  }

  /** Back to full physics where the ghost is now, already at speed. */
  exitGhost(): void {
    if (!this.ghost) return;
    this.ghost = false;
    this.vehicle.place(this.spawnState(this.ghostS, this.ghostSpeed, this.ghostLat, 0.12));
    this.motion.reset();
    this.stuckTimer = 0;
  }

  /** Where a ghost is now (global, on the ground). */
  ghostGlobal(out: THREE.Vector3): THREE.Vector3 {
    this.world.courseAt(this.ghostS, this.ghostLat, out);
    return out;
  }

  private ghostStep(dt: number): void {
    const c = this.world.course;
    this.ghostS = Math.min(c.length - 5, this.ghostS + this.ghostSpeed * dt);
    this.vehicle.place(this.spawnState(this.ghostS, 0, this.ghostLat, 0));
    const r = this.progress.result;
    this.progress.reset(this.ghostS);
    r.idx = this.progress.idx;
    r.s = this.ghostS;
    r.lat = this.ghostLat;
    r.d = Math.abs(this.ghostLat);
    const tel = this.vehicle.telemetry;
    tel.speed = tel.forwardSpeed = this.ghostSpeed;
    tel.grounded = true;
    tel.airTime = 0;
  }

  private endRagdoll(): void {
    if (!this.ragdoll) return;
    this.ragdoll.dispose();
    this.ragdoll = null;
    this.vehicle.mount.add(this.character.root);
    this.character.root.position.set(0, 0, 0);
    this.character.root.quaternion.identity();
    this.character.setOpacity(1);
    this.character.resetFlail();
  }

  private readInput(): void {
    const i = this.input;
    this.source.read(i);
    // Race rules on top of whatever the source wants.
    if (this.frozen) {
      i.throttle = 0;
      i.brake = 1;
      i.steer = 0;
      i.jumpPressed = false;
      i.boost = false;
    }
    if (this.autoBrake) {
      i.throttle = 0;
      i.brake = 0.5;
      i.boost = false;
      i.jumpPressed = false;
    }
    this.inputOverride?.(i);
  }

  /** Terrain collider present under a (local) point? */
  private groundReady(p: THREE.Vector3): boolean {
    return this.game.physics.raycast(p.x, p.y + 3, p.z, 0, -1, 0, 12, GROUND_QUERY, this.vehicle.body) !== null;
  }

  fixedUpdate(dt: number): void {
    this.simTime += dt;
    if (this.ghost) {
      this.ghostStep(dt);
      return;
    }
    // Long respawns can land before the terrain there has colliders: wait for the ground.
    if (this.spawnHold && this.state === 'riding') {
      this.spawnWait -= dt;
      if (this.groundReady(this.spawnHold.position) || this.spawnWait <= 0) this.spawnHold = null;
      else {
        this.vehicle.place(this.spawnHold);
        return;
      }
    }
    if (this.state === 'riding') {
      this.readInput();
      this.vehicle.fixedUpdate(dt, this.input, this.ctx);
    } else {
      // Keep the parked vehicle still while the rider tumbles.
      this.vehicle.body.setLinvel({ x: 0, y: Math.min(0, this.vehicle.body.linvel().y), z: 0 }, true);
    }
  }

  afterStep(dt: number): void {
    if (this.ghost) return;
    if (this.state === 'riding') {
      const v = this.vehicle;
      v.afterStep(dt, this.ctx);
      const tel = v.telemetry;
      const gravity = -WORLD.gravity * v.body.gravityScale();
      this.motion.step(dt, v.id, v.body.linvel(), v.renderQuaternion(_q), gravity, tel.grounded, SURFACE_PHYSICS[tel.surface].rough, tel.speed);
      this.wingsuitRules();
      if (this.state === 'riding' && !this.spawnHold) this.checkResets(dt);
    } else if (this.ragdoll) {
      this.ragdoll.afterStep(dt);
      this.crashTimer += dt;
      if (this.crashTimer >= RIDING.crashDuration) this.respawnAt(this.progress.result.s + 4, RIDING.respawnSpeed, 'crash');
    }
  }

  /** Off the edge on foot: the suit deploys. A wingsuit that touches down hands over to a ground vehicle. */
  private wingsuitRules(): void {
    const v = this.vehicle;
    if (v.id === 'onFoot' && !v.telemetry.grounded) {
      const h = this.heightAboveGround();
      if (h > WINGSUIT_RULES.autoDeployHeight || (this.input.jumpPressed && h > WINGSUIT_RULES.manualDeployHeight)) this.switchTo('wingsuit', { hop: false });
    } else if (v.id === 'wingsuit' && v.telemetry.grounded) {
      this.switchTo(this.landingVehicle());
    }
  }

  /** Out of bounds, fell through the world, or stuck: reset onto the line. */
  private checkResets(dt: number): void {
    const t = this.vehicle.body.translation();
    this.world.origin.toGlobal(_v.set(t.x, t.y, t.z), _g);
    const p = this.progress.update(_g.x, _g.z);
    const ground = this.world.sampler.heightAt(_g.x, _g.z);
    const courseY = this.world.course.y[Math.min(this.world.course.count - 1, p.idx)]!;
    if (p.d > RIDING.outOfBoundsDistance || _g.y < courseY - RIDING.fallBelowCourse || _g.y < ground - 6) {
      this.respawnAt(this.resetS?.() ?? p.s, RIDING.respawnSpeed, 'out of bounds');
      return;
    }
    const tel = this.vehicle.telemetry;
    if (tel.speed < RIDING.stuckSpeed && !this.frozen && !this.autoBrake) this.stuckTimer += dt;
    else this.stuckTimer = 0;
    if (this.stuckTimer > RIDING.stuckTime) this.respawnAt(this.resetS?.() ?? p.s + 2, RIDING.respawnSpeed, 'stuck');
  }

  update(dt: number, alpha: number): void {
    this.vehicle.render(dt, alpha);
    if (!this.detail) return;
    if (this.popT < 1) {
      // Elastic pop: overshoot then settle.
      this.popT = Math.min(1, this.popT + dt / SWITCH.popDuration);
      const t = this.popT;
      const k = 1 - Math.pow(1 - t, 3) + Math.sin(t * Math.PI) * 0.18;
      this.vehicle.model.scale.setScalar(0.55 + 0.45 * k);
    } else if (this.vehicle.model.scale.x !== 1) this.vehicle.model.scale.setScalar(1);
    if (this.state === 'riding') {
      this.vehicle.pose(this.pose, this.input);
      this.motion.apply(this.pose, dt, this.motionFrame());
      // Running is a fast cycle: follow it tightly.
      this.character.update(dt, this.pose, this.vehicle.id === 'onFoot' ? 30 : 14);
    } else if (this.ragdoll) {
      this.ragdoll.render(dt, alpha);
      const fade = (this.crashTimer - (RIDING.crashDuration - 0.6)) / 0.6;
      this.character.setOpacity(Math.max(0, Math.min(1, 1 - fade)));
    }
    this.character.setHeadVisible(this.headVisible);
    this.membrane.update(this.state === 'riding' && this.vehicle.id === 'wingsuit', dt);
  }

  private frame: MotionFrame | null = null;

  private motionFrame(): MotionFrame {
    const v = this.vehicle;
    const tel = v.telemetry;
    const t = v.body.translation();
    const f = (this.frame ??= { vehicle: v.id, quaternion: new THREE.Quaternion(), input: this.input, speed: 0, grounded: true, heading: 0, height: 0, vy: 0 });
    f.vehicle = v.id;
    v.renderQuaternion(f.quaternion);
    f.speed = tel.speed;
    f.grounded = tel.grounded;
    f.heading = tel.heading;
    f.height = tel.grounded ? 0 : t.y - this.world.groundLocal(t.x, t.z) - v.stats.rideHeight;
    f.vy = v.body.linvel().y;
    return f;
  }

  /** Global position of the rider (body centre). */
  globalPosition(out: THREE.Vector3): THREE.Vector3 {
    this.vehicle.renderPosition(out);
    return this.world.origin.toGlobal(out, out);
  }

  /** Camera focus: the ragdoll while crashed, otherwise the vehicle. */
  focusLocal(out: THREE.Vector3): THREE.Vector3 {
    if (this.ragdoll) return this.character.root.getWorldPosition(out);
    return this.vehicle.renderPosition(out);
  }

  snapshot(): PlayerSnapshot {
    return { ...this.vehicle.snapshot(), t: this.simTime, state: this.state, progress: this.progress.result.s };
  }

  dispose(): void {
    this.offShift();
    this.endRagdoll();
    this.membrane.dispose();
    this.character.root.removeFromParent();
    this.vehicle.dispose(this.game.physics);
    this.character.dispose();
  }
}
