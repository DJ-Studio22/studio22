// games/tank-tactics/game.js
//
// Tank Tactics — arena tanks, and a ricochet you can aim.
//
// THE RULE
// --------
// Waves of tanks come at you in a walled arena. Your shell bounces off the
// walls. Dug-in tanks cannot be hurt head on: the only way through their plate
// is a shot that has come off a wall first. Waves cleared is the score.
//
// WHY THE BANK SHOT IS THE GAME
// -----------------------------
// A bouncing projectile is a slot machine by default, and the first version of
// this game proved it: a bot that solved bank shots and a bot that never
// banked cleared exactly the same number of waves, and the banking one was
// slightly worse. Of course it was — the arena is open and the tank is quick,
// so walking two metres opens a clean shot faster than solving a bounce.
//
// Two lines fixed that, and both are in arena.js where they can be measured:
// a ricochet does double damage, so banking is worth CHOOSING; and a dug-in
// tank cannot be hurt by direct fire at all, so it is worth LEARNING. The bots
// now separate cleanly — see tests/tank-tactics.arena.test.mjs.
//
// WHAT THIS FILE DOES
// -------------------
// Canvas, input, audio, shell wiring, and the aiming line. Not one rule.
//
// The aiming line is the most important thing drawn here, and it is drawn by
// calling the SAME tracePath() the shell itself flies, so what you are shown
// and what happens cannot disagree. That identity is the whole reason the
// ricochet reads as a skill instead of a hope.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticlePresets, ParticleSystem, randRange } from '../../engine/util.js';

import {
  Battle, KIND, STATE, TUNING, bounds, canHurt, hasLineOfSight, tracePath,
} from './arena.js';

const GAME_ID = 'tank-tactics';

// The canvas matches the arena's proportions exactly, so a world unit is the
// same number of pixels in both axes and a circle is a circle.
const SCALE = 15;
const W = TUNING.width * SCALE;   // 900
const H = TUNING.height * SCALE;  // 570

// --- Art palette ---------------------------------------------------------
//
// Tank Tactics' own colours, deliberately NOT from tokens.css. A concrete
// testing ground under sodium light: cold floor, warm hazard paint, and one
// hot colour reserved entirely for the ricochet so the eye learns it. The
// shell still draws pause, game over and its own screens in site tokens over
// the top, which keeps it recognisably Studio 22.
//
// Grouped by subject per CLAUDE.md.
const ART = {
  floor: { base: '#20262f', grid: 'rgba(150,180,210,.055)', vignette: 'rgba(6,8,12,.45)' },
  wall: { face: '#39424f', top: '#4d5867', hazard: '#c8a13c' },
  // A block gets warmer and lighter as it comes apart, so how much is left of
  // your cover reads at a glance. Rubble was 71 from the floor and effectively
  // invisible; 149 now.
  cover: { full: '#5a6675', cracked: '#7d6552', rubble: '#6b5648', edge: '#8a97a8' },
  player: {
    hull: '#4e8f5a', hullDark: '#2f5c39', track: '#232a22',
    turret: '#69ad76', barrel: '#8fd39c', shield: 'rgba(126,214,166,.30)',
    shieldEdge: '#7fd6a6',
  },
  grunt: { hull: '#a8494b', hullDark: '#6d2c2e', turret: '#c66163', barrel: '#e08183' },
  bouncer: { hull: '#8a5bbf', hullDark: '#573a78', turret: '#a878d8', barrel: '#c8a2ee' },
  // Cyan, and the contrast check chose it. At the steel-grey it started as, a
  // dug-in tank scored 33 against a block of cover — the one enemy you MUST
  // pick out was the same colour as the scenery it stands next to. 185 now.
  sniper: {
    hull: '#3aa0c4', hullDark: '#1d5f7a', turret: '#5cc0e0', barrel: '#9fe0f2',
    plate: '#eef4f8', plateEdge: '#9fb6c4',
  },
  shell: {
    friendly: '#f2f7fc', friendlyGlow: 'rgba(242,247,252,.35)',
    // Pink rather than orange. Against the gold of a banked shell, orange
    // scored 148 — and those two are the pair that most needs telling apart at
    // speed, because one of them is about to hit you and the other is about to
    // do double damage for you. 249 now.
    hostile: '#ff5a7a', hostileGlow: 'rgba(255,90,122,.30)',
    // The one hot colour in the game, reserved for a shell that has bounced.
    banked: '#ffd45e', bankedGlow: 'rgba(255,212,94,.45)',
  },
  aim: {
    direct: 'rgba(242,247,252,.30)',
    banked: 'rgba(255,212,94,.62)',
    bounce: '#ffd45e',
    blocked: 'rgba(255,107,90,.42)',
  },
  // The three states a tank can be in about you. This is the most important
  // information on the screen after your own shell, so it gets its own colours
  // rather than borrowing the hull's.
  alert: {
    asleep: 'rgba(226,238,250,.16)',
    cone: 'rgba(226,238,250,.075)',
    coneSeen: 'rgba(255,212,94,.16)',
    waking: '#ffd45e',
    awake: '#ff5a7a',
  },
  hud: {
    label: 'rgba(226,238,250,.60)',
    value: '#f2f7fc',
    good: '#7fd6a6',
    warn: '#ffd45e',
    bad: '#ff5a7a',
    panel: 'rgba(9,14,22,.82)',
    panelEdge: 'rgba(226,238,250,.14)',
  },
  spark: ['#ffd45e', '#ffb340', '#f2f7fc'],
  deflect: ['#d8dee8', '#8fa3bd', '#ffffff'],
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 340 });

