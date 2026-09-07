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

## 10. A check can be right about what it measures and blind to everything else

This one cost more than any other entry here, and it looked like a pacing
change until it was pulled on.

Rift Runner verifies its pattern library with a solver. Every (pattern, realm)
pair is proved clearable before it can be dealt, the check is sound, and it has
never once been wrong about the thing it checks. Meanwhile `#crossGate` — the
code that swaps realms — threw away every obstacle dealt ahead of the runner,
correctly, because they were authored for the old physics, and then set
`cursorTile = Math.max(cursorTile, frontier)`. The dealer runs 2400px ahead, so
`cursorTile` always won and the gap was never re-dealt.

**Every rift was handing out about fifty-four tiles of completely empty
course.** Seventy-two metres, four or five times a run. The shipped medians of
350m and 655m were roughly 84m of running and 270m of gift.

The library check was busy proving the QUALITY of obstacles that were not
PRESENT. Both statements were true at once:

- every pattern the game deals is clearable — verified, and still true
- most of the course had no patterns in it at all — never checked by anything

And nothing could have caught it, because **every test measured distance, which
was the quantity being falsified.** A run that should have died at 84m reported
350m and every assertion downstream agreed with itself.

So, when a check tells you a property holds:

- **Ask what it does not look at.** A soundness proof about the items in a list
  says nothing about how long the list is. A fairness check on obstacles says
  nothing about whether obstacles exist.
- **Be suspicious of a number that is both the headline metric and the thing
  under test.** Distance was the score, the difficulty measure, and the
  quantity the bug inflated. There was no independent witness.
- **When a change moves a metric by 5x, that is a symptom, not a result.**
  Spacing the rifts out dropped the competent median from 550m to 97m with no
  pattern touched. The right response to a number moving that far is to stop
  and find out why, not to retune around it.

The fix was one line. Finding it took measuring something nothing had measured:
whether an obstacle exists near the runner after a realm change. That is a test
now — `a rift no longer hands out free distance`.

## 11. A window a person cannot hit is not difficulty

Three games, the same error, and it is now the most common real fault in this
project.

| Game | The verb | The window |
|---|---|---|
| Rift Runner | slide under a bar | a 0.42s dash covering 143px against a 120px bar — **23px** |
| Rift Runner | dash through a wall | 92px of phasing against a 40px wall — **52px, 0.15s** |
| Rift Runner | `spike-stutter` | a two-tile landing window, three times — **0.01s, one frame** |
| Endless Mini Golf | a par-2 hole | two strokes is an ace or a loss; **no room to be bad once** |

Every one of them passed the check that existed. The mini golf generator proved
each hole sinkable within par; the Rift Runner solver proved each phrase
clearable. **Both were right.** A route existed in all four cases. What none of
them asked is how much room there is to be wrong, and that is the difference
between a skill and a coin toss.

The tell is a phrase that is comfortable in one configuration and impossible in
another with no design intent behind the difference. `spike-stutter` gave 0.51s
in Forge, where gravity is heavy and the jump is short, and 0.01s in the other
three realms. That is not a difficulty curve, it is an accident that happened
to be survivable somewhere.

### The check

Sweep a fan of **simple, human-shaped policies** — "react when the target is T
away, hold the verb for H seconds" — and ask how many get through. Not the
optimal line; a person does not play the optimal line. If a phrase is cleared
only by a hair's breadth of that fan, it is a coin toss however clearable it
is.

```js
// tests/rift-runner.rift.test.mjs — the aimability floor
const FLOOR = 0.08;   // a tenth of a second is about the limit of deliberate timing
for (const pattern of PATTERNS.filter((p) => p.tier <= 1)) {
  for (const realm of REALMS) {
    if (!pattern.realms.includes(realm.id)) continue;
    assert.ok(holdWindow(pattern, realm, FLOOR) >= FLOOR, `${pattern.id}/${realm.id}`);
  }
}
```

Set the floor a little under the human limit so it catches coin tosses rather
than starting arguments about tuning. Verify it against the broken version
before trusting it — the aimability floor was checked against the three-tile
spacing and correctly named all three realms.

**Possible and fair are different questions, and only the first one gets asked
by default.** Any game with a timed verb — a jump, a slide, a dash, a swing, a
parry, a stroke budget — needs both.

## 12. An assertion can pin an accident instead of a property

```js
assert.equal(direct.bankHits, 0, 'the direct bot landed one somehow');
```

That line was true for months and it was never testing what it said. The
intent was "the bot that does not bank does not get the benefit of banking".
What it actually asserted was "a shell never bounces into an enemy by
accident" — which held only because every tank charged the player and died in
a heap near the middle of the arena, so there was rarely anybody standing
where a stray ricochet could find them.

Change the enemies to hold position and spread out, and one accidental
ricochet turns up on the first seed. The test went red, and the game was fine.

**This is the same shape as the windows-too-tight class in section 11**, seen
from the other side. There, a check passed because it measured possibility and
not aimability. Here, a check passed because an incidental condition happened
to make a stricter statement true than the one that mattered. Both are a test
agreeing with itself about the wrong thing.

The tell is an assertion on an **exact extreme** — zero, always, never, all —
about something the code does not actually guarantee. `bankHits === 0` is not
a rule of the game; nothing in `arena.js` prevents a bounced shell from
hitting somebody. It was a statistic that happened to be zero.

So:

- **Ask what the assertion would have to survive.** If the answer is "the
  enemies continuing to behave exactly as they do today", it is pinned to an
  accident. Assert the property instead — here, that the deliberate count
  dwarfs the accidental one:

  ```js
  assert.ok(direct.bankHits * 20 < bank.bankHits,
    'that is not an accident, it is banking');
  ```

- **Be suspicious of exact zeroes and exact equalities in bot outcomes.** A
  distribution is the right shape for a claim about behaviour. An exact figure
  is the right shape for a claim about a rule, and only when the rule really
  says so — `canHurt(sniper, { bounces: 0 }) === false` is exact because the
  code makes it exact.

- **When a test goes red after a change that was not about it, read it before
  fixing it.** The question is not "how do I get this green" but "was this
  measuring what it claimed". Half the time the change exposed a bad
  assertion, and half the time it broke something real; those need opposite
  responses and they look identical at the point of failure.
