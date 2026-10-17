import * as THREE from 'three';
import type { Game } from '../core/Game';
import { events } from '../core/Events';
import type { PlayMode } from '../core/PlayMode';
import type { VehicleInput } from '../vehicles/Vehicle';
import { clamp, wrapAngle } from '../utils/math';
import { yieldTask } from '../utils/yieldTask';

const _g = new THREE.Vector3();

export interface AutoRideReport {
  simSeconds: number;
  progressKm: number;
  finished: boolean;
  crashes: { s: number; reason: string }[];
  respawns: { s: number; reason: string }[];
  lands: number;
  /** Landings after real air (> 0.3 s). */
  airs: { s: number; air: number; height: number; impact: number }[];
  maxKmh: number;
  splits: { km: number; t: number; kmh: number }[];
  wallMs: number;
}

/**
 * Dev bot: follows the course line with full throttle so physics/streaming can be tested end to
 * end. `run()` fast-forwards in chunks (no rendering) and yields so terrain workers keep up.
 */
export class AutoRider {
  enabled = false;
  lookAhead = 22;
  lateralBias = 0;
  /** Line up on jumps/kickers ahead (and pop off the lip). */
  seekJumps = true;
  report: AutoRideReport | null = null;
  private running = false;

  constructor(
    private readonly game: Game,
    private readonly mode: PlayMode,
  ) {}

  attach(): void {
    this.mode.player.inputOverride = (i) => {
      if (this.enabled) this.drive(i);
    };
  }

  private drive(i: VehicleInput): void {
    const p = this.mode.player;
    const c = this.mode.world.course;
    const prog = p.progress.result;
    const idx = Math.min(c.count - 1, Math.round((prog.s + this.lookAhead) / c.step));
    const g = p.globalPosition(_g);
    let bias = this.lateralBias;
    let pop = false;
    if (this.seekJumps) {
      const f = c.features.find((x) => (x.type === 'jump' || x.type === 'kicker' || x.type === 'gap') && x.s > prog.s - 2 && x.s < prog.s + 160);
      if (f) {
        bias = f.lateral;
        pop = Math.abs(f.s - prog.s) < 2.5;
      }
    }
    const tx = c.x[idx]! - c.tz[idx]! * bias;
    const tz = c.z[idx]! + c.tx[idx]! * bias;
    const desired = Math.atan2(tx - g.x, tz - g.z);
    const heading = p.vehicle.telemetry.heading;
    i.steer = clamp(wrapAngle(heading - desired) * 2.5, -1, 1);
    i.throttle = 1;
    i.brake = 0;
    i.pitch = 0;
    i.spin = 0;
    i.jumpPressed = pop;
  }

  /** Fast-forward up to `maxSeconds` of riding (or until the finish). */
  async run(maxSeconds = 1800, chunk = 1): Promise<AutoRideReport> {
    if (this.running) return this.report!;
    this.running = true;
    this.attach();
    this.enabled = true;
    const c = this.mode.world.course;
    const report: AutoRideReport = { simSeconds: 0, progressKm: 0, finished: false, crashes: [], respawns: [], lands: 0, airs: [], maxKmh: 0, splits: [], wallMs: 0 };
    this.report = report;
    const offs = [
      events.on('player:crash', (e) => report.crashes.push({ s: Math.round(this.mode.player.progress.result.s), reason: e.reason })),
      events.on('player:respawn', (e) => report.respawns.push({ s: Math.round(this.mode.player.progress.result.s), reason: e.reason })),
      events.on('player:land', (l) => {
        report.lands++;
        if (l.airTime > 0.3) report.airs.push({ s: Math.round(this.mode.player.progress.result.s), air: +l.airTime.toFixed(2), height: +l.height.toFixed(1), impact: +l.impact.toFixed(1) });
      }),
    ];
    const t0 = performance.now();
    let nextKm = 1;
    while (report.simSeconds < maxSeconds) {
      this.game.simulate(chunk);
      report.simSeconds += chunk;
      const s = this.mode.player.progress.result.s;
      const kmh = this.mode.player.vehicle.telemetry.speed * 3.6;
      report.maxKmh = Math.max(report.maxKmh, kmh);
      report.progressKm = s / 1000;
      while (s >= nextKm * 1000) {
        report.splits.push({ km: nextKm, t: Math.round(report.simSeconds), kmh: Math.round(kmh) });
        nextKm++;
      }
      if (s > c.length - 60) {
        report.finished = true;
        break;
      }
      // Yield so worker messages (tiles) can arrive; wait longer if streaming is behind.
      const pending = this.mode.world.chunks.counts.pending;
      await yieldTask(pending > 6 ? 60 : 4);
    }
    report.wallMs = Math.round(performance.now() - t0);
    for (const off of offs) off();
    this.enabled = false;
    this.running = false;
    return report;
  }
}
