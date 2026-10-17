import { ACTION_LABELS, ACTIONS, DEFAULT_KEYS, DEFAULT_PAD, type Action } from '../config/controls';
import type { QualityPreset } from '../config/graphics';
import type { Input } from '../core/Input';
import type { Save } from '../core/Save';

export interface SettingsHooks {
  setQuality(q: QualityPreset): void;
  applySettings(): void;
}

const KEY_NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift',
  ControlLeft: 'L Ctrl',
  ControlRight: 'R Ctrl',
  Escape: 'Esc',
};

/** Human-readable key name for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  return KEY_NAMES[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '');
}

const PAD_BUTTONS: Record<string, string> = { b0: 'A', b1: 'B', b2: 'X', b3: 'Y', b4: 'LB', b5: 'RB', b6: 'LT', b7: 'RT', b8: 'Back', b9: 'Start', b10: 'LS', b11: 'RS', b12: 'D↑', b13: 'D↓', b14: 'D←', b15: 'D→' };
const PAD_AXES: Record<string, string> = { 'a0-': 'LS ←', 'a0+': 'LS →', 'a1-': 'LS ↑', 'a1+': 'LS ↓', 'a2-': 'RS ←', 'a2+': 'RS →', 'a3-': 'RS ↑', 'a3+': 'RS ↓' };

/** Human-readable gamepad binding token (standard mapping). */
export function padLabel(token: string): string {
  return PAD_BUTTONS[token] ?? PAD_AXES[token] ?? token;
}

/** Graphics / audio / camera / controls settings. Changes apply live and are saved. */
export function settingsScreen(save: Save, input: Input, hooks: SettingsHooks, onBack: () => void): HTMLElement {
  const s = save.data.settings;
  const panel = document.createElement('div');
  panel.className = 'menu-panel wide card';
  const commit = () => {
    save.write();
    hooks.applySettings();
  };
  panel.innerHTML = `<h2 class="menu-heading">Settings</h2><div class="settings-grid"></div><div class="row back-row"><button class="btn small" data-back><span>Back</span></button><button class="btn small" data-reset><span>Reset controls</span></button></div>`;
  const grid = panel.querySelector('.settings-grid')!;
  const row = (label: string, el: HTMLElement) => {
    const l = document.createElement('label');
    l.textContent = label;
    grid.append(l, el);
  };
  const section = (t: string) => {
    const d = document.createElement('div');
    d.className = 'section-label';
    d.textContent = t;
    grid.appendChild(d);
  };

  section('Graphics');
  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const q of ['low', 'medium', 'high'] as QualityPreset[]) {
    const b = document.createElement('button');
    b.textContent = q[0]!.toUpperCase() + q.slice(1);
    b.classList.toggle('on', s.quality === q);
    b.addEventListener('click', () => {
      s.quality = q;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      hooks.setQuality(q);
      commit();
    });
    seg.appendChild(b);
  }
  row('Quality', seg);
  const slider = (min: number, max: number, step: number, value: number, onChange: (v: number) => void) => {
    const i = document.createElement('input');
    i.type = 'range';
    i.min = String(min);
    i.max = String(max);
    i.step = String(step);
    i.value = String(value);
    i.addEventListener('input', () => {
      onChange(Number(i.value));
      commit();
    });
    return i;
  };
  row('Field of view', slider(-10, 15, 1, s.fovOffset, (v) => (s.fovOffset = v)));

  section('Audio');
  row('Master volume', slider(0, 1, 0.05, s.masterVolume, (v) => (s.masterVolume = v)));
  row('Music', slider(0, 1, 0.05, s.musicVolume, (v) => (s.musicVolume = v)));
  row('Effects', slider(0, 1, 0.05, s.sfxVolume, (v) => (s.sfxVolume = v)));

  section('Camera');
  const inv = document.createElement('input');
  inv.type = 'checkbox';
  inv.className = 'toggle';
  inv.checked = s.invertY;
  inv.addEventListener('change', () => {
    s.invertY = inv.checked;
    commit();
  });
  row('Invert Y', inv);

  section('Controls — click to rebind (Esc cancels)');
  const list = document.createElement('div');
  list.className = 'bind-list';
  list.style.gridColumn = '1 / -1';
  grid.appendChild(list);
  const render = () => {
    list.innerHTML = '';
    for (const a of ACTIONS) {
      const name = document.createElement('div');
      name.textContent = ACTION_LABELS[a];
      const kb = document.createElement('button');
      kb.className = 'bind-btn';
      kb.textContent = input.keys[a].map(keyLabel).join(' / ') || '—';
      kb.addEventListener('click', () => rebindKey(a, kb));
      const pb = document.createElement('button');
      pb.className = 'bind-btn';
      pb.textContent = input.pad[a].map(padLabel).join(' / ') || '—';
      pb.addEventListener('click', () => rebindPad(a, pb));
      list.append(name, kb, pb);
    }
  };
  const rebindKey = async (a: Action, btn: HTMLButtonElement) => {
    btn.classList.add('capturing');
    btn.textContent = 'Press a key…';
    const code = await input.captureKey();
    if (code) {
      input.keys[a] = [code];
      s.keys = { ...s.keys, [a]: [code] };
      commit();
    }
    render();
  };
  const rebindPad = async (a: Action, btn: HTMLButtonElement) => {
    btn.classList.add('capturing');
    btn.textContent = 'Press a button…';
    const token = await input.capturePad();
    if (token) {
      input.pad[a] = [token];
      s.pad = { ...s.pad, [a]: [token] };
      commit();
    }
    render();
  };
  render();

  panel.querySelector('[data-reset]')!.addEventListener('click', () => {
    s.keys = {};
    s.pad = {};
    input.setBindings(DEFAULT_KEYS, DEFAULT_PAD);
    commit();
    render();
  });
  panel.querySelector('[data-back]')!.addEventListener('click', () => {
    input.cancelCapture();
    onBack();
  });
  return panel;
}
