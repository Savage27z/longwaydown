import { RUN } from '../config/gameplay';
import { VEHICLES, type VehicleId } from '../config/vehicles';
import { events } from '../core/Events';
import type { Standing } from '../gameplay/Race';
import type { CourseData } from '../world/CourseGenerator';
import { formatTime } from '../utils/math';
import { VEHICLE_ICONS } from './icons';

/** Everything the HUD shows, filled in by the play mode each frame. */
export interface HudView {
  time: number;
  bestTime: number | null;
  speedKmh: number;
  progressS: number;
  altitude: number;
  vehicle: VehicleId;
  /** 0..1, or -1 to hide. */
  boost: number;
  flight: number;
  checkpointsReached: number;
  /** Race standings (null in a solo run) and the local rider's pace for time gaps (m/s). */
  standings: Standing[] | null;
  pace: number;
}

const ORDINAL = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** HTML/CSS overlay HUD. Listens to run events for countdown, checkpoints and penalties. */
export class HUD {
  readonly el = document.createElement('div');
  private timer: HTMLDivElement;
  private sub: HTMLDivElement;
  private best: HTMLDivElement;
  private pos: HTMLDivElement;
  private board: HTMLDivElement;
  private boardHtml = '';
  private strip: HTMLCanvasElement;
  private stripCtx: CanvasRenderingContext2D;
  private stripBase: HTMLCanvasElement | null = null;
  private togo: HTMLDivElement;
  private alt: HTMLDivElement;
  private vehicle: HTMLDivElement;
  private speed: HTMLSpanElement;
  private boostBar: HTMLDivElement;
  private boostWrap: HTMLDivElement;
  private flightBar: HTMLDivElement;
  private flightWrap: HTMLDivElement;
  private flightLabel: HTMLDivElement;
  private countdown: HTMLDivElement;
  private banner: HTMLDivElement;
  readonly buffs: HTMLDivElement;
  readonly tricks: HTMLDivElement;
  private hint: HTMLDivElement;
  private lastVehicle: VehicleId | null = null;
  private subTimer = 0;
  private bannerTimer = 0;
  private countTimer = 0;
  private offs: (() => void)[] = [];

  constructor(
    parent: HTMLElement,
    private readonly course: CourseData,
    private readonly checkpoints: number[],
    private readonly finishS: number,
  ) {
    this.el.className = 'hud hidden';
    this.el.innerHTML = `
      <div class="hud-top-left"><div class="hud-timer">0:00.000</div><div class="hud-sub"></div><div class="hud-best"></div><div class="hud-pos"></div><div class="hud-board"></div></div>
      <div class="hud-top-center"><canvas class="hud-strip" width="920" height="112"></canvas><div class="hud-togo"></div></div>
      <div class="hud-top-right"><div class="hud-alt"></div><div class="hud-vehicle"></div></div>
      <div class="hud-bottom-right">
        <div class="hud-speed"><span class="v">0</span><span class="u">km/h</span></div>
        <div class="hud-meter boost"><div class="fill"></div></div><div class="hud-meter-label boost-label">BOOST</div>
        <div class="hud-meter flight"><div class="fill"></div></div><div class="hud-meter-label flight-label">FLIGHT</div>
      </div>
      <div class="hud-bottom-left hud-buffs"></div>
      <div class="hud-center"><div class="hud-countdown"></div><div class="hud-banner"></div><div class="hud-tricks"></div></div>
      <div class="hud-hint"></div>`;
    parent.appendChild(this.el);
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
    this.timer = q('.hud-timer');
    this.sub = q('.hud-sub');
    this.best = q('.hud-best');
    this.pos = q('.hud-pos');
    this.board = q('.hud-board');
    this.strip = q('.hud-strip');
    this.stripCtx = this.strip.getContext('2d')!;
    this.togo = q('.hud-togo');
    this.alt = q('.hud-alt');
    this.vehicle = q('.hud-vehicle');
    this.speed = q('.hud-speed .v');
    this.boostBar = q('.hud-meter.boost .fill');
    this.boostWrap = q('.hud-meter.boost');
    this.flightBar = q('.hud-meter.flight .fill');
    this.flightWrap = q('.hud-meter.flight');
    this.flightLabel = q('.flight-label');
    this.countdown = q('.hud-countdown');
    this.banner = q('.hud-banner');
    this.buffs = q('.hud-buffs');
    this.tricks = q('.hud-tricks');
    this.hint = q('.hud-hint');
    this.buildStrip();

    this.offs.push(
      events.on('run:countdown', ({ n }) => this.showCount(n === 0 ? 'GO!' : String(n), n === 0)),
      events.on('run:checkpoint', (c) => {
        this.showBanner(`CHECKPOINT ${c.index + 1}/${c.count}`, c.delta === null ? formatTime(c.time) : `${c.delta <= 0 ? '−' : '+'}${formatTime(Math.abs(c.delta))} vs best`);
        if (c.delta !== null) this.showSub(`${c.delta <= 0 ? '−' : '+'}${formatTime(Math.abs(c.delta))}`, c.delta <= 0 ? 'good' : 'bad');
      }),
      events.on('run:penalty', (p) => this.showSub(`+${p.seconds.toFixed(1)}s ${p.reason}`, 'bad')),
      events.on('player:crash', () => this.showBanner('WIPEOUT', '')),
      events.on('run:finish', () => this.showBanner('FINISH!', '')),
      events.on('run:state', ({ state }) => {
        this.hint.textContent = state === 'intro' ? 'Press Space to skip' : '';
      }),
    );
  }

