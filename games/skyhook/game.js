// games/skyhook/game.js
//
// Skyhook — a grappling hook, a skyline, and nothing under you.
//
// MOMENTUM IS THE GAME
// --------------------
// There is no run button and no throttle. Every unit of speed you have was
// either given to you by gravity or earned by pumping a swing, and the only
// way forward is to spend it well. So the physics had to be the honest kind:
//
//   - While the hook is attached the player is a pendulum on a rigid rope.
//     The constraint is solved by projecting the position back onto the circle
//     and removing the radial part of the velocity, which is the cheapest
//     stable way to do it and, more importantly, the one that CONSERVES the
//     tangential speed. A spring would wobble and bleed energy; a rope does
//     not, and the whole feel of the game is in that difference.
//
//   - Reeling in shortens the rope while you are moving. That is real: pulling
//     yourself toward the pivot does work against the swing and speeds it up,
//     exactly the way a child pumps a playground swing. It is modelled by
//     preserving angular momentum when the length changes, so the speed-up
//     comes out of the maths rather than out of a bonus.
//
//   - Letting go keeps the velocity you had. Release at the bottom of the arc
//     and you go fast and flat; release late and you go high and slow. Timing
//     the release IS the skill, and nothing in the code softens it.
//
// WHY SWING WELL RATHER THAN SAFELY
// ---------------------------------
// A short, timid swing under a nearby mast will get you across the next gap.
// It will not get you through the ring hanging above it, and it will not carry
// you to the tall masts, which are the only anchors long enough to cross the
// gaps further out. The rings are worth distance — the same unit the score is
// in — and they climb faster than the roofs do. Playing safe is a slow way to
// lose rather than a way to survive.
//
// The simulation — rope, body, city, rings, collisions — is in swing.js, with
// no canvas or input device in it, so the difficulty can be driven by a bot a
// thousand runs at a time rather than argued about. The city generator it
// draws on is in city.js. This file is the parts that touch a screen.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticleSystem, clamp, randRange } from '../../engine/util.js';
import { anchorOf, difficultyAt } from './city.js';
import { HOOK, Swing } from './swing.js';

const GAME_ID = 'skyhook';

const W = 900;
const H = 520;

// Every number the feel of this game lives in is TUNING in swing.js. Nothing
// here may hold a copy of one: two sets of physics constants is exactly the
// drift that a separate simulation file exists to prevent.

// --- Art palette ---------------------------------------------------------
//
// This game's own colours, deliberately NOT from tokens.css. The site palette
// is the warm charcoal of the arcade; this is a city at last light seen from
// above it, and it needs its own sky. The shell draws its pause, game over and
// HUD in site tokens over the top, which is what keeps it Studio 22.
//
// Grouped by subject rather than flat, per CLAUDE.md — a sky, a skyline, a
// rope and a readout are four subjects and one bag would name them badly.
const ART = {
  sky: {
    top: '#151033',
    mid: '#4a2a5c',
    low: '#c05a5a',
    horizon: '#f5a15c',
    sun: 'rgba(255,220,150,.30)',
    star: 'rgba(255,240,220,.7)',
  },
  far: {
    block: '#2a1f45',
    haze: 'rgba(255,160,120,.10)',
  },
  mid: {
    block: '#1d1637',
    edge: '#33285c',
  },
  tower: {
    face: '#100c22',
    faceLit: '#161030',
    roof: '#2b2050',
    edge: '#453a75',
    window: 'rgba(255,196,120,.85)',
    windowCool: 'rgba(150,210,255,.6)',
    mast: '#5a4a8c',
    mastTip: '#ffd166',
    mastGlow: 'rgba(255,209,102,.25)',
  },
  hero: {
    body: '#ffd166',
    bodyDive: '#fff3c4',
    cloak: '#ff5f7e',
    head: '#ffe9c4',
    rope: '#ffffff',
    hook: '#9ef2ff',
    trail: 'rgba(255,209,102,.5)',
  },
  ring: {
    outer: '#5ef2c0',
    inner: 'rgba(94,242,192,.16)',
    taken: 'rgba(94,242,192,.35)',
    missed: 'rgba(255,95,126,.4)',
  },
  hud: {
    label: 'rgba(255,255,255,.55)',
    value: '#ffffff',
    combo: '#5ef2c0',
    speed: '#9ef2ff',
    meterBack: 'rgba(255,255,255,.12)',
    warn: '#ff5f7e',
    target: 'rgba(158,242,255,.55)',
  },
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 260 });

