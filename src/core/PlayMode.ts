import * as THREE from 'three';
import { CAMERA, CAMERA_VIEW_LABELS } from '../config/camera';
import { RUN, SWITCH } from '../config/gameplay';
import type { MapId } from '../config/maps';
import { NATURE_ASSET } from '../config/assets';
import { RIDER_ASSET } from '../config/riders';
import { SURFACE_PHYSICS } from '../config/surfaces';
import { VEHICLE_IDS, type VehicleId } from '../config/vehicles';
import { ChaseCamera, type CameraTarget } from '../camera/ChaseCamera';
import { FlyCam } from '../camera/FlyCam';
import { Puff } from '../fx/Puff';
import { Spray, type SprayRider } from '../fx/Spray';
import { MAPS } from '../config/maps';
import { SpeedLines } from '../fx/SpeedLines';
import { Race } from '../gameplay/Race';
import { Run } from '../gameplay/Run';
import { DIFFICULTY, RACE } from '../config/race';
import { loadRiderPack } from '../models/ModelLoader';
import { loadNatureKit } from '../models/NatureKit';
import { PlayerController } from '../player/PlayerController';
import { HUD } from '../ui/HUD';
import { NameTags, type NameTagItem } from '../ui/NameTags';
import { actionLabel } from '../ui/SettingsScreen';
import { Toast } from '../ui/Toast';
import { VehicleWheel } from '../ui/VehicleWheel';
import { vehicleSlots } from '../vehicles/slots';
import { mapBiome } from '../vehicles/VehicleSwitcher';
import { World } from '../world/World';
import { Pickups, type PickupRider } from '../world/Pickups';
import { Secrets } from '../world/Secrets';
import { COLLECTIBLES } from '../config/progression';
import { MAP_ORDER } from '../config/maps';
import { VEHICLES } from '../config/vehicles';
import { Throwables, type ThrowRider } from '../gameplay/Throwables';
import { THROW } from '../config/stunts';
import { events } from './Events';
import type { Game, GameMode, ProgressFn } from './Game';
import type { SaveData } from './Save';

/** A map session: world + rider + camera + run + HUD. Also drives the menu-background flyover. */
export class PlayMode implements GameMode {
  readonly player: PlayerController;
  readonly chase: ChaseCamera;
  readonly flyCam: FlyCam;
  readonly run: Run;
  /** The mass-start race: the player plus bots. */
  readonly race: Race;
  readonly hud: HUD;
  private tags: NameTags;
  private pickups: Pickups;
  private secrets: Secrets;
  /** Locked vehicles lent by a station for this run. */
  private borrowed = new Set<VehicleId>();
  private throwables: Throwables;
  private throwRiders: ThrowRider[] = [];
  private botThrowWait = new Map<string, number>();
  /** Bots don't target you for a while after knocking you out. */
  private playerGrace = 0;
  private pickupRiders: PickupRider[] = [];
  private tagItems: NameTagItem[] = [];
  readonly dev = { flyCam: false, orbitCam: false };
  phase: 'menu' | 'run' = 'menu';
  private focus = new THREE.Vector3();
  private camGlobal = new THREE.Vector3();
  private global = new THREE.Vector3();
  private offs: (() => void)[] = [];
  private target: CameraTarget;
  private toast: Toast;
  private speedLines: SpeedLines;
  private puff: Puff;
  private spray: Spray;
  private sprayState = new Map<string, SprayRider & { air: number }>();
  private wheel: VehicleWheel;
  private switchCooldown = 0;
  private slowMo = 0;
  private spawnS: number;

