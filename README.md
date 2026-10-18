# Long Way Down

A browser-based 3D downhill freeride game. You jump off a summit in a wingsuit, land on a bike, and race seven rivals all the way down a 26 km mountain, switching vehicles as you go: mountain bike, motorbike, buggy, Volt Roadster, hover car, snowboard and skis. Along the way there are boosts, tricks, pickups and bottles to throw. There are two mountains, Snow Peak and Green Ridge.

Built with three.js, Rapier (WASM physics), Vite and TypeScript. Sound is synthesised with Web Audio, and the models are either procedural or from CC0 packs.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production bundle in dist/
npm test         # unit tests for the pure game logic
```

## Playing

- **Keyboard:**
  - Ride: W / S pedal and brake, A / D steer, Space hop, Shift boost.
  - Air: E grab, arrow keys flip and spin.
  - Other: F throw, hold Q for the vehicle wheel, R respawn, C camera, Esc pause.
- **Controller:**
  - Ride: RT / LT, left stick steers, A hop, X boost.
  - Air: B grab, right stick flips.
  - Other: Y throw, hold LB for the vehicle wheel, D-pad down respawn, RB camera, Start pause.
  - Menus: D-pad or left stick to move, A select, B back, LB / RB tabs.
- **Customize** (main menu): outfit, colours, goggles, gloves, skin, body type and vehicle paint. Some items unlock by finishing runs, scoring trick points and finding hidden tokens.
- **Settings:** graphics presets, volume, field of view, rebinding for keys and pad, and an "Unlock everything" toggle. Adding `?unlockall` to the URL does the same.

## Deploying

This is a static site. `vercel.json` builds with `npm run build` and serves `dist/`, with long-lived caching for hashed assets. Any static host works.

## Development

Dev builds have a tuning panel (`~` key), a stats overlay, an auto-rider (`window.__bot`) and a model viewer (`/src/dev/models.html`). None of these are in production builds. `docs/PHASES.md` is the build log.

## Assets

The rider (`public/models/riders.glb`) is built from Quaternius's CC0 *Ultimate Modular Men* pack, and the trees and rocks (`public/models/nature.glb`) from the CC0 *Stylized Nature MegaKit*. See `public/models/CREDITS.md`. To rebuild them, extract the packs into `assets-src/` (gitignored) and run the scripts in `scripts/`:

```bash
node scripts/build-riders.mjs "assets-src/quaternius-modular-men/individual/Individual Characters/glTF" public/models/riders.glb
```

If a model file is missing, the game falls back to procedural models.
