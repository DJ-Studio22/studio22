# Studio 22 — Project Rules

## What this is
A browser-based arcade game suite. Cinematic landing page, arcade hub, and a
growing set of original games playable on phone, tablet, desktop, and gamepad.
Deployed as a static site to Cloudflare Pages.

## Hard constraints — do not violate these
- Vanilla JavaScript with ES modules only. NO React, NO TypeScript, NO CSS
  frameworks, NO game engines, NO physics libraries.
- NO backend, NO server, NO API calls. This is a fully static site.
- NO localStorage, NO sessionStorage, NO cookies, NO persistence of any kind.
  Scores live in memory for the current visit only, via engine/session.js.
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

## Performance targets
60fps on a mid-range phone. Object-pool anything spawned in a loop.
Never animate CSS layout properties — transform and opacity only.

## Working style
- Do the simplest thing that satisfies the request.
- Do not add features I did not ask for.
- When I paste an error, fix that error. Do not refactor unrelated code.
- Tell me when something I asked for is a bad idea.
