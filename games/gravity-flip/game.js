// games/gravity-flip/game.js
//
// Gravity Flip — you always run right, and the only thing you control is which
// way is down.
//
// THE ONE IDEA THIS FILE PROTECTS
// ------------------------------
// A flip always takes the same number of COLUMNS, at every speed, forever.
//
// That sounds like a detail and it is actually the whole design. The rooms in
// rooms.js are hand-authored against a rule — four clear columns between a
// stretch that forces you onto the ceiling and one that forces you onto the
// floor — and that rule is only meaningful if a flip covers a fixed amount of
// ground. The obvious way to make an endless runner harder is to speed it up,
// but speeding up a flipper makes every gap wider in flip-lengths, and rooms
// that were tight at the start become impossible later. The player cannot see
// that happening; they just start dying to rooms they used to clear.
//
// So gravity is scaled by the SQUARE of the speed. Fall time goes down exactly
// as fast as forward speed goes up, the arc keeps its shape in tile-space, and
// every authored room stays exactly as passable at room two hundred as at room
// two. What escalates is your reaction time and which rooms are in the deck —
// never the geometry.
//
// checkFlipBudget() at the bottom asserts this against rooms.js at boot, so
// the two files cannot quietly drift apart.
//
// WHAT ESCALATES
// --------------
//   speed   climbs forever, so there is less and less time to read a room
//   tier    unlocks harder rooms, up to the hardest, then stays there
// Difficulty therefore has no ceiling even though the room library is finite.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticleSystem, clamp, randRange } from '../../engine/util.js';
// ROOM_ROWS is imported because the saw-extraction loop below walks the room
// grid by row. It was missing, so the first time a room was placed the loop
// threw ReferenceError and the game stopped dead -- on every device, not just
// on a phone. Nothing caught it: the rules module is covered by its own tests,
// the build does not run the game, and the crash needs somebody to actually
// press Start.
import { ROOM_COLS, ROOM_ROWS, pickRoom } from './rooms.js';
import {
  BASE_GRAVITY, BASE_SPEED, FLIP_COLUMNS, GRID_ROWS, MAX_STEP_FRACTION,
  PLAYER_H, PLAYER_W, TILE, flipColumns, gravityAt, maxFallAt, speedAt,
} from './motion.js';

const GAME_ID = 'gravity-flip';

// --- Geometry ------------------------------------------------------------
//
// TILE, GRID_ROWS, the player's size and every motion number live in
// motion.js, so that the flip-budget invariant can be checked against the
// values the game actually runs on rather than against a second copy of them.

const W = 880;
const H = GRID_ROWS * TILE;          // 440
const ROOM_WIDTH = ROOM_COLS * TILE; // 800

// Where the player sits on screen. Everything ahead of this is reaction time.
const EYE_X = 200;

// --- Tiers ---------------------------------------------------------------
//
// Which rooms are in the deck. The last tier is the last tier — past it the
// speed keeps climbing and the deck stops changing, which is the right way
// round: new rooms would be a surprise, and a surprise at speed is a cheap
// death.
const TIER_AT = [0, 4, 10, 18];

// --- Art palette ---------------------------------------------------------
//
// This game's own colours, deliberately NOT from tokens.css: those are the
// arcade's chrome and this is a facility that changes as you get deeper into
// it. The shell still draws pause, game over and the HUD in site tokens
// straight over the top, which is what keeps it Studio 22.
//
// Grouped by subject rather than flat, per CLAUDE.md. `tiers` is one entry per
// difficulty tier, so the room getting harder is something you can see before
// you have read the number.
const ART = {
  tiers: [
    { bgTop: '#0b1424', bgBottom: '#122036', block: '#1f3a5c', blockTop: '#2e5686', grid: 'rgba(120,190,255,.06)', accent: '#4fc3f7' },
    { bgTop: '#160e26', bgBottom: '#231640', block: '#3a2560', blockTop: '#553a8c', grid: 'rgba(190,150,255,.06)', accent: '#b388ff' },
    { bgTop: '#1c0f14', bgBottom: '#2e1720', block: '#5c2438', blockTop: '#8a3652', grid: 'rgba(255,150,180,.06)', accent: '#ff6e8a' },
    { bgTop: '#0f1c14', bgBottom: '#16301f', block: '#1f5c38', blockTop: '#2e8a54', grid: 'rgba(140,255,190,.06)', accent: '#4fe08a' },
  ],
  shell: {
    edge: 'rgba(255,255,255,.16)',
    seam: 'rgba(255,255,255,.05)',
  },
  spike: {
    body: '#ff4d6d',
    tip: '#ffd0d8',
    base: 'rgba(0,0,0,.35)',
  },
  saw: {
    body: '#e0e6f0',
    teeth: '#9aa8c0',
    core: '#ff4d6d',
    glow: 'rgba(255,77,109,.18)',
  },
  player: {
    body: '#ffd166',
    bodyFlipped: '#9ef2ff',
    eye: '#1a1a24',
    trail: 'rgba(255,209,102,.45)',
    trailFlipped: 'rgba(158,242,255,.45)',
  },
  hud: {
    label: 'rgba(255,255,255,.55)',
    room: '#ffffff',
    speed: '#ffd166',
  },
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 240 });

