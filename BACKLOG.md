# Studio 22 — Backlog

Remaining work, in dependency order. Each task says what to build, what it
has to satisfy, and how to tell it is done.

Tick a task only when its verification actually passed, not when the code was
written.

---

## 1. Finish Keystroke — [x] DONE

`games/keystroke/game.js` and `words.js` exist. What is missing is the host
page, the manifest flip, and verification.

**Build**
- `games/keystroke/index.html`, modelled on the other game pages, plus the
  styles for the custom-text paste dialog (DOM, so tokens.css per CLAUDE.md).
- Flip `keystroke` to `"status": "live"` in `games.json`.
  `tournamentReady` stays **false** — a typing game does not fit
  controller-passing.

**Requirements**
- Keyboard-only for the typing, which is the sanctioned exception already
  declared as `inputRequirement: "keyboard"`.
- Every menu, the keyboard-needed notice and the results screen work on
  gamepad and touch.
- Uses the new `shellTheme: 'light'`.

**Verify**
- `node --check` on both files; word-list checks pass.
- In the browser: setup screen renders, a run types and scores, the results
  heat map draws, the shell's game over opens after it.
- The light shell theme is visibly light — HUD and pause menu readable on the
  paper background.
- Console clean.

---

## 2. Sinkhole — [x] DONE

A falling-block survival game. The floor gives way beneath you.

**Build**
- `games/sinkhole/` with `index.html` and `game.js`.
- Its own local `ART` palette per the convention in CLAUDE.md.
- Full engine integration: canvas, loop, `shell.showTitle`, session, audio via
  `audio.define()`.

**Requirements**
- Universal input: gamepad, keyboard, touch.
- `tournamentReady: true`; flip to live in `games.json`.
- Escalating difficulty; a clear reason to keep playing one more run.

**Verify**
- `node --check`; build passes.
- Playable in the browser end to end: title, run, death, game over with a
  score in the HUD and session best.
- Touch controls present and drawn.
- Console clean. Report page weight.

---

## 3. Circuit Racer — [x] DONE

A top-down time-trial racer.

**Build**
- `games/circuit-racer/` with `index.html` and `game.js`.
- Its own `ART` palette.
- Lap timing, with **lower being better** — the first game in the suite to
  use `Session.setScoreDirection(id, 'low')`.

**Requirements**
- Universal input.
- `tournamentReady: true`; flip to live in `games.json`.

**Verify**
- `node --check`; build passes.
- A lap can be driven and timed in the browser; the best lap is the *fastest*,
  not the slowest — this is the specific thing to check, since every other
  game in the suite ranks the other way.
- Tournament standings rank it correctly (fastest first).
- Console clean. Report page weight.

---

## 4. Phase 8 — performance audit — [x] DONE

**Do**
- Measure every page's weight, gzipped, and record the table.
- Check for anything obviously wasteful: per-frame allocations in game loops,
  gradients or paths rebuilt every frame, particle pools sized wrongly.
- Confirm no game allocates in its update loop in a way that would collect
  mid-run on a phone.

**Verify**
- A weight table in PROGRESS.md.
- Any fix made is a real measured difference, not a guess.

---

## 5. Phase 8 — accessibility pass — [x] DONE

**Do**
- Measure contrast on every text/background pair actually used across the
  site and both shell themes; fix anything under WCAG AA.
- Confirm `prefers-reduced-motion` is honoured everywhere it should be.
- Check keyboard reachability of every interactive control on the DOM pages
  (landing, arcade, party), including focus visibility.
- Check that colour is never the only carrier of meaning.

**Verify**
- A measured contrast table, not an assertion.
- Tab through each DOM page and confirm every control is reachable and its
  focus is visible.

---

## 6. Phase 8 — SEO and metadata — [x] DONE

**Do**
- Per-page `<title>` and `<meta name="description">` — check what is missing.
- Open Graph and Twitter card tags for the landing page and the arcade.
- `robots.txt`, `sitemap.xml`.
- Favicon and app icons.
- Structured data for the game list, if it is genuinely useful rather than
  cargo-culted.

**Verify**
- Every page has a unique title and description.
- The built `dist/` contains the new files.
- Tags validate by inspection against the OG spec.

---

## 8. Circuit Racer — depth pass — [x] DONE

**Done**
- Split into three files: `tracks.js` (circuits as data + geometry),
  `driving.js` (physics, AI, lap counting, no DOM), `game.js` (everything
  that touches a screen). The split is what made the difficulty claim
  testable rather than asserted.
- Casual / Standard / Pro, defaulting to Casual, tuned over 1,200 simulated
  races. First-timer wins 75% on Casual and 0% above it.
