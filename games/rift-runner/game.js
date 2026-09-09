// games/rift-runner/game.js
//
// Rift Runner — an endless runner where the portals change the rules.
//
// THE RULE
// --------
// You always run right. Three verbs: jump, slide, dash. Every so often a rift
// opens on clear ground, and going through it changes the physics — gravity,
// jump height, run speed, or which way is down. Distance is the score.
//
// WHY THE PORTALS ARE THE GAME
// ----------------------------
// A backdrop change is decoration. These change what your jump DOES: five
// tiles of travel in Surface, eight in Drift, three in Forge. The same
// obstacle asks a different question in each, and the obstacle library knows
// which realms it is legal in — see patterns.js.
//
// WHAT IS PROVED RATHER THAN HOPED
// --------------------------------
// Every pattern in the library is provably clearable in every realm it can be
// dealt in. Not "was cleared once" — a breadth-first solver walks the real
// physics and finds a route, and the library refuses to ship one it cannot.
// And because gravity scales with the square of the run speed, a pattern
// authored in tiles stays clearable at any speed, forever.
//
// All of that lives in rift.js and patterns.js, with no DOM attached, and
// tests/rift-runner.rift.test.mjs runs it.
//
// WHAT THIS FILE DOES
// -------------------
// Canvas, input, audio, camera, shell wiring, and five realms' worth of light.
// Not one rule.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticleSystem, clamp, randRange } from '../../engine/util.js';

import { Course } from './patterns.js';
import { GROUND_Y, KIND, TILE, TUNING, WORLD_H, bodyOf } from './rift.js';

const GAME_ID = 'rift-runner';

// Landscape: the whole point is reading what is coming, so the screen is
// mostly the ground you have not reached yet.
const W = 880;
const H = WORLD_H;

// Where the runner sits on screen. Well left, for the same reason.
const RUNNER_X = 250;

// --- Art palette ---------------------------------------------------------
//
// Rift Runner's own colours, deliberately NOT from tokens.css. Five realms
// need five distinct lights, and the tokens are the arcade's chrome; the shell
// still draws pause, game over and the HUD in site tokens straight over the
// top, which is what keeps it recognisably Studio 22.
//
// Grouped by subject per CLAUDE.md. The `realms` map is the point of the whole
// palette: switching realm switches every colour on screen at once, which is
// what makes a rift feel like somewhere else rather than a filter.
const ART = {
  realms: {
    surface: {
      skyTop: '#141a2e', skyLow: '#2b3a5c', far: '#1d2742', near: '#0e1424',
      ground: '#27324f', groundLip: '#5f7bb0', grid: 'rgba(120,160,230,.07)',
      void: '#04060d', accent: '#6ea8ff', glow: 'rgba(110,168,255,.30)',
    },
    drift: {
      skyTop: '#1b1030', skyLow: '#4a2a6e', far: '#2a1a48', near: '#150c26',
      ground: '#33204f', groundLip: '#b98cf0', grid: 'rgba(185,140,240,.08)',
      void: '#0a0512', accent: '#c79bff', glow: 'rgba(199,155,255,.30)',
    },
    forge: {
      skyTop: '#2a1206', skyLow: '#7a2c10', far: '#3d1a09', near: '#1a0b04',
      ground: '#40200e', groundLip: '#ff8b3d', grid: 'rgba(255,140,70,.08)',
      void: '#0d0402', accent: '#ff9d4d', glow: 'rgba(255,140,70,.32)',
    },
    surge: {
      skyTop: '#062024', skyLow: '#0d5a52', far: '#0a3a38', near: '#04161a',
      ground: '#0d3a38', groundLip: '#3ef2c8', grid: 'rgba(62,242,200,.08)',
      void: '#01090a', accent: '#3ef2c8', glow: 'rgba(62,242,200,.28)',
    },
    inverse: {
      skyTop: '#2c0f22', skyLow: '#6e1f45', far: '#3d152e', near: '#1a0813',
      ground: '#3d152e', groundLip: '#ff5f9e', grid: 'rgba(255,95,158,.08)',
      void: '#0d0208', accent: '#ff7fb0', glow: 'rgba(255,95,158,.30)',
    },
  },
  runner: {
    body: '#f6f2e8', bodyEdge: '#12161f', visor: '#1b2436',
    trail: 'rgba(246,242,232,.24)',
    limb: '#f6f2e8', limbEdge: '#12161f', head: '#f6f2e8',
  },
  obstacle: {
    spike: '#ff5a6e', spikeEdge: '#8c1f30',
    bar: '#ffc857', barEdge: '#8a6212',
    riftFill: 'rgba(255,255,255,.10)', riftEdge: '#ffffff',
  },
  gate: { ring: '#ffffff', ringSoft: 'rgba(255,255,255,.22)' },
  hud: {
    label: 'rgba(255,255,255,.55)', metres: '#ffffff',
    dashReady: '#ffffff', dashCold: 'rgba(255,255,255,.22)',
  },
  spark: ['#ffffff', '#cfe3ff', '#8fb6ff'],
};

