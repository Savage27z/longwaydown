import * as THREE from 'three';
import type { VehicleId } from '../config/vehicles';
import type { InputSource } from '../player/InputSource';
import type { PlayerController } from '../player/PlayerController';
import type { VehicleInput } from '../vehicles/Vehicle';
import type { World } from '../world/World';
import { clamp, wrapAngle } from '../utils/math';

const _g = new THREE.Vector3();
/** Gravity-only vehicles. */
const GLIDERS = new Set<VehicleId>(['snowboard', 'skis']);

export interface BotSkill {
  /** 0..1: line accuracy, boost use, jump commitment. */
  level: number;
  /** Preferred lane: metres right of the course line. */
  lane: number;
  /** Phase offset for this bot's boost and wobble rhythms. */
  seed: number;
}

/**
 * A bot's controls, from the same information a player has: the course line ahead, the jumps on
 * it and its own speed. It runs off the summit, flies the wingsuit down toward the line, then
 * rides its lane with boost on the straights and pops the lips it lines up for.
 */
export class BotDriver implements InputSource {
  rider: PlayerController | null = null;
  /** Race rubber band: >1 pushes harder (more boost), <1 eases off. */
  push = 1;
  private t = 0;

  constructor(
    private readonly world: World,
    readonly skill: BotSkill,
  ) {}

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
    const p = this.rider;
    if (!p) return;
    this.t += 1 / 60;
    const id = p.vehicle.id;
    if (id === 'onFoot') this.run(p, i);
    else if (id === 'wingsuit') this.fly(p, i);
    else this.ride(p, i);
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
    // Lower skill: a slow wobble off the ideal heading.
    const wobble = (1 - sk.level) * 0.22 * Math.sin(this.t * 1.3 + sk.seed * 5.1);
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
    if (h > 30) i.throttle = 0.4 + this.skill.level * 0.4;
    else if (h < 7 && vy < -10) i.brake = 0.6;
  }

  private ride(p: PlayerController, i: VehicleInput): void {
    const c = this.world.course;
    const s = p.progress.result.s;
    const tel = p.vehicle.telemetry;
    const sk = this.skill;
    let lat = sk.lane;
    // Line up with the next jump and pop its lip.
    const f = c.features.find((x) => (x.type === 'jump' || x.type === 'kicker' || x.type === 'gap') && x.s > s - 2 && x.s < s + 150);
    if (f && sk.level > 0.6) {
      lat = f.lateral;
      i.jumpPressed = Math.abs(f.s - s) < 2.5 && tel.grounded;
    }
    // Read the line ahead: the tightest bend within braking distance sets a corner speed.
    const scan = 12 + tel.speed * 1.4;
    let kMax = 0;
    for (let d = 0; d <= scan; d += c.step) {
      const j = Math.min(c.count - 1, Math.round((s + d) / c.step));
      kMax = Math.max(kMax, Math.abs(c.curvature[j]!));
    }
    const cornerSpeed = Math.sqrt((14 + sk.level * 6) / Math.max(kMax, 1e-4));
    const sharp = kMax > 0.012;
    // Look further ahead at speed so lines are smooth. Through tight bends (switchbacks) hold the
    // centre line at a fixed distance: aiming further cuts across the inside, which is uphill.
    const tight = kMax > 0.02;
    const ahead = tight ? 22 : 14 + tel.speed * 0.45;
    i.steer = this.steerTo(p, ahead, tight ? 0 : lat, 2.4);
    // Skis and boards tuck on full throttle, which costs steering: stand up for tight bends.
    i.throttle = tight && GLIDERS.has(p.vehicle.id) ? 0 : 1;
    // Boost on straights, as often as skill (and the race rubber band) says.
    const share = clamp(0.55 + sk.level * 0.45 + (this.push - 1) * 4, 0, 1);
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
