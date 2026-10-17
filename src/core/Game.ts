import { GRAPHICS_PRESETS, type GraphicsSettings, type QualityPreset } from '../config/graphics';
import type { MapId } from '../config/maps';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Renderer } from '../render/Renderer';
import { events } from './Events';
import { Input } from './Input';
import { Loop } from './Loop';

export type StateId = 'loading' | 'menu' | 'customize' | 'playing' | 'paused' | 'finished';

/** A running world mode (test scene, a run on a map, ...). */
export interface GameMode {
  /** Before the physics step: read input, apply forces. */
  fixedUpdate(dt: number): void;
  /** After the physics step: read results, capture transforms for interpolation. */
  afterStep(dt: number): void;
  /** Per render frame. */
  update(realDt: number, simDt: number, alpha: number): void;
  dispose(): void;
  /** Optional dev hook: config objects to expose in the lil-gui panel. */
  devTuning?(): Record<string, Record<string, unknown>>;
  /** Optional dev hook: extra lines for the stats overlay. */
  devStats?(): Record<string, string>;
}

export type ProgressFn = (p: number, msg: string) => void;

/** Top-level state machine and owner of the core engine systems. */
export class Game {
  readonly renderer: Renderer;
  readonly physics: PhysicsWorld;
  readonly input: Input;
  readonly loop: Loop;
  quality: QualityPreset = 'medium';
  state: StateId = 'loading';
  mode: GameMode | null = null;
  /** Per-frame hooks for things outside the mode (dev tools, UI). */
  readonly frameHooks = new Set<(realDt: number) => void>();

  private pauseEl: HTMLDivElement | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly ui: HTMLElement,
  ) {
    this.renderer = new Renderer(canvas, GRAPHICS_PRESETS[this.quality]);
    this.physics = new PhysicsWorld();
    this.input = new Input(canvas);
    this.loop = new Loop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      update: (realDt, simDt, alpha) => this.update(realDt, simDt, alpha),
      render: () => this.renderer.render(),
    });
  }

  get graphics(): GraphicsSettings {
    return GRAPHICS_PRESETS[this.quality];
  }

  async init(progress: ProgressFn): Promise<void> {
    const params = new URLSearchParams(location.search);
    if (import.meta.env.DEV && params.get('scene') === 'test') {
      const { TestScene } = await import('../dev/TestScene');
      this.mode = new TestScene(this);
      progress(1, 'Ready');
      return;
    }
    const map = (params.get('map') === 'greenRidge' ? 'greenRidge' : 'snowPeak') as MapId;
    const { PlayMode } = await import('./PlayMode');
    this.mode = await PlayMode.create(this, map, progress);
  }

  start(): void {
    this.setState('playing');
    this.loop.start();
  }

  setQuality(q: QualityPreset): void {
    this.quality = q;
    this.renderer.applySettings(GRAPHICS_PRESETS[q]);
    events.emit('quality:change', { preset: q });
  }

  setState(next: StateId): void {
    if (next === this.state) return;
    const from = this.state;
    this.state = next;
    this.loop.timeScale = 1;
    this.showPause(next === 'paused');
    if (next === 'playing') this.loop.resetAccumulator();
    events.emit('state:change', { from, to: next });
  }

  /**
   * Dev/automation: simulate without rendering. Runs fixed steps and a light frame update every
   * `frameEvery` steps (terrain streaming, origin shifts). Call repeatedly from async code so
   * worker messages can arrive between chunks.
   */
  simulate(seconds: number, frameEvery = 10): void {
    const dt = this.loop.fixedDt;
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
      this.fixedUpdate(dt);
      if ((i + 1) % frameEvery === 0 && this.mode) this.mode.update(dt * frameEvery, dt * frameEvery, 1);
    }
  }

  private fixedUpdate(dt: number): void {
    if (this.state === 'playing' && this.mode) {
      this.mode.fixedUpdate(dt);
      this.physics.step(dt);
      this.mode.afterStep(dt);
    }
    this.input.endFixedStep();
  }

  private update(realDt: number, simDt: number, alpha: number): void {
    this.input.update();
    if (this.input.framePressed('pause')) {
      if (this.state === 'playing') this.setState('paused');
      else if (this.state === 'paused') this.setState('playing');
    }
    if (this.mode) this.mode.update(realDt, this.state === 'playing' ? simDt : 0, this.state === 'playing' ? alpha : 1);
    for (const hook of this.frameHooks) hook(realDt);
  }

  private showPause(show: boolean): void {
    if (show && !this.pauseEl) {
      this.pauseEl = document.createElement('div');
      this.pauseEl.className = 'pause-simple';
      this.pauseEl.textContent = 'PAUSED — press Esc to resume';
      this.ui.appendChild(this.pauseEl);
    } else if (!show && this.pauseEl) {
      this.pauseEl.remove();
      this.pauseEl = null;
    }
  }
}
