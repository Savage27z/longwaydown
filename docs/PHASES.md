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

## Phase 5: All Vehicles + Switching

**What was built**
- Seven new rideable vehicles, each with its own procedural model, rider pose and camera profile. All stats live in `config/vehicles.ts`, and the flight tuning is in `FLIGHT`.

  | Vehicle | Top speed (boost) | How it rides |
  |---|---|---|
  | Bicycle | 137 (173) km/h | As in Phase 3: pedal with W. |
  | Mountain Bike | 148 km/h | Longer, softer suspension. Grips better on rock and gravel and survives harder landings. |
  | Motorbike | 158 (187) km/h | Engine pull up to top speed. Hold Space to preload, release to pop a bigger jump. Pitch back on the ground to wheelie. The forks and swingarm compress, and the rider stands up. |
  | Buggy | 166 (194) km/h | A real 4-wheel raycast vehicle (Rapier's `DynamicRayCastVehicleController`). Details below. |
  | Hover Car | 173 km/h | Hovers on glowing pads. Space lifts off into flight: W thrusts, A/D bank-turn, ↑/↓ pitch. The flight meter drains in about 9 s of thrust and recharges on the ground. Switching to it in mid-air goes straight into flight. |
  | Jet | 209 (238) km/h | The rider flies prone under a turbine wing and is always flying once airborne. Fuel lasts about 20 s of thrust and only refills on the ground or while gliding within 15 m of the terrain. There's a 150 m ceiling, and with no fuel it glides. |
  | Snowboard | 130 km/h | Sideways stance, with the board on its edge in carves. Braking skids it sideways. Lands switch. Snow only. |
  | Skis | 144 km/h | The fastest tuck on snow and tighter carves. Brake to snowplough. The poles hang from the hands. Snow only. |

  - **Buggy details:**
    - All-wheel drive, with steering lock that eases off at speed.
    - S brakes, then reverses (capped at 25 km/h). Space is the handbrake: the rear tyres lose side grip so it drifts.
    - Downforce plus an anti-roll assist keep it planted. Arrow keys give air control.
    - Ending up on its roof is a crash. A Shield buff will turn that into an auto-right.
  - **Off snow:** snow-only vehicles lose grip, roll harder and drag more on any surface that isn't snow.
- **Switching:**
  - **The wheel:** hold Q (gamepad LB) to open a radial wheel; the game drops to 0.3× speed while it's open. Pick a vehicle with the mouse direction, the right stick, keys 1–8 or a click, then release Q to swap.
  - **The swap:**
    - Position and heading carry over.
    - Speed carries over, clamped to 1.1× the new vehicle's top speed.
    - Near the ground the new vehicle is set down on it; in the air it keeps its height.
  - **The effect:** a smoke puff and white flash play, the new model pops in with a small overshoot, the camera eases into the new vehicle's profile, and the HUD chip updates.
  - **When it's allowed:** during the intro, countdown and the run (so you can pick at the gate), but not while crashed or after the finish. There's a 0.5 s cooldown.
  - Skis and Snowboard are greyed out with "Snow only" on Green Ridge. The rule lives in `vehicles/slots.ts`, which already has a lock hook for Phase 8 unlocks.
- New modules:
  - `vehicles/Car.ts`, `MountainBike.ts`, `Motorbike.ts`, `FlyingCar.ts`, `Jet.ts`, `FlightModel.ts`, `Snowboard.ts`, `Skis.ts`, `VehicleSwitcher.ts`, `slots.ts`
  - `ui/VehicleWheel.ts`, `fx/Puff.ts`
  - models in `models/procedural/{motorbike,buggy,flyers,boards}.ts`
- The dev panel (~) has a Vehicle folder: pick a vehicle and click "switchNow". The "Vehicle stats" folder follows whatever you're riding. "Camera → orbitCam" spins the camera around the rider for inspection.

**Verified**
- Typecheck, 25 tests (3 new, for the wheel's snow-only and lock rules), production build, and dev code absent from `dist`.
- Bot runs on Snow Peak, 25 s per vehicle, no console errors:

  | Vehicle | Distance | Max speed |
  |---|---|---|
  | Bicycle | 480 m | 94 km/h |
  | Mountain Bike | 666 m | 125 km/h |
  | Motorbike | 983 m | 150 km/h |
  | Buggy | 805 m | 166 km/h |
  | Hover Car | 1122 m | 165 km/h |
  | Jet | 1614 m | 233 km/h |
  | Snowboard | 521 m | 150 km/h |
  | Skis | 748 m | 117 km/h |

- Bot runs on Green Ridge, 30 s each: Buggy 897 m (17 landings, no crashes), Motorbike 1.96 km (no crashes).
- Flight: the Hover Car climbed to about 60 m, ran its meter down in about 7 s, landed and recharged. The Jet climbed to about 150 m and cruised at up to 233 km/h.
- 40 back-to-back switches leave memory flat: 14 bodies and 385 colliders before and after, geometries 113 → 114.
- Each vehicle was checked visually with the rider pose: buggy seat and wheel, hover-car canopy, prone jet, board stance, skis with poles, motorbike.
- Fixed while testing:
  - Releasing Q left the game in slow motion.
  - The jet crashed during construction (an init-order bug).
  - The buggy reversed at 50+ km/h when you held brake.
  - Buggy air pitch was inverted.
  - The buggy didn't report landings (needed for camera shake now and tricks in Phase 6).

**How to test:** run `npm run dev` → Play. During the countdown or the ride, hold Q, point at a vehicle (or press 1–8) and release. Things to try:
- Buggy: Space to drift.
- Hover Car: Space to lift off, W to thrust, ↑/↓ to pitch.
- Jet: Space to hop into the air, then W to fly.
- Motorbike: hold and release Space for a big jump; ↓ on the ground for a wheelie.
- Skis and Snowboard: S to plough or skid.

**Known issues**
- The bot drives every vehicle straight down the line, so it plows the buggy into the first rock garden at about 0.3 km. A player steers around it.
- Flying cuts corners by design. The jet's fuel limits are the balance knob and will need your feel check. Tricks and boost (Phase 6) will also reward ground lines.
- Vehicle model art is a first pass, especially the jet wing and hover-car canopy. Paint and customization come in Phase 8.
- `ArcadeVehicle.ts` is about 460 lines, a little over the module budget. It will be split when tricks move out in Phase 6.

**Next (Phase 6):** pickups and buffs, the boost meter (fed by tricks, near-misses, air and speed), trick detection with combos and pop-ups, buff icons in the HUD, and the extra results stats.

### Phase 5 feel pass ("the rider doesn't look like someone on a vehicle: no motion, no air, no body movement")
- **Rider body dynamics** (`player/RiderDynamics.ts`, tuning in `config/riderMotion.ts`): the rider's body is now a damped spring between hands and feet, driven by what the vehicle actually goes through.
  - Landings compress the legs and arms. Braking throws the body forward and acceleration pushes it back. Corners push seated drivers outward. Rough ground shakes the body. Weightlessness floats it.
  - Air phases: takeoff pop, mid-air tuck (hips back, bike pulled up), reaching for the landing, absorbing the impact.
  - Air controls: the torso throws into flips and the shoulders wind up into spins.
  - The head stays level against the vehicle's lean and pitch, looks into turns and down at the landing, and glances around when slow. The chest breathes.
  - Each vehicle has its own profile: standing riders move through the hips, seated drivers sway through the torso.
- **Per-vehicle moves:**
  - Bicycle: stands up in attack position in the air.
  - Snowboard: lead arm over the nose, trailing arm back; reaches to the toes on toe-side turns and pulls back on heel-side; hips drop inside the turn; Indy grab with the back hand.
  - Skis: angulation with the upper body facing down the hill; the inside pole plants at the start of each turn; double-poling when pushing off slowly; poles out wide in the air.
  - Jet: legs scissor-kick, the back arches when pulling up, the shoulders follow the bank.
  - Buggy: feet press the gas and brake pedals; the hands stay on the wheel as it turns.
- **Switch hop:** the rider hops off one vehicle, arms out, and drops onto the next.
- **Vehicles follow their arc in the air:** nose up off the lip, nose down into the landing.
- **More air:**
  - Jumps are now 26 m wide (were 12 m) and within about 5 m of the line (were up to 15 m). Kickers are 12 m wide and gaps 24 m.
  - There are roughly 40% more jumps and more kickers. Rollers are taller.
  - At speed, bikes and boards no longer stick to crests, so rollers and lips launch you.
  - In bot runs, airtime went from none over 0.35 s in 1.8 km to 7 jumps in 1.2 km, up to 2.4 s and 12 m high.
- **Camera:**
  - Height follows on a spring with velocity feed-forward. Steady slopes track exactly, but takeoffs, landings and bumps now lag and settle, so jumps read as motion.
  - Rolls 20% with a bike's lean and 40% with a flyer's bank.
  - Follows the flight path when climbing or diving.
  - Pulls back a little in the air; boost kicks the FOV.
- **Fixes:** the jet's floating "belly skid" plank was removed. Loading and the dev bot no longer stall in background tabs, where browsers throttle timers.
- **Dev tools:**
  - `__film({...})` renders a run of frames and saves a contact sheet to `.shots/` (gitignored) through a dev-server-only endpoint. Its `view` option gives a camera that frames the rider.
  - The bot now lines up on jumps and pops the lip, and logs its airtime.
- **Tests:** 6 new body-dynamics tests (31 total).

## Re-scope, Steps 1–3: feel fixes, steeper maps, wingsuit race start
The direction changed after the second Phase 5 check: 8-rider races (bots now, online later), a wingsuit start off the summit, maps that go properly downhill, a new flying roadster, and CC0 vehicle art. The plan is in `.claude/plans`; the model shortlist is in `docs/vehicle-models.md`.

**Step 1 — Feel fixes**
- **Camera calmed down:**
  - Rumble 0.12 → 0.04; smaller landing and crash shake; first-person shake at 40%; no shake on vehicle switch.
  - The vertical spring is about 2× stiffer, with max lag 2.2 → 0.8 m.
  - Lean roll 0.2 → 0.07, bank roll 0.4 → 0.2; half the air pull-back.
- **Buggy rebuilt** on the bikes' arcade controller (`vehicles/ArcadeCar.ts`, `Buggy.ts`) instead of Rapier's raycast vehicle:
  - Predictable, and it can't flip on its own.
  - Tight grip; Space handbrake drift (rear grip ×0.32, faster rotation); S reverses up to 25 km/h.
  - Per-wheel ground rays drive the visual suspension; the chassis rolls out of corners, squats and dives on its springs.
  - Bot run: 1.2 km in 30 s at up to 170 km/h, 13 jumps, no crashes. `Car.ts` was removed.
- **One flight scheme for every flyer** (`vehicles/FlightModel.ts`). It's attitude control, so the stick commands a nose angle and wings and nose settle back to neutral when released:
  - A/D bank and turn (coordinated); W/↑ dive; S/↓ pull up or flare; Shift thrust; Space climb (hover car).
  - Assists: stall recovery and a gentle nose-up just above the terrain.
  - Control labels updated.

**Step 2 — Maps that go down properly**
- Grades are about 1.5× steeper on both maps. Snow Peak: 7200 m summit, 6800 m drop. Green Ridge: 6000 m summit, 5550 m drop.
- **The start** has three new sections:
  - **Summit Plateau:** flat, 140–150 m wide.
  - **The Edge:** a new `launchEdge` kernel lifts the summit into a mesa that ends in a sheer 140–150 m face, marked with red flags.
  - **The Face:** about 900 m at roughly 36°.
  - **Runout:** a gentler 900 m apron where wingsuits sink back to the snow.
- The first checkpoint is at the end of the runout. The start gate is 40 m before the edge.

**Step 3 — On foot, wingsuit, race start**
- **On foot** (`vehicles/OnFoot.ts`):
  - Jogs on its own at 25 km/h; W sprints to 36 km/h; A/D steer; Space jumps.
  - Procedural run cycle: alternating strides that lengthen with speed, pumping arms, bounce and lean.
- **Wingsuit** (`vehicles/Wingsuit.ts`):
  - About 1.7:1 glide at roughly 150 km/h, up to about 200 km/h diving. That's steeper than a real suit, so the opening flight lasts about 45 s instead of gliding over half the map.
  - Prone spread-eagle pose that pikes to dive and arches to flare.
  - Cloth membrane between the arms and legs, rebuilt from the skeleton every frame (`player/WingsuitMembrane.ts`); it unfurls on deploy.
- **Rules:**
  - Running off the edge (more than 6 m up) deploys the suit; Space deploys it from 3 m.
  - Touching down hands over to your last ground vehicle (MTB by default; snow-only vehicles are skipped on Green Ridge).
  - The wheel opens once you're off the edge. The wingsuit slot needs 8 m of altitude ("Need altitude").
  - Respawning on the plateau puts you back on foot.
- **Verified:**
  - A full start runs: countdown, 7 s sprint, leap at the lip, about 42 s of flight (up to about 160 m above the slope), touchdown at 1.8 km on the MTB, then riding on at 110–135 km/h.
  - Filmed: the run-up to the edge and the wingsuit over the face.
- **Tests:** 45 total, adding launch-edge flatness and drop, first-checkpoint position, wingsuit glide ratio and speed, dive/flare, auto-level, stall and terrain assists, and the wheel's altitude and on-foot rules.

**Not done yet:** bots and 8-rider races (Step 4), then CC0 vehicle art and the Volt Roadster (Step 5).

## Overhaul A+B: a real downhill trail, Riders Republic–style controls and camera
Feedback: "everything feels off" against **Riders Republic**: controls, looks, physics, no fun, no people, the map doesn't go down properly, and drop the jet. Plan: A+B (this) → feel check → C+D (looks, crowds) → E (bot races).

**A — The trail and the descent**
- **A groomed trail along the whole course**, about 9 m wide (`TerrainSampler.heightWith`):
  - Carved 0.45 m in, with bumps smoothed out.
  - Banked berms in turns (cross-slope from course curvature, up to 0.35), with the outside of the turn higher.
  - Raised lips along both edges.
  - Its own fast, grippy `trail` surface: groomed snow on Snow Peak, dirt on Green Ridge. Icy sections use an icy trail.
  - Off the trail is slower powder or rough ground. Marker poles stand along the trail edges every 24 m.
- **Always downhill:**
  - Grade noise can't drop below 65% of a section's grade.
  - The flat frozen lake became **Frozen Falls** (0.32 grade, ice drops and kickers).
  - River Valley and Farmland go to 0.18–0.2, and finishes to 0.15.
  - Rollers are long and gentle, so they never go uphill.
  - Tests check that every 40 m along the line is lower than the last, outside jumps.
- **Narrower corridors** (45–90 m instead of 60–200 m), and **trees line the trail**: in forest sections they start 2 m past the trail shoulder, plus a loose band along open sections.
- **Treeline fix:** the biome treeline, lowland and snowline bands are now fractions of each map's own descent. The higher summits had pushed whole forests above the old absolute treeline, which is why the map looked empty. Rocks are never on the trail.

**B — Controls, physics, camera**
- **Steering:** the keyboard ramp goes 7/s → 22/s and sticks aren't ramped at all. Turn rates and grip are up for bikes, the motorbike and the buggy.
- **Weight:** air gravity is 1.35× (about 2 g effective), and crests hold at speed again (crest stick 8).
- **Jumps:** lips are 1.6 m (were 3 m) with flatter launches, kickers 1.3 m, gaps 2 m. The hop is quicker (6.2 m/s). Landing alignment only in the last 4 m.
- **Speed follows the slope** instead of sitting at the cap: about twice the aero drag, a firmer soft cap, and lower top speeds (bikes about 115 km/h, boost 145). Bot medians:

  | Vehicle | Section | Median speed |
  |---|---|---|
  | MTB | Powder Fields (steep) | 119 km/h |
  | MTB | Forest | 101 km/h |
  | Snowboard | Switchbacks | 96 km/h |
  | Skis | — | 117 km/h |
  | Buggy | — | 146 km/h |
  | Motorbike | — | 139 km/h |

- **Airs:** average 0.6–1.3 s depending on vehicle and slope (were up to 2.4 s). No crashes in the bot runs.
- **Bike lean:** bikes show 75% of the physical lean.
- **Camera** (Riders Republic–style):
  - Low and close (3.6 m back, 1.25 m up), with tight follow and yaw (14/s), so it never trails your steering.
  - It rides partly up-slope and aims ahead down the hill (slope follow 0.45).
  - Other vehicles' cameras were brought closer too.
- **Jet removed** everywhere; the wingsuit covers flying.
- **Bug fix (pre-existing):** a long respawn (R, checkpoints) could land before that area's terrain collider streamed in, so the rider fell through the world and was respawned in a loop. Respawned riders are now held in place until the ground exists (max 4 s). The held position follows floating-origin shifts.

**Tests:** 53, adding the trail's sink and smoothness, berms banking outward, always-downhill, forest trees beside but never on the trail, and the wheel without the jet.

**Known:** the trail colour band is subtle in shade; trail textures and decals come with Step C (looks). Crowds are Step D. The CC0 nature kit (99 MB) is waiting for your download approval in Step C.

## Looks + crowds (Steps C + D)
Goal: the mountain should look like a lively race venue, not primitives on an empty slope.

**C — Looks**
- **Nature kit** (Quaternius Stylized Nature MegaKit, CC0, downloaded by you):
  - Picks are packed into one 1.6 MB `public/models/nature.glb` by `scripts/build-nature.mjs`: pines, broadleaf trees, rocks, grass and flowers.
  - "Hero" trees are used only within 35 m of the trail, and none on the Low preset. Grass and flower clumps line the trail on grassy ground.
  - Procedural prop parts are cached so instancing works: 221 draw calls, down from 723 or more.
- **Terrain shading** is smooth (the baked height-gradient normals) instead of flat facets.
- **Trail ribbon** (`world/TrailRibbon.ts`): a textured strip laid exactly on the drawn terrain tile, following its LOD0 or LOD1 triangles and normals. A segment is rebuilt when the tile under it changes LOD.
  - Snow Peak: groomed corduroy with groomer-pass seams and faint board tracks.
  - Green Ridge: packed dirt with tyre ruts and stones.
  - Edges fade into the terrain. Ice sections are tinted. It is hidden over water and under alpine snow caps.
  - It streams 120 m behind to 650 m ahead, nearest segments first.
- **Vehicles** (procedural, CC0-free):
  - **Mountain bike:** a full-suspension enduro bike with a hydroformed frame, coil shock on a rocker, a swingarm that moves with compression, gold fork stanchions, 2.4" tyres and brake hoses.
  - **Bicycle:** a modern hardtail trail bike.
  - **Motorbike:** a motocross bike with a twin-spar aluminium frame, upside-down fork, moulded plastics (shrouds with graphics, white number boards, high front fender), coil shock, exhaust and chain drive.
  - **Snowboard:** a sidecut board with a graphic top sheet and strap bindings with highbacks, set at the rider's stance angle.
  - **Skis:** twin-tip skis with graphics, toe and heel pieces and brakes. New poles with grips, straps and baskets.
  - **Hover car:** a white teardrop pod with glowing pads.
  - **Volt Roadster** (new slot): modelled on the 2026 thruster Roadster demo, unbranded.
    - Look: low faceted white wedge, dark bronze bubble canopy, a tail deck that lifts into a wing, four rear nozzles plus a ring of down and side nozzles, and a single seat.
    - It doesn't fly, like the real car. Space fires cold-gas thrusters for a big jump and leaves a gas cloud.
    - Hold Space for a short hover. Side jets speed up flips and spins.
    - The nozzle ring rights the car and cushions landings. Shift fires the rear thrusters.
    - A self-refilling THRUSTERS meter, plus suction-fan grip.
- **Race-event dressing** (`models/procedural/event.ts`):
  - Inflatable arches with canvas banners (START, CHECKPOINT n, and a checkered FINISH).
  - Pop-up tents and feather flags.
- **Dev:** `/src/dev/models.html?ids=…&name=…` renders vehicle models alone from four angles to `.shots/` (dev server only, not in the build).

**D — People**
- **Spectator crowds** (`models/Crowd.ts`):
  - The CC0 rider-pack characters are posed and baked once into static meshes: 8 mixed looks × 4 cheer pose pairs.
  - Each crowd is 2 merged meshes behind a fence collider. They flip between cheer poses within 260 m of the rider and are drawn within 450 m.
  - Placed at the start (both sides), every checkpoint, every other jump and the finish.

**Tests:** 53 (unchanged). Typecheck and build are clean, and the dev viewer is not in `dist`.

## Step E: racing 7 bots (built for online later)
- **One rider class, pluggable inputs** (`player/InputSource.ts`):
  - The player and the bots are the same `PlayerController` with a different `InputSource`: `LocalInput` (keyboard and gamepad) or `BotDriver`.
  - A network player would be a third source.
  - Only the local rider puts events on the global bus (HUD, camera, run); every rider reports to its own `onEvent`.
  - Riders take their own look and vehicle paint.
- **Bots** (`gameplay/BotDriver.ts`):
  - Bots sprint off the summit, fly the wingsuit down the line (dive while high, flare before touchdown), then ride their own lane.
  - They boost on straights as often as skill allows and line up for jumps.
  - Before tight bends they read curvature and brake to a corner speed. Boards and skis don't brake (no engine: lost momentum is gone) and stand up out of the tuck.
  - Seven bots, each with its own name, outfit, paint, ground vehicle (per biome) and skill level (0.74–0.98).
- **Ghost mode:**
  - Terrain colliders only exist near the player. A bot without colliders under it, or 25 m ahead, coasts along the line at its learned ground pace and keeps its lateral position.
  - It becomes physical again once colliders cover it and 62 m ahead, after at least 3 s.
  - Pace is learned only on ground vehicles, not during the run-up or glide, and stays within 0.88–1.1 of a per-vehicle baseline measured from races.
  - Far bots skip the character pose (over 260 m) and aren't drawn past 1.6 km.
- **Race** (`gameplay/Race.ts`):
  - 8-rider mass start in two rows of four, with the player in the front row.
  - The race clock runs until every rider is in. Bots pay the same crash penalty.
  - Rubber band: up to ±7% on boost use and ghost pace at 450 m from the player.
  - Standings put finishers first by time, then everyone by distance. Results give riders still on course an estimated time, marked ~.
- **UI:**
  - The HUD shows position ("3rd/8") and the field with time gaps.
  - Rider dots on the elevation strip, and name tags over nearby bots.
  - A standings table on the results screen.
- **Fix:** respawning now reports the new course position straight away. It used to be stale until the next update.
- **Headless races** (test player auto-riding with full boost):
  - Green Ridge (26 km): all 8 finished between 10:44 and about 14:00.
  - Snow Peak: the test player was 2nd on a snowboard, with motor vehicles fastest. The snow baseline pace was raised after this race.
  - In the Icy Switchbacks, snowboard bots improved from 77–80 km/h with 16–17 s stalled per 50 s, to 95–99 km/h with no stalls.

### Step E feel pass ("too fast and too perfect: bots must make mistakes")
- **Mistakes for every bot** (`BotDriver.mistake`, rates in `BOT_MISTAKES`):
  - Slips, at 0.03/s plus up to 0.09/s for lower skill: running wide, lifting off the throttle, nervous braking, wobbles. Steering slips are gentler at speed.
  - Misjudged lips that don't get popped.
  - Fumbled airs on real jumps, which often end in a bad-landing crash.
  - The steering line always carries a little wobble.
- **Slower, more human pace:**
  - Skill levels 0.54–0.9 (were 0.74–0.98).
  - Boost on 15–55% of straights (was 55–100%).
  - Softer corner speeds.
  - Ghost pace band 0.8–1.0 of nominal, times a skill factor.
- **Ghosts slip and crash too:** random slow-downs (45% pace for 1.5–3.5 s) and occasional 6 s crash stops with the crash penalty.
- **Rubber band:** eases off by up to 14% when a bot is ahead of the player, and pushes up to 8% when it's behind (at 350 m).
- **Headless Green Ridge race** (test player on an MTB boosting half the time):
  - 7 of 8 riders finished within 57 s, with the test player 4th, 0.4 s behind 3rd.
  - Bots crash a few times per race, mostly landings.

### Step E: difficulty, rider collisions, bots switching vehicles
- **Difficulty** (`DIFFICULTY` in `config/race.ts`): Easy, Normal and Hard, picked under "Rivals" on the map select screen, saved, and shown on the results screen.
  - Each level shifts bot skill, mistake odds, boost use, ghost pace and how much bots ease off when ahead.
  - Headless Green Ridge, with the test player on an MTB boosting half the time:
    - Easy: the test player came 3rd, behind two bots that had switched to cars. Easy was softened again afterwards.
    - Hard: a tight field (699–783 s), with the test player 7th.
- **Riders collide:** vehicle colliders now include the vehicle group, with a little restitution, so riders bump and shove.
  - Ghosts are non-solid (`Vehicle.setSolid`) so they never hit anyone while coasting.
  - Ground probes still ignore riders.
- **Bots switch vehicles:** each bot has a garage of 2–3 ground vehicles (per biome, `BOT_GARAGES`).
  - At each checkpoint there's a 45% chance it swaps to another one.
  - Off big airs (10 m or more) it may pull the wingsuit and glide, landing back on its ground vehicle.
  - Switches have a 20 s cooldown. Each headless race had about 16 mid-race switches beyond the landing swaps.
