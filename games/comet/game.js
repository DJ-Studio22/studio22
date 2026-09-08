// games/comet/game.js
//
// Comet — an arena survival game. Ported from the standalone prototype onto
// the Studio 22 engine.
//
// WHAT CHANGED IN THE PORT, AND WHAT DELIBERATELY DID NOT
// ------------------------------------------------------
// Input, canvas scaling, the loop, audio, scoring and the pause/game-over
// chrome are the engine's now. The tuning numbers are untouched, and so is
// the order the simulation applies them, because the feel of this game lives
// entirely in those numbers.
//
// One thing is genuinely new: the right stick aims the burn. The original had
// no aim at all — burning simply accelerated you along whatever direction you
// were already steering. That still happens when the aim stick is centred, so
// a player who never touches it plays the original game. Deflect it and the
// dash goes where the stick points instead, which lets you drift one way and
// whip the tail the other. It is the first thing in the suite to read aimX /
// aimY, so it is also what proves that path works.
//
// UNITS: the engine works in seconds, so this game does too. The original's
// numbers were tuned per frame on a 60Hz rAF, and they are kept below in that
// form as the source of truth, then converted once. The conversion is done in
// code rather than by pasting rounded results, which makes it exact: a
// velocity multiplies by TICKS_PER_SECOND, an acceleration by its square.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop, TICKS_PER_SECOND as TPS } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticleSystem, randRange as R } from '../../engine/util.js';

const GAME_ID = 'comet';
const W = 960;
const H = 600;
const TAU = Math.PI * 2;

// --- Tuning. Do not retune without playing it. ---------------------------
//
// The original per-frame numbers, kept verbatim as the record of what this
// game felt like before the port. Everything below this block is derived.
const PER_FRAME = {
  acc: 0.62,         // thrust while flying normally
  accBurn: 1.15,     // thrust while burning
  cap: 6.4,          // speed ceiling while flying normally
  capBurn: 11,       // speed ceiling while burning
  drag: 0.925,       // velocity retained each frame
  hunterAcc: 0.09,   // how hard a hunter steers toward the player
  hunterDrag: 0.97,
  spin: 0.05,        // foe rotation
  dustPulse: 0.07,   // stardust throb
  bitDrag: 0.95,     // debris slowdown
};

const ACC = PER_FRAME.acc * TPS * TPS;
const ACC_BURN = PER_FRAME.accBurn * TPS * TPS;
const CAP = PER_FRAME.cap * TPS;
const CAP_BURN = PER_FRAME.capBurn * TPS;
const HUNTER_ACC = PER_FRAME.hunterAcc * TPS * TPS;
const SPIN = PER_FRAME.spin * TPS;
const DUST_PULSE = PER_FRAME.dustPulse * TPS;

// Per-frame damping factors become per-second rates the same way: a velocity
// multiplied by 0.925 every frame retains 0.925^60 of itself after a second.
const DRAG_PER_SECOND = PER_FRAME.drag ** TPS;
const HUNTER_DRAG_PER_SECOND = PER_FRAME.hunterDrag ** TPS;
const SHAKE_DECAY_PER_SECOND = 0.86 ** TPS;
// The engine's particle `drag` is expressed as the fraction LOST per second,
// where this game's is the fraction kept per frame — hence the 1 minus.
const BIT_DRAG = 1 - PER_FRAME.bitDrag ** TPS;

// Frame counts from the original are durations, so they convert by dividing.
const BURN_TIME = 34 / TPS;      // how long one burn lasts
const BURN_COOLDOWN = 48 / TPS;  // dead time before the next one
const INV_ON_SPAWN = 90 / TPS;   // grace at the start of a run
const INV_ON_HIT = 120 / TPS;    // grace after losing a life

// The tail is a trail of past positions sampled once per tick, so its length
// is counted in ticks rather than seconds — that is what it was in the
// original and it is what keeps the trail the same shape.
// How much stardust is on the field at once. Fixed, and refilled only as
// pieces are collected.
//
// The original had a bug here: waves added five more and collection respawned
// them, so the count only ever grew and by wave ten the arena was carpeted.
// That made late waves survivable by walking through pickups rather than by
// flying well, which is the opposite of what the escalation is for.
const DUST_ON_FIELD = 6;

