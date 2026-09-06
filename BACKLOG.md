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

## 11. Ballast and Ember — NOT STARTED

Both are in `games.json` as `coming-soon` with taglines, descriptions,
tags and artwork. Neither has a `games/` folder yet, so both are listed
and neither is reachable.

**Ballast** — falling crates into a floating hold. The twist is that a
crate is a WEIGHT: where it lands tilts the hull, a hull far enough over
ships water, and a packed row battens down and slides out of the bottom
rather than vanishing. Crates are odd shapes, deliberately not the seven
standard ones, with their own rotation and their own scoring (tonnage
stowed, not lines cleared).

**Ember** — one-button balloon up a gorge at dusk. Hold the burner to
rise, release to sink; momentum is the whole skill, so the gap has to be
read early. The genre is shared; the character, the palette and the place
are not.

---

## 12. Five new games — [x] DONE

Block Buster, Neon Drift Delivery, Skyhook, Tower Stack, Gravity Flip. Each
got the full treatment: engine integration, own `ART` palette, universal
input, SVG thumbnail, `games.json` entry, live status. All endless; the score
is how far you got in every one.

**Verified**
- Board rules for Block Buster: 18 assertions against `board.js` covering full
  rows, charged columns, cascade gravity, the chain it creates, and the rising
  garbage row. All pass.
- Room library for Gravity Flip: 19 rooms, all passing the file's own checker
  (clear doorway, no column blocked on both surfaces, four clear columns
  between opposite forced stretches). Sequencer checked over 4,000 picks — no
  tier leaks, no immediate repeats.
- Gravity Flip's flip-budget invariant measured across seven run lengths up to
  room 600: 3.78-3.83 columns at every speed, under the budget of 4.
- Played in a browser against a PRODUCTION build: Block Buster clears lines and
  chains (verified with a seeded board); Neon Drift delivers, crashes, and
  scores near misses; Skyhook swings, re-hooks and takes rings; Tower Stack
  shears and tapers; Gravity Flip reached room 37 on a reactive bot and
  restarted cleanly.
- All 13 thumbnails validated by script: tag balance, quote balance, every
  colour a real colour, every gradient reference defined, no id collisions.
- All eleven games launched from `npm run preview`. Every one boots, paints,
  and carries its accessible name. Console clean on all of them, with a canary
  message proving the capture was actually working.

---

## 13. OPEN — judgement calls left for Duval

- **Skyhook difficulty — [x] DONE.** Two real faults found by measurement
  rather than tuning: the hook refused 86% of the anchors it could reach
  (anything below the player), and only 21% of swings were on a rope short
  enough to clear the roof they hung from. Competent first runs went from
  21 m / 1.8 s to 67 m / 5.5 s, runs under 25 m from 256/300 to 33/300, while
  the good/competent gap widened from 1.67x to 8.99x. Full numbers in
  PROGRESS.md.
- **Categories — [x] DONE.** `puzzle` added; Block Buster, Tower Stack and
  Ballast moved into it.
- **OPEN: the bot harness is not in the repo.** Skyhook's difficulty numbers
  come from a script that drives swing.js at two skill levels over seeded
  runs. It lives in a scratch directory, like Circuit Racer's race simulation
  and Number Crunch's arithmetic checks before it — this repo has never kept
  its test scripts. Worth deciding whether that stays true now that three
  games have testable rule modules.

---

## 6b. Social card images — [x] DONE

One image for the whole site: public/social-card.png, wired by
tools/inject-meta.mjs onto all fourteen pages as og:image and twitter:image,
with the card set to "summary_large_image". The width and height in the tags
are measured from the PNG itself rather than written in site.config.json, so
they cannot disagree with the file. Per-game cards were considered and not
built — eleven more images to keep in step with eleven descriptions, for a
preview most visitors never see.

---

## 7. Phase 8 — custom domain — [x] DONE (code side; registrar steps are yours)

**Do**
- Document what the user has to do at the registrar and in Cloudflare Pages,
  since I cannot do it for them.
- Make any code change the domain move needs — absolute URLs in metadata,
  canonical links, sitemap host.

**Verify**
- No hardcoded `pages.dev` host left anywhere it would break.
- Written steps the user can follow without me.

---

## Notes

- `reference/` holds the pre-port originals. Do not edit them.
- Nothing persists between visits. sessionStorage only, via
  `engine/session.js` — see the hard constraints in CLAUDE.md.
- Every game owns its palette locally; only site chrome uses tokens.css.
