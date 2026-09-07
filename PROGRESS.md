# Studio 22 — Build Progress

## Done
- Phase 0: Node, Git, VS Code, Claude Code installed
- Phase 1: Vite scaffold, GitHub repo, Cloudflare Pages auto-deploy live at studio22-anw.pages.dev
- Phase 2: all eight engine modules — input.js, canvas.js, loop.js, session.js, ui.js, shell.js, audio.js, util.js. Verified on desktop keyboard, Xbox gamepad, and iPhone touch across input, canvas, loop, shell, and audio (iOS unlock confirmed on first tap). 60fps confirmed on device.
- Phase 3: games.json + engine/manifest.js, scroll-driven landing page, visual identity in styles/tokens.css, arcade hub
- Phase 4 (partial): Updraft ported from reference/skyhopper.html (19.3 KB gzipped). Engine gaps found during that port are fixed — showTitle(), drawHud best field, ParticleSystem.shift(), TICKS_PER_SECOND, audio.define(), Input.clearTouchLayout()
- Phase 4 (partial): Comet ported from reference/comet.html (19.6 KB gzipped cold, 4.1 KB once the shared engine chunk is cached). First game to use the aim stick. Gaps found and fixed — touch aim stick, aim merged across devices, shell draws the touch controls, pad labels
- Phase 4 (partial): Number Crunch built new (not ported) — games/number-crunch/, split into game.js and problems.js. Adaptive per-operation difficulty, boss rounds, results screen. 26.4 KB gzipped. 38 checks on the arithmetic and adaptation in problems.js
- Phase 4 (partial): Keystroke built new — games/keystroke/, split into game.js and words.js. Typing race with per-key heat map, ghost racer, five modes, four difficulties. First game on the LIGHT shell theme. tournamentReady false. 29 checks on the word lists in words.js
- Engine: shellTheme option (dark default, light) — shell.js picks a token set for its HUD and menus, and sets the canvas letterbox to match. Light palette measured 4.7:1 to 17.9:1, all AA
- Engine: Tournament is now a DYNAMIC import behind the ?tournament check. Game pages dropped 3.8 KB gzipped (Number Crunch 27.0 -> 23.2 KB)
- Phase 4 (partial): Sinkhole built new — games/sinkhole/. Descending faller: drop through gaps before the rising ledge pins you to the ceiling spikes. 20.2 KB gzipped
- Phase 4 DONE: Circuit Racer built new — games/circuit-racer/. Three laps against a blocking rival, fastest lap is the score. FIRST game where lower is better (setScoreDirection low). 20.9 KB gzipped. All six games are now live
- Phase 7 (partial): hot-seat tournaments — engine/tournament.js (rules, no DOM), engine/tournament-ui.js (screens), styles/tournament.css, party.html rebuilt. Three modes, 2-8 players, on-screen keyboard, animated standings, podium. Party page 18.6 KB gzipped. shell.js Phase 7 hook is wired: games need no changes to be tournament-ready
- Phase 15: Endless Mini Golf — game two of five. Procedural crazy golf where
  every hole is PROVED sinkable within par before it is dealt, against a bank
  of strokes rather than a fixed count. Fifteen games live
- Phase 14: Rift Runner — game one of a batch of five. Endless runner whose
  portals change the physics, with a breadth-first SOLVER that proves every
  obstacle pattern is clearable in every realm it can be dealt in. Fourteen
  games live
- Phase 13: CI on every push and pull request, and engine/ coverage taken from
  67 tests to 124. Covering the shared code immediately found Input.pressed('up')
  dead in two shipped games. Whole suite 208 -> 265
- Phase 12: security and cross-browser pass. Injection surface audited end to
  end, full git history scanned for credentials, zero external requests proved
  on the deployed site, headers confirmed live, and the site tested in Gecko
  and WebKit for the first time. Four fixes, none of them a vulnerability
- Phase 11: Ballast and Ember built — the last two `coming-soon` placeholders.
  THIRTEEN games live and nothing left in the manifest that is not playable.
  Both have a rules module and a bot harness; both had a design fault the bots
  found and the browser could not, and one had the reverse. See below
- Phase 10: the editorial layer on the landing page — display type, a section
  index 00-07, mono telemetry, depth planes and one pinned section. Plus the
  sound toggle, which is now a visit preference in engine/session.js rather
  than a per-page default. See the Phase 10 section below
- Phase 9: TWO PRODUCTION BUGS FIXED (see the section below), then five new games — Block Buster, Neon Drift Delivery, Skyhook, Tower Stack, Gravity Flip. Eleven games live

## In progress
- Nothing in flight

## Next
- Nothing queued. Every entry in games.json is `live` — the arcade has no
  placeholder cards left for the first time.


## Phase 9 — the two production bugs

Both were live on the deployed site. Both are fixed, and both are worth
recording because of what they say about how to test this repo.

### Every game launched to a black screen

`engine/canvas.js` referenced `this.#label` twice in `#buildDom()` and never
declared the field. An undeclared private name is a PARSE error, not a runtime
one, so the module never loaded at all — and every game imports it, which is
why it was all six rather than some of them.

The same error failed `vite build` outright. That is the important part: the
broken commit could not produce a `dist/`, so what was being served was
whatever the last successful build had left. The lesson is not "dev tolerated
it" — `npm run dev` would have failed on it too, in the browser, for the same
reason. The lesson is that a FAILED BUILD IS A SILENT DEPLOY: Pages keeps
serving the previous version and the site looks alive while the repo is
broken. Check that the build passes, not just that the site responds.

Fixed by declaring `#label` and defaulting it to `document.title`, which every
game's index.html already sets to "<Game> — Studio 22". No game passes it.

### The arcade search filtered nothing

`applyFilters()` was setting `card.hidden` correctly the whole time. The
browser's own `[hidden] { display: none }` is a USER-AGENT rule, and `.card`
sets `display: flex` as an author rule, which outranks it. So the property was
set on the element and nothing moved on screen. One rule fixed it:
`.card[hidden] { display: none }` in styles/arcade.css.

Worth remembering for any future component that sets its own `display`: the
`hidden` attribute stops working the moment you do, and it fails silently.


## Phase 9 — five new games

All five: engine integration, own `ART` palette, universal input, SVG
thumbnail, `games.json` entry, live. All endless, all scoring "how far you
got". Verified against a PRODUCTION build, not the dev server.

**Block Buster** — `games/block-buster/`, three files. A falling-shape puzzle
whose board comes apart properly: cleared cells fall INDIVIDUALLY rather than
as rows, so a clear low in the stack can complete a row nobody built. That is
the chain, and the chain is the game. Charged cells detonate their column.
Clearing the board completely restyles it — six worlds, each with its own
block art (`chip`, `round`, `gem`, `molten`, `leaf`, `neon`), not just its own
hues. The shape set is nine shapes across THREE sizes and is deliberately not
the standard seven; rotation is a fixed five-candidate shove, not a kick
table. Both documented in `pieces.js`. Board rules live in `board.js`, free of
the DOM, and are covered by 18 assertions.

**Neon Drift Delivery** — `games/neon-drift/`, two files. A courier run
against a clock, where the clock is the only life bar. `traffic.js` gives every
car three rules in order — follow, overtake, yield — so the road rearranges
itself around you: come up fast behind someone and they pull over. Boost
cannot be bought, only earned by passing within a hand's width, so the fast
line and the safe line are the same line taken at different distances.

**Skyhook** — `games/skyhook/`, two files. A rigid-rope pendulum, solved by
projecting onto the circle and dropping the radial velocity, which is what
CONSERVES the swing. Reeling in preserves angular momentum, so pumping a swing
speeds it up out of the maths rather than out of a bonus. `city.js` generates
the skyline against distance with no ceiling.

**Tower Stack** — `games/tower-stack/`, one file. One button. Overhang is
sheared off and width is the only resource. A perfect placement gives some
width BACK, which is what stops the game being a countdown — and the recovery
shrinks as the tower grows, so it never outruns the difficulty. The sky is
interpolated between six bands rather than snapped to one, so the climb is a
continuous change of light.

**Gravity Flip** — `games/gravity-flip/`, two files. One button: which way is
down. 19 hand-authored rooms in `rooms.js`, sequenced by tier, and the file
CHECKS ITS OWN ROOMS at load — clear doorway, no column blocked on both
surfaces, four clear columns between opposite forced stretches. Writing that
checker found several rooms of my own that were genuinely impassable.

The invariant the game protects: **a flip always costs the same number of
COLUMNS, at every speed.** Gravity is scaled by the SQUARE of the run speed, so
fall time drops exactly as fast as forward speed rises and every authored room
stays as passable at room 200 as at room 2. `checkFlipBudget()` asserts this
against `rooms.js` at boot so the two files cannot drift.

