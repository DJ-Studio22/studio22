# tests/

```
npm test
```

That is the whole command. It runs everything in this directory with Node's
built-in test runner. There is no framework and no dependency to install —
`node --test` and `node:assert` are enough, and adding a runner would be the
only build-time dependency in the project after Vite.

---

## What is tested here, and what is not

**Tested: rules and numbers.** Whether a cascade completes a row nobody built.
Whether a room can be crossed. Whether a lap time is possible. Whether a flip
still costs the ground the room library was authored against.

**Not tested: anything that draws.** No canvas, no DOM, no screenshots. A
module that touches a screen cannot be imported here, and that is the point —
see the convention below.

The value is specific: a wrong colour is obvious in a screenshot, and a
difficulty curve that has quietly become impossible is not. These cover the
second kind.

---

## The convention

### 1. A test imports the real module, or it is not a test

This is the rule that matters most, and it is here because it was once broken.

Gravity Flip's flip-budget check began life as a script that **restated** the
game's constants rather than importing them. It passed. It would have gone on
passing while the game did something else entirely, because the copy only ever
agreed with itself. The physics numbers were moved into
`games/gravity-flip/motion.js` so the test could read the values the game runs
on.

Never restate a constant. Import it. If it cannot be imported, that is the
finding — fix the module, not the test.

### 2. A game whose difficulty is a claim gets its simulation extracted

"This is hard but fair" is an assertion about numbers, and it cannot be
checked by playing a browser at one run every few seconds. So a game with real
tuning splits into:

| | |
|---|---|
| **`game.js`** | canvas, input, audio, camera, shell wiring |
| **a rules module** | the simulation, free of the DOM, importable from Node |

Four games have done this, and it has paid for itself every time:

| Game | Module | What it exists to make measurable |
|---|---|---|
| Circuit Racer | `tracks.js`, `driving.js` | circuit geometry; whether the difficulty levels are actually different |
| Number Crunch | `problems.js` | arithmetic correctness; whether adaptation moves a child sensibly |
| Block Buster | `board.js` | clears, charged columns, cascade, the chains it creates |
| Skyhook | `swing.js`, `city.js` | rope physics, and how far each skill level actually gets |
| Gravity Flip | `rooms.js`, `motion.js` | room passability; the flip-budget invariant |

### 3. Tuning is a plain object, so a test can clone it

`swing.js` exports `TUNING`; `city.js` exports `CITY_TUNING`. Both are flat
objects the game reads at runtime and a test can copy, override one figure in,
and run both versions side by side. That is what turns "this feels better"
into a measurement.

### 4. Randomness is seeded when a comparison depends on it

The bot harnesses replace `Math.random` with a small seeded generator for the
duration of a run, so a before/after comparison plays identical cities rather
than averaging noise away. Restore it afterwards — see `helpers/seeded.mjs`.

### 5. Bots come in at least two skill levels

A difficulty change that helps a weak player is forgiveness. One that helps
both equally is just an easier game. One that closes the gap between them has
flattened the ceiling. A single bot cannot tell those apart, so the harnesses
run a *competent* bot and a *good* one and report both.

---

## Layout

```
tests/
  helpers/seeded.mjs              seeded Math.random, and percentile helpers
  helpers/skyhook-bot.mjs         the two-skill Skyhook bot (imported, not run)
  block-buster.board.test.mjs
  circuit-racer.driving.test.mjs
  gravity-flip.physics.test.mjs
  gravity-flip.rooms.test.mjs
  number-crunch.problems.test.mjs
  skyhook.swing.test.mjs
  thumbnails.test.mjs
```

Anything named `*.test.mjs` is picked up by `npm test`. Files under
`helpers/` are imported by tests and are not run on their own.

## Cost

The whole suite is a few seconds. The seeded bot runs are the slow part and
are deliberately kept to sample sizes that stay inside that budget — large
enough for the medians to be stable, small enough that nobody avoids running
them. If a run needs a bigger sample to answer a specific question, raise it
locally for that investigation rather than in the committed test.
