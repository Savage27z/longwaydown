import * as THREE from 'three';
import type { MapId } from '../config/maps';
import { FlyCam } from '../camera/FlyCam';
import { ProgressTracker } from '../world/CourseQuery';
import { World } from '../world/World';
import { events } from './Events';
import type { Game, GameMode, ProgressFn } from './Game';

/**
 * A map session: the world plus (from phase 3) the rider. In this phase the camera is the
 * fly-cam so the whole course can be inspected end to end.
 */
export class PlayMode implements GameMode {
  readonly flyCam: FlyCam;
  readonly tracker: ProgressTracker;
  private focus = new THREE.Vector3();
  private global = new THREE.Vector3();
  private offShift: () => void;

  private constructor(
    private readonly game: Game,
    readonly world: World,
  ) {
    this.flyCam = new FlyCam(game.renderer.camera, game.input, world);
    this.tracker = new ProgressTracker(world.query);
    this.flyCam.teleport(10, 6);
    this.offShift = events.on('quality:change', () => world.setGraphics(game.graphics));
  }

  static async create(game: Game, mapId: MapId, progress: ProgressFn): Promise<PlayMode> {
    const world = await World.create(mapId, game.renderer, game.physics, game.graphics, progress);
    return new PlayMode(game, world);
  }

  fixedUpdate(): void {}

  afterStep(): void {}

  update(realDt: number): void {
    this.flyCam.update(realDt);
    const cam = this.game.renderer.camera;
    this.world.origin.update(cam.position);
    this.focus.copy(cam.position);
    this.world.origin.toGlobal(this.focus, this.global);
    const prog = this.tracker.update(this.global.x, this.global.z);
    this.world.update(realDt, this.focus, prog.s);
  }

  devTuning(): Record<string, Record<string, unknown>> {
    const t = this.flyCam.tuning;
    const self = this;
    return {
      'Fly cam': Object.assign(t, {
        __ranges: { speed: [5, 200, 1], autopilotSpeed: [10, 400, 5], autopilotHeight: [2, 200, 1], jumpToKm: [0, Math.floor(this.world.course.length / 1000), 0.5] },
        teleportToKm() {
          self.flyCam.teleport(t.jumpToKm * 1000);
        },
        flyWholeCourse() {
          self.flyCam.teleport(10);
          t.autopilot = true;
        },
      }),
    };
  }

  devStats(): Record<string, string> {
    const c = this.world.chunks.counts;
    const s = this.tracker.result;
    const g = this.global;
    return {
      tiles: `L0 ${c.lod0} L1 ${c.lod1} phys ${c.physics} pend ${c.pending} build ${this.world.chunks.workers.avgMs.toFixed(0)}ms`,
      course: `${(s.s / 1000).toFixed(2)}/${(this.world.course.length / 1000).toFixed(2)} km  lat ${s.lat.toFixed(0)}  alt ${g.y.toFixed(0)}m`,
      origin: `shifts ${this.world.origin.shifts}  props ${this.world.courseProps.liveCount}/${this.world.courseProps.count}`,
    };
  }

  dispose(): void {
    this.offShift();
    this.world.dispose();
  }
}