const paletteFor = (realmId) => ART.realms[realmId] ?? ART.realms.surface;

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 240 });

// Three verbs, three pads. No joystick: there is nothing to steer, and a stick
// sitting on screen doing nothing invites the wrong thumb.
Input.clearTouchLayout();
// No virtual stick: Rift Runner runs by itself. Jump, slide and dash are buttons; there is nothing to steer.
// Without this the shell advertises a joystick in the corner that steers
// nothing, which is worse than no joystick at all.
Input.setDirectionalTouch(false);

Input.setTouchLayout([
  { name: 'a', xRatio: 0.86, yRatio: 0.62, radius: 54, label: 'Jump' },
  { name: 'b', xRatio: 0.86, yRatio: 0.88, radius: 48, label: 'Slide' },
  { name: 'btnX', xRatio: 0.62, yRatio: 0.88, radius: 48, label: 'Dash' },
]);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  jump: { beep: { freq: 420, duration: 0.06, type: 'square', volume: 0.12 } },
  land: { beep: { freq: 180, duration: 0.05, type: 'triangle', volume: 0.09 } },
  slide: { beep: { freq: 150, duration: 0.09, type: 'sawtooth', volume: 0.10 } },
  dash: { beep: { freq: 880, duration: 0.10, type: 'square', volume: 0.16 } },
  gate: { beep: { freq: 660, duration: 0.28, type: 'triangle', volume: 0.22 } },
  crash: { beep: { freq: 90, duration: 0.55, type: 'triangle', volume: 0.28 } },
});

// --- State ---------------------------------------------------------------

let course = new Course();
let running = false;

// Presentation only. The simulation is not allowed to care about any of these.
let shake = 0;
let gateFlash = 0;
let blend = 1;                 // 0..1 crossfade between realm palettes
let fromPalette = paletteFor('surface');
let toPalette = fromPalette;
let bestMetres = 0;

// Trail samples behind the runner, pooled.
const trail = [];
for (let i = 0; i < 26; i++) trail.push({ x: 0, y: 0, life: 0, sliding: false, hot: false });
let trailHead = 0;
// The stride, advanced by DISTANCE rather than by time, so the legs turn over
// faster as the run speeds up instead of moon-walking at 900 px/s.
let stepPhase = 0;

function pushTrail(worldX, y, sliding, phasing) {
  const t = trail[trailHead];
  trailHead = (trailHead + 1) % trail.length;
  t.x = worldX;
  t.y = y;
  t.life = 1;
  t.sliding = sliding;
  // A dash and a rift are the two moments the runner is doing something to the
  // world rather than moving through it, so they are the two the wake shows.
  t.hot = phasing;
}

// Parallax bands, generated once and scrolled.
const bands = [];
for (let i = 0; i < 34; i++) {
  bands.push({
    x: i * 190, w: randRange(90, 230), h: randRange(40, 190), depth: randRange(0.18, 0.5),
  });
}

function reset() {
  course = new Course();
  running = true;
  shake = 0;
  gateFlash = 0;
  blend = 1;
  fromPalette = paletteFor(course.realm.id);
  toPalette = fromPalette;
  particles.clear();
  for (const t of trail) t.life = 0;
}

