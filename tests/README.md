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

Seven games have done this, and it has paid for itself every time — twice by
saying a game did not work yet. Ember was arithmetically impossible past
25 km; Ballast's whole twist was decoration until two rules were added
because this harness would not stop saying so.

| Game | Module | What it exists to make measurable |
|---|---|---|
| Circuit Racer | `tracks.js`, `driving.js` | circuit geometry; whether the difficulty levels are actually different |
| Number Crunch | `problems.js` | arithmetic correctness; whether adaptation moves a child sensibly |
| Block Buster | `board.js` | clears, charged columns, cascade, the chains it creates |
| Skyhook | `swing.js`, `city.js` | rope physics, and how far each skill level actually gets |
| Gravity Flip | `rooms.js`, `motion.js` | room passability; the flip-budget invariant |
| Ember | `gorge.js` | whether every generated gap is actually reachable |
| Ballast | `hold.js` | whether managing the list is worth anything at all |

### 3. Tuning is a plain object, so a test can clone it

`swing.js` exports `TUNING`; `city.js` exports `CITY_TUNING`; `gorge.js` and
`hold.js` export a `TUNING` each. All are flat
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
  helpers/dom.mjs                 the smallest DOM engine/ will run against,
                                  plus a manual clock and frame pump
  helpers/skyhook-bot.mjs         the two-skill Skyhook bot (imported, not run)
  helpers/ember-bot.mjs           position-control vs rate-control balloonists
  helpers/ballast-bot.mjs         one stacking brain, with and without the list
  ballast.hold.test.mjs
  block-buster.board.test.mjs
  circuit-racer.driving.test.mjs
  gravity-flip.physics.test.mjs
  ember.gorge.test.mjs
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

---

## 6. A rule measured against a clock needs the clock running

Added after Ballast. Its water comes in per SECOND, and the bots slammed every
crate the instant it spawned — so a seventy-crate voyage took 1.3 seconds of
simulated time and no bot could sink at any tuning. Twelve combinations of
threshold and rate returned byte-identical results, which is what gave it
away: a parameter that changes nothing is usually not a boring parameter, it
is a parameter nothing is reading.

The bots now take a fixed think time over each crate before hard-dropping it,
the same for both so it is never the variable under test.

## 7. A bot is not a player — the known limit of everything above

This is the one blind spot the harness has by construction, and it has now
cost two faults that nothing else in this directory would ever have caught.

**A bot is already playing on frame one. A player is not.**

Every bot here is handed a fully-formed world and starts acting immediately:
reading the gap, scoring the placement, pressing the button. It has no
first run. It never spends a second working out which way is up, where its
character is, or what the button does. So it cannot feel an opening, and
anything that is only wrong during the opening is invisible to it.

Ember shipped exactly that. From a standing start the balloon reached the
rock in **0.53 seconds** — a run was over before a player had finished
reading the screen. Every bot flew it happily and the seeded numbers looked
healthy at both skill levels, because by the time a bot has lost half a
second it has already made three decisions. It was found by opening the game
and looking at it, and by nothing else.

Ballast shipped the mirror of it. Its bots slammed every crate the instant it
spawned, so a seventy-crate voyage took 1.3 seconds of simulated time and the
per-second water rule never fired at all (see convention 6). Both faults are
the same shape: the harness disagreed with a human about **how long things
take**, and the harness is not the one that gets to be right about that.

### So: a human first-thirty-seconds pass, always

Before a game is called done, somebody opens it and plays the first thirty
seconds cold. Not a full playthrough — the opening specifically, because that
is the part the bots structurally cannot see:

- Does anything happen before the player has read the screen?
- Is the first input the game asks for one they could have known to make?
- How long is a first run, in seconds, for somebody who has never seen it?
- Does the game start moving before the player does?

This is required **however good the seeded numbers look**, and the numbers
looking good is not evidence against it. Ember's did.

The harness is for claims about arithmetic. It is very good at those and it
is the only thing that can check them. It is not a substitute for playing the
game, and playing the game is not a substitute for it either — neither one
found what the other did.

---

## 8. engine/ gets covered too, and it is where the worst bugs live

For a long time this directory tested games and not the engine. That was
backwards. Seven games have measured rules modules; `engine/` is 6,500 lines
that every one of the thirteen imports, so a fault there breaks all of them at
once — and the black-screen bug that took every game down lived in
`engine/canvas.js`.

