// tests/thumbnails.test.mjs
//
// The arcade cards are inline SVG built by string concatenation, which is
// cheap and has exactly one failure mode: a typo produces markup the browser
// silently swallows, and the card renders as a blank panel. The grid still
// looks like a grid, so nobody notices.
//
// Ids matter more than they look: every card is inlined into the SAME
// document, so two cards defining the same gradient id means one of them
// quietly renders in the other's colours.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { thumbnailFor } from '../thumbnails.js';

const games = JSON.parse(readFileSync(new URL('../games.json', import.meta.url), 'utf8'));
const NAMED_COLOURS = new Set(['none', 'white', 'currentColor', 'transparent']);

const cards = games
  .map((game) => ({ id: game.id, svg: thumbnailFor(game.id) }))
  .filter((card) => card.svg !== null);

test('every game in the manifest has artwork', () => {
  const missing = games.map((g) => g.id).filter((id) => thumbnailFor(id) === null);
  assert.deepEqual(missing, [], `no card art for: ${missing.join(', ')}`);
});

test('an unknown id returns null rather than throwing', () => {
  assert.equal(thumbnailFor('not-a-game'), null);
});

test('every card is a well-formed, closed SVG', () => {
  for (const { id, svg } of cards) {
    assert.ok(svg.startsWith('<svg '), `${id} does not open with <svg`);
    assert.ok(svg.endsWith('</svg>'), `${id} does not close with </svg>`);
    assert.equal((svg.match(/"/g) || []).length % 2, 0, `${id} has an odd number of quotes`);

    const stack = [];
    for (const [, closing, name, , selfClose] of svg.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>/g)) {
      if (selfClose) continue;
      if (closing) {
        assert.equal(stack.pop(), name, `${id}: </${name}> does not match the open tag`);
      } else {
        stack.push(name);
      }
    }
    assert.deepEqual(stack, [], `${id} left ${stack.join(', ')} unclosed`);
  }
});

test('every colour is a real colour', () => {
  for (const { id, svg } of cards) {
    for (const [, value] of svg.matchAll(/(?:fill|stroke|stop-color)="([^"]+)"/g)) {
      const ok = NAMED_COLOURS.has(value)
        || /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(value)
        || /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/.test(value)
        || /^url\(#[a-zA-Z][\w-]*\)$/.test(value);
      assert.ok(ok, `${id}: "${value}" is not a colour`);
    }
  }
});

test('every gradient reference resolves inside its own card', () => {
  for (const { id, svg } of cards) {
    const defined = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const [, ref] of svg.matchAll(/url\(#([^)]+)\)/g)) {
      assert.ok(defined.has(ref), `${id}: url(#${ref}) is not defined in this card`);
    }
  }
});

test('no two cards share an id — they share one document', () => {
  const owner = new Map();
  for (const { id, svg } of cards) {
    for (const [, svgId] of svg.matchAll(/\sid="([^"]+)"/g)) {
      assert.ok(!owner.has(svgId), `id "${svgId}" is used by both ${owner.get(svgId)} and ${id}`);
      owner.set(svgId, id);
    }
  }
});

test('no card makes a network request', () => {
  // The whole reason the art is inline: the site makes zero image requests.
  for (const { id, svg } of cards) {
    assert.ok(!/<image\b/.test(svg), `${id} contains an <image> element`);
    assert.ok(!/https?:\/\//.test(svg), `${id} references an external URL`);
  }
});