Input.setTouchLayout([
  { name: 'a', xRatio: 0.90, yRatio: 0.80, radius: 54, label: 'Hook' },
  { name: 'b', xRatio: 0.72, yRatio: 0.90, radius: 42, label: 'Dive' },
]);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  fire: { beep: { freq: 620, duration: 0.05, type: 'square', volume: 0.1 } },
  attach: { beep: { freq: 880, duration: 0.07, type: 'square', volume: 0.14 } },
  release: { beep: { freq: 440, duration: 0.06, type: 'triangle', volume: 0.11 } },
  reel: { beep: { freq: 300, duration: 0.04, type: 'sawtooth', volume: 0.06 } },
  ring: { beep: { freq: 1040, duration: 0.12, type: 'square', volume: 0.18 } },
  dive: { beep: { freq: 200, duration: 0.1, type: 'sawtooth', volume: 0.1 } },
  crash: { beep: { freq: 100, duration: 0.45, type: 'sawtooth', volume: 0.3 } },
  fall: { beep: { freq: 130, duration: 0.6, type: 'triangle', volume: 0.26 } },
});

// --- State ---------------------------------------------------------------

// The whole simulation. Everything the game knows about where the player is,
// what the rope is doing and how far they have got lives in here.
const swing = new Swing();

let camX = 0;
let camY = 0;
let shakeTime = 0;

const stars = [];
for (let i = 0; i < 90; i++) {
  stars.push({ x: randRange(0, W * 3), y: randRange(0, H * 0.6), r: randRange(0.5, 1.5) });
}

// --- Reactions to the simulation -----------------------------------------
//
// swing.step() reports what happened; this is the only place that turns those
// into sound, particles and the game over screen.

function handleEvents() {
  for (const event of swing.drainEvents()) {
    switch (event.type) {
      case 'fired':
        audio.play('fire');
        break;
      case 'fireMissed':
        // Nothing in reach. Said out loud, quietly, because a hook fired at
        // nothing used to be completely silent and read as a dropped input.
        audio.play('fire', { pitch: 0.5, volume: 0.5 });
        break;
      case 'attached':
        audio.play('attach');
        break;
      case 'released':
        audio.play('release');
        break;
      case 'reeling':
        // Thinned out: the event fires every step the rope is shortening.
        if (Math.random() < 0.25) audio.play('reel', { pitchVariance: 0.3 });
        break;
      case 'ring':
        audio.play('ring', { pitch: 1 + event.combo * 0.07 });
        particles.sparkle(event.ring.x, event.ring.y, {
          count: 16, colors: [ART.ring.outer, ART.hero.body],
        });
        break;
      case 'died':
        onDied(event.reason);
        break;
      default:
        break;
    }
  }
}

function onDied(reason) {
  shakeTime = 0.4;
  audio.play(reason === 'Fell' ? 'fall' : 'crash');
  particles.explosion(swing.hero.x, swing.hero.y, {
    count: 26,
    colors: [ART.hero.body, ART.hero.cloak, ART.hero.trail],
  });
  shell.showGameOver(swing.metres, {
    ended: reason,
    rings: `${swing.ringsTaken} taken, ${swing.ringsMissed} missed`,
    bestCombo: swing.bestCombo,
    swings: swing.swings,
    topSpeed: `${Math.round(swing.topSpeed / 10)} m/s`,
  });
}

// --- Reset ---------------------------------------------------------------

function reset() {
  swing.reset();
  particles.clear();
  shakeTime = 0;

  camX = swing.hero.x - W * 0.32;
  camY = swing.hero.y - H * 0.5;
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;
  if (!swing.running) return;

  const stick = Input.get(0);

  swing.step(dt, {
    firePressed: Input.pressed('a'),
    dive: Boolean(stick.b),
    // Up on the stick reels in, down reels out.
    reel: stick.y < -0.35 ? -1 : stick.y > 0.35 ? 1 : 0,
    // Left and right lean into the arc. Same axis on a gamepad stick, the
    // arrow keys and the touch joystick, so all three pump the same way.
    lean: Math.abs(stick.x) > 0.2 ? stick.x : 0,
  });
  handleEvents();

  // Dive trail. Driven off the simulation's own answer to "is this a dive",
  // so the effect cannot disagree with the physics.
  if (swing.diving && Math.random() < 0.4) {
    particles.emit(swing.hero.x, swing.hero.y, {
      count: 1, colors: [ART.hero.trail],
      speed: [10, 50], life: [0.15, 0.35], size: [2, 4],
      gravity: 0, drag: 0.6, shrink: true,
    });
  }

  // --- Camera -----------------------------------------------------------
  //
  // Chases rather than snaps, and looks further ahead the faster you go, which
  // is what makes a fast run readable instead of a blur of walls arriving.
  const hero = swing.hero;
  const lookAhead = clamp(hero.vx * 0.22, -60, 260);
  const wantX = hero.x - W * 0.32 + lookAhead;
  const wantY = clamp(hero.y - H * 0.55, -260, 420);
  camX += (wantX - camX) * clamp(6 * dt, 0, 1);
  camY += (wantY - camY) * clamp(4 * dt, 0, 1);

  if (shakeTime > 0) shakeTime = Math.max(0, shakeTime - dt);
  particles.update(dt);
}

