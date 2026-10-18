import * as THREE from 'three';
import { BOT_MISTAKES, BOT_SWITCH } from '../config/race';
import type { VehicleId } from '../config/vehicles';
import type { InputSource } from '../player/InputSource';
import type { PlayerController } from '../player/PlayerController';
import type { VehicleInput } from '../vehicles/Vehicle';
import type { World } from '../world/World';
import { clamp, wrapAngle } from '../utils/math';
import { makeRng, type Rng } from '../utils/rng';

const _g = new THREE.Vector3();
/** Gravity-only vehicles. */
const GLIDERS = new Set<VehicleId>(['snowboard', 'skis']);

export interface BotSkill {
  /** 0..1: line accuracy, boost use, jump commitment, how rarely it makes mistakes. */
  level: number;
  /** Preferred lane: metres right of the course line. */
  lane: number;
  /** Phase offset for this bot's boost and wobble rhythms. */
  seed: number;
}

/** A slip a human rider makes: runs wide, backs off, brakes nervously, gets wobbly. */
type Mistake = { kind: 'wide' | 'lift' | 'brake' | 'wobble'; t: number; dir: number };

/**
 * A bot's controls, from the same information a player has: the course line ahead, the jumps on
 * it and its own speed. It runs off the summit, flies the wingsuit down toward the line, then
 * rides its lane with boost on the straights and pops the lips it lines up for. Like a person it
 * makes mistakes (more often the lower its skill): wide lines, lifts, nervous braking, wobbles,
 * missed lips and fumbled landings that can end in a real crash.
 */
export class BotDriver implements InputSource {
  rider: PlayerController | null = null;
  /** Race rubber band: >1 pushes harder (more boost), <1 eases off. */
  push = 1;
  /** Mistakes made so far (for tests / tuning). */
  mistakes = 0;
  /** Difficulty: scales mistake odds and boost use. */
  mistakeMul = 1;
  boostMul = 1;
  /** Seconds until this bot may switch vehicle again. */
  switchCooldown = 0;
  /** Set by the race when this bot decides to throw at someone lined up ahead. */
  throwNow = false;
  private t = 0;
  private rng: Rng;
  private slip: Mistake | null = null;
  /** The jump (by course s) this bot decided to skip, and whether it fumbles the current air. */
  private skipJumpS = -1;
  private decidedJumpS = -1;
  private fumble = 0;
  private trick: 'spin' | 'flip' | null = null;
  private trickDir = 1;
  private wasGrounded = true;

  constructor(
    private readonly world: World,
    readonly skill: BotSkill,
  ) {
    this.rng = makeRng(`bot:${skill.seed}`);
  }

  read(i: VehicleInput): void {
    i.throttle = 0;
    i.brake = 0;
    i.steer = 0;
    i.pitch = 0;
    i.spin = 0;
    i.jumpPressed = false;
    i.jumpHeld = false;
    i.boost = false;
    i.trick = false;
    i.throwPressed = this.throwNow;
    this.throwNow = false;
    const p = this.rider;
    if (!p) return;
    const dt = 1 / 60;
    this.t += dt;
    this.switchCooldown = Math.max(0, this.switchCooldown - dt);
    const id = p.vehicle.id;
    if (id === 'onFoot') this.run(p, i);
    else if (id === 'wingsuit') this.fly(p, i);
    else {
      this.ride(p, i);
      if (!p.frozen) this.mistake(p, i, dt);
      this.maybeWingsuit(p);
    }
  }

  /** Off a big air, sometimes pull the wingsuit and glide (it lands back on the ground vehicle). */
  private airDecided = false;
  private maybeWingsuit(p: PlayerController): void {
    const tel = p.vehicle.telemetry;
    if (tel.grounded) {
      this.airDecided = false;
      return;
    }
    if (this.airDecided || this.switchCooldown > 0 || this.fumble > 0 || p.heightAboveGround() < BOT_SWITCH.wingsuitHeight) return;
    this.airDecided = true;
    if (this.rng() < BOT_SWITCH.wingsuitOnAir * (0.6 + this.skill.level * 0.5) && p.switchTo('wingsuit', { hop: false })) this.switchCooldown = BOT_SWITCH.cooldown;
  }

