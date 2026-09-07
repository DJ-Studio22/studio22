// tests/pixel-paintball.arena.test.mjs
//
// Pixel Paintball scores territory rather than kills, and that one decision is
// the whole design. It is also the thing that quietly does not work by itself,
// which is what this file is for:
//
//   NEITHER PURE STRATEGY WINS. A player who only paints is shot off the
//   ground they cover; a player who only hunts owns nothing worth holding.
//
// The same shape as the turn-based Winter, and the shape its real-time
// prototype could not produce: two extremes failing in DIFFERENT ways with the
// best play in between. It took three attempts to arrange, and each failure is
// recorded here because the assertions only make sense next to them:
//
//   1. Shots painted a line as they flew. Chasing bots around the arena with
//      the trigger down covered the ground as a side effect, so hunting was
//      free coverage and the sweep rose to the top.
//   2. Coverage moved to the roller -- you paint the ground you walk over.
//      Hunting still won, because bots roamed the whole arena and chasing them
//      walked you over all of it.
//   3. Bots were given a patch to stay in, and hunting STILL won, because
//      painting and shooting cost nothing shared: suppression was free on top
//      of coverage.
//
// What fixed it was ink. One tank, two uses -- the symmetry that makes the
// turn-based Winter work. The test at the bottom takes the ink away again and
// watches the game collapse back into a shooting gallery, which is the proof
// that it is ink doing the work and not a coincidence of tuning.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Arena, END, OWNER, POWERUP, POWERUPS, TUNING, holdNeededFor, waveShape,
} from '../games/pixel-paintball/arena.js';
import { SKILLS, runOnce } from './helpers/paintball-bot.mjs';
import { summarise, withSeed } from './helpers/seeded.mjs';

// Eighty seeds, and the figure was chosen rather than picked. Across two
// disjoint blocks of eighty the middle beat the hunter by 60% and 72%, and the
// painter by four to five times. Earlier arrangements of the same numbers had
// margins as low as 2%, which is a test that passes or fails on the weather
// rather than on the design.
const SEEDS = 80;

// The mix the sweep is checked at. Not a magic figure: measured across the
// whole range the curve is flat-topped from about 0.3 to 0.5 -- 6029, 7048,
// 7095, 6951 at 0.2 through 0.5 -- and falls away hard on both sides, to 1387
// at never-shoot and 4423 at only-shoot.
const MIDDLE = 0.4;

// --- The paint ------------------------------------------------------------

test('GROUND IS COVERED BY WALKING OVER IT, not by standing on it', () => {
  // The roller is where coverage comes from, and it was the first thing that
  // had to change: while shots painted a line as they flew, hunting covered
  // the arena for free and the whole sweep was meaningless.
  const arena = new Arena();
  arena.cells.fill(OWNER.NONE);
  const before = arena.holdings().player;

  for (let i = 0; i < 30; i++) arena.step(1 / 60, { x: 1, y: 0 });
  const walked = arena.holdings().player;
  assert.ok(walked > before, 'walking painted nothing');

  const still = arena.holdings().player;
  for (let i = 0; i < 30; i++) arena.step(1 / 60, {});
  assert.equal(arena.holdings().player, still,
    'standing still kept painting, so coverage is free after all');
});

test('a shot claims ground where it lands', () => {
  const arena = new Arena();
  arena.cells.fill(OWNER.NONE);
  arena.bots = [];
  const before = arena.holdings().player;
  arena.step(1 / 60, { aim: 0, fire: true });
  for (let i = 0; i < 60; i++) arena.step(1 / 60, { aim: 0 });
  assert.ok(arena.holdings().player > before, 'a shot claimed nothing');
});

// --- The ink --------------------------------------------------------------

test('PAINTING AND SHOOTING COME OUT OF THE SAME TANK', () => {
  // The line the design rests on. Without it, suppression is free on top of
  // coverage you were getting anyway, and hunting simply wins -- which is what
  // the last test in this file demonstrates by taking it away.
  const rolling = new Arena();
  rolling.bots = [];
  rolling.cells.fill(OWNER.BOT);
  for (let i = 0; i < 60; i++) rolling.step(1 / 60, { x: 1, y: 0 });
  assert.ok(rolling.player.ink < TUNING.inkMax, 'taking ground off a bot is free');

  const firing = new Arena();
  firing.bots = [];
  const before = firing.player.ink;
  firing.step(1 / 60, { aim: 0, fire: true });
  assert.equal(firing.player.ink, before - TUNING.inkPerShot);
});

test('and ink is spent on ground that changes hands, not on walking', () => {
  // Per cell claimed rather than per second moving. Charging by the second
  // made going home to reload as expensive as attacking, which turned the whole
  // map into a toll road; this way retreating over your own paint is free and
  // pushing into somebody else's is what drains you.
  const home = new Arena();
  home.bots = [];
  home.cells.fill(OWNER.PLAYER);
  home.player.ink = 50;
  for (let i = 0; i < 60; i++) home.step(1 / 60, { x: 1, y: 0 });
  assert.ok(home.player.ink >= 50, 'walking over your own paint cost ink');

  const away = new Arena();
  away.bots = [];
  away.cells.fill(OWNER.BOT);
  away.player.ink = 50;
  for (let i = 0; i < 60; i++) away.step(1 / 60, { x: 1, y: 0 });
  assert.ok(away.player.ink < 50, 'taking ground off a bot cost nothing');
});

