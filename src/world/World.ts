import * as THREE from 'three';
import type { GraphicsSettings } from '../config/graphics';
import type { MapId } from '../config/maps';
import { WORLD } from '../config/world';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Renderer } from '../render/Renderer';
import { Backdrop } from './Backdrop';
import { ChunkManager } from './ChunkManager';
import type { CourseData } from './CourseGenerator';
import { CourseProps } from './CourseProps';
import { CourseQuery } from './CourseQuery';
import { FloatingOrigin } from './FloatingOrigin';
import { PropLibrary } from './Props';
import { Sky } from './Sky';
import { TerrainSampler } from './TerrainSampler';

export type WorldProgress = (p: number, msg: string) => void;

/** Everything static about a map: course, terrain streaming, props, sky, floating origin. */
export class World {
  readonly sampler: TerrainSampler;
  readonly course: CourseData;
  readonly query: CourseQuery;
  readonly origin: FloatingOrigin;
  readonly chunks: ChunkManager;
  readonly sky: Sky;
  readonly props: PropLibrary;
  readonly courseProps: CourseProps;
  backdrop: Backdrop | null = null;
  private focusGlobal = new THREE.Vector3();
  private trimTimer = 0;

  private constructor(
    readonly mapId: MapId,
    private readonly renderer: Renderer,
    physics: PhysicsWorld,
    private graphics: GraphicsSettings,
  ) {
    this.sampler = new TerrainSampler(mapId);
    this.course = this.sampler.course;
    this.query = this.sampler.query;
    this.origin = new FloatingOrigin(renderer.worldRoot, physics, renderer.camera);
    const c = this.course;
    this.origin.reset(Math.round(c.x[0]!), Math.round(c.y[0]!), Math.round(c.z[0]!));
    this.sky = new Sky(renderer.scene, this.sampler.biome, graphics);
    this.sky.ringBase = this.course.finishElevation + 600;
    this.renderer.renderer.toneMappingExposure = this.sampler.biome.sky.exposure;
    this.props = new PropLibrary(this.sampler.biome);
    this.chunks = new ChunkManager(mapId, this.sampler, physics, renderer.worldRoot, this.props, this.origin.origin, graphics);
    this.courseProps = new CourseProps(this.sampler, renderer.worldRoot, physics, this.origin.origin);
  }

  static async create(mapId: MapId, renderer: Renderer, physics: PhysicsWorld, graphics: GraphicsSettings, progress: WorldProgress): Promise<World> {
    progress(0.05, 'Generating the mountain…');
    await nextFrame();
    const world = new World(mapId, renderer, physics, graphics);
    progress(0.15, 'Sculpting terrain…');
    const backdropP = world.chunks.workers.whenReady().then(() => world.chunks.workers.buildBackdrop(WORLD.backdropSpacing, WORLD.backdropMargin));
    const start = world.globalAt(world.courseProps.startS);
    await world.chunks.preload(start, world.courseProps.startS, (p) => progress(0.15 + p * 0.65, 'Sculpting terrain…'));
    progress(0.82, 'Raising distant peaks…');
    const bd = await backdropP;
    world.backdrop = new Backdrop(bd, renderer.worldRoot, graphics.nearRadius);
    world.courseProps.update(0, start, true);
    progress(1, 'Ready');
    return world;
  }

  /** Global position of the course line at distance s (on the ground). */
  globalAt(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    const c = this.course;
    const i = Math.min(c.count - 1, Math.max(0, Math.round(s / c.step)));
    const x = c.x[i]!;
    const z = c.z[i]!;
    return out.set(x, this.sampler.heightAt(x, z), z);
  }

  headingAt(s: number): number {
    const c = this.course;
    const i = Math.min(c.count - 1, Math.max(0, Math.round(s / c.step)));
    return Math.atan2(c.tx[i]!, c.tz[i]!);
  }

  /** Ground height (local coordinates in, local y out). */
  groundLocal(x: number, z: number): number {
    const o = this.origin.origin;
    return this.sampler.heightAt(x + o.x, z + o.z) - o.y;
  }

  /** Surface index under a local point. */
  surfaceLocal(x: number, z: number): number {
    const o = this.origin.origin;
    return this.chunks.surfaceAt(x + o.x, z + o.z);
  }

  setGraphics(g: GraphicsSettings): void {
    this.graphics = g;
    this.sky.applyGraphics(g);
    this.chunks.setGraphics(g);
    this.backdrop?.setNearRadius(g.nearRadius);
  }

  /**
   * Per frame. `focusLocal` is the player (or fly-cam) in local coordinates; may trigger an
   * origin shift (which moves the focus object via events/physics, so re-read it after).
   */
  update(dt: number, focusLocal: THREE.Vector3, progressS: number): void {
    this.focusGlobal.copy(focusLocal).add(this.origin.origin);
    this.chunks.update(dt, this.focusGlobal, progressS);
    this.courseProps.update(dt, this.focusGlobal);
    this.backdrop?.update(focusLocal);
    this.sky.update(this.renderer.camera, focusLocal, this.origin.origin.y);
    this.trimTimer -= dt;
    if (this.trimTimer <= 0) {
      this.trimTimer = 5;
      this.sampler.trimCache();
    }
  }

  dispose(): void {
    this.courseProps.dispose();
    this.chunks.dispose();
    this.backdrop?.dispose();
    this.props.dispose();
    this.sky.dispose();
  }

  get graphicsSettings(): GraphicsSettings {
    return this.graphics;
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}
