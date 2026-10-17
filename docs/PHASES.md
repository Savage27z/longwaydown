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
