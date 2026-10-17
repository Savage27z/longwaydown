import { ACTIONS, DEFAULT_KEYS, DEFAULT_PAD, INPUT_TUNING, type Action, type KeyBindings, type PadBindings } from '../config/controls';

export type InputDevice = 'keyboard' | 'gamepad';

function cloneBindings<T extends Record<string, string[]>>(b: T): T {
  const out = {} as Record<string, string[]>;
  for (const k of Object.keys(b)) out[k] = [...(b[k] ?? [])];
  return out as T;
}

/**
 * Keyboard + mouse + gamepad abstraction.
 * - `update()` runs once per render frame and samples everything.
 * - Edge presses are latched twice: per frame (UI) and per fixed step (gameplay), so a
 *   press is never lost whether the frame ran zero or several physics steps.
 */
export class Input {
  keys: KeyBindings = cloneBindings(DEFAULT_KEYS);
  pad: PadBindings = cloneBindings(DEFAULT_PAD);
  lastDevice: InputDevice = 'keyboard';
  /** Mouse delta accumulated over the last frame (pixels). */
  mouseDX = 0;
  mouseDY = 0;
  mouseDown = false;
  /** Raw right stick, deadzoned. */
  rightStick = { x: 0, y: 0 };
  leftStick = { x: 0, y: 0 };
  /** Set by UI when a text field / rebinding capture should swallow keys. */
  enabled = true;

