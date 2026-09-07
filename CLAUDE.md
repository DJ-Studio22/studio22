# Studio 22 — Project Rules

## What this is
A browser-based arcade game suite. Cinematic landing page, arcade hub, and a
growing set of original games playable on phone, tablet, desktop, and gamepad.
Deployed as a static site to Cloudflare Pages.

## Hard constraints — do not violate these
- Vanilla JavaScript with ES modules only. NO React, NO TypeScript, NO CSS
  frameworks, NO game engines, NO physics libraries.
- NO backend, NO server, NO API calls. This is a fully static site.
- NO localStorage, NO cookies, NO IndexedDB, NO persistence that outlives the
  tab. sessionStorage IS permitted, and only through engine/session.js.
  The promise is "nothing survives the tab": sessionStorage is scoped to a
  single tab and destroyed with it, so it honours that exactly, while
  localStorage and cookies would leave data on disk and do not.
  Games never touch storage directly — they call engine/session.js, which is
  the one place any of this lives. It needs storage rather than plain memory
  because every game is its own page, and a full navigation to the arcade
  tears down memory that a score was just written into.
- NO data collection of any kind. No names stored, no analytics, no tracking.
- NO online multiplayer. Local hot-seat and pass-and-play only.
- NEVER commit on `main`: branch, push, open a PR, wait for both CI checks,
  merge. Nothing on the server enforces this — see the git workflow section
  below for why, and follow it regardless.
- NEVER merge a pull request without confirming its checks are green. Use
  `npm run merge`, which refuses. `gh pr merge` does not look at the checks
  and the rulesets have an admin bypass, so nothing else will stop you.

## Architecture rules
- Games import FROM engine/. Nothing in engine/ ever imports FROM games/.
  This dependency is one-way, always.
- Never reimplement input, canvas scaling, the game loop, audio, or session
  scoring inside a game. Always use the engine module.
- Every game lives in its own folder under games/ with its own index.html
  entry point.
- games.json is the single source of truth for the hub. Adding a game means
  editing that file and creating a folder — nothing else.
- All colors, spacing, and fonts in SITE CHROME come from CSS custom
  properties in styles/tokens.css. No hardcoded hex values in component CSS.
  Site chrome means the landing page, the arcade hub, the party page, and the
  shell's own UI — pause menu, game over, title screen, HUD. Game artwork is
  explicitly exempt; see "Game palettes" below.

## Game palettes
Each game defines its own palette. Games are artwork, not chrome, and pushing
thirteen games through one set of tokens would make them all look like the same
picture. A game's colours are local to that game.

The convention, which every game follows the same way:

- Declare a single `const ART = { ... }` near the top of that game's game.js,
  below the tuning constants and above the engine wiring.
- Flat object, one level deep. Keys name what the colour IS in the artwork,
  not what it looks like: `skyTop`, `birdBeak`, `crackLine` — never `blue2`
  or `lightYellow`. Changing a hue should never force a rename.
- Values are plain CSS colour strings. `rgba()` where something is
  deliberately translucent.
- Nothing else in the file hardcodes a colour. Every fillStyle, strokeStyle,
  and gradient stop reads from ART.
- A short comment above the constant says this is the game's own palette and
  is deliberately not from tokens.css, so nobody "fixes" it later.

Gradients, sprite shading, and particle colours all live here. If a game grows
enough colours that one flat object turns unwieldy, group by subject
(`ART.bird`, `ART.sky`) rather than splitting into several constants.

### What stays consistent
The shell draws on top of every game, and it keeps site tokens regardless of
what the game underneath looks like. Pause menu, game over, title screen, and
HUD must be instantly recognisable in all thirteen games — a player who pauses
should know they are in Studio 22, not in whatever world the game just built
around them. Games never restyle the shell.

## Testing — a game with real tuning gets its simulation extracted

"This is hard but fair" is a claim about numbers, and it cannot be checked by
playing a browser at one run every few seconds. So a game whose difficulty is
a claim splits in two:

