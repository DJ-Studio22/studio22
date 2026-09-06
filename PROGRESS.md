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
- Phase 10: the editorial layer on the landing page — display type, a section
  index 00-07, mono telemetry, depth planes and one pinned section. Plus the
  sound toggle, which is now a visit preference in engine/session.js rather
  than a per-page default. See the Phase 10 section below
- Phase 9: TWO PRODUCTION BUGS FIXED (see the section below), then five new games — Block Buster, Neon Drift Delivery, Skyhook, Tower Stack, Gravity Flip. Eleven games live

## In progress
- Nothing in flight

## Next
- Ballast and Ember are still the only two `coming-soon` entries. See BACKLOG item 11.


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

Re-measured at eleven games (HTML plus every asset the page loads up front,
gzipped at level 9):

| Page | Total (gzipped) |
|---|---:|
| games/circuit-racer/ | 27.8 KB |
| games/keystroke/ | 25.8 KB |
| games/neon-drift/ | 25.3 KB |
| arcade.html | 24.6 KB |
| games/block-buster/ | 24.4 KB |
| index.html | 23.7 KB |
| games/number-crunch/ | 23.5 KB |
| games/gravity-flip/ | 23.5 KB |
| games/skyhook/ | 22.9 KB |
| games/tower-stack/ | 21.8 KB |
| games/comet/ | 21.6 KB |
| games/updraft/ | 21.3 KB |
| games/sinkhole/ | 21.2 KB |
| party.html | 20.7 KB |

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