test('and the tank refills fastest on ground you already hold', () => {
  // Which is what makes territory worth something other than points, and what
  // leaves a hunter deep in bot paint with nowhere to reload.
  const own = new Arena();
  own.bots = [];
  own.player.ink = 10;
  own.cells.fill(OWNER.PLAYER);
  for (let i = 0; i < 60; i++) own.step(1 / 60, {});

  const away = new Arena();
  away.bots = [];
  away.player.ink = 10;
  away.cells.fill(OWNER.BOT);
  for (let i = 0; i < 60; i++) away.step(1 / 60, {});

  assert.ok(own.player.ink > away.player.ink + 10,
    `refilling on your own paint is no better: ${own.player.ink} vs ${away.player.ink}`);
});

test('an empty tank paints nothing and fires nothing', () => {
  const arena = new Arena();
  arena.bots = [];
  arena.cells.fill(OWNER.BOT);
  arena.player.ink = 0;
  const shots = arena.shots.length;
  for (let i = 0; i < 30; i++) arena.step(1 / 60, { x: 1, y: 0, aim: 0, fire: true });
  assert.equal(arena.shots.length, shots, 'a dry tank still fired');
  assert.equal(arena.holdings().player, 0, 'a dry roller still painted');
  assert.equal(arena.holdings().bot, 1);
  assert.ok(arena.player.dry > 0);
});

// --- Being shot, and shooting ---------------------------------------------

test('splattering a bot takes it out of the game for a few seconds', () => {
  // And that is ALL it does directly. There is no score for it: what you buy
  // is a few seconds of a patch nobody is repainting.
  const arena = new Arena();
  const bot = arena.bots[0];
  bot.stun = 0;
  arena.shots = [{
    x: bot.x, y: bot.y, angle: 0, owner: OWNER.PLAYER, vx: 1, vy: 0, travelled: 0,
  }];
  const score = arena.score;
  arena.step(1 / 60, {});
  assert.ok(bot.stun > 0, 'the bot shrugged it off');
  assert.equal(arena.splattered, 1);
  assert.ok(arena.score - score < 1, 'splattering scored points directly');
});

test('being shot costs you the ground you are standing on', () => {
  const arena = new Arena();
  arena.cells.fill(OWNER.PLAYER);
  arena.bots = [];
  arena.shots = [{
    x: arena.player.x, y: arena.player.y, angle: 0, owner: OWNER.BOT,
    vx: 1, vy: 0, travelled: 0,
  }];
  arena.step(1 / 60, {});
  assert.ok(arena.player.stun > 0);
  assert.equal(arena.timesHit, 1);
  assert.ok(arena.holdings().bot > 0, 'a hit painted nothing');
});

test('a stunned player does not move and does not paint', () => {
  const arena = new Arena();
  arena.bots = [];
  arena.player.stun = 1;
  const { x, y } = arena.player;
  for (let i = 0; i < 30; i++) arena.step(1 / 60, { x: 1, y: 1, fire: true });
  assert.equal(arena.player.x, x);
  assert.equal(arena.player.y, y);
});

// --- The wave -------------------------------------------------------------

test('the waves escalate on every axis, and the bots keep coming', () => {
  assert.ok(waveShape(10).bots > waveShape(1).bots);
  assert.ok(waveShape(10).speed > waveShape(1).speed);
  assert.ok(waveShape(10).fireSeconds < waveShape(1).fireSeconds, 'they never fire faster');
  assert.ok(waveShape(10).aim < waveShape(1).aim, 'they never aim better');
  // Every axis has a stated stop, and they are stops rather than ceilings on
  // difficulty: a wave-forty bot is as good as a bot gets and there are twelve
  // of them, which is what eventually takes the arena off anybody.
  assert.equal(waveShape(400).bots, TUNING.botsMax);
  assert.equal(waveShape(400).aim, TUNING.botAimFloor);
  assert.equal(waveShape(400).fireSeconds, TUNING.botFireFloor);
});

test('the bar you have to clear starts lower and climbs to its full height', () => {
  // The on-ramp, and it exists because of hand-play rather than because of the
  // bots: the bots know which third of the arena they own least of, and a
  // person spends the first wave learning that the trigger is not something you
  // hold down. It stops climbing, so the late game is the same game.
  assert.ok(holdNeededFor(1) < holdNeededFor(4));
  assert.equal(holdNeededFor(40), TUNING.holdMax);
  assert.equal(holdNeededFor(1), TUNING.holdToAdvance);
});

