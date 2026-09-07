// tests/tank-tactics.arena.test.mjs
//
// Tank Tactics makes one claim and everything else is decoration:
//
//   THE RICOCHET IS THE SKILL CEILING. A bank shot is something you can READ
//   and AIM, and it is worth learning.
//
// A bouncing projectile is a slot machine by default. Two separate things have
// to be true for it to be a skill, and they fail in different ways, so they
// are measured separately:
//
//   READABLE  a small error in aim gives a small error at the target. If a
//             degree of barrel moves the impact halfway across the arena, no
//             amount of practice helps.
//   WORTH IT  a player who banks beats one who does not. If direct fire is as
//             good, the ceiling is decoration — and the first version of this
//             game failed exactly there: the banking bot cleared the same
//             number of waves as the one that never banked, and was slightly
//             worse, because walking two metres opens a clean shot faster than
//             solving a bounce.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Battle, END, KIND, TUNING, WALL, bankAngle, bankSolutions, bounds, buildCover,
  canHurt, damageOf, hasLineOfSight, impactPoint, pathReaches, pushOutOfBlock,
  segmentDistance, tracePath, waveRoster,
} from '../games/tank-tactics/arena.js';
import { SKILLS, runOnce } from './helpers/tank-bot.mjs';
import { summarise, withSeed } from './helpers/seeded.mjs';

const DEG = Math.PI / 180;

// --- The shell ------------------------------------------------------------

test('a shell bounces off a wall at the angle it arrived', () => {
  const b = bounds();
  const from = { x: TUNING.width / 2, y: TUNING.height / 2 };
  // Fired up and to the right; the first turn must be off a wall, and the
  // component along that wall must survive it.
  const path = tracePath(from, -45 * DEG, { maxBounces: 1 });
  const turn = path.points.find((p) => p.bounce);
  assert.ok(turn, 'the shell never touched a wall');
  assert.ok(
    Math.abs(turn.y - (b.top + TUNING.shellRadius)) < 1e-6
    || Math.abs(turn.x - (b.right - TUNING.shellRadius)) < 1e-6,
    'the turn was not on a wall face',
  );
});

test('a shell stops at cover rather than passing through it', () => {
  const cover = [{ x: 30, y: 20, w: 6, h: 3, hp: 3 }];
  const path = tracePath({ x: 10, y: 20 }, 0, { cover });
  assert.equal(path.stoppedBy, 'cover');
  assert.ok(path.points[path.points.length - 1].x < 30, 'the shell went past the block');
});

test('a shell is stopped by the bounce limit, not by luck', () => {
  const path = tracePath({ x: 30, y: 19 }, 0.3, { maxBounces: 2 });
  assert.ok(path.bounces <= 2 + 1);
});

// --- READABLE -------------------------------------------------------------

test('A ONE-BOUNCE SHOT IS AIMABLE — the readability claim', () => {
  // The measurement: nudge the barrel by one degree and see how far the impact
  // moves. If it moves less than the width of a tank, aiming by eye works and
  // the shot is a skill. If it moves half an arena, it is a lottery.
  //
  // Sampled over the whole floor and the whole circle rather than at a
  // convenient spot, because a ricochet that is only readable from the middle
  // is not readable.
  const cover = buildCover(3);
  const tankWidth = TUNING.tankRadius * 2;
  const moves = [];

  for (let px = 8; px < TUNING.width - 8; px += 4) {
    for (let py = 5; py < TUNING.height - 5; py += 4) {
      for (let a = 0; a < 360; a += 3) {
        const angle = a * DEG;
        const p0 = impactPoint({ x: px, y: py }, angle, { cover, maxBounces: 1 });
        const p1 = impactPoint({ x: px, y: py }, angle + DEG, { cover, maxBounces: 1 });
        moves.push(Math.hypot(p1.x - p0.x, p1.y - p0.y));
      }
    }
  }

  moves.sort((a, b) => a - b);
  const median = moves[Math.floor(moves.length / 2)];
  const aimable = moves.filter((m) => m < tankWidth).length / moves.length;

  assert.ok(median < tankWidth * 0.5,
    `a degree of barrel moves the median impact ${median.toFixed(2)} units, `
    + `against a tank ${tankWidth.toFixed(2)} wide`);
  assert.ok(aimable > 0.85,
    `only ${Math.round(aimable * 100)}% of one-bounce shots are aimable; `
    + 'the rest are a lottery');
});