function crash() {
  if (!running) return;
  running = false;
  shake = 1;
  audio.play('crash');
  const run = course.run;
  particles.explosion(RUNNER_X, run.y - TUNING.bodyH / 2, {
    count: 30, colors: ART.spark, speed: 260,
  });
  shell.showGameOver(course.metres, {
    riftsEntered: course.riftsEntered,
    realm: course.realm.name,
    topSpeed: `${Math.round(run.speed)} px/s`,
    ending: course.reason,
  });
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;

  particles.update(dt);
  if (shake > 0) shake = Math.max(0, shake - dt * 2.4);
  if (gateFlash > 0) gateFlash = Math.max(0, gateFlash - dt * 1.8);
  if (blend < 1) blend = Math.min(1, blend + dt * 2.2);
  for (const t of trail) if (t.life > 0) t.life = Math.max(0, t.life - dt * 2.6);

  if (!running) return;

  // Two strides per ~110px of ground covered.
  if (course.run.grounded && !course.run.sliding) {
    stepPhase += (course.run.speed * dt) / 110 * Math.PI * 2;
  }

  const pad = Input.get();
  const wasGrounded = course.run.grounded;
  const wasPhasing = course.run.phasing;

  // Jump is a press with a hold; slide is a hold; dash is a press.
  const input = {
    jump: Input.pressed('a') || Input.pressed('up'),
    jumpHeld: pad.a || pad.up,
    slide: pad.b || pad.down,
    dash: Input.pressed('btnX') || Input.pressed('rb') || Input.pressed('lb'),
  };

  if (input.jump && wasGrounded) audio.play('jump', { pitchVariance: 0.08 });
  if (input.slide && wasGrounded && !course.run.sliding) audio.play('slide');

  course.step(dt, input);

  const run = course.run;
  if (run.phasing && !wasPhasing) {
    audio.play('dash');
    particles.sparkle(RUNNER_X, run.y - TUNING.bodyH / 2, { count: 10, colors: ART.spark });
  }
  if (run.grounded && !wasGrounded) audio.play('land', { pitchVariance: 0.12 });

  // A rift crossed: swap the palette and say so.
  if (course.justShifted) {
    fromPalette = toPalette;
    toPalette = paletteFor(course.realm.id);
    blend = 0;
    gateFlash = 1;
    audio.play('gate');
    particles.sparkle(RUNNER_X, run.y - TUNING.bodyH / 2, {
      count: 24, colors: [ART.gate.ring, toPalette.accent],
    });
  }

  // The WORLD position, not the screen one. See pushTrail.
  pushTrail(run.x, run.y, run.sliding, run.phasing || gateFlash > 0.3);
  bestMetres = Math.max(bestMetres, course.metres);

  if (!course.running) crash();
}

// --- Draw ----------------------------------------------------------------

/** Blend two hex colours, for the crossfade between realms. */
function mix(a, b, t) {
  if (a === b) return a;
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t);
  const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t);
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * t);
  return `rgb(${r},${g},${bl})`;
}

/** The palette right now, mid-crossfade. */
function palette() {
  const t = blend;
  const out = {};
  for (const key of Object.keys(toPalette)) {
    const from = fromPalette[key];
    const to = toPalette[key];
    out[key] = from?.startsWith('#') && to?.startsWith('#') ? mix(from, to, t) : to;
  }
  return out;
}

const worldToScreen = (x) => x - course.run.x + RUNNER_X;

function drawSky(p) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, p.skyTop);
  g.addColorStop(1, p.skyLow);
  ctx.fillStyle = g;
  // Across the STAGE, not across W: on a screen wider than the game the canvas
  // extends past both edges (see engine/canvas.js) and an unpainted margin is
  // just a black bar the game chose not to fill.
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);

  // Parallax slabs. Depth only, never anything that reads as terrain.
  for (const b of bands) {
    const x = ((b.x - course.run.x * b.depth) % (bands.length * 190) + bands.length * 190)
      % (bands.length * 190) - 200;
    if (x > W + 60 || x < -260) continue;
    ctx.fillStyle = b.depth > 0.34 ? p.far : p.near;
    ctx.fillRect(x, GROUND_Y - b.h, b.w, b.h);
  }
}