  /** Roll for a vehicle change at a checkpoint: returns the vehicle to switch to, or null. */
  pickSwitch(garage: VehicleId[], current: VehicleId): VehicleId | null {
    if (this.switchCooldown > 0 || garage.length < 2 || this.rng() > BOT_SWITCH.atCheckpoint) return null;
    const others = garage.filter((v) => v !== current);
    return others[Math.floor(this.rng() * others.length)] ?? null;
  }

  /** Mistakes per second: everyone makes some, weaker riders far more. */
  private get rate(): number {
    const m = BOT_MISTAKES;
    return (m.baseRate + (1 - this.skill.level) * m.skillRate) * (2 - this.push) * this.mistakeMul;
  }

  private mistake(p: PlayerController, i: VehicleInput, dt: number): void {
    const tel = p.vehicle.telemetry;
    // Fumbled air: on a real jump (not a hop off a bump) it may throw the rotation off and land
    // badly, often a crash. Decided once per air, once it has lasted a moment.
    if (tel.grounded) this.wasGrounded = true;
    else if (this.wasGrounded && tel.airTime > 0.3 && p.heightAboveGround() > 1.5) {
      this.wasGrounded = false;
      this.fumble = this.rng() < BOT_MISTAKES.fumbleChance * (1.2 - this.skill.level) * this.mistakeMul ? 0.35 + this.rng() * 0.5 : 0;
      if (this.fumble > 0) this.mistakes++;
      // A fumbled air gets no help squaring up for the landing.
      (p.vehicle as unknown as { assist: boolean }).assist = this.fumble <= 0;
      // Otherwise maybe a trick (it feeds the boost meter): a 360, or a backflip off a big one.
      this.trick = null;
      const h = p.heightAboveGround();
      if (this.fumble <= 0 && h > 3 && this.rng() < 0.2 + this.skill.level * 0.4) {
        this.trick = h > 6 && this.skill.level > 0.7 && this.rng() < 0.4 ? 'flip' : 'spin';
        this.trickDir = this.rng() < 0.5 ? -1 : 1;
      }
    }
    if (tel.grounded) {
      this.trick = null;
      (p.vehicle as unknown as { assist: boolean }).assist = true;
    }
    if (!tel.grounded && this.fumble > 0) {
      this.fumble -= dt;
      i.pitch = this.skill.seed > 5 ? 1 : -1;
      i.spin = 0.6;
    } else if (this.trick) {
      // Rotate until one full turn is in, then let the landing assist square it up.
      const a = p.vehicle as unknown as { trickYaw: number; trickPitch: number };
      const done = Math.abs(this.trick === 'spin' ? a.trickYaw : a.trickPitch) > Math.PI * 2 * 0.9;
      if (done) this.trick = null;
      else if (this.trick === 'spin') i.spin = this.trickDir;
      else i.pitch = -1;
    }
    // Ongoing slip.
    const s = this.slip;
    if (s) {
      s.t -= dt;
      // Steering slips are gentler at speed (a wide line, not a swerve into the trees).
      const k = clamp(18 / Math.max(tel.speed, 1), 0.25, 1);
      if (s.kind === 'wide') i.steer = clamp(i.steer + s.dir * 0.55 * k, -1, 1);
      else if (s.kind === 'lift') {
        i.throttle = 0;
        i.boost = false;
      } else if (s.kind === 'brake') {
        i.brake = Math.max(i.brake, 0.55);
        i.throttle = 0;
        i.boost = false;
      } else i.steer = clamp(i.steer + Math.sin(this.t * 9) * 0.7 * k, -1, 1);
      if (s.t <= 0) this.slip = null;
      return;
    }
    if (!tel.grounded || tel.speed < 8 || this.rng() > this.rate * dt) return;
    const r = this.rng();
    const kind: Mistake['kind'] = r < 0.35 ? 'wide' : r < 0.6 ? 'lift' : r < 0.8 ? 'brake' : 'wobble';
    const dur = { wide: [1.2, 2.6], lift: [1, 3], brake: [0.5, 1.3], wobble: [1, 2] }[kind];
    this.slip = { kind, t: dur[0]! + this.rng() * (dur[1]! - dur[0]!), dir: this.rng() < 0.5 ? -1 : 1 };
    this.mistakes++;
  }

