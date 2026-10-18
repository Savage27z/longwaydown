/** Default input bindings. Keyboard uses KeyboardEvent.code; gamepad uses the standard mapping. */

export const ACTIONS = [
  'accelerate',
  'brake',
  'steerLeft',
  'steerRight',
  'jump',
  'boost',
  'trick',
  'throw',
  'pitchForward',
  'pitchBack',
  'spinLeft',
  'spinRight',
  'vehicleWheel',
  'respawn',
  'camera',
  'pause',
] as const;

export type Action = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<Action, string> = {
  accelerate: 'Accelerate / Pedal · Dive (flying)',
  brake: 'Brake / Reverse · Pull up (flying)',
  steerLeft: 'Steer Left',
  steerRight: 'Steer Right',
  jump: 'Jump · Handbrake (buggy) · Thrusters (roadster) · Lift-off',
  boost: 'Boost · Thrust (flying)',
  trick: 'Trick / Grab',
  throw: 'Throw Bottle / Stone',
  pitchForward: 'Air Pitch Forward',
  pitchBack: 'Air Pitch Back',
  spinLeft: 'Air Spin Left',
  spinRight: 'Air Spin Right',
  vehicleWheel: 'Vehicle Wheel (hold)',
  respawn: 'Respawn at Checkpoint',
  camera: 'Toggle Camera',
  pause: 'Pause',
};

export type KeyBindings = Record<Action, string[]>;
/** Pad binding tokens: `b7` = button 7, `a0-` / `a0+` = axis 0 negative / positive half. */
export type PadBindings = Record<Action, string[]>;

export const DEFAULT_KEYS: KeyBindings = {
  accelerate: ['KeyW'],
  brake: ['KeyS'],
  steerLeft: ['KeyA'],
  steerRight: ['KeyD'],
  jump: ['Space'],
  boost: ['ShiftLeft', 'ShiftRight'],
  trick: ['KeyE'],
  throw: ['KeyF'],
  pitchForward: ['ArrowUp'],
  pitchBack: ['ArrowDown'],
  spinLeft: ['ArrowLeft'],
  spinRight: ['ArrowRight'],
  vehicleWheel: ['KeyQ'],
  respawn: ['KeyR'],
  camera: ['KeyC'],
  pause: ['Escape', 'KeyP'],
};

export const DEFAULT_PAD: PadBindings = {
  accelerate: ['b7'],
  brake: ['b6'],
  steerLeft: ['a0-'],
  steerRight: ['a0+'],
  jump: ['b0'],
  boost: ['b2'],
  trick: ['b1'],
  throw: ['b3', 'b12'],
  pitchForward: ['a3-'],
  pitchBack: ['a3+'],
  spinLeft: ['a2-'],
  spinRight: ['a2+'],
  vehicleWheel: ['b4'],
  respawn: ['b13'],
  camera: ['b5'],
  pause: ['b9'],
};

export const INPUT_TUNING = {
  stickDeadzone: 0.18,
  triggerDeadzone: 0.05,
  /** Analog value above which an action counts as "down" for press/release edges. */
  pressThreshold: 0.5,
  mouseSensitivity: 0.0045,
  stickLookSpeed: 2.6,
};