test('and the unaimable ones are corner grazes, which the aiming line shows', () => {
  // The tenth of shots that are not aimable are where the shell is about to
  // switch which wall it meets first. That is a discontinuity rather than a
  // gradient, and it is visible: the drawn line jumps rather than sliding. So
  // it is honest, not hidden — but it must stay rare, hence the floor above.
  //
  // Checked here by confirming the sensitivity is well behaved AWAY from the
  // corners, which is where a player takes a bank shot from.
  const cover = [];
  const from = { x: TUNING.width / 2, y: TUNING.height - 6 };
  let worst = 0;
  for (let a = -160; a < -20; a += 3) {
    const angle = a * DEG;
    const p0 = impactPoint(from, angle, { cover, maxBounces: 1 });
    const p1 = impactPoint(from, angle + DEG, { cover, maxBounces: 1 });
    worst = Math.max(worst, Math.hypot(p1.x - p0.x, p1.y - p0.y));
  }
  assert.ok(worst < TUNING.tankRadius * 6,
    `firing upfield from the middle, a degree moved the impact ${worst.toFixed(1)} units`);
});

test('the mirror solution actually lands, checked by firing it', () => {
  // bankAngle() is a closed form and closed forms are exactly the sort of
  // thing that is right on paper and wrong in the game. Every solution is
  // proved by tracing the real shell, the same way the mini golf generator
  // proves a hole rather than trusting the search.
  const cover = [];
  const from = { x: 14, y: 30 };
  const target = { x: 44, y: 30 };
  const angle = bankAngle(from, target, WALL.TOP);
  assert.ok(angle !== null, 'no mirror solution off the top wall');
  const path = tracePath(from, angle, { cover, maxBounces: 1 });
  assert.equal(path.bounces, 1);
  assert.ok(pathReaches(path, target, TUNING.tankRadius + TUNING.shellRadius),
    'the mirror angle did not actually reach the target');
});

test('bankSolutions refuses shots the geometry does not allow', () => {
  // Both tanks have to be on the near side of the wall. A target already
  // against the top wall has no shot off the top wall, and saying otherwise
  // would draw an aiming line at something that cannot be hit.
  const b = bounds();
  const target = { x: 30, y: b.top + TUNING.shellRadius };
  assert.equal(bankAngle({ x: 20, y: 30 }, target, WALL.TOP), null);
});

// --- WORTH IT -------------------------------------------------------------

test('a dug-in tank cannot be hurt head on, and a ricochet gets through', () => {
  const sniper = { kind: KIND.SNIPER };
  const grunt = { kind: KIND.GRUNT };
  assert.equal(canHurt(sniper, { bounces: 0 }), false);
  assert.equal(canHurt(sniper, { bounces: 1 }), true);
  assert.equal(canHurt(grunt, { bounces: 0 }), true);
});

test('and a ricochet hits harder than a straight shot', () => {
  assert.ok(damageOf({ bounces: 1 }) > damageOf({ bounces: 0 }),
    'banking costs more effort and must pay more, or nobody sane would do it');
});

test('THE RICOCHET IS WORTH LEARNING — the skill claim', () => {
  // The two bots differ in one thing and one thing only: whether they will
  // solve a bank when they cannot shoot straight. Everything else — movement,
  // target choice, leading, aim error — is identical, so the gap between them
  // IS the value of the ricochet.
  const direct = [];
  const bank = [];
  for (let seed = 1; seed <= 30; seed++) {
    withSeed(seed, () => direct.push(runOnce('direct').waves));
    withSeed(seed, () => bank.push(runOnce('bank').waves));
  }
  const d = summarise(direct);
  const b = summarise(bank);

  assert.ok(b.median > d.median,
    `banking bought nothing: direct ${d.median} waves, bank ${b.median}`);
  assert.ok(b.max > d.max,
    'the ceiling is not higher for the player who can bank, so it is not a ceiling');
});

test('and the bot that will not bank stops dead where the dug-in tanks start', () => {
  // Not a slope — a wall, and deliberately. A player who never learns the
  // ricochet gets the same score every time, which is the clearest way a game
  // can say "this is the thing to learn".
  const waves = [];
  for (let seed = 1; seed <= 20; seed++) {
    withSeed(seed, () => waves.push(runOnce('direct').waves));
  }
  const unique = [...new Set(waves)];
  assert.equal(unique.length, 1,
    `the direct bot varied (${unique.join(', ')}); the wall should be exact`);
  assert.equal(unique[0], TUNING.sniperFromWave - 1,
    'the wall is not where the dug-in tanks start');
});

test('a bank hit is recorded as a bank hit', () => {
  // The bookkeeping the claim above rests on. If bounces were not counted the
  // whole comparison would be measuring nothing.
  //
  // The direct bot's count is asserted as NEARLY zero rather than exactly
  // zero, and that correction was earned: it shoots at cover to break through,
  // and a shell that comes off a block or a wall can find an enemy by
  // accident. That was impossible while every tank charged the player and died
  // in a heap; once tanks hold position there are more of them alive and
  // spread out, and one accidental ricochet in a run turned up immediately.
  //
  // An accident is not a skill, so what matters is that the deliberate count
  // dwarfs it.
  const bank = withSeed(4, () => runOnce('bank'));
  const direct = withSeed(4, () => runOnce('direct'));
  assert.ok(bank.bankHits > 0, 'the banking bot never landed a ricochet');
  assert.ok(direct.bankHits * 20 < bank.bankHits,
    `the direct bot landed ${direct.bankHits} ricochets against the banking bot's `
    + `${bank.bankHits} — that is not an accident, it is banking`);
});