const TAIL_START = 42;
const TAIL_PER_DUST = 6;
const TAIL_LOST_ON_HIT = 14;
const TAIL_MIN = 28;

// Below this deflection the aim stick counts as centred and the burn falls
// back to the original behaviour. Deliberately larger than the engine's
// gamepad deadzone: this is "did the player mean to aim", not "is the stick
// electrically at rest".
const AIM_DEADZONE = 0.25;

const PLAYER_RADIUS = 9;
const START_LIVES = 3;

// --- Art palette ---------------------------------------------------------
//
// This game's own colours, kept in one place rather than scattered through
// the draw calls. Deliberately NOT from tokens.css: those tokens are the
// site's chrome — the warm charcoal and amber of the arcade around the game.
// This game is a cold one, blue-white light in a near-black void, and pushing
// it into the site palette would flatten it into every other game.
const ART = {
  void: '#05060f',
  star: '#9fb4ff',
  dust: '#ffd84d',
  tailCold: '#4dd8ff',
  tailHot: '#ffd84d',
  player: '#ffffff',
  playerBurning: '#ffd84d',
  hunter: '#ff6b8a',
  hunterGlow: '#ff2d55',
  drifter: '#ffa63d',
  drifterGlow: '#ff9500',
  bitsDust: '#ffd84d',
  bitsHunter: '#ff6b8a',
  bitsDrifter: '#ffa63d',
  bitsTail: '#4dd8ff',
  bitsPlayer: '#ff6b8a',
  meterTrack: 'rgba(255,255,255,.12)',
  meterCooling: '#5a6a99',
  meterLabel: 'rgba(255,255,255,.45)',
  aimLine: 'rgba(255,216,77,.5)',
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 320 });

// One pad, and it says what it does rather than which letter it is. The
// default two-button cluster would leave a dead B sitting on the screen.
Input.setTouchLayout([
  { name: 'a', xRatio: 0.88, yRatio: 0.84, radius: 46, label: 'Burn' },
]);

// The touch equivalent of the right stick: a second virtual stick that
// appears wherever a thumb lands on the right half of the screen. Without it
// aimX/aimY are always 0 on a phone, and the aimed burn — the one thing this
// port adds — would silently not exist on the device most people will play on.
Input.setAimStickEnabled(true);

// Points are points: more is better.
Session.setScoreDirection(GAME_ID, 'high');

// --- Sound ---------------------------------------------------------------
//
// Synthesised for now; there are no audio files yet. Adding `file: '...'` to
// any entry below is the only change needed to upgrade that sound — the file
// loads in the background, play() switches to it once it arrives, and none of
// the call sites move.
audio.define({
  // Starting a burn: the shove in the back.
  dash: { beep: { freq: 180, duration: 0.16, type: 'sawtooth', volume: 0.2 } },
  // Something touched the tail and went up.
  burn: { beep: { freq: 640, duration: 0.09, type: 'square', volume: 0.16 } },
  // Stardust.
  collect: { beep: { freq: 880, duration: 0.1, type: 'triangle', volume: 0.18 } },
  // A life lost.
  hit: { beep: { freq: 140, duration: 0.22, type: 'sawtooth', volume: 0.26 } },
  // The last one.
  death: { beep: { freq: 90, duration: 0.5, type: 'triangle', volume: 0.28 } },
});

// --- Game state ----------------------------------------------------------

let score = 0;
let wave = 1;
let lives = START_LIVES;
let shake = 0;
let burn = 0;         // seconds of burn left
let burnCooldown = 0; // seconds until the next burn is allowed
let invuln = 0;       // seconds of grace left
let tailMax = TAIL_START;
let kills = 0;

let tail = [];
let foes = [];
let dust = [];

const P = { x: W / 2, y: H / 2, vx: 0, vy: 0, r: PLAYER_RADIUS };

// The starfield never moves, so it is built once and only ever read.
const stars = [];
for (let i = 0; i < 130; i++) {
  stars.push({ x: R(0, W), y: R(0, H), z: R(0.2, 1) });
}

// --- Spawning ------------------------------------------------------------

