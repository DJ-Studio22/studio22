// tools/inject-meta.mjs
//
// Adds (or refreshes) the canonical link, Open Graph / Twitter tags, icons
// and JSON-LD on every page, driven by games.json so a game's social card
// says the same thing as its arcade card.
//
// Idempotent: it replaces the block between the two marker comments, so
// running it again after editing a description updates rather than duplicates.
//
// Run: node tools/inject-meta.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The one place the deployed host is written down, matching
// tools/build-sitemap.mjs. Moving to a custom domain is these two constants.
const ORIGIN = 'https://studio22-anw.pages.dev';
const SITE_NAME = 'Studio 22';

const START = '  <!-- BEGIN generated metadata — tools/inject-meta.mjs -->';
const END = '  <!-- END generated metadata -->';

const games = JSON.parse(fs.readFileSync(path.join(ROOT, 'games.json'), 'utf8'));
const list = Array.isArray(games) ? games : games.games;
const live = list.filter((g) => g.status === 'live');

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function ldJson(object) {
  // Two-space indented so it sits neatly inside <head>.
  return `  <script type="application/ld+json">\n${
    JSON.stringify(object, null, 2).split('\n').map((l) => '  ' + l).join('\n')
  }\n  </script>`;
}

function metaBlock({ file, url, title, description, jsonLd }) {
  const lines = [
    START,
    `  <link rel="canonical" href="${ORIGIN}${url}" />`,
    '',
    `  <meta property="og:type" content="website" />`,
    `  <meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `  <meta property="og:title" content="${esc(title)}" />`,
    `  <meta property="og:description" content="${esc(description)}" />`,
    `  <meta property="og:url" content="${ORIGIN}${url}" />`,
    '',
    // summary rather than summary_large_image: there is no og:image yet, and
    // claiming a large image card without one renders as a broken box.
    `  <meta name="twitter:card" content="summary" />`,
    `  <meta name="twitter:title" content="${esc(title)}" />`,
    `  <meta name="twitter:description" content="${esc(description)}" />`,
    '',
    `  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />`,
    `  <link rel="manifest" href="/site.webmanifest" />`,
  ];
  if (jsonLd) lines.push('', ldJson(jsonLd));
  lines.push(END);
  return lines.join('\n');
}

function apply(file, block) {
  const full = path.join(ROOT, file);
  let html = fs.readFileSync(full, 'utf8');

  if (html.includes(START)) {
    const before = html.slice(0, html.indexOf(START));
    const after = html.slice(html.indexOf(END) + END.length);
    html = before + block + after;
  } else {
    // Straight after the description, which every page already has.
    const anchor = html.match(/^.*name="description".*$/m);
    if (!anchor) throw new Error(`no description meta to anchor to in ${file}`);
    html = html.replace(anchor[0], `${anchor[0]}\n\n${block}`);
  }

  fs.writeFileSync(full, html);
  return file;
}

const done = [];

// --- Landing -------------------------------------------------------------
done.push(apply('index.html', metaBlock({
  url: '/',
  title: 'Studio 22 — Original games that run anywhere',
  description: 'A small arcade of original browser games. Phone, tablet, desktop or a controller on the TV. No accounts, no ads, nothing collected.',
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: `${ORIGIN}/`,
    description: 'A small arcade of original browser games. Nothing to install, nothing collected.',
  },
})));

// --- Arcade --------------------------------------------------------------
done.push(apply('arcade.html', metaBlock({
  url: '/arcade.html',
  title: 'Arcade — Studio 22',
  description: 'Every Studio 22 game in one place. Pick one with a controller, a keyboard or a thumb.',
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Studio 22 Arcade',
    url: `${ORIGIN}/arcade.html`,
    // The grid is rendered client-side from games.json, so a crawler would
    // otherwise see an empty page. This is the list, stated plainly.
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: live.length,
      itemListElement: live.map((game, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${ORIGIN}${game.path}`,
        name: game.title,
      })),
    },
  },
})));

// --- Party ---------------------------------------------------------------
done.push(apply('party.html', metaBlock({
  url: '/party.html',
  title: 'Party — Studio 22',
  description: 'Hot-seat tournaments for two to eight players. One screen, one controller, nothing saved.',
})));

// --- Games ---------------------------------------------------------------
for (const game of live) {
  const file = game.path.replace(/^\//, '');
  done.push(apply(file, metaBlock({
    url: game.path,
    title: `${game.title} — Studio 22`,
    description: game.description,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'VideoGame',
      name: game.title,
      url: `${ORIGIN}${game.path}`,
      description: game.description,
      genre: game.category,
      gamePlatform: 'Web browser',
      playMode: game.tournamentReady ? ['SinglePlayer', 'CoOp'] : 'SinglePlayer',
      applicationCategory: 'Game',
      operatingSystem: 'Any',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      isAccessibleForFree: true,
    },
  })));
}

console.log(`metadata written to ${done.length} pages:`);
for (const f of done) console.log('  ' + f);
