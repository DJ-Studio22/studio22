# Studio 22

A browser-based arcade of original games. Cinematic landing page, an arcade
hub, and eleven games playable on phone, tablet, desktop or a controller on
the TV. Deployed as a static site to Cloudflare Pages.

No accounts. No ads. Nothing collected. Nothing survives the tab.

**Live:** https://studio22-anw.pages.dev

---

## Running it

```bash
npm install
npm run dev       # Vite dev server
npm run build     # writes dist/
npm run preview   # serves the built dist/, which is the real test
npm test          # the rule and tuning tests
```

`npm run preview` matters more than it looks. A cleanup commit once introduced
a parse-time `SyntaxError` in `engine/canvas.js`; the build failed, Cloudflare
kept serving the previous version, and the site looked alive while the repo
was broken. **A failed build is a silent deploy.** Check that the build
passes, not just that the site responds.

---

## Layout

```
index.html          landing page
arcade.html         the hub, built from games.json
party.html          hot-seat tournaments
games.json          the single source of truth for the suite
thumbnails.js       inline SVG card art — the site makes zero image requests
engine/             canvas, input, loop, shell, audio, session, ui, util
games/<id>/         one folder per game, each with its own index.html
styles/             tokens.css plus per-page CSS
tests/              rule and tuning tests — see tests/README.md
tools/              sitemap and metadata generators
```

Adding a game means adding an entry to `games.json` and creating a folder
under `games/`. Nothing else needs editing: the hub, the sitemap and the page
metadata all come from the manifest.

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
about. Five games have done this and it has repeatedly found things that were
invisible on screen — a hook refusing most of the anchors it could reach, four
swings in five committed to hitting a roof, a runner passing through solid
tiles at speed, and an ordinal that rendered "21th".

The convention, and why each part of it exists, is in
[`tests/README.md`](tests/README.md).

---

## Deploying

Cloudflare Pages builds on push to `main`. Moving to a custom domain is one
file (`site.config.json`) and two generators; the registrar and Cloudflare
steps are written up in [`DEPLOY.md`](DEPLOY.md).

`PROGRESS.md` is the build log and the record of decisions already settled.
`BACKLOG.md` is what is left.
