// games/sinkhole/game.js
//
// Sinkhole — a climbing game upside down.
//
// The ground keeps rising. You fall through gaps in it to stay ahead, and if
// you cannot find a gap the ledge you are standing on carries you up into the
// spikes. Hesitating is what kills you, which is the whole design: there is
// no safe place to stand and think, because standing still is what the game
// punishes.
//
// UNITS: seconds, per the engine doctrine. Nothing here was ported from a
// per-frame prototype, so every constant below is already units-per-second or
// units-per-second-squared.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { Descent, PHYSICS, isSafeLanding, isSpikeAt, ledgeSegments, SHAFT_TUNING } from './shaft.js';
import { ParticleSystem, randRange as R, clamp } from '../../engine/util.js';

const GAME_ID = 'sinkhole';

// Portrait: the whole game is a vertical column, and a wide canvas would be
// mostly empty wall on either side.
const W = PHYSICS.width;
const H = PHYSICS.height;
const TAU = Math.PI * 2;

// --- Art palette ---------------------------------------------------------
//
// This game's own colours, kept in one place rather than scattered through
// the draw calls. Deliberately NOT from tokens.css: those tokens are the
// site's chrome.
//
// Underground: warm earth and lamplight rather than Comet's cold void or
// Updraft's night sky. The three games are all dark and all have to read as
// different rooms.
const ART = {
  rockTop: '#231a14',
  rockBottom: '#3d2a1c',
  wall: '#1a120d',
  dust: 'rgba(255,214,150,.05)',

  ledge: '#8a6234',
  ledgeTop: '#c08d4e',
  ledgeSpiked: '#7a3b30',
  ledgeSpikedTop: '#b0563f',
  spike: '#e0e0e0',
  spikeShade: '#9a9a9a',

  ceiling: '#2a1410',
  ceilingSpike: '#d8d2c4',
  ceilingWarn: 'rgba(220,80,60,.28)',

  player: '#ffd166',
  playerEdge: '#c98f24',
  playerEye: '#231a14',
  playerHurt: '#ff6b6b',

  lamp: 'rgba(255,196,110,.10)',
  depthText: 'rgba(255,214,150,.55)',

  puffRock: '#8a6234',
  puffHurt: '#ff6b6b',
  puffDive: 'rgba(255,209,102,.7)',
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 220 });

// One pad, named for what it does. Steering is the virtual stick on the left
// half, which engine/input.js provides without a layout.
Input.setTouchLayout([
  { name: 'a', xRatio: 0.86, yRatio: 0.80, radius: 50, label: 'Dive' },
]);

// Depth is a distance and more is better — stated rather than assumed,
// because Circuit Racer in the same suite ranks the other way.
Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  land: { beep: { freq: 220, duration: 0.05, type: 'square', volume: 0.12 } },
  drop: { beep: { freq: 520, duration: 0.06, type: 'triangle', volume: 0.1 } },
  dive: { beep: { freq: 300, duration: 0.12, type: 'sawtooth', volume: 0.12 } },
  hurt: { beep: { freq: 150, duration: 0.28, type: 'sawtooth', volume: 0.22 } },
  death: { beep: { freq: 90, duration: 0.5, type: 'triangle', volume: 0.26 } },
});

// --- Tuning --------------------------------------------------------------


const PLAYER_R = PHYSICS.playerRadius;

// Thick enough to be the shelf engine/shell.js draws its HUD on. A thin
// ceiling put the score on top of the spikes, where it was unreadable — and
// the slab reads as the roof of the cave rather than as padding.
// Where the ceiling STARTS. It does not stay there: see chaseCeiling in
// shaft.js. Kept as the starting value and as the thickness of the slab the
// HUD is drawn on.
const CEILING_H = PHYSICS.ceilingHeight;
const LEDGE_H = PHYSICS.ledgeHeight;