Input.setTouchLayout([
  { name: 'a', xRatio: 0.90, yRatio: 0.82, radius: 54, label: 'Fire' },
]);
// aimX/aimY are always 0 on a phone without this, and a game built around
// aiming would be unplayable on touch while looking fine on a pad.
Input.setAimStickEnabled(true);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  fire: { beep: { freq: 210, duration: 0.07, type: 'square', volume: 0.13 } },
  bounce: { beep: { freq: 640, duration: 0.04, type: 'triangle', volume: 0.10 } },
  hit: { beep: { freq: 150, duration: 0.10, type: 'sawtooth', volume: 0.16 } },
  bankHit: { beep: { freq: 880, duration: 0.16, type: 'triangle', volume: 0.22 } },
  deflect: { beep: { freq: 1200, duration: 0.05, type: 'square', volume: 0.13 } },
  hurt: { beep: { freq: 110, duration: 0.22, type: 'sawtooth', volume: 0.20 } },
  shield: { beep: { freq: 520, duration: 0.14, type: 'sine', volume: 0.14 } },
  wave: { beep: { freq: 440, duration: 0.26, type: 'triangle', volume: 0.18 } },
  spotted: { beep: { freq: 760, duration: 0.09, type: 'square', volume: 0.15 } },
  over: { beep: { freq: 80, duration: 0.7, type: 'triangle', volume: 0.28 } },
});

// --- State ---------------------------------------------------------------

let battle = new Battle();
let running = false;
let shake = 0;
let waveFlash = 0;
let time = 0;

// What the shells looked like last frame, so a bounce can be heard the moment
// it happens rather than inferred.
let lastBounceCount = 0;
let lastHits = { bank: 0, direct: 0, deflect: 0 };
let lastHp = TUNING.playerHp;
let lastSightings = 0;

function reset() {
  battle = new Battle();
  running = true;
  shake = 0;
  waveFlash = 0;
  lastBounceCount = 0;
  lastHits = { bank: 0, direct: 0, deflect: 0 };
  lastHp = TUNING.playerHp;
  lastSightings = 0;
  particles.clear();
}

function finish() {
  if (!running) return;
  running = false;
  audio.play('over');
  const shots = battle.shotsFired || 1;
  shell.showGameOver(battle.wavesCleared, {
    reachedWave: battle.wave,
    ricochetHits: battle.bankHits,
    directHits: battle.directHits,
    accuracy: `${Math.round(((battle.bankHits + battle.directHits) / shots) * 100)}%`,
  });
}

