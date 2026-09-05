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

## In progress
- Nothing in flight

## Next
- Phase 4: Keystroke, Sinkhole, Circuit Racer


## Performance audit (Phase 8)

Measured, not estimated. Every page gzipped, as built:

| Page | Total (gzipped) |
|---|---:|
| games/keystroke/ | 24.9 KB |
| games/number-crunch/ | 22.7 KB |
| games/circuit-racer/ | 20.9 KB |
| games/comet/ | 20.8 KB |
| games/updraft/ | 20.5 KB |
| games/sinkhole/ | 20.2 KB |
| party.html | 18.8 KB |
| arcade.html | 16.6 KB |
| index.html | 13.1 KB |

The engine chunk (util + shell + ui + canvas + loop + session + audio) is
11.3 KB gzipped and shared by all six games; input.js is 4.2 KB and shared by
eight pages. So a second game costs 4-7 KB, not 20.

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

## Notes and known items
- Session.clear() KEEPS score directions. It used to wipe them, which left a running page with no direction and made Circuit Racer rank lap times upward — the slowest lap winning. Directions are a fact about the game, not data about the visit
- Circuit Racer counts laps by accumulated travelled distance, not by crossing a line or by a position threshold. projectToTrack() returns the nearest point on the WHOLE centre line, so a car cutting a corner can be nearest to track it has not reached, which read as a lap and banked a 3.9s lap on a circuit whose fastest possible lap is 4.5s
- games.json no longer promises split-screen for Circuit Racer. The build is single-player against an AI; the copy was corrected rather than shipping a card that lies
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
- RESOLVED: the 30fps seen on iPhone was iOS Low Power Mode throttling requestAnimationFrame, not an engine problem. Plugged in with LPM off: display 59Hz, fps 60, work 1.3ms. iOS does this silently and it looks identical to dropped frames — test-engine.html reports measured display Hz next to frame work time to tell the two apart, so check that before suspecting the engine
- No DPI cap needed, confirmed on device. GameCanvas leaves devicePixelRatio uncapped; the maxPixelRatio option (2 / 1.5 / 1 for pixel art) stays available if a fill-heavy game ever needs it
- test-engine.html?fullscreen=1 mounts the canvas alone filling the viewport, no page chrome — use it to see what a real game looks like on a phone
- Anything a finger taps must be sized in CSS pixels and converted to game units, never fixed in game units — a 44-unit button is ~18px on a phone. See MIN_TOUCH_PX in shell.js
- input.js only calls preventDefault() on touches it actually claims, and ignores touches starting on buttons/links/inputs. Calling it unconditionally kills the synthetic click and disables every DOM control on touch
- test-engine.html is a throwaway debug page, delete before launch
- DualSense over Bluetooth on Windows may report non-standard mapping — untested, USB should be fine
- engine/ui.js holds the canvas drawing primitives shell.js uses; games can use it for their own title screens