  private constructor(
    private readonly game: Game,
    readonly world: World,
  ) {
    const props = world.courseProps;
    this.spawnS = props.startS + RUN.spawnOffset;
    this.player = new PlayerController(game, world, 'onFoot', this.spawnS, { look: game.save.data.look, paint: (id) => game.save.paintFor(id) });
    this.chase = new ChaseCamera(game.renderer.camera, game.input);
    this.flyCam = new FlyCam(game.renderer.camera, game.input, world);
    this.toast = new Toast(game.ui);
    this.speedLines = new SpeedLines(game.renderer.camera);
    this.puff = new Puff(game.renderer.scene);
    this.spray = new Spray(game.renderer.scene, MAPS[world.mapId].biome === 'snow');
    this.wheel = new VehicleWheel(game.ui);
    this.wheel.onPick = (id) => this.closeWheel(id);
    const best = game.save.data.progress.bestTimes[world.mapId] ?? null;
    this.run = new Run(world.mapId, world.course.checkpoints, this.spawnS, props.finishS, best);
    this.hud = new HUD(game.ui, world.course, world.course.checkpoints, props.finishS);
    this.tags = new NameTags(this.hud.el);
    this.player.resetS = () => this.run.checkpoints.respawnS();
    this.race = new Race(game, world, this.player, this.spawnS, props.finishS, world.course.checkpoints);
    this.run.standings = (time) => this.race.results(time);
    this.run.difficultyLabel = () => DIFFICULTY[this.race.difficulty].label;
    this.pickups = new Pickups(world, game.renderer.worldRoot);
    this.secrets = new Secrets(world, game.renderer.worldRoot, (key) => game.save.data.progress.collectibles.includes(key));
    this.secrets.onToken = (key) => this.foundToken(key);
    this.secrets.onStation = (id) => this.station(id);
    this.pickupRiders = this.race.entries.map((e) => ({ id: e.id, rider: e.rider, local: e.kind === 'local' }));
    this.throwables = new Throwables(game.renderer.scene);
    this.throwRiders = this.race.entries.map((e) => ({ id: e.id, name: e.name, rider: e.rider, local: e.kind === 'local' }));
    this.throwables.onHit = (from, to, blocked) => {
      if (!blocked) from.rider.perks.knockouts++;
      if (!blocked && to.local) this.playerGrace = THROW.playerGrace;
      events.emit('rider:hit', { from: from.name, to: to.name, byYou: from.local, onYou: to.local, blocked });
    };
    this.target = {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      heading: 0,
      quaternion: new THREE.Quaternion(),
      head: new THREE.Vector3(),
      grounded: true,
      flying: false,
      boosting: false,
      vehicle: 'bicycle',
      groundAt: (x, z) => world.groundLocal(x, z),
    };
    this.offs.push(
      events.on('quality:change', () => world.setGraphics(game.graphics)),
      events.on('player:land', (l) => this.chase.addTrauma(Math.min(CAMERA.landingShakeMax, Math.max(0, l.impact - CAMERA.landingShakeFrom) / CAMERA.landingShakeRange))),
      events.on('player:crash', () => this.chase.addTrauma(CAMERA.crashShake)),
      events.on('player:respawn', () => this.chase.snap()),
      events.on('run:state', ({ state }) => {
        if (state === 'countdown') this.chase.release();
        if (state === 'running') this.toast.show(`Run for the edge!  ${this.hint('accelerate')} sprint · ${this.hint('jump')} jump`, 3200);
      }),
      events.on('player:switch', ({ from, to }) => {
        if (to === 'wingsuit' && from === 'onFoot') this.toast.show(`Wingsuit!  ${this.hint('accelerate')} dive · ${this.hint('brake')} flare · ${this.game.input.lastDevice === 'gamepad' ? 'LS' : this.hint('steerLeft') + '/' + this.hint('steerRight')} turn · hold ${this.hint('vehicleWheel')} for a vehicle`, 4200);
      }),
      events.on('run:finish', () => (this.slowMo = RUN.finishSlowMo)),
    );
    this.player.focusLocal(this.focus);
  }

  static async create(game: Game, mapId: MapId, progress: ProgressFn): Promise<PlayMode> {
    // Props (trees, crowds of riders-pack spectators) are built with the world: load both packs first.
    await Promise.all([loadRiderPack(RIDER_ASSET.url), loadNatureKit(NATURE_ASSET.url)]);
    const world = await World.create(mapId, game.renderer, game.physics, game.graphics, progress);
    return new PlayMode(game, world);
  }

  /** Menu background: slow flyover down the course, rider parked at the start. */
  enterMenu(): void {
    this.closeWheel(null);
    this.phase = 'menu';
    this.hud.setVisible(false);
    this.player.respawnAt(this.spawnS, 0, 'menu', this.race.playerLat);
    this.player.frozen = true;
    this.player.autoBrake = false;
    this.race.reset(this.game.save.data.settings.difficulty);
    this.run.state = 'idle';
    const t = this.flyCam.tuning;
    t.autopilotSpeed = RUN.menuFlySpeed;
    t.autopilotHeight = RUN.menuFlyHeight;
    this.flyCam.teleport(60, RUN.menuFlyHeight);
    t.autopilot = true;
    this.speedLines.update(0, 0);
    this.game.loop.timeScale = 1;
    this.slowMo = 0;
  }