- `game.js` keeps canvas, input, audio, camera and shell wiring.
- A **rules module** holds the simulation, free of the DOM, importable from
  Node — `driving.js`, `problems.js`, `board.js`, `swing.js`, `rooms.js`,
  `motion.js`, `gorge.js`, `hold.js`.

Then a bot in `tests/` plays it thousands of times a second.

Four rules, all of them learned the hard way:

- **A test imports the real module, or it is not a test.** Never restate a
  constant. The flip-budget check once restated Gravity Flip's physics instead
  of importing them, passed happily, and was measuring a copy of the game
  rather than the game.
- **Tuning is a plain exported object**, so a test can clone it, change one
  figure and run both versions side by side. See `TUNING` in swing.js and
  `CITY_TUNING` in city.js.
- **Bots come in at least two skill levels.** A change that helps a weak
  player is forgiveness; one that helps both equally is an easier game; one
  that closes the gap has flattened the ceiling. One bot cannot tell those
  apart.

- **A bot is not a player, and the harness cannot see the opening.** Every
  bot starts acting on frame one; a person spends the first seconds working
  out what they are looking at. So anything only wrong during the opening is
  invisible to the harness however good the seeded numbers are.

  This has now shipped TWICE. Ember reached the rock in 0.53s from a standing
  start; Rift Runner put its first obstacle 1.06s after the title cleared and
  died at 11 metres doing nothing. Both passed every bot. It is a class of
  fault, not two coincidences.

  So: **a human plays the first thirty seconds cold, from a genuine standing
  start, before a game is done.** Not optional, and good seeded numbers are
  not a substitute. And the RUN-UP before the first real threat is a number
  somebody chose and can point at — `OPENING_TILES`, a start delay, a first
  wave timer — never whatever the spawn logic happened to produce.

- **Sample the canvas to check things are actually distinguishable.** A
  hazard, a gap or a target that does not read against its background at a
  glance is a bug, and it is invisible to every other check in this project:
  the tests do not draw, the build does not care, and a screenshot looks fine
  until you try to play it. Rift Runner's gaps were within a few percent of
  the ground colour — the void showing through a hole and the floor beside it
  were the same to the eye.

  Reading a row or column of pixels off the rendered canvas and counting
  distinct colours costs almost nothing and answers it outright. Worth doing
  for anything the player has to spot rather than read.

- **A check can be right about what it measures and blind to everything
  else.** Rift Runner's solver proved every pattern clearable and was never
  wrong about it, while the realm-change code deleted every obstacle ahead and
  never re-dealt them — so each rift handed out seventy-two metres of empty
  course and the shipped medians were mostly gift. The quality of the
  obstacles was verified; their existence was not. Nothing caught it because
  every test measured distance, which was the quantity being falsified.

  So: ask what a passing check does NOT look at, distrust a metric that is
  both the headline number and the thing under test, and treat a 5x move in a
  measurement as a symptom to investigate rather than a result to retune
  around.

- **A window a person cannot hit is not difficulty.** Three games, four
  instances: a 23px slide window against a 120px bar, a 52px dash window
  against a 40px wall, a one-frame landing window between spikes, and a par-2
  golf hole where two strokes is an ace or a loss. Every one passed the check
  that existed, because "is there a route" and "how much room is there to be
  wrong" are different questions and only the first gets asked by default.

  Sweep a fan of simple human-shaped policies — react at T, hold for H — and
  require that a real share of them get through. See the aimability floor in
  `tests/rift-runner.rift.test.mjs`. Any timed verb needs it: a jump, a slide,
  a dash, a swing, a parry, a stroke budget.

`npm test` runs the lot. The convention is written up in `tests/README.md`.

## Code style
- Clear, readable, heavily commented. I am maintaining this long term.
- Prefer simple and obvious over clever and compact.
- Small focused files over large ones.

## Universal input requirement
Every game must work with: Xbox/PlayStation gamepad, keyboard, and touch.
This is non-negotiable and is why engine/input.js exists.

