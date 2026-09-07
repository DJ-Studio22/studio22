// games/winter/game.js
//
// Winter Base Building — three actions a day, and wolves every seventh night.
//
// THE RULE
// --------
// Each day you get three actions: gather wood, hunt for meat, or raise the
// wall. Each night the fire wants wood and you want food, and both wants grow.
// Every seventh night a pack arrives and hits the wall. Weeks survived is the
// score.
//
// WHY IT IS NOT A CHORE LIST
// --------------------------
// Because wood does two jobs and there is never enough for both. It burns, and
// it builds, and the fire's appetite rises every week while the forest near
// camp thins out. So the game is not "gather enough" — it is "which of these
// two do I fund this week", and you can be caught having chosen wrong.
//
// That is a claim about arithmetic, so it is measured rather than asserted.
// The simulation is in camp.js with no DOM attached, and
// tests/winter.camp.test.mjs plays it with four STRATEGIES rather than two
// skill levels: a wall-first camp freezes, a fire-first camp gets eaten, and
// only a camp that funds both outlasts either.
//
// WHAT THIS FILE DOES, AND WHY IT IS THIS BIG
// -------------------------------------------
// Canvas, input, audio, shell wiring — and an isometric camp, because the
// first version drew four bars and a menu, and the game read as a spreadsheet
// with snow on it. Every number the simulation holds now has a physical
// counterpart on the ground:
//
//   wood      a stack of logs that grows and shrinks
//   meat      a drying rack that fills and empties
//   wall      posts that rise one at a time and are knocked out by the pack
//   the fire  big and yellow when it is fed, guttering blue when it is not
//   the pack  wolves gathering past the treeline as the seventh night nears
//   the week  the forest visibly thinning, which is gatherYield falling
//
// And the character walks. Choosing "gather" sends them out to a tree and they
// swing at it; "hunt" takes them off into the deep woods; "build" walks them to
// the gap in the wall and they heave a post upright there. The rules resolve
// the instant you confirm — the simulation is untouched by any of this — but
// the PILES do not move until the axe lands, so a decision reads as something
// that happened in a place rather than a number that changed.
//
// Not one rule lives here. camp.js owns all of them.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticlePresets, ParticleSystem, clamp, randRange } from '../../engine/util.js';

import { ACTION, Camp, TUNING, bearChance, gatherYield, packFor } from './camp.js';

const GAME_ID = 'winter';

const W = 820;
const H = 560;

// --- Art palette ---------------------------------------------------------
//
// Winter's own colours, deliberately NOT from tokens.css. A forest at the edge
// of night in deep snow, where the fire is the only warm thing for miles; the
// tokens are the arcade's chrome. The shell still draws pause, game over and
// its own screens in site tokens straight over the top, which keeps it
// recognisably Studio 22.
//
// Grouped by subject per CLAUDE.md, because a flat object at this size would
// be unreadable. Sky colours are RGB triples rather than strings because the
// light is interpolated across the day — morning to dusk as actions are spent.
const ART = {
  sky: {
    dayTop: [26, 44, 74], dayLow: [86, 116, 152],
    duskTop: [12, 18, 34], duskLow: [72, 54, 82],
  },
  ground: {
    snow: '#e4edf5',
    snowLit: '#f4f9fd',
    snowShade: '#bccadb',
    trodden: '#c8d6e5',
    beyond: '#16202f',
    edge: '#9fb2c8',
  },
  tree: {
    near: '#16283a', far: '#22384f', snow: '#e8f1f8',
    trunk: '#2c2118', stump: '#4a3a28',
  },
  fire: {
    core: '#fff4cc', mid: '#ffb340', low: '#ff6a2b',
    ember: '#7d2a14', emberCore: '#d1541f', ash: '#4c4a50',
    glow: 'rgba(255,150,60,.30)', dyingGlow: 'rgba(200,90,40,.16)',
    glowOut: 'rgba(255,150,60,0)',
    logs: '#4a3120',
  },
  shelter: { wall: '#6b4a2f', side: '#513622', roof: '#8a5f3a', snow: '#eef4fa', door: '#231708' },
  wall: {
    top: '#a8bbcf', face: '#7d92a8', side: '#5c6f84',
    fresh: '#c9dbec', rubble: '#54606e', rubbleChunk: '#8d9fb2',
    ghost: 'rgba(226,238,250,.15)', nextGhost: 'rgba(255,212,94,.55)',
  },
  logs: { end: '#c98a4b', bark: '#6f4a28', endLit: '#e0a468' },
  rack: { post: '#5a4126', rope: '#8f7a5a', meat: '#b8433f', meatFat: '#d9756f' },
  wolf: { body: '#6a7385', back: '#454d5e', eye: '#ffd34d', breath: 'rgba(226,238,250,.22)' },
  bear: { body: '#43301f', head: '#523a26', claw: '#e8dcc8' },
  person: {
    coat: '#c8362f', hood: '#e2604a', trouser: '#2c3444',
    skin: '#e8c9a8', boot: '#1b2028', tool: '#8a6a44', blade: '#c9d6e2',
    shadow: 'rgba(20,34,52,.22)',
  },
  hud: {
    label: 'rgba(226,238,250,.60)',
    value: '#f2f7fc',
    ready: '#7fd6a6',
    notReady: '#ff6b5a',
    warn: '#ffd45e',
    panel: 'rgba(9,16,27,.86)',
    panelEdge: 'rgba(226,238,250,.16)',
    selected: '#ffd45e',
    selectedFill: 'rgba(255,212,94,.14)',
    marker: 'rgba(255,212,94,.55)',
    scrim: 'rgba(6,12,22,.82)',
    barTrack: 'rgba(9,16,27,.62)',
  },
  spark: ['#fff2c4', '#ffb340', '#ff6a2b'],
  chip: ['#c98a4b', '#8f6236', '#e0a468'],
  snowfall: 'rgba(240,248,255,.70)',
};

// --- The isometric camera ------------------------------------------------
//
// One projection, used by everything. World units are roughly a stride; the
// compound runs from -5 to 5 in both axes and the treeline sits at about 8.
//
// Screen depth is x + y: SMALLER is further up the screen and further away, so
// the deep woods — where you hunt, and where a bear finds you — are at
// negative x + y, and the wall the pack hits is at positive: near the camera,
// large, and impossible to misread. Everything is drawn in that order.
const ISO = { tw: 46, th: 23, ox: W / 2, oy: 236 };

const isoX = (x, y) => ISO.ox + (x - y) * (ISO.tw / 2);
const isoY = (x, y, z = 0) => ISO.oy + (x + y) * (ISO.th / 2) - z;
const depthOf = (x, y) => x + y;