  setVisible(v: boolean): void {
    this.el.classList.toggle('hidden', !v);
  }

  /** Static elevation profile drawn once; the per-frame pass adds progress and the rider dot. */
  private buildStrip(): void {
    const c = document.createElement('canvas');
    c.width = this.strip.width;
    c.height = this.strip.height;
    const g = c.getContext('2d')!;
    const course = this.course;
    const W = c.width;
    const H = c.height;
    const pad = 8;
    const minY = course.finishElevation;
    const maxY = course.summitElevation;
    const xOf = (s: number) => pad + (s / course.length) * (W - pad * 2);
    const yOf = (y: number) => H - pad - ((y - minY) / Math.max(1, maxY - minY)) * (H - pad * 2.5);
    g.beginPath();
    g.moveTo(xOf(0), H);
    for (let i = 0; i < course.count; i += 20) g.lineTo(xOf(i * course.step), yOf(course.y[i]!));
    g.lineTo(xOf(course.length), yOf(course.y[course.count - 1]!));
    g.lineTo(xOf(course.length), H);
    g.closePath();
    g.fillStyle = 'rgba(13, 27, 42, 0.55)';
    g.fill();
    g.strokeStyle = 'rgba(244, 248, 255, 0.55)';
    g.lineWidth = 2;
    g.stroke();
    this.stripBase = c;
    this.stripScale = { xOf, yOf };
  }

  private stripScale: { xOf: (s: number) => number; yOf: (y: number) => number } | null = null;

