import * as THREE from 'three';
import { RIDING, type VehicleId } from '../config/vehicles';
import { events } from '../core/Events';
import type { Game } from '../core/Game';
import { ProgressTracker } from '../world/CourseQuery';
import type { World } from '../world/World';
import { createVehicle } from '../vehicles/factory';
import { defaultMods, emptyInput, type TransferState, type Vehicle, type VehicleContext, type VehicleSnapshot } from '../vehicles/Vehicle';
import { Character, makePose } from './Character';
import { Ragdoll } from './Ragdoll';

export type PlayerState = 'riding' | 'crashed';

/** Serializable player state (ghost replays / future multiplayer). */
export interface PlayerSnapshot extends VehicleSnapshot {
  t: number;
  state: PlayerState;
  progress: number;
}

const _v = new THREE.Vector3();
const _g = new THREE.Vector3();

/** Glues input -> active vehicle -> character pose, and owns crash / respawn flow. */
export class PlayerController {
  vehicle: Vehicle;
  readonly character = new Character();
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
  private pose = makePose();
  private ragdoll: Ragdoll | null = null;
  private crashTimer = 0;
  private stuckTimer = 0;
  private offShift: () => void;
  private simTime = 0;
  private steerSmooth = 0;

  constructor(
    private readonly game: Game,
    private readonly world: World,
    vehicleId: VehicleId,
    spawnS: number,
  ) {
    this.ctx = { physics: game.physics, world, mods: defaultMods() };
    this.progress = new ProgressTracker(world.query);
    this.progress.reset(spawnS);
    this.vehicle = createVehicle(vehicleId, game.physics, this.spawnState(spawnS, 0));
    this.attachVehicle(this.vehicle);
    this.offShift = events.on('origin:shift', ({ dx, dy, dz }) => {
      this.vehicle.shiftOrigin(dx, dy, dz);
      this.ragdoll?.shiftOrigin(dx, dy, dz);
    });
  }

  /** Spawn transform on the course line at distance s (local coordinates). */
  spawnState(s: number, speed: number): TransferState {
    const g = this.world.globalAt(s, _g);
    const heading = this.world.headingAt(s);
    const pos = this.world.origin.toLocal(g, new THREE.Vector3());
    pos.y += this.vehicle ? this.vehicle.stats.rideHeight + 0.4 : 1.1;
    const vel = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(speed);
    return { position: pos, velocity: vel, heading };
  }

  private attachVehicle(v: Vehicle): void {
    this.game.renderer.scene.add(v.model);
    v.mount.add(this.character.root);
    this.character.root.position.set(0, 0, 0);
    this.character.root.quaternion.identity();
    v.hooks.onCrash = (reason) => this.onCrash(reason);
    v.hooks.onLand = (info) => events.emit('player:land', info);
    v.hooks.onTakeoff = () => events.emit('player:takeoff', {});
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
    events.emit('player:crash', { reason, penalty: RIDING.crashPenalty });
    return false;
  }

  /** Put the rider back on the course line at distance s. */
  respawnAt(s: number, speed = RIDING.respawnSpeed, reason = 'respawn'): void {
    this.endRagdoll();
    const c = this.world.course;
    const sClamped = Math.max(5, Math.min(c.length - 5, s));
    this.progress.reset(sClamped);
    this.vehicle.place(this.spawnState(sClamped, speed));
    this.state = 'riding';
    this.stuckTimer = 0;
    events.emit('player:respawn', { reason });
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
    const inp = this.game.input;
    const i = this.input;
    const live = !this.frozen;
    i.throttle = live ? inp.value('accelerate') : 0;
    i.brake = live ? inp.value('brake') : 1;
    // Ramp steering so digital keys feel analog (and sticks don't twitch).
    const raw = live ? inp.axis('steerLeft', 'steerRight') : 0;
    const rising = Math.abs(raw) > Math.abs(this.steerSmooth) && Math.sign(raw) === Math.sign(this.steerSmooth || raw);
    const rate = (rising ? RIDING.steerRise : RIDING.steerFall) / 60;
    this.steerSmooth += Math.max(-rate, Math.min(rate, raw - this.steerSmooth));
    i.steer = this.steerSmooth;
    i.pitch = inp.axis('pitchBack', 'pitchForward');
    i.spin = inp.axis('spinLeft', 'spinRight');
    i.jumpPressed = live && inp.stepPressed('jump');
    i.jumpHeld = inp.isDown('jump');
    i.boost = live && inp.isDown('boost');
    i.trick = inp.isDown('trick');
    if (this.autoBrake) {
      i.throttle = 0;
      i.brake = 0.5;
      i.boost = false;
      i.jumpPressed = false;
    }
    this.inputOverride?.(i);
  }

  fixedUpdate(dt: number): void {
    this.simTime += dt;
    if (this.state === 'riding') {
      this.readInput();
      this.vehicle.fixedUpdate(dt, this.input, this.ctx);
    } else {
      // Keep the parked vehicle still while the rider tumbles.
      this.vehicle.body.setLinvel({ x: 0, y: Math.min(0, this.vehicle.body.linvel().y), z: 0 }, true);
    }
  }

  afterStep(dt: number): void {
    if (this.state === 'riding') {
      this.vehicle.afterStep(dt, this.ctx);
      this.checkResets(dt);
    } else if (this.ragdoll) {
      this.ragdoll.afterStep(dt);
      this.crashTimer += dt;
      if (this.crashTimer >= RIDING.crashDuration) this.respawnAt(this.progress.result.s + 4, RIDING.respawnSpeed, 'crash');
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
    if (this.state === 'riding') {
      this.vehicle.pose(this.pose, this.input);
      this.character.update(dt, this.pose);
    } else if (this.ragdoll) {
      this.ragdoll.render(dt, alpha);
      const fade = (this.crashTimer - (RIDING.crashDuration - 0.6)) / 0.6;
      this.character.setOpacity(Math.max(0, Math.min(1, 1 - fade)));
    }
    this.character.setHeadVisible(this.headVisible);
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
    this.character.root.removeFromParent();
    this.vehicle.dispose(this.game.physics);
    this.character.dispose();
  }
}