FOUND AND FIXED while verifying that invariant: movement was NOT substepped,
and because gravity grows with the square of speed, by around room 50 a single
1/60s tick moved the player 46px — through a 40px tile. Blocks and spikes were
being passed straight through, and it got worse the further you got, which is
the worst possible shape for a bug in an endless game. Movement is now sliced
so no slice travels more than 0.4 of a tile on either axis. Measured before
and after across seven run lengths up to room 600: tunnelling at five of
seven before, none after, and the flip budget tightened from 3.75-4.00 columns
to 3.78-3.83.


## Phase 9 — a puzzle category, and the Skyhook difficulty pass

### Puzzle is a fourth category

Block Buster, Tower Stack and Ballast were all filed under `arcade`, which
made the arcade tab mean "everything that is not a lesson or a car".
`CATEGORIES` in engine/manifest.js gains `puzzle` and the hub builds its
filter tabs from that list, so the tab appeared on its own. Both card grids
tint the art panel by category; puzzle got a blend of the two accents rather
than a share of one, because arcade already owns amber and learning already
owns green.

### Skyhook was refusing the player, not beating them

The complaint was that a first run felt like the game had said no. Two
measurements found out why, and neither was the dial anyone would have
reached for first.

**Skyhook's simulation moved into `swing.js`** to make any of this
measurable — rope, body, city, rings and collisions, with no canvas, no input
device and no clock. `city.js` grew a `CITY_TUNING` object for the same
reason. A bot can now play a thousand runs in a second, against seeded cities
so a before/after comparison is run over identical geometry. Same arrangement
and the same reason as Circuit Racer's driving.js.

Two bots: a *competent* one (180ms reaction, a wide sloppy release window,
pumps the swing less than half the time) and a *good* one (60ms, a tight
release window near the top of the arc, always pumps, dives for speed). A
change that helps only the competent bot is forgiveness; one that closes the
gap between them has flattened the ceiling.

**Finding 1 — the hook refused 86% of the anchors it could reach.**
`bestAnchor` rejected anything below the player on the grounds that "a rope
can only pull upward". Measured at the moment of release, 86% of next anchors
were inside grapple range but BELOW. So the hook was thrown at nothing, the
player fell, and it read as a dropped input. A rope you fall past and catch is
a real move; it is now allowed, penalised so anchors above are still preferred.

**Finding 2 — four swings in five were geometrically doomed.** A pendulum
sweeps over the roof its mast stands on, so the arc clears that building only
while ROPE IS SHORTER THAN MAST. The median mast was 71 tall and the median
rope 178: only **21% of swings could clear the roof they were anchored to.**
Attaching usually committed the player to swinging into the building, which is
why "Hit the roof" was the commonest ending. Masts went up (40-90 to 160-240)
and `ropeMax` came down (380 to 210) until the contract holds nearly always.
The contract is now written down in both files so it cannot be quietly broken.

Then the actual tuning: `curve` on the difficulty ramp went from 1 to 2, so
the opening of a run is nearly flat and the escalation happens later, and
`ringMetres` went 10 to 14 because rings are where a good run separates from
a competent one.

**Measured over 300 seeded runs per skill level:**

| | competent, before | competent, after | good, before | good, after |
|---|---:|---:|---:|---:|
| median distance | 21 m | **67 m** | 35 m | **602 m** |
| median run length | 1.8 s | **5.5 s** | 1.5 s | **16.2 s** |
| 90th percentile | 27 m | **205 m** | 60 m | **1,771 m** |
| best run | 61 m | **515 m** | 123 m | **5,141 m** |
| runs under 25 m | 256 / 300 | **33 / 300** | 0 | 0 |

The good/competent median ratio went from 1.67x to 8.99x, so the ceiling got
further away rather than closer. A competent run now dies at about 0.2% of the
way up the difficulty curve — which is the point: it ends because of how it
was played, not because the city had already got hard.

**Worth recording: GRAPPLE_RANGE was not the problem.** It was one of the
three dials nominated, and once the masts were tall enough, 470, 540 and 620
measured *identically* for a competent player. It went to 540 because it costs
nothing and makes the hook less fussy at the edge of reach, not because it
earned it. Gentler early gaps and wider early buildings were both tried and
both made the competent bot WORSE, so neither shipped.

## Performance audit (Phase 8)

Measured, not estimated. Every page gzipped, as built:

Re-measured at THIRTEEN games (HTML plus every asset the page loads up front,
gzipped at level 9):

| Page | Total (gzipped) |
|---|---:|
| games/circuit-racer/ | 29.2 KB |
| games/keystroke/ | 27.0 KB |
| games/neon-drift/ | 26.7 KB |
| games/block-buster/ | 25.6 KB |
| games/skyhook/ | 25.2 KB |
| games/gravity-flip/ | 24.8 KB |
| games/number-crunch/ | 24.7 KB |
| arcade.html | 24.7 KB |
| games/ballast/ | 24.3 KB |
| index.html | 23.7 KB |
| games/ember/ | 23.5 KB |
| games/sinkhole/ | 23.0 KB |
| games/tower-stack/ | 23.0 KB |
| games/comet/ | 22.8 KB |
| games/updraft/ | 22.5 KB |
| party.html | 20.6 KB |

The shared chunks are util 11.5 KB (util + shell + ui + canvas + loop +
session + audio), input 4.3 KB and tokens 0.4 KB — 16.1 KB carried by every
game page. So the ELEVENTH game costs 5-9 KB, not 22, and the numbers have
barely moved since six.

arcade.html grew 6.9 KB, all of it thumbnails.js: thirteen inline SVG cards
instead of eight. That is still cheaper than one PNG and it is the only page
that pays it.

FINDING: there is no performance problem to fix. Measured in Chrome:

- createLinearGradient with two stops: 0.33 us. Reusing a cached one: 0.035 us.
- createRadialGradient with two stops: 0.455 us. Cached plus a translate: 0.36 us.
- Array.filter on a six-item list: 0.175 us. In-place compaction: 0.06 us.
- The densest per-frame maths in the suite — Circuit Racer's six track
  projections across a fourteen-segment centre line — is 0.002 ms per frame.

A frame budget at 60fps is 16.67 ms. The largest single item above is 0.0005
ms. Rewriting any of it would be a change with no measurable effect, so the
per-frame filters and the Sinkhole lamp gradient were left alone
deliberately rather than tidied on instinct.

The one change made was consistency, not speed: Updraft rebuilt its sky
gradient every frame while Comet and Number Crunch cached theirs and said in
a comment that a gradient is not free. A rule the codebase states and then
breaks is worse than the third of a microsecond it costs.

Particles are already pooled everywhere (engine/util.js), which is the
allocation that would actually have mattered on a phone.


## Accessibility pass (Phase 8)

Measured, not asserted. 50 text/background pairs — every one the site
actually places, across the dark chrome, both shell themes and all eight
player colours — parsed straight out of tokens.css so the check cannot drift
from what ships. **All 50 now meet WCAG AA**; tightest is the light shell's
selected button at 4.7:1.

One real failure found and fixed: --color-text-disabled was 5.2:1 on the
page but **4.47:1 on a raised card**, which is where .card__best and
.card__tagline actually live. It had only ever been checked against the page
background. Now #948b7f: 5.9:1 on the page, 5.1:1 on a card.

Deliberate exemptions, checked so they cannot be forgotten:
--color-text-unlit (2.1:1) is a transient scroll-reveal state that always
resolves to full brightness, and --color-accent-quiet (2.9:1) is decorative
rules that never carry text.

Keyboard: every focusable control on all three DOM pages was walked in tab
order. Landing 13 controls, arcade 14, party 7 (46 with the on-screen
keyboard open). Every one has a visible focus indicator and an accessible
name; no heading levels are skipped; every page sets lang and has one h1.

Reduced motion: the arcade's cards transitioned transform on hover and focus
with no guard — the only gap left, since the reveals and smooth scrolling
were already branched in script. Colour still changes under the setting, so
hover and focus remain visible; only the movement goes.

Colour as the only signal: the Keystroke heat map encoded accuracy purely in
green/amber/red, which is three shades of one thing to a red-green
colour-blind player, on the screen whose entire purpose is "which keys let
you down". Each band now also carries a border weight, so the map works in
greyscale. Everywhere else already had a second channel — tournament
standings pair arrows with a number, players have a number and a name,
Sinkhole's spiked ledges are drawn with actual spikes.


## SEO and metadata (Phase 8)

All fourteen built pages carry a unique title and description, a canonical
link, Open Graph and Twitter tags, a favicon link and a manifest link.
Thirteen of fourteen also carry JSON-LD (party.html has no useful schema
type). Re-counted against the BUILD at eleven games: 14/14 unique titles,
14/14 unique descriptions, 14/14 og:image, 14 sitemap URLs, and every JSON-LD
block parses.

Added: public/robots.txt, public/sitemap.xml, public/favicon.svg (an SVG, so
no binary asset and no separate PNG set), public/site.webmanifest.

Two small generators, both driven by games.json so they cannot drift from
the games that actually exist:
  tools/build-sitemap.mjs   writes public/sitemap.xml, live games only
  tools/inject-meta.mjs     writes the metadata block into every page,
                            idempotent between its marker comments
