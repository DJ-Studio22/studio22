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
import { chaseCeiling, isSafeLanding, isSpikeAt, ledgeSegments, makeLedge, SHAFT_TUNING } from './shaft.js';
import { ParticleSystem, randRange as R, clamp } from '../../engine/util.js';

const GAME_ID = 'sinkhole';

// Portrait: the whole game is a vertical column, and a wide canvas would be
// mostly empty wall on either side.
const W = 480;
const H = 720;
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

const GRAVITY = 1500;          // units/sec²
const DIVE_GRAVITY = 3400;
const MAX_FALL = 760;
const MAX_DIVE_FALL = 1150;
const MOVE_ACCEL = 3200;
const MAX_MOVE = 320;
const GROUND_DRAG_PER_SECOND = 0.0005;   // fraction of horizontal speed kept
const AIR_DRAG_PER_SECOND = 0.06;

const PLAYER_R = 14;

// Thick enough to be the shelf engine/shell.js draws its HUD on. A thin
// ceiling put the score on top of the spikes, where it was unreadable — and
// the slab reads as the roof of the cave rather than as padding.
// Where the ceiling STARTS. It does not stay there: see chaseCeiling in
// shaft.js. Kept as the starting value and as the thickness of the slab the
// HUD is drawn on.
const CEILING_H = 100;
const LEDGE_H = 16;
const LEDGE_SPACING = 132;

const BASE_SCROLL = 62;        // units/sec at depth 0
const SCROLL_PER_DEPTH = 0.011;
const MAX_SCROLL = 235;

const START_LIVES = 3;
const INVULN_TIME = 1.6;

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
const CAM_ANCHOR = H * 0.42;   // where on screen the player sits once it moves
const CAM_LOOKAHEAD = 130;     // extra view below at full dive speed
const CAM_FOLLOW = 7;          // exponential follow rate, per second
// The least room ever left between the top of the view and the player. The
// ceiling is clamped into the view (see chaseCeiling), so this is in effect the
// closest the spikes are ever held while the player is running -- and therefore
// the real "max lead" of the game, in the units the player experiences it in.
const CEILING_ROOM = 280;

// --- State ---------------------------------------------------------------

let depth = 0;
let lives = START_LIVES;
let invuln = 0;
let shake = 0;
let ledges = [];

// Where the ceiling has closed to. Starts at CEILING_H and descends —
// chaseCeiling in shaft.js decides how fast.
let ceilingY = CEILING_H;
let dead = false;
let camY = 0;              // how far the view has scrolled below the shaft top

const P = { x: W / 2, y: 220, vx: 0, vy: 0, onGround: false, squash: 0 };

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

function scrollSpeed() {
  return Math.min(BASE_SCROLL + depth * SCROLL_PER_DEPTH, MAX_SCROLL);
}

// A floor is built by shaft.js, which also holds the guarantee that every
// one of them has somewhere survivable to land. See the header there.
const newLedge = (y) => makeLedge(y, depth, SHAFT_TUNING);

function lowestLedgeY() {
  let low = -Infinity;
  for (const ledge of ledges) low = Math.max(low, ledge.y);
  return low === -Infinity ? 0 : low;
}