  /** Steer toward a point `ahead` m down the line, `lat` m to its right. */
  private steerTo(p: PlayerController, ahead: number, lat: number, gain: number): number {
    const c = this.world.course;
    const s = p.progress.result.s;
    this.world.courseAt(Math.min(c.length - 1, s + ahead), lat, _g);
    const tx = _g.x;
    const tz = _g.z;
    const pos = p.globalPosition(_g);
    const sk = this.skill;
    // Never a perfect line: a slow wobble off the ideal heading, bigger for weaker riders.
    const wobble = (0.06 + (1 - sk.level) * 0.3) * Math.sin(this.t * 1.3 + sk.seed * 5.1);
    const desired = Math.atan2(tx - pos.x, tz - pos.z) + wobble;
    return clamp(wrapAngle(p.vehicle.telemetry.heading - desired) * gain, -1, 1);
  }

  /** Summit run-up: sprint down the line and off the edge (the suit deploys itself). */
  private run(p: PlayerController, i: VehicleInput): void {
    i.steer = this.steerTo(p, 14, this.skill.lane * 0.5, 2.2);
    i.throttle = 1;
  }

  /** Wingsuit: aim down the line, dive while high, flare a little just before touching down. */
  private fly(p: PlayerController, i: VehicleInput): void {
    i.steer = this.steerTo(p, 70, this.skill.lane, 1.6);
    const h = p.heightAboveGround();
    const vy = p.vehicle.body.linvel().y;
    if (h > 30) i.throttle = 0.2 + this.skill.level * 0.4;
    else if (h < 7 && vy < -10) i.brake = 0.6;
  }

  private ride(p: PlayerController, i: VehicleInput): void {
    const c = this.world.course;
    const s = p.progress.result.s;
    const tel = p.vehicle.telemetry;
    const sk = this.skill;
    let lat = sk.lane;
    // Line up with the next jump and pop its lip (sometimes misjudged and skipped).
    const f = c.features.find((x) => (x.type === 'jump' || x.type === 'kicker' || x.type === 'gap') && x.s > s - 2 && x.s < s + 150);
    if (f) {
      if (this.decidedJumpS !== f.s) {
        this.decidedJumpS = f.s;
        this.skipJumpS = this.rng() < BOT_MISTAKES.missLipChance * (1.3 - sk.level) * this.mistakeMul ? f.s : -1;
      }
      if (this.skipJumpS !== f.s) {
        lat = f.lateral;
        i.jumpPressed = Math.abs(f.s - s) < 2.5 && tel.grounded;
      }
    }
    // Read the line ahead: the tightest bend within braking distance sets a corner speed.
    const scan = 12 + tel.speed * 1.4;
    let kMax = 0;
    for (let d = 0; d <= scan; d += c.step) {
      const j = Math.min(c.count - 1, Math.round((s + d) / c.step));
      kMax = Math.max(kMax, Math.abs(c.curvature[j]!));
    }
    const cornerSpeed = Math.sqrt((12 + sk.level * 6) / Math.max(kMax, 1e-4));
    const sharp = kMax > 0.012;
    // Look further ahead at speed so lines are smooth. Through tight bends (switchbacks) hold the
    // centre line at a fixed distance: aiming further cuts across the inside, which is uphill.
    const tight = kMax > 0.02;
    const ahead = tight ? 22 : 14 + tel.speed * 0.45;
    i.steer = this.steerTo(p, ahead, tight ? 0 : lat, 2.4);
    // Skis and boards tuck on full throttle, which costs steering: stand up for tight bends.
    i.throttle = tight && GLIDERS.has(p.vehicle.id) ? 0 : 1;
    // Boost on some of the straights: how often depends on skill and the race rubber band.
    const share = clamp((BOT_MISTAKES.boostBase + sk.level * BOT_MISTAKES.boostSkill) * this.boostMul + (this.push - 1) * 3, 0, 0.9);
    const rhythm = 0.5 + 0.25 * Math.sin(this.t * 0.41 + sk.seed * 7) + 0.25 * Math.sin(this.t * 0.17 + sk.seed * 3);
    i.boost = !sharp && rhythm < share && tel.grounded;
    // Brake down to the corner speed before a tight bend (not on boards and skis: without an
    // engine or pedals, momentum lost in a hairpin is gone for good).
    const over = tel.speed - cornerSpeed * 1.05;
    if (over > 0 && tel.grounded && !GLIDERS.has(p.vehicle.id)) {
      i.brake = clamp(over / 8, 0.2, 1);
      i.throttle = 0;
      i.boost = false;
    }
  }
}
