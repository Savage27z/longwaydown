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
