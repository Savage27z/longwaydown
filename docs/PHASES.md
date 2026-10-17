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

## Phase 3: Bicycle + Character

**What was built**
- `models/ModelLoader.ts`: the single model entry point. Models are procedural by default. `registerGlb(id, url)` + `preloadModels()` swaps in a .glb, which must use the same node or bone names and `paint:*` / `slot:*` material names.
- `models/procedural/character.ts` + `player/Character.ts`: low-poly rider with a pivot skeleton (hips, spine, chest, neck, head, shoulders, elbows, hands, hips, knees, feet).
  - Poses are vehicle-local targets: hip placement, spine/chest/head angles, and hand/foot targets solved with analytic two-bone IK (`utils/ik.ts`).
  - The character also supports procedural flail, fade, and recolouring by material slot.
- `models/procedural/bicycle.ts` + `vehicles/Bicycle.ts`: the bike has spinning wheels and a head-tube steering animation.
  - The crank turns while you pedal (W) and levels out when you coast. Pedals stay level.
  - The mountain-bike variant has a compressing fork.
  - The rider pedals, tucks at speed, stands when coasting fast, leans into turns, and does a "no-hander" (E in the air).
- `vehicles/ArcadeVehicle.ts`: shared arcade ground physics, also the base for boards and skis in Phase 5.
  - A rotation-locked Rapier sphere with two suspension rays and springs along the ground normal.
  - Speed-preserving carving: velocity rotates toward the heading, limited by grip × surface. Skidding costs speed.
  - Pedal propulsion that spins out around 36 km/h. Brakes. Per-surface rolling and soft-snow drag. Quadratic aero with a tuck. Soft top speed.
  - Space hop. In the air, the arrows flip and spin, and there's a landing assist near the ground.
  - Crashes on bad landing angles, hard impacts, sideways landings, or sudden speed loss against trees, rocks or structures.
- `player/Ragdoll.ts`: "ragdoll-lite". The rider detaches into a tumbling capsule with flailing limbs, fades out, and respawns on the line about 2.1 s later. A 3 s penalty event is emitted for the Phase 4 timer.
- `player/PlayerController.ts`: input → vehicle → pose, crash/respawn flow, and automatic reset when more than 450 m off course, fallen below the course or world, or stuck for 6 s. `snapshot()` is serializable for future ghosts.
- `camera/ChaseCamera.ts`:
  - Per-vehicle profiles. Smoothing is applied to the offset from the rider, so the camera never lags at speed.
  - FOV widens with speed. Trauma shake on landings, crashes and rough surfaces.
  - Mouse-drag and right-stick orbit that springs back after 1.5 s. Terrain clearance.
  - C toggles a helmet cam (the head is hidden in first person).
- `dev/AutoRider.ts`: a dev bot that rides the course line at full throttle, fast-forwarding headlessly in chunks.

**Verified**
- Typecheck, 18 tests (IK added) and build all pass.
- The bot rode all of Snow Peak (19.59 km) in 16.9 simulated minutes (57 s wall time). Top speed was 103 km/h, with 59 jump landings and 2 crashes (one bad landing, one tree). It needed no out-of-bounds resets, and there were no console errors.
- Crash → ragdoll → respawn, the helmet cam, origin shifts while riding, and finish-village streaming were all checked in the browser.

**How to test**
- `npm run dev`. W pedal (hold to tuck at speed), S brake, A/D steer, Space hop, arrow keys flip/spin in the air, E no-hander in the air, C helmet cam, R reset onto the line, drag to orbit.
- Dev panel (`~`):
  - "Bicycle" tunes every handling value live.
  - "Fly cam" → `teleportToKm` drops you anywhere on the course.
  - "Auto rider" → `fastForward` runs the whole course.

**Known issues / not yet**
- There is no HUD, timer, checkpoints or menus yet (Phase 4). R resets onto the line at your current position rather than a checkpoint.
- No particles or audio yet.
- The rider pose is approximate in places. The bike can't do manuals or wheelies (motorbike only, Phase 5).

### Phase 3 tuning pass (after first feel check)
- **Speed:** the top speed is now 137 km/h (soft cap), with less aero drag, 1.5× arcade gravity, stronger pedalling up to 54 km/h, and boost up to 173 km/h. The bot's average speed went from 70 to 95 km/h; its top speed is now 143 km/h.
- **Course length:** Snow Peak is now 23.5 km with a 4,000 m drop, and Green Ridge is about 24 km with a 3,500 m drop, so a run still takes 15+ minutes. The bot's perfect line takes 14.8 min.
- **Steering:**
  - Input is ramped (about 0.14 s to full lock), so keys feel analog.
  - Grip is higher (2.1 g), so carves hold the line instead of washing out.
  - The turn rate at speed is higher.
- **Jumps and landings:**
  - Hops are higher.
  - A 0.2 s jump buffer plus 0.16 s of coyote time means pressing Space at a lip pops you off it.
  - The landing assist is stronger and starts at 10 m.
  - Landings are more forgiving: crashes only above 68° or a 26 m/s impact.
- **Camera:**
  - Lower and closer framing that looks further ahead, with less FOV stretch so the rider stays readable at speed, and less rumble.
  - C cycles **Chase → Far chase → First person**, with a toast. First person shows the bars and hands, and follows the bike's pitch and half its lean.
- **Character:** rebuilt with smooth shading and better proportions:
  - Tapered torso with collar, zip and stripe. Joint caps at shoulders, elbows, hips and knees. Tapered limbs, shaped gloves with thumbs, boots with soles. Head with nose and ears.
  - Proper ski helmet with vents, and wrap-around goggles.
  - Meshes are merged per bone and material, so there are fewer draw calls.
  - The bike pose is reworked: flat back, eyes up, elbows out, knees tracking forward, and an attack stance when coasting fast.