function drawGround(p) {
  const flipped = course.realm.flipped;
  const surfaceY = flipped ? TILE * 2 : GROUND_Y;
  const deep = flipped ? 0 : H;

  // The solid, minus the gaps. Drawn from the same obstacle list the
  // collision reads, so what looks like a hole is a hole.
  const gaps = course.run.obstacles.filter((o) => o.kind === KIND.GAP);
  // Clipped to the STAGE, which on a wide screen reaches past both sides of
  // the game's own width. This is the one place in the file where getting that
  // wrong does not merely leave a bar: the void is drawn first so a gap reads
  // as a hole, so ground that stops short reads as a pit the player is about
  // to fall into.
  const far = screen.left - 100;
  const near = screen.right + 100;
  let cursor = far;
  const edges = [];
  for (const o of gaps.sort((a, b) => a.tile - b.tile)) {
    edges.push([cursor, worldToScreen(o.tile * TILE)]);
    cursor = worldToScreen((o.tile + o.tiles) * TILE);
  }
  edges.push([cursor, near]);

  // The void behind everything first, so a gap reads as a HOLE rather than a
  // slightly different shade of floor. Without this the sky gradient shows
  // through, and at the bottom of the screen it is within a few percent of
  // the ground colour — playing it, the gaps were genuinely hard to see.
  ctx.fillStyle = p.void;
  // The GROUND, across the stage: this is the surface the runner runs on,
  // and a floor that stops mid-screen is the clearest possible way to say
  // "the world ends here".
  ctx.fillRect(screen.left, flipped ? 0 : surfaceY, screen.stageWidth,
    flipped ? surfaceY : H - surfaceY);

  for (const [x0, x1] of edges) {
    if (x1 < far || x0 > near) continue;
    const left = Math.max(x0, far);
    const width = Math.min(x1, near) - left;
    ctx.fillStyle = p.ground;
    ctx.fillRect(left, flipped ? deep : surfaceY, width, flipped ? surfaceY : H - surfaceY);
    ctx.fillStyle = p.groundLip;
    ctx.fillRect(left, flipped ? surfaceY - 4 : surfaceY, width, 4);
  }

  // A tile grid on the floor, so speed is readable.
  ctx.strokeStyle = p.grid;
  ctx.lineWidth = 1;
  const first = Math.floor((course.run.x - RUNNER_X) / TILE) * TILE;
  for (let wx = first; wx < first + W + TILE * 2; wx += TILE) {
    const sx = worldToScreen(wx);
    ctx.beginPath();
    ctx.moveTo(sx, flipped ? 0 : surfaceY);
    ctx.lineTo(sx, flipped ? surfaceY : H);
    ctx.stroke();
  }
}

