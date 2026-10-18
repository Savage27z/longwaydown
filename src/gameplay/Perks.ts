import { BOOST, NEAR_MISS, PICKUPS, THROW, TRICKS, type PickupKind } from '../config/stunts';
import type { VehicleId } from '../config/vehicles';
import type { GameEvents } from '../core/Events';
import type { LandInfo, RideModifiers } from '../vehicles/Vehicle';
import { scoreLanding, TrickCombo } from './Tricks';

export type BuffId = 'grip' | 'speed' | 'lowGravity' | 'shield';

export interface Buff {
  id: BuffId;
  /** Seconds left and total. */
  t: number;
  dur: number;
}

export type PerkEvent = 'trick:land' | 'trick:bank' | 'trick:lost' | 'rider:nearMiss' | 'rider:pickup';
type Emit = <K extends PerkEvent>(type: K, payload: GameEvents[K]) => void;

/**
 * One rider's boost meter, trick combo, buffs and near-misses. Every rider has one (the bots
 * earn and spend boost by the same rules); the rider forwards its events, so only the local
 * rider's reach the HUD and the run.
 */
export class RiderPerks {
  boost = BOOST.start;
  readonly combo = new TrickCombo();
  buffs: Buff[] = [];
  trickScore = 0;
  nearMisses = 0;
  pickups = 0;
  /** Bottles / stones to throw (max THROW.max) and hits landed. */
  ammo = 0;
  knockouts = 0;
  private missCooldown = 0;
  private lastMiss = '';

  constructor(private readonly emit: Emit) {}

  reset(): void {
    this.boost = BOOST.start;
    this.combo.reset();
    this.buffs = [];
    this.trickScore = 0;
    this.nearMisses = 0;
    this.pickups = 0;
    this.ammo = 0;
    this.knockouts = 0;
    this.missCooldown = 0;
    this.lastMiss = '';
  }

  has(id: BuffId): boolean {
    return this.buffs.some((b) => b.id === id);
  }

  /** Write this step's ride modifiers from the buffs and the meter. */
  applyMods(m: RideModifiers): void {
    m.topSpeedMul = this.has('speed') ? PICKUPS.speedMul : 1;
    m.gripMul = 1;
    m.gripOverride = this.has('grip');
    m.gravityMul = this.has('lowGravity') ? PICKUPS.gravityMul : 1;
    m.boostAvailable = this.boost > 0.005;
  }

  /** Per physics step while riding: meter drain/refill, buff timers, combo banking. */
  step(dt: number, speed: number, boosting: boolean, canBoost: boolean): void {
    if (boosting && canBoost) this.boost -= BOOST.drain * dt;
    else this.boost += (BOOST.passive + (speed > BOOST.speedFrom ? BOOST.speedGain : 0)) * dt;
    this.boost = Math.max(0, Math.min(1, this.boost));
    for (const b of this.buffs) b.t -= dt;
    this.buffs = this.buffs.filter((b) => b.t > 0);
    this.missCooldown = Math.max(0, this.missCooldown - dt);
    const banked = this.combo.update(dt);
    if (banked > 0) {
      this.trickScore += banked;
      this.emit('trick:bank', { points: banked });
    }
  }

  land(info: LandInfo, vehicle: VehicleId): void {
    this.gain(info.airTime * BOOST.perAirSecond);
    const t = scoreLanding(info, vehicle);
    if (!t) return;
    this.combo.add(t);
    this.gain(Math.min(BOOST.perLandingMax, t.points * BOOST.perPoint));
    this.emit('trick:land', { name: t.name, points: t.points, mult: this.combo.mult, combo: this.combo.value });
  }

  crash(): void {
    const lost = this.combo.lose();
    if (lost > 0) this.emit('trick:lost', { points: lost });
  }

  /** Shield buff: swallow a crash once. */
  absorbCrash(): boolean {
    const i = this.buffs.findIndex((b) => b.id === 'shield');
    if (i < 0) return false;
    this.buffs.splice(i, 1);
    return true;
  }

  /** A close pass (key identifies the obstacle so one tree only counts once). */
  nearMiss(key: string): void {
    if (this.missCooldown > 0 || key === this.lastMiss) return;
    this.missCooldown = NEAR_MISS.cooldown;
    this.lastMiss = key;
    this.nearMisses++;
    this.gain(BOOST.nearMiss);
    this.trickScore += TRICKS.nearMissPoints;
    this.emit('rider:nearMiss', { points: TRICKS.nearMissPoints });
  }

  pickup(kind: PickupKind): void {
    this.pickups++;
    if (kind === 'boost') this.gain(PICKUPS.boostFill);
    else if (kind === 'bottle') this.ammo = Math.min(THROW.max, this.ammo + THROW.perPickup);
    else if (kind !== 'freeze') {
      const dur = PICKUPS[kind as BuffId];
      this.buffs = this.buffs.filter((b) => b.id !== (kind as BuffId));
      this.buffs.push({ id: kind as BuffId, t: dur, dur });
    }
    this.emit('rider:pickup', { kind });
  }

  private gain(v: number): void {
    this.boost = Math.min(1, this.boost + v);
  }
}
