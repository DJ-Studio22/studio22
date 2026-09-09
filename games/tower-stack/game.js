// games/tower-stack/game.js
//
// Tower Stack — one button, one rule, and a mistake you carry for the rest of
// the run.
//
// THE RULE
// --------
// A slab slides across the top of the screen. Press once and it drops. Whatever
// hangs over the edge of the slab below is sheared off and falls away, and what
// is left is the slab you have to land on next time. Errors do not cost you a
// life, they cost you WIDTH, and width is the only resource in the game. A run
// does not end because something hit you; it ends because there is nothing left
// to aim at.
//
// WHY IT IS NOT JUST A SLOW LOSS
// ------------------------------
// If width only ever went down, every run would be the same shape and the
// ending would be arithmetic rather than a decision. So a placement inside a
// few pixels is a PERFECT, and a perfect gives some width back — never more
// than you started with, and less each time the tower gets taller. That single
// rule is what makes the game a balancing act instead of a countdown: you can
// hold a tower together indefinitely if your hands are good enough, and the
// moment they are not, the width starts sliding and you can watch it go.
//
// Chaining perfects also widens the recovery, so the good state is worth
// defending and the bad state is worth climbing out of.
//
// ESCALATION WITHOUT A CEILING
// ----------------------------
// Three things grow with height, all of them smooth and none of them capped:
// the slab moves faster, it starts swaying instead of tracking straight, and
// the recovery from a perfect shrinks. There is no final level. The sky
// changes as you climb, which is the only thing that tells you how far up you
// have got without reading the number.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticleSystem, clamp, lerp, randRange } from '../../engine/util.js';

const GAME_ID = 'tower-stack';

const W = 440;
const H = 760;

// --- The tower -----------------------------------------------------------

const BLOCK_H = 30;
const START_WIDTH = 190;

// Where the top of the tower sits on screen. Everything below scrolls away.
const BUILD_LINE = H * 0.62;

// The slab travels at this height above the top of the tower, which is far
// enough to read its speed and near enough to judge the alignment.
const CARRY_HEIGHT = 190;

// Under this and there is nothing left to land on.
const MIN_WIDTH = 8;

// --- Difficulty ----------------------------------------------------------

const SPEED_BASE = 150;
const SPEED_PER_LEVEL = 5.5;

// Sway starts once the tower is this tall and grows from there. A swaying slab
// does not cross at a constant rate, so the timing stops being a metronome.
const SWAY_FROM = 12;
const SWAY_MAX_AMPLITUDE = 46;

// A perfect gives this much width back, shrinking as the tower grows so the
// recovery never outruns the difficulty.
const PERFECT_TOLERANCE = 5;
const RECOVER_BASE = 13;
const RECOVER_DECAY = 0.965;
const COMBO_RECOVER_BONUS = 3;

// --- Art palette ---------------------------------------------------------
//
// This game's own colours, deliberately NOT from tokens.css: the tokens are
// the arcade's chrome and this is a sky that has to change as you climb
// through it. The shell still draws pause, game over and the HUD in site
// tokens straight over the top, which is what keeps it Studio 22.
//
// Grouped by subject rather than flat, per CLAUDE.md. The `bands` array is the
// point of the whole palette: the sky is interpolated BETWEEN neighbouring
// bands rather than snapped to one, so climbing is a continuous change of
// light rather than a set of rooms.
const ART = {
  bands: [
    { at: 0, top: '#8ed0f0', bottom: '#f7d9a0', ground: '#3c5a3a', name: 'Ground' },
    { at: 22, top: '#5aa0d8', bottom: '#f0b48a', ground: '#2e4a34', name: 'Rooftops' },
    { at: 48, top: '#2b4a8c', bottom: '#e07a6a', ground: '#22303f', name: 'Dusk' },
    { at: 80, top: '#101a3c', bottom: '#4a2a6c', ground: '#141428', name: 'Night' },
    { at: 120, top: '#050a1c', bottom: '#1a3a5c', ground: '#0a0f1e', name: 'Aurora' },
    { at: 175, top: '#01010a', bottom: '#0a0520', ground: '#04040c', name: 'Orbit' },
  ],
  block: {
    // The stack cycles these so consecutive slabs are readable as separate
    // slabs. Indexed by level, not chosen at random: a run should look the
    // same shape every time even though it plays differently.
    faces: ['#ff8a5c', '#ffc857', '#5ef2a0', '#5ec8f2', '#a78bfa', '#ff6b9a'],
    top: 'rgba(255,255,255,.30)',
    side: 'rgba(0,0,0,.28)',
    edge: 'rgba(0,0,0,.35)',
    perfect: '#ffffff',
  },
  slab: {
    shadow: 'rgba(0,0,0,.25)',
    guide: 'rgba(255,255,255,.16)',
  },
  sky: {
    star: 'rgba(255,255,255,.8)',
    cloud: 'rgba(255,255,255,.30)',
    aurora: 'rgba(120,255,200,.13)',
  },
  hud: {
    label: 'rgba(255,255,255,.6)',
    value: '#ffffff',
    combo: '#ffd166',
    widthGood: '#5ef2a0',
    widthLow: '#ff6b6b',
    meterBack: 'rgba(255,255,255,.14)',
    perfectFlash: '#ffffff',
  },
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 220 });