// One button and nothing to steer. The joystick is cleared so it is not
// sitting on a phone screen doing nothing.
Input.clearTouchLayout();
// No virtual stick: Gravity Flip is one button: the only control is which way down is.
// Without this the shell advertises a joystick in the corner that steers
// nothing, which is worse than no joystick at all.
Input.setDirectionalTouch(false);

Input.setTouchLayout([
  // Bottom RIGHT: this is a one-thumb game and the right thumb is where the
  // phone is already held. Dead centre put it over the room you are reading.
  { name: 'a', xRatio: 0.9, yRatio: 0.82, radius: 66, label: 'Flip' },
]);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  flip: { beep: { freq: 540, duration: 0.05, type: 'square', volume: 0.13 } },
  land: { beep: { freq: 260, duration: 0.04, type: 'triangle', volume: 0.09 } },
  room: { beep: { freq: 760, duration: 0.09, type: 'square', volume: 0.13 } },
  tier: { beep: { freq: 400, duration: 0.32, type: 'triangle', volume: 0.2 } },
  die: { beep: { freq: 95, duration: 0.5, type: 'sawtooth', volume: 0.3 } },
});

// --- State ---------------------------------------------------------------

const player = { x: 0, y: 0, vy: 0, gravity: 1 };

// Rooms currently in the world, keyed by their index along the corridor. Only
// the three around the player are ever kept.
let placedRooms = new Map();
let saws = [];

let roomsCleared = 0;
let currentRoomIndex = 0;
let tier = 0;
let lastRoom = null;
let running = false;
let shakeTime = 0;
let flips = 0;
let closestCall = Infinity;

// A short trail behind the player, pooled. It is the only thing that shows
// which way gravity is pulling at a glance.
const trail = [];
for (let i = 0; i < 18; i++) trail.push({ x: 0, y: 0, life: 0, flipped: false });

// --- Derived numbers -----------------------------------------------------

// All three come from motion.js; these just bind them to the run in progress.
const speed = () => speedAt(roomsCleared);
const gravity = () => gravityAt(roomsCleared);
const maxFall = () => maxFallAt(roomsCleared);

const theme = () => ART.tiers[Math.min(tier, ART.tiers.length - 1)];

function tierFor(rooms) {
  let t = 0;
  for (let i = 0; i < TIER_AT.length; i++) if (rooms >= TIER_AT[i]) t = i;
  return t;
}

// --- The corridor --------------------------------------------------------

function roomAt(index) {
  if (!placedRooms.has(index)) {
    const room = pickRoom(tier, lastRoom);
    lastRoom = room;
    placedRooms.set(index, room);

    // Saws are extracted once, when the room is placed, rather than being
    // looked up in the grid every frame.
    for (let r = 0; r < ROOM_ROWS; r++) {
      for (let c = 0; c < ROOM_COLS; c++) {
        if (room.grid[r][c] !== 'o') continue;
        const homeY = (r + 1) * TILE + TILE / 2;
        saws.push({
          x: index * ROOM_WIDTH + c * TILE + TILE / 2,
          homeY,
          y: homeY,
          range: TILE * 1.6,
          phase: randRange(0, Math.PI * 2),
          spin: 0,
          roomIndex: index,
        });
      }
    }
  }
  return placedRooms.get(index);
}