const lerp = (a, b, t) => a + (b - a) * t;
const mixRgb = (a, b, t) => `rgb(${Math.round(lerp(a[0], b[0], t))},`
  + `${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;

// --- The camp's fixed furniture ------------------------------------------

const PLACE = {
  fire: { x: 0, y: 0 },
  shelter: { x: -2.4, y: -2.8 },
  logs: { x: 2.9, y: -1.2 },
  rack: { x: -3.1, y: 1.0 },
  home: { x: 0.3, y: 1.9 },
  // Where hunting happens: out of the compound and into the deep woods at the
  // back. Far from the fire on purpose — that distance is what makes it a risk
  // rather than an errand.
  hunt: { x: -3.6, y: -8.4 },
};

// Wall slots run the perimeter of the compound and are FILLED FROM THE FRONT,
// which is the side the pack comes at. So the wall grows toward the camera and
// the gap left in it is a gap you can actually see.
const WALL_R = 5;
const WALL_SLOTS = (() => {
  const slots = [];
  for (let i = -WALL_R; i <= WALL_R; i++) {
    slots.push({ x: i, y: WALL_R });
    slots.push({ x: WALL_R, y: i });
    if (i > -WALL_R && i < WALL_R) {
      slots.push({ x: i, y: -WALL_R });
      slots.push({ x: -WALL_R, y: i });
    }
  }
  // Nearest the camera first, ties broken left to right, so the wall grows
  // evenly out of the front corner rather than jumping about.
  slots.sort((a, b) => depthOf(b.x, b.y) - depthOf(a.x, a.y) || a.x - b.x);
  return slots;
})();

// How much wall one post is worth on screen. Not a rule — camp.js knows
// nothing about posts — just the scale that makes one build read as progress.
const WALL_PER_POST = 5;
const postsFor = (wall) => clamp(Math.round(wall / WALL_PER_POST), 0, WALL_SLOTS.length);

// The treeline. Trees are dealt once and then THINNED as the weeks pass, in
// step with gatherYield falling — the forest emptying out is the falloff made
// visible rather than a second, decorative effect on top of it.
const TREES = (() => {
  const list = [];
  for (let i = 0; i < 46; i++) {
    const angle = (i / 46) * Math.PI * 2 + 0.11;
    const radius = 7.4 + ((i * 7) % 5) * 0.42;
    list.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      h: 44 + ((i * 13) % 7) * 5,
      far: i % 3 === 0,
      stump: false,
    });
  }
  return list;
})();

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 260 });

Input.setTouchLayout([
  { name: 'a', xRatio: 0.87, yRatio: 0.70, radius: 52, label: 'Do it' },
  { name: 'b', xRatio: 0.87, yRatio: 0.90, radius: 44, label: 'Sleep' },
]);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  move: { beep: { freq: 300, duration: 0.03, type: 'square', volume: 0.07 } },
  chop: { beep: { freq: 190, duration: 0.07, type: 'square', volume: 0.13 } },
  gather: { beep: { freq: 240, duration: 0.10, type: 'triangle', volume: 0.13 } },
  hunt: { beep: { freq: 380, duration: 0.08, type: 'square', volume: 0.12 } },
  build: { beep: { freq: 150, duration: 0.14, type: 'sawtooth', volume: 0.15 } },
  bear: { beep: { freq: 105, duration: 0.36, type: 'sawtooth', volume: 0.22 } },
  night: { beep: { freq: 240, duration: 0.22, type: 'sine', volume: 0.11 } },
  freeze: { beep: { freq: 138, duration: 0.30, type: 'sine', volume: 0.18 } },
  wolves: { beep: { freq: 88, duration: 0.45, type: 'sawtooth', volume: 0.24 } },
  hold: { beep: { freq: 720, duration: 0.20, type: 'triangle', volume: 0.20 } },
  over: { beep: { freq: 80, duration: 0.7, type: 'triangle', volume: 0.28 } },
});

// --- State ---------------------------------------------------------------

let camp = new Camp();
let running = false;
let selected = 0;

const MENU = [
  { action: ACTION.GATHER, label: 'Gather wood' },
  { action: ACTION.HUNT, label: 'Hunt' },
  { action: ACTION.BUILD, label: 'Raise the wall' },
];

// What the camp LOOKS like, which trails what the camp IS.
//
// The rules resolve the moment an action is confirmed — camp.js is the truth,
// and the bots in tests/ play exactly what a player plays. These are the
// piles, and they do not move until the axe lands. Without the gap, choosing
// an action makes four numbers jump before the character has taken a step, and
// the whole point of walking there is lost.
const shown = { wood: 0, meat: 0, wall: 0, health: 0 };
const target = { wood: 0, meat: 0, wall: 0, health: 0 };

// One action being performed, start to finish.
const WALK_SECONDS = 0.62;
const ACT_SECONDS = 0.56;
const perf = {
  active: false,
  action: null,
  result: null,
  phase: 'out',     // out → act → back
  t: 0,
  from: PLACE.home,
  to: PLACE.home,
  tree: null,
  beat: false,      // has the moment of impact landed yet
};

const actor = { x: PLACE.home.x, y: PLACE.home.y, face: 1, stride: 0, pose: 'idle' };

let firePhase = 0;
let flash = null;          // { text, colour, life }
let nightPanel = null;     // the night just resolved, held until dismissed
let pendingNight = null;   // resolved, but the wolves are still on screen
let chargeTimer = 0;       // the pack running at the wall
let bearTimer = 0;         // a bear on screen, out in the woods
let shake = 0;
let navLatch = 0;
let brokenPosts = [];      // slots knocked out last night, drawn as rubble

const CHARGE_SECONDS = 1.5;

const snowflakes = [];
for (let i = 0; i < 110; i++) {
  snowflakes.push({
    x: randRange(0, W), y: randRange(0, H),
    r: randRange(0.7, 2.1), drift: randRange(5, 24),
  });
}

// Wolves beyond the treeline. They are drawn from this list; how many of them
// are on screen is a function of how close the seventh night is, so the
// readiness number in the corner has something physical to point at.
const WOLVES = [];
for (let i = 0; i < 14; i++) {
  const angle = Math.PI * 0.16 + (i / 13) * Math.PI * 0.68;
  WOLVES.push({ x: Math.cos(angle) * 10.6, y: Math.sin(angle) * 10.6, phase: i * 0.7 });
}

function reset() {
  camp = new Camp();
  running = true;
  selected = 0;
  flash = null;
  nightPanel = null;
  pendingNight = null;
  chargeTimer = 0;
  bearTimer = 0;
  shake = 0;
  brokenPosts = [];
  perf.active = false;
  perf.phase = 'out';
  perf.beat = false;
  actor.x = PLACE.home.x;
  actor.y = PLACE.home.y;
  actor.pose = 'idle';
  for (const tree of TREES) tree.stump = false;
  for (const key of Object.keys(shown)) {
    target[key] = camp[key];
    shown[key] = camp[key];
  }
  particles.clear();
}

function say(text, colour) { flash = { text, colour, life: 1.7 }; }

function finish() {
  if (!running) return;
  running = false;
  audio.play('over');
  shell.showGameOver(camp.weeksSurvived, {
    daysSurvived: camp.day,
    wallLeft: Math.round(camp.wall),
    woodLeft: camp.wood,
    ending: camp.reason,
  });
}

// --- Actions, as things that happen in a place ---------------------------

/** The tree the character will walk to: the nearest one still standing. */
function nearestTree() {
  let best = null;
  let bestScore = Infinity;
  for (const tree of TREES) {
    if (tree.stump) continue;
    // Biased toward the sides, so gathering and hunting do not look like the
    // same errand in the same direction.
    const bias = Math.abs(tree.y) < 2.5 ? 0 : 3;
    const score = Math.hypot(tree.x - PLACE.home.x, tree.y - PLACE.home.y) + bias;
    if (score < bestScore) { bestScore = score; best = tree; }
  }
  return best;
}

/** Where the next post goes — the gap in the wall, which is also the marker. */
function nextWallSlot() {
  return WALL_SLOTS[Math.min(WALL_SLOTS.length - 1, postsFor(camp.wall))];
}

/** Where the selected action would send the character. */
function targetFor(action) {
  if (action === ACTION.HUNT) return PLACE.hunt;
  if (action === ACTION.BUILD) {
    const slot = nextWallSlot();
    return { x: slot.x * 0.82, y: slot.y * 0.82 };   // inside the wall, not in it
  }
  const tree = nearestTree();
  return tree ? { x: tree.x * 0.86, y: tree.y * 0.86 } : PLACE.home;
}

function beginAction() {
  if (perf.active || !running) return;
  const choice = MENU[selected];

  // The rules resolve NOW. The walk is presentation; the simulation never
  // waits on an animation, which is what keeps this file honest against the
  // harness in tests/.
  const result = camp.act(choice.action);
  if (!result) return;

  perf.active = true;
  perf.action = choice.action;
  perf.result = result;
  perf.phase = 'out';
  perf.t = 0;
  perf.beat = false;
  perf.from = { x: actor.x, y: actor.y };
  perf.tree = choice.action === ACTION.GATHER ? nearestTree() : null;
  perf.to = targetFor(choice.action);
  actor.pose = 'walk';
}

/** The moment of impact — the axe lands, the post goes up, the shot is taken. */
function landBeat() {
  perf.beat = true;
  const result = perf.result;

  switch (perf.action) {
    case ACTION.GATHER: {
      audio.play('chop');
      audio.play('gather');
      if (perf.tree) perf.tree.stump = true;
      particles.explosion(
        isoX(perf.to.x, perf.to.y), isoY(perf.to.x, perf.to.y) - 20,
        { count: 14, colors: ART.chip, speed: [60, 150] },
      );
      say(`+${result.wood} wood`, ART.logs.endLit);
      break;
    }
    case ACTION.HUNT:
      if (result.bear) {
        audio.play('bear');
        shake = 1;
        bearTimer = 1.8;
        say('A bear. Nothing brought home, and you are hurt.', ART.hud.notReady);
        particles.explosion(
          isoX(PLACE.hunt.x, PLACE.hunt.y), isoY(PLACE.hunt.x, PLACE.hunt.y) - 24,
          { count: 20, colors: [ART.bear.body, ART.rack.meat], speed: [90, 220] },
        );
      } else {
        audio.play('hunt');
        say(`+${result.meat} meat`, ART.rack.meatFat);
      }
      break;
    case ACTION.BUILD:
      if (result.alreadyBuilt) { say('Only one wall a day.', ART.hud.warn); break; }
      if (result.short) { say('Not enough wood to build.', ART.hud.warn); break; }
      audio.play('build');
      say(`+${result.built} wall`, ART.wall.fresh);
      break;
    default: break;
  }

  // The piles catch up with the truth, and ease from here.
  target.wood = camp.wood;
  target.meat = camp.meat;
  target.wall = camp.wall;
  target.health = camp.health;
}

function endDay() {
  if (perf.active || !running || nightPanel || pendingNight) return;

  const wallBefore = camp.wall;
  const night = camp.endDay();
  if (!night) return;

  audio.play('night');
  brokenPosts = [];

  if (night.wolves) {
    // Hold the report back and let the pack actually run at the wall first.
    // Which posts come out is the difference the simulation just applied, so
    // the picture and the number cannot disagree.
    chargeTimer = CHARGE_SECONDS;
    pendingNight = night;
    const standingAfter = postsFor(camp.wall);
    const lost = postsFor(wallBefore) - standingAfter;
    for (let i = 0; i < lost; i++) brokenPosts.push(standingAfter + i);
    audio.play(night.breached > 0 ? 'wolves' : 'hold');
    if (night.breached > 0) shake = 1;
  } else {
    nightPanel = night;
  }

  if (night.froze) { audio.play('freeze'); shake = Math.max(shake, 0.55); }

  target.wood = camp.wood;
  target.meat = camp.meat;
  target.wall = camp.wall;
  target.health = camp.health;

  // A new day clears the stumps: the forest immediately around camp is picked
  // over daily, and the long-run thinning is the week's job instead.
  for (const tree of TREES) tree.stump = false;

  if (!camp.running && !pendingNight) finish();
}

// --- Update --------------------------------------------------------------

/** How many trees are still standing this deep into the run. */
function treesStanding() {
  const share = gatherYield(camp.day) / TUNING.woodPerGather;
  return Math.max(8, Math.round(TREES.length * share));
}

/** How much of the pack has gathered where you can see it, 0 to 1. */
function wolfPresence() {
  if (!running) return 0;
  const nights = camp.daysToWolves;
  if (nights > 3) return 0;
  return clamp((3 - nights) / 3, 0, 1) * 0.7 + (nights === 0 ? 0.3 : 0);
}

function stepPerformance(dt) {
  // A held button hurries the errand along. Three actions a day at a second
  // and a half each is fine the first time and tiresome the fiftieth.
  const pad = Input.get();
  const rate = (pad.a || pad.b) ? 3 : 1;
  perf.t += dt * rate;

  if (perf.phase === 'out') {
    const t = clamp(perf.t / WALK_SECONDS, 0, 1);
    actor.x = lerp(perf.from.x, perf.to.x, t);
    actor.y = lerp(perf.from.y, perf.to.y, t);
    actor.face = isoX(perf.to.x, perf.to.y) >= isoX(perf.from.x, perf.from.y) ? 1 : -1;
    actor.stride += dt * rate * 11;
    actor.pose = 'walk';
    if (t >= 1) { perf.phase = 'act'; perf.t = 0; }
    return;
  }

  if (perf.phase === 'act') {
    actor.pose = perf.action === ACTION.GATHER ? 'chop'
      : perf.action === ACTION.BUILD ? 'lift' : 'aim';
    // The beat lands partway through the swing, not at the end of it.
    if (!perf.beat && perf.t >= ACT_SECONDS * 0.45) landBeat();
    if (perf.t >= ACT_SECONDS) { perf.phase = 'back'; perf.t = 0; }
    return;
  }

  const t = clamp(perf.t / WALK_SECONDS, 0, 1);
  actor.x = lerp(perf.to.x, PLACE.home.x, t);
  actor.y = lerp(perf.to.y, PLACE.home.y, t);
  actor.face = isoX(PLACE.home.x, PLACE.home.y) >= isoX(perf.to.x, perf.to.y) ? 1 : -1;
  actor.stride += dt * rate * 11;
  actor.pose = 'walk';
  if (t >= 1) {
    perf.active = false;
    actor.pose = 'idle';
    actor.x = PLACE.home.x;
    actor.y = PLACE.home.y;
    if (!camp.running) finish();
  }
}

function update(dt) {
  if (!shell.update()) return;

  particles.update(dt);
  firePhase += dt;
  if (shake > 0) shake = Math.max(0, shake - dt * 2);
  if (bearTimer > 0) bearTimer = Math.max(0, bearTimer - dt);
  if (flash) { flash.life -= dt; if (flash.life <= 0) flash = null; }

  // The piles ease toward the truth.
  for (const key of Object.keys(shown)) {
    shown[key] += (target[key] - shown[key]) * Math.min(1, dt * 7);
  }

  for (const f of snowflakes) {
    f.y += (16 + f.drift) * dt;
    f.x += Math.sin(firePhase * 0.6 + f.y * 0.02) * 7 * dt;
    if (f.y > H) { f.y = -4; f.x = randRange(0, W); }
  }

  if (!running) return;

  // The pack running at the wall, before the night's report.
  if (chargeTimer > 0) {
    chargeTimer = Math.max(0, chargeTimer - dt);
    if (chargeTimer === 0 && pendingNight) {
      nightPanel = pendingNight;
      pendingNight = null;
      if (!camp.running) finish();
    }
    return;
  }

  if (perf.active) { stepPerformance(dt); return; }

  actor.pose = 'idle';

  if (nightPanel) {
    if (Input.pressed('a') || Input.pressed('b') || Input.pressed('start')) nightPanel = null;
    return;
  }

  const pad = Input.get();
  const dir = Math.abs(pad.y) > 0.5 ? Math.sign(pad.y) : 0;
  if (dir !== 0 && navLatch === 0) {
    selected = (selected + dir + MENU.length) % MENU.length;
    audio.play('move');
  }
  navLatch = dir;

  if (Input.pressed('a')) beginAction();
  else if (Input.pressed('b')) endDay();
  // Out of actions and nothing left to do: the day ends itself rather than
  // stranding the player on a menu where nothing responds.
  else if (camp.actionsLeft <= 0) endDay();
}

// --- Drawing the world ---------------------------------------------------

/** A ground diamond centred on a world point — the unit of everything flat. */
function diamond(cx, cy, rx, ry) {
  ctx.beginPath();
  ctx.moveTo(isoX(cx - rx, cy - ry), isoY(cx - rx, cy - ry));
  ctx.lineTo(isoX(cx + rx, cy - ry), isoY(cx + rx, cy - ry));
  ctx.lineTo(isoX(cx + rx, cy + ry), isoY(cx + rx, cy + ry));
  ctx.lineTo(isoX(cx - rx, cy + ry), isoY(cx - rx, cy + ry));
  ctx.closePath();
}

/** 0 at the start of the day, 1 by the time the last action is spent. */
function duskFactor() {
  return clamp(1 - camp.actionsLeft / TUNING.actionsPerDay, 0, 1);
}

function drawSky() {
  const d = duskFactor();
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.72);
  g.addColorStop(0, mixRgb(ART.sky.dayTop, ART.sky.duskTop, d));
  g.addColorStop(1, mixRgb(ART.sky.dayLow, ART.sky.duskLow, d));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawGround() {
  // Everything beyond the treeline: the dark the wolves come out of.
  ctx.fillStyle = ART.ground.beyond;
  diamond(0, 0, 13, 13);
  ctx.fill();

  // The clearing.
  ctx.fillStyle = ART.ground.snow;
  diamond(0, 0, 8.6, 8.6);
  ctx.fill();

  // The compound floor, lit by the fire and a shade brighter.
  ctx.fillStyle = ART.ground.snowLit;
  diamond(0, 0, WALL_R - 0.2, WALL_R - 0.2);
  ctx.fill();
  ctx.strokeStyle = ART.ground.edge;
  ctx.lineWidth = 1;
  diamond(0, 0, WALL_R - 0.2, WALL_R - 0.2);
  ctx.stroke();

  // Paths worn between the fire and the places you keep going back to. Kept
  // faint and kept INSIDE the compound: at full strength they read as planks
  // laid on the snow rather than as trodden ground.
  ctx.save();
  diamond(0, 0, WALL_R - 0.4, WALL_R - 0.4);
  ctx.clip();
  ctx.strokeStyle = ART.ground.trodden;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  for (const place of [PLACE.logs, PLACE.rack, PLACE.shelter, PLACE.fire]) {
    ctx.beginPath();
    ctx.moveTo(isoX(PLACE.home.x, PLACE.home.y), isoY(PLACE.home.x, PLACE.home.y));
    ctx.lineTo(isoX(place.x * 0.86, place.y * 0.86), isoY(place.x * 0.86, place.y * 0.86));
    ctx.stroke();
  }
  ctx.restore();
  ctx.lineCap = 'butt';
}

/** The ring showing where the selected action would send you. */
function drawTargetMarker() {
  if (!running || perf.active || nightPanel || chargeTimer > 0) return;
  const to = targetFor(MENU[selected].action);
  ctx.strokeStyle = ART.hud.marker;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.6 + Math.sin(firePhase * 4) * 0.25;
  diamond(to.x, to.y, 0.7, 0.7);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawTree(tree) {
  const x = isoX(tree.x, tree.y);
  const y = isoY(tree.x, tree.y);
  if (tree.stump) {
    ctx.fillStyle = ART.tree.stump;
    ctx.fillRect(x - 5, y - 7, 10, 7);
    ctx.fillStyle = ART.tree.snow;
    ctx.fillRect(x - 5, y - 8, 10, 2);
    return;
  }
  ctx.fillStyle = ART.tree.trunk;
  ctx.fillRect(x - 3, y - 12, 6, 12);
  const colour = tree.far ? ART.tree.far : ART.tree.near;
  for (let tier = 0; tier < 3; tier++) {
    const top = y - tree.h + tier * (tree.h * 0.24);
    const spread = 8 + tier * 5.5;
    const base = top + tree.h * 0.36;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x - spread, base);
    ctx.lineTo(x + spread, base);
    ctx.closePath();
    ctx.fill();
    // Snow caught on the branches, which is what stops the treeline reading as
    // one black wall.
    ctx.fillStyle = ART.tree.snow;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x - spread * 0.5, base - tree.h * 0.11);
    ctx.lineTo(x + spread * 0.5, base - tree.h * 0.11);
    ctx.closePath();
    ctx.fill();
  }
}

function drawFire() {
  const x = isoX(PLACE.fire.x, PLACE.fire.y);
  const y = isoY(PLACE.fire.x, PLACE.fire.y);
  const lit = camp.wood >= camp.fuelTonight;
  const flicker = 1 + Math.sin(firePhase * 9) * 0.13 + Math.sin(firePhase * 21) * 0.05;
  const size = (lit ? 26 : 12) * flicker;

  // A radial falloff rather than a flat ellipse — a hard-edged disc of warm
  // colour on snow reads as a stain, not as light.
  const reach = size * 4.6;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, reach);
  glow.addColorStop(0, lit ? ART.fire.glow : ART.fire.dyingGlow);
  glow.addColorStop(1, ART.fire.glowOut);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.5);
  ctx.translate(-x, -y);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, reach, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = lit ? ART.fire.logs : ART.fire.ash;
  ctx.fillRect(x - 16, y - 5, 32, 6);
  ctx.fillRect(x - 6, y - 9, 26, 5);

  const flames = lit
    ? [[size, ART.fire.low], [size * 0.64, ART.fire.mid], [size * 0.32, ART.fire.core]]
    : [[size, ART.fire.ember], [size * 0.45, ART.fire.emberCore]];
  for (const [r, colour] of flames) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.62 - 4, r * 0.62, r, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (lit && Math.random() < 0.4) {
    particles.emit(x + randRange(-8, 8), y - 18, {
      ...ParticlePresets.sparkle, count: 1, colors: ART.spark,
      speed: [14, 46], size: [1, 2.6], life: [0.5, 1.1],
    });
  }
}

function drawShelter() {
  const x = isoX(PLACE.shelter.x, PLACE.shelter.y);
  const y = isoY(PLACE.shelter.x, PLACE.shelter.y);
  ctx.fillStyle = ART.shelter.side;
  ctx.beginPath();
  ctx.moveTo(x - 40, y - 6); ctx.lineTo(x, y + 14); ctx.lineTo(x, y - 26); ctx.lineTo(x - 40, y - 46);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = ART.shelter.wall;
  ctx.beginPath();
  ctx.moveTo(x + 40, y - 6); ctx.lineTo(x, y + 14); ctx.lineTo(x, y - 26); ctx.lineTo(x + 40, y - 46);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = ART.shelter.roof;
  ctx.beginPath();
  ctx.moveTo(x, y - 26); ctx.lineTo(x + 40, y - 46); ctx.lineTo(x, y - 66); ctx.lineTo(x - 40, y - 46);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = ART.shelter.snow;
  ctx.beginPath();
  ctx.moveTo(x, y - 30); ctx.lineTo(x + 40, y - 50); ctx.lineTo(x, y - 66); ctx.lineTo(x - 40, y - 50);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = ART.shelter.door;
  ctx.beginPath();
  ctx.moveTo(x + 6, y - 2); ctx.lineTo(x + 20, y - 9); ctx.lineTo(x + 20, y - 27); ctx.lineTo(x + 6, y - 20);
  ctx.closePath(); ctx.fill();
}

/**
 * The log stack. Stock is legible from the pile: rows of log-ends that grow up
 * and outward, so a camp holding sixty logs and a camp holding six do not look
 * remotely alike before you have read a single number.
 */
function drawLogs() {
  const x = isoX(PLACE.logs.x, PLACE.logs.y);
  const y = isoY(PLACE.logs.x, PLACE.logs.y);
  const count = clamp(Math.round(shown.wood / 3), 0, 36);
  if (count === 0) {
    ctx.fillStyle = ART.ground.snowShade;
    ctx.beginPath();
    ctx.ellipse(x, y, 28, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const perRow = 4;
  const topRow = Math.floor((count - 1) / perRow);
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    // Alternate rows are staggered so it reads as stacked timber, not a grid.
    const lx = x - 22 + col * 12 + (row % 2) * 6;
    const ly = y - 4 - row * 9;
    ctx.fillStyle = ART.logs.bark;
    ctx.fillRect(lx - 6, ly - 9, 12, 10);
    ctx.fillStyle = row === topRow ? ART.logs.endLit : ART.logs.end;
    ctx.beginPath();
    ctx.ellipse(lx, ly - 4, 5, 4.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The drying rack. Meat hangs from it; an empty rack is bare rope. */
function drawRack() {
  const x = isoX(PLACE.rack.x, PLACE.rack.y);
  const y = isoY(PLACE.rack.x, PLACE.rack.y);
  ctx.fillStyle = ART.rack.post;
  ctx.fillRect(x - 34, y - 46, 5, 46);
  ctx.fillRect(x + 29, y - 46, 5, 46);
  ctx.strokeStyle = ART.rack.rope;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 32, y - 42); ctx.lineTo(x + 32, y - 42);
  ctx.stroke();

  const strips = clamp(Math.round(shown.meat / 2), 0, 10);
  for (let i = 0; i < strips; i++) {
    const sx = x - 28 + i * 6.2;
    const sway = Math.sin(firePhase * 1.6 + i) * 1.4;
    ctx.fillStyle = i % 3 === 0 ? ART.rack.meatFat : ART.rack.meat;
    ctx.fillRect(sx + sway, y - 41, 4, 15 + (i % 3) * 3);
  }
}

/**
 * The wall. Posts rise one at a time from the front, and the pack knocks them
 * out — so "the wall visibly grows and visibly takes damage" is one list read
 * two ways rather than an effect layered on top of a number.
 */
function wallPostsToDraw() {
  const standing = postsFor(shown.wall);
  const out = [];
  for (let i = 0; i < WALL_SLOTS.length; i++) {
    const slot = WALL_SLOTS[i];
    if (i < standing) out.push({ slot, state: 'up' });
    else if (brokenPosts.includes(i)) out.push({ slot, state: 'broken' });
    else if (i === standing) out.push({ slot, state: 'next' });
    else out.push({ slot, state: 'ghost' });
  }
  return out;
}

function drawWallPost(post) {
  const x = isoX(post.slot.x, post.slot.y);
  const y = isoY(post.slot.x, post.slot.y);
  const half = ISO.tw / 2 - 3;
  const halfY = ISO.th / 2 - 1.5;

  if (post.state === 'ghost' || post.state === 'next') {
    // The gap, drawn as an outline: the whole unbuilt perimeter faintly, and
    // the slot the next build will fill brightly. This is the readiness number
    // standing on the ground — you can see exactly where the wall stops.
    const next = post.state === 'next';
    ctx.strokeStyle = next ? ART.wall.nextGhost : ART.wall.ghost;
    ctx.lineWidth = next ? 2 : 1;
    ctx.setLineDash(next ? [5, 3] : [3, 6]);
    ctx.beginPath();
    ctx.moveTo(x - half, y); ctx.lineTo(x, y - halfY);
    ctx.lineTo(x + half, y); ctx.lineTo(x, y + halfY);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  if (post.state === 'broken') {
    // What the pack left. Stone the colour of the wall rather than of soil, so
    // it reads as "this was a post", and jagged chunks so it does not read as
    // a post that is merely short.
    ctx.fillStyle = ART.wall.rubble;
    ctx.beginPath();
    ctx.moveTo(x - half, y); ctx.lineTo(x, y - halfY);
    ctx.lineTo(x + half, y); ctx.lineTo(x, y + halfY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = ART.wall.rubbleChunk;
    for (const [dx, dy, w, h] of [[-12, -2, 9, 7], [2, 2, 11, 8], [-2, -7, 7, 6]]) {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy);
      ctx.lineTo(x + dx + w, y + dy - h * 0.4);
      ctx.lineTo(x + dx + w * 0.6, y + dy + h * 0.5);
      ctx.closePath();
      ctx.fill();
    }
    return;
  }

  const height = 30;
  ctx.fillStyle = ART.wall.face;
  ctx.beginPath();
  ctx.moveTo(x - half, y); ctx.lineTo(x, y + halfY);
  ctx.lineTo(x, y + halfY - height); ctx.lineTo(x - half, y - height);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = ART.wall.side;
  ctx.beginPath();
  ctx.moveTo(x + half, y); ctx.lineTo(x, y + halfY);
  ctx.lineTo(x, y + halfY - height); ctx.lineTo(x + half, y - height);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = ART.wall.top;
  ctx.beginPath();
  ctx.moveTo(x - half, y - height); ctx.lineTo(x, y - halfY - height);
  ctx.lineTo(x + half, y - height); ctx.lineTo(x, y + halfY - height);
  ctx.closePath(); ctx.fill();
}

function drawWolf(wolf) {
  const charge = chargeTimer > 0 ? 1 - chargeTimer / CHARGE_SECONDS : 0;
  // During the charge they run in at the wall; otherwise they pace.
  const pace = Math.sin(firePhase * 1.2 + wolf.phase) * 0.5;
  const wx = lerp(wolf.x + pace * 0.2, wolf.x * 0.54, charge);
  const wy = lerp(wolf.y + pace * 0.2, wolf.y * 0.54, charge);
  const x = isoX(wx, wy);
  const y = isoY(wx, wy);
  const bob = Math.sin(firePhase * (charge > 0 ? 14 : 3) + wolf.phase) * (charge > 0 ? 2.5 : 0.8);

  ctx.fillStyle = ART.wolf.body;
  ctx.beginPath();
  ctx.ellipse(x, y - 9 + bob, 11, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ART.wolf.back;
  ctx.fillRect(x - 9, y - 14 + bob, 18, 4);
  for (const dx of [-7, -2, 3, 8]) {
    const swing = Math.sin(firePhase * (charge > 0 ? 18 : 4) + dx + wolf.phase) * 2;
    ctx.fillRect(x + dx, y - 5 + bob, 2, 6 + swing);
  }
  // Head, and the eyes that are the whole reason they are on screen.
  const hx = x + 12;
  ctx.fillStyle = ART.wolf.body;
  ctx.beginPath();
  ctx.ellipse(hx, y - 12 + bob, 6, 4.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ART.wolf.eye;
  ctx.beginPath();
  ctx.arc(hx + 2, y - 13 + bob, 1.4, 0, Math.PI * 2);
  ctx.arc(hx + 5, y - 13 + bob, 1.4, 0, Math.PI * 2);
  ctx.fill();
  // Breath in the cold, which is what makes them read as alive at this size.
  ctx.fillStyle = ART.wolf.breath;
  ctx.beginPath();
  ctx.arc(hx + 9 + Math.sin(firePhase * 2 + wolf.phase) * 3, y - 12 + bob, 2.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawBear() {
  const x = isoX(PLACE.hunt.x, PLACE.hunt.y);
  const y = isoY(PLACE.hunt.x, PLACE.hunt.y);
  const rear = clamp(bearTimer / 1.8, 0, 1);
  ctx.fillStyle = ART.bear.body;
  ctx.beginPath();
  ctx.ellipse(x, y - 20, 20, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ART.bear.head;
  ctx.beginPath();
  ctx.arc(x + 14, y - 34 - rear * 8, 10, 0, Math.PI * 2);
  ctx.arc(x + 8, y - 43 - rear * 8, 3.4, 0, Math.PI * 2);
  ctx.arc(x + 20, y - 43 - rear * 8, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ART.bear.claw;
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 22 + i * 4, y - 26 - rear * 6);
    ctx.lineTo(x + 28 + i * 4, y - 18 - rear * 6);
    ctx.stroke();
  }
}

/**
 * The character.
 *
 * A figure in a red coat — the only warm colour in the world apart from the
 * fire, so the eye finds them instantly against the snow. The pose says what
 * they are doing: walking, swinging an axe at a tree, heaving a post upright,
 * or lining up a shot out in the woods.
 */
function drawPerson() {
  const x = isoX(actor.x, actor.y);
  const y = isoY(actor.x, actor.y);
  const f = actor.face;
  const swing = Math.sin(actor.stride);
  const bob = actor.pose === 'walk'
    ? Math.abs(Math.cos(actor.stride)) * 2
    : Math.sin(firePhase * 2) * 1.1;
  const top = y - 34 - bob;

  // A shadow, which is what plants them on the ground rather than floating.
  ctx.fillStyle = ART.person.shadow;
  ctx.beginPath();
  ctx.ellipse(x, y, 9, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs.
  ctx.lineCap = 'round';
  ctx.strokeStyle = ART.person.trouser;
  ctx.lineWidth = 4;
  const legSwing = actor.pose === 'walk' ? swing * 5 : 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y - 14); ctx.lineTo(x + legSwing, y - 1);
  ctx.moveTo(x, y - 14); ctx.lineTo(x - legSwing, y - 1);
  ctx.stroke();
  ctx.strokeStyle = ART.person.boot;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + legSwing, y - 1); ctx.lineTo(x + legSwing + f * 3, y);
  ctx.moveTo(x - legSwing, y - 1); ctx.lineTo(x - legSwing + f * 3, y);
  ctx.stroke();

  // Coat.
  ctx.fillStyle = ART.person.coat;
  ctx.beginPath();
  ctx.roundRect(x - 6, top + 8, 12, 18, 3);
  ctx.fill();

  // Arms, and whatever is in them. This is where the pose lives.
  ctx.strokeStyle = ART.person.coat;
  ctx.lineWidth = 3.5;
  let handX = x + f * 9;
  let handY = top + 16;
  if (actor.pose === 'chop') {
    // A full swing, over the shoulder and down.
    const phase = Math.sin(perf.t * 14);
    handX = x + f * (10 + phase * 3);
    handY = top + 10 - phase * 12;
  } else if (actor.pose === 'lift') {
    // Both hands up, heaving a post into place.
    handX = x + f * 6;
    handY = top + 2 + Math.sin(perf.t * 9) * 3;
  } else if (actor.pose === 'aim') {
    handX = x + f * 13;
    handY = top + 13;
  } else if (actor.pose === 'walk') {
    handX = x + f * 7 + swing * 3;
    handY = top + 16 - Math.abs(swing) * 2;
  }
  ctx.beginPath();
  ctx.moveTo(x, top + 12); ctx.lineTo(handX, handY);
  ctx.moveTo(x, top + 12); ctx.lineTo(x - f * 6, top + 17);
  ctx.stroke();

  // The tool.
  if (actor.pose === 'chop') {
    ctx.strokeStyle = ART.person.tool;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(handX, handY); ctx.lineTo(handX + f * 12, handY + 8);
    ctx.stroke();
    ctx.fillStyle = ART.person.blade;
    ctx.beginPath();
    ctx.moveTo(handX + f * 10, handY + 6);
    ctx.lineTo(handX + f * 16, handY + 4);
    ctx.lineTo(handX + f * 15, handY + 12);
    ctx.closePath();
    ctx.fill();
  } else if (actor.pose === 'aim') {
    ctx.strokeStyle = ART.person.tool;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(handX - f * 8, handY + 6); ctx.lineTo(handX + f * 14, handY - 4);
    ctx.stroke();
    ctx.fillStyle = ART.person.blade;
    ctx.beginPath();
    ctx.moveTo(handX + f * 12, handY - 6);
    ctx.lineTo(handX + f * 18, handY - 4);
    ctx.lineTo(handX + f * 12, handY - 1);
    ctx.closePath();
    ctx.fill();
  } else if (actor.pose === 'lift') {
    ctx.fillStyle = ART.wall.top;
    ctx.fillRect(handX - 8, handY - 8, 16, 8);
  }

  // Head and hood.
  ctx.fillStyle = ART.person.skin;
  ctx.beginPath();
  ctx.arc(x + f * 1, top + 3, 4.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ART.person.hood;
  ctx.beginPath();
  ctx.arc(x, top + 2, 5.6, Math.PI * 0.85, Math.PI * 2.15);
  ctx.fill();
  ctx.lineCap = 'butt';
}

/** Everything that stands up off the ground, drawn back to front. */
function drawSprites() {
  const standing = treesStanding();
  const items = [];

  TREES.forEach((tree, i) => {
    if (i >= standing && !tree.stump) return;   // the forest thinning by week
    items.push({ d: depthOf(tree.x, tree.y), draw: () => drawTree(tree) });
  });

  const onScreen = Math.round(
    wolfPresence() * Math.min(WOLVES.length, 3 + camp.week * 1.6),
  );
  for (let i = 0; i < onScreen; i++) {
    const wolf = WOLVES[i];
    items.push({ d: depthOf(wolf.x, wolf.y) - 0.1, draw: () => drawWolf(wolf) });
  }

  if (bearTimer > 0) items.push({ d: depthOf(PLACE.hunt.x, PLACE.hunt.y), draw: drawBear });

  for (const post of wallPostsToDraw()) {
    items.push({ d: depthOf(post.slot.x, post.slot.y), draw: () => drawWallPost(post) });
  }

  items.push({ d: depthOf(PLACE.shelter.x, PLACE.shelter.y), draw: drawShelter });
  items.push({ d: depthOf(PLACE.logs.x, PLACE.logs.y), draw: drawLogs });
  items.push({ d: depthOf(PLACE.rack.x, PLACE.rack.y), draw: drawRack });
  items.push({ d: depthOf(PLACE.fire.x, PLACE.fire.y), draw: drawFire });
  items.push({ d: depthOf(actor.x, actor.y) + 0.05, draw: drawPerson });

  items.sort((a, b) => a.d - b.d);
  for (const item of items) item.draw();
}

// --- The readouts --------------------------------------------------------

/**
 * One resource: label, bar, number, on a single line.
 *
 * Laid out as rows in a panel rather than strung across the top of the screen,
 * which is where the first version put them — over a pale sky the tracks
 * vanished and the four readings ran together into one long line that read as
 * a single meaningless bar.
 */
function bar(x, y, w, label, value, max, colour) {
  const barX = x + 48;
  const barW = w - 48 - 30;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 9px system-ui, sans-serif';
  ctx.fillText(label, x, y);
  ctx.fillStyle = ART.hud.barTrack;
  ctx.beginPath(); ctx.roundRect(barX, y - 4, barW, 8, 4); ctx.fill();
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.roundRect(barX, y - 4, Math.max(3, barW * clamp(value / max, 0, 1)), 8, 4);
  ctx.fill();
  ctx.textAlign = 'right';
  ctx.fillStyle = ART.hud.value;
  ctx.font = '700 11px system-ui, sans-serif';
  ctx.fillText(String(Math.round(value)), x + w, y);
  ctx.textBaseline = 'top';
}

function drawHud() {
  // The ledger, top left, on its own ground so it never fights the sky.
  const px = 16;
  const py = 14;
  const pw = 224;
  const ph = 118;
  ctx.fillStyle = ART.hud.panel;
  ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 10); ctx.fill();
  ctx.strokeStyle = ART.hud.panelEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ART.hud.value;
  ctx.font = '800 22px system-ui, sans-serif';
  ctx.fillText(`WEEK ${camp.week}`, px + 14, py + 28);
  ctx.textAlign = 'right';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText(`DAY ${camp.day}`, px + pw - 14, py + 20);
  ctx.fillText(`${camp.actionsLeft} ACTIONS LEFT`, px + pw - 14, py + 32);

  bar(px + 14, py + 52, pw - 28, 'WOOD', camp.wood, 120, ART.logs.end);
  bar(px + 14, py + 71, pw - 28, 'MEAT', camp.meat, 60, ART.rack.meatFat);
  bar(px + 14, py + 90, pw - 28, 'WALL', camp.wall, 140, ART.wall.top);
  bar(px + 14, py + 109, pw - 28, 'HEALTH', camp.health, TUNING.maxHealth,
    camp.health < 35 ? ART.hud.notReady : ART.hud.ready);

  // The deadline, top right. A player has to be able to see on day three that
  // day seven is already lost — that is the readout the whole design turns on,
  // and the gap in the wall out there is the same fact drawn on the ground.
  const ready = camp.readiness >= 0;
  const qw = 214;
  const qx = W - 16 - qw;
  ctx.fillStyle = ART.hud.panel;
  ctx.beginPath(); ctx.roundRect(qx, py, qw, 84, 10); ctx.fill();
  ctx.strokeStyle = ART.hud.panelEdge;
  ctx.stroke();

  ctx.textAlign = 'right';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText(`THE FIRE WANTS ${camp.fuelTonight} TONIGHT`, qx + qw - 14, py + 22);
  ctx.fillText(
    camp.daysToWolves === 0
      ? `WOLVES TONIGHT · PACK ${packFor(camp.day)}`
      : `WOLVES IN ${camp.daysToWolves} NIGHTS · PACK ${packFor(camp.day)}`,
    qx + qw - 14, py + 38,
  );
  ctx.fillStyle = ready ? ART.hud.ready : ART.hud.notReady;
  ctx.font = '800 17px system-ui, sans-serif';
  ctx.fillText(
    ready ? `THE WALL HOLDS  +${camp.readiness}` : `THE WALL FALLS  ${camp.readiness}`,
    qx + qw - 14, py + 62,
  );
  ctx.textBaseline = 'top';
}

function drawMenu() {
  if (nightPanel || !running || chargeTimer > 0) return;
  const x = 20;
  const y = H - 128;
  ctx.globalAlpha = perf.active ? 0.45 : 1;
  ctx.fillStyle = ART.hud.panel;
  ctx.beginPath(); ctx.roundRect(x, y, 330, 108, 10); ctx.fill();
  ctx.strokeStyle = ART.hud.panelEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  MENU.forEach((item, i) => {
    const iy = y + 13 + i * 31;
    const on = i === selected;
    if (on) {
      ctx.fillStyle = ART.hud.selectedFill;
      ctx.beginPath(); ctx.roundRect(x + 8, iy - 4, 314, 27, 6); ctx.fill();
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = on ? ART.hud.selected : ART.hud.value;
    ctx.font = `${on ? '700' : '500'} 14px system-ui, sans-serif`;
    ctx.fillText(item.label, x + 18, iy);

    ctx.textAlign = 'right';
    ctx.fillStyle = ART.hud.label;
    ctx.font = '600 11px system-ui, sans-serif';
    let note = '';
    if (item.action === ACTION.GATHER) note = `+${gatherYield(camp.day)} wood`;
    if (item.action === ACTION.HUNT) {
      note = `+${TUNING.meatPerHunt} meat · bear ${Math.round(bearChance(camp.day) * 100)}%`;
    }
    if (item.action === ACTION.BUILD) {
      note = camp.canBuild
        ? `−${TUNING.woodPerBuild} wood · +${TUNING.wallPerBuild} wall`
        : (camp.buildsToday >= TUNING.maxBuildsPerDay ? 'already built today' : 'not enough wood');
    }
    ctx.fillText(note, x + 314, iy + 2);
  });
  ctx.globalAlpha = 1;
}

function drawNightPanel() {
  if (!nightPanel) return;
  const n = nightPanel;
  const w = 440;
  const h = 214;
  const x = (W - w) / 2;
  const y = (H - h) / 2;

  ctx.fillStyle = ART.hud.scrim;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = ART.hud.panel;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
  ctx.strokeStyle = ART.hud.panelEdge;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = ART.hud.value;
  ctx.font = '800 19px system-ui, sans-serif';
  ctx.fillText(`Night ${n.day}`, W / 2, y + 16);

  const lines = [
    n.froze
      ? [`The fire went out. It wanted ${n.fuelWanted}, you had ${n.burned}.`, ART.hud.notReady]
      : [`The fire held. Burned ${n.burned}.`, ART.hud.ready],
    n.starved ? ['Nothing to eat.', ART.hud.notReady] : [`Ate ${n.ate}.`, ART.hud.ready],
  ];
  if (n.wolves) {
    lines.push(n.breached > 0
      ? [`The pack came — ${n.packStrength} strong. ${n.breached} got through.`, ART.hud.notReady]
      : [`The pack came — ${n.packStrength} strong. The wall held.`, ART.hud.ready]);
  }
  if (n.healed) lines.push([`Rested. +${n.healed} health.`, ART.hud.ready]);

  lines.forEach(([text, colour], i) => {
    ctx.fillStyle = colour;
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText(text, W / 2, y + 58 + i * 26);
  });

  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText('Any button to go on', W / 2, y + h - 26);
}

function render() {
  drawSky();
  ctx.save();
  if (shake > 0) ctx.translate(randRange(-1, 1) * shake * 7, randRange(-1, 1) * shake * 7);
  drawGround();
  drawTargetMarker();
  drawSprites();
  particles.draw(ctx);
  ctx.restore();

  // Snowfall over everything in the world, but under the readouts.
  ctx.fillStyle = ART.snowfall;
  for (const f of snowflakes) {
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawHud();
  drawMenu();

  if (flash) {
    ctx.globalAlpha = clamp(flash.life, 0, 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = flash.colour;
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.fillText(flash.text, W / 2, 122);
    ctx.globalAlpha = 1;
  }

  drawNightPanel();
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
  title: 'Winter Base Building',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Choose', gamepad: 'Stick or D-pad up/down', keyboard: 'Up / Down', touch: 'Drag the left side' },
    { action: 'Do it', gamepad: 'A', keyboard: 'Space', touch: 'Do it pad' },
    { action: 'Sleep', gamepad: 'B', keyboard: 'Shift', touch: 'Sleep pad' },
    { action: 'Hurry', gamepad: 'Hold A or B', keyboard: 'Hold Space', touch: 'Hold a pad' },
    { action: 'Wood', gamepad: 'Burns AND builds', keyboard: 'Burns AND builds', touch: 'Burns AND builds' },
    { action: 'Bears', gamepad: 'The risk of hunting', keyboard: 'The risk of hunting', touch: 'The risk of hunting' },
    { action: 'Wolves', gamepad: 'Every seventh night', keyboard: 'Every seventh night', touch: 'Every seventh night' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({
  name: 'Winter Base Building',
  tagline: 'Wood burns. Wood builds. There is never enough.',
});