// One button, so one pad — and it says what it does. The joystick is cleared
// too: there is nothing to steer, and a stick sitting on screen doing nothing
// is an invitation to press the wrong thing.
Input.clearTouchLayout();
// No virtual stick: Tower Stack is one button: the block is already moving, and all you do is drop it.
// Without this the shell advertises a joystick in the corner that steers
// nothing, which is worse than no joystick at all.
Input.setDirectionalTouch(false);

Input.setTouchLayout([
  // Bottom right, for the same reason as Gravity Flip -- not reported, but the
  // identical declaration and therefore the identical fault on a wide screen.
  { name: 'a', xRatio: 0.9, yRatio: 0.84, radius: 62, label: 'Drop' },
]);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  drop: { beep: { freq: 240, duration: 0.07, type: 'square', volume: 0.16 } },
  land: { beep: { freq: 180, duration: 0.09, type: 'triangle', volume: 0.18 } },
  perfect: { beep: { freq: 980, duration: 0.11, type: 'square', volume: 0.2 } },
  slice: { beep: { freq: 320, duration: 0.06, type: 'sawtooth', volume: 0.12 } },
  band: { beep: { freq: 620, duration: 0.3, type: 'triangle', volume: 0.18 } },
  over: { beep: { freq: 90, duration: 0.55, type: 'triangle', volume: 0.26 } },
});

// --- State ---------------------------------------------------------------

// Only the slabs near the top are kept. A tower five hundred high does not
// need its foundations in memory, and the camera can never see them.
const VISIBLE_DEPTH = Math.ceil(H / BLOCK_H) + 4;

let stack = [];        // { x, w, level }
let height = 0;        // slabs placed; this is the score
let width = START_WIDTH;
let combo = 0;
let bestCombo = 0;
let perfects = 0;

// The slab in the air.
let slabX = 0;
let slabDir = 1;
let swayPhase = 0;

let cameraY = 0;       // world offset, eased toward the top of the tower
let running = false;
let flash = 0;         // the white pulse on a perfect
let bandIndex = 0;

// Sheared-off pieces, pooled: one is created on most placements, which is
// exactly the "spawned in a loop" case CLAUDE.md asks to pool.
const debris = [];
for (let i = 0; i < 24; i++) {
  debris.push({ active: false, x: 0, y: 0, w: 0, vx: 0, vy: 0, spin: 0, angle: 0, color: '#fff' });
}

const stars = [];
for (let i = 0; i < 80; i++) {
  stars.push({ x: randRange(0, W), y: randRange(-2400, 0), r: randRange(0.6, 1.7) });
}

const clouds = [];
for (let i = 0; i < 10; i++) {
  clouds.push({ x: randRange(0, W), y: randRange(-900, 100), r: randRange(28, 62), o: randRange(0.15, 0.4) });
}

// --- Derived numbers -----------------------------------------------------

const slabSpeed = () => SPEED_BASE + height * SPEED_PER_LEVEL;

function swayAmplitude() {
  if (height < SWAY_FROM) return 0;
  // Approaches the maximum without reaching it, so it keeps growing forever
  // without ever throwing the slab off the screen.
  const over = height - SWAY_FROM;
  return SWAY_MAX_AMPLITUDE * (1 - 1 / (1 + over / 40));
}

