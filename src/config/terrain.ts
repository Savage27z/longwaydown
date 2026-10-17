/** Terrain shaping constants shared by the worker and the main thread. */
export const TERRAIN = {
  /** Spacing of the generated course samples (m). */
  sampleStep: 2,
  /** Heading integration step for path generation (m). */
  pathStep: 4,
  /** Catmull-Rom control point spacing (m). */
  controlSpacing: 20,
  /** Smoothing window for section parameters (m, half-width). */
  sectionBlend: 110,
  /** Minimum free-wander turn radius / switchback hairpin radius (m). */
  minTurnRadius: 85,
  hairpinRadius: 48,

  /** Course-field kernel: sigma near the line and growth with distance. */
  kernelSigma: 24,
  kernelGrowth: 0.55,
  /** Lattice spacing for cached course fields (m). Heights interpolate between lattice points. */
  latticeStep: 8,

  /** Gully walls: rise(d) = a*d + h*(1 - exp(-(d/L)^2)). */
  wallLinear: 0.22,
  wallHeight: 600,
  wallLength: 700,
  /** Ridge falloff (negative walls): same form with these values. */
  ridgeLinear: 0.45,
  ridgeHeight: 500,
  ridgeLength: 500,
  /** Concave cross-profile inside the corridor (m of rise at the edge per m of half-width). */
  halfPipe: 0.07,

  /** Off-corridor rocky noise. */
  roughRidgedAmp: 55,
  roughRidgedScale: 320,
  roughDetailAmp: 9,
  roughDetailScale: 90,
  /** Big distant mountains. */
  farAmp: 700,
  farScale: 2600,
  farRidgedAmp: 350,
  farRidgedScale: 1100,
  farStart: 350,
  farFull: 2500,
  /** In-corridor bumps. */
  bumpAmp: 0.7,
  bumpScale: 22,
  bumpDetailAmp: 0.18,
  bumpDetailScale: 7.5,
  /** Behind the start the mountain falls away (summit). */
  summitFalloff: 0.7,

  /** Slope (rise/run) above which ground becomes rock. */
  rockSlope: 0.95,
  /** Trail marker pole spacing along the line (m). */
  poleSpacing: 24,

  /** The groomed trail along the line: half width, shoulder blend and carve depth (m). */
  trailHalfWidth: 4.5,
  trailShoulder: 3,
  trailDepth: 0.45,
  /** Raised lips along both trail edges (m): catch light and shadow so the trail reads at speed. */
  trailLip: 0.4,
  /** Berms: cross-slope per unit of course curvature (1/m), capped (rise/run). */
  bermGain: 14,
  bermMax: 0.35,
  /** Trees and rocks keep this clear of the trail shoulder (m). */
  trailClearance: 2,
};