Neither is wired into the build: they change only when a game ships, which
is a moment worth reading the diff for.

Deleted games/example-game/, the build-glob scaffold. Six real games exist,
it was unreferenced, and it was being built and would have been indexed. The
file itself said to delete it once a real game replaced it.

RESOLVED: og:image and twitter:image are wired to public/social-card.png on
all fourteen pages, and the card is "summary_large_image". The dimensions in
the tags are MEASURED from the PNG by inject-meta rather than written in the
config, so they cannot drift from the file. One image serves every page; see
DEPLOY.md for why per-game cards were not built.


## Custom domain (Phase 8)

The code side is done; the registrar and Cloudflare steps are written up in
DEPLOY.md for Duval to do.

Every absolute URL in the repo now comes from site.config.json — one file.
tools/build-sitemap.mjs and tools/inject-meta.mjs both read it, and
build-sitemap now writes robots.txt too, since robots.txt names the sitemap
by absolute URL and was the one host-dependent file still hand-maintained.

Proved rather than assumed: changing origin to a placeholder and re-running
the two tools left ZERO references to the old host in any html, xml, txt or
json outside the markdown notes. Then reverted.

Moving domain is: edit site.config.json, run the two tools, build, push.

## Notes and known items
- Session storage key is studio22.session.v2. v1 is in LEGACY_KEYS and removed on load. Bumped because v1 could hold LIES: Circuit Racer's broken lap counter wrote impossible times into it as legitimate bests, and sessionStorage survives a reload (it only dies with the tab), so players kept seeing a phantom BEST LAP they never set. Bump the version whenever stored data becomes untrustworthy, not just when its shape changes
- Circuit Racer has an impossible-lap tripwire: a lap quicker than TRACK_LENGTH / MAX_SPEED is refused rather than recorded. It should never fire; it exists because when the lap counter broke, nothing stopped the bad number reaching storage
- Circuit Racer s = 0 must stay on a STRAIGHT. It is the start/finish line and where laps tick. It used to sit on a corner vertex, where round line joins mean the tarmac has no clean perpendicular cross-section and the tangent is ambiguous — the chequered band could not span the road and looked pasted on. [430,104] is collinear with its neighbours, so it splits a straight without changing the circuit; measured track length is identical to 1778.648 either way
- Sinkhole collision is a SWEPT test against a MOVING plane, and must stay one. Both bodies move each tick: the player falls, the ledges rise. Sampling the player before the ledges move and comparing against where they ended up made a resting player measure as already below its own floor, so it fell through every platform. It was NOT tunnelling — measured overshoot was ~1 unit, the size of the rise; tunnelling here would need 19. Do not "fix" this by thickening ledges or capping fall speed
- Sinkhole gap test requires the WHOLE player to fit. An overlap test made every gap effectively a player-width wider and let you drop through by clipping an edge
- Circuit Racer: braking in applyDrive has no floor at zero, which is right for a player who wants to reverse. coastToStop must NOT use it — the first version of the finish fix sent both cars reversing away from the line at the reverse cap. It decelerates toward zero and clamps there instead
- Session.clear() KEEPS score directions. It used to wipe them, which left a running page with no direction and made Circuit Racer rank lap times upward — the slowest lap winning. Directions are a fact about the game, not data about the visit
- Circuit Racer counts laps by accumulated travelled distance, not by crossing a line or by a position threshold. projectToTrack() returns the nearest point on the WHOLE centre line, so a car cutting a corner can be nearest to track it has not reached, which read as a lap and banked a 3.9s lap on a circuit whose fastest possible lap is 4.5s
- DECIDED — Circuit Racer is SINGLE-PLAYER, final. The original games.json entry promised "Split-screen for two on one machine"; that was never built and is not going to be. The description, tagline and tags now all describe the time trial, and the split-screen and multiplayer tags are gone. Two people race it by passing the controller through party.html, where the fastest lap wins. Settled — do not reopen, and do not re-add the promise from the old copy
- Number Crunch keeps its arithmetic in problems.js, deliberately free of the DOM: a division that does not divide exactly, or an adaptation that ratchets a child up three bands on one lucky streak, is a bug that cannot be seen in a screenshot. Run the checks against that file, not the game
- Its ART palette is bright but NOT light, and that is a constraint rather than a taste: shell.js draws the HUD and menus in near-white site tokens, so a pale sky would leave the score unreadable. Any future kids game hits the same wall
- Wiring Tournament into shell.js added the manifest and tournament chunks (~5.1 KB gzipped) to EVERY game page, since every shell now imports them. Worth revisiting if game page weight ever matters more than it does now
- Tournament state lives in sessionStorage under studio22.tournament.v1 — player NAMES included. Same promise as scores: per-tab, gone with the tab, never localStorage. A tournament spans page navigations (party -> game -> party), so in-memory state cannot work
- Games need nothing to join a tournament. engine/shell.js records the score and returns to party.html itself when ?tournament=1 is set; onPassToNextPlayer only exists for a game that wants to override that
- Player colours are tokens (--color-player-1..8 in tokens.css), measured 6.3:1 to 15.9:1 against --color-bg-0. Colour never carries meaning alone: every player also shows a number and a name
- Hero video is BUILT BUT OFF. index.html has data-hero-video="" on the hero; putting a path in it turns the scrub on, empty requests nothing. Encoding spec is in HERO-VIDEO.md — keyframe every 6 frames is the part that matters, normal keyframe spacing stutters. Desktop only, skipped entirely below 1024px, no mobile encode exists
- Comet adds an aimed burn the original never had: the right stick redirects the dash. Centred stick = original behaviour exactly, so the base feel is untouched and keyboard players lose nothing. Keyboard has no aim axis and the how-to-play screen says so
- FIXED (was a bug in the original, confirmed by Duval): Comet's stardust used to grow without bound — waves added five and collection respawned them. The field is now capped at DUST_ON_FIELD (6) and refilled only on collection; waves add threat, not supply. Late waves are meant to be survived by flying well, not by walking through a carpet of pickups
- Virtual touch controls are DRAWN by shell.js and OWNED by input.js. Input decides where the regions are; the shell renders them. Before this they were invisible, which on a phone is indistinguishable from a broken game
- DECIDED — game palettes: every game defines its own colours in a local ART constant in its game.js. The tokens.css rule covers site chrome only (landing, arcade, party, and the shell's own UI). Twelve games sharing one palette would look like one picture. The shell keeps site tokens on top of every game so the pause menu is recognisable everywhere. Convention documented in CLAUDE.md under "Game palettes" — settled, do not reopen
- Engine units are SECONDS. Velocities are units/sec, accelerations units/sec². Ports of per-frame code multiply by TICKS_PER_SECOND (and its square for acceleration) rather than pasting rounded numbers. Watch collision tolerances during a port: a per-frame "how far did it move" term becomes v * dt, not v
- Phase 3 TODO: the arcade hub must surface inputRequirement on game cards. A player on a phone needs to see that a keyboard-only game won't work before tapping in. Keystroke is currently the only "keyboard" entry; everything else is "universal"
- Controller glyph swapping (Xbox vs PlayStation button labels) deferred to Phase 8 polish
- GameCanvas re-fits on window resize, orientation change, container resize (ResizeObserver) and visualViewport resize — the last two matter on mobile, where a collapsing URL bar changes the container without firing a window resize
- RESOLVED: the 30fps seen on iPhone was iOS Low Power Mode throttling requestAnimationFrame, not an engine problem. Plugged in with LPM off: display 59Hz, fps 60, work 1.3ms. iOS does this silently and it looks identical to dropped frames, so compare measured display Hz against frame work time before suspecting the engine
- No DPI cap needed, confirmed on device. GameCanvas leaves devicePixelRatio uncapped; the maxPixelRatio option (2 / 1.5 / 1 for pixel art) stays available if a fill-heavy game ever needs it
- Anything a finger taps must be sized in CSS pixels and converted to game units, never fixed in game units — a 44-unit button is ~18px on a phone. See MIN_TOUCH_PX in shell.js
- input.js only calls preventDefault() on touches it actually claims, and ignores touches starting on buttons/links/inputs. Calling it unconditionally kills the synthetic click and disables every DOM control on touch
- DualSense over Bluetooth on Windows may report non-standard mapping — untested, USB should be fine
- engine/ui.js holds the canvas drawing primitives shell.js uses; games can use it for their own title screens
- A FAILED BUILD IS A SILENT DEPLOY. Cloudflare Pages keeps serving the last good build, so a repo that cannot compile still looks live. `npm run build` passing is a separate fact from the site responding, and only the first one is evidence
- The `hidden` attribute stops working on anything that sets its own `display`. The UA rule `[hidden] { display: none }` loses to any author rule, silently — `card.hidden = true` was being set correctly for weeks while nothing moved. Any component that sets `display` needs its own `[hidden]` rule
- Enter and Space are BOTH bound to the `a` button (see DEFAULT_PLAYER0_LAYOUT). The keypress that dismisses a title screen is therefore still down when the game takes over, and its keyup fires `Input.released('a')` on the first frame of play. Skyhook was cutting its own opening rope this way. Prefer `pressed()` over `released()` for anything a title screen can reach, or the game will act on an input meant for the menu
- Gravity Flip scales gravity by the SQUARE of run speed so a flip always costs the same number of tiles of ground. That is what lets hand-authored rooms stay passable forever. Any change to BASE_SPEED, BASE_GRAVITY or the room height has to keep `checkFlipBudget()` under rooms.js's FLIP_COLUMNS — it warns at boot if not
- Anything whose per-tick movement can exceed a tile MUST substep. Gravity Flip's speed grows without bound, so by room 50 a single tick moved further than a tile and the player passed through solid blocks. Collision only ever looks at where a step ENDED. Circuit Racer and Sinkhole are safe because their speeds are capped; nothing else in the suite may assume that
- A pendulum clears the building its mast stands on only while the ROPE IS SHORTER THAN THE MAST. Skyhook shipped with median mast 71 and median rope 178, so 79% of swings were committed to hitting a roof the moment they attached. If mast heights or rope limits are ever retuned, check that ratio again — it is the difference between a hard game and an unfair one
- Skyhook's hook may take anchors BELOW the player. It used to refuse them, which rejected 86% of the anchors actually in range and read as the button not working. An anchor you fall past and catch is a real move
- Tuning claims for Skyhook are measured, not argued: swing.js and city.js both expose every number as a plain object, and a bot plays seeded runs at two skill levels so before/after runs over identical cities. A change that helps only the weaker bot is forgiveness; one that narrows the gap has flattened the ceiling
- Block Buster's board rules are in board.js, free of the DOM, for the same reason Number Crunch's arithmetic is in problems.js: a cascade that fails to chain is not visible in a screenshot. Test that file, not the game

## Phase 10 — the editorial layer, and one class of bug worth naming

A typographic and structural pass over the landing page, taken from four
reference sites: display type at a tight lead against widely tracked mono
metadata (Sharplink), a headline split into lines with content sitting
BETWEEN them and a long sticky section (Otsuka), edge-anchored live telemetry
and toggles written LABEL[STATE] (Haoqi), and a flush-left composition at low
contrast (United).

Still no image request, no webfont, no network call of any kind.

### The bug worth naming: two owners, one property

The first cut of this put both `.plane__wash` and `.hero__blob--a` on the same
element. Both declare `animation`, both animate `transform`, and they have
IDENTICAL specificity — so source order decided, silently:

- In Chrome, `.plane__wash { animation: plane-drift }` sits later in the file
  than `.hero__blob--a { animation: drift-a }`, so it REPLACED it. The ambient
  drift the hero has always had was gone and nobody would have noticed.
- In a browser without scroll timelines, the `@supports` block does not apply,
  so `drift-a` kept running — and a running animation beats the declared
  `transform` the parallax fallback writes. So `--scroll-y` was computed every
  frame by the rAF loop and rendered nothing.

Both movements were broken, in opposite directions, and the page looked fine
in both.

The fix is structural rather than a specificity patch: **one element owns one
transform.** The wash is now an invisible carrier that owns the scroll
parallax and draws nothing; the blob nests inside it and owns its ambient
drift. Nesting composes the two without either rule having to win. The same
rule is why `.pin__row > *` explicitly sets `transition: none` — the device
list has its own reveal transition on exactly the two properties `--pin-p`
now drives, and leaving both in place is the same bug again.

The general form: **if two rules want the same property on the same element,
one of them is already losing and the cascade will not tell you which.**

### Verified in a real browser, on both paths

No Firefox on this machine and the Blink flag for disabling scroll timelines
no longer exists, so the fallback is exercised by patching `CSS.supports` to
answer false BEFORE the page module runs (that is what picks the JS branch)
and deleting the `@supports` rule from the stylesheet (that is what a
non-supporting parser does with it). Driven over CDP against a PRODUCTION
build. Measured at the same scroll position:

| | native scroll timeline | rAF fallback |
|---|---:|---:|
| wash transform at y=0 | −90.00 px | 0.00 px |
| wash transform at y=2600 | −50.42 px | −50.42 px |
| `animation-name` on the wash | `plane-drift` | `none` |
| `--scroll-y` written by rAF | unset | −0.568 |
| ambient drift on the blob | `drift-a` | `drift-a` |

The two paths agree to two decimal places, which is the point of writing the
same custom property from both.

Reduced motion: `--pin-p` holds at 1, the stage is `static`, the wash has no
animation and no transform, and every held-back element is at full opacity —
the finished composition, with nothing moving.

### The pin

`.anywhere` is the one pinned section: 220svh of scroller around a sticky
stage, so 120svh of scroll is spent on progress rather than on movement. The
headline is split and the devices stand between its two lines.

Progress is one number, `--pin-p`, 0 to 1, written by the SAME rAF loop that
runs the clock and the viewport readout. Deliberately not a scroll-timeline
pair like the parallax: a pin is a composition rather than an ambient effect,
so behaving identically in every browser is worth more than running off the
main thread. It defaults to 1 in CSS, so the no-JS and reduced-motion state is
the finished composition rather than a half-faded one.

The heading stays ONE `<h2>`. `display: contents` promotes its two spans to
grid items of the stage so the device row can be placed on the row between
them; inherited properties still reach the spans, so the display type is
unaffected. Confirmed in the accessibility tree: still `H2`, still reads
"The same game, wherever you open it."

### FOUND WHILE MEASURING: the display type only answered to width

`--type-display: clamp(3rem, 13vw, 11rem)` is fine on its own and wrong in a
viewport. Four lines at 13vw is 651 px of headline, so on a 1440x900 laptop
the hero measured **989 px tall in a 900 px viewport** — the accent rule, the
metadata row and the scroll cue were all below the fold, on every desktop size
tested. 1280x720 was worse at 955.

Both display sizes now answer to both axes — `min(13vw, 16vh)` — and the same
correction was needed on the pinned stage's headline, its lead paragraph and
its gaps. Measured after, stage height against viewport height:

| Viewport | Stage | Fits |
|---|---:|:--|
| 1920x1080 | 1080 | yes |
| 1440x900 | 900 | yes |
| 1280x720 | 720 | yes |
| 820x1180 (iPad) | 1180 | yes |
| 390x844 (iPhone) | unpinned | n/a |

A first attempt shrank only the shelf the devices stand on. That was wrong and
the screenshot showed it immediately: the frames are sized by WIDTH, so they
overflowed the shorter shelf and collided with the headline. Shelf height and
frame width are tuned as a set at each breakpoint and cannot be moved apart.

### The rest

- **Section index 00-07** across the landing page, replacing `.eyebrow`
  everywhere including the card builder and the arcade head. Zero `.eyebrow`
  elements left on either page.
- **Card metadata** — a positional 1-based number, the category, difficulty
  and age, and what the game can be played with. The input field is the one
  load-bearing entry: it is how somebody on a phone learns Keystroke wants a
  keyboard before tapping it, and it comes from the manifest's required
  `inputRequirement`.
- **Sound is a visit preference.** Every game page is its own document, so
  `#soundOn` was born true twelve times over; muting a game and opening
  another lost it. It lives in `engine/session.js` now beside the score
  directions, for the same reason — a preference about the visit rather than
  data about it.
- **Dead CSS removed**: `.hero__title`, `.hero__word`, `.hero__word--accent`,
  `.hero__tagline`. `.card-meta`, `.meta--dim` and `.pin` are all in use now
  rather than written and unreferenced.

index.html went 19.6 KB to 23.7 KB gzipped, arcade.html 23.5 to 24.6. Most of
the landing page's growth is the manifest and thumbnail chunks it now shares
with the arcade, plus session.js for the sound toggle.

## Phase 11 — Ballast and Ember, and four faults the harness found

The last two `coming-soon` entries. Both got the full treatment: own folder,
own `ART` palette, universal input, engine integration, manifest entry, and a
rules module with a two-skill bot harness because both games make a claim
about difficulty.

The interesting part is not that the bots passed. It is what they refused.

### Ember — one burner up a gorge at dusk

`games/ember/`, two files. Hold to rise, let go to sink. The gorge scrolls
past and the rock ahead has a gap in it.

**The reachability contract.** The game claims momentum is the skill, so the
gap has to be read early. That is arithmetic, and `gorge.js` states it as one
function: `reachableOffset()` answers how far the balloon can move vertically
in the time before the next gate, starting from the WORST state a player
could legitimately arrive in — at the edge of the previous gap, at terminal
velocity, moving the wrong way, with the gust against them, under the WEAKER
of its two accelerations. `nextGate()` clamps every generated gap into that
band, so the contract holds by construction rather than by hoping.

The test asserts the contract AND that the clamp actually binds on a decent
fraction of gates. A guarantee that never fires is a coincidence.

**FAULT 1 — the gorge became literally impossible at 25 km.** The first cut
let the forward drift rise forever while the balloon's accelerations stayed
fixed. Every kilometre shrank the reachable band; it hit zero at about 25 km
and went negative after. Past there, no perfect player could have crossed it.

Same fault as Gravity Flip and the same fix: accelerations scale with the
SQUARE of the drift and terminal velocities scale linearly with it, so the
time terms shrink exactly as fast as the speed rises and every vertical
distance is invariant in pixels. Measured after: the reachable band settles at
303.6 px and does not move between 30 km and 10,000 km, and the momentum cost
is 82 px at every speed. What escalates instead is honest — the gap narrows,
the gates tighten, and it all happens in less wall-clock time.

**FAULT 2 — the gorge lost a wall.** A fixed 74 px margin bounded the gap
CENTRE, but half a 265 px gap is 133, so the ceiling was drawn 58 px above the
top of the world. The margin is derived from the gap width now, which also
fixes a difficulty that was backwards: a wide early gap can no longer roam as
far as a narrow late one.

**FAULT 3 — found by playing it, not by the bots.** The accelerations were
nearly three times what they are now. From a standing start the envelope
reached the rock in **0.53 seconds**, so a run was over before a player had
finished reading the screen. Every bot missed it because every bot was
already flying on frame one. Slower is also better for the claim: the momentum
cost is now 82 px against a 265 px channel instead of 55.

**Measured, 40 seeded runs per skill:**

| | competent | good |
|---|---:|---:|
| median | 153 m | **449 m** |
| 90th percentile | 332 m | 702 m |
| best | 353 m | 841 m |
| worst | 69 m | 212 m |

The two bots share everything except how far ahead they read and whether they
control position or RATE. That gap — 2.9x — is the momentum claim, measured.

### Ballast — stack the hold, keep her level

`games/ballast/`, two files. Crates drop into a floating barge. Where the
weight goes tilts the hull, a hull far enough over ships water, and a packed
row battens down and slides out of the bottom. Tonnage stowed is the score.

Crates are deliberately not the standard seven, and the rule that keeps it
that way is one line: **no crate is four cells.** Sizes are one, two, three
and five, which rules out all seven tetrominoes at a stroke.

**The two bots share one stacking brain and differ only in whether they look
at the list.** So the gap between them is not "how good is the player", it is
"what is the twist worth". That question turned out to have an uncomfortable
answer three times running.

**FAULT 4 — the twist was decoration, and stayed decoration through two
attempted fixes.**

First measurement: the careful bot scored **a third** of the careless one. It
was paying for a hazard that never arrived — with 47 t of cargo against a
120 t hull it was arithmetically impossible to reach the shipping threshold.

Fixing the hull mass was not enough. A bot that packs a flat, low, hole-free
stack **stays level for free**, because "flat and even" and "balanced" are
almost the same objective, and random weights average out faster than they
accumulate: relative lopsidedness falls as the count grows. Twelve
combinations of threshold and rate returned identical results.

Two rules exist because of that, and the game does not work without either:

- **The weights are bimodal.** A 26-tonne ingot in one cell against five-cell
  crates of 1 t/cell. A quarter of a typical load in a single cell cannot be
  averaged away, so where it goes is a decision on its own.
- **A listing hull slides cargo.** Past 5 degrees a landing crate shifts one
  column downhill. That breaks the equivalence: careful packing stops working
  while she is over, so the list is something you must fix before you can go
  back to stacking. It is also exactly what the game said it was about.

**And a harness bug worth recording.** Even after both rules, no bot could
ever sink. The bots slammed every crate the instant it spawned, so a
seventy-crate run took **1.3 seconds** of simulated time — and the water is
charged per second. A rule measured against a clock has to be measured with
the clock running. The bots now take 0.75 s over each crate before dropping
it, which is how the game is actually played.

**Measured, 40 seeded voyages per bot, identical crate sequences:**

| | packer (ignores the list) | mate (weighs it) |
|---|---:|---:|
| median tonnage | 436 t | **855 t** |
| 90th percentile | 1,616 t | 3,837 t |
| best | 2,967 t | 4,869 t |
| foundered | **28 / 40** | **0 / 40** |

Two things at once: managing the list is worth 1.96x, and it is genuinely
manageable — the careful bot never once shipped enough water to sink. That
second number is the fairness claim. A list you cannot undo is a countdown.

The recoverability is also asserted directly rather than inferred: a test
loads her hard over and adds cargo to the high side one cell at a time,
checking the list comes back MONOTONICALLY at every step.

### Also in this phase

- `Flight.gatesPassed` counted gates as they were dropped from the render
  window, which is a much later event than passing them — the game over panel
  reported zero gates passed on a run that had flown through six.
- Ballast's controls now match Block Buster's exactly (turn on A, hard drop on
  B or up). They did not, and a player who knows one stacker should not have
  to relearn their thumbs for the other.
- Ember's parallax far wall poked into the channel and read as slabs of rock
  floating in the gorge. In a game whose contract is that what is drawn is
  what is solid, a background that looks solid is a lie. It is haze now.
- Ballast's landing ghost was a filled rectangle and read as cargo already
  stowed. It is a dashed outline with a downhill arrow when she is sliding.
- The arcade no longer says "0 still in development".
- `engine.manifest.test.mjs` asserted that some coming-soon game existed to
  test search against. Shipping the last two placeholders emptied that set and
  failed a test about search. It states the property directly now — every game
  is findable by its own title whatever its status — which holds on any
  catalogue including an all-live one.

## Phase 12 — the security and cross-browser pass

Asked for verification rather than assurances. Most of it came back clean; the
things that did not were hygiene rather than holes. Nothing found was
exploitable.

### Injection surface — clean, one sink tidied

There are exactly **three** places in shipped code that write HTML, and all
three were traced to their source:

| Where | What it writes | Verdict |
|---|---|---|
| `index.html`, `arcade.html` | `media.innerHTML = thumbnailFor(id)` | SVG from `thumbnails.js`, keyed by an id from `games.json`. Both are source files in this repo. No user input can reach it. |
| `games/keystroke/game.js` | the paste dialog's markup | A **static template with no interpolation**. User text arrives via `textarea.value` and leaves via `textarea.value`, which is never parsed as HTML. |

There are three inputs a person can type into, not two:

- **Keystroke's pasted text** — `textarea.value` to `prepareCustomText()`
  (pure string work) to an array of lines, drawn one character at a time
  through `UI.text()`, which is one `ctx.fillText`. `engine/ui.js` touches the
  DOM exactly once in the whole file, to read tokens with `getComputedStyle`.
- **Tournament player names** — every name reaches the page through `el()` or
  `navButton()`, and both assign `textContent`. The two attribute writes use
  `setAttribute('aria-label', ...)`, which takes a string. Names are also
  whitelisted at the source: the physical-keyboard handler accepts
  `/[a-z0-9 ]/i` only and caps the length. And they never enter a URL —
  `urlForTurn()` builds `${game.path}?tournament=1` and nothing else, so names
  stay in sessionStorage exactly as the privacy note claims.
- **The arcade search box** — which was not on the list and should have been.
  The query is lowercased and used with `String.includes()`. It builds no
  regex, no selector, and is never echoed back to the page; the result is a
  Set of ids used to toggle `card.hidden`.

`new RegExp` appears nowhere in shipped code, so there is no dynamic-pattern
surface at all.

**Changed:** `score.innerHTML = 'Best this visit'` became `textContent`. It was
a string literal and perfectly safe, which is exactly how an innerHTML sink
survives long enough for somebody in a hurry to hand it a variable. The two
thumbnail sinks now carry a comment saying why they are allowed.

### Credentials — nothing, in 51 commits and 284 blobs

Every blob in the entire history was extracted and scanned against seventeen
patterns: AWS, GitHub (classic and fine-grained), Slack, Google, Stripe,
Anthropic, OpenAI, npm, JWTs, private-key blocks, bearer literals, basic-auth
URLs, dotenv-shaped lines, and generic secret assignments.

**One hit, and it is a false positive:** `token: '--color-player-1'`, a CSS
custom property name in the tournament colour table.

No env file, PEM, key, npmrc or wrangler config has ever been committed.

**Changed:** `.gitignore` covered `.env` and `.env.local` only. Vite also loads
`.env.[mode]` and `.env.[mode].local`, so `.env.production` — the one most
likely to hold something real — was tracked. It is `.env.*` now, plus key
material and Wrangler local state.

### npm audit — was two, now zero

Both findings were the same thing: `esbuild <=0.24.2` via `vite@5.4.21`,
letting any website talk to the **dev server**. It cannot touch the deployed
site: there is no server, esbuild is not shipped, and `npm ls --omit=dev`
prints `(empty)` — this project has **zero production dependencies** and twelve
packages installed in total.

No fix existed inside vite 5.x; 5.4.21 is the last of that line and still ships
the affected esbuild. Upgraded to **vite 7.3.6**, and verified rather than
assumed:

- `npm audit`: 0 vulnerabilities.
- Build output: the **same 48 files**, same names once hashes are normalised.
- The shared `util` chunk got *smaller* — 12.46 KB to 11.04 KB gzipped, from
  the newer esbuild's minifier.
- 208 tests pass; all 13 games boot, paint and log nothing from the new build.

### Zero external requests — proved, not asserted

The landing page promises nothing is collected. Measured on the **deployed**
site with a cold profile and the cache disabled, capturing every request
including WebSockets, across nine pages:

**91 requests, 91 to `studio22-anw.pages.dev`, 0 to anywhere else.**

The CSP already forbids it, but the CSP is a rule and this is the behaviour.

### Headers — all present and correct on the live site

Every header in `public/_headers` was confirmed on four live paths (root, a DOM
page, a game page, a hashed asset): the full CSP, `nosniff`, `no-referrer`, the
Permissions-Policy denials, COOP, CORP and `X-Frame-Options: DENY`.

**Two gaps found and fixed:**

- **No HSTS.** Added at one year with `includeSubDomains` and deliberately
  without `preload` — preload is the one directive here that cannot be taken
  back, and a year gets essentially all the protection while staying reversible
  if the site ever moves to a custom domain.
- **A soft 404.** Cloudflare Pages was answering **HTTP 200 with the full
  landing page for every unknown path** — `/this-does-not-exist-xyz` returned
  200 and the front page. That is a crawler indexing unlimited duplicates and a
  mistyped link that looks like it worked. `public/404.html` fixes it; Pages
  serves it with a real 404 status. It is self-contained with an inline style
  block because a file in `public/` cannot reference Vite's hashed CSS, and a
  404 page that fails to load is a poor joke.

Incidentally confirmed: `reference/` is **not** deployed. It only appeared to
be, because every unknown path was returning 200.

### Cross-browser — first test outside Chromium

Everything before this had been Chrome. Run against the **deployed** site in
three engines, at a desktop and a phone viewport.

**Be clear about one limit: Safari cannot run on Windows.** What was tested is
**WebKit 26.6**, the engine Safari is built on, via Playwright. That covers
layout, CSS, canvas and JS faithfully. It does **not** model Safari's
autoplay/audio-unlock policy, and real Safari on macOS and iOS remains
untested. Playwright and its engines were installed outside the repo — nothing
was added to `package.json`.

| | Chromium 153 | Firefox 155 | WebKit 26.6 |
|---|---|---|---|
| `animation-timeline: scroll()` | yes | **no** | yes |
| parallax path taken | scroll-timeline | **rAF fallback** | scroll-timeline |
| parallax actually moved | -90 to -40.9 | **0 to -40.2** | -90 to -40.2 |
| pin sticky + progress | yes, 0.563 | yes, 0.599 | yes, 0.600 |
| stage fits one screen | yes | yes | yes |
| sound toggle | works | works | works |
| canvas aspect held | 1.761 = 1.761 | 1.761 = 1.761 | 1.761 = 1.761 |
| audio before gesture | running | **suspended** | n/a, see below |
| audio after gesture | running | **running** | n/a |
| console | clean | clean | clean |

**All 13 games x 3 engines x 2 viewports = 78 loads, every one clean:** module
graph parsed, boot fallback removed, canvas letterboxed to the correct aspect,
inside the viewport, and painted.

Three things worth recording:

**Firefox is the first real proof of the rAF fallback.** Gecko does not support
scroll-driven animations, so it took the fallback path for real rather than the
emulation used in Phase 10 — and it works: `animation-name: none`, `--scroll-y`
written at -0.447, transform moved. The two paths land within 0.7px of each
other at the same scroll position.

**Firefox is also the only engine that suspends audio until a gesture**, which
is the case `engine/audio.js` was written for. It went suspended to running
after one keypress. Chromium's headless profile reports running immediately, so
it never exercises that path — the unlock had never actually been tested until
now on anything but an iPhone by hand.

**WebKit-on-Windows has neither `AudioContext` nor `navigator.getGamepads`** —
a limitation of that Playwright build, *not* of Safari, which has had both for
over a decade. Reporting it as a Safari finding would be wrong. But it
accidentally ran a test worth having: the whole site loaded, every game painted
and the console stayed clean **with no Web Audio and no Gamepad API at all**.
Both guards turn out to be deliberate — `audio.js` does
`const Ctor = window.AudioContext || window.webkitAudioContext; if (!Ctor) return null;`
and `input.js` wraps `navigator.getGamepads` in a `#safeGetGamepads()` that
try/catches and returns an empty array. They work.

### What was NOT verified

- **Real Safari, on macOS or iOS.** Not possible on this machine. WebKit is a
  good proxy for layout and rendering and a poor one for audio policy.
- **A physical gamepad in Firefox or WebKit.** The API's presence was checked;
  no pad was connected to test button mapping against.

## Phase 13 — CI, and covering the engine

Two structural gaps closed, and closing the second one immediately found a bug
that had been live in two games for months.

### CI, so the lesson is a mechanism

`.github/workflows/ci.yml` runs on every push to main and on every pull
request: `npm ci`, `npm test`, `npm run build`, then two post-build checks.
Node 22 and 24, `fail-fast: false` so a version-specific break is visible as
one, read-only token, and superseded runs on a branch are cancelled.

This project's hardest-won lesson is that **a failed build is a silent
deploy** — `engine/canvas.js` once had a parse error, the build failed, and
Cloudflare Pages went on serving the previous version while the repo was
broken. That lesson was written in the README, which is not a mechanism.

Worth being precise about what does and does not block: Pages builds
independently of the Action, so a red check does not by itself stop a deploy.
What stops a *merge* is branch protection with "Require status checks to pass"
and `verify` selected. That is a one-time repository setting, it cannot be made
from a commit, and it is written up in DEPLOY.md.

**Two new checks, because `npm run build` exiting zero is not the same as the
build being right:**

- `tools/verify-build.mjs` asks games.json what should exist and then looks.
  Every live game's page present, each with a module script and a
  `#boot-fallback`; every file from `public/` copied, including `_headers` and
  `404.html`; `reference/` absent. A game added to the manifest whose folder
  was never created is a green build and a broken hub, and nothing else would
  catch it.
- `tools/check-no-external.mjs` fails the build if anything in `dist/` would
  make the browser fetch from another origin, and if the CSP stops containing
  its load-bearing directives. The zero-external-requests claim was verified by
  hand in Phase 12; this is what keeps it true.

The second one was written twice. The first version flagged every absolute URL
and immediately caught the portfolio link in the footer — a false positive, and
a check that cries wolf is a check people learn to skip. It looks only at
references the browser resolves on its own now (`src`, `srcset`, `<link href>`,
`url()`, `@import`, absolute URLs in bundled JS). Outbound `<a href>` links are
reported as information and never fail.

Both were proved to fail before being trusted: deleting a game page and adding
a Google Fonts link each turned CI red.

`package.json` gains `engines: { node: ">=22" }` — the test script passes a
glob to `node --test`, which Node 21 introduced, so Node 20 fails with a
confusing "no test files found" rather than a clear one. Plus `npm run verify`
and `npm run ci`, so a local run is the same commands CI runs.

### Covering engine/ — 67 tests to 124

The asymmetry was backwards: seven games had measured rules modules while the
6,500 lines every one of them imports had a handful of tests. `input.js` (836
lines), `loop.js` (433) and `shell.js` (1,227) had none at all.

| | before | after |
|---|---:|---:|
| engine tests | 67 | **124** |
| whole suite | 208 | **265** |

**`loop.js` — 13 tests.** The fixed timestep (update always gets the same dt,
whatever the frame took), the step count following real time rather than frame
count, alpha staying inside [0, 1). The spiral guard: a 60-second stall runs at
most 8 steps and the backlog is discarded rather than owed. Time never running
backwards when rAF reports a timestamp fractionally before `start()` did. And
containment — a throw in update or render stops the loop exactly once and logs
exactly once.

**`input.js` — 24 tests.** Edge detection, the radial deadzone (a diagonal is
not easier than an axis, which is the whole reason it is radial), device
merging, blur clearing held keys so alt-tabbing does not leave the player
running into a wall. The four party keyboard layouts are checked for key
collisions — four people on one keyboard, and a collision is invisible until
four people are actually sitting there. Plus the graceful-degradation paths
WebKit-on-Windows exercised by accident in Phase 12: no Gamepad API, and a
Gamepad API that throws.

**`shell.js` — 20 tests.** Scores reaching the session and the best read back
being the *better* number rather than the one just submitted; score direction,
so Circuit Racer's "lower is better" survives; `?tournament` parsing in every
form including the explicit offs; the sound preference being read at boot and
written back; menu navigation wrapping in both directions and reopening on the
first item.

### THE BUG THIS FOUND, on the first run

`Input.pressed('up')` had never worked. up/down/left/right were not in
`BUTTON_NAMES` — movement is an analogue vector, so the directions were never
edge-tracked — and asking for a button that does not exist is not an error. It
read an undefined slot and returned false, forever, silently.

**Two shipped games depended on it.** Block Buster's own controls list says
"Hard drop: B or up / Shift or Up", and the Up half had never once worked.
Ballast inherited the same line when its controls were deliberately aligned
with Block Buster's in Phase 11. Nobody noticed because B works, and a dead
alternative looks exactly like a player who did not try it.

Fixed in the engine rather than in the two games, because that is where the
gap was: the four directions are now derived from the merged movement vector
in one helper and edge-tracked alongside the face buttons, crossing at the same
half-deflection threshold `shell.js` and `tournament-ui.js` already use for
menu navigation. A stick, a d-pad, WASD and the touch joystick all produce the
same edges. Verified in a browser against a production build — ArrowUp alone
now lands pieces in both stackers.

This is the argument for covering shared code, stated as plainly as it can be:
one gap in `engine/` was two broken games, for months, in a project where
every game gets played.

### And a smaller one, found by writing the test rather than running it

`setKeyboardLayout(playerIndex, layout)` accepted its two arguments in either
order without complaint. Reversed, a number landed in the layout slot, every
lookup on it came back undefined, and that player's keyboard did nothing for
the whole party — with no error anywhere. It throws now, and says which order
it wanted. The first draft of the test file got the order wrong, which is how
this surfaced.

### Testing modules that need a DOM

`helpers/dom.mjs` gained a manual clock, `clock.tick()` (which advances every
queued callback rather than the oldest — a page can have the game loop and the
shell's overlay loop on rAF at once), `append`/`prepend`, a global
`getComputedStyle`, and an event payload on `dispatch` so a keydown can carry a
`code`.

One trap worth recording: menu input is **not** handled by `shell.update()`.
That returns false the moment a screen is open and does nothing else — overlays
run on the shell's own frame loop, because the game loop is suspended while one
is up. Driving a menu in a test means pumping the clock, not calling update().

## Phase 14 — Rift Runner, and a solver that proves the game is possible

Game one of a batch of five. `games/rift-runner/`, three files: `rift.js`
(physics, realms, solver), `patterns.js` (the obstacle library and the course),
`game.js` (canvas and nothing else).

An endless runner with three verbs — jump, slide, and a dash that phases
through solid rift walls — where the portals change the RULES rather than the
backdrop. Distance is the score.

### The five realms

Each scales the physics differently, so the same obstacle asks a different
question:

| Realm | Jump travel | What it changes |
|---|---:|---|
| Surface | 5.1 tiles | the baseline everything is read against |
| Drift | 8.2 tiles | half gravity — gaps are trivial, low bars are lethal |
| Forge | 3.4 tiles | heavy and short — gaps need the dash |
| Surge | 4.7 tiles | fast, but the dash returns almost instantly |
| Inverse | 5.1 tiles | gravity points up; you run on the ceiling |

### A SOLVER, not a playtest

The fairness claim is not "this felt fine". `isClearable()` is a breadth-first
search over the real physics step — the same one the game runs — and it either
walks a route through a pattern or reports that none exists. `patterns.js`
declares which realms each pattern is legal in and the test refuses any pair
the solver cannot solve.

That found four authoring faults in my own library, with the arithmetic to
prove each:

- `spike-under-bar` was impossible **by 4px**. Clearing a one-tile spike puts
  the feet at 40px and the head at 84; the bar was hung at 80.
- `double-rift` had its walls 7 tiles apart against a dash cycle of 9.6 tiles
  in Drift — the second wall arrived while the dash was still cooling.
- `spike-stutter` and `rift-sandwich` are impossible in Drift, where a floaty
  8.2-tile jump cannot come down inside a two-tile window. Their realm lists
  say so now.

**And three faults in the solver itself**, which is the part worth recording:

- **Global dedup pruned the act of running.** x advances 2.8px a step against
  a 6px quantisation, so two consecutive steps often shared a key and the
  later one was dropped as "already seen" — which drops the branch. 76 of 90
  pairs failed, including a single jumpable spike. Dedup is per time-layer now.
- **Budget exhaustion returned `false`.** The worst possible bug in a fairness
  checker: "I gave up" and "impossible" were the same answer. Running it at a
  finer setting to double-check made the state count explode, so it hit the
  cap on 54 of 87 pairs and announced that one spike could not be jumped. It
  throws `SolverBudget` now, and cannot be mistaken for a verdict.
- **Coarse settings produce false negatives**, which is fine and now relied
  on deliberately. Quantisation can only merge routes away, never invent one,
  so a "clearable" is proof and an "unclearable" is a maybe. `verifyLibrary`
  runs cheap settings (5.3s for the whole library) and re-checks every
  rejection at a fine setting before believing it.

### Speed invariance, designed in rather than patched

Gravity scales with the square of the run speed and the jump impulse linearly
with it, so a jump covers the same number of TILES at 340 px/s and at 3,400.
Slide and dash durations scale as 1/speed. A pattern authored in tiles is
clearable forever; what escalates is how much wall-clock time you have to read
it.

This is the third game to need it. Gravity Flip found it; Ember rediscovered
it the hard way when its reachable band hit zero at 25 km. Here it was written
in from the first line, and there is a test that walks five realms out to
5,000 km to check nobody has undone it.

### What the bots said, and what they got wrong

**Nobody was seeing the portals.** The median run of both skill levels entered
**zero** rifts, in a game whose entire hook is the rifts. Two causes:

- The shift waited for a lull — grounded, nothing within six tiles — and
  patterns are dealt four tiles apart, so it essentially never found one. A
  rift is now DEALT as a wide clear gate, so it always arrives, always on flat
  ground, and can be seen coming.
- The gate was then scheduled off the RUNNER's distance while being placed at
  the DEALER's cursor, up to 107m further on. The first gate was landing at
  ~150m when a competent run ended at 124m. Scheduled by cursor now, so it
  lands at 49m.

**Bars killed 27 runs in 40, and were right to.** A 0.42s slide covers 143px
against a 120px bar — a 23px window to start it in, which is not a skill, it
is a coin toss. The slide is HELD now. The five-tile `long-bar` had been very
nearly impossible outright.

**And one finding that corrected me rather than the game.** I built the
"good" bot with a longer lookahead, assuming reading further ahead is the
skill. A parameter sweep says the opposite, clearly: longer lookahead made it
*worse*, 57m against 98m, because reacting early means committing early, and
committing early to a fixed-distance move is how you land in the gap you were
trying to clear. Both bots read the same distance now. What separates them is
reaction time, whether they compute where a jump arc has to START, and
`misreadChance` — reaching for the wrong verb under pressure, which is the
actual beginner error and worth 2.6x on its own.

**Measured, 60 seeded runs per skill:**

| | competent | good |
|---|---:|---:|
| median distance | 249 m | **658 m** |
| 90th percentile | 660 m | 1,679 m |
| best | 1,288 m | 3,120 m |
| portals entered (median) | 2 | 6 |

### THE FIRST THIRTY SECONDS, BY HAND — and it failed

Per the rule Ember earned. Played against a production build, doing nothing at
all for the opening.

**Dead at 11 metres.** The first obstacle arrived **1.06 seconds** after the
title screen cleared, while a new player is still reading the screen. Every
bot was fine with it because every bot is running on frame one. The run-up is
26 tiles now — 3.4 seconds of clear ground — and the same test survives.

Playing it also found a readability fault no test would have: **the gaps were
nearly invisible.** The sky gradient showed through them, and at the bottom of
the screen it is within a few percent of the ground colour. Each realm has a
near-black void behind the floor now; sampling the ground row of the canvas
shows two clearly distinct colours where before there was one.

Page weight: 24.6 KB gzipped. 28 new assertions; suite 265 → 293.

## Phase 15 — Endless Mini Golf, and a hole that is proved before you see it

Game two of five. `games/mini-golf/`, three files: `green.js` (tiles, putt
physics, the search), `holes.js` (generation, the stroke economy, the round),
`game.js` (canvas and nothing else). Fifteen games live.

### Generate, then prove, then deal

The generator is allowed to be adventurous — water across the direct line, a
wall behind the cup — because it does not have to be careful. Every hole is
carved and then handed to a search over the real putt physics, and only dealt
if the search actually sinks it within par. One it cannot solve is thrown away
and another generated, at about 7ms a go.

That matters more here than in a hand-authored game. A cup with no angle into
it does not read as unlucky, it reads as broken, and the player cannot tell
"I can't see the shot" from "there is no shot".

The search is a **beam search over a sampled fan**, so it is sound but not
complete — it either sinks the ball by really simulating every stroke, or it
fails to find a way in the beam it looked at. That asymmetry is exactly the
right way round: being incomplete costs a few discarded holes at generation
time, being unsound would cost the player a hole they cannot finish.

### The stroke economy

You do not get a fixed number of shots, you get a **bank**. Sink under par and
the difference is added; go over and it is spent. Run it to zero and the round
ends, mid-hole if that is where it happens.

So a bad hole is survivable and a run of them is not, and a good hole buys room
for a bad one later. Holes completed is the score — strokes are the resource,
not the result, which is why the scoreboard counts holes and the HUD counts
strokes.

### One control model, three devices

Aim on the stick, the arrows, or the touch joystick; hold to charge, release to
hit. Identical everywhere, deliberately: three control schemes would mean the
difficulty measured in `tests/` describes only one of them. The power meter
rises AND falls while held, so letting go is a decision at every power rather
than only at full.

### Measured, 24 seeded rounds per skill

| | competent | good |
|---|---:|---:|
| holes completed (median) | 5 | **20** |
| 90th percentile | 8 | 31 |
| best | 14 | 42 |

Every round of both ends by running the bank dry, which is the economy doing
its job rather than a timer.

The two bots differ in one thing: the competent one aims at the cup, and the
good one tries a fan and keeps whichever shot leaves the ball best placed.
Playing the dog-leg rather than the straight line is worth 4x.

### What the hand-play found — twice

Per the convention Ember and Rift Runner earned.

**The round ended on hole one.** Played cold with crude aim, the first hole
came in at seven strokes against a par of two, which spent the entire starting
bank before the player had learned which button charges. Par 2 is an ace or a
loss: two is break-even and three already costs you. **The par floor is three
now** — there is room to be bad at a hole without the round ending on it.
Competent rounds went from 4 holes to 5, and more importantly stopped ending
before they began.

**The board was drawn a quarter of the size it should have been.** Holes grow
from 12x9 to 22x15 tiles, and pinning the tile at 32px meant an early hole sat
in the middle of the canvas with the ball a five-pixel dot in it. It is scaled
to fit now, so hole 1 is enormous, hole 40 still fits, and the ball is the same
size relative to the green either way. Nothing but playing it would have
raised that — it was perfectly legible, just small enough that reading the line
was a squint.

### The contrast check found nothing, which is also a result

Per the other new convention. Every hazard was measured against the fairway it
sits on, in weighted RGB:

| | vs green | vs the alternate square |
|---|---:|---:|
| water | 219 | 221 |
| sand | 280 | 301 |
| ramp | 169 | 198 |
| mover | 327 | 332 |
| cup | 299 | 269 |
| ball | 447 | 473 |

The closest meaningful pair is the ramp at 169, and it carries a drawn arrow as
well as its colour. The two near pairs the check does flag — table against
rough, and the two green squares of the checker — are both deliberate and
neither is a thing the player has to tell apart.

### Also worth recording

The competent bot can get **stuck**: aiming straight at a cup it has no line to,
it will putt into the same wall until the bank is gone. That is the economy
working — going over par spends the bank — but it means bank size does not
change how many holes it finishes, which made "a bigger bank buys more holes"
the wrong way to test that the tuning is live. That test now checks the Course
reads the bank it is given and that tripling the friction shortens a putt.

24.1 KB gzipped. 22 assertions; suite 293 → 315.

## Phase 16 — Winter Base Building, and proving a choice exists

Game three of five. `games/winter/`, two files: `camp.js` (the whole
simulation, DOM-free) and `game.js` (an isometric camp and nothing else).
Sixteen games live.

### The claim, and why it needed four bots rather than two

Every other game in this project asks the harness "how good is the player".
This one asks something more basic:

> **Wood is dual-purpose and genuinely scarce**, so burning it and building
> with it compete, and a player can be caught having chosen wrong.

If that is false the game is a chore list — gather enough and everything is
fine — and no amount of snow on the canvas would rescue it. The way to check it
is not a good bot and a bad one. It is two bots each good at ONE of the two
things, and a demonstration that they fail in OPPOSITE ways.

| strategy | weeks (median) | p90 | how it died |
|---|---:|---:|---|
| fortify — builds whenever it can | 3 | 5 | Froze 42/60, bear 18/60 |
| warm — never builds at all | 2 | 3 | **Wolves 52/60**, bear 8/60 |
| hoarder — leaves the wall to the last night | 4 | 4 | Wolves 53/60, bear 7/60 |
| balanced — fire first, wall with what is left | **5** | 5 | Wolves 44/60, froze 12/60 |

The wall-first camp freezes and the fire-first camp is eaten. That is the whole
design in one table, and "I didn't gather enough" — starvation — is 1 run in
240.

### Three rules the harness forced

- **`maxBuildsPerDay: 1`.** Without it, wall decay makes building LATE strictly
  better: hoard all week, raise the whole wall on day seven, commit to nothing.
  The hoarding bot outlasted the careful one, which is the tension not existing.
  Capped, wood committed on day two cannot be burnt on day five, and that
  commitment is the choice the game is about.
- **`healPerGoodNight: 7`.** Without it every strategy died at roughly the same
  depth, because damage only ever accumulated and nothing done well could undo
  any of it. A warm fed night has to be worth more than merely avoiding harm.
- **`bearDamage: 14`, down from 22.** At 22 a bear ended a quarter of all runs,
  which made hunting the story instead of the wall. The risk of going out
  should cost a day and some blood, not the run.

### The week cannot pay for itself — but not immediately

`weekBudget()` prices a week honestly: eating comes out of the action budget
first, then the wall that week's pack needs including what rots meanwhile, and
only what is left can gather.

| week | 1 | 2 | 3 | 5 | 8 | 12 |
|---|---:|---:|---:|---:|---:|---:|
| slack | +45 | +18 | −17 | −85 | −189 | −263 |

Weeks one and two show a surplus, and that is the deliberate run-up: the
stretch where a player is still learning which action does what and can afford
to spend one badly. From week three it is never solvent again. Median survival
is five weeks, so the squeeze lands in the middle of a run rather than at the
end of one — the player is spending a stockpile built while it was easy, and
the stockpile is finite.

### Why wolves, and why bears as well

A blizzard was the obvious seventh-night threat and it is the wrong one: a fuel
drain collapses straight back into "did you stockpile enough wood". Wolves
attack the STRUCTURE, so wood has to be spent on walls as well as burnt, and
the two uses compete for one pile.

Bears are kept as a separate animal on purpose. Bears are the risk of GOING
OUT; wolves are the risk of the DEADLINE. One animal doing both would be a
single pressure felt twice and the week would have no shape.

### The camp is a place, not a menu

The first version of `game.js` drew four bars and a list of three options, and
the game read as a spreadsheet with snow on it. It is now an isometric camp
where every number the simulation holds has a physical counterpart:

- **wood** is a stack of logs that grows in rows and shrinks
- **meat** is a drying rack that fills and empties
- **wall** is posts that rise one at a time from the front — the side the pack
  comes at — and are knocked out into rubble when it breaks
- **the fire** is big and yellow when it is fed and guttering embers when it is
  not, which is the single most important thing on the screen
- **the pack** is wolves gathering past the treeline over the three nights
  before the deadline, so the readiness readout has something to point at
- **the week** is the forest visibly thinning, which is `gatherYield` falling

And the character walks. "Gather wood" sends them out to a tree and they swing
at it; "hunt" takes them off into the deep woods where a bear may be waiting;
"build" walks them to the gap in the wall and they heave a post upright there.

**The rules resolve the instant you confirm** — `camp.js` never waits on an
animation, which is what keeps the bots playing exactly what a player plays.
What is delayed is the PILES: they do not move until the axe lands. Without
that gap, four numbers jump before the character has taken a step and the point
of walking there is lost.

Depth is `x + y`, so the deep woods are up the screen and the wall is near the
camera, large, and impossible to misread.

### What the hand-play and the contrast check found

Per the two conventions. Thirty seconds cold from a genuine standing start
found nothing that could kill you — a turn-based day has no standing-start
fault to have — but it found three presentation faults that no test could:

- **The four resource bars were strung across the sky** and the tracks vanished
  against it, so the readings ran together into one long meaningless line. They
  are a panel now.
- **The worn paths read as planks laid on the snow.** Too bright, too wide, and
  one ran clean out of the compound.
- **A wall of nothing was invisible.** With `wall: 0` there was no compound to
  see at all. The whole unbuilt perimeter is now a faint outline with the next
  slot picked out, so the wall you have not built is as legible as the wall you
  have.

The contrast check flagged two pairs and both mattered:

| pair | before | after |
|---|---:|---:|
| wolf body vs the dark beyond the treeline | 110 | 253 |
| the coat vs the log stack | 117 | 175 |

The wolves are the deadline made visible, and at 110 they registered as a pair
of yellow eyes and nothing else. Everything else was clear: hung meat 468 from
snow, the person 488, rubble 454, log ends 385.

The strategy bots were re-run against the finished game and the table above is
unchanged to the run. The rework was presentation and the numbers prove it.

25 KB gzipped 9.1. 18 assertions; suite 315 → 333.