  startRun(): void {
    this.phase = 'run';
    this.flyCam.tuning.autopilot = false;
    this.player.autoBrake = false;
    this.player.respawnAt(this.spawnS, 0, 'start', this.race.playerLat);
    this.player.frozen = true;
    this.race.reset(this.game.save.data.settings.difficulty);
    this.pickups.reset();
    this.secrets.reset();
    this.borrowed.clear();
    // Every run starts on the bicycle (the wingsuit glide lands on it); the wheel offers what you've unlocked.
    this.player.lastGround = 'bicycle';
    this.throwables.clear();
    this.run.begin(false);
    this.hud.setVisible(true);
    this.chase.snap();
    this.slowMo = 0;
    this.game.loop.timeScale = 1;
  }

  /** The button for an action on the device in use (first binding). */
  private hint(a: Parameters<typeof actionLabel>[1]): string {
    return actionLabel(this.game.input, a).split(' / ')[0]!;
  }

  /** The look or paint changed in Customize: dress the parked rider again. */
  applyLook(): void {
    this.player.setLook(this.game.save.data.look);
    this.player.repaint();
  }

  private canRide(id: VehicleId): boolean {
    return this.game.progression.vehicleUnlocked(id) || this.borrowed.has(id);
  }

  private foundToken(key: string): void {
    const p = this.game.save.data.progress;
    if (!p.collectibles.includes(key)) p.collectibles.push(key);
    this.game.save.write();
    const total = COLLECTIBLES.perMap * MAP_ORDER.length;
    const unlocks = this.game.progression.collectNew();
    events.emit('progress:token', { key, count: p.collectibles.length });
    this.toast.show(`Hidden token found!  ${p.collectibles.length}/${total}${unlocks.length ? `  ·  Unlocked: ${unlocks.map((u) => u.name).join(', ')}` : ''}`, 4200);
  }

  private station(id: VehicleId): void {
    const locked = !this.canRide(id);
    if (locked) this.borrowed.add(id);
    const switched = this.player.vehicle.id !== id && this.player.state === 'riding' && this.player.switchTo(id);
    if (switched) this.switchCooldown = SWITCH.cooldown;
    const name = VEHICLES[id].name;
    this.toast.show(locked ? `Vehicle station: ${name} borrowed for this run!` : `Vehicle station: ${name}`, 3600);
  }

  respawnAtCheckpoint(): void {
    if (this.phase !== 'run') return;
    this.player.respawnAt(this.run.checkpoints.respawnS(), 6, 'checkpoint');
  }

  applySettings(s: SaveData['settings']): void {
    this.chase.fovOffset = s.fovOffset;
    this.chase.invertY = s.invertY;
  }

  fixedUpdate(dt: number): void {
    if (this.phase !== 'run') return;
    this.player.fixedUpdate(dt);
    this.race.fixedUpdate(dt);
  }

  afterStep(dt: number): void {
    if (this.phase !== 'run') return;
    this.player.afterStep(dt);
    this.race.afterStep(dt);
  }