function reset() {
  depth = 0;
  lives = START_LIVES;
  invuln = 0;
  shake = 0;
  dead = false;
  camY = 0;
  particles.clear();

  P.x = W / 2;
  P.y = 200;
  P.vx = 0;
  P.vy = 0;
  P.onGround = false;
  P.squash = 0;

  ceilingY = CEILING_H;
  ledges = [];
  for (let y = 360; y < H + LEDGE_SPACING; y += LEDGE_SPACING) {
    ledges.push(newLedge(y));
  }
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;
  if (dead) return;

  const pad = Input.get();
  const diving = pad.a || pad.rt || pad.b;

  // Horizontal. Accelerated rather than instant, so a ledge edge can be
  // overshot — which is what makes threading a narrowing gap a skill rather
  // than a reflex.
  P.vx += pad.x * MOVE_ACCEL * dt;
  const drag = P.onGround ? GROUND_DRAG_PER_SECOND : AIR_DRAG_PER_SECOND;
  P.vx *= drag ** dt;
  P.vx = clamp(P.vx, -MAX_MOVE, MAX_MOVE);
  P.x = clamp(P.x + P.vx * dt, PLAYER_R, W - PLAYER_R);

  // Vertical. Diving is the answer to hesitating: it costs nothing but the
  // control you give up by falling faster.
  const gravity = diving ? DIVE_GRAVITY : GRAVITY;
  const terminal = diving ? MAX_DIVE_FALL : MAX_FALL;
  P.vy = Math.min(P.vy + gravity * dt, terminal);

  if (diving && P.vy > 300 && Math.random() < dt * 30) {
    particles.emit(P.x, P.y - PLAYER_R, {
      count: 1, colors: [ART.puffDive], speed: [10, 60], life: [0.15, 0.35],
      size: [2, 3], shape: 'circle', shrink: true,
    });
  }

  // Both bodies move this tick, so both endpoints are needed to test the
  // crossing. bottomBefore is sampled while the ledges are still where they
  // were; `rise` lets landOnLedges put them back there.
  const bottomBefore = P.y + PLAYER_R;
  P.y += P.vy * dt;

  // The world rises. Everything moves up by the same amount, which is what
  // makes the ledges feel like a floor coming up rather than the player
  // sinking.
  const rise = scrollSpeed() * dt;
  depth += rise;
  for (const ledge of ledges) ledge.y -= rise;
  particles.shift(0, -rise);

  P.onGround = false;
  landOnLedges(bottomBefore, rise);

  // Standing on a rising ledge carries the player up with it. Without this
  // the player would sink through a ledge that is moving underneath them.
  if (P.onGround) P.y -= rise;

  recycleLedges();

  // The ceiling closes rather than sitting still. A dive used to outrun it
  // permanently, which removed the threat the game is named for at exactly
  // the moment the player got good at it.
  // THE CAMERA MOVES FIRST, and the order matters rather than being tidiness.
  // The ceiling is now clamped against the top of the view, so it has to be
  // clamped against where the view IS this frame; doing it after left the
  // ceiling chasing last frame's camera, which at a full dive is sixteen
  // pixels of drift a frame and reads as the spikes juddering.
  updateCamera(dt);

  // camY is the world position of the top of the view, and passing it is what
  // keeps the spikes in frame.
  ceilingY = chaseCeiling(ceilingY, P.y, scrollSpeed(), dt, SHAFT_TUNING, camY);

  if (P.y - PLAYER_R < ceilingY) {
    P.y = ceilingY + PLAYER_R;
    hurt();
  }

  if (invuln > 0) invuln = Math.max(0, invuln - dt);
  if (shake > 0) shake = Math.max(0, shake - dt * 24);
  if (P.squash > 0) P.squash = Math.max(0, P.squash - dt * 5);
  particles.update(dt);
}

/**
 * Where the view wants to be: far enough down to keep the player on screen,
 * plus a lookahead that grows with fall speed.
 *
 * The lookahead is the point. Falling at full dive speed shifts the view a
 * further 130 units down, so the faster you commit the more of the shaft
 * below you can see -- which is exactly when you need to be picking the next
 * gap. Diving blind into ledges you cannot see yet would make speed a
 * punishment rather than the answer to hesitating.
 */
function cameraTarget() {
  const dive = clamp(P.vy / MAX_DIVE_FALL, 0, 1);
  const want = Math.max(0, P.y - CAM_ANCHOR + dive * CAM_LOOKAHEAD);
  // THE LOOKAHEAD MAY NOT EAT THE ROOM THE DANGER LIVES IN.
  //
  // Diving slides the view down to show more of what is coming, which pushes
  // the player UP the screen -- from 302 pixels below the top to 172. The
  // ceiling is now held at the top of the view, so that lookahead was directly
  // shortening the gap between the spikes and the player, and doing it hardest
  // at the exact moment the player is going fastest. Looking further ahead
  // should cost you what is behind, and the spikes are not behind you, they
  // are the thing you are running from.
  return Math.min(want, Math.max(0, P.y - CEILING_ROOM));
}