function recoverAmount() {
  return RECOVER_BASE * RECOVER_DECAY ** height + combo * COMBO_RECOVER_BONUS;
}

const faceFor = (level) => ART.block.faces[level % ART.block.faces.length];

// World y of the top surface of the slab at `level` (0 is the base slab).
const levelY = (level) => -level * BLOCK_H;

// --- Sky -----------------------------------------------------------------

/**
 * The sky at the current height, interpolated between the two nearest bands.
 *
 * Blending rather than switching is the whole trick. Six discrete skies would
 * read as six backgrounds; a continuous blend reads as one climb.
 */
function skyColours() {
  const bands = ART.bands;
  let i = 0;
  while (i < bands.length - 1 && height >= bands[i + 1].at) i++;

  const from = bands[i];
  const to = bands[Math.min(i + 1, bands.length - 1)];
  const span = Math.max(1, to.at - from.at);
  const t = clamp((height - from.at) / span, 0, 1);

  return { from, to, t, index: i };
}

function mix(a, b, t) {
  // Both inputs are #rrggbb from ART, so a straight channel-wise blend is
  // enough and avoids pulling a colour library in for six gradients.
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `rgb(${r},${g},${bl})`;
}

// --- Placement -----------------------------------------------------------

function throwDebris(x, w, colour) {
  for (const d of debris) {
    if (d.active) continue;
    d.active = true;
    d.x = x;
    d.y = BUILD_LINE - BLOCK_H;
    d.w = w;
    d.vx = randRange(-40, 40) + Math.sign(x - W / 2) * 60;
    d.vy = randRange(-90, -20);
    d.spin = randRange(-4, 4);
    d.angle = 0;
    d.color = colour;
    return;
  }
}

function place() {
  const top = stack[stack.length - 1];

  // Overlap of the falling slab with the one below it. Everything outside the
  // overlap is gone — that is the whole mechanic in two lines.
  const left = Math.max(slabX, top.x);
  const right = Math.min(slabX + width, top.x + top.w);
  const overlap = right - left;

  if (overlap <= MIN_WIDTH) {
    // The slab missed. It falls past the tower and takes the run with it.
    throwDebris(slabX, width, faceFor(height + 1));
    gameOver();
    return;
  }

  const offset = Math.abs(slabX - top.x);
  const perfect = offset <= PERFECT_TOLERANCE;

  if (perfect) {
    perfects++;
    combo++;
    if (combo > bestCombo) bestCombo = combo;
    // Snapped, so a chain of perfects does not drift a pixel at a time into a
    // miss the player cannot see coming.
    slabX = top.x;
    width = Math.min(START_WIDTH, overlap + recoverAmount());
    flash = 1;
    audio.play('perfect', { pitch: 1 + Math.min(combo, 12) * 0.05 });
    particles.sparkle(top.x + top.w / 2, BUILD_LINE, {
      count: 14, colors: [ART.block.perfect, ART.hud.combo],
    });
  } else {
    combo = 0;
    // The overhang is sheared off and thrown clear.
    const overhangW = width - overlap;
    const overhangX = slabX < top.x ? slabX : right;
    throwDebris(overhangX, overhangW, faceFor(height + 1));
    width = overlap;
    slabX = left;
    audio.play('slice');
  }

  stack.push({ x: slabX, w: width, level: height + 1 });
  height++;
  audio.play('land', { pitchVariance: 0.1 });

  if (stack.length > VISIBLE_DEPTH) stack.shift();

  // Crossing into a new sky band is the run's only milestone, so it is worth
  // saying out loud.
  const band = skyColours().index;
  if (band !== bandIndex) {
    bandIndex = band;
    audio.play('band');
  }

  // The next slab starts on the far side from the one just placed, so the
  // approach is always the long way round and never lands the slab on top of
  // its target before the player has had time to read it.
  const centre = slabX + width / 2;
  slabDir = centre > W / 2 ? 1 : -1;
  slabX = slabDir > 0 ? 0 : W - width;
  swayPhase = 0;
}

function gameOver() {
  if (!running) return;
  running = false;
  audio.play('over');
  shell.showGameOver(height, {
    perfects,
    bestCombo,
    finalWidth: `${Math.round(width)} px`,
    reached: skyColours().from.name,
  });
}