  update(realDt: number, simDt: number, alpha: number): void {
    // Re-centre before anything renders this frame so no object is drawn pre-shift.
    this.world.origin.update(this.focus);
    if (this.phase === 'menu') {
      this.updateMenu(realDt);
      this.game.audio.update(null);
      return;
    }
    const input = this.game.input;
    const run = this.run;
    if (input.framePressed('camera')) {
      const mode = this.chase.toggleMode();
      this.player.headVisible = mode !== 'first';
      events.emit('camera:mode', { mode });
      this.toast.show(`${CAMERA_VIEW_LABELS[mode]}  ·  ${this.hint('camera')} to switch`);
    }
    if (run.state === 'intro' && input.framePressed('jump')) run.skipIntro();
    if (input.framePressed('respawn') && run.state === 'running') this.respawnAtCheckpoint();
    this.updateWheel(realDt);

    this.player.frozen = run.frozen;
    this.player.autoBrake = run.state === 'finished';
    const tel = this.player.vehicle.telemetry;
    // Intro/countdown run on real time, but never while a menu has the game paused.
    const live = this.game.state === 'playing' || this.game.state === 'finished';
    run.update(live ? realDt : 0, simDt, { progressS: this.player.progress.result.s, speed: tel.speed });

    // Finish slow-motion.
    if (this.slowMo > 0) {
      this.slowMo -= realDt;
      this.game.loop.timeScale = this.slowMo > 0 ? RUN.finishTimeScale : 1;
    }

    this.player.update(simDt, alpha);
    this.puff.update(simDt);
    this.updateCamera(realDt);
    this.race.update(realDt, simDt, alpha, run, this.game.renderer.camera.position);
    const standings = this.race.standings();
    this.updateTags(standings);
    this.updateThrows(simDt, run.state === 'running');
    this.updateSpray(simDt);
    this.pickups.update(simDt, this.world.origin.toGlobal(this.game.renderer.camera.position, this.camGlobal), run.state === 'running' ? this.pickupRiders : []);
    this.secrets.update(simDt, this.camGlobal, run.state === 'running' ? this.player : null);

    this.player.focusLocal(this.focus);
    this.world.origin.toGlobal(this.focus, this.global);
    this.hud.update(realDt, {
      time: run.state === 'intro' || run.state === 'countdown' ? 0 : run.total,
      bestTime: run.bestTime,
      speedKmh: tel.speed * 3.6,
      progressS: this.player.progress.result.s,
      altitude: this.global.y,
      vehicle: this.player.vehicle.id,
      boost: this.player.perks.boost,
      ammo: this.player.perks.ammo,
      buffs: this.player.perks.buffs,
      combo: this.player.perks.combo.tricks > 0 ? { mult: this.player.perks.combo.mult, value: this.player.perks.combo.value, t: this.player.perks.combo.timer } : null,
      flight: tel.flightMeter,
      checkpointsReached: run.checkpoints.last + 1,
      standings,
      pace: this.race.local.pace,
    });
    this.world.update(realDt, this.focus, this.player.progress.result.s);
    // Ride sound only while the game runs (silent under pause / menus).
    const v = this.player.vehicle;
    this.game.audio.update(
      live && this.player.state === 'riding'
        ? { vehicle: v.id, speed: tel.speed, grounded: tel.grounded, surface: tel.surface, flying: tel.flying, boosting: tel.boosting }
        : null,
    );
  }

  /** Dust, mud, snow and water kicked up by every rider near the camera, plus landing bursts. */
  private updateSpray(dt: number): void {
    if (dt <= 0) return;
    const cam = this.game.renderer.camera;
    this.spray.setViewport(this.game.renderer.renderer.domElement.clientHeight || 720, cam.fov);
    for (const e of this.race.entries) {
      const r = e.rider;
      const v = r.vehicle;
      let st = this.sprayState.get(e.id);
      if (!st) this.sprayState.set(e.id, (st = { vehicle: v.id, pos: new THREE.Vector3(), heading: 0, speed: 0, surface: 'packed', grounded: true, steer: 0, carry: 0, air: 0 }));
      if (r.ghost || r.state !== 'riding' || !v.model.visible) continue;
      v.renderPosition(st.pos);
      if (st.pos.distanceTo(cam.position) > 120) continue;
      st.pos.y = this.world.groundLocal(st.pos.x, st.pos.z);
      const tel = v.telemetry;
      const wasAir = st.air;
      const lastSurface = st.surface;
      st.vehicle = v.id;
      st.heading = tel.heading;
      st.speed = tel.speed;
      st.surface = tel.surface;
      st.grounded = tel.grounded;
      st.steer = r.input.steer;
      st.air = tel.grounded ? 0 : tel.airTime;
      // Touchdown after real air, or hitting water: a burst.
      if (tel.grounded && wasAir > 0.4) this.spray.burst(st, tel.speed / 5 + wasAir * 4);
      else if (tel.grounded && tel.surface === 'water' && lastSurface !== 'water') this.spray.burst(st, tel.speed / 3);
      this.spray.emit(st, dt);
    }
    this.spray.update(dt);
  }