// --- The camera ---------------------------------------------------------
//
// A dive reaches 1150 units/sec while the shaft rises at 235 at its very
// fastest, so a diving player pulls away from the world downwards. With the
// view nailed to the shaft that meant falling straight off the bottom of the
// canvas -- and, worse, out of the region ledges are generated in, so there
// was no floor left to land on and no way back.
//
// The camera follows DOWNWARD ONLY. Clamped at zero on top, so whenever the
// player is anywhere near the ceiling the view is exactly what it always
// was: the ceiling in frame, the spikes visible, the crush legible. It only
// moves when the player has bought themselves room, which is the moment they
// need to see what is underneath them instead.
// The least room ever left between the top of the view and the player. The
// ceiling is clamped into the view (see chaseCeiling), so this is in effect the
// closest the spikes are ever held while the player is running -- and therefore
// the real "max lead" of the game, in the units the player experiences it in.

// --- State ---------------------------------------------------------------

// THE RUN. Every rule lives in shaft.js; this file holds a reference to it and
// draws it. Reassigned by reset() rather than mutated, so there is never a
// half-restarted world.
let run = new Descent();

// Presentation only. A squash when the feet land and a shake when something
// hurts -- neither decides anything, and neither belongs in the rules.
let shake = 0;
const P = { squash: 0 };

// Wall texture, generated once. Regenerating it per frame would be the
// single most expensive thing in the game for no visual gain.
const grit = [];
for (let i = 0; i < 90; i++) {
  grit.push({ x: R(0, W), y: R(0, H), r: R(1, 3.4), a: R(0.02, 0.09) });
}

const SKY = (() => {
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, ART.rockTop);
  gradient.addColorStop(1, ART.rockBottom);
  return gradient;
})();

// --- Level ---------------------------------------------------------------

function reset() {
  run = new Descent();
  shake = 0;
  P.squash = 0;
  particles.clear();
}

// --- Update --------------------------------------------------------------
//
// THE SIMULATION IS NOT IN THIS FILE ANY MORE.
//
// Every rule -- the player, the ledges, the ceiling, and the camera, which
// became a rule the moment the spikes were clamped to the top of the view --
// lives in shaft.js, with no canvas anywhere near it. This file reads that
// state and draws it, and reacts to it with sound and particles.
//
// That split is what let a bot play Sinkhole for the first time. It is also
// the reason the same fault shipped three times before: with the physics
// tangled up in a canvas there was nothing any test could drive, so "the
// spikes leave the top of the screen" could only ever be found by a person
// noticing.

function update(dt) {
  if (!shell.update()) return;
  if (run.dead) return;

  const pad = Input.get();
  const before = { hits: run.hits, onGround: run.onGround, dead: run.dead };

  run.step(dt, { x: pad.x, dive: pad.a || pad.rt || pad.b });

  // --- Everything below is presentation reacting to what the rules did ---

  if (run.onGround && !before.onGround) {
    if (P.squash <= 0) audio.play('land');
    P.squash = 1;
  }

  if (run.hits > before.hits) {
    shake = 1;
    audio.play(run.dead ? 'death' : 'hurt');
    particles.emit(run.x, run.y, {
      count: 20, colors: [ART.puffHurt], speed: [80, 300], life: [0.3, 0.7],
      size: [3, 3], gravity: 300, drag: 0.9, shape: 'circle', shrink: true,
    });
  }

  if (run.dead && !before.dead) {
    shell.showGameOver(run.metres, {
      depthReached: `${run.metres} m`,
      fallSpeed: `${Math.round(run.scrollSpeed)} u/s`,
    });
  }

  // The dive plume, which is the only thing on screen that says the player is
  // going faster than gravity would take them.
  const diving = pad.a || pad.rt || pad.b;
  if (diving && run.vy > 300 && Math.random() < dt * 30) {
    particles.emit(run.x, run.y - PLAYER_R, {
      count: 1, colors: [ART.puffDive], speed: [10, 60], life: [0.15, 0.35],
      size: [2, 3], shape: 'circle', shrink: true,
    });
  }

  // Particles live in world space and the world rises under them.
  particles.shift(0, -run.scrollSpeed * dt);

  if (shake > 0) shake = Math.max(0, shake - dt * 24);
  if (P.squash > 0) P.squash = Math.max(0, P.squash - dt * 5);
  particles.update(dt);
}

