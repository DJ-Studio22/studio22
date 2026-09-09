// tests/engine.music.test.mjs
//
// The arithmetic in engine/music.js, which is the part of it a browser cannot
// tell you is wrong.
//
// Most of that module is Web Audio plumbing and is verified by watching what a
// real browser actually requests. What is NOT visible that way is where the
// needle lands on a resume: an offset past the end of a track makes a
// BufferSource play silence for ever, which looks exactly like the music having
// stopped on its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { needleAt } from '../engine/music.js';

test('a fresh track starts at its first audible sample, not at zero', () => {
  // An MP3 decodes with encoder padding on the front. Starting at 0 plays that
  // padding, which is the click a loop point is famous for.
  assert.equal(needleAt(null, 0.05, 200), 0.05);
});

test('a resume lands where the needle was', () => {
  // A tolerance, not an equality: the wrap is a modulo over floats and comes
  // back as 64 minus a hundredth of a nanosecond. Asserting exactness would pin
  // the arithmetic's rounding rather than the behaviour, and no listener has
  // ever noticed 1.4e-14 of a second.
  assert.ok(Math.abs(needleAt(64, 0.05, 200) - 64) < 1e-6);
});

test('AND AN OFFSET PAST THE END WRAPS rather than playing silence for ever', () => {
  // Reachable with a long pause and a short track. Wrapping puts it back into
  // the music; not wrapping starts a source past its own end, which produces
  // nothing at all and is indistinguishable from a bug elsewhere.
  const start = 1;
  const end = 11;              // ten seconds of audible track
  assert.ok(Math.abs(needleAt(13, start, end) - 3) < 1e-6, 'two seconds past the end is two seconds in');
  assert.ok(Math.abs(needleAt(21, start, end) - 1) < 1e-6, 'a whole extra lap lands back at the start');
});

test('and an offset BEFORE the audible part wraps forward, not to a negative', () => {
  // A negative seek is not something a BufferSource will do anything sensible
  // with, and the modulo in JavaScript is signed, so this is the case that
  // catches a naive implementation.
  assert.ok(Math.abs(needleAt(-1, 1, 11) - 9) < 1e-6);
});

test('a nonsense offset is treated as the beginning', () => {
  // The offset is computed from an audio clock. If that clock is missing the
  // answer is NaN, and NaN reaching source.start() throws.
  assert.equal(needleAt(NaN, 0.5, 10), 0.5);
  assert.equal(needleAt(Infinity, 0.5, 10), 0.5);
});

test('a degenerate track does not divide by zero', () => {
  // A buffer whose audible region is nothing -- silence all the way through --
  // must still produce a finite number.
  assert.ok(Number.isFinite(needleAt(5, 3, 3)));
});

// --- The playlist is the folder -------------------------------------------

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTracks } from '../tools/music-tracks.mjs';

const MUSIC_DIR = fileURLToPath(new URL('../public/music/', import.meta.url));

test('EVERY SONG IN public/music IS IN THE PLAYLIST, and the build reads the folder', () => {
  // The sixth and seventh songs shipped and never played, because the playlist
  // was a list of five names in engine/music.js. It is now read from the folder
  // at build time through this function, so the claim to check is that the
  // function sees everything that is there.
  const ids = listTracks(MUSIC_DIR);
  assert.ok(ids.length >= 7, `only ${ids.length} tracks found; there should be at least seven`);
  for (const id of ids) {
    assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${id} is not a URL-safe track id`);
  }
  // Sorted, so the order the shuffle starts from is the same on every machine.
  assert.deepEqual(ids, [...ids].sort());
});

test('a track name with a space or a capital is a build error, not a silent miss', () => {
  // " Today.mp3" and "Half The Sky.mp3" are the two that arrived. A leading
  // space does not survive a URL at all, and a capital is a different file on a
  // case-sensitive host. The build refuses so the fix is a rename.
  const dir = mkdtempSync(join(tmpdir(), 'music-'));
  try {
    writeFileSync(join(dir, 'fine-name.mp3'), '');
    assert.deepEqual(listTracks(dir), ['fine-name']);
    writeFileSync(join(dir, 'Half The Sky.mp3'), '');
    assert.throws(() => listTracks(dir), /URL-safe/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