  private down = new Set<string>();
  private values = new Map<Action, number>();
  private prevDown = new Map<Action, boolean>();
  private pressedFrame = new Set<Action>();
  private releasedFrame = new Set<Action>();
  private pressedStep = new Set<Action>();
  private releasedStep = new Set<Action>();
  private accDX = 0;
  private accDY = 0;
  private captureCb: ((code: string) => void) | null = null;
  private padCaptureCb: ((token: string) => void) | null = null;
  private lastPadSnapshot: number[] = [];

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointermove', this.onPointerMove);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointermove', this.onPointerMove);
  }

  setBindings(keys: Partial<KeyBindings> | undefined, pad: Partial<PadBindings> | undefined): void {
    this.keys = cloneBindings({ ...DEFAULT_KEYS, ...(keys ?? {}) });
    this.pad = cloneBindings({ ...DEFAULT_PAD, ...(pad ?? {}) });
  }

  /** Resolve the next physical key press (for rebinding). Escape cancels with ''. */
  captureKey(): Promise<string> {
    return new Promise((resolve) => {
      this.captureCb = (code) => {
        this.captureCb = null;
        resolve(code === 'Escape' ? '' : code);
      };
    });
  }

  /** Resolve the next gamepad button/axis movement as a binding token. */
  capturePad(): Promise<string> {
    this.lastPadSnapshot = [];
    return new Promise((resolve) => {
      this.padCaptureCb = (token) => {
        this.padCaptureCb = null;
        resolve(token);
      };
    });
  }

  cancelCapture(): void {
    this.captureCb?.('Escape');
    this.padCaptureCb?.('');
  }

  /** Sample devices. Call once per render frame, before game logic. */
  update(): void {
    this.pressedFrame.clear();
    this.releasedFrame.clear();
    this.mouseDX = this.accDX;
    this.mouseDY = this.accDY;
    this.accDX = 0;
    this.accDY = 0;

    const gp = this.activeGamepad();
    if (gp && this.padCaptureCb) this.pollPadCapture(gp);
    const dz = INPUT_TUNING.stickDeadzone;
    this.leftStick.x = gp ? deadzone(gp.axes[0] ?? 0, dz) : 0;
    this.leftStick.y = gp ? deadzone(gp.axes[1] ?? 0, dz) : 0;
    this.rightStick.x = gp ? deadzone(gp.axes[2] ?? 0, dz) : 0;
    this.rightStick.y = gp ? deadzone(gp.axes[3] ?? 0, dz) : 0;

    let padActive = false;
    for (const action of ACTIONS) {
      let v = 0;
      if (this.enabled) {
        for (const code of this.keys[action]) if (this.down.has(code)) v = 1;
        if (gp) {
          for (const token of this.pad[action]) {
            const pv = readPadToken(gp, token);
            if (pv > 0.2) padActive = true;
            if (pv > v) v = pv;
          }
        }
      }
      this.values.set(action, v);
      const isDown = v >= INPUT_TUNING.pressThreshold;
      const was = this.prevDown.get(action) ?? false;
      if (isDown && !was) {
        this.pressedFrame.add(action);
        this.pressedStep.add(action);
      } else if (!isDown && was) {
        this.releasedFrame.add(action);
        this.releasedStep.add(action);
      }
      this.prevDown.set(action, isDown);
    }
    if (padActive) this.lastDevice = 'gamepad';
  }

  /** Clear per-step latches. Call after each fixed physics step that consumed input. */
  endFixedStep(): void {
    this.pressedStep.clear();
    this.releasedStep.clear();
  }

  value(a: Action): number {
    return this.values.get(a) ?? 0;
  }

  isDown(a: Action): boolean {
    return (this.values.get(a) ?? 0) >= INPUT_TUNING.pressThreshold;
  }

  /** Edge press, for gameplay inside fixed steps. */
  stepPressed(a: Action): boolean {
    return this.pressedStep.has(a);
  }

  stepReleased(a: Action): boolean {
    return this.releasedStep.has(a);
  }

  /** Edge press, for UI and per-frame logic. */
  framePressed(a: Action): boolean {
    return this.pressedFrame.has(a);
  }

  frameReleased(a: Action): boolean {
    return this.releasedFrame.has(a);
  }

  /** -1..1 composite axis from two actions. */
  axis(neg: Action, pos: Action): number {
    return this.value(pos) - this.value(neg);
  }

  hasGamepad(): boolean {
    return this.activeGamepad() !== null;
  }

  private activeGamepad(): Gamepad | null {
    if (!navigator.getGamepads) return null;
    for (const gp of navigator.getGamepads()) if (gp && gp.connected) return gp;
    return null;
  }

  private pollPadCapture(gp: Gamepad): void {
    const snap = [...gp.buttons.map((b) => b.value), ...gp.axes];
    if (this.lastPadSnapshot.length === 0) {
      this.lastPadSnapshot = snap;
      return;
    }
    for (let i = 0; i < gp.buttons.length; i++) {
      if ((gp.buttons[i]?.value ?? 0) > 0.6 && (this.lastPadSnapshot[i] ?? 0) < 0.3) {
        this.padCaptureCb?.(`b${i}`);
        return;
      }
    }
    for (let i = 0; i < gp.axes.length; i++) {
      const v = gp.axes[i] ?? 0;
      if (Math.abs(v) > 0.7) {
        this.padCaptureCb?.(`a${i}${v < 0 ? '-' : '+'}`);
        return;
      }
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.captureCb) {
      e.preventDefault();
      this.captureCb(e.code);
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (isGameKey(e.code)) e.preventDefault();
    this.down.add(e.code);
    this.lastDevice = 'keyboard';
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private onBlur = (): void => {
    this.down.clear();
    this.mouseDown = false;
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 0 || e.button === 2) this.mouseDown = true;
  };

  private onPointerUp = (): void => {
    this.mouseDown = false;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.mouseDown && document.pointerLockElement !== this.target) return;
    this.accDX += e.movementX;
    this.accDY += e.movementY;
  };
}

function deadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return Math.sign(v) * ((a - dz) / (1 - dz));
}

function readPadToken(gp: Gamepad, token: string): number {
  if (token.startsWith('b')) {
    const b = gp.buttons[Number(token.slice(1))];
    if (!b) return 0;
    return b.value > INPUT_TUNING.triggerDeadzone ? b.value : b.pressed ? 1 : 0;
  }
  if (token.startsWith('a')) {
    const neg = token.endsWith('-');
    const idx = Number(token.slice(1, -1));
    const raw = deadzone(gp.axes[idx] ?? 0, INPUT_TUNING.stickDeadzone);
    return neg ? Math.max(0, -raw) : Math.max(0, raw);
  }
  return 0;
}

const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backquote']);
function isGameKey(code: string): boolean {
  return GAME_KEYS.has(code);
}
