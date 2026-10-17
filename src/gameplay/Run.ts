import { RUN } from '../config/gameplay';
import type { MapId } from '../config/maps';
import { events } from '../core/Events';
import type { BestTime } from '../core/Save';
import { Checkpoints } from './Checkpoints';

export type RunState = 'idle' | 'intro' | 'countdown' | 'running' | 'finished';

export interface RunResults {
  mapId: MapId;
  /** Final time including penalties (s). */
  time: number;
  penalties: number;
  distance: number;
  topSpeed: number;
  biggestAirTime: number;
  biggestAirHeight: number;
  trickScore: number;
  pickups: number;
  crashes: number;
  splits: number[];
  previousBest: number | null;
  newRecord: boolean;
}

export interface RunFrame {
  progressS: number;
  speed: number;
}

/** Timer, distance, score and lifecycle of one run from the summit to the finish. */
export class Run {
  state: RunState = 'idle';
  /** Riding time (s), excluding penalties. */
  time = 0;
  penalties = 0;
  topSpeed = 0;
  biggestAirTime = 0;
  biggestAirHeight = 0;
  trickScore = 0;
  pickups = 0;
  crashes = 0;
  distance = 0;
  /** Seconds the timer is frozen for (Time Freeze buff). */
  freeze = 0;
  readonly checkpoints: Checkpoints;
  private stateTime = 0;
  private countdownN = 0;
  private offs: (() => void)[] = [];

  constructor(
    readonly mapId: MapId,
    checkpointPositions: number[],
    readonly startS: number,
    readonly finishS: number,
    private readonly best: BestTime | null,
  ) {
    this.checkpoints = new Checkpoints(checkpointPositions, startS, best?.splits ?? null);
    this.offs.push(
      events.on('player:crash', (e) => {
        if (this.state !== 'running') return;
        this.crashes++;
        this.addPenalty(e.penalty, e.reason);
      }),
      events.on('player:land', (l) => {
        if (this.state !== 'running') return;
        this.biggestAirTime = Math.max(this.biggestAirTime, l.airTime);
        this.biggestAirHeight = Math.max(this.biggestAirHeight, l.height);
      }),
    );
  }

  get total(): number {
    return this.time + this.penalties;
  }

  get bestTime(): number | null {
    return this.best?.time ?? null;
  }

  private setState(s: RunState): void {
    this.state = s;
    this.stateTime = 0;
    events.emit('run:state', { state: s });
  }

  /** Reset all stats and start from the intro (or straight to the countdown). */
  begin(skipIntro = false): void {
    this.time = 0;
    this.penalties = 0;
    this.topSpeed = 0;
    this.biggestAirTime = 0;
    this.biggestAirHeight = 0;
    this.trickScore = 0;
    this.pickups = 0;
    this.crashes = 0;
    this.distance = 0;
    this.freeze = 0;
    this.checkpoints.reset();
    this.setState(skipIntro ? 'countdown' : 'intro');
    this.countdownN = RUN.countdownFrom + 1;
  }

  skipIntro(): void {
    if (this.state === 'intro') {
      this.setState('countdown');
      this.countdownN = RUN.countdownFrom + 1;
    }
  }

  addPenalty(seconds: number, reason: string): void {
    this.penalties += seconds;
    events.emit('run:penalty', { seconds, reason });
  }

  /** Per frame. `realDt` drives intro/countdown, `simDt` drives the race clock. */
  update(realDt: number, simDt: number, f: RunFrame): void {
    this.stateTime += realDt;
    switch (this.state) {
      case 'intro':
        if (this.stateTime >= RUN.introDuration) {
          this.setState('countdown');
          this.countdownN = RUN.countdownFrom + 1;
        }
        break;
      case 'countdown': {
        const n = RUN.countdownFrom - Math.floor(this.stateTime / RUN.countdownStep);
        if (n < this.countdownN) {
          this.countdownN = n;
          events.emit('run:countdown', { n: Math.max(0, n) });
        }
        if (n < 0 || (n === 0 && this.stateTime >= (RUN.countdownFrom + 0.15) * RUN.countdownStep)) this.setState('running');
        break;
      }
      case 'running': {
        if (this.freeze > 0) this.freeze = Math.max(0, this.freeze - simDt);
        else this.time += simDt;
        this.topSpeed = Math.max(this.topSpeed, f.speed);
        this.distance = Math.max(this.distance, f.progressS - this.startS);
        this.checkpoints.update(f.progressS, this.total);
        if (f.progressS >= this.finishS) {
          this.setState('finished');
          events.emit('run:finish', { results: this.results() });
        }
        break;
      }
      default:
        break;
    }
  }

  results(): RunResults {
    const prev = this.best?.time ?? null;
    return {
      mapId: this.mapId,
      time: this.total,
      penalties: this.penalties,
      distance: this.distance,
      topSpeed: this.topSpeed,
      biggestAirTime: this.biggestAirTime,
      biggestAirHeight: this.biggestAirHeight,
      trickScore: this.trickScore,
      pickups: this.pickups,
      crashes: this.crashes,
      splits: [...this.checkpoints.splits],
      previousBest: prev,
      newRecord: prev === null || this.total < prev,
    };
  }

  /** Is the rider allowed to move? */
  get frozen(): boolean {
    return this.state === 'idle' || this.state === 'intro' || this.state === 'countdown';
  }

  dispose(): void {
    for (const off of this.offs) off();
  }
}
