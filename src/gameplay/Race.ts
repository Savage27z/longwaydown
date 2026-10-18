import * as THREE from 'three';
import { BOT_GARAGES, BOT_LEVELS, BOT_MISTAKES, BOT_NAMES, BOT_PAINTS, BOT_SWITCH, DIFFICULTY, RACE, type Difficulty } from '../config/race';
import { RIDING } from '../config/vehicles';
import { NEAR_MISS, PICKUPS } from '../config/stunts';
import { MAPS } from '../config/maps';
import { OUTFITS, type OutfitId, type RiderLook } from '../config/riders';
import type { VehicleId } from '../config/vehicles';
import type { Game } from '../core/Game';
import { PlayerController } from '../player/PlayerController';
import { makeRng } from '../utils/rng';
import { damp } from '../utils/math';
import type { World } from '../world/World';
import { BotDriver } from './BotDriver';
import type { RunState } from './Run';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();

export type RacerKind = 'local' | 'bot' | 'remote';

/** One rider in the race. `remote` is reserved for online players (a network input source). */
export interface RaceEntry {
  id: string;
  name: string;
  kind: RacerKind;
  rider: PlayerController;
  driver: BotDriver | null;
  color: string;
  /** Crash penalties (s). The local player's live in the Run. */
  penalties: number;
  /** Race time at the finish, penalties included (s). */
  finishTime: number | null;
  /** Learned progress rate along the course on the ground vehicle (m/s): the ghost coasting speed. */
  pace: number;
  lastS: number;
  /** Seconds before a ghost may become physical again (no flip-flopping at the physics edge). */
  ghostHold: number;
  /** Ghost slips: seconds left of a slow-down or a crash stop. */
  ghostSlow: number;
  ghostStop: number;
  /** Ground vehicles this bot switches between (first = starting vehicle), and its base skill. */
  garage: VehicleId[];
  baseLevel: number;
  /** Last checkpoint index passed (for switch rolls). */
  checkpoint: number;
}

/** Vehicles whose progress says nothing about the ground pace (start run-up, wingsuit glide). */
const NOT_GROUND = new Set<VehicleId>(['onFoot', 'wingsuit']);

export interface Standing {
  id: string;
  name: string;
  kind: RacerKind;
  position: number;
  s: number;
  vehicle: VehicleId;
  color: string;
  /** Finish time (penalties included), or an estimate for riders still out on the course. */
  time: number | null;
  estimated: boolean;
  finished: boolean;
}

/** Typical progress rate of a ground vehicle before a bot has learned its own (m/s). */
function nominal(id: VehicleId): number {
  return (RACE.nominalPace[id] ?? 90) / 3.6;
}

/** Riders whose outfits stay light enough to have eight on screen. */
const BOT_OUTFITS: OutfitId[] = OUTFITS.filter((o) => o !== 'King' && o !== 'SpaceSuit');

/**
 * A mass-start race: the local player plus bots on one grid, the race clock, finish times and
 * standings. Bots are ordinary riders with a BotDriver input source; far from the player (no
 * terrain colliders) they go ghost and coast along the line at their learned pace.
 */
export class Race {
  readonly entries: RaceEntry[] = [];
  readonly local: RaceEntry;
  /** Race clock (s): runs from GO until everyone has finished. */
  time = 0;
  private lastRunState: RunState = 'idle';

