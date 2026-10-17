# Build log

## Phase 1: Foundation

**What was built**
- Vite 8 + TypeScript 7 (strict) project. `npm run dev`, `npm run build` (typecheck + bundle), `npm test` (vitest), and `vercel.json` for static deploys.
- `core/Loop.ts`: fixed 60 Hz physics with an accumulator (capped at 5 steps per frame), variable-rate render with an interpolation alpha, and a time scale for slow-mo. `advance(seconds)` steps the game synchronously, used for automation and hidden tabs.
- `core/Input.ts`: keyboard plus gamepad (standard mapping) action map. Analog values, press/release edges latched per frame (UI) and per fixed step (gameplay), and capture helpers for rebinding.
- `core/Events.ts`: typed event bus. `core/Game.ts`: state machine skeleton (loading / menu / customize / playing / paused / finished).
- `physics/`: lazy Rapier WASM load behind the loading screen, a world wrapper with collision groups, a raycast helper and a floating-origin shift.
- `render/Renderer.ts`: WebGL renderer with a reversed-Z depth buffer (logarithmic fallback) for a 30 km far plane, and a world root used for floating-origin rendering.
- `dev/`: lil-gui panel (toggle with `~`), stats overlay (FPS, CPU ms, draw calls, triangles, geometries, textures, bodies, heap), and a Rapier debug-line renderer. Loaded only in dev; the production bundle contains none of it.
- `dev/TestScene.ts`: a 256 m noisy test slope, a capsule driven with WASD, Space to jump and R to reset, a chase camera with mouse-drag orbit, and boxes to push around.

**Verified**
- Typecheck, tests (5) and build all pass. No console errors.
- The heightfield collider matches the render mesh to 1.6e-5 m at 64 probe points. That confirms the Rapier layout: column-major, rows along Z, columns along X.
- Rapier user forces persist between steps, so controllers must call `resetForces()` each step or use impulses.

**How to test:** run `npm run dev` and open http://localhost:5173. WASD moves, Space jumps, R resets, mouse drag orbits, Esc pauses, `~` opens the dev panel.

**Notes:** the in-app browser pane throttles requestAnimationFrame, so real FPS has to be judged on a normal browser tab. This machine's GPU is Intel UHD (integrated), so the Medium preset is sized for that class of hardware.

## Phase 2: Course & Terrain

**What was built**
- `config/maps.ts`: both maps as seed + biome + sections. Snow Peak is 19.6 km with a 3.5 km drop; Green Ridge is 21.4 km with a 3.0 km drop. Each section sets grade, width, walls, roughness, surfaces, forest/rock density and features. `config/terrain.ts` holds every shaping constant.
- `world/CourseGenerator.ts`: seeded heading integration. The path stays within ±68° of the fall line, so it can't loop back on itself. Switchback sections get hairpins. The elevation profile is normalized to the configured drop. A centripetal Catmull-Rom spline is resampled every 2 m. The generator also places checkpoints (every 2 km) and km markers.
- `world/Features.ts`: jumps, kickers, gaps, rollers, rock gardens, cliff drops (with a safe line on the other side), overlooks, tunnels (a mound over a channel), and river/ford carves. Arches, ramps and logs are props.
- `world/CourseQuery.ts`: spatial hashes at three densities, an exact nearest-point projection, and continuous kernel-averaged course fields. `ProgressTracker` handles windowed progress (it won't jump between switchback legs).
- `world/TerrainSampler.ts`: one pure height/surface/colour/vegetation function, shared by the workers and the main thread. Course fields are cached on an 8 m lattice.
- `world/terrain.worker.ts` + `WorkerPool`: 2–3 workers build tiles (heights, normals, colours, collider heights, surfaces, prop scatter) off the main thread.
- `world/ChunkManager.ts` + `TerrainChunk.ts`: 256 m tiles.
  - LOD0 (2 m) carries a Rapier heightfield plus tree/rock colliders. It covers the corridor from 1 chunk behind to 3 ahead, plus a 260 m radius around the player.
  - LOD1 (4 m) is render-only, out to the preset's near radius.
  - Builds are budgeted per frame, and prop colliders are created gradually. Unloaded tiles dispose geometry, instance buffers and colliders.
- `world/Backdrop.ts`: whole-map 80 m terrain (built in 0.8 s in a worker). Inside the streamed radius it is sunk below the tiles in the vertex shader.
- `world/Sky.ts`: gradient sky dome, sun with a player-following texel-snapped shadow camera, hemisphere light, horizon-matched fog, and a hazy ring of distant peaks.
- `world/FloatingOrigin.ts`: once the focus is more than 2 km out, the world root, all Rapier bodies, the camera and listeners shift. Static content uses non-auto-updating matrices.
- `world/Props.ts`, `CourseProps.ts`, `models/procedural/*`:
  - Instanced pines, broadleaf trees, bushes, rocks and course marker poles.
  - Streamed unique structures: start deck/gate/hut/flags, km signs, lip flags, ramps, logs, rock arches, tunnel shell with lights, viewpoints, water planes, bridges, finish arch and village.
- `camera/FlyCam.ts` + dev panel: WASD/Space/Q flight, "teleport to km", and an autopilot that flies the whole course.

**Verified**
- Typecheck, 16 tests (length, drop, determinism, no self-intersection, terrain continuity, tile cost) and build all pass.
- Autopilot at 250 m/s over all 19.6 km: 809 tiles built and 8 origin shifts. Memory stayed flat (about 90 geometries, 3 textures, about 90 MB heap at the end) with no console errors.
- About 100 draw calls and 0.4–1.0M triangles on Medium. 85–100 FPS in the pane on this Intel UHD machine.
- Every course structure on both maps builds without errors.

**How to test**
- Run `npm run dev` and press `~`.
- "Fly cam" → `flyWholeCourse`, or set `jumpToKm` and press `teleportToKm`.
- Fly with WASD, Space up, Q down, Shift fast, drag to look.
- `?map=greenRidge` loads Map 2. Its geometry works now; the biome polish comes in Phase 7.

**Known issues**
- Some feature edges (lips, cliff shelves) look jagged at 2 m resolution.
- The tile→backdrop transition around 600 m is visible on large walls.
- Rivers end abruptly where the carve fades out.