function updateCamera(dt) {
  // Frame-rate independent easing, the same shape used everywhere else in
  // the suite. Eased rather than snapped so landing does not jolt the view.
  camY += (cameraTarget() - camY) * (1 - Math.exp(-dt * CAM_FOLLOW));
}

/**
 * Does the player fit through this ledge's gap?
 *
 * The WHOLE player has to fit. The first version asked only whether the
 * player overlapped the gap at all, which made every gap effectively a
 * player-width wider than it looked and meant clipping the very edge of one
 * dropped you through it. Steering to actually line up is the game.
 */
function fitsThroughGap(ledge) {
  return P.x - PLAYER_R >= ledge.gapX
    && P.x + PLAYER_R <= ledge.gapX + ledge.gapW;
}

/**
 * Lands the player on the first solid ledge their feet crossed this tick.
 *
 * SWEPT AGAINST A MOVING PLANE, and that is the whole point. Both bodies
 * move every tick: the player falls, and the ledges rise. The first version
 * sampled the player's position BEFORE the ledges moved and then compared it
 * against where the ledges ended up, which is two different moments of the
 * world in one test. A player resting on a ledge therefore measured as being
 * already below it — its own floor was skipped, and it fell through every
 * platform in the game without ever needing to find a gap.
 *
 * That was NOT tunnelling. Instrumenting it showed the player's feet
 * overshooting the plane by about one unit, exactly the distance the ledge
 * had risen; tunnelling at this game's speeds would need nineteen. Capping
 * the fall speed or thickening the ledges would have hidden it without
 * fixing it.
 *
 * Testing the player's travel against the LEDGE'S OWN travel over the same
 * interval fixes it and is swept, so no fall speed can slip through either.
 */
function landOnLedges(bottomBefore, rise) {
  if (P.vy < 0) return;
  const bottomAfter = P.y + PLAYER_R;

  // Every ledge whose plane the feet crossed this tick. Normally none or
  // one: at terminal dive speed the player covers about 23 units and the
  // ledges are 132 apart.
  const crossed = [];
  for (const ledge of ledges) {
    const yBefore = ledge.y + rise;   // where this ledge was at the top of the tick
    const yAfter = ledge.y;
    if (bottomBefore > yBefore) continue;   // already below it when the tick began
    if (bottomAfter < yAfter) continue;     // still above it when the tick ended
    crossed.push(ledge);
  }
  if (crossed.length === 0) return;

  // Highest first, so a fast fall stops at the first thing it should have
  // hit rather than at whichever happened to be first in the array.
  crossed.sort((a, b) => a.y - b.y);

  for (const ledge of crossed) {
    if (fitsThroughGap(ledge)) continue;

    // A spiked floor is no longer uniformly deadly: shaft.js guarantees a
    // safe band on every one of them, so the question is where the player
    // landed rather than which kind of floor it was.
    if (isSpikeAt(ledge, P.x, PLAYER_R)) {
      hurt();
      return;
    }

    P.y = ledge.y - PLAYER_R;
    P.vy = 0;
    P.onGround = true;
    if (P.squash <= 0) audio.play('land');
    P.squash = 1;
    return;
  }
}

function recycleLedges() {
  // Off the top past the ceiling: gone, and fresh ones are added below so
  // the column never runs out of floor.
  //
  // Generated to the bottom of the CAMERA'S view, not the canvas. That is
  // the half of the camera fix that is not cosmetic: a player who dives past
  // the last generated ledge has nothing left to land on, and falls for ever.
  ledges = ledges.filter((ledge) => ledge.y > -LEDGE_H * 2);
  while (lowestLedgeY() < camY + H + LEDGE_SPACING) {
    ledges.push(newLedge(lowestLedgeY() + LEDGE_SPACING));
  }
}