  constructor(
    game: Game,
    private readonly world: World,
    player: PlayerController,
    private readonly spawnS: number,
    private readonly finishS: number,
    private readonly checkpoints: number[],
  ) {
    this.local = { id: 'you', name: 'You', kind: 'local', rider: player, driver: null, color: '#ff5a1f', penalties: 0, finishTime: null, pace: 0, lastS: spawnS, ghostHold: 0, ghostSlow: 0, ghostStop: 0, garage: [], baseLevel: 1, checkpoint: -1 };
    this.entries.push(this.local);
    const biome = MAPS[world.mapId].biome;
    const rng = makeRng(`race:${world.mapId}`);
    const names = [...BOT_NAMES].sort(() => rng() - 0.5);
    for (let k = 0; k < RACE.bots; k++) {
      const part = () => BOT_OUTFITS[Math.floor(rng() * BOT_OUTFITS.length)]!;
      const look: RiderLook = { head: part(), body: part(), legs: part(), feet: part(), backpack: rng() < 0.4 };
      const [primary, secondary] = BOT_PAINTS[k % BOT_PAINTS.length]!;
      const garage = BOT_GARAGES[biome][k % BOT_GARAGES[biome].length]!;
      const vehicle = garage[0]!;
      const driver = new BotDriver(world, { level: BOT_LEVELS[k] ?? 0.8, lane: (rng() - 0.5) * 5, seed: rng() * 10 });
      const rider = new PlayerController(game, world, 'onFoot', spawnS, { local: false, source: driver, look, paint: { primary, secondary } });
      rider.lastGround = vehicle;
      driver.rider = rider;
      const entry: RaceEntry = { id: `bot${k}`, name: names[k]!, kind: 'bot', rider, driver, color: primary, penalties: 0, finishTime: null, pace: nominal(vehicle), lastS: spawnS, ghostHold: 0, ghostSlow: 0, ghostStop: 0, garage, baseLevel: BOT_LEVELS[k] ?? 0.7, checkpoint: -1 };
      rider.resetS = () => this.respawnS(entry);
      rider.onEvent = (type, payload) => {
        if (this.lastRunState !== 'running' || entry.finishTime !== null) return;
        if (type === 'player:crash') entry.penalties += (payload as { penalty: number }).penalty;
        // Time Freeze for a bot: a time credit worth the frozen seconds.
        if (type === 'rider:pickup' && (payload as { kind: string }).kind === 'freeze') entry.penalties -= PICKUPS.freezeSeconds;
      };
      this.entries.push(entry);
    }
  }

  get bots(): RaceEntry[] {
    return this.entries.filter((e) => e.kind === 'bot');
  }

  /** Grid slot -> lateral offset and distance along the course. */
  private slot(j: number): { s: number; lat: number } {
    const per = RACE.gridPerRow;
    const row = Math.floor(j / per);
    const col = j % per;
    return { s: this.spawnS - row * RACE.gridRowGap, lat: (col - (per - 1) / 2) * RACE.gridSpacing };
  }

  /** Current difficulty (set on reset). */
  difficulty: Difficulty = 'normal';

  /** Lateral offset of the local player's grid slot. */
  get playerLat(): number {
    return this.slot(RACE.playerSlot).lat;
  }

  /** Line everyone up on the grid, frozen, with a fresh clock, at a difficulty. */
  reset(difficulty: Difficulty = this.difficulty): void {
    this.difficulty = difficulty;
    const d = DIFFICULTY[difficulty];
    this.time = 0;
    let j = 0;
    for (const e of this.entries) {
      e.rider.perks.reset();
      e.penalties = 0;
      e.finishTime = null;
      e.lastS = this.spawnS;
      if (e.kind !== 'bot') continue;
      if (j === RACE.playerSlot) j++;
      const { s, lat } = this.slot(j++);
      e.rider.autoBrake = false;
      e.rider.lastGround = e.garage[0]!;
      e.rider.respawnAt(s, 0, 'start', lat);
      e.checkpoint = -1;
      if (e.driver) {
        e.driver.skill.level = Math.max(0.3, Math.min(0.97, e.baseLevel + d.level));
        e.driver.mistakeMul = d.mistakes;
        e.driver.boostMul = d.boost;
        e.driver.switchCooldown = 0;
      }
      e.rider.frozen = true;
      e.pace = nominal(e.rider.lastGround);
      e.ghostHold = 0;
      e.ghostSlow = 0;
      e.ghostStop = 0;
      if (e.driver) e.driver.push = 1;
    }
  }

  /** Bots respawn at their own last checkpoint. */
  private respawnS(e: RaceEntry): number {
    const s = e.rider.progress.result.s;
    let best = this.spawnS;
    for (const c of this.checkpoints) if (c <= s) best = c + 2;
    return Math.max(best, s);
  }

  fixedUpdate(dt: number): void {
    for (const e of this.entries) if (e.kind === 'bot') e.rider.fixedUpdate(dt);
  }

  afterStep(dt: number): void {
    for (const e of this.entries) if (e.kind === 'bot') e.rider.afterStep(dt);
  }