The parts worth covering are not the drawing. They are the arithmetic and the
state machines:

| Module | What is asserted |
|---|---|
| `canvas.js` | screen-to-game coordinates, letterboxing, backing-store size |
| `loop.js` | the fixed timestep, the spiral guard, that a throw stops the loop |
| `input.js` | edge detection, the radial deadzone, device merging, party layouts |
| `shell.js` | scores reaching the session, score direction, `?tournament`, menus |
| `session.js` | storage versioning, bests, the sound preference |
| `manifest.js` | schema validation, search, categories |
| `util.js` | the maths every game leans on |

**Covering the engine paid for itself on the first run.** `Input.pressed('up')`
had never worked: up/down/left/right were not in `BUTTON_NAMES`, so it read an
undefined slot and returned false forever. Block Buster shipped with "Hard
drop: B or up" printed in its own controls list and Ballast copied the line —
two games, one dead control each, for months. Nobody noticed because B worked,
and a dead alternative is indistinguishable from a player who never tried it.

A second, smaller one came out of writing the test rather than running it:
`setKeyboardLayout(playerIndex, layout)` accepted its arguments in either
order without complaint, so a swapped call silently gave a party player a
keyboard that did nothing. It throws now.

### Testing a module that needs a DOM

`helpers/dom.mjs` is a deliberately dumb stub — it records what was asked of it
and returns plausible values. It does not lay anything out, and no test asserts
on how anything looks. If a test needs more DOM than the stub has, that is a
sign it has wandered into rendering and belongs in a browser instead.

Two things it carries beyond elements:

- **A manual clock** (`installDom({ manualClock: true })`). `loop.js` is an
  accumulator and every property worth asserting is a claim about specific
  millisecond values, which `setTimeout` cannot express.
- **`clock.tick(ms)`**, which advances *every* callback queued at that moment
  rather than the oldest one. A page can have several things on
  requestAnimationFrame — the game loop plus the shell's overlay loop — and
  servicing only the first reads exactly like the feature being broken.

One trap worth knowing, because it cost time: menu input is **not** handled by
`shell.update()`. That returns false the moment a screen is open and does
nothing else; overlays run on the shell's own frame loop, because the game loop
is suspended while one is up. Driving a menu in a test means pumping the clock.

---

## 9. Two things the harness cannot see

Both of these have caught real faults in shipped games, and neither is
something `npm test` will ever tell you.

### The standing start

Every bot in this directory acts on frame one. A person does not: they spend
the first seconds working out what they are looking at, where their character
is, and which button does what. So **anything that is only wrong during the
opening is invisible here**, however healthy the medians look.

It has shipped twice now:

| Game | The fault | What the bots said |
|---|---|---|
| Ember | the balloon reached the rock in **0.53s** from rest | fine, at both skill levels |
| Rift Runner | first obstacle **1.06s** after the title cleared | fine, at both skill levels |

Two games out of two that were checked this way. It is a class, not a
coincidence.

**So a human plays the first thirty seconds cold, from a genuine standing
start — doing nothing at all for the first couple of seconds — before a game
is called done.** What to watch for:

- Does anything happen before the player has read the screen?
- How long is the run-up before the first real threat, in seconds?
- Is the first input the game asks for one they could have known to make?

And the run-up itself should be **a number somebody chose**: a named constant
in the tuning that can be pointed at and argued with, not whatever the spawn
logic happened to produce. Rift Runner's is `OPENING_TILES`.

### Sampling the canvas for contrast

A hazard, a gap or a target that does not read against its background is a
bug, and it is invisible to everything else here: the tests do not draw, the
build does not care, and a still screenshot can look perfectly good until you
try to play it.

Rift Runner shipped gaps that were **almost impossible to see**. The sky
gradient showed through a hole in the floor, and at the bottom of the screen
that gradient is within a few percent of the ground colour. The picture looked
fine. The game was unplayable in a way nothing would have reported.

Reading one row of pixels off the rendered canvas and counting distinct
colours settles it in a line:

```js
const d = ctx.getImageData(0, groundRowY, canvas.width, 1).data;
const seen = new Set();
for (let x = 0; x < canvas.width; x += 8) seen.add(`${d[x*4]},${d[x*4+1]},${d[x*4+2]}`);
// a hole in the floor should mean more than one colour on this row
```

Before the fix that row had one colour. After, two, and far apart: `39,50,79`
against `4,6,13`. Worth doing for anything the player has to **spot** rather
than read.
