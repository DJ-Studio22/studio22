// games/keystroke/words.js
//
// The text Keystroke asks you to type, and the rules for picking it.
//
// Separate from game.js and free of the DOM, for the same reason Number
// Crunch splits its arithmetic out: a home-row drill that quietly includes a
// letter off the home row teaches the wrong finger movement, and that is not
// something you would ever notice in a screenshot. Kept here it can be
// checked directly.

import { randInt, randPick } from '../../engine/util.js';

export const MODES = {
  HOME_ROW: 'homeRow',
  COMMON: 'common',
  SENTENCES: 'sentences',
  PROGRAMMING: 'programming',
  CUSTOM: 'custom',
};

export const MODE_LABEL = {
  [MODES.HOME_ROW]: 'Home Row',
  [MODES.COMMON]: 'Common Words',
  [MODES.SENTENCES]: 'Sentences',
  [MODES.PROGRAMMING]: 'Programming',
  [MODES.CUSTOM]: 'Custom Text',
};

export const LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'];
export const LEVEL_LABEL = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  expert: 'Expert',
};

// The eight keys under resting fingers, plus the two index-finger reaches
// that every home-row drill includes. Anything outside this set is a bug in
// HOME_ROW mode, not a stylistic choice.
export const HOME_ROW_KEYS = 'asdfghjkl;';

// Words spellable on the home row alone. Verified against HOME_ROW_KEYS by
// the checks rather than by eye — several plausible-looking candidates
// ("shade", "flake") sneak in a letter from another row.
const HOME_ROW_WORDS = [
  'ad', 'add', 'ads', 'aha', 'alas', 'all', 'ash', 'ask', 'dad', 'dads',
  'dash', 'fad', 'fads', 'fall', 'falls', 'flag', 'flags', 'flash', 'flask',
  'gad', 'gag', 'gags', 'gal', 'gall', 'gas', 'gash', 'glad', 'glass',
  'had', 'hag', 'hags', 'half', 'hall', 'halls', 'has', 'hash', 'haha',
  'jag', 'jags', 'lad', 'lads', 'lag', 'lags', 'lash', 'lass',
  'sad', 'sag', 'sags', 'salad', 'sash', 'shad', 'shag', 'shall',
  'slag', 'slash', 'gaff', 'dahl',
];

// The most common English words, shortest first-ish. Long enough a list that
// a run does not feel like the same six words on a loop.
const COMMON_WORDS = [
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can',
  'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him',
  'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who',
  'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use',
  'that', 'with', 'have', 'this', 'will', 'your', 'from', 'they', 'know',
  'want', 'been', 'good', 'much', 'some', 'time', 'very', 'when', 'come',
  'here', 'just', 'like', 'long', 'make', 'many', 'over', 'such', 'take',
  'than', 'them', 'well', 'were', 'what', 'work', 'year', 'back', 'call',
  'about', 'after', 'again', 'could', 'every', 'first', 'found', 'great',
  'house', 'large', 'learn', 'never', 'other', 'place', 'plant', 'point',
  'right', 'small', 'sound', 'spell', 'still', 'study', 'their', 'there',
  'these', 'thing', 'think', 'three', 'water', 'where', 'which', 'world',
  'would', 'write', 'young', 'above', 'begin', 'below', 'until',
  'always', 'answer', 'around', 'because', 'before', 'better', 'between',
  'change', 'country', 'different', 'enough', 'example', 'family', 'follow',
  'important', 'letter', 'mother', 'number', 'people', 'picture', 'together',
  'through', 'thought', 'without', 'question', 'sentence', 'something',
];

const SENTENCES = [
  'the quick brown fox jumps over the lazy dog',
  'pack my box with five dozen liquor jugs',
  'how vexingly quick daft zebras jump',
  'the five boxing wizards jump quickly',
  'sphinx of black quartz judge my vow',
  'we all went down to the river that morning',
  'she sells sea shells on the shore',
  'a journey of a thousand miles begins with one step',
  'the early bird gets the worm every time',
  'nothing here is saved when you close the tab',
  'practice makes the difference over time',
  'type the words before they reach the edge',
  'small steps every day add up to something',
  'keep your fingers on the home row',
  'the rain in spain falls mainly on the plain',
];