function reset() {
  stack = [{ x: (W - START_WIDTH) / 2, w: START_WIDTH, level: 0 }];
  height = 0;
  width = START_WIDTH;
  combo = 0;
  bestCombo = 0;
  perfects = 0;
  flash = 0;
  bandIndex = 0;
  cameraY = 0;
  running = true;

  slabDir = 1;
  slabX = 0;
  swayPhase = 0;

  particles.clear();
  for (const d of debris) d.active = false;
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;

  // Debris keeps falling after the run ends, so the last mistake finishes
  // playing out behind the game over panel rather than freezing mid-air.
  for (const d of debris) {
    if (!d.active) continue;
    d.vy += 900 * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.angle += d.spin * dt;
    if (d.y > H + 120) d.active = false;
  }
  particles.update(dt);
  if (flash > 0) flash = Math.max(0, flash - dt * 3);

  if (!running) return;

  // The slab tracks across, bouncing off the edges, plus a sway that grows
  // with height. The sway is added to the position rather than replacing it,
  // so the slab still crosses the screen — it just stops being predictable.
  slabX += slabDir * slabSpeed() * dt;
  swayPhase += dt * 2.4;

  const amplitude = swayAmplitude();
  const sway = amplitude === 0 ? 0 : Math.sin(swayPhase) * amplitude;

  const leftLimit = 0;
  const rightLimit = W - width;
  if (slabX + sway < leftLimit) { slabX = leftLimit - sway; slabDir = 1; }
  if (slabX + sway > rightLimit) { slabX = rightLimit - sway; slabDir = -1; }

  if (Input.pressed('a')) {
    audio.play('drop');
    place();
  }

  // The camera eases up to keep the top of the tower on the build line.
  const wantY = height * BLOCK_H;
  cameraY += (wantY - cameraY) * clamp(9 * dt, 0, 1);
}

// The slab's drawn position: its travel plus the sway.
function slabDrawX() {
  const amplitude = swayAmplitude();
  return slabX + (amplitude === 0 ? 0 : Math.sin(swayPhase) * amplitude);
}

// --- Draw ----------------------------------------------------------------