function render() {
  ctx.save();
  if (shake > 0.02) ctx.translate(R(-shake * 6, shake * 6), R(-shake * 6, shake * 6));

  // From the stage edge: the overdraw is for the shake, the stage is for a
  // screen wider than the game.
  ctx.fillStyle = SKY;
  ctx.fillRect(screen.left - 20, -20, screen.stageWidth + 40, H + 40);

  for (const speck of grit) {
    ctx.globalAlpha = speck.a;
    ctx.fillStyle = ART.dust;
    ctx.beginPath();
    ctx.arc(speck.x, speck.y, speck.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Everything from here down is in SHAFT coordinates -- the frame the
  // run.ledges, the player and the ceiling all share. The wall and its grit stay
  // outside it: they are the backdrop, and scrolling them would turn a
  // camera move into the whole world sliding.
  ctx.save();
  ctx.translate(0, -run.camY);

  // A lamp glow around the player, so the eye goes to the thing it controls.
  const lamp = ctx.createRadialGradient(run.x, run.y, 10, run.x, run.y, 210);
  lamp.addColorStop(0, ART.lamp);
  lamp.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = lamp;
  ctx.fillRect(screen.left, run.camY, screen.stageWidth, H);

  for (const ledge of run.ledges) {
    // Cull what the camera has left behind. Ledges above the ceiling are
    // deleted, but ones between the ceiling and the top of a moved view are
    // still live -- the player can be carried back up to them.
    if (ledge.y < run.camY - LEDGE_H * 2) continue;
    if (ledge.y > run.camY + H) continue;
    drawLedge(ledge);
  }
  drawCeiling();
  particles.draw(ctx);
  drawPlayer();

  ctx.restore();
  ctx.restore();

  drawCeilingMarker();
  drawDepth();

  shell.drawHud({
    score: Math.floor(run.depth / 10),
    best: Session.getBest(GAME_ID),
    lives: run.lives,
  });

  shell.render();
}

function drawLedge(ledge) {
  // The runs come from shaft.js so the picture cannot disagree with the
  // collision: a stretch drawn as plain shelf IS a stretch you can land on.
  for (const segment of ledgeSegments(ledge, SHAFT_TUNING)) {
    const { x, w: width } = segment;
    if (width <= 0) continue;
    const body = segment.spiked ? ART.ledgeSpiked : ART.ledge;
    const top = segment.spiked ? ART.ledgeSpikedTop : ART.ledgeTop;
    ctx.fillStyle = body;
    ctx.fillRect(x, ledge.y, width, LEDGE_H);
    ctx.fillStyle = top;
    ctx.fillRect(x, ledge.y, width, 4);

    // Spikes are drawn as actual spikes rather than signalled by colour
    // alone: the difference between a ledge you can stand on and one that
    // hurts has to survive a player who cannot separate the two hues.
    if (segment.spiked) {
      ctx.fillStyle = ART.spike;
      const step = 14;
      for (let sx = x + 3; sx < x + width - 3; sx += step) {
        ctx.beginPath();
        ctx.moveTo(sx, ledge.y);
        ctx.lineTo(sx + step / 2, ledge.y - 9);
        ctx.lineTo(sx + step, ledge.y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = ART.spikeShade;
      ctx.fillRect(x, ledge.y + LEDGE_H - 3, width, 3);
    }
  }
}

function drawCeiling() {
  ctx.fillStyle = ART.ceiling;
  ctx.fillRect(screen.left, 0, screen.stageWidth, run.ceilingY);

  ctx.fillStyle = ART.ceilingSpike;
  const step = 24;
  for (let x = screen.left; x < screen.right; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, run.ceilingY);
    ctx.lineTo(x + step / 2, run.ceilingY + 16);
    ctx.lineTo(x + step, run.ceilingY);
    ctx.closePath();
    ctx.fill();
  }

  // A warning wash that grows as the player nears the spikes, so the danger
  // is legible before it is fatal.
  const nearness = clamp(1 - (run.y - run.ceilingY) / 220, 0, 1);
  if (nearness > 0) {
    ctx.globalAlpha = nearness;
    ctx.fillStyle = ART.ceilingWarn;
    ctx.fillRect(screen.left, run.ceilingY, screen.stageWidth, 150);
    ctx.globalAlpha = 1;
  }
}

function drawPlayer() {
  // Blink through the grace period, the arcade shorthand for "you cannot be
  // hit right now".
  if (run.invuln > 0 && Math.floor(run.invuln * 12) % 2 !== 0) return;

  const squash = 1 - P.squash * 0.28;
  ctx.save();
  ctx.translate(run.x, run.y);
  ctx.scale(1 + P.squash * 0.22, squash);

  ctx.fillStyle = run.invuln > 0 ? ART.playerHurt : ART.player;
  ctx.beginPath();
  ctx.arc(0, 0, PLAYER_R, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = ART.playerEdge;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Eyes look the way you are moving, which is the cheapest possible way to
  // make a circle read as a creature.
  const look = clamp(run.vx / PHYSICS.maxMove, -1, 1) * 4;
  ctx.fillStyle = ART.playerEye;
  ctx.beginPath();
  ctx.arc(-4 + look, -3, 2.6, 0, TAU);
  ctx.arc(4 + look, -3, 2.6, 0, TAU);
  ctx.fill();

  ctx.restore();
}

/**
 * The ceiling, when the camera has left it behind.
 *
 * Once the view drops far enough the spikes are off the top of the screen,
 * and a threat you cannot see is a threat you cannot plan around. This draws
 * the same spike silhouette hard against the top edge, with how far up the
 * real one is -- so the shape says WHAT is up there and the number says how
 * much room is left. It fades in as the ceiling leaves rather than appearing
 * abruptly, so the two never both read as the ceiling at once.
 */
function drawCeilingMarker() {
  const ceilingOnScreen = run.ceilingY - run.camY;
  const hidden = clamp(-ceilingOnScreen / 40, 0, 1);
  if (hidden <= 0) return;

  const clearance = Math.max(0, Math.round(run.y - PLAYER_R - run.ceilingY));

  ctx.save();
  ctx.globalAlpha = hidden;

  ctx.fillStyle = ART.ceiling;
  ctx.fillRect(screen.left, 0, screen.stageWidth, 18);

  // Half the height of the real spikes and in the shaded tone, so this
  // never reads as the ceiling actually being at the top of the screen.
  // It is a sign saying which way the danger is, not the danger.
  ctx.fillStyle = ART.spikeShade;
  const step = 24;
  for (let x = screen.left; x < screen.right; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 18);
    ctx.lineTo(x + step / 2, 26);
    ctx.lineTo(x + step, 18);
    ctx.closePath();
    ctx.fill();
  }

  // Centred: the shell puts the score top-left and the run.lives top-right, and
  // the distance landed underneath the run.lives.
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillStyle = ART.ceilingSpike;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(clearance) + ' to the spikes', W / 2, 9);
  ctx.restore();
}

function drawDepth() {
  ctx.save();
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillStyle = ART.depthText;
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.floor(run.depth / 10)} m down`, W / 2, H - 22);
  ctx.restore();
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
  title: 'Sinkhole',
  canvas: screen,
  loop,
  audio,
  // Music: the pressure is the rising floor, which you watch rather than hear.
  // Nothing is fetched unless sound is on and a run actually starts.
  music: true,
  onRestart: reset,
  controls: [
    { action: 'Move', gamepad: 'Left stick or D-pad', keyboard: 'Arrows or A / D', touch: 'Drag the left side' },
    { action: 'Dive', gamepad: 'A or RT', keyboard: 'Space', touch: 'Dive button' },
    { action: 'Stay alive', gamepad: 'Do not get pushed into the spikes', keyboard: 'Do not get pushed into the spikes', touch: 'Do not get pushed into the spikes' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({ name: 'Sinkhole', tagline: "Keep falling. Don't get caught." });
