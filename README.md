# Studio 22

A browser-based arcade of original games. Cinematic landing page, an arcade
hub, twenty-six games playable on phone, tablet, desktop or a controller on
the TV, and three of them pass-and-play party games. Deployed as a static site
to Cloudflare Pages.

No accounts. No ads. Nothing collected. Nothing survives the tab.

**Live:** https://studio22.games (the original https://studio22-anw.pages.dev
still answers; the canonical tags point at the domain)

---

## Running it

```bash
npm install
npm run dev       # Vite dev server
npm run build     # writes dist/
npm run preview   # serves the built dist/, which is the real test
npm test          # the rule, tuning and engine tests
npm run verify    # checks the build against games.json, and for external refs
npm run ci        # test + build + verify — exactly what CI runs
```

`npm run preview` matters more than it looks. A cleanup commit once introduced
a parse-time `SyntaxError` in `engine/canvas.js`; the build failed, Cloudflare
kept serving the previous version, and the site looked alive while the repo
was broken. **A failed build is a silent deploy.**

GitHub Actions runs the whole of `npm run ci` on every pull request and every
push to `main`, on Node 22 and 24. So a break is caught loudly, in minutes,
without anyone remembering to look.

The workflow is **branch, commit, push, open a PR, wait for the checks,
`npm run merge`** — a convention rather than an enforced rule, because branch
protection is not available on a private repo on GitHub's free plan. The merge
script waits for the checks and refuses on a red one; `gh pr merge` does not
look, and a red check was once merged that way. Run `npm run ci` before
pushing; it is the identical sequence, so a green local run means a green
remote one. Written up in [`DEPLOY.md`](DEPLOY.md).

---

## Layout

```
index.html          landing page
arcade.html         the hub, built from games.json
party.html          hot-seat tournaments
about.html          the About page
games.json          the single source of truth for the suite
site.config.json    the one place the deployed origin is written down
thumbnails.js       inline SVG card art — the site makes zero image requests
engine/             canvas, input, loop, shell, audio, music, best-marker,
                    session, viewport, tournament, ui, util
games/<id>/         one folder per game: index.html, game.js, and for most a
                    DOM-free rules module the tests drive
public/             copied verbatim: _headers (the CSP), 404, robots, sitemap,
                    manifest, and music/ — every .mp3 there is the playlist
styles/             tokens.css plus per-page CSS
tests/              rule, tuning and engine tests — see tests/README.md
tools/              build checks (verify-build, check-no-external), the merge
                    gate (merge-pr), sitemap and metadata generators
```

Adding a song means dropping a lowercase-hyphenated `.mp3` into
`public/music/`. The playlist is read from the folder at build time.

Adding a game means adding an entry to `games.json` and creating a folder
under `games/`. Nothing else needs editing: the hub, the sitemap, the page
metadata and the Vite entry list all come from the manifest and the folder.

---

## The rules this project is built to

The full set is in `CLAUDE.md`. The ones that shape the code most:

- **Vanilla JavaScript, ES modules only.** No framework, no TypeScript, no CSS
  framework, no game engine, no physics library.
- **No backend and no persistence beyond the tab.** `sessionStorage` only, and
  only through `engine/session.js`.
- **Games import from `engine/`; nothing in `engine/` imports from `games/`.**
  That dependency is one way, always.
- **Every game works with gamepad, keyboard and touch.** The one sanctioned
  exception is Keystroke, which needs a physical keyboard and declares it in
  the manifest so the hub can warn a player before they tap in.
- **Each game owns its palette** in a local `ART` constant. `tokens.css` is for
  site chrome — the landing page, the hub, and the shell's own pause, game
  over and HUD, which stay recognisable on top of every game.

---

## Testing

```bash
npm test
```

A game whose difficulty is a claim gets its simulation extracted into a
DOM-free rules module, so it can be measured headlessly rather than argued
about. Most games have done this and it has repeatedly found things that were
invisible on screen — a hook refusing most of the anchors it could reach, four
swings in five committed to hitting a roof, a runner passing through solid
tiles at speed, a gorge that became arithmetically impossible past 25 km, a
stacking twist that turned out to be pure decoration, and an ordinal that
rendered "21th".

It also has one blind spot, and it is written down: **a bot is already playing
on frame one and a person is not.** Ember shipped with a balloon that reached
the rock in 0.53 seconds from a standing start, and every bot flew it happily.
A human plays the first thirty seconds cold before a game is called done.

The convention, and why each part of it exists, is in
[`tests/README.md`](tests/README.md).

---

## Deploying

Cloudflare Pages builds on push to `main` and serves https://studio22.games.
The origin lives in one file (`site.config.json`) and two generators read it;
the registrar and Cloudflare steps are written up in [`DEPLOY.md`](DEPLOY.md).

`PROGRESS.md` is the build log and the record of decisions already settled.
`BACKLOG.md` is what is left. Every entry in `games.json` is `live`; what
remains is hardware testing and a short list of known rough edges.

---

## Reading this code

The source is public so that people can read it. It is a portfolio piece,
not an open-source project: there is no licence, and none is implied. You
are welcome to look, learn from it and get in touch about it. You may not
copy it, redistribute it, or build on it without permission.

Copyright 2026 Timothy Jackson. All rights reserved.
