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

## 2. Sinkhole — [ ]

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

## 3. Circuit Racer — [ ]

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

## 4. Phase 8 — performance audit — [ ]

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

## 5. Phase 8 — accessibility pass — [ ]

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

## 6. Phase 8 — SEO and metadata — [ ]

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

## 7. Phase 8 — custom domain — [ ]

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