### The one sanctioned exception
Keystroke requires a physical keyboard. Typing speed cannot be taught on a
gamepad, and falling back to the on-screen keyboard on a phone is a different
activity rather than the same game. It declares this in games.json with
`"inputRequirement": "keyboard"`.

Every entry in games.json carries `inputRequirement`, and it is required
rather than defaulted, so claiming an exception is always a deliberate act.
Any future exception needs the same explicit declaration. A game that quietly
does not work on some device is not an exception — it is a bug. The manifest
field is what makes the limitation visible to the hub, and therefore to the
player, before they tap into something they cannot play.

## Performance targets
60fps on a mid-range phone. Object-pool anything spawned in a loop.
Never animate CSS layout properties — transform and opacity only.

## Git workflow — branches and pull requests, always

**This is a convention, not an enforced rule, and that is worth knowing up
front.** GitHub does not offer branch protection or rulesets on a private repo
on the free plan — `"protected": false` is what the API reports for `main`, and
the protection endpoints answer 403. Nothing on the server will stop a direct
push.

So the discipline is the whole mechanism. Follow it anyway: CI still runs on
every pull request and every push, so a break is still caught loudly and fast —
the difference is that it is caught *after* the merge rather than instead of
it, and only if somebody is reading.

Every piece of work:

```bash
git checkout -b thing-im-doing
# ... work ...
npm run ci                         # the identical sequence CI runs
git add -A && git commit
git push -u origin thing-im-doing
gh pr create --fill
npm run merge                      # waits for the checks, REFUSES if any fail
git checkout main && git pull
```

- **Never commit on `main`.** Branch first, before the first edit. Nothing
  will refuse the commit, which is exactly why the habit has to be automatic.
  Noticing afterwards means a cherry-pick or a reset, and both are avoidable.
- **Run `npm run ci` before pushing.** It is exactly what the workflow runs —
  `npm test`, `npm run build`, then the two build checks — so a green local run
  means a green remote one and finding out costs seconds instead of a round
  trip.
- **One branch per piece of work.** A branch carrying two unrelated changes
  cannot be reverted without taking both.
- **Merge with `npm run merge`, never with `gh pr merge`.** This is a hard
  rule and it was bought with a broken `main`.

  `gh pr merge` does not look at the checks. It squashes a pull request with a
  failing build without a word, and the repo's rulesets carry an admin bypass,
  so the server does not refuse either. The only thing between a red check and
  `main` was remembering to read the output of `gh pr checks` before typing
  the next command.

  **On PR #16 that did not happen.** The checks were watched, node 24 came back
  red, the merge was typed anyway, and `main` carried a failing suite for a
  commit — found afterwards only because the suite happened to be run again for
  an unrelated reason. Discipline that is only a habit fails exactly when you
  are busy, which is exactly when it matters.

  `tools/merge-pr.mjs` waits for pending checks, refuses on any failure, prints
  what failed, and exits non-zero. There is deliberately **no `--force`**: the
  way past a red check is to fix the branch.

- **Opening the PR is not finishing.** A PR with a red check is unfinished
  work, and "it passed locally" is not a reason to merge past one.
- **A red check is fixed on the branch**, with another commit and another
  push. Never worked around.

Branch names are short, lowercase and hyphenated, named for the work rather
than the process: `ember-difficulty`, `fix-touch-deadzone`, `engine-coverage`.
A `fix/`, `docs/` or `game/` prefix is welcome where it clarifies and never
required.

Without `gh`, the PR can be opened and merged in the browser — GitHub prints a
"Compare & pull request" link the first time a branch is pushed. The full
write-up, including what CI actually checks and why the build is verified
twice, is in `DEPLOY.md`.

## Working style
- Do the simplest thing that satisfies the request.
- Do not add features I did not ask for.
- When I paste an error, fix that error. Do not refactor unrelated code.
- Tell me when something I asked for is a bad idea.