// The character at a global column and grid row. Rows 0 and GRID_ROWS-1 are
// the corridor's own ceiling and floor and are always solid.
function cellAt(gcol, grow) {
  if (grow <= 0 || grow >= GRID_ROWS - 1) return '#';
  if (gcol < 0) return '.';

  const index = Math.floor(gcol / ROOM_COLS);
  const room = roomAt(index);
  const col = gcol - index * ROOM_COLS;
  return room.grid[grow - 1][col] ?? '.';
}

const isSolid = (gcol, grow) => cellAt(gcol, grow) === '#';

// --- Collision -----------------------------------------------------------

function columnsSpanned(x) {
  return {
    c0: Math.floor((x - PLAYER_W / 2) / TILE),
    c1: Math.floor((x + PLAYER_W / 2 - 0.001) / TILE),
  };
}

// Ran into the side of something. Always fatal — there is no way to stop.
function hitsWall(x, y) {
  const { c0, c1 } = columnsSpanned(x);
  const r0 = Math.floor((y - PLAYER_H / 2) / TILE);
  const r1 = Math.floor((y + PLAYER_H / 2 - 0.001) / TILE);
  for (let c = c0; c <= c1; c++) {
    for (let r = r0; r <= r1; r++) {
      if (isSolid(c, r)) return true;
    }
  }
  return false;
}

/**
 * Vertical movement with landing.
 *
 * Snapping leaves a hair of clearance so that the following frame's horizontal
 * test does not read a surface the player is resting on as a wall they just
 * ran into — which would kill them for standing still.
 */
function moveVertically(dy) {
  player.y += dy;
  const { c0, c1 } = columnsSpanned(player.x);

  if (dy > 0) {
    const row = Math.floor((player.y + PLAYER_H / 2) / TILE);
    for (let c = c0; c <= c1; c++) {
      if (!isSolid(c, row)) continue;
      player.y = row * TILE - PLAYER_H / 2 - 0.05;
      if (player.vy > 200) audio.play('land', { pitchVariance: 0.2 });
      player.vy = 0;
      return;
    }
  } else if (dy < 0) {
    const row = Math.floor((player.y - PLAYER_H / 2) / TILE);
    for (let c = c0; c <= c1; c++) {
      if (!isSolid(c, row)) continue;
      player.y = (row + 1) * TILE + PLAYER_H / 2 + 0.05;
      if (player.vy < -200) audio.play('land', { pitchVariance: 0.2 });
      player.vy = 0;
      return;
    }
  }
}

// Spike hitboxes are inset from their cell: the drawn triangle does not fill
// the square, and a hitbox bigger than the picture is the least forgivable
// thing a precision platformer can do.
const SPIKE_INSET_X = 7;
const SPIKE_DEPTH = TILE - 12;

function hitsSpike() {
  const left = player.x - PLAYER_W / 2;
  const right = player.x + PLAYER_W / 2;
  const top = player.y - PLAYER_H / 2;
  const bottom = player.y + PLAYER_H / 2;

  const c0 = Math.floor(left / TILE);
  const c1 = Math.floor(right / TILE);
  const r0 = Math.floor(top / TILE);
  const r1 = Math.floor(bottom / TILE);

  for (let c = c0; c <= c1; c++) {
    for (let r = r0; r <= r1; r++) {
      const ch = cellAt(c, r);
      if (ch !== '^' && ch !== 'v') continue;

      const bx = c * TILE + SPIKE_INSET_X;
      const bw = TILE - SPIKE_INSET_X * 2;
      const by = ch === '^' ? (r + 1) * TILE - SPIKE_DEPTH : r * TILE;

      if (right > bx && left < bx + bw && bottom > by && top < by + SPIKE_DEPTH) return true;
    }
  }
  return false;
}

function hitsSaw() {
  for (const saw of saws) {
    if (Math.abs(saw.x - player.x) > 60) continue;
    // Circle against the player's box, the usual way: clamp the centre into
    // the box and measure from there.
    const nx = clamp(saw.x, player.x - PLAYER_W / 2, player.x + PLAYER_W / 2);
    const ny = clamp(saw.y, player.y - PLAYER_H / 2, player.y + PLAYER_H / 2);
    const d = Math.hypot(saw.x - nx, saw.y - ny);
    if (d < 15) return true;
    if (d < closestCall) closestCall = d;
  }
  return false;
}

