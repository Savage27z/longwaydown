/** Run-loop tunables. */
export const RUN = {
  /** Orbit around the rider at the start gate before the countdown (s). Skippable. */
  introDuration: 3,
  countdownFrom: 3,
  /** Seconds per countdown step. */
  countdownStep: 0.8,
  /** Seconds of slow motion after crossing the finish. */
  finishSlowMo: 2.2,
  finishTimeScale: 0.35,
  /** Delay before the results screen appears (real seconds). */
  resultsDelay: 2.6,
  /** Spawn this far before the start gate (m along the course). */
  spawnOffset: -10,
  /** Checkpoint gate visibility in the HUD toast (s). */
  checkpointToast: 2.4,
  /** Menu background flyover speed / height above the line. */
  menuFlySpeed: 28,
  menuFlyHeight: 45,
};

/** Vehicle switching (hold the wheel key, pick, release). */
export const SWITCH = {
  /** Game speed while the wheel is open. */
  wheelTimeScale: 0.3,
  /** Carried velocity is clamped to this multiple of the new vehicle's top speed. */
  velocityClamp: 1.1,
  /** Below this clearance (m) the new vehicle is put down on the ground; above it keeps its height. */
  groundSnap: 1.2,
  /** Minimum real seconds between switches. */
  cooldown: 0.5,
  /** New model pop-in animation (s). */
  popDuration: 0.32,
  /** Mouse travel (px) / stick deflection needed to pick a wheel slot. */
  mouseDeadzone: 40,
  stickDeadzone: 0.45,
};