function drawObstacles(p) {
  const flipped = course.realm.flipped;
  const surfaceY = flipped ? TILE * 2 : GROUND_Y;
  const up = flipped ? 1 : -1;

  for (const o of course.run.obstacles) {
    const x = worldToScreen(o.tile * TILE);
    const w = o.tiles * TILE;
    if (x + w < -40 || x > W + 40) continue;

    switch (o.kind) {
      case KIND.SPIKE: {
        // Teeth, one per tile, pointing away from the floor.
        ctx.fillStyle = ART.obstacle.spike;
        for (let i = 0; i < o.tiles; i++) {
          const bx = x + i * TILE;
          ctx.beginPath();
          ctx.moveTo(bx + 3, surfaceY);
          ctx.lineTo(bx + TILE / 2, surfaceY + up * TILE);
          ctx.lineTo(bx + TILE - 3, surfaceY);
          ctx.closePath();
          ctx.fill();
        }
        ctx.strokeStyle = ART.obstacle.spikeEdge;
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case KIND.BAR: {
        const bottom = surfaceY + up * o.clear * TILE;
        const roof = flipped ? H : 0;
        ctx.fillStyle = ART.obstacle.bar;
        ctx.fillRect(x, Math.min(bottom, roof), w, Math.abs(roof - bottom));
        ctx.fillStyle = ART.obstacle.barEdge;
        ctx.fillRect(x, bottom - (flipped ? 0 : 5), w, 5);
        break;
      }
      case KIND.RIFT: {
        // A slab of nothing, edge-lit. Only a dash gets through it.
        const top = flipped ? 0 : TILE;
        ctx.fillStyle = ART.obstacle.riftFill;
        ctx.fillRect(x, top, w, H - TILE * 2);
        ctx.strokeStyle = ART.obstacle.riftEdge;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.75 + Math.sin(course.run.x * 0.04) * 0.2;
        ctx.beginPath();
        ctx.moveTo(x, top); ctx.lineTo(x, top + H - TILE * 2);
        ctx.moveTo(x + w, top); ctx.lineTo(x + w, top + H - TILE * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      default:
        break;
    }
  }

  // The gate the next rift stands in, so the hook is something you see coming.
  if (course.pendingGateTile !== null) {
    const gx = worldToScreen(course.pendingGateTile * TILE);
    if (gx > -120 && gx < W + 120) {
      ctx.strokeStyle = ART.gate.ring;
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(gx, surfaceY + up * 96, 46, 100, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = p.glow;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

/**
 * The runner, as a stick figure.
 *
 * It was a white rectangle with a visor on it, and the four verbs were
 * indistinguishable: a jump was a rectangle higher up, a slide was a shorter
 * rectangle, a dash was a rectangle with a glow. The game asks a player to
 * pick a verb in about a third of a second and gave them no picture of which
 * verb they had picked.
 *
 * A person is legible at a glance where a box is not. Limbs are drawn as
 * capped lines from a small set of joint positions, one set per verb:
 *
 *   run    legs scissor, arms counter-swing, body upright
 *   jump   legs tucked forward, arms thrown up — a shape only jumping makes
 *   slide  body low and horizontal, trailing leg out, arm back
 *   dash   leant hard forward, legs streaming behind, and the glow
 *
 * Everything is drawn inside the collision box the rules use, so the picture
 * never claims more or less room than the runner actually occupies. In the
 * flipped realm the whole figure is mirrored about the box, which is why 'up'
 * is a variable here rather than a minus sign.
 */
function drawRunner(p) {
  const run = course.run;
  const box = bodyOf(run, course.realm, TUNING);
  const x = RUNNER_X - TUNING.bodyW / 2;
  const flipped = course.realm.flipped;

  // The wake. Densest right behind, streaming away to the left as the world
  // scrolls, and taller or flatter depending on what the runner was doing when
  // it was laid down.
  for (const t of trail) {
    if (t.life <= 0) continue;
    const tx = worldToScreen(t.x) - TUNING.bodyW / 2;
    // Off the back of the stage: nothing to draw, and on a wide screen that
    // edge is further out than it used to be.
    if (tx + TUNING.bodyW < screen.left) continue;
    ctx.globalAlpha = t.life * (t.hot ? 0.55 : 0.3);
    ctx.fillStyle = t.hot ? p.accent : ART.runner.trail;
    const h = t.sliding ? TUNING.slideHeight : TUNING.bodyH;
    ctx.fillRect(tx, flipped ? t.y : t.y - h, TUNING.bodyW, h);
  }
  ctx.globalAlpha = 1;

  if (run.phasing) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = p.glow;
    ctx.beginPath();
    ctx.arc(RUNNER_X, box.y + box.h / 2, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Work in a space where +1 is always "toward the runner's head", so the
  // flipped realm needs no second copy of any of this.
  const up = flipped ? 1 : -1;
  const feet = flipped ? box.y : box.y + box.h;
  const cx = RUNNER_X;
  const H = box.h;
  const at = (fx, fh) => [cx + fx, feet + up * fh * H];

  const cycle = stepPhase;
  const swing = Math.sin(cycle);
  const swing2 = Math.sin(cycle + Math.PI);

  let hip, shoulder, head, legA, legB, kneeA, kneeB, armA, armB, lean;

  if (run.sliding) {
    // Low and long: the body is nearly along the ground and the trailing leg
    // is straight out behind, which no other verb looks like.
    lean = 0;
    hip = at(-2, 0.34);
    shoulder = at(-11, 0.52);
    head = at(-17, 0.72);
    kneeA = at(8, 0.30); legA = at(15, 0.06);
    kneeB = at(-9, 0.16); legB = at(-17, 0.05);
    armA = at(4, 0.30);
    armB = at(-19, 0.28);
  } else if (run.phasing) {
    // Leant hard forward with both legs streaming behind.
    lean = 0;
    hip = at(-4, 0.42);
    shoulder = at(7, 0.72);
    head = at(13, 0.92);
    kneeA = at(-14, 0.34); legA = at(-24, 0.18);
    kneeB = at(-11, 0.46); legB = at(-22, 0.40);
    armA = at(15, 0.60);
    armB = at(-8, 0.80);
  } else if (!run.grounded) {
    // Airborne. Rising is a tuck with the arms up; falling reaches for the
    // ground, so the two halves of a jump do not look the same.
    const rising = run.vy * (flipped ? 1 : -1) > 0;
    lean = 0;
    hip = at(-1, 0.44);
    shoulder = at(-3, 0.74);
    head = at(-4, 0.94);
    if (rising) {
      kneeA = at(9, 0.36); legA = at(13, 0.16);
      kneeB = at(-6, 0.30); legB = at(-14, 0.16);
      armA = at(8, 0.92); armB = at(-11, 0.88);
    } else {
      kneeA = at(6, 0.26); legA = at(9, 0.02);
      kneeB = at(-8, 0.28); legB = at(-11, 0.06);
      armA = at(12, 0.62); armB = at(-13, 0.60);
    }
  } else {
    // Running. The legs scissor and the arms counter-swing, which is the whole
    // trick to a stick figure reading as a person rather than as a letter.
    lean = 3;
    hip = at(lean - 1, 0.44);
    shoulder = at(lean + 2, 0.74);
    head = at(lean + 4, 0.94);
    kneeA = at(lean + swing * 8 + 3, 0.26);
    legA = at(lean + swing * 13, 0.02 + Math.max(0, swing) * 0.10);
    kneeB = at(lean + swing2 * 8 + 3, 0.26);
    legB = at(lean + swing2 * 13, 0.02 + Math.max(0, swing2) * 0.10);
    armA = at(lean + swing2 * 11, 0.54);
    armB = at(lean + swing * 11, 0.54);
  }

  const bone = (a, b, c) => {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    if (c) ctx.lineTo(b[0], b[1]);
    ctx.lineTo((c || b)[0], (c || b)[1]);
    ctx.stroke();
  };

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Drawn twice: a dark stroke under a light one, so the figure holds against
  // both the pale Surface ground and the near-black void of a gap.
  for (const pass of [
    { colour: ART.runner.limbEdge, limb: 7.5, spine: 9.5, head: 8.2 },
    { colour: ART.runner.limb, limb: 4, spine: 6, head: 5.6 },
  ]) {
    ctx.strokeStyle = pass.colour;
    ctx.fillStyle = pass.colour;

    ctx.lineWidth = pass.limb;
    bone(hip, kneeB, legB);
    bone(shoulder, armB);

    ctx.lineWidth = pass.spine;
    bone(hip, shoulder);

    ctx.lineWidth = pass.limb;
    bone(hip, kneeA, legA);
    bone(shoulder, armA);

    ctx.beginPath();
    ctx.arc(head[0], head[1], pass.head, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}

function drawHud(p) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  // Anchored to the left edge of the SCREEN, not of the game. See screen.left.
  const hudLeft = screen.left;
  ctx.fillText('METRES', hudLeft + 20, 16);
  ctx.fillStyle = ART.hud.metres;
  ctx.font = '800 30px system-ui, sans-serif';
  ctx.fillText(String(course.metres), hudLeft + 20, 28);

  // Which realm, and therefore which rules.
  ctx.textAlign = 'center';
  ctx.fillStyle = p.accent;
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.fillText(course.realm.name.toUpperCase(), W / 2, 18);
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 9px system-ui, sans-serif';
  ctx.fillText(`RIFT ${course.riftsEntered}`, W / 2, 36);

  // Dash charge. The only resource in the game, so it gets a real readout.
  const ready = course.run.dashCool <= 0;
  ctx.textAlign = 'right';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('DASH', W - 20, 16);
  const barW = 74;
  const cool = course.run.physics.dashCooldown + course.run.physics.dashTime;
  const charge = ready ? 1 : clamp(1 - course.run.dashCool / cool, 0, 1);
  ctx.fillStyle = ART.hud.dashCold;
  ctx.beginPath(); ctx.roundRect(W - 20 - barW, 30, barW, 8, 4); ctx.fill();
  ctx.fillStyle = ready ? ART.hud.dashReady : p.accent;
  ctx.beginPath(); ctx.roundRect(W - 20 - barW, 30, Math.max(3, barW * charge), 8, 4); ctx.fill();
}

function render() {
  const p = palette();

  ctx.save();
  if (shake > 0) ctx.translate(randRange(-1, 1) * shake * 10, randRange(-1, 1) * shake * 10);

  drawSky(p);
  drawGround(p);
  drawObstacles(p);
  if (running || shake > 0.02) drawRunner(p);
  particles.draw(ctx);

  // The white bloom as a rift is crossed.
  if (gateFlash > 0) {
    ctx.globalAlpha = gateFlash * 0.5;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(screen.left, 0, screen.stageWidth, H);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
  drawHud(p);
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
  title: 'Rift Runner',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Jump', gamepad: 'A or up', keyboard: 'Space or Up', touch: 'Jump pad' },
    { action: 'Higher', gamepad: 'Hold it', keyboard: 'Hold it', touch: 'Hold it' },
    { action: 'Slide', gamepad: 'Hold B or down', keyboard: 'Hold Shift or Down', touch: 'Hold Slide' },
    { action: 'Dash', gamepad: 'X or a bumper', keyboard: 'Q or E', touch: 'Dash pad' },
    { action: 'Rift walls', gamepad: 'Only a dash gets through', keyboard: 'Only a dash gets through', touch: 'Only a dash gets through' },
    { action: 'Portals', gamepad: 'Change the rules, not the view', keyboard: 'Change the rules, not the view', touch: 'Change the rules, not the view' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({ name: 'Rift Runner', tagline: 'Every portal changes the rules.' });