function hurt() {
  if (invuln > 0) return;

  lives--;
  shake = 1;
  audio.play(lives > 0 ? 'hurt' : 'death');
  particles.emit(P.x, P.y, {
    count: 20, colors: [ART.puffHurt], speed: [80, 300], life: [0.3, 0.7],
    size: [3, 3], gravity: 300, drag: 0.9, shape: 'circle', shrink: true,
  });

  if (lives <= 0) {
    dead = true;
    shell.showGameOver(Math.floor(depth / 10), {
      depthReached: `${Math.floor(depth / 10)} m`,
      fallSpeed: `${Math.round(scrollSpeed())} u/s`,
    });
    return;
  }

  // Dropped back to a safe height with a moment of grace, rather than
  // respawned into the same crush. Measured from the CEILING rather than
  // from the canvas: the ceiling is the thing being given clearance from,
  // and the canvas no longer says where that is.
  invuln = INVULN_TIME;
  P.y = CEILING_H + H * 0.34;
  P.vy = 0;
  P.vx = 0;
  // Snapped, not eased. A respawn is a cut, and gliding the camera across
  // to it would spend the grace period travelling.
  camY = cameraTarget();
}

// --- Draw ----------------------------------------------------------------

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
  // ledges, the player and the ceiling all share. The wall and its grit stay
  // outside it: they are the backdrop, and scrolling them would turn a
  // camera move into the whole world sliding.
  ctx.save();
  ctx.translate(0, -camY);

  // A lamp glow around the player, so the eye goes to the thing it controls.
  const lamp = ctx.createRadialGradient(P.x, P.y, 10, P.x, P.y, 210);
  lamp.addColorStop(0, ART.lamp);
  lamp.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = lamp;
  ctx.fillRect(screen.left, camY, screen.stageWidth, H);

  for (const ledge of ledges) {
    // Cull what the camera has left behind. Ledges above the ceiling are
    // deleted, but ones between the ceiling and the top of a moved view are
    // still live -- the player can be carried back up to them.
    if (ledge.y < camY - LEDGE_H * 2) continue;
    if (ledge.y > camY + H) continue;
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
    score: Math.floor(depth / 10),
    best: Session.getBest(GAME_ID),
    lives,
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
  ctx.fillRect(screen.left, 0, screen.stageWidth, ceilingY);

  ctx.fillStyle = ART.ceilingSpike;
  const step = 24;
  for (let x = screen.left; x < screen.right; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, ceilingY);
    ctx.lineTo(x + step / 2, ceilingY + 16);
    ctx.lineTo(x + step, ceilingY);
    ctx.closePath();
    ctx.fill();
  }

  // A warning wash that grows as the player nears the spikes, so the danger
  // is legible before it is fatal.
  const nearness = clamp(1 - (P.y - ceilingY) / 220, 0, 1);
  if (nearness > 0) {
    ctx.globalAlpha = nearness;
    ctx.fillStyle = ART.ceilingWarn;
    ctx.fillRect(screen.left, ceilingY, screen.stageWidth, 150);
    ctx.globalAlpha = 1;
  }
}

function drawPlayer() {
  // Blink through the grace period, the arcade shorthand for "you cannot be
  // hit right now".
  if (invuln > 0 && Math.floor(invuln * 12) % 2 !== 0) return;

  const squash = 1 - P.squash * 0.28;
  ctx.save();
  ctx.translate(P.x, P.y);
  ctx.scale(1 + P.squash * 0.22, squash);

  ctx.fillStyle = invuln > 0 ? ART.playerHurt : ART.player;
  ctx.beginPath();
  ctx.arc(0, 0, PLAYER_R, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = ART.playerEdge;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Eyes look the way you are moving, which is the cheapest possible way to
  // make a circle read as a creature.
  const look = clamp(P.vx / MAX_MOVE, -1, 1) * 4;
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
  const ceilingOnScreen = ceilingY - camY;
  const hidden = clamp(-ceilingOnScreen / 40, 0, 1);
  if (hidden <= 0) return;

  const clearance = Math.max(0, Math.round(P.y - PLAYER_R - ceilingY));

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

  // Centred: the shell puts the score top-left and the lives top-right, and
  // the distance landed underneath the lives.
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
  ctx.fillText(`${Math.floor(depth / 10)} m down`, W / 2, H - 22);
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