function drawSky() {
  const { from, to, t } = skyColours();

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, mix(from.top, to.top, t));
  g.addColorStop(1, mix(from.bottom, to.bottom, t));
  ctx.fillStyle = g;
  // Across the STAGE, not across W: on a screen wider than the game the canvas
  // extends past both edges (see engine/canvas.js) and an unpainted margin is
  // just a black bar the game chose not to fill.
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);

  // Stars fade in as the sky darkens; clouds fade out. Both are driven off the
  // same blend, so nothing has to be scheduled.
  const nightness = clamp((height - 40) / 60, 0, 1);
  if (nightness > 0) {
    ctx.fillStyle = ART.sky.star;
    for (const s of stars) {
      const y = ((s.y + cameraY * 0.25) % 2400 + 2400) % 2400 - 1600;
      if (y < -10 || y > H) continue;
      ctx.globalAlpha = nightness * 0.9;
      ctx.fillRect(s.x, y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  if (nightness > 0.6) {
    ctx.fillStyle = ART.sky.aurora;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(W * (0.25 + i * 0.25), 140 + i * 40, 150, 34, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const cloudiness = 1 - clamp((height - 10) / 50, 0, 1);
  if (cloudiness > 0) {
    for (const c of clouds) {
      const y = ((c.y + cameraY * 0.5) % 1000 + 1000) % 1000 - 200;
      if (y < -80 || y > H + 80) continue;
      ctx.globalAlpha = c.o * cloudiness;
      ctx.fillStyle = ART.sky.cloud;
      ctx.beginPath();
      ctx.arc(c.x, y, c.r, 0, Math.PI * 2);
      ctx.arc(c.x + c.r * 0.7, y + 6, c.r * 0.66, 0, Math.PI * 2);
      ctx.arc(c.x - c.r * 0.7, y + 8, c.r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // The ground, which drops away as the tower grows and then never comes back.
  const groundY = BUILD_LINE + cameraY;
  if (groundY < H + 40) {
    ctx.fillStyle = mix(from.ground, to.ground, t);
    ctx.fillRect(screen.left, groundY, screen.stageWidth, H - groundY + 40);
  }
}

function drawSlab(x, y, w, colour, { highlight = false } = {}) {
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w, BLOCK_H);

  // A light top face and a dark bottom edge: enough to read as a solid slab
  // without drawing an isometric box for every one of them.
  ctx.fillStyle = ART.block.top;
  ctx.fillRect(x, y, w, 5);
  ctx.fillStyle = ART.block.side;
  ctx.fillRect(x, y + BLOCK_H - 5, w, 5);
  ctx.strokeStyle = ART.block.edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, BLOCK_H - 1);

  if (highlight) {
    ctx.fillStyle = `rgba(255,255,255,${0.7 * flash})`;
    ctx.fillRect(x, y, w, BLOCK_H);
  }
}

// `alpha` is unused. The camera translates the whole tower on the tick a slab
// lands, and interpolating across that tick would tear the stack apart.
function render() {
  drawSky();

  // The stack. Drawn from the world position of each level, shifted by the
  // eased camera, so the tower slides rather than jumping a slab at a time.
  for (const block of stack) {
    const y = BUILD_LINE + levelY(block.level) + cameraY;
    if (y > H + BLOCK_H || y < -BLOCK_H) continue;
    drawSlab(block.x, y, block.w, faceFor(block.level),
      { highlight: flash > 0 && block.level === height });
  }

  if (running) {
    const x = slabDrawX();
    const y = BUILD_LINE + levelY(height + 1) + cameraY - CARRY_HEIGHT + BLOCK_H;

    // A guide line down to the landing zone. Without it the alignment has to
    // be eyeballed across two hundred pixels of sky, which is a different and
    // much worse game.
    const top = stack[stack.length - 1];
    ctx.strokeStyle = ART.slab.guide;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(top.x, y + BLOCK_H);
    ctx.lineTo(top.x, BUILD_LINE + levelY(height) + cameraY);
    ctx.moveTo(top.x + top.w, y + BLOCK_H);
    ctx.lineTo(top.x + top.w, BUILD_LINE + levelY(height) + cameraY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = ART.slab.shadow;
    ctx.fillRect(x, BUILD_LINE + levelY(height) + cameraY - 3, width, 3);

    drawSlab(x, y, width, faceFor(height + 1));
  }

  for (const d of debris) {
    if (!d.active) continue;
    ctx.save();
    ctx.translate(d.x + d.w / 2, d.y + BLOCK_H / 2);
    ctx.rotate(d.angle);
    ctx.fillStyle = d.color;
    ctx.fillRect(-d.w / 2, -BLOCK_H / 2, d.w, BLOCK_H);
    ctx.restore();
  }

  particles.draw(ctx);

  shell.drawHud({ score: height, best: Session.getBest(GAME_ID) });
  drawHudExtras();
  shell.render();
}

function drawHudExtras() {
  // The width meter IS the life bar, so it is the one thing on screen that has
  // to be readable without looking away from the slab.
  const barW = 150;
  const x = W - barW - 20;
  const y = 24;
  const fraction = clamp(width / START_WIDTH, 0, 1);

  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('WIDTH', W - 20, y - 3);

  ctx.fillStyle = ART.hud.meterBack;
  ctx.beginPath();
  ctx.roundRect(x, y, barW, 8, 4);
  ctx.fill();
  ctx.fillStyle = fraction < 0.25 ? ART.hud.widthLow : ART.hud.widthGood;
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(3, barW * fraction), 8, 4);
  ctx.fill();

  if (combo > 1) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ART.hud.combo;
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.fillText(`PERFECT x${combo}`, W / 2, 90);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText(skyColours().from.name.toUpperCase(), W / 2, H - 16);
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
  title: 'Tower Stack',
  canvas: screen,
  loop,
  audio,
  // Music: the drop is judged by eye, not by ear.
  // Nothing is fetched unless sound is on and a run actually starts.
  music: true,
  onRestart: reset,
  controls: [
    { action: 'Drop', gamepad: 'A', keyboard: 'Space', touch: 'Drop pad' },
    { action: 'Overhang', gamepad: 'Is sheared off', keyboard: 'Is sheared off', touch: 'Is sheared off' },
    { action: 'Perfect', gamepad: 'Land within a few pixels', keyboard: 'Land within a few pixels', touch: 'Land within a few pixels' },
    { action: 'A perfect', gamepad: 'Gives width back', keyboard: 'Gives width back', touch: 'Gives width back' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({ name: 'Tower Stack', tagline: 'Every miss makes the next one harder.' });
