// tests/engine.imports.test.mjs
//
// The cheapest test in the repo, and the one that would have caught the worst
// bug the project has shipped.
//
// A commit added `this.#label` to engine/canvas.js and never declared the
// field. An undeclared private name is not a runtime error — it is a PARSE
// error, so the module never loaded at all. Every game imports canvas.js, so
// all six games at the time went to a black screen simultaneously, and the
// production build failed outright, which meant Cloudflare quietly kept
// serving the previous deploy while the repo was broken.
//
// Importing the module is enough to catch that. There is no assertion here
// beyond "it loaded", because for a parse error there does not need to be.
// engine/ is the one directory where a single fault takes down all eleven
// games at once, so this runs over every file in it rather than a list
// somebody has to remember to update.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';

import { installDom } from './helpers/dom.mjs';

const ENGINE = new URL('../engine/', import.meta.url);
const modules = readdirSync(ENGINE).filter((f) => f.endsWith('.js')).sort();

test('engine/ is not empty, or this file is testing nothing', () => {
  assert.ok(modules.length >= 8, `only found ${modules.length} engine modules`);
});

test('every engine module parses and loads', async (t) => {
  // input.js wires DOM listeners in a static block at import time, and
  // canvas.js reads document.title, so the stub goes in first. The imports
  // are dynamic for the same reason: a static one is hoisted above this.
  const uninstall = installDom();
  try {
    for (const file of modules) {
      await t.test(file, async () => {
        const mod = await import(new URL(file, ENGINE));
        assert.ok(mod && typeof mod === 'object', `${file} produced no module object`);
        assert.ok(
          Object.keys(mod).length > 0,
          `${file} exports nothing — every engine module is imported for something`,
        );
      });
    }
  } finally {
    uninstall();
  }
});

test('a class field referenced but never declared is a parse error, not a runtime one', () => {
  // The premise the test above rests on, stated as a fact rather than
  // assumed: this is why merely importing catches the bug, and why it could
  // never have been caught by a test that only called a method.
  assert.throws(
    () => new Function('class A { m() { return this.#nope; } }'),
    (err) => err instanceof SyntaxError,
    'an undeclared private name should fail at parse time',
  );
});
