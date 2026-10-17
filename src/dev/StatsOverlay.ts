import type { Game } from '../core/Game';

interface PerfMemory {
  usedJSHeapSize: number;
}

/** Dev-only FPS / draw-call / memory counter. */
export class StatsOverlay {
  readonly el = document.createElement('div');
  /** Extra lines other dev systems can contribute. */
  readonly extra = new Map<string, () => string>();
  private frames = 0;
  private acc = 0;
  private fps = 0;
  private worstMs = 0;

  constructor(private readonly game: Game) {
    this.el.className = 'dev-stats';
    document.body.appendChild(this.el);
  }

  tick(realDt: number): void {
    this.frames++;
    this.acc += realDt;
    this.worstMs = Math.max(this.worstMs, realDt * 1000);
    if (this.acc < 0.5) return;
    this.fps = this.frames / this.acc;
    const info = this.game.renderer.renderer.info;
    const mem = (performance as unknown as { memory?: PerfMemory }).memory;
    const world = this.game.physics.world;
    const lines = [
      `FPS ${this.fps.toFixed(0).padStart(3)}  worst ${this.worstMs.toFixed(1)}ms  cpu ${this.game.loop.frameMs.toFixed(1)}ms`,
      `draws ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k`,
      `geo ${info.memory.geometries}  tex ${info.memory.textures}  prog ${info.programs?.length ?? 0}`,
      `bodies ${world.bodies.len()}  colliders ${world.colliders.len()}`,
      mem ? `heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : 'heap n/a',
    ];
    for (const [k, fn] of this.extra) lines.push(`${k} ${fn()}`);
    this.el.textContent = lines.join('\n');
    this.frames = 0;
    this.acc = 0;
    this.worstMs = 0;
  }

  dispose(): void {
    this.el.remove();
  }
}