  private drawStrip(progressS: number, reached: number, standings: Standing[] | null): void {
    const g = this.stripCtx;
    const W = this.strip.width;
    const H = this.strip.height;
    g.clearRect(0, 0, W, H);
    if (!this.stripBase || !this.stripScale) return;
    const { xOf, yOf } = this.stripScale;
    const px = xOf(Math.min(progressS, this.course.length));
    // Travelled part highlighted.
    g.save();
    g.beginPath();
    g.rect(0, 0, px, H);
    g.clip();
    g.drawImage(this.stripBase, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(255, 90, 31, 0.55)';
    g.fillRect(0, 0, px, H);
    g.restore();
    g.save();
    g.beginPath();
    g.rect(px, 0, W - px, H);
    g.clip();
    g.drawImage(this.stripBase, 0, 0);
    g.restore();
    // Checkpoint ticks + finish flag.
    this.checkpoints.forEach((s, i) => {
      const x = xOf(s);
      g.fillStyle = i < reached ? '#ffd23f' : 'rgba(244,248,255,0.6)';
      g.fillRect(x - 1.5, 4, 3, H - 8);
    });
    const fx = xOf(this.finishS);
    g.fillStyle = '#ffffff';
    g.fillRect(fx - 2, 2, 4, H - 4);
    // Other riders: small dots in their colours.
    for (const r of standings ?? []) {
      if (r.kind === 'local') continue;
      const s = Math.min(r.s, this.course.length);
      const j = Math.min(this.course.count - 1, Math.max(0, Math.round(s / this.course.step)));
      g.beginPath();
      g.arc(xOf(s), yOf(this.course.y[j]!), 5, 0, Math.PI * 2);
      g.fillStyle = r.color;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = 'rgba(13,27,42,0.8)';
      g.stroke();
    }
    // Rider dot.
    const i = Math.min(this.course.count - 1, Math.max(0, Math.round(progressS / this.course.step)));
    const py = yOf(this.course.y[i]!);
    g.beginPath();
    g.arc(px, py, 8, 0, Math.PI * 2);
    g.fillStyle = '#ff5a1f';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#ffffff';
    g.stroke();
  }

  update(dt: number, v: HudView): void {
    this.timer.textContent = formatTime(v.time);
    this.best.textContent = v.bestTime !== null ? `Best ${formatTime(v.bestTime)}` : '';
    this.speed.textContent = String(Math.round(v.speedKmh));
    const left = Math.max(0, this.finishS - v.progressS);
    this.togo.textContent = `${(left / 1000).toFixed(1)} km to go`;
    this.alt.textContent = `ALT ${Math.round(v.altitude).toLocaleString()} m`;
    if (v.vehicle !== this.lastVehicle) {
      this.lastVehicle = v.vehicle;
      this.vehicle.innerHTML = `${VEHICLE_ICONS[v.vehicle]}<span>${VEHICLES[v.vehicle].name}</span>`;
    }
    const showBoost = v.boost >= 0;
    this.boostWrap.style.display = showBoost ? '' : 'none';
    (this.el.querySelector('.boost-label') as HTMLElement).style.display = showBoost ? '' : 'none';
    if (showBoost) this.boostBar.style.width = `${Math.round(v.boost * 100)}%`;
    const showFlight = v.flight >= 0;
    this.flightWrap.style.display = showFlight ? '' : 'none';
    this.flightLabel.style.display = showFlight ? '' : 'none';
    if (showFlight) {
      this.flightBar.style.width = `${Math.round(v.flight * 100)}%`;
      this.flightLabel.textContent = v.vehicle === 'roadster' ? 'THRUSTERS' : 'FLIGHT';
    }
    this.drawStrip(v.progressS, v.checkpointsReached, v.standings);
    this.drawBoard(v.standings, v.pace);

    this.subTimer -= dt;
    if (this.subTimer <= 0) this.sub.textContent = '';
    this.bannerTimer -= dt;
    if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    this.countTimer -= dt;
    if (this.countTimer <= 0) this.countdown.classList.remove('show');
  }

  /** Big position plus the field with time gaps to the local rider. */
  private drawBoard(rows: Standing[] | null, pace: number): void {
    if (!rows) {
      this.pos.textContent = '';
      if (this.boardHtml) this.board.innerHTML = this.boardHtml = '';
      return;
    }
    const me = rows.find((r) => r.kind === 'local');
    if (!me) return;
    this.pos.innerHTML = `${ORDINAL(me.position)}<small>/${rows.length}</small>`;
    const gap = (r: Standing): string => {
      if (r === me) return '';
      if (r.finished && me.finished) return `${r.time! < me.time! ? '−' : '+'}${Math.abs(r.time! - me.time!).toFixed(1)}`;
      if (r.finished) return formatTime(r.time!, false);
      const sec = (r.s - me.s) / Math.max(8, pace);
      return `${sec >= 0 ? '−' : '+'}${Math.abs(sec).toFixed(1)}`;
    };
    const html = rows
      .map((r) => `<div class="row${r === me ? ' me' : ''}"><b>${r.position}</b><i style="background:${r.color}"></i><span>${r.name}</span><em>${gap(r)}</em></div>`)
      .join('');
    if (html !== this.boardHtml) this.board.innerHTML = this.boardHtml = html;
  }

  private showSub(text: string, cls: 'good' | 'bad'): void {
    this.sub.innerHTML = `<span class="${cls}">${text}</span>`;
    this.subTimer = 2.5;
  }

  showBanner(title: string, small: string): void {
    this.banner.innerHTML = `${title}${small ? `<small>${small}</small>` : ''}`;
    this.banner.classList.add('show');
    this.bannerTimer = RUN.checkpointToast;
  }

  private showCount(text: string, go: boolean): void {
    this.countdown.textContent = text;
    this.countdown.classList.toggle('go', go);
    this.countdown.classList.remove('show');
    void this.countdown.offsetWidth;
    this.countdown.classList.add('show');
    this.countTimer = go ? 0.9 : 0.7;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.el.remove();
  }
}
