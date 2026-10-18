import { GRAPHICS_PRESETS, type GraphicsSettings, type QualityPreset } from '../config/graphics';
import { RUN } from '../config/gameplay';
import { MAP_ORDER, MAPS, type MapId } from '../config/maps';
import { Progression } from '../gameplay/Progression';
import { AudioManager } from '../audio/AudioManager';
import { NetSession } from '../net/NetSession';
import { NET, type LobbyPlayer, type StartInfo } from '../net/protocol';
import { Race, type OnlineGrid } from '../gameplay/Race';
import { VEHICLE_IDS } from '../config/vehicles';
import type { RunResults } from '../gameplay/Run';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Renderer } from '../render/Renderer';
import { Loading } from '../ui/Loading';
import { Menus } from '../ui/Menus';
import '../ui/ui.css';
import '../ui/theme.css';
import { events } from './Events';
import { Input } from './Input';
import { Loop } from './Loop';
import { PlayMode } from './PlayMode';
import { Save } from './Save';

/** Loading screen line for a mountain. */
function mapTitle(id: MapId): string {
  return `<b>${MAPS[id].name}</b>${MAPS[id].tagline}`;
}

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
  readonly audio = new AudioManager();
  /** The online room, when in one. */
  net: NetSession | null = null;
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
      toLobby: () => this.toLobby(),
      online: {
        host: (name) => this.openRoom(() => NetSession.host(this.me(name))),
        join: (code, name) => this.openRoom(() => NetSession.join(code, this.me(name))),
        leave: () => this.leaveRoom(),
        start: () => this.startOnline(),
      },
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
    this.menus.back = () => this.menuBack();
    this.menus.net = () => this.net;
    this.audio.bind(events);
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

  private async createPlay(map: MapId, progress: ProgressFn, online: OnlineGrid | null = null): Promise<void> {
    this.play = await PlayMode.create(this, map, progress, online);
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
    if (!this.play || this.play.world.mapId !== id || this.play.online) {
      this.menus.hide();
      this.setState('loading');
      this.loading.show('Loading…', mapTitle(id));
      const old = this.play;
      this.play = null;
      this.mode = null;
      old?.dispose();
      await this.createPlay(id, (p, msg) => this.loading.set(p, msg));
      this.loading.hide();
    }
    this.startRun();
  }

  // ---- Online ----

  /** This player as others see them: name, outfit and paint for every vehicle. */
  private me(name: string): Omit<LobbyPlayer, 'id' | 'color'> {
    const paint: LobbyPlayer['paint'] = {};
    for (const id of VEHICLE_IDS) {
      const p = this.save.paintFor(id);
      if (p) paint[id] = p;
    }
    return { name, look: this.save.data.look, paint };
  }

  private async openRoom(open: () => Promise<NetSession>): Promise<void> {
    try {
      const net = await open();
      this.net = net;
      if (net.isHost) net.map = this.play?.world.mapId ?? 'snowPeak';
      if (net.isHost) net.difficulty = this.save.data.settings.difficulty;
      this.bindNet(net);
      if (net.isHost) net.pushLobby();
    } catch (e) {
      this.menus.onlineStatus = (e as Error).message || 'Could not connect.';
    }
    this.menus.show('online');
  }

  private bindNet(net: NetSession): void {
    const refresh = () => {
      if (this.menus.current === 'online') this.menus.show('online');
    };
    net.onLobby = refresh;
    net.onStart = (info) => void this.playOnline(info);
    // Only the race being loaded for this room counts (a go can arrive mid-load: markReady replays it).
    net.onGo = () => {
      if (this.play?.online && this.state !== 'loading') this.play.netGo();
    };
    net.onStates = (list) => this.play?.netStates(list);
    net.onFin = (id, time) => this.play?.netFin(id, time);
    net.onKo = (target, from) => this.play?.netKo(target, from);
    net.onLeft = (id) => {
      this.play?.netLeft(id);
      refresh();
    };
    net.onLobbyReturn = () => this.toLobby();
    net.onClosed = (reason) => {
      this.net = null;
      this.menus.onlineStatus = reason;
      if (this.state !== 'menu') this.quitToMenu();
      this.menus.show('online');
    };
  }

  private leaveRoom(): void {
    this.net?.close();
    this.net = null;
    this.menus.show('online');
  }

  /** Host: grid = the players (host first), then bots to fill it if wanted. */
  private startOnline(): void {
    const net = this.net;
    if (!net?.isHost) return;
    const humans = net.players.map((p) => ({ id: p.id, name: p.name, kind: 'human' as const, look: p.look, paint: p.paint, color: p.color }));
    const bots = net.bots ? Race.botRoster(net.map, Math.max(0, NET.gridSize - humans.length)) : [];
    net.start({ map: net.map, difficulty: net.difficulty, roster: [...humans, ...bots] });
  }

  /** Load the mountain with this grid, line up, and tell the host we're ready. */
  private async playOnline(info: StartInfo): Promise<void> {
    const net = this.net;
    if (!net) return;
    this.menus.hide();
    this.setState('loading');
    this.loading.show('Loading…', `${mapTitle(info.map)} · online race`);
    const old = this.play;
    this.play = null;
    this.mode = null;
    old?.dispose();
    await this.createPlay(info.map, (p, msg) => this.loading.set(p, msg), { selfId: net.selfId, isHost: net.isHost, roster: info.roster });
    this.loading.hide();
    this.startRun();
    net.markReady();
  }

  /** Online: out of the race (finished or left) and back to the room. */
  private toLobby(): void {
    // Local only: others may still be racing (the host can start the next race any time).
    if (this.net) this.net.racing = false;
    this.finishTimer = -1;
    this.play?.enterMenu();
    this.setState('menu');
    this.menus.show('online');
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
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
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
    // Gamepad players may never click or type: try to start audio on pad use too.
    if (!this.audio.running && this.input.lastDevice === 'gamepad') this.audio.unlock();
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
    // After the mode: a menu press that starts a run must not also count as an in-run press.
    if (this.menus.open && !this.input.capturing) this.menus.nav.update(realDt);
    else this.menus.nav.sync();
    for (const hook of this.frameHooks) hook(realDt);
  }

  /** Gamepad B in a menu: one screen back (pause closes, results stay). */
  private menuBack(): void {
    const cur = this.menus.current;
    if (cur === 'main' || cur === 'results') return;
    if (cur === 'pause') return this.resume();
    // Screens with their own Back / Done / Got it button: press it (it knows where to return).
    const own = this.menus.root.querySelector<HTMLElement>(cur === 'controls' ? '.row .btn.primary' : '[data-back]');
    if (own) own.click();
    else this.menus.show(this.state === 'paused' ? 'pause' : 'main');
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
