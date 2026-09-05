# Studio 22 — Project Rules

## What this is
A browser-based arcade game suite. Cinematic landing page, arcade hub, and a
growing set of original games playable on phone, tablet, desktop, and gamepad.
Deployed as a static site to Cloudflare Pages.

## Hard constraints — do not violate these
- Vanilla JavaScript with ES modules only. NO React, NO TypeScript, NO CSS
  frameworks, NO game engines, NO physics libraries.
- NO backend, NO server, NO API calls. This is a fully static site.
- NO localStorage, NO cookies, NO IndexedDB, NO persistence that outlives the
  tab. sessionStorage IS permitted, and only through engine/session.js.
  The promise is "nothing survives the tab": sessionStorage is scoped to a
  single tab and destroyed with it, so it honours that exactly, while
  localStorage and cookies would leave data on disk and do not.
  Games never touch storage directly — they call engine/session.js, which is
  the one place any of this lives. It needs storage rather than plain memory
  because every game is its own page, and a full navigation to the arcade
  tears down memory that a score was just written into.
- NO data collection of any kind. No names stored, no analytics, no tracking.
- NO online multiplayer. Local hot-seat and pass-and-play only.

## Architecture rules
- Games import FROM engine/. Nothing in engine/ ever imports FROM games/.
  This dependency is one-way, always.
- Never reimplement input, canvas scaling, the game loop, audio, or session
  scoring inside a game. Always use the engine module.
- Every game lives in its own folder under games/ with its own index.html
  entry point.
- games.json is the single source of truth for the hub. Adding a game means
  editing that file and creating a folder — nothing else.
- All colors, spacing, and fonts come from CSS custom properties in
  styles/tokens.css. No hardcoded hex values in component CSS.

## Code style
- Clear, readable, heavily commented. I am maintaining this long term.
- Prefer simple and obvious over clever and compact.
- Small focused files over large ones.

## Universal input requirement
Every game must work with: Xbox/PlayStation gamepad, keyboard, and touch.
This is non-negotiable and is why engine/input.js exists.

### The one sanctioned exception
Keystroke requires a physical keyboard. Typing speed cannot be taught on a
gamepad, and falling back to the on-screen keyboard on a phone is a different
activity rather than the same game. It declares this in games.json with
`"inputRequirement": "keyboard"`.

Every entry in games.json carries `inputRequirement`, and it is required
rather than defaulted, so claiming an exception is always a deliberate act.
Any future exception needs the same explicit declaration. A game that quietly
does not work on some device is not an exception — it is a bug. The manifest
field is what makes the limitation visible to the hub, and therefore to the
player, before they tap into something they cannot play.

## Performance targets
60fps on a mid-range phone. Object-pool anything spawned in a loop.
Never animate CSS layout properties — transform and opacity only.

## Working style
- Do the simplest thing that satisfies the request.
- Do not add features I did not ask for.
- When I paste an error, fix that error. Do not refactor unrelated code.
- Tell me when something I asked for is a bad idea.
