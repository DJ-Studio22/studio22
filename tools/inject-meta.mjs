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

// The deployed host lives in site.config.json and nowhere else. Two tools
// write absolute URLs, and two copies of a constant is one copy too many —
// the day they disagree, half the canonical tags point at the old domain and
// nothing complains.
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const ORIGIN = CONFIG.origin;
const SITE_NAME = CONFIG.siteName;

// --- The social card ----------------------------------------------------
//
// One image for the whole site. Per-game cards would be better and are not
// built: they would need six more images kept in step with six descriptions.
//
// The dimensions are measured from the FILE rather than written in the
// config. A config that says 1200x630 over a file that is 1200x600 produces
// tags a crawler believes and a card that renders cropped, and nothing would
// ever tell you. Measuring means the tags cannot disagree with the file.
//
// What is checked is the ASPECT RATIO, not the exact size. 1200x630 is the
// recommended size, but a bigger image of the same shape is fine -- the
// networks scale it down and nothing is lost. What actually gets cropped is
// an image of the wrong SHAPE, so that is what earns a warning. Checking for
// 1200x630 exactly would cry wolf over a perfectly good 1731x909.
const CARD_W = 1200;
const CARD_H = 630;
const CARD_RATIO = CARD_W / CARD_H;      // 1.905, the 1.91:1 the networks crop to
const RATIO_TOLERANCE = 0.03;

// Below this the networks either refuse the large card or upscale it into
// mush. Their published floor is 600x315.
const CARD_MIN_W = 600;

/**
 * Width and height out of a PNG header.
 *
 * A PNG opens with an 8-byte signature and then the IHDR chunk: 4 bytes of
 * length, the tag "IHDR", then width and height as big-endian 32-bit ints.
 * That is the whole format needed here, so there is no dependency for it.
 */
function pngSize(file) {
  const buf = fs.readFileSync(file);
  const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(SIGNATURE)) return null;
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * The card, or null if there is not one to point at.
 *
 * Null is a first-class answer. Naming an image that is not there is worse
 * than naming none: a card pointing at a 404 renders as a broken box, which
 * is exactly why og:image was left out until now.
 */
function socialCard() {
  const configured = CONFIG.socialCard;
  if (!configured || !configured.path) return null;

  // Served from the site root, and Vite copies public/ to the root of dist/,
  // so a path of "/social-card.png" is the file "public/social-card.png".
  const relative = configured.path.startsWith('/')
    ? configured.path.slice(1)
    : configured.path;
  const file = path.join(ROOT, 'public', relative);

  if (!fs.existsSync(file)) {
    console.warn([
      '',
      `[inject-meta] No social card at public/${relative}.`,
      '  Skipping og:image and twitter:image, and leaving the Twitter card as',
      '  "summary" -- a large-image card pointing at a missing file renders as',
      '  a broken box, which is the whole reason these tags were left out.',
      `  Put a ${CARD_W}x${CARD_H} PNG there and run this again.`,
      '',
    ].join('\n'));
    return null;
  }

  const size = pngSize(file);
  if (!size) {
    console.warn([
      '',
      `[inject-meta] public/${relative} is not a readable PNG.`,
      '  Skipping the image tags rather than pointing a crawler at something',
      '  it cannot render.',
      '',
    ].join('\n'));
    return null;
  }

  const ratio = size.width / size.height;
  const shape = `${size.width}x${size.height} (${ratio.toFixed(3)}:1)`;

  if (Math.abs(ratio - CARD_RATIO) > RATIO_TOLERANCE) {
    console.warn([
      '',
      `[inject-meta] Social card is ${shape}, but the networks crop to`,
      `  ${CARD_RATIO.toFixed(3)}:1. Expect the ${ratio > CARD_RATIO ? 'left and right' : 'top and bottom'}`,
      `  edges to be cut off. ${CARD_W}x${CARD_H} is the size to aim for.`,
      '',
    ].join('\n'));
  } else if (size.width < CARD_MIN_W) {
    console.warn([
      '',
      `[inject-meta] Social card is only ${shape}. The right shape, but below`,
      `  the ${CARD_MIN_W}px minimum the networks want for a large card.`,
      '',
    ].join('\n'));
  } else if (size.width !== CARD_W || size.height !== CARD_H) {
    // Not a problem, just worth saying out loud so the number in the tags is
    // never a surprise.
    console.log(
      `[inject-meta] Social card is ${shape} rather than the recommended `
      + `${CARD_W}x${CARD_H} -- same shape, so it will not crop.`,
    );
  }

  return {
    url: ORIGIN + configured.path,
    width: size.width,
    height: size.height,
    alt: configured.alt || SITE_NAME,
  };
}

const CARD = socialCard();

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
  ];

  // One card for the whole site, on every page, emitted from one place so a
  // page cannot be added later and quietly ship without it. When there is no
  // card the tags are omitted and the Twitter card stays "summary": claiming
  // a large image without one renders as a broken box.
  if (CARD) {
    lines.push(
      `  <meta property="og:image" content="${CARD.url}" />`,
      `  <meta property="og:image:width" content="${CARD.width}" />`,
      `  <meta property="og:image:height" content="${CARD.height}" />`,
      `  <meta property="og:image:alt" content="${esc(CARD.alt)}" />`,
    );
  }

  lines.push(
    '',
    `  <meta name="twitter:card" content="${CARD ? 'summary_large_image' : 'summary'}" />`,
    `  <meta name="twitter:title" content="${esc(title)}" />`,
    `  <meta name="twitter:description" content="${esc(description)}" />`,
  );

  if (CARD) {
    lines.push(
      `  <meta name="twitter:image" content="${CARD.url}" />`,
      `  <meta name="twitter:image:alt" content="${esc(CARD.alt)}" />`,
    );
  }

  lines.push(
    '',
    `  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />`,
    `  <link rel="manifest" href="/site.webmanifest" />`,
  );
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

// --- About ---------------------------------------------------------------
done.push(apply('about.html', metaBlock({
  url: '/about.html',
  title: 'About — Studio 22',
  description: 'A passion project: a small arcade of original browser games, in one place, made by one studio. No accounts, no ads, nothing collected.',
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: 'About Studio 22',
    url: `${ORIGIN}/about.html`,
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