// --- Run management ------------------------------------------------------

function die(reason) {
  if (!running) return;
  running = false;
  shakeTime = 0.4;
  audio.play('die');
  particles.explosion(player.x, player.y, {
    count: 28,
    colors: [ART.player.body, ART.spike.body, theme().accent],
  });
  shell.showGameOver(roomsCleared, {
    ended: reason,
    tier: tier + 1,
    flips,
    speed: `${Math.round(speed())} px/s`,
    distance: `${Math.round(player.x / TILE)} tiles`,
  });
}

function reset() {
  placedRooms = new Map();
  saws = [];
  lastRoom = null;
  roomsCleared = 0;
  currentRoomIndex = 0;
  tier = 0;
  flips = 0;
  closestCall = Infinity;
  shakeTime = 0;
  running = true;

  particles.clear();
  for (const t of trail) t.life = 0;

  // Two columns into the first room, standing on the floor.
  player.x = TILE * 2;
  player.y = (GRID_ROWS - 1) * TILE - PLAYER_H / 2 - 0.05;
  player.vy = 0;
  player.gravity = 1;

  // The opening room is always the gentlest one, so a run never begins with a
  // shape the player has not been introduced to.
  placedRooms.set(0, pickRoom(0, null));
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;

  for (const t of trail) if (t.life > 0) t.life -= dt;
  particles.update(dt);
  if (shakeTime > 0) shakeTime = Math.max(0, shakeTime - dt);

  // Saws keep turning after a death, so the last frame is not a freeze-frame.
  for (const saw of saws) {
    saw.phase += dt * 1.7;
    saw.spin += dt * 9;
    saw.y = saw.homeY + Math.sin(saw.phase) * saw.range;
  }

  if (!running) return;

  if (Input.pressed('a')) {
    player.gravity *= -1;
    flips++;
    audio.play('flip', { pitch: player.gravity > 0 ? 1 : 1.25 });
  }

  // MOVEMENT IS SUBSTEPPED, and it has to be.
  //
  // Gravity here scales with the square of the run speed (see gravity()), so a
  // long run reaches genuinely large numbers: by room 50 a single 1/60s tick
  // moves the player 46px vertically, and a tile is 40px. Collision only ever
  // looks at where a step ENDED, so a step longer than a tile walks straight
  // through blocks and spikes without touching them — the player sails through
  // a wall and the run carries on. It gets worse the further you get, which is
  // the worst possible shape for a bug in an endless game.
  //
  // So each tick is sliced until no slice moves more than a fraction of a tile
  // on either axis. The loop's timestep is still a fixed 1/60; this only
  // subdivides the integration inside it, which also makes the flip arc more
  // accurate rather than less.
  const verticalTravel = Math.abs(player.vy) * dt + gravity() * dt * dt;
  const forwardTravel = speed() * dt;
  const slices = Math.max(1, Math.ceil(
    Math.max(verticalTravel, forwardTravel) / (TILE * MAX_STEP_FRACTION),
  ));
  const h = dt / slices;

  for (let i = 0; i < slices; i++) {
    player.vy += gravity() * player.gravity * h;
    player.vy = clamp(player.vy, -maxFall(), maxFall());
    moveVertically(player.vy * h);

    // Forward. Running into a wall is the end — there is no brake in this
    // game, so a wall in front of you is a wall you have already failed to
    // avoid.
    const nextX = player.x + speed() * h;
    if (hitsWall(nextX, player.y)) { die('Hit a wall'); return; }
    player.x = nextX;

    if (hitsSpike()) { die('Spikes'); return; }
    if (hitsSaw()) { die('Saw'); return; }
  }

  // Trail.
  for (const t of trail) {
    if (t.life > 0) continue;
    t.x = player.x;
    t.y = player.y;
    t.life = 0.28;
    t.flipped = player.gravity < 0;
    break;
  }

  // Crossing into the next room.
  const index = Math.floor(player.x / ROOM_WIDTH);
  if (index > currentRoomIndex) {
    currentRoomIndex = index;
    roomsCleared++;
    audio.play('room');

    const newTier = tierFor(roomsCleared);
    if (newTier !== tier) {
      tier = newTier;
      audio.play('tier');
    }

    // Make sure the room after next exists before it is drawn, and drop
    // everything behind. A run of a thousand rooms holds three.
    roomAt(index + 1);
    for (const key of [...placedRooms.keys()]) {
      if (key < index - 1) placedRooms.delete(key);
    }
    saws = saws.filter((saw) => saw.roomIndex >= index - 1);
  }

  // Keep the corridor built ahead of the camera even mid-room.
  roomAt(index);
  roomAt(index + 1);
}