  /**
   * Per frame: clock, finishes, ghost <-> physics hand-overs, pace learning, rubber band and
   * render level of detail. `camera` is the local camera position (local coordinates).
   */
  update(_dt: number, simDt: number, alpha: number, run: { state: RunState; frozen: boolean; total: number }, camera: THREE.Vector3): void {
    this.lastRunState = run.state;
    const racing = run.state === 'running' || (run.state === 'finished' && this.bots.some((e) => e.finishTime === null));
    if (racing) this.time += simDt;
    const local = this.local;
    if (run.state === 'finished' && local.finishTime === null) local.finishTime = run.total;
    const playerS = local.rider.progress.result.s;
    if (run.state === 'running' && simDt > 0) {
      const rate = Math.max(0, (playerS - local.lastS) / simDt);
      if (rate < 90) local.pace = damp(local.pace, rate, RACE.paceRate, simDt);
    }
    local.lastS = playerS;
    local.rider.globalPosition(_p);
    const chunks = this.world.chunks;
    for (const e of this.entries) {
      if (e.kind !== 'bot') continue;
      const r = e.rider;
      r.frozen = run.frozen;
      const s = r.progress.result.s;
      // Learn the ground pace from real riding (not the glide, not while held, crashed or ghosting).
      if (run.state === 'running' && !r.ghost && r.state === 'riding' && !NOT_GROUND.has(r.vehicle.id) && simDt > 0 && e.finishTime === null) {
        const rate = Math.max(0, (s - e.lastS) / simDt);
        if (rate < 90) e.pace = damp(e.pace, rate, RACE.paceRate, simDt);
      }
      e.lastS = s;
      e.ghostHold = Math.max(0, e.ghostHold - simDt);
      if (e.finishTime === null && run.state !== 'idle' && run.state !== 'intro' && run.state !== 'countdown' && s >= this.finishS) {
        e.finishTime = this.time + e.penalties;
        r.autoBrake = true;
      }
      // Rubber band: ease off well ahead of the player, push a little when well behind.
      const band = Math.max(-1, Math.min(1, (s - playerS) / RACE.bandDistance));
      const diff = DIFFICULTY[this.difficulty];
      if (e.driver) e.driver.push = 1 - band * (band > 0 ? diff.ease : RACE.bandPush);
      // Checkpoints are where riders change vehicle (like picking a new ride at a gate).
      let cp = e.checkpoint;
      while (cp + 1 < this.checkpoints.length && s >= this.checkpoints[cp + 1]!) cp++;
      if (cp !== e.checkpoint) {
        e.checkpoint = cp;
        const v = r.vehicle.id;
        const next = run.state === 'running' && r.state === 'riding' && !NOT_GROUND.has(v) && (r.ghost || r.vehicle.telemetry.grounded) ? e.driver?.pickSwitch(e.garage, v) : null;
        if (next && r.switchTo(next, { silent: r.ghost })) {
          e.pace = nominal(next);
          if (e.driver) e.driver.switchCooldown = BOT_SWITCH.cooldown;
        }
      }
      const push = e.driver?.push ?? 1;
      // Ghosts coast at the learned pace, kept within reason of what the vehicle really does.
      const base = nominal(r.lastGround);
      const [lo, hi] = RACE.ghostPaceBand;
      const level = e.driver?.skill.level ?? 0.8;
      const skill = 0.84 + level * 0.14;
      let ghostPace = Math.max(base * lo, Math.min(base * hi, e.pace)) * push * skill * DIFFICULTY[this.difficulty].pace;
      // Ghosts slip and crash too (same odds as riding for real), so nobody coasts a perfect line.
      if (r.ghost && run.state === 'running' && e.finishTime === null && simDt > 0) {
        const M = BOT_MISTAKES;
        e.ghostSlow = Math.max(0, e.ghostSlow - simDt);
        e.ghostStop = Math.max(0, e.ghostStop - simDt);
        const slipRate = M.baseRate + (1 - level) * M.skillRate;
        if (e.ghostSlow <= 0 && Math.random() < slipRate * simDt) e.ghostSlow = M.ghostSlowTime[0] + Math.random() * (M.ghostSlowTime[1] - M.ghostSlowTime[0]);
        if (e.ghostStop <= 0 && Math.random() < M.ghostCrashRate * (1.2 - level) * simDt) {
          e.ghostStop = M.ghostCrashTime;
          e.penalties += RIDING.crashPenalty;
        }
        if (e.ghostStop > 0) ghostPace = 0;
        else if (e.ghostSlow > 0) ghostPace *= M.ghostSlowFactor;
      }
      // Ghost hand-over: no colliders under (or just ahead of) a bot means it can't ride there.
      if (!r.ghost) {
        r.globalPosition(_a);
        const v = r.vehicle.body.linvel();
        const hs = Math.hypot(v.x, v.z) || 1;
        _b.set(_a.x + (v.x / hs) * RACE.ghostProbeAhead, 0, _a.z + (v.z / hs) * RACE.ghostProbeAhead);
        if (!chunks.hasPhysicsAt(_a.x, _a.z) || !chunks.hasPhysicsAt(_b.x, _b.z)) {
          r.enterGhost(ghostPace);
          e.ghostHold = RACE.ghostHold;
        }
      } else {
        // Ease in and out of slips rather than snapping speed.
        const target = e.finishTime !== null ? 0 : ghostPace;
        r.ghostSpeed += Math.max(-8 * simDt, Math.min(4 * simDt, target - r.ghostSpeed));
        r.ghostGlobal(_a);
        // Back to physics where colliders cover the ghost and well ahead of it (hysteresis vs the entry probe).
        this.world.courseAt(r.progress.result.s + RACE.ghostProbeAhead * 2.5, 0, _b);
        if (e.ghostHold <= 0 && e.finishTime === null && chunks.hasPhysicsAt(_a.x, _a.z) && chunks.hasPhysicsAt(_b.x, _b.z)) r.exitGhost();
      }
      // Level of detail by distance to the camera.
      r.vehicle.renderPosition(_a);
      const d = _a.distanceTo(camera);
      r.vehicle.model.visible = d < RACE.drawRange;
      r.detail = d < RACE.detailRange;
      r.update(simDt, alpha);
    }
    if (run.state === 'running') this.closePasses();
  }

