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

---

## Still outstanding

**Social card images.** `og:image` and `twitter:image` are absent, and the
Twitter card is `summary` rather than `summary_large_image`, because there
are no image assets and a card pointing at a missing image renders as a
broken box. Needs one 1200×630 PNG — one for the site would do, one per game
would be better. Add them to `public/`, then add the two tags to
`metaBlock()` in `tools/inject-meta.mjs` and switch the card type.

**`test-engine.html` and `identity.html`** are development pages. They are
not in the Vite build inputs, so they are not deployed — they live in the
repo only. Nothing to do before launch; noted so nobody goes looking.
