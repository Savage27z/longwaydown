/**
 * Gamepad control of the HTML menus: D-pad / left stick moves focus to the nearest control in
 * that direction, A presses it, B goes back, LB / RB switch tabs, left / right adjust sliders and
 * dropdowns. Reads the pad directly (menu buttons aren't game actions).
 */
const A = 0;
const B = 1;
const LB = 4;
const RB = 5;
const UP = 12;
const DOWN = 13;
const LEFT = 14;
const RIGHT = 15;
const STICK = 0.55;
const REPEAT_FIRST = 0.38;
const REPEAT = 0.13;

type Dir = 'up' | 'down' | 'left' | 'right';

export class MenuNav {
  private prev: boolean[] = [];
  private held: Dir | null = null;
  private repeat = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly onBack: () => void,
  ) {
    // Mouse use hides the pad focus ring again.
    window.addEventListener('pointermove', () => root.classList.remove('pad'));
  }

  update(dt: number): void {
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g?.connected) : null;
    if (!gp) return;
    const btn = (i: number) => gp.buttons[i]?.pressed ?? false;
    const pressed = (i: number) => btn(i) && !this.prev[i];
    const ax = gp.axes[0] ?? 0;
    const ay = gp.axes[1] ?? 0;
    const dir: Dir | null =
      btn(UP) || ay < -STICK ? 'up' : btn(DOWN) || ay > STICK ? 'down' : btn(LEFT) || ax < -STICK ? 'left' : btn(RIGHT) || ax > STICK ? 'right' : null;

    if (dir !== this.held) {
      this.held = dir;
      this.repeat = REPEAT_FIRST;
      if (dir) this.move(dir);
    } else if (dir) {
      this.repeat -= dt;
      if (this.repeat <= 0) {
        this.repeat = REPEAT;
        this.move(dir);
      }
    }
    if (pressed(A)) this.activate();
    if (pressed(B)) this.onBack();
    if (pressed(LB)) this.tab(-1);
    if (pressed(RB)) this.tab(1);
    this.prev = gp.buttons.map((b) => b.pressed);
  }

  /** Forget held buttons (a new screen shouldn't see the press that opened it as fresh). */
  sync(): void {
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g?.connected) : null;
    this.prev = gp ? gp.buttons.map((b) => b.pressed) : [];
  }

  private focusables(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([type=color]), select, [tabindex="0"]')].filter((e) => e.offsetParent !== null && !e.classList.contains('locked'));
  }

  private current(): HTMLElement | null {
    const a = document.activeElement as HTMLElement | null;
    return a && this.root.contains(a) && a !== this.root ? a : null;
  }

  private focus(el: HTMLElement): void {
    this.root.classList.add('pad');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private move(dir: Dir): void {
    const cur = this.current();
    const all = this.focusables();
    if (!cur) {
      const first = all.find((e) => e.classList.contains('primary')) ?? all[0];
      if (first) this.focus(first);
      return;
    }
    // Sliders and dropdowns take left / right as value changes.
    if (dir === 'left' || dir === 'right') {
      const step = dir === 'left' ? -1 : 1;
      if (cur instanceof HTMLInputElement && cur.type === 'range') {
        const v = Number(cur.value) + step * (Number(cur.step) || 1);
        cur.value = String(Math.min(Number(cur.max), Math.max(Number(cur.min), v)));
        cur.dispatchEvent(new Event('input', { bubbles: true }));
        cur.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      if (cur instanceof HTMLSelectElement) {
        cur.selectedIndex = Math.min(cur.options.length - 1, Math.max(0, cur.selectedIndex + step));
        cur.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const e of all) {
      if (e === cur) continue;
      const q = e.getBoundingClientRect();
      const dx = q.left + q.width / 2 - cx;
      const dy = q.top + q.height / 2 - cy;
      const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      // Sideways distance as the gap between edges (0 when they overlap), so a wider button
      // straight below still wins over a narrower one further down.
      const across = dir === 'up' || dir === 'down' ? Math.max(0, q.left - r.right, r.left - q.right) : Math.max(0, q.top - r.bottom, r.top - q.bottom);
      if (along < 4) continue;
      // Left / right prefer controls on the same row (vertically overlapping).
      const offRow = (dir === 'left' || dir === 'right') && across > 0;
      const score = along + across * 2.5 + (offRow ? 10000 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) this.focus(best);
  }

  private activate(): void {
    const cur = this.current();
    if (!cur) {
      this.move('down');
      return;
    }
    if (cur instanceof HTMLInputElement && cur.type === 'range') return;
    cur.click();
  }

  private tab(step: number): void {
    const tabs = [...this.root.querySelectorAll<HTMLElement>('[data-tab]')];
    if (tabs.length < 2) return;
    const on = tabs.findIndex((t) => t.classList.contains('primary'));
    tabs[(on + step + tabs.length) % tabs.length]!.click();
  }
}