test('holding too little when the whistle goes ends the run, and says so', () => {
  // A fail state made of territory rather than of hit points, because the score
  // is territory.
  const arena = new Arena();
  arena.cells.fill(OWNER.BOT);
  arena.time = TUNING.waveSeconds;
  arena.step(1 / 60, {});
  assert.equal(arena.running, false);
  assert.equal(arena.reason, END.OVERRUN);

  const holding = new Arena();
  holding.cells.fill(OWNER.PLAYER);
  holding.time = TUNING.waveSeconds;
  holding.step(1 / 60, {});
  assert.equal(holding.running, true);
  assert.equal(holding.wave, 2);
});

// --- The powerups ---------------------------------------------------------

test('the three powerups do three different things', () => {
  // Rather than the same thing by different amounts, which is the usual way a
  // powerup list turns into a ranking.
  const arena = new Arena();
  const base = {
    roll: arena.playerRollRadius, fire: arena.playerFireSeconds, speed: arena.playerSpeed,
  };
  const measure = (kind) => {
    arena.player.powerup = kind;
    return {
      roll: arena.playerRollRadius, fire: arena.playerFireSeconds, speed: arena.playerSpeed,
    };
  };
  const roller = measure(POWERUP.ROLLER);
  const rapid = measure(POWERUP.RAPID);
  const dash = measure(POWERUP.DASH);

  assert.ok(roller.roll > base.roll && roller.speed === base.speed);
  assert.ok(rapid.fire < base.fire && rapid.roll === base.roll);
  assert.ok(dash.speed > base.speed && dash.fire === base.fire);
  assert.equal(POWERUPS.length, 3);
});

test('a powerup is picked up by walking over it and runs out', () => {
  const arena = new Arena();
  arena.bots = [];
  arena.powerup = { kind: POWERUP.DASH, x: arena.player.x, y: arena.player.y };
  arena.step(1 / 60, {});
  assert.equal(arena.player.powerup, POWERUP.DASH);
  assert.equal(arena.powerup, null);
  for (let i = 0; i < 60 * (TUNING.powerupSeconds + 1); i++) arena.step(1 / 60, {});
  assert.equal(arena.player.powerup, null, 'the powerup never wore off');
});

// --- The claim ------------------------------------------------------------

test('NEITHER EXTREME WINS — the best mix is in the middle', () => {
  const median = (aggression) => {
    const scores = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      withSeed(seed, () => scores.push(runOnce(aggression, undefined, { waves: 14 }).score));
    }
    return summarise(scores).median;
  };

  const painter = median(0);
  const middle = median(MIDDLE);
  const hunter = median(1);

  assert.ok(middle > painter * 3,
    `painting alone keeps up: ${painter} against ${middle}`);
  assert.ok(middle > hunter * 1.25,
    `hunting alone is as good or better: ${hunter} against ${middle} — that is a `
    + 'shooting gallery with a scoreboard bolted on');
});

test('and the two extremes fail in DIFFERENT ways', () => {
  // Not just "both worse". If they failed the same way the middle would be an
  // average rather than a decision.
  const runs = (aggression) => {
    const out = [];
    for (let seed = 1; seed <= 30; seed++) {
      withSeed(seed, () => out.push(runOnce(aggression, undefined, { waves: 14 })));
    }
    return out;
  };
  const painter = runs(0);
  const hunter = runs(1);

  // The painter is shot off the ground it covers: it holds the least and it
  // does not last a wave.
  assert.ok(summarise(painter.map((r) => r.bestHold)).median
    < summarise(hunter.map((r) => r.bestHold)).median,
    'the painter holds as much ground as the hunter');
  // The hunter lasts, and spends its run on bots rather than on ground.
  assert.ok(summarise(hunter.map((r) => r.splattered)).median > 20);
  assert.equal(summarise(painter.map((r) => r.splattered)).median, 0,
    'the painter is shooting bots, so the sweep is not measuring what it says');
});

test('the bots differ in exactly one field', () => {
  // Otherwise the sweep could be measuring anything: the ink discipline, the
  // powerup habit and the movement are deliberately identical across it.
  const keys = new Set(Object.values(SKILLS).flatMap((s) => Object.keys(s)));
  assert.deepEqual([...keys], ['aggression']);
  assert.equal(SKILLS.painter.aggression, 0);
  assert.equal(SKILLS.fragger.aggression, 1);
});

test('TAKE THE INK AWAY AND IT COLLAPSES INTO A SHOOTING GALLERY', () => {
  // Convention 3, doing the job it exists for. This is not a spare assertion:
  // it is the evidence that ink is what makes the middle win, rather than some
  // accident of the other twenty numbers. Make painting and shooting free and
  // the hunter goes straight back to the top, which is exactly where it was
  // for the first three versions of this file.
  const free = { ...TUNING, inkPerShot: 0, inkPerCell: 0 };
  const median = (aggression) => {
    const scores = [];
    for (let seed = 1; seed <= 40; seed++) {
      withSeed(seed, () => scores.push(runOnce(aggression, free, { waves: 14 }).score));
    }
    return summarise(scores).median;
  };
  assert.ok(median(1) > median(MIDDLE),
    'with free ink the hunter does not dominate, so ink is not what is holding the middle up');
});