// --- Draw ----------------------------------------------------------------

const SKY = (() => {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, ART.sky.top);
  g.addColorStop(0.45, ART.sky.mid);
  g.addColorStop(0.78, ART.sky.low);
  g.addColorStop(1, ART.sky.horizon);
  return g;
})();

function drawSky() {
  ctx.fillStyle = SKY;
  ctx.fillRect(0, 0, W, H);

  // Stars fade out toward the warm end of the sky.
  ctx.fillStyle = ART.sky.star;
  for (const s of stars) {
    const sx = ((s.x - camX * 0.06) % (W * 3) + W * 3) % (W * 3);
    if (sx > W) continue;
    const sy = s.y - camY * 0.06;
    if (sy < 0 || sy > H * 0.6) continue;
    ctx.globalAlpha = clamp(1 - sy / (H * 0.6), 0, 1) * 0.8;
    ctx.fillRect(sx, sy, s.r, s.r);
  }
  ctx.globalAlpha = 1;

  const sunY = 430 - camY * 0.08;
  ctx.fillStyle = ART.sky.sun;
  ctx.beginPath();
  ctx.arc(W * 0.72, sunY, 120, 0, Math.PI * 2);
  ctx.fill();
}

// Two layers of skyline behind the playable one, drifting at a fraction of the
// camera speed. Drawn procedurally from the camera position rather than stored,
// so the parallax costs no memory and never needs recycling.
function drawParallax() {
  for (const layer of [
    { factor: 0.20, step: 150, base: 470, height: 200, color: ART.far.block },
    { factor: 0.42, step: 110, base: 500, height: 260, color: ART.mid.block },
  ]) {
    const offset = camX * layer.factor;
    const first = Math.floor(offset / layer.step) - 1;
    ctx.fillStyle = layer.color;
    for (let i = first; i < first + Math.ceil(W / layer.step) + 3; i++) {
      const x = i * layer.step - offset;
      // A deterministic wobble from the index, so a block is the same height
      // every time it scrolls past.
      const h = layer.height * (0.55 + ((i * 2654435761) % 1000) / 1000 * 0.65);
      const y = layer.base - camY * layer.factor - h;
      ctx.fillRect(x, y, layer.step - 14, h + 400);
    }
  }
}

