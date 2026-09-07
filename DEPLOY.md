# Studio 22 — deployment and the custom domain

The site is a static build. `npm run build` writes `dist/`, Cloudflare Pages
serves it. There is no server, no database and no environment to configure.

---

## Moving to a custom domain

Two halves: the bit only you can do (registrar and Cloudflare), and the bit
in the repo (one file, two commands).

### 1. Point the domain at Cloudflare Pages

I cannot do any of this — it needs your registrar login and your Cloudflare
account.

**If the domain is already in your Cloudflare account:**

1. Cloudflare dashboard → **Workers & Pages** → your `studio22` project.
2. **Custom domains** → **Set up a custom domain**.
3. Enter the domain (`studio22.com`) and confirm. Cloudflare adds the DNS
   record itself.
4. Repeat for `www.studio22.com` if you want it to work too.

**If the domain is registered elsewhere:**

1. Cloudflare dashboard → **Add a site**, enter the domain, pick the Free plan.
2. Cloudflare shows you two nameservers. At your registrar, replace the
   existing nameservers with those two.
3. Wait for Cloudflare to report the site as **Active**. Usually minutes,
   occasionally up to 24 hours.
4. Then follow the steps above to attach the domain to the Pages project.

**Then check:**

- `https://yourdomain.com` serves the site.
- The certificate is valid — Cloudflare issues it automatically, but it can
  take a few minutes after the domain first resolves.
- `https://studio22-anw.pages.dev` still works. Cloudflare keeps it. If you
  would rather it redirect to the custom domain, add a redirect rule in
  **Rules → Redirect Rules**; leaving both live is fine but means the same
  content sits at two addresses, which is what the canonical tags below are
  for.

### 2. Change the host in the repo

Everything absolute in this repo — canonical links, `og:url`, the sitemap,
the `Sitemap:` line in robots.txt — comes from **one file**:

```
site.config.json
```

Edit `origin`:

```json
{
  "origin": "https://studio22.com",
  "siteName": "Studio 22"
}
```

Then regenerate:

```bash
node tools/build-sitemap.mjs    # rewrites public/sitemap.xml and public/robots.txt
node tools/inject-meta.mjs      # rewrites the metadata block in every page
npm run build
```

Commit and push; Pages deploys on push.

**Verify nothing was missed** — this should print nothing:

```bash
grep -rl "pages.dev" --include="*.html" --include="*.xml" --include="*.txt" . \
  | grep -v node_modules | grep -v "^./dist"
```

That was tested by actually doing it: changing `origin` to a placeholder and
re-running the two tools left zero references to the old host anywhere
outside the markdown notes.

### 3. Tell Google, if you care about search

- Google Search Console → add the new domain as a property.
- Submit `https://yourdomain.com/sitemap.xml`.
- If the `pages.dev` address was ever indexed, the canonical tags now point
  at the custom domain, which is the signal to consolidate them.

---

## What is deliberately not automated

`build-sitemap.mjs` and `inject-meta.mjs` are **not** wired into `npm run
build`. They change only when a game ships or the domain moves, and both
rewrite files that are committed — running them silently on every build
would mean a `git status` that is never clean and diffs nobody reads.

Run them when:

- a game's `status` changes to `live` in `games.json` (both)
- a game's `description` or `title` changes (inject-meta)
- the domain changes (both)
- the social card image is replaced (inject-meta, so the dimensions in
  the tags are re-measured from the new file)

---

## The social card

One image, used by every page:

```
public/social-card.png
```

`tools/inject-meta.mjs` writes `og:image`, `og:image:width`,
`og:image:height`, `og:image:alt`, `twitter:image` and `twitter:image:alt`
onto all nine pages and sets the Twitter card to `summary_large_image`. The
URL is built from `origin` in `site.config.json`, like every other absolute
URL, so moving the domain carries the card with it.

Replacing it: overwrite that file, then run `node tools/inject-meta.mjs`.
The filename and the alt text live in `site.config.json` under `socialCard`.

**The dimensions in the tags are measured from the PNG itself**, never
written in the config, so they cannot drift out of step with the file.

The check is on the ASPECT RATIO, not the exact size. 1200x630 is the
recommended size, but any image of that same 1.91:1 shape is fine and the
networks scale it down themselves. The file currently there is 1731x909,
which is that shape to within a rounding error. An image of the wrong shape
gets a warning, because the wrong shape is what actually renders cropped.