function makeFoe() {
  // Foes arrive from off-screen, one edge each, so nothing ever materialises
  // on top of the player.
  const side = Math.floor(R(0, 4));
  let x;
  let y;
  if (side === 0) { x = R(0, W); y = -30; }
  else if (side === 1) { x = W + 30; y = R(0, H); }
  else if (side === 2) { x = R(0, W); y = H + 30; }
  else { x = -30; y = R(0, H); }

  // Hunters chase; drifters cross the arena in a straight line. The mix
  // sours as the waves climb, but never past just over half.
  const hunter = Math.random() < Math.min(0.15 + wave * 0.05, 0.55);
  const speed = hunter ? (1.5 + wave * 0.08) : (0.75 + wave * 0.05);

  return {
    x,
    y,
    vx: 0,
    vy: 0,
    r: hunter ? 11 : 14,
    speed: speed * TPS,
    hunter,
    spin: R(0, TAU),
    aimed: false,
  };
}

function makeDust() {
  // Inset from the walls: stardust pinned to an edge is a trap, not a prize.
  return { x: R(60, W - 60), y: R(60, H - 60), r: 7, phase: R(0, TAU) };
}

function spawnWave() {
  const count = 3 + wave * 2;
  for (let i = 0; i < count; i++) foes.push(makeFoe());
  // Deliberately does NOT spawn stardust. A wave adds threat, not supply.
}

// Tops the field back up to DUST_ON_FIELD. Called at the start of a run and
// after a piece is collected, so the count is a constant rather than a drift.
function refillDust() {
  while (dust.length < DUST_ON_FIELD) dust.push(makeDust());
}

function boom(x, y, color, count) {
  particles.emit(x, y, {
    count,
    colors: [color],
    speed: [1 * TPS, 5.5 * TPS],
    life: [20 / TPS, 42 / TPS],
    size: [4, 4],
    drag: BIT_DRAG,
    shape: 'square',
    shrink: false,
  });
}

function reset() {
  score = 0;
  wave = 1;
  lives = START_LIVES;
  shake = 0;
  burn = 0;
  burnCooldown = 0;
  invuln = INV_ON_SPAWN;
  tailMax = TAIL_START;
  kills = 0;

  tail = [];
  foes = [];
  dust = [];
  particles.clear();

  P.x = W / 2;
  P.y = H / 2;
  P.vx = 0;
  P.vy = 0;

  refillDust();
  spawnWave();
}

// --- Update --------------------------------------------------------------

