import GUI from 'lil-gui';
import type { Game, GameMode } from '../core/Game';
import type { QualityPreset } from '../config/graphics';
import { StatsOverlay } from './StatsOverlay';
import { PhysicsDebug } from './PhysicsDebug';
import { AutoRider } from './AutoRider';
import { installFilmstrip } from './Filmstrip';
import type { PlayMode } from '../core/PlayMode';
import { events } from '../core/Events';
import { VEHICLES } from '../config/vehicles';

/**
 * Dev tuning panel (lil-gui) + stats + physics debug. Only ever loaded through a dynamic
 * import guarded by `import.meta.env.DEV`, so none of this ships in production.
 * Toggle the panel with the ~ (Backquote) key.
 */
export class DevTools {
  readonly gui = new GUI({ title: 'Dev (~ to toggle)' });
  readonly stats: StatsOverlay;
  readonly physicsDebug: PhysicsDebug;
  private folders = new Map<string, GUI>();

  constructor(readonly game: Game) {
    this.stats = new StatsOverlay(game);
    this.physicsDebug = new PhysicsDebug(game);
    this.gui.hide();
    this.gui.domElement.style.zIndex = '60';

    const engine = this.folder('Engine');
    const params = {
      quality: game.quality as QualityPreset,
      physicsDebug: false,
      timeScale: 1,
    };
    engine.add(params, 'quality', ['low', 'medium', 'high']).onChange((q: QualityPreset) => game.setQuality(q));
    engine.add(params, 'physicsDebug').onChange((v: boolean) => this.physicsDebug.setEnabled(v));
    engine.add(params, 'timeScale', 0.05, 2, 0.05).onChange((v: number) => (game.loop.timeScale = v));
    engine.close();

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Backquote') return;
      if (this.gui._hidden) this.gui.show();
      else this.gui.hide();
    });

    // Keep the stats folder pointed at whatever is being ridden.
    events.on('player:switch', ({ to }) => {
      if (!this.folders.has('Vehicle stats')) return;
      this.removeFolder('Vehicle stats');
      this.addConfig('Vehicle stats', VEHICLES[to] as unknown as Record<string, unknown>).close();
    });

    game.frameHooks.add((dt) => {
      this.stats.tick(dt);
      this.physicsDebug.tick();
    });
  }

  /** Expose the active mode's tuning objects. */
  private modeFolders: string[] = [];

  attachMode(mode: GameMode): void {
    for (const name of this.modeFolders) this.removeFolder(name);
    this.modeFolders = [];
    const tuning = mode.devTuning?.() ?? {};
    for (const [name, obj] of Object.entries(tuning)) {
      this.addConfig(name, obj);
      this.modeFolders.push(name);
    }
    if ('player' in mode) {
      const bot = new AutoRider(this.game, mode as PlayMode);
      bot.attach();
      (window as unknown as Record<string, unknown>).__bot = bot;
      const f = this.folder('Auto rider');
      this.modeFolders.push('Auto rider');
      f.add(bot, 'enabled').name('drive (real time)');
      f.add(bot, 'lookAhead', 5, 60, 1);
      f.add({ fastForward: () => void bot.run().then((r) => console.info('[AutoRider]', r)) }, 'fastForward');
    }
  }

  /** Get or create a top-level folder. */
  folder(name: string): GUI {
    let f = this.folders.get(name);
    if (!f) {
      f = this.gui.addFolder(name);
      this.folders.set(name, f);
    }
    return f;
  }

  /**
   * Add every numeric/boolean/function field of a plain config object as controllers.
   * An optional `__ranges` field maps keys to [min, max, step]; `__options` maps string keys to choices.
   */
  addConfig(folderName: string, obj: Record<string, unknown>, ranges: Record<string, [number, number, number?]> = {}): GUI {
    const f = this.folder(folderName);
    const r2 = { ...((obj.__ranges as Record<string, [number, number, number?]>) ?? {}), ...ranges };
    ranges = r2;
    const options = (obj.__options as Record<string, string[]>) ?? {};
    for (const key of Object.keys(obj)) {
      if (key.startsWith('__')) continue;
      const v = obj[key];
      if (typeof v === 'function') {
        f.add(obj, key);
      } else if (typeof v === 'number') {
        const r = ranges[key];
        if (r) f.add(obj, key, r[0], r[1], r[2]);
        else f.add(obj, key);
      } else if (typeof v === 'boolean') {
        f.add(obj, key);
      } else if (typeof v === 'string' && options[key]) {
        f.add(obj, key, options[key]);
      }
    }
    return f;
  }

  removeFolder(name: string): void {
    this.folders.get(name)?.destroy();
    this.folders.delete(name);
  }
}

export function installDevTools(game: Game): DevTools {
  const dev = new DevTools(game);
  const w = window as unknown as Record<string, unknown>;
  w.__game = game;
  w.__dev = dev;
  installFilmstrip(game);
  return dev;
}