// --- Draw ----------------------------------------------------------------

const camX = () => player.x - EYE_X;

function drawBackground() {
  const t = theme();
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, t.bgTop);
  g.addColorStop(1, t.bgBottom);
  ctx.fillStyle = g;
  // Across the STAGE, not across W: on a screen wider than the game the canvas
  // extends past both edges (see engine/canvas.js) and an unpainted margin is
  // just a black bar the game chose not to fill.
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);

  // A faint grid, anchored to the world so it scrolls with the corridor
  // instead of crawling at a speed of its own.
  const offset = ((camX() % TILE) + TILE) % TILE;
  ctx.strokeStyle = t.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -offset; x < W + TILE; x += TILE) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
  }
  for (let y = 0; y < H; y += TILE) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
  }
  ctx.stroke();
}

function drawBlock(x, y) {
  const t = theme();
  ctx.fillStyle = t.block;
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = t.blockTop;
  ctx.fillRect(x, y, TILE, 4);
  ctx.strokeStyle = ART.shell.seam;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
}

function drawSpike(x, y, pointingUp) {
  const inset = SPIKE_INSET_X;
  const base = pointingUp ? y + TILE : y;
  const tip = pointingUp ? y + TILE - SPIKE_DEPTH : y + SPIKE_DEPTH;

  // Three teeth per cell rather than one big triangle: at 40px a single spike
  // reads as a wedge, and a wedge does not say "this will kill you".
  for (let i = 0; i < 3; i++) {
    const w = (TILE - inset * 2) / 3;
    const left = x + inset + i * w;
    ctx.fillStyle = ART.spike.body;
    ctx.beginPath();
    ctx.moveTo(left, base);
    ctx.lineTo(left + w, base);
    ctx.lineTo(left + w / 2, tip);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = ART.spike.tip;
    ctx.beginPath();
    ctx.arc(left + w / 2, tip + (pointingUp ? 2 : -2), 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSaw(saw) {
  const x = saw.x - camX();
  if (x < -40 || x > W + 40) return;

  ctx.fillStyle = ART.saw.glow;
  ctx.beginPath();
  ctx.arc(x, saw.y, 22, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(x, saw.y);
  ctx.rotate(saw.spin);
  ctx.fillStyle = ART.saw.teeth;
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(-4, -18);
    ctx.lineTo(4, -18);
    ctx.lineTo(0, -10);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = ART.saw.body;
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ART.saw.core;
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCorridor() {
  const cam = camX();
  const firstCol = Math.floor(cam / TILE) - 1;
  const lastCol = Math.floor((cam + W) / TILE) + 1;

  for (let c = firstCol; c <= lastCol; c++) {
    const x = c * TILE - cam;
    for (let r = 0; r < GRID_ROWS; r++) {
      const ch = cellAt(c, r);
      const y = r * TILE;
      if (ch === '#') drawBlock(x, y);
      else if (ch === '^') drawSpike(x, y, true);
      else if (ch === 'v') drawSpike(x, y, false);
    }
  }

  // The seams between rooms, so progress is visible as something other than a
  // counter going up.
  ctx.strokeStyle = ART.shell.edge;
  ctx.lineWidth = 2;
  const firstRoom = Math.floor(cam / ROOM_WIDTH);
  for (let i = firstRoom; i <= firstRoom + 2; i++) {
    const x = i * ROOM_WIDTH - cam;
    if (x < -4 || x > W + 4) continue;
    ctx.beginPath();
    ctx.moveTo(x, TILE);
    ctx.lineTo(x, H - TILE);
    ctx.stroke();
  }
}

function drawPlayer() {
  const flipped = player.gravity < 0;

  for (const t of trail) {
    if (t.life <= 0) continue;
    ctx.globalAlpha = (t.life / 0.28) * 0.6;
    ctx.fillStyle = t.flipped ? ART.player.trailFlipped : ART.player.trail;
    ctx.fillRect(t.x - camX() - 5, t.y - 5, 10, 10);
  }
  ctx.globalAlpha = 1;

  const x = player.x - camX();
  ctx.fillStyle = flipped ? ART.player.bodyFlipped : ART.player.body;
  ctx.beginPath();
  ctx.roundRect(x - PLAYER_W / 2, player.y - PLAYER_H / 2, PLAYER_W, PLAYER_H, 5);
  ctx.fill();

  // The eyes sit toward whichever way is currently down, which is the fastest
  // read of the game's only piece of state.
  ctx.fillStyle = ART.player.eye;
  const eyeY = player.y + (flipped ? -5 : 5);
  ctx.beginPath();
  ctx.arc(x - 4, eyeY, 2.4, 0, Math.PI * 2);
  ctx.arc(x + 4, eyeY, 2.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawHudExtras() {
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('SPEED', W - 20, H - 44);
  ctx.fillStyle = ART.hud.speed;
  ctx.font = '700 20px ui-monospace, monospace';
  ctx.fillText(String(Math.round(speed())), W - 20, H - 32);
}

// `alpha` is unused: the camera is pinned to the player and translates the
// whole corridor every tick, so interpolating across a tick tears it apart.
function render() {
  drawBackground();

  ctx.save();
  if (shakeTime > 0) {
    const m = shakeTime * 14;
    ctx.translate(randRange(-m, m), randRange(-m, m));
  }

  drawCorridor();
  for (const saw of saws) drawSaw(saw);
  particles.draw(ctx);
  if (running) drawPlayer();

  ctx.restore();

  shell.drawHud({ score: roomsCleared, best: Session.getBest(GAME_ID), level: tier + 1 });
  drawHudExtras();
  shell.render();
}

// --- The invariant -------------------------------------------------------

/**
 * Checks that a full-height flip really does cost FLIP_COLUMNS of ground.
 *
 * rooms.js authors every room against that number. If the physics here are
 * retuned without moving it, rooms stop being passable in a way that is
 * invisible in the code and very visible to whoever is playing — so the two
 * files are made to agree out loud, at boot, rather than by convention.
 */
function checkFlipBudget() {
  const columns = flipColumns();

  if (columns > FLIP_COLUMNS) {
    console.warn(
      `[gravity-flip] A flip costs ${columns.toFixed(2)} columns but rooms.js `
      + `is authored for ${FLIP_COLUMNS}. Rooms at the minimum spacing are not `
      + 'passable. Raise BASE_GRAVITY, lower BASE_SPEED, or widen FLIP_COLUMNS.',
    );
  }
  return columns;
}

const flipCost = checkFlipBudget();

// --- Boot ----------------------------------------------------------------

let shell;

const loop = new GameLoop({
  update,
  render,
  onPause: () => shell?.pause(),
});

shell = new GameShell({
  gameId: GAME_ID,
  title: 'Gravity Flip',
  canvas: screen,
  loop,
  audio,
  // Music: the flip is judged off the room in front of you.
  music: true,
  onRestart: reset,
  controls: [
    { action: 'Flip gravity', gamepad: 'A', keyboard: 'Space', touch: 'Flip pad' },
    { action: 'Running', gamepad: 'Automatic', keyboard: 'Automatic', touch: 'Automatic' },
    { action: 'A flip', gamepad: `Costs about ${flipCost.toFixed(1)} tiles of ground`, keyboard: `Costs about ${flipCost.toFixed(1)} tiles of ground`, touch: `Costs about ${flipCost.toFixed(1)} tiles of ground` },
    { action: 'Spikes and saws', gamepad: 'Kill on contact', keyboard: 'Kill on contact', touch: 'Kill on contact' },
    { action: 'Walls', gamepad: 'There is no brake', keyboard: 'There is no brake', touch: 'There is no brake' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({ name: 'Gravity Flip', tagline: 'One button. Down is negotiable.' });