- **Speed lines:** radial streaks at the screen edges above 60 km/h (`fx/SpeedLines.ts`).

### Phase 3 art pass (second feel check: "bike and character look sloppy")
- **Rider:** now uses Quaternius's CC0 *Ultimate Modular Men* pack.
  - `scripts/build-riders.mjs` merges all 11 outfits onto one shared 62-joint skeleton, strips the 24 animations and quantizes normals/weights. The result is `public/models/riders.glb`: 4.5 MB, about 1.2 MB gzipped.
  - Every outfit splits into Head/Body/Legs/Feet parts that can be mixed (`config/riders.ts`). The default is the race suit with helmet. Materials are cloned per rider for recolouring in Phase 8.
- **Rig binding layer** (`player/rig/*`): the pose/IK system now drives any skeleton.
  - Bone axes, lengths and rest rotations come from the skin's bind pose. IK is hinge-consistent (no limb twisting), and the pelvis is placed by its hip joints.
  - The procedural rider remains as a fallback if the .glb is missing.
- **Bike rebuilt:** treaded tyres, double-wall rims, 24 crossed spokes, flanged hubs, disc rotors and calipers, a toothed chainring, a 9-cog cassette, a chain loop, derailleur pulleys, a sculpted saddle, a riser bar with grips and levers, a suspension fork (MTB), pinned flat pedals and glossy paint. Parts are merged per material to keep draw calls low.

### Phase 3 pedalling fix (third feel check: "why isn't he cycling?")
- The rider now pedals whenever you hold W or boost, at any speed. Cadence follows speed and is clamped to 65–150 rpm. Coasting levels the pedals in an attack stance.
- Pedalling matters: propulsion now fades out toward about 86 km/h instead of 54 km/h, so W always adds speed (about 83 km/h on the flat).
- Seated pedalling has hip rock and a shoulder counter-sway. Boost is an out-of-the-saddle sprint: the bike rocks with each stroke while the rider's torso counters it.
- The bike is fitted to the new rider: the seatpost is 9 cm taller for the 0.94 m legs, and a tall stem plus riser bar brings the bars up and back for the short arms. The riding posture leans further forward.

## Phase 4: Run Loop

**What was built**
- `core/Game.ts`: the state machine (loading → menu → playing ⇄ paused → finished), driven by menu actions.
  - The menu background is a slow flyover of the course.
  - Switching maps shows the loading screen and fully disposes the old world.
  - Physics only steps while playing or finished.
  - The first ride shows the controls screen before the countdown.
- `core/Save.ts`: a versioned localStorage save with a migration chain, defaults merged into older saves, and corruption-safe loading. It stores settings (quality, volumes, FOV, invert Y, key and pad bindings), best times with checkpoint splits, finishes, distance, unlocks, look and the first-play flag. `?unlockall` unlocks everything for testing and is never written to the save.
- `gameplay/Run.ts`:
  - Stages: intro (an orbit around the rider at the start gate, skippable with Space), a 3-2-1-GO countdown with the rider held, the race clock, then the finish. The finish brings 2.2 s of slow motion, an orbit camera and auto-braking.
  - Crash penalties are +3 s. Run stats: top speed, biggest air (time and height), crashes, distance.
  - Time Freeze support is ready for Phase 6.
- `gameplay/Checkpoints.ts`: checkpoints trigger on course progress, every 2 km. Each records a split and its delta against your best. R, falling off a cliff, going out of bounds or getting stuck returns you to the last checkpoint; crashes respawn you where you fell. Blue "CHECKPOINT n" gates now stand on the course.
- `ui/HUD.ts`:
  - Race timer with penalty and split-delta flashes, and your best time.
  - A whole-course elevation strip: travelled part highlighted, checkpoint ticks that light up as you pass them, finish flag and rider dot.
  - "km to go", altitude, a vehicle chip with icon, and a big speedometer.
  - Boost and flight meters (shown when relevant), plus countdown, checkpoint and finish banners.
- `ui/Menus.ts`, `MapSelect.ts`, `SettingsScreen.ts`:
  - Main menu (Play, Customize — Phase 8, Settings, Controls, Credits).
  - Map select with a course preview, length, drop, best time and a lock ("finish Snow Peak to unlock").
  - Pause menu: resume, respawn, restart, settings, controls, quit.
  - Results: time, NEW RECORD badge, delta vs best, distance, top speed, biggest air, trick score, pickups, crashes, then ride again / next map / menu.
  - Settings: quality preset, FOV, three volume sliders, invert Y, and live keyboard and gamepad rebinding.

**Verified**
- Typecheck, 22 tests (Run lifecycle, checkpoints and penalties, Time Freeze, Save persistence, defaults and corruption) and build all pass.
- In the browser: menu → map select → intro → countdown → ride → checkpoint → R respawn → finish → results → next map → pause/settings all work.
- Five consecutive map switches leave memory flat: textures 5, geometries about 130, heap back to about 110 MB.
- Fixed while testing: each rider part had its own skeleton and bone texture, leaking 13 textures per map switch. Parts now share one skeleton.

**How to test:** run `npm run dev` → Play → Snow Peak. Esc pauses, R returns to the last checkpoint, Space skips the intro. Finish Snow Peak to unlock Green Ridge, or add `?unlockall` to the URL.

**Known issues**
- The start/finish cinematics are simple orbits for now (the Phase 10 cinematic pass).
- Menus are mouse-driven; gamepad menu navigation comes in Phase 10.
- Customize is a placeholder until Phase 8.
