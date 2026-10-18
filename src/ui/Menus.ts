import { MAP_ORDER, MAPS, type MapId } from '../config/maps';
import { RIDER_ASSET } from '../config/riders';
import type { Input } from '../core/Input';
import type { Save } from '../core/Save';
import type { Progression } from '../gameplay/Progression';
import type { RunResults } from '../gameplay/Run';
import { customizeScreen } from './CustomizeScreen';
import { formatTime } from '../utils/math';
import { VEHICLE_ICONS } from './icons';
import { mapSelectScreen } from './MapSelect';
import { keyLabel, settingsScreen, type SettingsHooks } from './SettingsScreen';

export interface MenuActions extends SettingsHooks {
  playMap(id: MapId): void;
  resume(): void;
  restart(): void;
  respawn(): void;
  quitToMenu(): void;
  /** The rider's look or paint changed in Customize. */
  lookChanged(): void;
}

export type ScreenName = 'main' | 'maps' | 'settings' | 'credits' | 'pause' | 'results' | 'controls' | 'customize';

function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `btn ${cls}`;
  b.innerHTML = `<span>${label}</span>`;
  b.addEventListener('click', onClick);
  return b;
}

/** Full-screen HTML menus layered over the canvas. One screen at a time. */
export class Menus {
  readonly root = document.createElement('div');
  current: ScreenName | null = null;
  private returnTo: ScreenName = 'main';
  /** Tear-down for the current screen (the customize preview owns a renderer). */
  private cleanup: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly save: Save,
    private readonly progression: Progression,
    private readonly input: Input,
    private readonly actions: MenuActions,
  ) {
    this.root.className = 'menu-root hidden';
    parent.appendChild(this.root);
  }

  get open(): boolean {
    return this.current !== null;
  }

  hide(): void {
    this.runCleanup();
    this.current = null;
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
  }

  private runCleanup(): void {
    this.cleanup?.();
    this.cleanup = null;
  }

  show(name: ScreenName, results?: RunResults): void {
    this.runCleanup();
    this.current = name;
    this.root.innerHTML = '';
    this.root.classList.remove('hidden');
    this.root.classList.toggle('dim', name !== 'main');
    let el: HTMLElement;
    switch (name) {
      case 'main':
        el = this.mainScreen();
        break;
      case 'maps':
        el = mapSelectScreen(this.save, (id) => this.actions.playMap(id), () => this.show('main'));
        break;
      case 'settings':
        el = settingsScreen(this.save, this.input, this.actions, () => this.show(this.returnTo));
        break;
      case 'credits':
        el = this.creditsScreen();
        break;
      case 'pause':
        el = this.pauseScreen();
        break;
      case 'results':
        el = this.resultsScreen(results!);
        break;
      case 'controls':
        el = this.controlsScreen();
        break;
      case 'customize': {
        const c = customizeScreen(this.save, this.progression, () => this.actions.lookChanged(), () => this.show('main'));
        el = c.el;
        this.cleanup = c.dispose;
        break;
      }
    }
    this.root.appendChild(el);
    (el.querySelector('.btn.primary, .btn') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private mainScreen(): HTMLElement {
    const p = document.createElement('div');
    p.className = 'menu-panel left';
    p.innerHTML = `<h1 class="menu-title">LONG WAY<br><span>DOWN</span></h1><div class="menu-tag">Summit to valley · no stopping</div><div class="menu-buttons"></div>`;
    const b = p.querySelector('.menu-buttons')!;
    this.returnTo = 'main';
    b.append(
      button('Play', () => this.show('maps'), 'primary'),
      button('Customize', () => this.show('customize')),
      button('Settings', () => this.show('settings')),
      button('Controls', () => this.show('controls')),
      button('Credits', () => this.show('credits')),
    );
    return p;
  }

  private pauseScreen(): HTMLElement {
    const p = document.createElement('div');
    p.className = 'menu-panel card';
    p.innerHTML = `<h2 class="menu-heading">Paused</h2><div class="menu-buttons"></div>`;
    this.returnTo = 'pause';
    p.querySelector('.menu-buttons')!.append(
      button('Resume', () => this.actions.resume(), 'primary'),
      button('Respawn at checkpoint', () => this.actions.respawn()),
      button('Restart run', () => this.actions.restart()),
      button('Settings', () => this.show('settings')),
      button('Controls', () => this.show('controls')),
      button('Quit to menu', () => this.actions.quitToMenu()),
    );
    return p;
  }

  private resultsScreen(r: RunResults): HTMLElement {
    const p = document.createElement('div');
    p.className = 'menu-panel wide card';
    const map = MAPS[r.mapId];
    const prev = r.previousBest;
    const delta = prev !== null ? r.time - prev : null;
    const stat = (k: string, v: string) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    p.innerHTML = `
      <div class="menu-tag">${map.name} · finished</div>
      <div class="results-time">${formatTime(r.time)}${r.newRecord ? '<span class="record">NEW RECORD</span>' : ''}</div>
      <div class="hud-sub">${
        delta === null ? 'First finish on this mountain!' : `<span class="${delta <= 0 ? 'good' : 'bad'}">${delta <= 0 ? '−' : '+'}${formatTime(Math.abs(delta))} vs best ${formatTime(prev!)}</span>`
      }</div>
      ${unlocksBlock(r)}
      ${standingsTable(r)}
      <div class="results-grid">
        ${stat('Distance', `${(r.distance / 1000).toFixed(2)} km`)}
        ${stat('Top speed', `${Math.round(r.topSpeed * 3.6)} km/h`)}
        ${stat('Biggest air', `${r.biggestAirTime.toFixed(1)} s · ${r.biggestAirHeight.toFixed(1)} m`)}
        ${stat('Trick score', r.trickScore.toLocaleString())}
        ${stat('Pickups', String(r.pickups))}
        ${stat('Best combo', r.bestCombo.toLocaleString())}
        ${stat('Near misses', String(r.nearMisses))}
        ${stat('Knockouts', String(r.knockouts))}
        ${stat('Crashes', `${r.crashes} (+${r.penalties.toFixed(0)} s)`)}
      </div>
      <div class="row"></div>`;
    const row = p.querySelector('.row')!;
    row.append(button('Ride again', () => this.actions.restart(), 'primary small'));
    const next = MAP_ORDER[MAP_ORDER.indexOf(r.mapId) + 1];
    if (next && this.save.isMapUnlocked(next)) row.append(button(`Next: ${MAPS[next].name}`, () => this.actions.playMap(next), 'small'));
    row.append(button('Main menu', () => this.actions.quitToMenu(), 'small'));
    return p;
  }

  private controlsScreen(): HTMLElement {
    const p = document.createElement('div');
    p.className = 'menu-panel card';
    const k = this.input.keys;
    const key = (a: keyof typeof k) => k[a].map((c) => `<span class="key">${keyLabel(c)}</span>`).join('');
    p.innerHTML = `<h2 class="menu-heading">How to ride</h2>
      <div class="controls-overlay">
        <div>${key('accelerate')}</div><div>Pedal / accelerate (hold to tuck at speed)</div>
        <div>${key('brake')}</div><div>Brake</div>
        <div>${key('steerLeft')}${key('steerRight')}</div><div>Steer / lean</div>
        <div>${key('jump')}</div><div>Hop — press right at a lip for extra pop</div>
        <div>${key('boost')}</div><div>Boost (sprint)</div>
        <div>${key('pitchForward')}${key('pitchBack')}${key('spinLeft')}${key('spinRight')}</div><div>Flip and spin in the air</div>
        <div>${key('trick')}</div><div>Grab (hold in the air)</div>
        <div>${key('throw')}</div><div>Throw a bottle / stone at the rider ahead (from Bottle pickups, max 3)</div>
        <div>${key('respawn')}</div><div>Back to the last checkpoint</div>
        <div>${key('camera')}</div><div>Switch camera (chase / far / first person)</div>
        <div>${key('pause')}</div><div>Pause</div>
      </div>
      <div class="menu-tag" style="margin-bottom:14px">Gamepads work too: RT pedal · LT brake · A hop · X boost · B grab · right stick flips</div>
      <div class="row"></div>`;
    p.querySelector('.row')!.append(button('Got it', () => (this.returnTo === 'pause' ? this.show('pause') : this.onControlsClosed()), 'primary small'));
    return p;
  }

  /** Overridable: what "Got it" does when the controls screen was opened from the main menu or first play. */
  onControlsClosed: () => void = () => this.show('main');

  private creditsScreen(): HTMLElement {
    const p = document.createElement('div');
    p.className = 'menu-panel card credits';
    p.innerHTML = `<h2 class="menu-heading">Credits</h2>
      <p><b>Long Way Down</b> — a downhill freeride game built with three.js, Rapier, simplex-noise and Vite.</p>
      <p>Terrain, vehicles, props, sky, effects and sound are all procedurally generated in code.</p>
      <p>Rider models: ${RIDER_ASSET.credit}.</p>
      <p>Physics: <a href="https://rapier.rs" target="_blank" rel="noopener">Rapier</a> · Rendering: <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a></p>
      <div class="row"></div>`;
    p.querySelector('.row')!.append(button('Back', () => this.show('main'), 'small'));
    return p;
  }

  dispose(): void {
    this.root.remove();
  }
}

/** Final race standings (estimated times are marked ~ for riders still on the course). */
function standingsTable(r: RunResults): string {
  if (!r.standings) return '';
  const me = r.standings.find((x) => x.kind === 'local');
  const rows = r.standings
    .map(
      (x) =>
        `<div class="st-row${x.kind === 'local' ? ' me' : ''}"><b>${x.position}</b><i style="background:${x.color}"></i><span>${x.name}</span><span class="veh">${VEHICLE_ICONS[x.vehicle] ?? ''}</span><em>${x.estimated ? '~' : ''}${formatTime(x.time ?? 0)}</em></div>`,
    )
    .join('');
  const diff = r.difficulty ? ` · ${r.difficulty}` : '';
  const place = me ? `<div class="menu-tag">You finished ${me.position}${['st', 'nd', 'rd'][me.position - 1] ?? 'th'} of ${r.standings.length}${diff}</div>` : '';
  return `${place}<div class="standings">${rows}</div>`;
}

/** "Unlocked" chips on the results screen. */
function unlocksBlock(r: RunResults): string {
  if (!r.unlocks?.length) return '';
  const label: Record<string, string> = { map: 'New mountain', vehicle: 'New vehicle', outfit: 'New outfit', goggles: 'New eyewear' };
  return `<div class="unlocks">${r.unlocks.map((u) => `<div class="unlock"><span>${label[u.kind] ?? 'Unlocked'}</span>${u.name}</div>`).join('')}</div>`;
}