function update(dt) {
  // Returns false while an overlay is up, which is also when the loop is
  // suspended — so this is belt and braces, and cheap.
  if (!shell.update()) return;

  const pad = Input.get();
  const burning = burn > 0;

  // Steering. Left stick, D-pad, WASD, arrows and the left half of a
  // touchscreen all arrive here as the same two numbers.
  let thrustX = pad.x;
  let thrustY = pad.y;

  // The aimed burn. Only while actually burning: outside a burn the right
  // stick does nothing, which is what keeps the base feel identical to the
  // original for anyone who never uses it.
  const aimLength = Math.hypot(pad.aimX, pad.aimY);
  const aiming = aimLength > AIM_DEADZONE;
  if (burning && aiming) {
    thrustX = pad.aimX / aimLength;
    thrustY = pad.aimY / aimLength;
  }

  const acc = burning ? ACC_BURN : ACC;
  P.vx += thrustX * acc * dt;
  P.vy += thrustY * acc * dt;

  P.vx *= DRAG_PER_SECOND ** dt;
  P.vy *= DRAG_PER_SECOND ** dt;

  const cap = burning ? CAP_BURN : CAP;
  const speed = Math.hypot(P.vx, P.vy);
  if (speed > cap) {
    P.vx = (P.vx / speed) * cap;
    P.vy = (P.vy / speed) * cap;
  }

  P.x += P.vx * dt;
  P.y += P.vy * dt;

  // Walls bounce rather than stop: being pinned in a corner with foes
  // converging is a worse death than being thrown back into the room.
  if (P.x < P.r) { P.x = P.r; P.vx *= -0.5; }
  if (P.x > W - P.r) { P.x = W - P.r; P.vx *= -0.5; }
  if (P.y < P.r) { P.y = P.r; P.vy *= -0.5; }
  if (P.y > H - P.r) { P.y = H - P.r; P.vy *= -0.5; }

  // Burn meter. A burn needs the cooldown clear and some speed already on
  // the clock, so it stays a dash and not a standing-start teleport.
  // Held rather than edge-triggered, which is what the original did: keep the
  // button down and the next burn fires the instant the cooldown clears. That
  // rhythm — dash, wait, dash — is most of how the game plays.
  const wantBurn = pad.a || pad.rt || pad.rb;
  if (wantBurn && burnCooldown <= 0 && burn <= 0 && speed > 0.5 * TPS) {
    burn = BURN_TIME;
    audio.play('dash');
  }
  if (burn > 0) {
    burn -= dt;
    if (burn <= 0) {
      burn = 0;
      burnCooldown = BURN_COOLDOWN;
    }
  }
  if (burnCooldown > 0) burnCooldown = Math.max(0, burnCooldown - dt);
  if (invuln > 0) invuln = Math.max(0, invuln - dt);

  // The tail: one sample per tick, oldest dropped off the end.
  tail.unshift({ x: P.x, y: P.y });
  while (tail.length > tailMax) tail.pop();

  // Stardust. Picking it up lengthens the tail, which is the whole economy
  // of the game: a longer weapon is also a bigger thing to steer.
  for (let i = dust.length - 1; i >= 0; i--) {
    const d = dust[i];
    d.phase += DUST_PULSE * dt;
    if (Math.hypot(d.x - P.x, d.y - P.y) < d.r + P.r + 4) {
      dust.splice(i, 1);
      score += 25;
      tailMax += TAIL_PER_DUST;
      boom(d.x, d.y, ART.bitsDust, 14);
      audio.play('collect');
      refillDust();
    }
  }

  if (updateFoes(dt)) return;

  // Waves are cleared, not survived — the arena refills the moment it empties.
  if (foes.length === 0) {
    wave++;
    score += wave * 40;
    spawnWave();
  }

  particles.update(dt);
  if (shake > 0) shake *= SHAKE_DECAY_PER_SECOND ** dt;
}

// Returns true if the player died this tick, so the caller can stop
// simulating rather than spawning a fresh wave into a finished run.
function updateFoes(dt) {
  for (let i = foes.length - 1; i >= 0; i--) {
    const f = foes[i];

    if (f.hunter) {
      const angle = Math.atan2(P.y - f.y, P.x - f.x);
      f.vx += Math.cos(angle) * HUNTER_ACC * dt;
      f.vy += Math.sin(angle) * HUNTER_ACC * dt;
      f.vx *= HUNTER_DRAG_PER_SECOND ** dt;
      f.vy *= HUNTER_DRAG_PER_SECOND ** dt;
      const s = Math.hypot(f.vx, f.vy);
      if (s > f.speed) {
        f.vx = (f.vx / s) * f.speed;
        f.vy = (f.vy / s) * f.speed;
      }
    } else {
      // Drifters pick a heading once, roughly across the middle, and keep it.
      if (!f.aimed) {
        const angle = Math.atan2(H / 2 - f.y + R(-140, 140), W / 2 - f.x + R(-140, 140));
        f.vx = Math.cos(angle) * f.speed;
        f.vy = Math.sin(angle) * f.speed;
        f.aimed = true;
      }
      // And wrap, so a drifter that misses comes back around rather than
      // leaving the wave one short forever.
      if (f.x < -40) f.x = W + 40;
      if (f.x > W + 40) f.x = -40;
      if (f.y < -40) f.y = H + 40;
      if (f.y > H + 40) f.y = -40;
    }

    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.spin += SPIN * dt;

    // Head-on. Burning or briefly invulnerable, you win it; otherwise it costs.
    if (Math.hypot(f.x - P.x, f.y - P.y) < f.r + P.r) {
      if (burn > 0 || invuln > 0) {
        foes.splice(i, 1);
        kills++;
        score += f.hunter ? 90 : 60;
        boom(f.x, f.y, f.hunter ? ART.bitsHunter : ART.bitsDrifter, 26);
        shake = 9;
        audio.play('burn');
        continue;
      }
      takeHit(f, i);
      if (lives <= 0) return true;
      continue;
    }

    // The tail. Skipped for the first few segments so the trail immediately
    // behind the player cannot kill something the head just failed to.
    if (tailHits(f)) {
      foes.splice(i, 1);
      kills++;
      score += f.hunter ? 120 : 70;
      boom(f.x, f.y, ART.bitsTail, 24);
      shake = 6;
      audio.play('burn');
    }
  }
  return false;
}