  private readonly passA = new THREE.Vector3();
  private readonly passB = new THREE.Vector3();
  /** Riders flashing past each other close but clean count as near misses for both. */
  private closePasses(): void {
    const live = this.entries.filter((e) => !e.rider.ghost && e.rider.state === 'riding' && e.finishTime === null);
    for (let a = 0; a < live.length; a++) {
      const ra = live[a]!.rider;
      ra.vehicle.renderPosition(this.passA);
      for (let b = a + 1; b < live.length; b++) {
        const rb = live[b]!.rider;
        rb.vehicle.renderPosition(this.passB);
        const d = this.passA.distanceTo(this.passB);
        if (d < 1.2 || d > 2.6) continue;
        const rel = Math.abs(ra.vehicle.telemetry.speed - rb.vehicle.telemetry.speed);
        if (rel < 3 || Math.max(ra.vehicle.telemetry.speed, rb.vehicle.telemetry.speed) < NEAR_MISS.minSpeed) continue;
        ra.perks.nearMiss(`rider:${live[b]!.id}`);
        rb.perks.nearMiss(`rider:${live[a]!.id}`);
      }
    }
  }

  /** Standings now: finishers by time, then everyone else by distance down the course. */
  standings(): Standing[] {
    const rows = this.entries.map((e) => {
      const finishTime = e.kind === 'local' ? (e.finishTime ?? null) : e.finishTime;
      return {
        id: e.id,
        name: e.name,
        kind: e.kind,
        position: 0,
        s: e.rider.progress.result.s,
        vehicle: e.rider.vehicle.id,
        color: e.color,
        time: finishTime,
        estimated: false,
        finished: finishTime !== null,
      } satisfies Standing;
    });
    rows.sort((a, b) => (a.finished !== b.finished ? (a.finished ? -1 : 1) : a.finished ? a.time! - b.time! : b.s - a.s));
    rows.forEach((r, i) => (r.position = i + 1));
    return rows;
  }

  /** Final standings at the local finish: riders still out get an estimated time from their pace. */
  results(localTime: number): Standing[] {
    const rows = this.entries.map((e) => {
      const s = e.rider.progress.result.s;
      let time = e.kind === 'local' ? localTime : e.finishTime;
      let estimated = false;
      if (time === null) {
        const pace = Math.max(5, e.pace * (e.driver?.push ?? 1));
        time = this.time + e.penalties + Math.max(0, this.finishS - s) / pace;
        estimated = true;
      }
      return { id: e.id, name: e.name, kind: e.kind, position: 0, s, vehicle: e.rider.lastGround, color: e.color, time, estimated, finished: !estimated } satisfies Standing;
    });
    rows.sort((a, b) => a.time! - b.time!);
    rows.forEach((r, i) => (r.position = i + 1));
    return rows;
  }

  dispose(): void {
    for (const e of this.entries) if (e.kind === 'bot') e.rider.dispose();
  }
}
