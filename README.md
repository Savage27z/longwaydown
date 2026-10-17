# Long Way Down

A browser-based 3D downhill freeride game: start at the summit of an absurdly long mountain and ride all the way down, switching vehicles on the fly. Built with three.js, Rapier (WASM physics), Vite and TypeScript. Every model and sound is procedural, so there are no asset downloads.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production bundle in dist/
npm test         # unit tests for the pure game logic
```

Dev builds have a tuning panel (`~` key) and a stats overlay. Neither is included in production builds.

See `docs/PHASES.md` for the build log.