// Every other tail segment is tested rather than all of them: at 40-odd
// segments across a dozen foes the halved count is invisible in play and
// halves the work.
function tailHits(f) {
  for (let t = 6; t < tail.length; t += 2) {
    const seg = tail[t];
    const width = 3 + 9 * (1 - t / tail.length);
    if (Math.hypot(f.x - seg.x, f.y - seg.y) < f.r + width) return true;
  }
  return false;
}

function takeHit(f, index) {
  lives--;
  invuln = INV_ON_HIT;
  shake = 22;
  boom(P.x, P.y, ART.bitsPlayer, 40);
  // Losing tail is the real punishment. The lost life is just the counter.
  tailMax = Math.max(TAIL_MIN, tailMax - TAIL_LOST_ON_HIT);
  foes.splice(index, 1);
  P.vx = 0;
  P.vy = 0;

  if (lives <= 0) {
    audio.play('death');
    Session.submitScore(GAME_ID, score);
    shell.showGameOver(score, { waveReached: wave, foesBurned: kills });
  } else {
    audio.play('hit');
  }
}

// --- Draw ----------------------------------------------------------------

function render() {
  ctx.save();
  // Below a threshold the offset is smaller than a pixel and only costs a
  // transform, so it is not worth applying.
  if (shake > 0.4) ctx.translate(R(-shake, shake), R(-shake, shake));

  // Overdrawn past the edges so the shake never exposes bare canvas, and
  // measured from the stage so a screen wider than the game is still space.
  ctx.fillStyle = ART.void;
  ctx.fillRect(screen.left - 40, -40, screen.stageWidth + 80, H + 80);

  for (const s of stars) {
    ctx.globalAlpha = s.z * 0.7;
    ctx.fillStyle = ART.star;
    ctx.fillRect(s.x, s.y, s.z * 2, s.z * 2);
  }
  ctx.globalAlpha = 1;

  drawDust();
  drawTail();
  drawFoes();
  drawPlayer();

  particles.draw(ctx);
  drawBurnMeter();

  ctx.restore();

  // Score, best, wave and lives all through the engine HUD, so they sit in
  // the same place and the same type as every other game. getBest returns
  // null before the first run of a visit and drawHud skips the line on null,
  // so no guard is needed here.
  shell.drawHud({
    score,
    best: Session.getBest(GAME_ID),
    level: wave,
    lives,
  });

  shell.render();
}

