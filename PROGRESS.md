# Studio 22 — Build Progress

## Done
- Phase 0: Node, Git, VS Code, Claude Code installed
- Phase 1: Vite scaffold, GitHub repo, Cloudflare Pages auto-deploy live at studio22-anw.pages.dev
- Phase 2: all eight engine modules — input.js, canvas.js, loop.js, session.js, ui.js, shell.js, audio.js, util.js. Verified on desktop keyboard, Xbox gamepad, and iPhone touch across input, canvas, loop, and shell. 60fps confirmed on device.

## In progress
- Nothing in flight — Phase 3 is next

## Next
- Phase 3: games.json manifest, landing page, arcade hub
- Phase 4: port Sky Hopper and Comet onto the engine

## Notes and known items
- Controller glyph swapping (Xbox vs PlayStation button labels) deferred to Phase 8 polish
- GameCanvas re-fits on window resize, orientation change, container resize (ResizeObserver) and visualViewport resize — the last two matter on mobile, where a collapsing URL bar changes the container without firing a window resize
- RESOLVED: the 30fps seen on iPhone was iOS Low Power Mode throttling requestAnimationFrame, not an engine problem. Plugged in with LPM off: display 59Hz, fps 60, work 1.3ms. iOS does this silently and it looks identical to dropped frames — test-engine.html reports measured display Hz next to frame work time to tell the two apart, so check that before suspecting the engine
- No DPI cap needed, confirmed on device. GameCanvas leaves devicePixelRatio uncapped; the maxPixelRatio option (2 / 1.5 / 1 for pixel art) stays available if a fill-heavy game ever needs it
- test-engine.html?fullscreen=1 mounts the canvas alone filling the viewport, no page chrome — use it to see what a real game looks like on a phone
- Anything a finger taps must be sized in CSS pixels and converted to game units, never fixed in game units — a 44-unit button is ~18px on a phone. See MIN_TOUCH_PX in shell.js
- input.js only calls preventDefault() on touches it actually claims, and ignores touches starting on buttons/links/inputs. Calling it unconditionally kills the synthetic click and disables every DOM control on touch
- test-engine.html is a throwaway debug page, delete before launch
- DualSense over Bluetooth on Windows may report non-standard mapping — untested, USB should be fine
- Audio unlock verified in desktop Chrome (context was genuinely blocked first); not yet confirmed on iOS
- engine/ui.js holds the canvas drawing primitives shell.js uses; games can use it for their own title screens
