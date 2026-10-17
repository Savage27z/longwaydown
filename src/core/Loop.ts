import { WORLD } from '../config/world';

export interface LoopHandlers {
  /** Runs at a fixed rate (WORLD.physicsHz). `dt` is always the fixed step. */
  fixedUpdate(dt: number): void;
  /**
   * Runs once per rendered frame.
   * @param realDt  wall-clock seconds since last frame (clamped)
   * @param simDt   realDt scaled by timeScale (slow-mo aware)
   * @param alpha   interpolation factor between the last two physics states [0, 1)
   */
  update(realDt: number, simDt: number, alpha: number): void;
  render(alpha: number): void;
}

/** Fixed-timestep simulation with variable-rate rendering and interpolation. */
export class Loop {
  readonly fixedDt = 1 / WORLD.physicsHz;
  timeScale = 1;
  /** Steps executed during the last frame (for stats). */
  lastSteps = 0;
  /** Total simulated seconds. */
  simTime = 0;
  frameMs = 0;

  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;

  constructor(private readonly handlers: LoopHandlers) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Drop accumulated time (after long hitches, loading, or teleports). */
  resetAccumulator(): void {
    this.acc = 0;
    this.last = performance.now();
  }

  /**
   * Run frames synchronously with a synthetic clock (tests / automation / hidden tabs where
   * requestAnimationFrame is paused). Returns the number of frames run.
   */
  advance(seconds: number, frameDt = 1 / 60): number {
    let frames = 0;
    for (let t = 0; t < seconds - 1e-9; t += frameDt) {
      this.tick(frameDt);
      frames++;
    }
    this.last = performance.now();
    return frames;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const realDt = Math.min((now - this.last) / 1000, WORLD.maxFrameDt);
    this.last = now;
    this.tick(realDt);
  };

  private tick(realDt: number): void {
    const t0 = performance.now();
    const simDt = realDt * this.timeScale;
    this.acc += simDt;

    let steps = 0;
    while (this.acc >= this.fixedDt && steps < WORLD.maxStepsPerFrame) {
      this.handlers.fixedUpdate(this.fixedDt);
      this.acc -= this.fixedDt;
      this.simTime += this.fixedDt;
      steps++;
    }
    // If we hit the cap we are behind; drop the backlog instead of spiralling.
    if (steps >= WORLD.maxStepsPerFrame) this.acc = 0;
    this.lastSteps = steps;

    const alpha = this.acc / this.fixedDt;
    this.handlers.update(realDt, simDt, alpha);
    this.handlers.render(alpha);
    this.frameMs = performance.now() - t0;
  }
}