function drawDust() {
  for (const d of dust) {
    const pulse = 1 + Math.sin(d.phase) * 0.25;
    ctx.shadowBlur = 22;
    ctx.shadowColor = ART.dust;
    ctx.fillStyle = ART.dust;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r * pulse, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawTail() {
  const burning = burn > 0;
  // Back to front, so each segment overlaps the older one behind it.
  for (let i = tail.length - 1; i > 0; i--) {
    const seg = tail[i];
    const f = 1 - i / tail.length;   // 1 at the head, 0 at the tip
    ctx.globalAlpha = 0.16 + f * 0.8;
    ctx.shadowBlur = 18;
    ctx.shadowColor = burning ? ART.tailHot : ART.tailCold;
    ctx.fillStyle = burning
      ? `rgb(255,${180 + (f * 60 | 0)},77)`
      : `rgb(${60 + (f * 40 | 0)},${170 + (f * 70 | 0)},255)`;
    ctx.beginPath();
    ctx.arc(seg.x, seg.y, 3 + 9 * f, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawFoes() {
  for (const f of foes) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.spin);
    ctx.shadowBlur = 16;

    if (f.hunter) {
      // Three sides, because a triangle reads as pointed and therefore as
      // dangerous before the player has consciously identified it.
      ctx.shadowColor = ART.hunterGlow;
      ctx.fillStyle = ART.hunter;
      polygon(3, f.r);
      ctx.fill();
    } else {
      ctx.shadowColor = ART.drifterGlow;
      ctx.fillStyle = ART.drifter;
      polygon(6, f.r);
      ctx.fill();
      ctx.fillStyle = ART.void;
      ctx.beginPath();
      ctx.arc(0, 0, f.r * 0.38, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }
  ctx.shadowBlur = 0;
}

function polygon(sides, radius) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawPlayer() {
  const pad = Input.get();
  const aimLength = Math.hypot(pad.aimX, pad.aimY);
  const aiming = aimLength > AIM_DEADZONE;

  // While the stick is deflected the nose follows it rather than the
  // velocity. Without this the aim stick moves the player without ever
  // looking like it did anything, and players conclude it is broken.
  const heading = aiming
    ? Math.atan2(pad.aimY, pad.aimX)
    : Math.atan2(P.vy, P.vx);

  // A short line out from the nose while aiming: it shows where the next
  // burn will actually go, which is the only way to aim one in advance.
  // Drawn before the blink check on purpose — the two seconds after a hit
  // are exactly when a player is lining up their next move, and a guide that
  // strobes in and out is worse than none.
  if (aiming && burn <= 0) {
    ctx.save();
    ctx.globalAlpha = burnCooldown > 0 ? 0.25 : 0.7;
    ctx.strokeStyle = ART.aimLine;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(P.x + Math.cos(heading) * (P.r + 6), P.y + Math.sin(heading) * (P.r + 6));
    ctx.lineTo(P.x + Math.cos(heading) * (P.r + 54), P.y + Math.sin(heading) * (P.r + 54));
    ctx.stroke();
    ctx.restore();
  }

  // Blink through the grace period, the arcade shorthand for "you cannot be
  // hit right now" — and the reason the timer is visible at all.
  if (invuln > 0 && Math.floor(invuln * TPS / 5) % 2 !== 0) return;

  ctx.save();
  ctx.translate(P.x, P.y);
  ctx.rotate(heading);
  ctx.shadowBlur = 26;
  ctx.shadowColor = burn > 0 ? ART.playerBurning : ART.player;
  ctx.fillStyle = burn > 0 ? ART.playerBurning : ART.player;
  ctx.beginPath();
  ctx.moveTo(P.r * 1.6, 0);
  ctx.lineTo(-P.r, P.r * 0.85);
  ctx.lineTo(-P.r * 0.4, 0);
  ctx.lineTo(-P.r, -P.r * 0.85);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.shadowBlur = 0;
}

function drawBurnMeter() {
  const barW = 170;
  const barH = 6;
  const x = W / 2 - barW / 2;
  const y = H - 30;

  ctx.fillStyle = ART.meterTrack;
  ctx.fillRect(x, y, barW, barH);

  // One bar, three meanings: draining while burning, refilling while cooling,
  // full and bright when ready.
  let pct = 1;
  let color = ART.tailCold;
  if (burn > 0) {
    pct = burn / BURN_TIME;
    color = ART.tailHot;
  } else if (burnCooldown > 0) {
    pct = 1 - burnCooldown / BURN_COOLDOWN;
    color = ART.meterCooling;
  }

  ctx.fillStyle = color;
  ctx.fillRect(x, y, barW * pct, barH);

  ctx.font = '10px Verdana, sans-serif';
  ctx.fillStyle = ART.meterLabel;
  ctx.textAlign = 'center';
  ctx.fillText('BURN', W / 2, y - 8);
}

// --- Boot ----------------------------------------------------------------

let shell;

const loop = new GameLoop({
  update,
  render,
  // Losing focus mid-run should raise the pause screen, not silently freeze
  // the game behind a still image.
  onPause: () => shell?.pause(),
});

shell = new GameShell({
  gameId: GAME_ID,
  title: 'Comet',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Fly', gamepad: 'Left stick or D-pad', keyboard: 'Arrows or WASD', touch: 'Drag the left side' },
    { action: 'Burn', gamepad: 'A or RT', keyboard: 'Space', touch: 'Burn pad' },
    { action: 'Aim the burn', gamepad: 'Right stick', keyboard: 'Not available — burns follow your heading', touch: 'Drag the right side' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

// The front door. Nothing simulates until Start is pressed: the shell
// suspends the loop while the title is up.
shell.showTitle({ name: 'Comet', tagline: 'Your tail is the weapon.' });