If the file ever goes missing the tool says so and emits no image tags at
all: a card pointing at a missing image renders as a broken box, which is
worse than having no card.

**One image serves every page.** Per-game cards would be better and are
deliberately not built - six more images to keep in step with six
descriptions, for a link preview most visitors never see.

---

## Continuous integration, and the branch workflow

`.github/workflows/ci.yml` runs `npm ci`, `npm test`, `npm run build` and the
two post-build checks on every pull request and every push to `main`, on Node
22 and 24. Locally, `npm run ci` is the same sequence.

### `main` is NOT protected, and cannot be

Worth stating plainly, because the rest of this section reads like it is.

GitHub does not offer branch protection or rulesets on a **private repository
on the free plan**. Configuring one in the UI does not take effect. Checked
against the API rather than assumed:

```
GET /repos/:owner/:repo/branches/main              -> "protected": false
GET /repos/:owner/:repo/branches/main/protection   -> 403 "Upgrade to GitHub Pro
GET /repos/:owner/:repo/rulesets                   -> 403  or make this repository
                                                            public to enable this
                                                            feature."
```

(`git push --dry-run` is not a test of this. It reports success because it
never reaches the server's ruleset check.)

Three ways that changes: make the repository public, which enables rulesets
for free; pay for GitHub Pro; or leave it. **It is currently left.**

So the pull-request flow below is a *discipline*, not a gate. What it buys is
still real — every change gets a CI run, a diff worth reading, and a revert
that undoes one thing — but nothing on the server will stop a direct push to
`main`, and `gh pr merge` will merge a PR whose checks are red.

Cloudflare Pages also builds independently of GitHub Actions, so a red check
has never been able to stop a *deploy*. It tells you promptly that `main` is
broken. It does not prevent it. Both halves of that are worth holding in mind
when the temptation is to skip the branch "just this once".

### The workflow, every time

```bash
git checkout -b thing-im-doing     # never commit on main
# ... work ...
npm run ci                         # test + build + verify, the same as CI
git add -A && git commit
git push -u origin thing-im-doing
gh pr create --fill                # or open it in the browser
gh pr checks --watch               # wait for both checks to go green
gh pr merge --squash --delete-branch
git checkout main && git pull
```

Run `npm run ci` **before** pushing. It is the identical sequence, so a green
local run means a green remote one, and finding out locally costs seconds
rather than a round trip.

### Branch names

Short, lowercase, hyphenated, and named for the work rather than the process:
`ember-difficulty`, `fix-touch-deadzone`, `engine-coverage`. A prefix is
welcome when it clarifies (`fix/`, `docs/`, `game/`) and never required.

One branch per piece of work. A branch carrying two unrelated changes cannot
be reverted without taking both, which is the entire reason the history is
worth keeping tidy.

### When the checks fail

Fix it on the branch and push again — the PR re-runs automatically. Do not
merge around a red check; the ruleset will not let you anyway, and the one
time it would have been justified is the time it would have been wrong.

If a check fails on CI but passes locally, the difference is almost always one
of two things: `npm ci` installs exactly what `package-lock.json` pins and
fails on drift where `npm install` would quietly resolve it, or the failure is
specific to Node 22 while local is 24. Both are real failures worth having.

### If you do not have `gh`

The PR can be opened and merged in the browser; the CLI just saves the trip.
GitHub prints a "Compare & pull request" link the first time a branch is
pushed. Installing it is `winget install GitHub.cli`, then `gh auth login`.

### Why the build is checked twice

`npm run build` exiting zero means Vite did not crash. It does not mean the
build is right. Two things run after it:

- `tools/verify-build.mjs` asks `games.json` what should exist and then looks
  for it — every live game's page, each with a module script and a boot
  fallback, plus everything `public/` is supposed to contribute. A game added
  to the manifest whose folder was never created produces a perfectly green
  build and a hub full of dead links.
- `tools/check-no-external.mjs` fails if anything in `dist/` would make the
  browser fetch from another origin, or if the CSP has lost one of its
  load-bearing directives. The landing page promises the site contacts nobody;
  this is what keeps that from quietly stopping being true.

Both fail the build, and both were checked by breaking them on purpose before
being trusted.
