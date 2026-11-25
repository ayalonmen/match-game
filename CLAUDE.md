# Project notes for Claude

Ember Runes: the match-3 fight Playful Roll (github.com/ayalonmen/playful-roll) mounts for its Battle nodes, built as
a separate module the story game installs. It replaced Ember Wheels (the slot fight, `ayalonmen/slot-machine`) on
2026-11-25. Read `docs/DESIGN.md` before any work.

- Stack matches the story game: Vite + React + TypeScript strict, pnpm, GSAP 3.12.5 (a peer dependency; keep the pin
  in step with the story game). No Tailwind, no Pixi.
- The module boundary is `src/index.ts`. The host owns saves and rewards; the fight gets props and reports through
  `onEnd` / `onContinue`. Don't reach into the host or add a backend here.
- Outcomes come from the seeded RNG (`engine/`) before anything animates.
- Feature folders in `src/features/<feature>/`, imported only through their `index.ts`. `engine/` is pure TypeScript
  with Vitest tests.
- The look and timings come from `docs/reference/ember-runes.src.html`, which Ayalon approved. Keep numbers identical
  unless asked to change them.
- Portrait phones only. Animate transform/opacity. Respect prefers-reduced-motion. Keep art non-explicit.
- Styles are plain CSS with an `er-` prefix (`features/battle/battle.css`) so they work in any host. The host loads
  the fonts (IM Fell English SC, Alegreya Sans).
- The package builds itself on install (`prepare` -> `build:lib`), so a git dependency works.
- Work on a branch; don't push unless asked. `pnpm check` before calling anything done.