- Four circuits, race length 3/5/10, three rivals, slipstream, live
  position, sector splits, start lights with a jump-start penalty, screen
  shake, tyre marks, dust, engine pitch.

**Verified**
- 40 assertions over `tracks.js` geometry; every circuit passes validation.
- Race simulation across all four circuits at 3 and 10 laps.
- Driven in a browser: all four render, finish lines span the road, cars
  stop at the flag, results classify the whole field.

---

## 9. Sinkhole — camera — [x] DONE

**Done**
- Camera follows the fall downward only, with lookahead that grows with
  fall speed. Ledges generate to the bottom of the camera view, which is
  the part that actually fixed falling for ever.
- The ceiling is marked at the top of the screen with its clearance when
  the camera has left it behind.

---

## 10. Card artwork — [x] DONE

**Done**
- Drawn SVG thumbnails for all eight games in `/thumbnails.js`, each in its
  own game palette. Replaces the gradient-and-monogram placeholder.
- Removes the last image requests from the site: the `<img>` on each card
  pointed at a PNG that never existed. The dead `thumbnail` field is gone
  from the manifest schema and from every entry.
- Validated by script, not by eye: tag and quote balance, every colour a
  real colour, every gradient defined, no id collisions between cards.

---

## 11. Ballast and Ember — [x] DONE

Both built, both live. The manifest now has no `coming-soon` entries at all
for the first time — thirteen games, all playable.

**Ballast** — `games/ballast/`, `game.js` + `hold.js`. Crates into a floating
hold: where the weight lands tilts the hull, a hull far enough over ships
water, and a packed row battens down and slides out of the bottom. Score is
tonnage stowed. Crates are deliberately not the standard seven and the rule
is one line — no crate is four cells.

**Ember** — `games/ember/`, `game.js` + `gorge.js`. One-button balloon up a
gorge at dusk. Hold the burner to rise, release to sink; every gap the
generator produces is provably reachable from the worst state a player could
arrive in, and the physics scale with speed so that stays true at any
distance.

**Verified**
- 39 new assertions across `tests/ember.gorge.test.mjs` (16) and
  `tests/ballast.hold.test.mjs` (23). Full suite 208, all passing.
- Two bots each, per the convention. Ember: competent median 153 m against
  good 449 m. Ballast: the bot that ignores the list founders 28 times in 40
  and stows 436 t; the one that weighs it never founders and stows 855 t.
- Played in a browser against a PRODUCTION build, both to game over. Boot
  fallback cleared, canvas painted, console clean, shell game over showing a
  score and a stated ending.
- Page weights: Ballast 24.3 KB, Ember 23.5 KB gzipped.

**Four faults the process found**, all written up in PROGRESS.md Phase 11:
Ember became arithmetically impossible past 25 km; its gorge lost a wall to a
fixed margin; its balloon reached the rock in 0.53 s from a standing start,
which only playing it could have caught; and Ballast's whole twist was
decoration until the crate weights went bimodal and a listing hull started
sliding cargo. Plus a harness bug — bots that slam instantly make a
seventy-crate run take 1.3 seconds, and a rule charged per second never fires.

---

## 12. Security and cross-browser pass — [x] DONE

Verification rather than assurances. Full write-up in PROGRESS.md Phase 12.

**Checked, nothing found**
- Injection: three innerHTML sites in shipped code, all traced to source
  files in this repo. All three user-typed inputs — Keystroke's paste,
  tournament names, and the arcade search that was not on the list — reach
  only `textContent`, `setAttribute` or `ctx.fillText`. No dynamic
  `RegExp` anywhere. Names never enter a URL.
- Credentials: every blob in the history (51 commits, 284 blobs) scanned
  against seventeen patterns. One hit, a false positive on a CSS custom
  property named `token`.
- Headers: every header in `public/_headers` confirmed served on four live
  paths.
- External requests: 91 requests across nine deployed pages, all to our own
  origin, none anywhere else.

**Fixed**
- `vite` 5.4.21 to 7.3.6, clearing both npm audit findings (dev-server-only,
  zero production dependencies either way). Same 48-file output, shared chunk
  1.4 KB smaller, 208 tests and all 13 games verified after.
- HSTS was missing. Added at a year, without `preload`.
- Cloudflare Pages was returning **200 and the landing page for every unknown
  path**. `public/404.html` gives a real 404.
- `.gitignore` did not cover `.env.production` or key material.
- `score.innerHTML` with a literal became `textContent`.

**Known gaps, deliberately left**
- Real Safari on macOS/iOS is untested; Safari cannot run on Windows. WebKit
  26.6 was tested instead, which is faithful for layout and rendering and not
  for audio policy.
- No physical gamepad was connected in Firefox or WebKit.

---