  /** Throws: launch what riders asked for, let bots decide, fly the projectiles. */
  private updateThrows(dt: number, racing: boolean): void {
    const riders = this.throwRiders;
    this.playerGrace = Math.max(0, this.playerGrace - dt);
    if (racing) {
      for (const e of this.race.bots) {
        const d = e.driver;
        const wait = Math.max(0, (this.botThrowWait.get(e.id) ?? 0) - dt);
        this.botThrowWait.set(e.id, wait);
        if (!d || wait > 0 || e.rider.perks.ammo <= 0 || e.rider.ghost || e.rider.state !== 'riding') continue;
        const from = riders.find((r) => r.id === e.id)!;
        const target = this.throwables.pickTarget(from, riders);
        if (!target || (target.local && this.playerGrace > 0)) continue;
        if (Math.random() < THROW.botRate * (0.5 + d.skill.level) * dt) {
          d.throwNow = true;
          this.botThrowWait.set(e.id, THROW.botCooldown);
        }
      }
    }
    for (const r of riders) {
      if (!r.rider.wantsThrow) continue;
      r.rider.wantsThrow = false;
      if (r.local && r.rider.perks.ammo > 0) events.emit('rider:throw', {});
      this.throwables.throw(r, riders);
    }
    this.throwables.update(dt, riders, (x, z) => this.world.groundLocal(x, z));
  }

  /** Name tags over the bots near the camera. */
  private updateTags(standings: ReturnType<Race['standings']>): void {
    const cam = this.game.renderer.camera;
    const bots = this.race.bots;
    while (this.tagItems.length < bots.length) this.tagItems.push({ id: '', name: '', position: 0, color: '', at: new THREE.Vector3(), show: false });
    bots.forEach((e, k) => {
      const item = this.tagItems[k]!;
      item.id = e.id;
      item.name = e.name;
      item.color = e.color;
      item.position = standings.find((r) => r.id === e.id)?.position ?? 0;
      e.rider.vehicle.renderPosition(item.at);
      item.show = e.rider.vehicle.model.visible && item.at.distanceTo(cam.position) < RACE.nameTagRange;
      item.at.y += 2.1;
    });
    this.tags.update(cam, this.tagItems);
  }

  /** Hold the wheel key: slow-mo + radial picker; release to swap. */
  private updateWheel(dt: number): void {
    const input = this.game.input;
    this.switchCooldown = Math.max(0, this.switchCooldown - dt);
    const rs = this.run.state;
    // The run-up is on foot: the wheel opens once the rider is off the edge.
    const canSwitch = this.game.state === 'playing' && this.player.state === 'riding' && rs === 'running' && this.player.vehicle.id !== 'onFoot';
    if (this.wheel.isOpen) {
      if (!canSwitch) {
        this.closeWheel(null);
        return;
      }
      // Right stick picks (left keeps steering); fall back to the left stick.
      const r = input.rightStick;
      const l = input.leftStick;
      this.wheel.update(Math.hypot(r.x, r.y) > SWITCH.stickDeadzone ? r : l);
      if (!input.isDown('vehicleWheel')) this.closeWheel(this.wheel.close(), true);
    } else if (canSwitch && input.framePressed('vehicleWheel') && this.switchCooldown <= 0) {
      const slots = vehicleSlots(mapBiome(this.world), this.player.heightAboveGround(), (id) => this.canRide(id));
      this.wheel.open(this.player.vehicle.id, slots, this.hint('vehicleWheel'));
      this.game.loop.timeScale = SWITCH.wheelTimeScale;
      events.emit('wheel:toggle', { open: true });
    }
  }

  private closeWheel(pick: VehicleId | null, wasOpen = this.wheel.isOpen): void {
    this.wheel.cancel();
    if (wasOpen) {
      this.game.loop.timeScale = this.slowMo > 0 ? RUN.finishTimeScale : 1;
      events.emit('wheel:toggle', { open: false });
    }
    if (pick && this.player.switchTo(pick)) {
      this.switchCooldown = SWITCH.cooldown;
    }
  }

  private updateMenu(dt: number): void {
    const fc = this.flyCam;
    if (fc.autoS >= this.world.course.length - 600) fc.teleport(60, RUN.menuFlyHeight);
    fc.tuning.autopilot = true;
    fc.update(dt);
    this.focus.copy(this.game.renderer.camera.position);
    this.world.update(dt, this.focus, fc.autoS);
    this.player.update(0, 1);
  }

