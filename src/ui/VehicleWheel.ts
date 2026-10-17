import { SWITCH } from '../config/gameplay';
import { VEHICLES, type VehicleId } from '../config/vehicles';
import type { VehicleSlot } from '../vehicles/slots';
import { VEHICLE_ICONS } from './icons';

const RADIUS = 150;

/**
 * Radial vehicle picker. Point with the mouse or a stick, or press 1–8; releasing the wheel key
 * (handled by the caller) commits. Clicking a slot commits straight away through `onPick`.
 */
export class VehicleWheel {
  onPick: ((id: VehicleId) => void) | null = null;
  private el = document.createElement('div');
  private center: HTMLDivElement;
  private slotsEl: HTMLButtonElement[] = [];
  private slots: VehicleSlot[] = [];
  private current: VehicleId = 'bicycle';
  private hover: number | null = null;
  private open_ = false;
  /** Virtual cursor relative to the wheel centre (px), for pointer-locked mice. */
  private cursor = { x: 0, y: 0 };

  constructor(parent: HTMLElement) {
    this.el.className = 'vwheel hidden';
    this.el.innerHTML = `<div class="vwheel-ring"></div><div class="vwheel-center"></div>`;
    this.center = this.el.querySelector('.vwheel-center')!;
    parent.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(current: VehicleId, slots: VehicleSlot[], keyLabel: string): void {
    this.current = current;
    this.slots = slots;
    this.cursor.x = this.cursor.y = 0;
    const ring = this.el.querySelector('.vwheel-ring')!;
    ring.innerHTML = '';
    this.slotsEl = slots.map((slot, i) => {
      const a = (i / slots.length) * Math.PI * 2 - Math.PI / 2;
      const b = document.createElement('button');
      b.className = `vwheel-slot${slot.enabled ? '' : ' disabled'}${slot.id === current ? ' current' : ''}`;
      b.style.left = `calc(50% + ${Math.cos(a) * RADIUS}px)`;
      b.style.top = `calc(50% + ${Math.sin(a) * RADIUS}px)`;
      b.innerHTML = `${VEHICLE_ICONS[slot.id]}<span class="vwheel-name">${VEHICLES[slot.id].name}</span><span class="vwheel-key">${i + 1}</span>`;
      b.addEventListener('pointerenter', () => this.setHover(i));
      b.addEventListener('click', () => {
        this.setHover(i);
        const pick = this.pick();
        if (pick) this.onPick?.(pick);
      });
      ring.appendChild(b);
      return b;
    });
    this.el.dataset.key = keyLabel;
    this.setHover(slots.findIndex((s) => s.id === current));
    this.el.classList.remove('hidden');
    this.open_ = true;
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('keydown', this.onKey);
  }

  /** Gamepad: point with either stick. */
  update(stick: { x: number; y: number }): void {
    if (!this.open_) return;
    if (Math.hypot(stick.x, stick.y) > SWITCH.stickDeadzone) this.pointAt(stick.x, stick.y);
  }

  /** Close and return the chosen vehicle (null = keep the current one). */
  close(): VehicleId | null {
    if (!this.open_) return null;
    const pick = this.pick();
    this.hide();
    return pick;
  }

  cancel(): void {
    if (this.open_) this.hide();
  }

  private pick(): VehicleId | null {
    const slot = this.hover === null ? null : this.slots[this.hover];
    return slot && slot.enabled && slot.id !== this.current ? slot.id : null;
  }

  private hide(): void {
    this.open_ = false;
    this.el.classList.add('hidden');
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('keydown', this.onKey);
  }

  private pointAt(dx: number, dy: number): void {
    const n = this.slots.length;
    const a = Math.atan2(dy, dx) + Math.PI / 2;
    const i = (((Math.round((a / (Math.PI * 2)) * n) % n) + n) % n);
    this.setHover(i);
  }

  private setHover(i: number): void {
    if (i < 0 || i === this.hover) return;
    this.hover = i;
    this.slotsEl.forEach((b, j) => b.classList.toggle('hover', j === i));
    const slot = this.slots[i]!;
    const name = VEHICLES[slot.id].name;
    const note = !slot.enabled ? `<div class="vwheel-note bad">${slot.reason ?? 'Unavailable'}</div>` : slot.id === this.current ? '<div class="vwheel-note">Riding now</div>' : `<div class="vwheel-note">Release ${this.el.dataset.key ?? ''} to switch</div>`;
    this.center.innerHTML = `${VEHICLE_ICONS[slot.id]}<div class="vwheel-title">${name}</div>${note}`;
  }

  private onMove = (e: PointerEvent): void => {
    if (document.pointerLockElement) {
      this.cursor.x = Math.max(-200, Math.min(200, this.cursor.x + e.movementX));
      this.cursor.y = Math.max(-200, Math.min(200, this.cursor.y + e.movementY));
    } else {
      const r = this.el.getBoundingClientRect();
      this.cursor.x = e.clientX - (r.left + r.width / 2);
      this.cursor.y = e.clientY - (r.top + r.height / 2);
    }
    if (Math.hypot(this.cursor.x, this.cursor.y) > SWITCH.mouseDeadzone) this.pointAt(this.cursor.x, this.cursor.y);
  };

  private onKey = (e: KeyboardEvent): void => {
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (!m) return;
    const i = Number(m[1]) - 1;
    if (i < this.slots.length) {
      this.setHover(i);
      e.preventDefault();
    }
  };

  dispose(): void {
    this.hide();
    this.el.remove();
  }
}
