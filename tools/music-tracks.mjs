// tools/music-tracks.mjs
//
// The playlist is whatever is in public/music/. Nothing else lists it.
//
// The first version of engine/music.js carried the five track names in an
// array, and the sixth and seventh songs arrived and played nothing: dropped
// into the folder, shipped by the build, never fetched, because the list was
// a list. So the list is now READ from the folder at build time and handed to
// the module as a compile-time constant (see vite.config.js, `define`), and a
// new song is a new file and nothing else.
//
// This module is plain Node so that vite.config.js and the tests can both use
// it, and so the same function that builds the playlist is the one a test
// asks about.

import { readdirSync } from 'node:fs';

/**
 * Track ids for every .mp3 in `dir`, sorted: the filename without its
 * extension, which is what engine/music.js appends to /music/.
 *
 * REFUSES A NAME THAT IS NOT URL-SAFE. The originals had spaces and an
 * apostrophe, and two uploads later arrived as " Today.mp3" -- with a leading
 * space -- and "Half The Sky.mp3". A space survives a fetch only by encoding,
 * a leading space not at all, and a name that differs from another only by
 * case is two files on one machine and one on another. So a bad name is a
 * build error here, where the fix is a rename, rather than silence in the game.
 */
export function listTracks(dir) {
  const ids = [];
  for (const name of readdirSync(dir)) {
    if (!/\.mp3$/i.test(name)) continue;
    const id = name.replace(/\.mp3$/i, '');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
      throw new Error(
        `public/music/${name} is not a URL-safe track name. Use lowercase words joined by `
        + `hyphens, like "half-the-sky.mp3", so the file fetches on every browser.`,
      );
    }
    ids.push(id);
  }
  ids.sort();
  return ids;
}
