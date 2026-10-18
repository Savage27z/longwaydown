import { TRICKS } from '../config/stunts';
import type { VehicleId } from '../config/vehicles';
import type { LandInfo } from '../vehicles/Vehicle';

export interface Trick {
  name: string;
  points: number;
}

const FLIP_NAMES = ['', '', 'Double ', 'Triple ', 'Quad '];

/** Grab names by vehicle family. */
function grabName(v: VehicleId): string {
  if (v === 'snowboard') return 'Indy';
  if (v === 'skis') return 'Mute';
  if (v === 'bicycle' || v === 'mountainBike') return 'No-Hander';
  if (v === 'motorbike') return 'Superman';
  return 'Grab';
}

/** Name and score a clean landing; null for a hop with nothing in it. */
export function scoreLanding(info: LandInfo, vehicle: VehicleId): Trick | null {
  if (info.airTime < TRICKS.minAir) return null;
  const parts: string[] = [];
  let points = Math.round(info.airTime * TRICKS.airPerSecond);
  const halfSpins = Math.abs(info.spins);
  if (halfSpins >= 2) {
    parts.push(String(halfSpins * 180));
    points += halfSpins * TRICKS.halfSpin;
  }
  const flips = Math.abs(info.flips);
  if (flips >= 1) {
    parts.push(`${FLIP_NAMES[Math.min(flips, 4)] ?? `${flips}x `}${info.flips > 0 ? 'Frontflip' : 'Backflip'}`);
    points += flips * TRICKS.flip;
  }
  if (info.grabTime >= TRICKS.grabMin) {
    parts.push(grabName(vehicle));
    points += Math.round(TRICKS.grab + info.grabTime * TRICKS.grabPerSecond);
  }
  if (info.switchLanding) {
    parts.unshift('Switch');
    points += TRICKS.switchLanding;
  }
  if (info.height >= TRICKS.bigAirHeight) {
    parts.push('Big Air');
    points += TRICKS.bigAir;
  }
  return { name: parts.length ? parts.join(' ') : 'Air', points };
}

/**
 * Chains landings into a combo: each trick within the window adds to the chain and raises the
 * multiplier; the chain banks when the window runs out, and a crash loses it.
 */
export class TrickCombo {
  tricks = 0;
  raw = 0;
  timer = 0;
  best = 0;

  get mult(): number {
    return Math.min(TRICKS.maxMult, Math.max(1, this.tricks));
  }

  get value(): number {
    return this.raw * this.mult;
  }

  add(t: Trick): void {
    this.tricks++;
    this.raw += t.points;
    this.timer = TRICKS.comboWindow;
  }

  /** Advance; returns the banked score when the chain ends (0 otherwise). */
  update(dt: number): number {
    if (this.tricks === 0) return 0;
    this.timer -= dt;
    if (this.timer > 0) return 0;
    return this.bank();
  }

  bank(): number {
    const v = this.value;
    this.best = Math.max(this.best, v);
    this.tricks = 0;
    this.raw = 0;
    this.timer = 0;
    return v;
  }

  /** Crash: the unbanked chain is lost. Returns what was lost. */
  lose(): number {
    const v = this.value;
    this.tricks = 0;
    this.raw = 0;
    this.timer = 0;
    return v;
  }

  reset(): void {
    this.lose();
    this.best = 0;
  }
}
