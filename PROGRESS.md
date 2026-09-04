# Studio 22 — Build Progress

## Done
- Phase 0: Node, Git, VS Code, Claude Code installed
- Phase 1: Vite scaffold, GitHub repo, Cloudflare Pages auto-deploy live at studio22-anw.pages.dev
- Phase 2 (partial): engine/input.js, engine/canvas.js, engine/loop.js (all tested on desktop keyboard, Xbox gamepad, and phone touch), engine/session.js

## In progress
- Phase 2: engine/shell.js, engine/audio.js, engine/util.js

## Next
- Phase 3: games.json manifest, landing page, arcade hub
- Phase 4: port Sky Hopper and Comet onto the engine

## Notes and known items
- Controller glyph swapping (Xbox vs PlayStation button labels) deferred to Phase 8 polish
- GameCanvas recomputes on window resize and orientation change only, not container resize. Would need a ResizeObserver if a game is ever embedded in a sized container.
- test-engine.html is a throwaway debug page, delete before launch
- DualSense over Bluetooth on Windows may report non-standard mapping — untested, USB should be fine