// --- Input ---------------------------------------------------------------
//
// One angle, three ways to set it. A stick and a thumb aim absolutely; a
// keyboard turns the barrel at turretTurnRate with Q and E, the way a turret
// actually moves. The GAME is identical either way — arena.js only ever sees a
// number — which is what keeps the difficulty measured in tests/ true of every
// device rather than of whichever one was to hand.
function readInput(dt) {
  const pad = Input.get();
  const aimLength = Math.hypot(pad.aimX, pad.aimY);

  let aim = battle.player.turret;
  if (aimLength > 0.35) {
    aim = Math.atan2(pad.aimY, pad.aimX);
  } else {
    if (pad.ls) aim -= TUNING.turretTurnRate * dt;
    if (pad.rs) aim += TUNING.turretTurnRate * dt;
  }

  return { x: pad.x, y: pad.y, aim, fire: pad.a || pad.rt };
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;

  particles.update(dt);
  time += dt;
  if (shake > 0) shake = Math.max(0, shake - dt * 2.6);
  if (waveFlash > 0) waveFlash = Math.max(0, waveFlash - dt * 1.4);

  if (!running) return;

  const before = battle.wavesCleared;
  const input = readInput(dt);
  const wasReloading = battle.player.reload > 0;

  battle.step(dt, input);

  if (!wasReloading && battle.player.reload > 0) audio.play('fire', { pitchVariance: 0.06 });

  // Bounces, heard the frame they happen.
  const bounces = battle.shells.reduce((sum, s) => sum + s.bounces, 0);
  if (bounces > lastBounceCount) audio.play('bounce', { pitchVariance: 0.15 });
  lastBounceCount = bounces;

  // Hits, and the one that matters gets its own sound and its own sparks.
  if (battle.bankHits > lastHits.bank) {
    audio.play('bankHit');
    shake = Math.max(shake, 0.5);
    burst(battle, ART.spark, 26);
  } else if (battle.directHits > lastHits.direct) {
    audio.play('hit');
    burst(battle, ART.spark, 12);
  }
  if (battle.deflections > lastHits.deflect) {
    audio.play('deflect');
    burst(battle, ART.deflect, 10);
  }
  lastHits = {
    bank: battle.bankHits, direct: battle.directHits, deflect: battle.deflections,
  };

  if (battle.player.hp < lastHp) {
    audio.play('hurt');
    shake = 1;
  } else if (lastHp === battle.player.hp && !battle.player.shield && battle.player.shieldTimer > TUNING.shieldRecharge - 0.1) {
    audio.play('shield');
    shake = Math.max(shake, 0.4);
  }
  lastHp = battle.player.hp;

  if (battle.wavesCleared > before) {
    audio.play('wave');
    waveFlash = 1;
  }

  // Being noticed is a thing that happens TO you, so it gets a sound of its
  // own rather than being something to spot in the corner of the eye.
  if (battle.sightings > lastSightings) audio.play('spotted', { pitchVariance: 0.1 });
  lastSightings = battle.sightings;

  if (!battle.running) finish();
}

/** Sparks wherever the last thing happened — near the player's aim. */
function burst(b, colors, count) {
  const p = b.player;
  const reach = 8;
  particles.emit(
    (p.x + Math.cos(p.turret) * reach) * SCALE,
    (p.y + Math.sin(p.turret) * reach) * SCALE,
    { ...ParticlePresets.explosion, count, colors, speed: [70, 210] },
  );
}

// --- Drawing -------------------------------------------------------------

const sx = (x) => x * SCALE;
const sy = (y) => y * SCALE;

function drawFloor() {
  ctx.fillStyle = ART.floor.base;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = ART.floor.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= TUNING.width; x += 4) { ctx.moveTo(sx(x), 0); ctx.lineTo(sx(x), H); }
  for (let y = 0; y <= TUNING.height; y += 4) { ctx.moveTo(0, sy(y)); ctx.lineTo(W, sy(y)); }
  ctx.stroke();

  // The walls, with hazard stripes — because the walls are not scenery here,
  // they are the thing you shoot off, and they should look like equipment.
  const b = bounds();
  const t = TUNING.wallThickness * SCALE;
  ctx.fillStyle = ART.wall.face;
  ctx.fillRect(0, 0, W, t);
  ctx.fillRect(0, H - t, W, t);
  ctx.fillRect(0, 0, t, H);
  ctx.fillRect(W - t, 0, t, H);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, t); ctx.rect(0, H - t, W, t);
  ctx.rect(0, 0, t, H); ctx.rect(W - t, 0, t, H);
  ctx.clip();
  ctx.strokeStyle = ART.wall.hazard;
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = -H; i < W + H; i += 26) { ctx.moveTo(i, 0); ctx.lineTo(i + H, H); }
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = ART.wall.top;
  ctx.lineWidth = 2;
  ctx.strokeRect(sx(b.left), sy(b.top), sx(b.right - b.left), sy(b.bottom - b.top));
}

