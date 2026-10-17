import * as THREE from 'three';
import { CAMERA, CAMERA_VIEW_LABELS } from '../config/camera';
import { RUN, SWITCH } from '../config/gameplay';
import type { MapId } from '../config/maps';
import { RIDER_ASSET } from '../config/riders';
import { SURFACE_PHYSICS } from '../config/surfaces';
import { VEHICLE_IDS, type VehicleId } from '../config/vehicles';
import { ChaseCamera, type CameraTarget } from '../camera/ChaseCamera';
import { FlyCam } from '../camera/FlyCam';
import { Puff } from '../fx/Puff';
import { SpeedLines } from '../fx/SpeedLines';
import { Run } from '../gameplay/Run';
import { loadRiderPack } from '../models/ModelLoader';
import { PlayerController } from '../player/PlayerController';
import { HUD } from '../ui/HUD';
import { keyLabel } from '../ui/SettingsScreen';
import { Toast } from '../ui/Toast';
import { VehicleWheel } from '../ui/VehicleWheel';
import { vehicleSlots } from '../vehicles/slots';
import { mapBiome } from '../vehicles/VehicleSwitcher';
import { World } from '../world/World';
import { events } from './Events';
import type { Game, GameMode, ProgressFn } from './Game';
import type { SaveData } from './Save';

/** A map session: world + rider + camera + run + HUD. Also drives the menu-background flyover. */
export class PlayMode implements GameMode {
  readonly player: PlayerController;
  readonly chase: ChaseCamera;
  readonly flyCam: FlyCam;
  readonly run: Run;
  readonly hud: HUD;
  readonly dev = { flyCam: false, orbitCam: false };
  phase: 'menu' | 'run' = 'menu';
  private focus = new THREE.Vector3();
  private global = new THREE.Vector3();
  private offs: (() => void)[] = [];
  private target: CameraTarget;
  private toast: Toast;
  private speedLines: SpeedLines;
  private puff: Puff;
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
    this.player = new PlayerController(game, world, 'onFoot', this.spawnS);
    this.chase = new ChaseCamera(game.renderer.camera, game.input);
    this.flyCam = new FlyCam(game.renderer.camera, game.input, world);
    this.toast = new Toast(game.ui);
    this.speedLines = new SpeedLines(game.renderer.camera);
    this.puff = new Puff(game.renderer.scene);
    this.wheel = new VehicleWheel(game.ui);
    this.wheel.onPick = (id) => this.closeWheel(id);
    const best = game.save.data.progress.bestTimes[world.mapId] ?? null;
    this.run = new Run(world.mapId, world.course.checkpoints, this.spawnS, props.finishS, best);
    this.hud = new HUD(game.ui, world.course, world.course.checkpoints, props.finishS);
    this.player.resetS = () => this.run.checkpoints.respawnS();
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
        if (state === 'running') this.toast.show('Run for the edge!  W sprint · Space jump', 3200);
      }),
      events.on('player:switch', ({ from, to }) => {
        if (to === 'wingsuit' && from === 'onFoot') this.toast.show('Wingsuit!  W dive · S flare · A/D turn · hold Q for a vehicle', 4200);
      }),
      events.on('run:finish', () => (this.slowMo = RUN.finishSlowMo)),
    );
    this.player.focusLocal(this.focus);
  }

  static async create(game: Game, mapId: MapId, progress: ProgressFn): Promise<PlayMode> {
    const riders = loadRiderPack(RIDER_ASSET.url);
    const world = await World.create(mapId, game.renderer, game.physics, game.graphics, progress);
    await riders;
    return new PlayMode(game, world);
  }

  /** Menu background: slow flyover down the course, rider parked at the start. */
  enterMenu(): void {
    this.closeWheel(null);
    this.phase = 'menu';
    this.hud.setVisible(false);
    this.player.respawnAt(this.spawnS, 0, 'menu');
    this.player.frozen = true;
    this.player.autoBrake = false;
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
    this.player.respawnAt(this.spawnS, 0, 'start');
    this.player.frozen = true;
    this.run.begin(false);
    this.hud.setVisible(true);
    this.chase.snap();
    this.slowMo = 0;
    this.game.loop.timeScale = 1;
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
    if (this.phase === 'run') this.player.fixedUpdate(dt);
  }

  afterStep(dt: number): void {
    if (this.phase === 'run') this.player.afterStep(dt);
  }

  update(realDt: number, simDt: number, alpha: number): void {
    // Re-centre before anything renders this frame so no object is drawn pre-shift.
    this.world.origin.update(this.focus);
    if (this.phase === 'menu') {
      this.updateMenu(realDt);
      return;
    }
    const input = this.game.input;
    const run = this.run;
    if (input.framePressed('camera')) {
      const mode = this.chase.toggleMode();
      this.player.headVisible = mode !== 'first';
      events.emit('camera:mode', { mode });
      this.toast.show(`${CAMERA_VIEW_LABELS[mode]}  ·  C to switch`);
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

    this.player.focusLocal(this.focus);
    this.world.origin.toGlobal(this.focus, this.global);
    this.hud.update(realDt, {
      time: run.state === 'intro' || run.state === 'countdown' ? 0 : run.total,
      bestTime: run.bestTime,
      speedKmh: tel.speed * 3.6,
      progressS: this.player.progress.result.s,
      altitude: this.global.y,
      vehicle: this.player.vehicle.id,
      boost: -1,
      flight: tel.flightMeter,
      checkpointsReached: run.checkpoints.last + 1,
    });
    this.world.update(realDt, this.focus, this.player.progress.result.s);
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
      const slots = vehicleSlots(mapBiome(this.world), this.player.heightAboveGround());
      this.wheel.open(this.player.vehicle.id, slots, keyLabel(input.keys.vehicleWheel[0] ?? 'KeyQ'));
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
    this.hud.dispose();
    this.toast.dispose();
    this.speedLines.dispose();
    this.puff.dispose();
    this.wheel.dispose();
    this.player.dispose();
    this.world.dispose();
  }
}
