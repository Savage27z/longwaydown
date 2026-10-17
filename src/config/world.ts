/** Engine/world-level tunables. Gameplay feel values live in the per-system config files. */
export const WORLD = {
  physicsHz: 60,
  maxStepsPerFrame: 5,
  /** Frames longer than this are clamped (tab switches, hitches). */
  maxFrameDt: 0.1,
  gravity: -9.81,
  /** Re-center the world when the player is this far from the local origin (m). */
  originShiftDistance: 2000,
  /** Terrain tile edge length (m). */
  chunkSize: 256,
  /** Segments per tile edge per LOD (LOD0 is also the physics heightfield resolution). */
  lodSegments: [128, 64] as const,
  /** Tiles along the spline to keep at LOD0 + physics. */
  chunksAhead: 3,
  chunksBehind: 1,
  /** Corridor padding when picking spline tiles (m beyond the corridor half-width). */
  corridorTilePad: 60,
  /** Everything within this radius of the player also gets LOD0 + physics (m). */
  physicsRadius: 260,
  /** Skirt depth below tile edges to hide LOD cracks (m). */
  skirtDepth: 12,
  /** Max tile builds to finalize per frame (mesh uploads + colliders). */
  buildsPerFrame: 2,
  /** Backdrop: grid spacing and margin around the course bounds (m). */
  backdropSpacing: 80,
  backdropMargin: 6000,
  cameraNear: 0.3,
  cameraFar: 30000,
};