// Symbols and shapes that actually appear in code, rather than a random
// scatter of punctuation. The point is the reaches — shift, brackets, the
// number row — not novelty.
const PROGRAMMING = [
  'const', 'let', 'return', 'function', 'import', 'export', 'async', 'await',
  '=>', '===', '!==', '&&', '||', '??', '?.', '...', '++', '--', '+=',
  '{}', '[]', '()', '();', '{};', '[0]', '[i]', 'a[0]',
  '<div>', '</div>', '/* */', '//', '#!/bin/sh', '$var', '@media',
  'i++', 'x => x', 'a ?? b', 'if (x)', 'for (;;)', 'obj.key', 'arr.map',
  'null', 'true', 'false', 'undefined', 'typeof', 'class', 'extends',
  'try {', '} catch {', 'new Set()', 'Math.max()', 'JSON.parse()',
];

// Which pool a mode draws from. Custom has none: its text comes from the
// player.
const POOLS = {
  [MODES.HOME_ROW]: HOME_ROW_WORDS,
  [MODES.COMMON]: COMMON_WORDS,
  [MODES.SENTENCES]: SENTENCES,
  [MODES.PROGRAMMING]: PROGRAMMING,
};

// Difficulty does two things: it sets how fast the words cross, and it
// filters the pool by length. Beginner never sees a nine-letter word even in
// Common Words mode, and Expert is not padded out with two-letter ones.
const LENGTH_RANGE = {
  beginner: [2, 5],
  intermediate: [3, 7],
  advanced: [4, 12],
  expert: [4, 100],
};

// Units per second the words travel, and how much each completed word adds.
// Sentences are much longer strings, so they get their own slower table --
// the same speed would make an eight-word sentence impossible at any skill.
export const SPEED = {
  beginner: { base: 26, ramp: 0.30, sentence: 14 },
  intermediate: { base: 38, ramp: 0.55, sentence: 20 },
  advanced: { base: 52, ramp: 0.85, sentence: 27 },
  expert: { base: 68, ramp: 1.20, sentence: 34 },
};

/**
 * Splits pasted text into typeable items.
 *
 * Runs of whitespace collapse, and anything longer than a sensible line is
 * broken up: pasting an essay should give a run, not one impossible item.
 * Returns an empty array for text with nothing typeable in it, which the
 * caller treats as "stay on the setup screen".
 */
export function prepareCustomText(raw, maxChars = 28) {
  const words = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  const items = [];
  let line = '';

  for (const word of words) {
    // A single word longer than the cap is hard-split rather than dropped:
    // dropping it would silently change what the player asked to practise.
    if (word.length > maxChars) {
      if (line) { items.push(line); line = ''; }
      for (let i = 0; i < word.length; i += maxChars) {
        items.push(word.slice(i, i + maxChars));
      }
      continue;
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
    else { items.push(line); line = word; }
  }
  if (line) items.push(line);

  return items;
}

/**
 * The next thing to type.
 *
 * @param {string} mode    One of MODES.
 * @param {string} level   One of LEVELS.
 * @param {string[]} custom  The prepared custom text, for MODES.CUSTOM.
 * @returns {string}
 */
export function nextItem(mode, level, custom = []) {
  if (mode === MODES.CUSTOM) {
    return custom.length ? custom[randInt(0, custom.length - 1)] : 'type something';
  }

  const pool = POOLS[mode] ?? COMMON_WORDS;

  // Sentences are not length-filtered: a sentence is the unit, and trimming
  // the list by character count would leave Beginner with almost none.
  if (mode === MODES.SENTENCES) return randPick(pool);

  const [min, max] = LENGTH_RANGE[level] ?? LENGTH_RANGE.intermediate;
  const filtered = pool.filter((word) => word.length >= min && word.length <= max);

  // Falls back to the whole pool rather than returning nothing, so a level
  // and mode combination that filters everything out still plays.
  return randPick(filtered.length ? filtered : pool);
}

/** Words-per-minute, using the standard five-characters-per-word convention. */
export function wpm(charsTyped, seconds) {
  if (seconds <= 0) return 0;
  return (charsTyped / 5) / (seconds / 60);
}