  private updateCamera(dt: number): void {
    if (this.wheel.isOpen) {
      this.game.input.mouseDX = 0;
      this.game.input.mouseDY = 0;
    }
    if (this.dev.flyCam) {
      this.flyCam.update(dt);
      this.speedLines.update(dt, 0);
      return;
    }
    const riding = this.player.state === 'riding';
    this.speedLines.update(dt, riding ? this.player.vehicle.telemetry.speed : 0);
    const v = this.player.vehicle;
    const t = this.target;
    this.player.focusLocal(t.position);
    const lv = v.body.linvel();
    t.velocity.set(lv.x, lv.y, lv.z);
    if (!riding) t.velocity.multiplyScalar(0);
    t.heading = v.telemetry.heading;
    v.renderQuaternion(t.quaternion);
    this.player.character.headPosition(t.head);
    t.grounded = v.telemetry.grounded;
    t.flying = v.telemetry.flying;
    t.boosting = riding && v.telemetry.boosting;
    t.vehicle = v.id;
    // Cinematic orbits for the intro and after the finish.
    if (this.run.state === 'intro' || this.dev.orbitCam) this.chase.orbit(dt, 0.55, 0.25);
    else if (this.run.state === 'finished') this.chase.orbit(dt, 0.35, 0.35);
    else if (t.grounded) {
      // Rough ground rumbles the camera a little.
      const rough = SURFACE_PHYSICS[v.telemetry.surface].rough;
      const rumble = rough * Math.min(1, v.telemetry.speed / 35) * CAMERA.rumble;
      if (this.chase.trauma < rumble) this.chase.trauma = rumble;
    }
    this.chase.update(dt, t, t.grounded);
  }

  devTuning(): Record<string, Record<string, unknown>> {
    const t = this.flyCam.tuning;
    const self = this;
    return {
      'Fly cam': Object.assign(t, {
        __ranges: { speed: [5, 200, 1], autopilotSpeed: [10, 400, 5], autopilotHeight: [2, 200, 1], jumpToKm: [0, Math.floor(this.world.course.length / 1000), 0.5] },
        teleportToKm() {
          if (self.dev.flyCam) self.flyCam.teleport(t.jumpToKm * 1000);
          else self.player.respawnAt(t.jumpToKm * 1000, 10, 'teleport');
        },
        flyWholeCourse() {
          self.dev.flyCam = true;
          self.flyCam.teleport(10);
          t.autopilot = true;
        },
      }),
      Camera: this.dev,
      Vehicle: {
        ride: this.player.vehicle.id as string,
        __options: { ride: VEHICLE_IDS as unknown as string[] },
        switchNow() {
          self.player.switchTo(this.ride as VehicleId);
        },
      },
      'Vehicle stats': this.player.vehicle.stats as unknown as Record<string, unknown>,
    };
  }

  devStats(): Record<string, string> {
    const c = this.world.chunks.counts;
    const s = this.player.progress.result;
    const tel = this.player.vehicle.telemetry;
    return {
      tiles: `L0 ${c.lod0} L1 ${c.lod1} phys ${c.physics} pend ${c.pending} build ${this.world.chunks.workers.avgMs.toFixed(0)}ms`,
      course: `${(s.s / 1000).toFixed(2)}/${(this.world.course.length / 1000).toFixed(2)} km  lat ${s.lat.toFixed(0)}  alt ${this.global.y.toFixed(0)}m`,
      ride: `${(tel.speed * 3.6).toFixed(0)} km/h  ${tel.surface}  ${tel.grounded ? 'ground' : `air ${tel.airTime.toFixed(1)}s`}  ${this.player.state}  run:${this.run.state}`,
      origin: `shifts ${this.world.origin.shifts}  props ${this.world.courseProps.liveCount}/${this.world.courseProps.count}`,
    };
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.game.loop.timeScale = 1;
    this.run.dispose();
    this.race.dispose();
    this.pickups.dispose();
    this.secrets.dispose();
    this.spray.dispose();
    this.throwables.dispose();
    this.tags.dispose();
    this.hud.dispose();
    this.toast.dispose();
    this.speedLines.dispose();
    this.puff.dispose();
    this.wheel.dispose();
    this.player.dispose();
    this.world.dispose();
  }
}