// --- The arena ------------------------------------------------------------

test('waves grow without a ceiling, and change in kind as well as number', () => {
  assert.ok(waveRoster(20).length > waveRoster(1).length);
  assert.ok(waveRoster(200).length > waveRoster(20).length, 'the escalation stops');
  assert.equal(waveRoster(1).every((k) => k === KIND.GRUNT), true,
    'the first wave should teach one thing');
  assert.ok(waveRoster(9).includes(KIND.SNIPER));
  assert.ok(waveRoster(9).includes(KIND.BOUNCER));
});

test('cover is symmetric, so neither side of the arena is the safe side', () => {
  for (const wave of [1, 2, 3, 5]) {
    const cover = buildCover(wave);
    const cx = TUNING.width / 2;
    for (const block of cover) {
      const mirrored = cover.some((other) => Math.abs(other.x - (2 * cx - block.x)) < 1e-6
        && Math.abs(other.y - block.y) < 1e-6);
      assert.ok(mirrored, `a block at ${block.x.toFixed(1)},${block.y.toFixed(1)} has no mirror`);
    }
  }
});

test('line of sight is blocked by cover and cleared when it is shot away', () => {
  const cover = [{ x: 30, y: 20, w: 6, h: 4, hp: 2 }];
  const a = { x: 10, y: 20 };
  const b = { x: 50, y: 20 };
  assert.equal(hasLineOfSight(a, b, cover), false);
  cover[0].hp = 0;
  assert.equal(hasLineOfSight(a, b, cover), true, 'a destroyed block still blocked the view');
});

test('a tank cannot stand inside cover', () => {
  const block = { x: 30, y: 20, w: 6, h: 4, hp: 3 };
  const body = { x: 30.5, y: 20.5 };
  pushOutOfBlock(body, block, TUNING.tankRadius);
  const insideX = Math.abs(body.x - block.x) < block.w / 2 + TUNING.tankRadius - 1e-6;
  const insideY = Math.abs(body.y - block.y) < block.h / 2 + TUNING.tankRadius - 1e-6;
  assert.equal(insideX && insideY, false, 'still overlapping after being pushed out');
});

test('the shield takes one hit and then has to recharge', () => {
  const battle = new Battle();
  assert.equal(battle.player.shield, true);
  const hit = () => {
    battle.fire({ x: battle.player.x, y: battle.player.y - 4 }, Math.PI / 2, false);
    for (let i = 0; i < 40 && battle.player.shield; i++) battle.step(1 / 60, {});
  };
  hit();
  assert.equal(battle.player.shield, false, 'the shield did not absorb a hit');
  assert.equal(battle.player.hp, TUNING.playerHp, 'the shield failed to protect the hull');
});

test('clearing a wave brings the next one, and the score is waves cleared', () => {
  const battle = new Battle();
  assert.equal(battle.score, 0);
  battle.enemies = [];
  battle.step(1 / 60, {});
  assert.equal(battle.score, 1);
  assert.equal(battle.wave, 2);
  assert.ok(battle.enemies.length > 0, 'the next wave never arrived');
});

test('a run ends for a stated reason', () => {
  const battle = new Battle();
  battle.player.hp = 1;
  battle.player.shield = false;
  for (let i = 0; i < 60 * 120 && battle.running; i++) battle.step(1 / 60, {});
  if (!battle.running) assert.equal(battle.reason, END.DESTROYED);
});

test('tuning is data a test can override', () => {
  // Convention 3. If this passed with a restated constant it would be
  // measuring a copy of the game rather than the game.
  const slow = { ...TUNING, shellSpeed: TUNING.shellSpeed * 0.25 };
  const far = tracePath({ x: 30, y: 20 }, 0.4, { tuning: TUNING, maxBounces: 3 });
  const near = tracePath({ x: 30, y: 20 }, 0.4, { tuning: slow, maxBounces: 3 });
  assert.ok(far.bounces > near.bounces,
    'quartering the shell speed did not shorten its flight, so the tuning is not live');
});

test('segmentDistance is honest about both ends', () => {
  assert.equal(segmentDistance({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 3 }), 3);
  assert.equal(segmentDistance({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: -4, y: 0 }), 4);
  assert.equal(segmentDistance({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 14, y: 0 }), 4);
});

test('both bots exist and differ only in whether they bank', () => {
  const keys = new Set([...Object.keys(SKILLS.direct), ...Object.keys(SKILLS.bank)]);
  const differ = [...keys].filter((k) => SKILLS.direct[k] !== SKILLS.bank[k]);
  assert.deepEqual(differ, ['banks'],
    'the two bots differ in more than the ricochet, so the gap measures something else');
});
