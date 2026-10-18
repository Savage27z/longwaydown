import { AUDIO, ENGINE_SOUND, SURFACE_SOUND } from '../config/audio';
import type { SurfaceId } from '../config/surfaces';
import type { VehicleId } from '../config/vehicles';
import type { EventBus, GameEvents } from '../core/Events';

/** What the local rider is doing this frame (null = silence the ride layers: menus, pause). */
export interface RideSound {
  vehicle: VehicleId;
  speed: number;
  grounded: boolean;
  surface: SurfaceId;
  flying: boolean;
  boosting: boolean;
}

interface Layer {
  gain: GainNode;
  filter: BiquadFilterNode;
}

/** Vehicles whose contact with the ground makes rolling / carving noise. */
const ROLLS = new Set<VehicleId>(['bicycle', 'mountainBike', 'motorbike', 'car', 'roadster', 'snowboard', 'skis', 'onFoot']);

/**
 * All game audio, synthesised with Web Audio (no files): wind that rises with speed, surface
 * noise under the wheels, engines for the motorised vehicles, boost rush, and one-shots for
 * landings, crashes, tricks, pickups, checkpoints, the countdown and the menus. Starts on the
 * first key / click (browser autoplay rules). An optional music file loops on its own bus.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private wind!: Layer;
  private roll!: Layer;
  private boost!: Layer;
  private engine!: Layer & { a: OscillatorNode; b: OscillatorNode };
  private engineFor: VehicleId | null = null;
  private volumes = { master: 0.8, music: 0.6, sfx: 0.8 };
  private lastTick = 0;

  constructor() {
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // Menu feedback: a click on any control, a soft tick when the gamepad moves focus.
    document.addEventListener('click', (e) => {
      if ((e.target as HTMLElement | null)?.closest?.('.btn, .chip, .sw, .map-card, .vwheel')) this.ui('click');
    });
    document.addEventListener('focusin', (e) => {
      if ((e.target as HTMLElement | null)?.closest?.('.menu-root.pad')) this.ui('move');
    });
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volumes = { master, music, sfx };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(master, t, 0.05);
    this.music.gain.setTargetAtTime(music, t, 0.05);
    this.sfx.gain.setTargetAtTime(sfx, t, 0.05);
  }

  /** Start (or resume) audio; browsers only allow it after a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    // A gentle limiter so stacked one-shots never clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    comp.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(comp);
    this.music = ctx.createGain();
    this.music.connect(this.master);
    this.setVolumes(this.volumes.master, this.volumes.music, this.volumes.sfx);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.wind = this.noiseLayer('bandpass', 400, 0.6);
    this.roll = this.noiseLayer('bandpass', 1200, 0.8);
    this.boost = this.noiseLayer('bandpass', 2600, 1.2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain).connect(this.sfx);
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    b.type = 'square';
    const bGain = ctx.createGain();
    bGain.gain.value = 0.35;
    a.connect(filter);
    b.connect(bGain).connect(filter);
    a.start();
    b.start();
    this.engine = { gain, filter, a, b };
    if (AUDIO.music) void this.loadMusic(AUDIO.music);
  }

  private noiseLayer(type: BiquadFilterType, freq: number, q: number): Layer {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    // Each layer starts at a different spot in the shared noise so they don't phase together.
    src.start(0, Math.random() * 1.9);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.sfx);
    return { gain, filter };
  }

  private async loadMusic(url: string): Promise<void> {
    try {
      const ctx = this.ctx!;
      const data = await (await fetch(url)).arrayBuffer();
      const buf = await ctx.decodeAudioData(data);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.music);
      src.start();
    } catch {
      // Missing / unsupported file: play on without music.
    }
  }

  /** Per frame: steer the continuous layers toward the ride (or silence). */
  update(ride: RideSound | null): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const k = AUDIO.smooth;
    const set = (p: AudioParam, v: number, tc = k) => p.setTargetAtTime(v, t, tc);
    if (!ride) {
      for (const l of [this.wind, this.roll, this.boost, this.engine]) set(l.gain.gain, 0, 0.15);
      return;
    }
    const v = ride.speed;
    // Wind: louder and brighter with speed, more of it in the air.
    const W = AUDIO.wind;
    const w = Math.min(1, Math.max(0, (v - W.minSpeed) / (W.fullSpeed - W.minSpeed)));
    const air = !ride.grounded || ride.flying;
    set(this.wind.gain.gain, W.gain * w * w * (air ? W.airBoost : 1));
    set(this.wind.filter.frequency, 250 + w * 1400 + Math.random() * 120);
    // Surface: filtered noise per surface with a grainy flutter (gravel rattles, powder hushes).
    const S = SURFACE_SOUND[ride.surface];
    const rolling = ride.grounded && !ride.flying && ROLLS.has(ride.vehicle);
    const r = rolling ? Math.min(1, v / AUDIO.roll.fullSpeed) : 0;
    if (this.roll.filter.type !== S.type) this.roll.filter.type = S.type;
    set(this.roll.filter.frequency, S.freq * (0.8 + r * 0.4));
    set(this.roll.filter.Q, S.q);
    const flutter = 1 - S.grain * Math.random() * 0.6;
    set(this.roll.gain.gain, AUDIO.roll.gain * S.gain * Math.sqrt(r) * flutter * (ride.vehicle === 'onFoot' ? 0.4 : 1), 0.03);
    // Boost rush.
    set(this.boost.gain.gain, ride.boosting ? 0.12 + w * 0.08 : 0, 0.06);
    set(this.boost.filter.frequency, 1800 + w * 2200);
    // Engine.
    const E = ENGINE_SOUND[ride.vehicle];
    if (!E) {
      set(this.engine.gain.gain, 0, 0.1);
      this.engineFor = null;
      return;
    }
    if (this.engineFor !== ride.vehicle) {
      this.engineFor = ride.vehicle;
      this.engine.a.type = E.wave;
      this.engine.filter.frequency.value = E.filter;
    }
    const f = Math.min(1, v / E.topSpeed);
    const g = Math.min(E.gears - 1, Math.floor(f * E.gears));
    const inGear = E.gears > 1 ? f * E.gears - g : f;
    const freq = E.base + (E.top - E.base) * (0.25 * (g / E.gears) + 0.75 * inGear);
    const hover = ride.vehicle === 'flyingCar' ? Math.sin(t * 6) * 6 : 0;
    set(this.engine.a.frequency, freq + hover, 0.05);
    set(this.engine.b.frequency, freq * 0.5 + hover, 0.05);
    set(this.engine.filter.frequency, E.filter * (0.6 + f * 0.6) * (ride.boosting ? 1.4 : 1));
    set(this.engine.gain.gain, AUDIO.engine.gain * E.gain * (0.55 + f * 0.45));
  }

  // ---- One-shots ----

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; at?: number; to?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + (opts.at ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.25, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, type: BiquadFilterType, freq: number, gain: number, opts: { at?: number; to?: number; q?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + (opts.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    f.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  ui(kind: 'click' | 'move'): void {
    const now = performance.now();
    if (kind === 'move' && now - this.lastTick < 40) return;
    this.lastTick = now;
    if (kind === 'click') this.tone(880, 0.07, { type: 'triangle', gain: 0.12, to: 1320 });
    else this.tone(660, 0.04, { type: 'sine', gain: 0.06 });
  }

  land(impact: number): void {
    const k = Math.min(1, impact / 12);
    if (k < 0.08) return;
    this.burst(0.18 + k * 0.2, 'lowpass', 500, 0.25 + k * 0.5, { to: 120 });
    this.tone(110, 0.22, { gain: 0.15 + k * 0.35, to: 45 });
  }

  crash(): void {
    this.burst(0.6, 'lowpass', 1400, 0.9, { to: 90 });
    this.tone(90, 0.45, { gain: 0.5, to: 30, type: 'triangle' });
    this.burst(0.25, 'highpass', 2500, 0.25, { at: 0.04 });
  }

  /** Hook the one-shots to gameplay events. */
  bind(bus: EventBus<GameEvents>): void {
    bus.on('player:land', (l) => this.land(l.impact));
    bus.on('player:crash', () => this.crash());
    bus.on('player:respawn', ({ reason }) => {
      if (reason !== 'menu' && reason !== 'start') this.tone(520, 0.18, { type: 'triangle', gain: 0.12, to: 780 });
    });
    bus.on('player:switch', ({ to }) => {
      if (to === 'onFoot') return;
      this.burst(0.3, 'bandpass', 600, 0.3, { to: 3000, q: 1.5 });
      this.tone(330, 0.15, { type: 'triangle', gain: 0.14, at: 0.12, to: 660 });
    });
    bus.on('wheel:toggle', ({ open }) => this.burst(0.2, 'bandpass', open ? 2400 : 900, 0.12, { to: open ? 700 : 2400, q: 2 }));
    bus.on('run:countdown', ({ n }) => {
      if (n > 0) this.tone(520, 0.16, { type: 'square', gain: 0.1 });
      else this.tone(1040, 0.5, { type: 'square', gain: 0.12 });
    });
    bus.on('run:checkpoint', () => {
      this.tone(1320, 0.5, { gain: 0.18 });
      this.tone(1980, 0.4, { gain: 0.1, at: 0.06 });
    });
    bus.on('run:penalty', () => this.tone(180, 0.35, { type: 'sawtooth', gain: 0.14, to: 120 }));
    bus.on('run:finish', () => {
      [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, { type: 'triangle', gain: 0.18, at: i * 0.11 }));
      this.tone(1568, 0.9, { gain: 0.1, at: 0.44 });
    });
    bus.on('trick:land', ({ mult }) => {
      const base = 600 * Math.pow(1.12, Math.min(5, mult));
      this.tone(base, 0.12, { type: 'triangle', gain: 0.14 });
      this.tone(base * 1.5, 0.18, { type: 'triangle', gain: 0.12, at: 0.08 });
    });
    bus.on('trick:bank', () => [988, 1319, 1976].forEach((f, i) => this.tone(f, 0.25, { gain: 0.1, at: i * 0.05 })));
    bus.on('trick:lost', () => this.tone(400, 0.35, { type: 'sawtooth', gain: 0.08, to: 150 }));
    bus.on('rider:nearMiss', () => this.burst(0.35, 'bandpass', 3500, 0.35, { to: 500, q: 2.5 }));
    bus.on('rider:pickup', ({ kind }) => {
      if (kind === 'bottle') {
        this.tone(1760, 0.12, { type: 'triangle', gain: 0.12 });
        this.tone(2350, 0.18, { type: 'triangle', gain: 0.08, at: 0.05 });
      } else {
        this.tone(784, 0.15, { gain: 0.16 });
        this.tone(1175, 0.25, { gain: 0.14, at: 0.07 });
      }
    });
    bus.on('rider:throw', () => this.burst(0.25, 'bandpass', 900, 0.25, { to: 2600, q: 2 }));
    bus.on('rider:hit', ({ byYou, onYou, blocked }) => {
      if (!byYou && !onYou) return;
      if (blocked) this.tone(1400, 0.2, { type: 'square', gain: 0.08, to: 900 });
      else if (onYou) {
        this.burst(0.3, 'lowpass', 900, 0.6, { to: 150 });
        this.tone(140, 0.3, { gain: 0.3, to: 60 });
      } else {
        this.burst(0.12, 'highpass', 3000, 0.3);
        this.tone(880, 0.25, { type: 'triangle', gain: 0.14, at: 0.06, to: 1320 });
      }
    });
    bus.on('progress:token', () => [1047, 1319, 1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.35, { gain: 0.1, at: i * 0.07 })));
  }
}
