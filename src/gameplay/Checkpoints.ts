import { events } from '../core/Events';

export interface CheckpointInfo {
  index: number;
  s: number;
}

/** Ordered checkpoints along the course. Reached when progress passes them (so jets that skip sections still collect them). */
export class Checkpoints {
  readonly list: CheckpointInfo[];
  /** Index of the last reached checkpoint (-1 = start). */
  last = -1;
  readonly splits: number[] = [];

  constructor(
    positions: number[],
    private readonly startS: number,
    private readonly bestSplits: number[] | null,
  ) {
    this.list = positions.map((s, index) => ({ index, s }));
  }

  reset(): void {
    this.last = -1;
    this.splits.length = 0;
  }

  /** Distance along the course to respawn at (last checkpoint, or the start). */
  respawnS(): number {
    return this.last >= 0 ? this.list[this.last]!.s + 2 : this.startS;
  }

  update(progressS: number, time: number): void {
    while (this.last + 1 < this.list.length && progressS >= this.list[this.last + 1]!.s) {
      this.last++;
      this.splits[this.last] = time;
      const best = this.bestSplits?.[this.last];
      events.emit('run:checkpoint', {
        index: this.last,
        count: this.list.length,
        time,
        delta: best !== undefined ? time - best : null,
      });
    }
  }
}
