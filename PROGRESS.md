# Studio 22 — Build Progress

## Done
- Phase 0: Node, Git, VS Code, Claude Code installed
- Phase 1: Vite scaffold, GitHub repo, Cloudflare Pages auto-deploy live at studio22-anw.pages.dev
- Phase 2: all eight engine modules — input.js, canvas.js, loop.js, session.js, ui.js, shell.js, audio.js, util.js. Input/canvas/loop tested on desktop keyboard, Xbox gamepad, and phone touch.

## In progress
- Nothing in flight — Phase 3 is next

## Next
- Phase 3: games.json manifest, landing page, arcade hub
- Phase 4: port Sky Hopper and Comet onto the engine

## Notes and known items
- Controller glyph swapping (Xbox vs PlayStation button labels) deferred to Phase 8 polish
- GameCanvas recomputes on window resize and orientation change only, not container resize. Would need a ResizeObserver if a game is ever embedded in a sized container.
- test-engine.html is a throwaway debug page, delete before launch
- DualSense over Bluetooth on Windows may report non-standard mapping — untested, USB should be fine
- Shell's touch pause button and canvas menu taps verified via pointer events on desktop only — untested on a real touchscreen
- Audio unlock verified in desktop Chrome (context was genuinely blocked first); not yet confirmed on iOS
- engine/ui.js holds the canvas drawing primitives shell.js uses; games can use it for their own title screens
