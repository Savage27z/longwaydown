import * as THREE from 'three';
import type { MapId } from '../config/maps';
import { SURFACE_PHYSICS } from '../config/surfaces';
import { ChaseCamera, type CameraTarget } from '../camera/ChaseCamera';
import { FlyCam } from '../camera/FlyCam';
import { PlayerController } from '../player/PlayerController';
import { World } from '../world/World';
import { events } from './Events';
import type { Game, GameMode, ProgressFn } from './Game';

/** A map session: world + rider + camera. */
export class PlayMode implements GameMode {
  readonly player: PlayerController;
  readonly chase: ChaseCamera;
  readonly flyCam: FlyCam;
  readonly dev = { flyCam: false };
  private focus = new THREE.Vector3();
  private global = new THREE.Vector3();
  private offs: (() => void)[] = [];
  private target: CameraTarget;

  private constructor(
    private readonly game: Game,
    readonly world: World,
  ) {
    this.player = new PlayerController(game, world, 'bicycle', world.courseProps.startS - 10);
    this.chase = new ChaseCamera(game.renderer.camera, game.input);
    this.flyCam = new FlyCam(game.renderer.camera, game.input, world);
    this.target = {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      heading: 0,
      quaternion: new THREE.Quaternion(),
      head: new THREE.Vector3(),
      grounded: true,
      vehicle: 'bicycle',
      groundAt: (x, z) => world.groundLocal(x, z),
    };
    this.offs.push(
      events.on('quality:change', () => world.setGraphics(game.graphics)),
      events.on('player:land', (l) => this.chase.addTrauma(Math.min(0.7, Math.max(0, l.impact - 3) / 14))),
      events.on('player:crash', () => this.chase.addTrauma(0.65)),
      events.on('player:respawn', () => this.chase.snap()),
    );
    this.player.focusLocal(this.focus);
  }

  static async create(game: Game, mapId: MapId, progress: ProgressFn): Promise<PlayMode> {
    const world = await World.create(mapId, game.renderer, game.physics, game.graphics, progress);
    return new PlayMode(game, world);
  }

  fixedUpdate(dt: number): void {
    this.player.fixedUpdate(dt);
  }

  afterStep(dt: number): void {
    this.player.afterStep(dt);
  }

  update(realDt: number, simDt: number, alpha: number): void {
    const input = this.game.input;
    // Re-centre before anything renders this frame so no object is drawn pre-shift.
    this.world.origin.update(this.focus);

    if (input.framePressed('camera')) {
      const mode = this.chase.toggleMode();
      this.player.headVisible = mode === 'chase';
      events.emit('camera:mode', { mode });
    }
    if (input.framePressed('respawn')) this.player.respawnAt(this.player.progress.result.s, 6, 'manual');

    this.player.update(simDt, alpha);
    this.updateCamera(realDt);

    this.player.focusLocal(this.focus);
    this.world.origin.toGlobal(this.focus, this.global);
    this.world.update(realDt, this.focus, this.player.progress.result.s);
  }

  private updateCamera(dt: number): void {
    if (this.dev.flyCam) {
      this.flyCam.update(dt);
      return;
    }
    const v = this.player.vehicle;
    const t = this.target;
    this.player.focusLocal(t.position);
    const lv = v.body.linvel();
    t.velocity.set(lv.x, lv.y, lv.z);
    if (this.player.state === 'crashed') t.velocity.multiplyScalar(0);
    t.heading = v.telemetry.heading;
    v.renderQuaternion(t.quaternion);
    this.player.character.rig.bones.head.getWorldPosition(t.head);
    t.head.y += 0.12;
    t.grounded = v.telemetry.grounded;
    t.vehicle = v.id;
    // Rough ground rumbles the camera a little.
    if (t.grounded) {
      const rough = SURFACE_PHYSICS[v.telemetry.surface].rough;
      const rumble = rough * Math.min(1, v.telemetry.speed / 30) * 0.32;
      if (this.chase.trauma < rumble) this.chase.trauma = rumble;
    }
    this.chase.update(dt, t, t.grounded);
  }

  devTuning(): Record<string, Record<string, unknown>> {
    const t = this.flyCam.tuning;
    const self = this;
    return {
      'Fly cam': Object.assign(t, {
        __ranges: { speed: [5, 200, 1], autopilotSpeed: [10, 400, 5], autopilotHeight: [2, 200, 1], jumpToKm: [0, Math.floor(this.world.course.length / 1000), 0.5] },
        teleportToKm() {
          if (self.dev.flyCam) self.flyCam.teleport(t.jumpToKm * 1000);
          else self.player.respawnAt(t.jumpToKm * 1000, 10, 'teleport');
        },
        flyWholeCourse() {
          self.dev.flyCam = true;
          self.flyCam.teleport(10);
          t.autopilot = true;
        },
      }),
      Camera: this.dev,
      Bicycle: this.player.vehicle.stats as unknown as Record<string, unknown>,
    };
  }

  devStats(): Record<string, string> {
    const c = this.world.chunks.counts;
    const s = this.player.progress.result;
    const tel = this.player.vehicle.telemetry;
    return {
      tiles: `L0 ${c.lod0} L1 ${c.lod1} phys ${c.physics} pend ${c.pending} build ${this.world.chunks.workers.avgMs.toFixed(0)}ms`,
      course: `${(s.s / 1000).toFixed(2)}/${(this.world.course.length / 1000).toFixed(2)} km  lat ${s.lat.toFixed(0)}  alt ${this.global.y.toFixed(0)}m`,
      ride: `${(tel.speed * 3.6).toFixed(0)} km/h  ${tel.surface}  ${tel.grounded ? 'ground' : `air ${tel.airTime.toFixed(1)}s`}  ${this.player.state}`,
      origin: `shifts ${this.world.origin.shifts}  props ${this.world.courseProps.liveCount}/${this.world.courseProps.count}`,
    };
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.player.dispose();
    this.world.dispose();
  }
}
