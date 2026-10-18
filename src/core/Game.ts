import { GRAPHICS_PRESETS, type GraphicsSettings, type QualityPreset } from '../config/graphics';
import { RUN } from '../config/gameplay';
import { MAP_ORDER, MAPS, type MapId } from '../config/maps';
import { Progression } from '../gameplay/Progression';
import type { RunResults } from '../gameplay/Run';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Renderer } from '../render/Renderer';
import { Loading } from '../ui/Loading';
import { Menus } from '../ui/Menus';
import '../ui/ui.css';
import { events } from './Events';
import { Input } from './Input';
import { Loop } from './Loop';
import { PlayMode } from './PlayMode';
import { Save } from './Save';

export type StateId = 'loading' | 'menu' | 'playing' | 'paused' | 'finished';

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

/** Top-level state machine (loading -> menu -> playing <-> paused -> finished) and engine owner. */
export class Game {
  readonly renderer: Renderer;
  readonly physics: PhysicsWorld;
  readonly input: Input;
  readonly loop: Loop;
  readonly save = new Save();
  readonly progression = new Progression(this.save);
  readonly menus: Menus;
  quality: QualityPreset;
  state: StateId = 'loading';
  mode: GameMode | null = null;
  play: PlayMode | null = null;
  /** Per-frame hooks for things outside the mode (dev tools, UI). */
  readonly frameHooks = new Set<(realDt: number) => void>();
  /** Called after a mode is (re)created (dev tools re-attach their panels). */
  onModeCreated: ((mode: GameMode) => void) | null = null;
  private loading = new Loading();
  private finishTimer = -1;
  private pendingResults: RunResults | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly ui: HTMLElement,
  ) {
    this.quality = this.save.data.settings.quality;
    this.renderer = new Renderer(canvas, GRAPHICS_PRESETS[this.quality]);
    this.physics = new PhysicsWorld();
    this.input = new Input(canvas);
    this.input.setBindings(this.save.data.settings.keys, this.save.data.settings.pad);
    this.loop = new Loop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      update: (realDt, simDt, alpha) => this.update(realDt, simDt, alpha),
      render: () => this.renderer.render(),
    });
    this.menus = new Menus(ui, this.save, this.progression, this.input, {
      playMap: (id) => void this.playMap(id),
      lookChanged: () => this.play?.applyLook(),
      resume: () => this.resume(),
      restart: () => this.startRun(),
      respawn: () => {
        this.play?.respawnAtCheckpoint();
        this.resume();
      },
      quitToMenu: () => this.quitToMenu(),
      setQuality: (q) => this.setQuality(q),
      applySettings: () => this.applySettings(),
    });
    events.on('run:finish', ({ results }) => {
      this.pendingResults = results;
      this.finishTimer = RUN.resultsDelay;
      this.recordResults(results);
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
    const wanted = params.get('map') as MapId | null;
    const map = wanted && MAP_ORDER.includes(wanted) ? wanted : 'snowPeak';
    await this.createPlay(map, progress);
  }

  private async createPlay(map: MapId, progress: ProgressFn): Promise<void> {
    this.play = await PlayMode.create(this, map, progress);
    this.mode = this.play;
    this.applySettings();
    this.onModeCreated?.(this.play);
  }

  start(): void {
    this.loop.start();
    if (this.play) {
      this.play.enterMenu();
      this.setState('menu');
      this.menus.show('main');
    } else {
      this.setState('playing');
    }
  }

  // ---- Menu actions ----

  async playMap(id: MapId): Promise<void> {
    if (!this.play || this.play.world.mapId !== id) {
      this.menus.hide();
      this.setState('loading');
      this.loading.show('Loading…');
      const old = this.play;
      this.play = null;
      this.mode = null;
      old?.dispose();
      await this.createPlay(id, (p, msg) => this.loading.set(p, msg));
      this.loading.hide();
    }
    this.startRun();
  }

  startRun(): void {
    if (!this.play) return;
    this.menus.hide();
    this.finishTimer = -1;
    this.pendingResults = null;
    this.save.data.progress.runsStarted++;
    this.save.write();
    this.play.startRun();
    this.setState('playing');
    if (!this.save.data.firstPlayDone) {
      // First ride: show the controls before the countdown.
      this.save.data.firstPlayDone = true;
      this.save.write();
      this.setState('paused');
      this.menus.onControlsClosed = () => this.resume();
      this.menus.show('controls');
    }
  }

  resume(): void {
    this.menus.hide();
    this.menus.onControlsClosed = () => this.menus.show('main');
    this.setState('playing');
  }

  quitToMenu(): void {
    this.finishTimer = -1;
    this.play?.enterMenu();
    this.setState('menu');
    this.menus.show('main');
  }

  setQuality(q: QualityPreset): void {
    this.quality = q;
    this.save.data.settings.quality = q;
    this.renderer.applySettings(GRAPHICS_PRESETS[q]);
    events.emit('quality:change', { preset: q });
  }

  applySettings(): void {
    const s = this.save.data.settings;
    this.input.setBindings(s.keys, s.pad);
    this.play?.applySettings(s);
  }

  private recordResults(r: RunResults): void {
    const p = this.save.data.progress;
    p.finishes[r.mapId] = (p.finishes[r.mapId] ?? 0) + 1;
    p.totalDistance += r.distance;
    p.totalTrickScore += r.trickScore;
    if (r.newRecord) p.bestTimes[r.mapId] = { time: r.time, splits: r.splits, date: new Date().toISOString() };
    // Finishing a map unlocks the next one.
    const next = MAP_ORDER[MAP_ORDER.indexOf(r.mapId) + 1];
    const unlocks: { kind: string; name: string }[] = [];
    if (next && !p.unlockedMaps.includes(next)) {
      p.unlockedMaps.push(next);
      unlocks.push({ kind: 'map', name: MAPS[next].name });
    }
    this.save.write();
    unlocks.push(...this.progression.collectNew());
    r.unlocks = unlocks;
  }

  setState(next: StateId): void {
    if (next === this.state) return;
    const from = this.state;
    this.state = next;
    this.loop.timeScale = 1;
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

  private get simulating(): boolean {
    return this.state === 'playing' || this.state === 'finished';
  }

  private fixedUpdate(dt: number): void {
    if (this.simulating && this.mode) {
      this.mode.fixedUpdate(dt);
      this.physics.step(dt);
      this.mode.afterStep(dt);
    }
    this.input.endFixedStep();
  }

  private update(realDt: number, simDt: number, alpha: number): void {
    this.input.update();
    if (this.input.framePressed('pause')) this.togglePause();
    if (this.finishTimer > 0) {
      this.finishTimer -= realDt;
      if (this.finishTimer <= 0 && this.pendingResults) {
        this.setState('finished');
        this.menus.show('results', this.pendingResults);
      }
    }
    const live = this.simulating;
    if (this.mode) this.mode.update(realDt, live ? simDt : 0, live ? alpha : 1);
    for (const hook of this.frameHooks) hook(realDt);
  }

  private togglePause(): void {
    if (this.state === 'playing' && this.play) {
      this.setState('paused');
      this.menus.show('pause');
    } else if (this.state === 'paused') {
      if (this.menus.current === 'settings' || this.menus.current === 'controls') this.menus.show('pause');
      else this.resume();
    } else if (this.state === 'menu' && this.menus.current !== 'main') {
      this.menus.show('main');
    }
  }
}
