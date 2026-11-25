# Ember Runes: design

A match-3 fight for Playful Roll's Battle nodes. It replaced the Ember Wheels slot fight on 2026-11-25, when Ayalon
approved the prototype ("lock this"). The prototype is `docs/reference/ember-runes.src.html` (its images were in
`img/`, now `src/features/battle/assets/`). Keep its numbers and timings unless Ayalon asks for a change.

## The fight

- A 7x6 board of five runes. Swipe (or tap two) to swap neighbours; a swap that makes no match swaps back.
- Matched groups squeeze into one ball of light that flies to its target. Cascades add +25% each (`comboStep`).
  - Blade 9, ember 6 (+1 burn stack, 4 a stack each foe turn), ruby 4: damage to the foe above the column.
  - Shield +2 armor (cap 20, Shield Wall and dice go past it to 40). Vial +2 HP.
- Each rune charges a hero 7% (rubies 4% to all four). A full portrait is a free power, opened with a cut-in:
  - Kael, Battle Focus: every blade strikes ×1.5, then a crossing slash.
  - Garran, Shield Wall: +20 armor, every foe waits one more turn.
  - Mara, Fire Volley: 6 burning arrows of 14, the last one double.
  - Elin, Mending Herbs: heal 30, every skull becomes a vial.
- Match 4 forges a d20 of that rune, match 5 (or an L / T of five) a golden one that rolls twice and keeps the best.
  Drag it up to aim, or tap it. d20 + 2 against DC 12:
  - natural 1: 8 to the party and two runes turn to skulls;
  - fail: roll ×2;
  - success: roll ×4 and the rune's power (steel: another strike, fire: 2 burn, ruby: +25% charge to all,
    shield: +12 armor, vial: heal 20);
  - natural 20: 120, a bigger power, and the die's row breaks.
- The party shares 140 HP.

## The enemy

- With wards (default): she has 1000 HP and hits 18 every 3 turns, 22 every 2 once enraged at half health. The Ash
  Ward (140 HP, left two columns) hits 14 every 3 turns. The Hex Ward (140 HP, right two columns) curses 3 runes into
  skulls every 3 turns. Each ward standing cuts her damage taken by 25%; breaking one delays her next move.
- Solo (`wards: false`): 1700 HP, acts every 2 turns, switching Soul Lash (32) and Hex (3 skulls); enraged she acts
  every turn (40, 4 skulls).
- Tap a foe to aim every rune at it.
- Difficulty scales her health and damage (and the wards'): easy 0.75 / 0.8, normal 1 / 1, hard 1.25 / 1.15,
  brutal 1.5 / 1.3 (`DIFFICULTY` in `engine/rules.ts`).

## The look (2026-11-25)

Ayalon's Water Hag layout (`docs/reference/design/water-hag-layout.png`) with his antique gold art in
`src/features/battle/assets/ui/`:
- No name row and no buttons on the stage (Ayalon, to give the figure room; the enemy card shows her name). At the
  top: her health in Ember Wheels' ornate frame (the textured red fill is clipped, not squeezed), then the countdown
  seal, her next move and the Warded / Enraged / Burning chips. The test buttons show only with devTools; sound
  follows the host's `muted`.
- The board sits in the gold board frame; its 7x6 cells line up with the tiles (`layout()` places the frame from the
  art's measured grid).
- Hero cards (70px wide, 60px on short phones) use the card frame: portrait in the window, charging rune in the seal, name, the power in a plate tinted
  with the hero's colour, the charge in the thin bar. The party's health uses the thin gold bar frame.
- Short phones (under 740px tall) get a tighter header and narrower cards.

## The enemy as a figure

`enemyFigure` (a Studio full-figure cutout) puts her on the stage in place of the painting: she stands in front of
`stageImage` (the story's scene; her painting by default), blurred and darkened, with the wards at her feet.
- Framing: closer by default (her upper body, as big as the stage allows; Ayalon's pick 2026-11-25); `full` shows
  the whole figure, `auto` picks full body when the stage below the header has 140px or more.
- She breathes (a slow idle), recoils with a red flash and her hurt mood (`enemyFigureHurt`) when hit, gathers and
  lunges when she attacks, and breathes faster in a red aura when enraged. Tapping her body aims at her.
- The enemy card shows the figure too. The demo plays Edda; `?painting` shows Vexa's painting.

## The story tier

`battleTier`: a win with 60% of the party's HP left is critSuccess, any other win success; a loss with the enemy
over 75% is critFail, any other loss fail.

## Code

- `engine/` is pure: board (`findGroups`, `hasMoves`, `newBoard`), dice (`rollD20`), rules (`rulesFor`), the
  seeded RNG. Game decisions (the board, new runes, curses, volley targets, dice) use the seeded RNG before anything
  animates; `Math.random` only places particles.
- `battle/controller.ts` is the prototype's script, scoped to one root element: DOM tiles moved by GSAP, a canvas
  with additive glow for every effect, and the async flow (swap -> matches and cascades -> the foes' turn).
- `battle/RuneBattle.tsx` mounts it; the setup props remount it, the callbacks are read live.
- Under prefers-reduced-motion it speeds GSAP's global timeline ×3 while mounted (as the prototype did) and skips
  the screen shakes.