function drawBuilding(b) {
  const x = b.x - camX;
  const y = b.top - camY;
  if (x + b.w < -80 || x > W + 80) return;

  const height = 1200;

  ctx.fillStyle = b.lit ? ART.tower.faceLit : ART.tower.face;
  ctx.fillRect(x, y, b.w, height);

  ctx.fillStyle = ART.tower.roof;
  ctx.fillRect(x, y, b.w, 8);
  ctx.strokeStyle = ART.tower.edge;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, y);
  ctx.lineTo(x + 0.5, y + height);
  ctx.moveTo(x + b.w - 0.5, y);
  ctx.lineTo(x + b.w - 0.5, y + height);
  ctx.stroke();

  if (b.lit) {
    // Windows from a hash of the building's seed and the window position: no
    // per-window state, and identical every frame.
    for (let wy = y + 22; wy < y + 420 && wy < H + 20; wy += 26) {
      if (wy < -20) continue;
      for (let wx = x + 10; wx < x + b.w - 12; wx += 20) {
        const h = ((wx | 0) * 37 + (wy | 0) * 61 + b.seed) % 11;
        if (h > 4) continue;
        ctx.fillStyle = h > 2 ? ART.tower.windowCool : ART.tower.window;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(wx, wy, 8, 12);
      }
    }
    ctx.globalAlpha = 1;
  }

  // The mast, and the anchor at its tip.
  const a = anchorOf(b);
  const ax = a.x - camX;
  const ay = a.y - camY;
  ctx.strokeStyle = ART.tower.mast;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(ax, y);
  ctx.lineTo(ax, ay);
  ctx.stroke();

  ctx.fillStyle = ART.tower.mastGlow;
  ctx.beginPath();
  ctx.arc(ax, ay, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ART.tower.mastTip;
  ctx.beginPath();
  ctx.arc(ax, ay, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawRings() {
  for (const ring of swing.rings) {
    const x = ring.x - camX;
    const y = ring.y - camY;
    if (x < -60 || x > W + 60) continue;

    ctx.lineWidth = 4;
    if (ring.taken) {
      ctx.strokeStyle = ART.ring.taken;
    } else if (ring.missed) {
      ctx.strokeStyle = ART.ring.missed;
    } else {
      ctx.fillStyle = ART.ring.inner;
      ctx.beginPath();
      ctx.arc(x, y, ring.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = ART.ring.outer;
    }
    ctx.beginPath();
    ctx.arc(x, y, ring.r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawHero() {
  const hero = swing.hero;
  const x = hero.x - camX;
  const y = hero.y - camY;
  const diving = swing.diving;

  // Rope or hook line.
  if (swing.hookState !== HOOK.IDLE) {
    const tip = swing.hookState === HOOK.ATTACHED ? swing.hookTarget : swing.hookTip;
    ctx.strokeStyle = ART.hero.rope;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tip.x - camX, tip.y - camY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = ART.hero.hook;
    ctx.beginPath();
    ctx.arc(tip.x - camX, tip.y - camY, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(x, y);
  // Hanging figures point at the anchor; flying ones point along their path.
  ctx.rotate(swing.hookState === HOOK.ATTACHED
    ? Math.atan2(hero.y - swing.hookTarget.y, hero.x - swing.hookTarget.x) - Math.PI / 2
    : hero.angle - Math.PI / 2);

  ctx.fillStyle = ART.hero.cloak;
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(-9, 18);
  ctx.lineTo(9, 18);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = diving ? ART.hero.bodyDive : ART.hero.body;
  ctx.beginPath();
  ctx.ellipse(0, 0, 7, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = ART.hero.head;
  ctx.beginPath();
  ctx.arc(0, -11, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// A faint marker on whichever anchor the hook would take. Without it the
// targeting rule is invisible and firing the hook is a guess.
function drawTarget() {
  if (swing.hookState !== HOOK.IDLE) return;
  const a = swing.bestAnchor();
  if (!a) return;

  ctx.strokeStyle = ART.hud.target;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(a.x - camX, a.y - camY, 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawHudExtras() {
  const speed = swing.speed;

  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('SPEED', W - 20, H - 52);
  ctx.fillStyle = ART.hud.speed;
  ctx.font = '700 22px ui-monospace, monospace';
  ctx.fillText(`${Math.round(speed / 10)}`, W - 20, H - 40);

  if (swing.combo > 1) {
    ctx.textAlign = 'center';
    ctx.fillStyle = ART.hud.combo;
    ctx.font = '800 24px system-ui, sans-serif';
    ctx.fillText(`RINGS x${swing.combo}`, W / 2, 22);
  }

  // How high the run has climbed the difficulty curve. Not a level number,
  // because there are no levels — it is the same continuous value the city
  // generator uses, shown as a percentage so it means something.
  ctx.textAlign = 'left';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText(`CITY ${Math.round(difficultyAt(swing.furthest) * 100)}%`, 20, H - 28);
}

// `alpha` is unused: the camera moves the whole world every tick, and
// interpolating across a tick that also reframed the scene tears it apart.
function render() {
  drawSky();
  drawParallax();

  ctx.save();
  if (shakeTime > 0) {
    const m = shakeTime * 16;
    ctx.translate(randRange(-m, m), randRange(-m, m));
  }

  for (const b of swing.buildings) drawBuilding(b);
  drawRings();
  drawTarget();
  particles.draw(ctx);
  if (swing.running) drawHero();

  ctx.restore();

  shell.drawHud({ score: swing.metres, best: Session.getBest(GAME_ID) });
  drawHudExtras();
  shell.render();
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
  title: 'Skyhook',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Throw the hook', gamepad: 'A', keyboard: 'Space', touch: 'Hook pad' },
    { action: 'Let go', gamepad: 'A again', keyboard: 'Space again', touch: 'Hook pad again' },
    { action: 'Reel in', gamepad: 'Push the stick up', keyboard: 'Up or W', touch: 'Drag up' },
    { action: 'Lean into the swing', gamepad: 'Left / right on the stick', keyboard: 'Left / Right or A / D', touch: 'Drag left or right' },
    { action: 'Reel out', gamepad: 'Pull the stick down', keyboard: 'Down or S', touch: 'Drag down' },
    { action: 'Dive', gamepad: 'B, in the air', keyboard: 'Shift, in the air', touch: 'Dive pad' },
    { action: 'Go faster', gamepad: 'Reel in at the bottom of a swing', keyboard: 'Reel in at the bottom of a swing', touch: 'Reel in at the bottom of a swing' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({ name: 'Skyhook', tagline: 'Speed is the only thing holding you up.' });
