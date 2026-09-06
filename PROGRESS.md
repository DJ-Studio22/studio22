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


## Performance audit (Phase 8)

Measured, not estimated. Every page gzipped, as built:

Re-measured at eleven games (HTML plus every asset the page loads up front,
gzipped at level 9):

| Page | Total (gzipped) |
|---|---:|
| games/circuit-racer/ | 27.8 KB |
| games/keystroke/ | 25.8 KB |
| games/neon-drift/ | 25.3 KB |
| games/block-buster/ | 24.4 KB |
| games/number-crunch/ | 23.5 KB |
| games/gravity-flip/ | 23.5 KB |
| arcade.html | 23.5 KB |
| games/skyhook/ | 22.9 KB |
| games/tower-stack/ | 21.8 KB |
| games/comet/ | 21.6 KB |
| games/updraft/ | 21.3 KB |
| games/sinkhole/ | 21.2 KB |
| party.html | 20.5 KB |
| index.html | 19.6 KB |

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
- Block Buster's board rules are in board.js, free of the DOM, for the same reason Number Crunch's arithmetic is in problems.js: a cascade that fails to chain is not visible in a screenshot. Test that file, not the game