function drawCover() {
  for (const block of battle.cover) {
    const x = sx(block.x - block.w / 2);
    const y = sy(block.y - block.h / 2);
    const w = sx(block.w);
    const h = sy(block.h);
    const wear = 1 - block.hp / block.maxHp;

    ctx.fillStyle = wear > 0.6 ? ART.cover.rubble : wear > 0.25 ? ART.cover.cracked : ART.cover.full;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = ART.cover.edge;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);

    // Damage drawn as cracks rather than as a health bar: a block you can read
    // at a glance is a block you can decide to shoot away.
    if (wear > 0) {
      ctx.strokeStyle = ART.cover.rubble;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const cracks = Math.ceil(wear * 4);
      for (let i = 0; i < cracks; i++) {
        const t = (i + 1) / (cracks + 1);
        ctx.moveTo(x + w * t, y);
        ctx.lineTo(x + w * (t + 0.12), y + h);
      }
      ctx.stroke();
    }
  }
}

/**
 * The aiming line.
 *
 * Drawn by tracing the real shell, so it cannot lie about where the shot goes.
 * The segment before the first bounce is dim; everything after it is the hot
 * colour, because the part after the bounce is the part worth learning to see.
 */
function drawAim() {
  if (!running) return;
  const p = battle.player;
  const path = tracePath(p, p.turret, { cover: battle.cover, maxBounces: 1 });

  ctx.lineWidth = 2;
  ctx.setLineDash([7, 7]);
  ctx.lineDashOffset = -time * 40;
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1];
    const b = path.points[i];
    const afterBounce = i > 1;
    ctx.strokeStyle = path.stoppedBy === 'cover' && i === path.points.length - 1
      ? ART.aim.blocked
      : afterBounce ? ART.aim.banked : ART.aim.direct;
    ctx.beginPath();
    ctx.moveTo(sx(a.x), sy(a.y));
    ctx.lineTo(sx(b.x), sy(b.y));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // The bounce point, marked, because that is the thing the player is really
  // aiming at.
  const turn = path.points.find((q) => q.bounce);
  if (turn) {
    ctx.fillStyle = ART.aim.bounce;
    ctx.beginPath();
    ctx.arc(sx(turn.x), sy(turn.y), 4 + Math.sin(time * 7) * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTank(x, y, angle, colours, radius, options = {}) {
  const px = sx(x);
  const py = sy(y);
  const r = radius * SCALE;

  ctx.fillStyle = colours.track;
  ctx.fillRect(px - r, py - r * 1.05, r * 2, r * 0.34);
  ctx.fillRect(px - r, py + r * 0.71, r * 2, r * 0.34);

  ctx.fillStyle = colours.hull;
  ctx.beginPath();
  ctx.roundRect(px - r * 0.86, py - r * 0.78, r * 1.72, r * 1.56, r * 0.24);
  ctx.fill();
  ctx.strokeStyle = colours.hullDark;
  ctx.lineWidth = 2;
  ctx.stroke();

  // The plate on a dug-in tank, drawn on the side it is facing, so "you cannot
  // shoot this head on" is a thing you can see rather than a thing you learn
  // by dying.
  if (options.plated) {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = colours.plate;
    ctx.beginPath();
    ctx.roundRect(r * 0.5, -r * 0.95, r * 0.42, r * 1.9, r * 0.15);
    ctx.fill();
    ctx.strokeStyle = colours.plateEdge;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);
  ctx.fillStyle = colours.barrel;
  ctx.fillRect(0, -r * 0.16, r * 1.5, r * 0.32);
  ctx.restore();

  ctx.fillStyle = colours.turret;
  ctx.beginPath();
  ctx.arc(px, py, r * 0.52, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The sight cone of a tank that has not noticed you.
 *
 * Drawn faint, and drawn at all only while the tank is holding — because the
 * question it answers ("where can I walk without being seen") stops mattering
 * the moment the answer is "it already saw you". It brightens when the player
 * is actually inside it, which is the half-second of warning before the tank
 * wakes.
 */
function drawSightCone(e) {
  if (e.state !== STATE.HOLDING) return;
  const p = battle.player;
  const facing = Math.atan2(
    e.postY + Math.sin(e.patrol) * TUNING.patrolRadius - e.y,
    e.postX + Math.cos(e.patrol) * TUNING.patrolRadius - e.x,
  );
  const inside = hasLineOfSight(e, p, battle.cover)
    && Math.hypot(p.x - e.x, p.y - e.y) <= TUNING.sightRange;

  ctx.fillStyle = inside ? ART.alert.coneSeen : ART.alert.cone;
  ctx.beginPath();
  ctx.moveTo(sx(e.x), sy(e.y));
  ctx.arc(sx(e.x), sy(e.y), TUNING.sightRange * SCALE, facing - 0.75, facing + 0.75);
  ctx.closePath();
  ctx.fill();
}

function drawEnemies() {
  for (const e of battle.enemies) drawSightCone(e);

  for (const e of battle.enemies) {
    const colours = e.kind === KIND.SNIPER ? ART.sniper
      : e.kind === KIND.BOUNCER ? ART.bouncer : ART.grunt;
    const holding = e.state === STATE.HOLDING;
    const facing = holding
      ? Math.atan2(
        e.postY + Math.sin(e.patrol) * TUNING.patrolRadius - e.y,
        e.postX + Math.cos(e.patrol) * TUNING.patrolRadius - e.x,
      )
      : Math.atan2(battle.player.y - e.y, battle.player.x - e.x);

    // A sleeping tank is drawn dimmer, so a screen of them reads as a place
    // rather than as a wave of things already coming for you.
    ctx.globalAlpha = holding ? 0.62 : 1;
    drawTank(e.x, e.y, facing, colours, TUNING.enemyRadius, {
      plated: !canHurt(e, { bounces: 0 }),
    });
    ctx.globalAlpha = 1;

    drawAlertMark(e);
  }
}

/** The moment a tank notices you, and the fact that it has. */
function drawAlertMark(e) {
  const x = sx(e.x);
  const y = sy(e.y) - TUNING.enemyRadius * SCALE - 14;

  if (e.state === STATE.HOLDING) {
    // A small closed eye. Quiet, but present, so "not looking" is a state you
    // can see rather than infer.
    ctx.strokeStyle = ART.alert.asleep;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y + 3, 5, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    return;
  }

  if (e.state === STATE.ALERTED) {
    // THE SIGHTING. A ring closing in over the second it takes to react, and a
    // bang above it — break the line before the ring shuts and it goes back to
    // sleep, which is the whole reason the state is a second long.
    const share = 1 - e.alert / TUNING.alertSeconds;
    ctx.strokeStyle = ART.alert.waking;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 16 - share * 8, -Math.PI / 2, -Math.PI / 2 + share * Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = ART.alert.waking;
    ctx.font = '800 17px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', x, y + 6);
    return;
  }

  ctx.fillStyle = ART.alert.awake;
  ctx.font = '800 17px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('!', x, y + 6 + Math.sin(time * 9) * 1.5);
}

function drawPlayer() {
  const p = battle.player;
  if (p.shield) {
    ctx.fillStyle = ART.player.shield;
    ctx.beginPath();
    ctx.arc(sx(p.x), sy(p.y), TUNING.tankRadius * SCALE * 1.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ART.player.shieldEdge;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  drawTank(p.x, p.y, p.turret, ART.player, TUNING.tankRadius);
}

function drawShells() {
  for (const s of battle.shells) {
    const banked = s.friendly && s.bounces > 0;
    const glow = banked ? ART.shell.bankedGlow
      : s.friendly ? ART.shell.friendlyGlow : ART.shell.hostileGlow;
    const core = banked ? ART.shell.banked
      : s.friendly ? ART.shell.friendly : ART.shell.hostile;

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx(s.x), sy(s.y), TUNING.shellRadius * SCALE * 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(sx(s.x), sy(s.y), TUNING.shellRadius * SCALE * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHud() {
  const p = battle.player;

  ctx.fillStyle = ART.hud.panel;
  ctx.beginPath(); ctx.roundRect(16, 14, 206, 76, 10); ctx.fill();
  ctx.strokeStyle = ART.hud.panelEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('WAVE', 30, 36);
  ctx.fillStyle = ART.hud.value;
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.fillText(String(battle.wave), 30, 62);

  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('CLEARED', 96, 36);
  ctx.fillStyle = ART.hud.value;
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.fillText(String(battle.wavesCleared), 96, 62);

  // Hull, as pips. A number would be read; pips are seen.
  for (let i = 0; i < TUNING.playerHp; i++) {
    ctx.fillStyle = i < p.hp ? ART.hud.good : 'rgba(226,238,250,.16)';
    ctx.beginPath();
    ctx.roundRect(168, 30 + i * 8, 34, 5, 2.5);
    ctx.fill();
  }

  // The shield, and how long until it is back. Right-aligned against what
  // the shell leaves free, not against the canvas edge: on a phone there is a
  // pause button in that corner. Zero on a desktop.
  const hudRight = W - shell.rightInset();
  ctx.textAlign = 'right';
  ctx.fillStyle = p.shield ? ART.hud.good : ART.hud.label;
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText(
    p.shield ? 'SHIELD UP' : `SHIELD ${Math.ceil(p.shieldTimer)}s`,
    hudRight - 24, 36,
  );

  // How much of the wave is awake. The number that says whether you are
  // picking a room apart or being hunted across it.
  const awake = battle.enemies.filter((e) => e.state !== STATE.HOLDING).length;
  ctx.textAlign = 'right';
  ctx.fillStyle = awake === 0 ? ART.hud.good : awake < battle.enemies.length ? ART.hud.warn : ART.hud.bad;
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText(
    awake === 0 ? 'NOBODY HAS SEEN YOU' : `${awake} of ${battle.enemies.length} HUNTING`,
    hudRight - 24, 56,
  );

  // The one line of teaching this game needs, shown until the player has
  // actually landed a ricochet.
  if (battle.bankHits === 0) {
    ctx.textAlign = 'center';
    ctx.fillStyle = ART.hud.warn;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText('Bounce a shot off a wall — ricochets hit twice as hard', W / 2, H - 22);
  }

  if (waveFlash > 0) {
    ctx.globalAlpha = waveFlash;
    ctx.textAlign = 'center';
    ctx.fillStyle = ART.hud.warn;
    ctx.font = '800 30px system-ui, sans-serif';
    ctx.fillText(`WAVE ${battle.wave}`, W / 2, H * 0.34);
    ctx.globalAlpha = 1;
  }
}

function render() {
  ctx.save();
  if (shake > 0) ctx.translate(randRange(-1, 1) * shake * 7, randRange(-1, 1) * shake * 7);
  drawFloor();
  drawCover();
  drawAim();
  drawEnemies();
  drawPlayer();
  drawShells();
  particles.draw(ctx);
  ctx.restore();

  // A vignette, so the middle of the arena reads as the lit part.
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.85);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, ART.floor.vignette);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);

  drawHud();
}

// --- Boot ----------------------------------------------------------------

let shell;

const loop = new GameLoop({
  update,
  render,
  onPause: () => shell?.pause(),
});

shell = new GameShell({
  gameId: GAME_ID,
  title: 'Tank Tactics',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Drive', gamepad: 'Left stick', keyboard: 'WASD or arrows', touch: 'Left side' },
    { action: 'Aim', gamepad: 'Right stick', keyboard: 'Q and E turn the barrel', touch: 'Right side' },
    { action: 'Fire', gamepad: 'A or right trigger', keyboard: 'Space', touch: 'Fire pad' },
    { action: 'Ricochet', gamepad: 'Hits twice as hard', keyboard: 'Hits twice as hard', touch: 'Hits twice as hard' },
    { action: 'Plated tanks', gamepad: 'Only a ricochet gets through', keyboard: 'Only a ricochet gets through', touch: 'Only a ricochet gets through' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({
  name: 'Tank Tactics',
  tagline: 'The wall is the second barrel.',
});
