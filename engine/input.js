// engine/input.js
//
// Unified input for Studio 22.
//
// Every game reads player intent through Input.get(playerIndex) and never
// touches the Gamepad API, keyboard events, or touch events directly. That's
// the whole point of this module: a jump button means the same thing whether
// it came from a controller, a keyboard, or a thumb on glass, and a game
// should never have to care which one it was.
//
// Design in one paragraph: every frame, update() polls all three device
// classes (gamepad is polled here because the Gamepad API has no "moved"
// event; keyboard and touch update themselves continuously via DOM events
// and update() just reads the accumulated state) and merges them per player
// slot. Movement/aim are merged by picking whichever source currently has
// the largest stick deflection, so a player can drop a controller and grab
// the keyboard mid-game without a dead frame. Buttons are merged with OR,
// so any device pressing "jump" counts as jump.
//
// Player-to-device assumptions (documented because they're invisible in the
// API otherwise):
//   - Gamepad index N drives player N. Simplest mapping, matches how
//     controllers get assigned in plug-in order on real arcade cabinets.
//   - Touch only ever drives player 0. A single touchscreen is one player;
//     party mode uses keyboard layouts (see setKeyboardLayout) for more.
//   - Keyboard player 0 gets a generous default (WASD + arrows + space/
//     enter/shift/escape) so the common single-player case needs zero
//     setup. Players 1-3 get no keyboard mapping until setKeyboardLayout()
//     assigns them one (party mode wires this up explicitly).

// --- Tunables -----------------------------------------------------------

const MAX_PLAYERS = 4;

// How far a stick has to move off center before it counts as input at all.
// Cheap sticks rest a few percent off zero; without this, idle controllers
// would dribble tiny movement values into every game.
const DEFAULT_DEADZONE = 0.15;

// Analog triggers (LT/RT) are exposed as booleans per the spec below, so we
// need a point on the 0-1 trigger travel that counts as "pressed."
const TRIGGER_THRESHOLD = 0.3;

// How far (in CSS pixels) a thumb has to drag from a virtual stick's origin
// before it's reporting full deflection (1.0).
//
// Exported because engine/shell.js draws these sticks, and a drawn ring that
// disagrees with the distance the stick actually saturates at feels broken
// in a way players can see but not name -- the knob either stops short of
// the ring or runs past it.
export const JOYSTICK_MAX_RADIUS_PX = 55;

// Breathing room outside a pad's own radius, in CSS pixels. Rings that merely
// touch still read as one shape, and a thumb is wider than a pixel.
const PAD_AIR = 6;

// How many times the pad cluster is relaxed. Three pads is the most any game
// declares, so this is generous; a fixed count keeps the result deterministic,
// which matters because it is recomputed every frame and a pad that settled to
// a slightly different place each time would visibly crawl.
const PAD_RELAX_PASSES = 12;

// How finely the ring around the stick is sampled when a pad has to be moved
// off it. Every 5.6 degrees, which is finer than the pixel difference it makes
// on any phone.
const STICK_RING_SAMPLES = 64;

// How far a touch may wander, and how long it may last, and still count as a
// tap rather than a stick drag. Eight pixels is under a third of the deadzone
// the stick itself applies, so a touch this still was never steering anything;
// 300ms is the usual line between a poke and a hold.
const TAP_SLOP_PX = 8;
const TAP_HOLD_MS = 300;

// performance.now() where there is one. The tests import this module under
// Node, where the global exists but has not always, and a clock is not worth
// a crash.
const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());

// The full set of digital buttons in the normalized state object. Kept as a
// list (rather than re-typing it everywhere) so merge/copy helpers below
// can loop instead of repeating ten field names.
// ls/rs are the stick clicks (L3/R3) -- pressing straight down on a thumb
// stick. Gamepad and keyboard only: there is no thumb-stick to click on a
// touchscreen, so the virtual controls never produce them.
const BUTTON_NAMES = [
  'a', 'b', 'btnX', 'btnY', 'start', 'back', 'lb', 'rb', 'lt', 'rt', 'ls', 'rs',
];

// The four directions, tracked for edges the same way the face buttons are.
//
// WHY THIS EXISTS
// ---------------
// Movement is an ANALOGUE vector, so up/down/left/right are not in
// BUTTON_NAMES and never were. That meant Input.pressed('up') read an
// undefined slot and returned false forever — silently, because asking for a
// button that does not exist is not an error.
//
// Two games were written against it. Block Buster shipped with 'Hard drop: B
// or up' printed in its own controls list and the Up half has never once
// worked; Ballast inherited the same line. Nobody noticed because B works and
// a dead alternative looks exactly like a player who did not try it.
//
// Found by tests/engine.input.test.mjs, which is the whole argument for
// covering engine/ — this is shared code, so one gap was two broken games.
//
// A direction counts as pressed once the merged vector crosses
// DIRECTION_THRESHOLD, which is the same figure the shell and the tournament
// UI already use to turn a stick into menu navigation.
// Matches NAV_THRESHOLD in shell.js and tournament-ui.js. Half deflection is
// far enough to be deliberate and near enough not to need a firm push.
const DIRECTION_THRESHOLD = 0.5;

// Derived in one place and used by both the held-state frame and the
// edge-tracked snapshot, so the two can never disagree about which way the
// player is pointing.
function directionsFrom(x, y) {
  return {
    up: y <= -DIRECTION_THRESHOLD,
    down: y >= DIRECTION_THRESHOLD,
    left: x <= -DIRECTION_THRESHOLD,
    right: x >= DIRECTION_THRESHOLD,
  };
}

// Elements that own their own taps. A touch starting on one of these belongs
// to the page, not to the game: claiming it would both steal the input and
// suppress the click the element is waiting for. Games can opt any other
// element out with data-no-game-input.
const INTERACTIVE_SELECTOR = [
  'button', 'a[href]', 'input', 'select', 'textarea', 'label', 'summary',
  '[role="button"]', '[contenteditable=""]', '[contenteditable="true"]',
  '[data-no-game-input]',
].join(', ');

function startedOnPageUi(target) {
  return Boolean(target && typeof target.closest === 'function' && target.closest(INTERACTIVE_SELECTOR));
}

// Arrow keys and space scroll the page by default; that's the one browser
// behavior every game needs suppressed during play.
const PREVENT_DEFAULT_KEY_CODES = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
]);

// Player 0's default keyboard mapping. Both WASD and the arrow keys drive
// movement (so it "just works" for whichever hand a player leads with), and
// each action can be reached by more than one key for the same reason.
// x/y (face buttons X/Y) and start are left unbound by default -- most
// single-player prototypes only need move + jump/confirm + back, and an
// unbound action simply never fires rather than colliding with something.
const DEFAULT_PLAYER0_LAYOUT = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  a: ['Space', 'Enter'],
  b: ['ShiftLeft', 'ShiftRight'],
  x: [],
  y: [],
  start: [],
  back: ['Escape'],
  // Q and E sit either side of the WASD cluster, so a left hand already on
  // the movement keys can reach both stick clicks without moving -- which
  // matches how L3/R3 feel on a pad (thumb already on the stick). Neither
  // collides with the movement keys, Space/Enter, Shift, or Escape.
  ls: ['KeyQ'],
  rs: ['KeyE'],
};

// Named presets for party mode, so four people can share one keyboard
// without stepping on each other's keys. Each preset owns a distinct block
// of the keyboard for both movement and its four face buttons. These are
// sensible defaults, not a hard requirement -- setKeyboardLayout() also
// accepts a fully custom mapping object with the same shape.
const KEYBOARD_LAYOUTS = {
  WASD: {
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    a: ['KeyF'], b: ['KeyG'], x: ['KeyR'], y: ['KeyT'],
    start: ['Digit1'], back: ['Escape'],
    ls: ['KeyQ'], rs: ['KeyE'],
  },
  ARROWS: {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    a: ['Slash'], b: ['Period'], x: ['Comma'], y: ['KeyM'],
    start: ['Digit0'], back: ['Escape'],
    ls: ['Semicolon'], rs: ['Quote'],
  },
  IJKL: {
    up: ['KeyI'], down: ['KeyK'], left: ['KeyJ'], right: ['KeyL'],
    a: ['KeyU'], b: ['KeyO'], x: ['KeyY'], y: ['KeyP'],
    start: ['Digit9'], back: ['Escape'],
    ls: ['KeyH'], rs: ['KeyN'],
  },
  NUMPAD: {
    up: ['Numpad8'], down: ['Numpad5'], left: ['Numpad4'], right: ['Numpad6'],
    a: ['Numpad0'], b: ['NumpadEnter'], x: ['Numpad7'], y: ['Numpad9'],
    start: ['NumpadAdd'], back: ['Escape'],
    ls: ['Numpad1'], rs: ['Numpad3'],
  },
};

// Default touch button cluster: two round buttons in the bottom-right,
// positioned as a fraction of the viewport so they hold their place across
// phones/tablets and orientation changes. "b" sits above-left of "a" to
// match the usual controller face-button muscle memory (A is the big,
// easy-to-reach primary action).
const DEFAULT_TOUCH_LAYOUT = [
  { name: 'b', xRatio: 0.80, yRatio: 0.80, radius: 42 },
  { name: 'a', xRatio: 0.92, yRatio: 0.62, radius: 48 },
];

// --- Small math/merge helpers (module-private, no need to be on the class) ---

// Radial deadzone: below `deadzone` magnitude, report zero. Above it, rescale
// so output ramps from 0 at the deadzone edge to 1 at full deflection,
// instead of jumping straight from 0 to ~0.85 the instant a stick clears the
// deadzone. Operating on the (x, y) vector together (rather than each axis
// separately) keeps diagonal input direction accurate.
function applyRadialDeadzone(rawX, rawY, deadzone) {
  const magnitude = Math.hypot(rawX, rawY);
  if (magnitude < deadzone) return { x: 0, y: 0 };
  const scale = Math.min((magnitude - deadzone) / (1 - deadzone), 1) / magnitude;
  return { x: rawX * scale, y: rawY * scale };
}

// Picks whichever candidate vector currently has the largest magnitude, so
// (for example) a lightly-drifting gamepad stick doesn't drown out a firm
// keyboard press, and a player actively using the keyboard doesn't get
// overridden by a controller resting in their lap. Missing sources (device
// not present for this player) are simply skipped.
// `select` pulls the vector out of each source frame, which is what lets the
// same rule serve both sticks: movement reads x/y, aim reads aimX/aimY.
function pickStrongestVector(frames, select = (frame) => ({ x: frame.x, y: frame.y })) {
  let best = { x: 0, y: 0 };
  let bestMagnitude = 0;
  for (const frame of frames) {
    if (!frame) continue;
    const vector = select(frame);
    const magnitude = Math.hypot(vector.x, vector.y);
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      best = vector;
    }
  }
  return best;
}

// A button counts as pressed if ANY connected device says it's pressed.
function mergeButtonsWithOr(sources) {
  const merged = {};
  for (const name of BUTTON_NAMES) {
    merged[name] = sources.some((source) => Boolean(source && source[name]));
  }
  return merged;
}

function makeZeroedFrame() {
  const frame = { x: 0, y: 0, aimX: 0, aimY: 0 };
  for (const name of BUTTON_NAMES) frame[name] = false;
  return frame;
}

// The visible box and the safe-area insets. See engine/viewport.js.
import { Viewport } from './viewport.js';

export class Input {
  // --- Internal state -----------------------------------------------------
  // Everything below is private: games only ever go through the static
  // methods further down. Kept as static (not instance) fields because
  // there is exactly one keyboard/mouse/touchscreen for the whole page --
  // an Input instance per game would just be an awkward way to share one
  // set of DOM listeners.

  static #deadzone = DEFAULT_DEADZONE;

  // This frame's and last frame's merged state per player, used to detect
  // press/release edges. update() rotates #curButtons into #prevButtons
  // before recomputing, so pressed()/released() always compare "now" to
  // "one frame ago" regardless of when during the frame they're called.
  static #players = Array.from({ length: MAX_PLAYERS }, makeZeroedFrame);
  static #curButtons = Array.from({ length: MAX_PLAYERS }, () => ({}));
  static #prevButtons = Array.from({ length: MAX_PLAYERS }, () => ({}));

  static #keyboardLayouts = [DEFAULT_PLAYER0_LAYOUT, null, null, null];
  static #heldKeys = new Set(); // raw KeyboardEvent.code values currently held down

  static #activeDevice = 'keyboard';

  // The most recent tap, and where the pointer is. #pendingTap is collected by
  // the DOM handlers; update() moves it to #tap so it reads as a one-frame
  // edge, exactly like a button press.
  static #tap = null;
  static #pendingTap = null;
  static #pointerDown = false;
  static #pointerX = 0;
  static #pointerY = 0;

  static #connectCallbacks = [];
  static #disconnectCallbacks = [];

  // Touch is only wired up on touch-capable devices, per the spec -- a
  // desktop browser with no touchscreen should never pay for (or show) a
  // virtual joystick.
  static #touchEnabled =
    typeof window !== 'undefined' &&
    (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
  static #touchLayout = DEFAULT_TOUCH_LAYOUT;
  // Distinct from #touchEnabled (a device capability, fixed at load): this is
  // a runtime switch, so an overlay like the pause menu can stop the virtual
  // stick and pads from firing underneath it.
  static #touchControlsEnabled = true;
  static #joystick = { active: false, touchId: null, originX: 0, originY: 0, x: 0, y: 0 };
  // Whether this game steers at all -- see usesDirectionalTouch.
  static #directionalTouch = true;
  // The play area, in client coordinates. See setControlBounds.
  static #controlBounds = null;
  // The second, optional stick. Off by default: most games steer and press,
  // and a game that doesn't aim should not have half its screen quietly
  // swallowing taps. Games that do aim turn it on with setAimStickEnabled().
  static #aimStick = { active: false, touchId: null, originX: 0, originY: 0, x: 0, y: 0 };
  static #aimStickEnabled = false;
  static #touchButtonState = Object.fromEntries(BUTTON_NAMES.map((name) => [name, false]));
  static #touchButtonTouches = new Map(); // touch identifier -> button name

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  // Call once per frame, before any get()/pressed()/released() calls, from
  // the game loop. This is the only place gamepads get polled (the Gamepad
  // API has no events for stick/button changes -- you have to ask), and it
  // freezes this frame's button states so every read during the frame sees
  // the same snapshot instead of racing a mid-frame DOM event.
  static update() {
    // Rotate last frame's buttons back before overwriting -- this is what
    // pressed()/released() diff against.
    Input.#prevButtons = Input.#curButtons.map((buttons) => ({ ...buttons }));

    for (let i = 0; i < MAX_PLAYERS; i++) {
      const gamepadFrame = Input.#readGamepad(i);
      const keyboardFrame = Input.#readKeyboard(i);
      const touchFrame = i === 0 ? Input.#readTouch() : null;

      const move = pickStrongestVector([gamepadFrame, keyboardFrame, touchFrame]);
      // Aim merges the same way movement does, across every device that can
      // produce it: a gamepad's right stick, or the touch aim stick when a
      // game has switched it on. Keyboards have no aim axis and contribute
      // nothing, which is why a keyboard-only player gets a zero vector here
      // rather than a wrong one.
      const aim = pickStrongestVector(
        [gamepadFrame, touchFrame],
        (frame) => ({ x: frame.aimX, y: frame.aimY }),
      );
      const buttons = mergeButtonsWithOr([gamepadFrame, keyboardFrame, touchFrame]);

      Input.#players[i] = {
        x: move.x, y: move.y, aimX: aim.x, aimY: aim.y,
        // The same four as held state, so get().up reads as naturally as
        // get().a does.
        ...directionsFrom(move.x, move.y),
        ...buttons,
      };

      // Gamepads have no "just moved" event to hook, so activeDevice can
      // only be set to 'gamepad' here, by noticing live input during the
      // poll. Keyboard and touch set it immediately from their own DOM
      // event handlers instead (see #ensureInit below).
      const gamepadIsActive =
        gamepadFrame &&
        (Math.hypot(gamepadFrame.x, gamepadFrame.y) > 0 ||
          Math.hypot(gamepadFrame.aimX, gamepadFrame.aimY) > 0 ||
          BUTTON_NAMES.some((name) => gamepadFrame[name]));
      if (gamepadIsActive) Input.#activeDevice = 'gamepad';
    }

    // A tap lives exactly one frame, the same as pressed().
    Input.#tap = Input.#pendingTap;
    Input.#pendingTap = null;

    Input.#curButtons = Input.#players.map((frame) => {
      const buttons = {};
      for (const name of BUTTON_NAMES) buttons[name] = frame[name];
      // Directions are derived from the merged movement vector rather than
      // read off a device, so a stick, a d-pad, WASD and the touch joystick
      // all produce the same edges.
      Object.assign(buttons, directionsFrom(frame.x, frame.y));
      return buttons;
    });
  }

  // Returns a fresh copy of this player's normalized state. A copy (rather
  // than the internal object) so a game mutating its local reference can
  // never corrupt Input's bookkeeping.
  static get(playerIndex = 0) {
    return { ...(Input.#players[playerIndex] ?? makeZeroedFrame()) };
  }

  static pressed(button, playerIndex = 0) {
    const cur = Input.#curButtons[playerIndex]?.[button] ?? false;
    const prev = Input.#prevButtons[playerIndex]?.[button] ?? false;
    return cur && !prev;
  }

  static released(button, playerIndex = 0) {
    const cur = Input.#curButtons[playerIndex]?.[button] ?? false;
    const prev = Input.#prevButtons[playerIndex]?.[button] ?? false;
    return !cur && prev;
  }

  // -------------------------------------------------------------------
  // Pointing at things
  // -------------------------------------------------------------------
  //
  // Not every game is a stick and a button. Picking a letter out of an
  // alphabet, a tile out of a grid, a spot on a map — on a touchscreen the
  // natural action is to put a finger on the thing, and a virtual stick
  // dragging a cursor across twenty-six cells is a worse game pretending to
  // be a consistent one.
  //
  // So Input reports TAPS as well: a click, or a touch that no touch button
  // and no virtual stick claimed. Coordinates are viewport space, exactly as
  // a MouseEvent's clientX/clientY — the caller hands them to
  // GameCanvas.screenToGame(), which is the conversion every other coordinate
  // in the engine already goes through.
  //
  // This is not licence for a second control model. A game built on it must
  // still play from a pad and a keyboard; see Hangman, where the same letter
  // grid is walked with a stick, typed at directly, or tapped, and all three
  // resolve to the one action "choose this letter".

  /**
   * Is this raw key down right now?
   *
   * The layouts map a fixed set of codes onto named ACTIONS, which is the
   * right shape for a game where a button means "jump". It is the wrong shape
   * for a game whose input is a letter: twenty-six actions called A to Z would
   * be twenty-six of the same action with an argument, and every layout in the
   * file would have to carry them.
   *
   * So a game that reads letters asks about the key directly. Takes a
   * KeyboardEvent.code — 'KeyQ', 'Digit4' — because that is what the rest of
   * this module speaks and because it does not move with the keyboard layout.
   */
  static isKeyHeld(code) {
    return Input.#heldKeys.has(code);
  }

  /**
   * The tap since the last update(), in viewport coordinates, or null.
   *
   * A tap is a touch no action pad took, plus one a stick took and gave back:
   * a press that moved less than eight pixels and lasted under 300ms was
   * plainly a poke rather than a drag, whatever half of the screen it landed
   * in. See the note in #onTouchEnd for why that rescue has to exist.
   */
  static tapped() {
    return Input.#tap;
  }

  /** Where the pointer is while it is held down, or null. */
  static pointer() {
    return Input.#pointerDown ? { x: Input.#pointerX, y: Input.#pointerY } : null;
  }

  static getConnectedPads() {
    const pads = Input.#safeGetGamepads();
    const connected = [];
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]) connected.push(i);
    }
    return connected;
  }

  static getActiveDevice() {
    return Input.#activeDevice;
  }

  // Subscribe to gamepad connect/disconnect. Returns an unsubscribe
  // function so callers don't need to hang onto the original callback
  // reference just to remove it later.
  static onGamepadConnect(callback) {
    Input.#connectCallbacks.push(callback);
    return () => {
      Input.#connectCallbacks = Input.#connectCallbacks.filter((cb) => cb !== callback);
    };
  }

  static onGamepadDisconnect(callback) {
    Input.#disconnectCallbacks.push(callback);
    return () => {
      Input.#disconnectCallbacks = Input.#disconnectCallbacks.filter((cb) => cb !== callback);
    };
  }

  // Vibration support varies a lot by browser/controller and is very much
  // a "nice to have" -- a game should never crash or misbehave just because
  // rumble isn't available, so every failure mode here is a silent no-op.
  static rumble(playerIndex, strength = 1, duration = 200) {
    try {
      const pad = Input.#safeGetGamepads()[playerIndex];
      if (!pad) return;
      if (pad.vibrationActuator && typeof pad.vibrationActuator.playEffect === 'function') {
        pad.vibrationActuator.playEffect('dual-rumble', {
          duration,
          startDelay: 0,
          strongMagnitude: strength,
          weakMagnitude: strength,
        });
      } else if (pad.hapticActuators && pad.hapticActuators[0]) {
        // Older, non-standard API some browsers shipped before
        // vibrationActuator existed.
        pad.hapticActuators[0].pulse(strength, duration);
      }
    } catch {
      // Rumble failing is never a reason to disrupt gameplay.
    }
  }

  // Assigns a keyboard layout to a player slot for party mode. Accepts
  // either the name of a built-in preset ('WASD' | 'ARROWS' | 'IJKL' |
  // 'NUMPAD') or a fully custom mapping object with the same shape (see
  // KEYBOARD_LAYOUTS above). Exposed on the class too, as Input.LAYOUTS,
  // so party-mode UI can list preset names without importing the constant
  // separately.
  static setKeyboardLayout(playerIndex, layout) {
    const resolved = typeof layout === 'string' ? KEYBOARD_LAYOUTS[layout] : layout;
    if (!resolved) {
      throw new Error(`Input.setKeyboardLayout: unknown layout "${layout}"`);
    }
    // The arguments are (playerIndex, layout) and it is an easy pair to swap.
    // Without these two checks the swapped call is SILENT: a number lands in
    // the layout slot, every lookup on it is undefined, and that player's
    // keyboard simply does nothing for the rest of the party. Throwing here
    // costs nothing and turns a mystery into a stack trace.
    if (typeof resolved !== 'object') {
      throw new TypeError(
        `Input.setKeyboardLayout: layout must be a preset name or a mapping object, got ${typeof resolved}. `
        + 'The argument order is (playerIndex, layout).',
      );
    }
    if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= MAX_PLAYERS) {
      throw new RangeError(
        `Input.setKeyboardLayout: playerIndex must be 0..${MAX_PLAYERS - 1}, got ${playerIndex}. `
        + 'The argument order is (playerIndex, layout).',
      );
    }
    Input.#keyboardLayouts[playerIndex] = resolved;
  }

  /**
   * Does this game steer? Set by setDirectionalTouch(); true by default.
   *
   * The virtual stick claims half the play area whatever the game does with
   * it, so a game that never reads x/y -- Tower Stack dropping a block, Gravity
   * Flip flipping -- would otherwise advertise a joystick that steers nothing.
   * engine/shell.js asks this before drawing the resting stick.
   */
  static get usesDirectionalTouch() {
    return Input.#directionalTouch;
  }

  static setDirectionalTouch(enabled) {
    Input.#directionalTouch = Boolean(enabled);
  }

  /**
   * The box touch controls live in: the play area, minus anything behind the
   * hardware. Set by engine/canvas.js on every layout.
   *
   * THIS IS THE PLAY AREA AND NOT THE WINDOW, and the difference is the whole
   * point. A phone screen is 932 CSS pixels wide and a game drawn at 3:2 fills
   * 665 of them, so the rest is letterbox bar. Placing a pad at "13% across the
   * screen" put it in that bar: off the canvas, so it was never drawn at all,
   * and off the play area, so a thumb that found it was pressing scenery.
   *
   * Falls back to the safe viewport box when nothing has set it, which is only
   * the tests -- everything else has a GameCanvas.
   */
  static setControlBounds(rect) {
    Input.#controlBounds = rect;
  }

  static get controlBounds() {
    const safe = Viewport.safe;
    const bounds = Input.#controlBounds;
    if (!bounds || !bounds.width || !bounds.height) return safe;
    // Clipped to the safe area: a play area that runs under the notch or the
    // home indicator is fine to DRAW in and no place to put a button.
    const left = Math.max(bounds.left, safe.left);
    const top = Math.max(bounds.top, safe.top);
    const right = Math.min(bounds.left + bounds.width, safe.left + safe.width);
    const bottom = Math.min(bounds.top + bounds.height, safe.top + safe.height);
    return {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  /**
   * Where the resting stick sits: bottom-left of the play area.
   *
   * Far enough in from the edge that the whole ring is on glass, and far enough
   * up that it clears the home indicator. The live stick still appears wherever
   * the thumb actually lands; this is only the hint that says one exists.
   */
  static stickHome() {
    const box = Input.controlBounds;
    // Never closer to an edge than the ring's own radius, whatever the box is:
    // a 430-wide portrait play area gives 0.13 * 430 = 56, which put a
    // 55-radius ring one pixel off the glass.
    const margin = Math.min(96, Math.max(JOYSTICK_MAX_RADIUS_PX + 12, box.width * 0.13));
    return {
      x: box.left + margin,
      y: box.top + box.height - margin,
    };
  }

  /**
   * WHERE A TOUCH PAD IS, in client coordinates. The only answer, used by the
   * hit test below and by engine/shell.js to draw it.
   *
   * Both used to do this arithmetic themselves against window.innerWidth and
   * window.innerHeight. They agreed with each other and were both wrong: that
   * is the LAYOUT viewport, which on iOS Safari is the size the page gets once
   * the toolbar has collapsed, so a pad at yRatio 0.9 was drawn and hit-tested
   * below the visible area while the toolbar was still up.
   */
  static touchButtonCenter(button) {
    const found = Input.touchButtonCenters().get(button.name);
    if (found) return { x: found.x, y: found.y };
    // A button that is not in the current layout: place it on its own ratio so
    // the caller still gets an answer rather than a crash.
    const box = Input.controlBounds;
    return {
      x: box.left + button.xRatio * box.width,
      y: box.top + button.yRatio * box.height,
    };
  }

  /**
   * WHERE EVERY TOUCH PAD IS, resolved together. Keyed by button name, in
   * client coordinates. Used by the hit test below and by engine/shell.js to
   * draw them, so the pad on screen and the pad a thumb finds cannot drift.
   *
   * WHY THIS IS NOT JUST ratio * box, WHICH IS WHAT IT USED TO BE.
   *
   * A ratio places a CENTRE and says nothing about the ring around it, and the
   * radius is in CSS pixels and does not shrink when the box does. So a pair of
   * pads a comfortable 0.09 of the width apart -- 84 pixels on a 932-wide
   * landscape play area -- are 39 pixels apart when the same game is played
   * portrait, and two 55-pixel rings 39 pixels apart are one blob with an
   * ambiguous middle. Measured across all twenty-three games at iPhone size,
   * TWELVE had overlapping pads and four had a pad sitting on top of the
   * resting joystick. Every one of them passed a tap test, because both pads
   * respond; what they cannot do is tell a thumb which one it pressed.
   *
   * That is one fault with one cause in twelve places, so it is fixed here
   * rather than by hand-tuning twelve pairs of ratios that would go wrong again
   * on the next screen shape. A game says roughly where it wants its pads; this
   * guarantees they are on the play area and clear of each other and of the
   * stick. The relaxation runs a fixed number of passes on a fixed input, so
   * the answer is deterministic and pads do not jitter between frames.
   */
  static touchButtonCenters() {
    const box = Input.controlBounds;
    const layout = Input.#touchLayout;
    const pads = layout.map((button) => ({
      name: button.name,
      r: (button.radius ?? 0) + PAD_AIR,
      x: box.left + button.xRatio * box.width,
      y: box.top + button.yRatio * box.height,
    }));

    // The stick does not move -- a player reaches for it in the corner without
    // looking, and a joystick that shuffles about to make room for a button is
    // worse than a button in the wrong place. Pads move around it.
    const stick = Input.#directionalTouch
      ? { ...Input.stickHome(), r: JOYSTICK_MAX_RADIUS_PX + PAD_AIR }
      : null;

    const pin = (value, low, high) => (low > high
      ? (low + high) / 2                     // box smaller than the pad itself
      : Math.min(Math.max(value, low), high));
    const clampAll = () => {
      for (const p of pads) {
        p.x = pin(p.x, box.left + p.r, box.left + box.width - p.r);
        p.y = pin(p.y, box.top + p.r, box.top + box.height - p.r);
      }
    };
    clampAll();

    for (let pass = 0; pass < PAD_RELAX_PASSES; pass++) {
      let moved = false;

      for (let i = 0; i < pads.length; i++) {
        for (let j = i + 1; j < pads.length; j++) {
          const a = pads[i];
          const b = pads[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let distance = Math.hypot(dx, dy);
          if (distance < 1e-6) {
            // Exactly coincident: pick a direction rather than divide by zero.
            // Along x, so a pair declared at the same spot ends up side by side
            // where a thumb expects two buttons to be.
            dx = 1; dy = 0; distance = 1e-6;
          }
          const want = a.r + b.r;
          if (distance >= want) continue;
          const push = (want - distance) / 2;
          const ux = dx / distance;
          const uy = dy / distance;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;
          moved = true;
        }
      }

      if (stick) {
        for (const p of pads) {
          const want = p.r + stick.r;
          if (Math.hypot(p.x - stick.x, p.y - stick.y) >= want) continue;
          const spot = Input.#clearOfStick(p, stick, want, box);
          if (!spot) continue;
          p.x = spot.x;
          p.y = spot.y;
          moved = true;
        }
      }

      clampAll();
      if (!moved) break;
    }

    const out = new Map();
    for (const p of pads) out.set(p.name, { x: p.x, y: p.y });
    return out;
  }

  /**
   * The nearest place a pad can sit that clears the resting stick AND stays on
   * the play area. Returns null when there is nowhere.
   *
   * Pushing a pad straight away from the stick is the obvious move and it fails
   * in the one case that matters. Both live in the bottom-left corner -- the
   * stick because that is where a left thumb rests, the pad because that is
   * where three games declared it -- so "away" points diagonally out of the
   * box, and the clamp puts the pad straight back on top of the stick. Hangman
   * sat in that deadlock for twelve passes and came out exactly where it went
   * in, nineteen pixels from the middle of the joystick.
   *
   * So instead of a direction, a ring: every position at the required distance
   * from the stick, keeping the one that fits on the play area and is closest to
   * where the pad already was. Straight-away is one of the samples, so wherever
   * the simple push already worked this picks the same answer.
   */
  static #clearOfStick(pad, stick, want, box) {
    let best = null;
    let bestDistance = Infinity;
    for (let i = 0; i < STICK_RING_SAMPLES; i++) {
      const angle = (i / STICK_RING_SAMPLES) * Math.PI * 2;
      const x = stick.x + Math.cos(angle) * want;
      const y = stick.y + Math.sin(angle) * want;
      if (x - pad.r < box.left || x + pad.r > box.left + box.width) continue;
      if (y - pad.r < box.top || y + pad.r > box.top + box.height) continue;
      const moved = Math.hypot(x - pad.x, y - pad.y);
      if (moved < bestDistance) {
        bestDistance = moved;
        best = { x, y };
      }
    }
    return best;
  }

  // Replaces the touch action-button cluster. `config` is an array of
  // { name, xRatio, yRatio, radius, label } describing each button as a
  // fraction of the play area plus a touch radius in CSS pixels. `name` must
  // be one of the button fields returned by get() (e.g. 'a', 'b', 'btnX'...).
  //
  // `label` is optional and is what engine/shell.js prints on the pad: give
  // it the verb ('BURN', 'JUMP') rather than leaving the player to work out
  // what the letter A does in this particular game. Falls back to `name`.
  //
  // THE RATIOS ARE A PREFERENCE, NOT A PROMISE. See touchButtonCenter: a game
  // declares roughly where it wants each pad and the engine guarantees they
  // end up on the play area and clear of each other.
  static setTouchLayout(config) {
    Input.#touchLayout = config;
    // Clear any buttons that were mid-press under the old layout so a
    // stale "held" state can't get stuck on forever.
    for (const name of BUTTON_NAMES) Input.#touchButtonState[name] = false;
    Input.#touchButtonTouches.clear();
  }

  /**
   * Turns the virtual stick and action pads on or off without changing the
   * layout. Menus use this: while a pause screen is up, a thumb on the left
   * half should not still be steering the player, and the A pad should not
   * be confirming menu items the moment it is tapped.
   *
   * Disabling releases anything currently held, so nothing sticks down while
   * the controls are off.
   */
  static setTouchControlsEnabled(enabled) {
    Input.#touchControlsEnabled = Boolean(enabled);
    if (!Input.#touchControlsEnabled) Input.#releaseAllTouches();
  }

  static get touchControlsEnabled() {
    return Input.#touchControlsEnabled;
  }

  /**
   * Removes every on-screen action button, for a game that has none.
   *
   * The virtual joystick is NOT affected — a game with nothing to press
   * usually still needs steering. This exists because the alternative,
   * setTouchLayout([]), reads like an oversight rather than a decision, and
   * a game that skips it silently ships two dead buttons sitting on the
   * screen doing nothing.
   */
  static clearTouchLayout() {
    Input.setTouchLayout([]);
  }

  /**
   * Turns on a second virtual stick on the right half of the screen, feeding
   * aimX/aimY exactly as a gamepad's right stick does.
   *
   * Without this, aimX/aimY are always 0 on a phone, so a game built around
   * the right stick is unplayable on touch while looking fine on a pad —
   * which is the worst kind of gap, because it only shows up on a device the
   * developer isn't holding.
   *
   * Action buttons win the hit test, so a burn pad in the bottom-right
   * corner still presses rather than spawning a stick under the thumb. Like
   * the left stick, this one appears wherever the thumb lands rather than at
   * a fixed spot, so it never demands the player look down to find it.
   */
  static setAimStickEnabled(enabled) {
    Input.#aimStickEnabled = Boolean(enabled);
    if (!Input.#aimStickEnabled) {
      Input.#aimStick.active = false;
      Input.#aimStick.touchId = null;
      Input.#aimStick.x = 0;
      Input.#aimStick.y = 0;
    }
  }

  static get aimStickEnabled() {
    return Input.#aimStickEnabled;
  }

  // The action-pad layout currently in force. Read-only copy, for drawing:
  // touch buttons are invisible regions otherwise, and a button nobody can
  // see is a button nobody presses. engine/shell.js renders these.
  static getTouchLayout() {
    return Input.#touchLayout.map((button) => ({ ...button }));
  }

  /**
   * Snapshot of both virtual sticks in CSS pixels, for drawing them.
   *
   * originX/originY are where the thumb first landed (the stick's base) and
   * x/y are the current deflection, -1..1. Returns inactive sticks too, so a
   * caller can just check .active.
   */
  static getTouchSticks() {
    return {
      move: { ...Input.#joystick },
      aim: { ...Input.#aimStick },
    };
  }

  // Radial deadzone applied to both sticks on every gamepad, 0-1.
  static setDeadzone(value) {
    Input.#deadzone = Math.min(Math.max(value, 0), 0.9);
  }

  // -------------------------------------------------------------------
  // Gamepad polling
  // -------------------------------------------------------------------

  static #safeGetGamepads() {
    try {
      return (navigator.getGamepads ? navigator.getGamepads() : []) || [];
    } catch {
      // A handful of older/locked-down browsers throw here instead of just
      // not implementing the API. Treat that exactly like "no gamepads."
      return [];
    }
  }

  // Reads one gamepad slot and returns a frame in the same shape as the
  // normalized state, or null if nothing is connected there. Button index
  // layout below follows the Gamepad API's "standard" mapping, which is
  // what Chrome/Firefox/Edge normalize both Xbox and PlayStation
  // controllers to -- so the same indices work for both without a separate
  // vendor-specific code path.
  static #readGamepad(padIndex) {
    const pad = Input.#safeGetGamepads()[padIndex];
    if (!pad || pad.connected === false) return null;

    const buttonPressed = (index) => Boolean(pad.buttons[index] && pad.buttons[index].pressed);
    const buttonValue = (index) => (pad.buttons[index] ? pad.buttons[index].value : 0);

    // Left stick = move, right stick = aim. axes[2]/[3] are absent on very
    // old/nonstandard pads, hence the `|| 0` fallback.
    const move = applyRadialDeadzone(pad.axes[0] || 0, pad.axes[1] || 0, Input.#deadzone);
    const aim = applyRadialDeadzone(pad.axes[2] || 0, pad.axes[3] || 0, Input.#deadzone);

    // D-pad (buttons 12-15) drives the same x/y axes as the left stick, so
    // a game never has to check two different input sources for movement.
    // Digital d-pad input wins over the stick when both are held, since a
    // d-pad press is always a deliberate full-deflection move.
    let x = move.x;
    let y = move.y;
    const dpadLeft = buttonPressed(14);
    const dpadRight = buttonPressed(15);
    const dpadUp = buttonPressed(12);
    const dpadDown = buttonPressed(13);
    if (dpadLeft || dpadRight) x = dpadRight ? 1 : -1;
    if (dpadUp || dpadDown) y = dpadDown ? 1 : -1;

    return {
      x, y,
      aimX: aim.x, aimY: aim.y,
      a: buttonPressed(0), b: buttonPressed(1), btnX: buttonPressed(2), btnY: buttonPressed(3),
      lb: buttonPressed(4), rb: buttonPressed(5),
      // Triggers are analog (0-1 travel) but the normalized state only
      // exposes booleans, so a trigger counts as "pressed" once it's past
      // TRIGGER_THRESHOLD -- or if the browser reports it as a digital
      // button, whichever fires first.
      lt: buttonValue(6) > TRIGGER_THRESHOLD || buttonPressed(6),
      rt: buttonValue(7) > TRIGGER_THRESHOLD || buttonPressed(7),
      back: buttonPressed(8), start: buttonPressed(9),
      // Stick clicks. Indices 10/11 sit between the two menu buttons and the
      // d-pad in the standard mapping, so they are present on any pad the
      // browser normalizes -- and simply never fire on one that has no
      // clickable sticks.
      ls: buttonPressed(10), rs: buttonPressed(11),
    };
  }

  // -------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------

  static #readKeyboard(playerIndex) {
    const layout = Input.#keyboardLayouts[playerIndex];
    if (!layout) return null; // no keys assigned to this player slot

    const held = (codes) => Boolean(codes) && codes.some((code) => Input.#heldKeys.has(code));

    let x = (held(layout.right) ? 1 : 0) - (held(layout.left) ? 1 : 0);
    let y = (held(layout.down) ? 1 : 0) - (held(layout.up) ? 1 : 0);
    // Without this, diagonal movement (two keys held at once) would be
    // ~1.41x faster than moving in a straight line.
    if (x !== 0 && y !== 0) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
    }

    return {
      x, y, aimX: 0, aimY: 0,
      a: held(layout.a), b: held(layout.b), btnX: held(layout.x), btnY: held(layout.y),
      // Shoulders and triggers have no keyboard binding in any layout, so
      // they stay false; the stick clicks do, hence the lookup.
      lb: false, rb: false, lt: false, rt: false,
      back: held(layout.back), start: held(layout.start),
      ls: held(layout.ls), rs: held(layout.rs),
    };
  }

  static #isTypingIntoField() {
    const el = typeof document !== 'undefined' ? document.activeElement : null;
    return Boolean(el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  // -------------------------------------------------------------------
  // Touch
  // -------------------------------------------------------------------

  // Returns player 0's touch-derived frame, or null if this device has no
  // touchscreen (in which case there's nothing to poll).
  static #readTouch() {
    if (!Input.#touchEnabled) return null;
    const frame = { x: 0, y: 0, aimX: 0, aimY: 0 };
    if (Input.#joystick.active) {
      frame.x = Input.#joystick.x;
      frame.y = Input.#joystick.y;
    }
    if (Input.#aimStick.active) {
      frame.aimX = Input.#aimStick.x;
      frame.aimY = Input.#aimStick.y;
    }
    for (const name of BUTTON_NAMES) frame[name] = Boolean(Input.#touchButtonState[name]);
    return frame;
  }

  // Checks whether (x, y) landed on a configured touch button; returns the
  // button's name, or null if it didn't hit any of them.
  // Drops every in-progress touch. Shared by the blur handler and by
  // setTouchControlsEnabled(false), so a stick or pad can never be left
  // stuck down after the touches that owned it stop being delivered.
  static #releaseAllTouches() {
    for (const stick of [Input.#joystick, Input.#aimStick]) {
      stick.active = false;
      stick.touchId = null;
      stick.x = 0;
      stick.y = 0;
    }
    for (const name of BUTTON_NAMES) Input.#touchButtonState[name] = false;
    Input.#touchButtonTouches.clear();
  }

  // Which stick, if any, is tracking this touch identifier. Returns the
  // stick object itself so callers can mutate it without caring which it is.
  static #stickOwning(touchId) {
    if (Input.#joystick.touchId === touchId) return Input.#joystick;
    if (Input.#aimStick.touchId === touchId) return Input.#aimStick;
    return null;
  }

  // Plants a stick's base where the thumb landed and zeroes its deflection.
  //
  // startedAt and wandered are for the tap rescue in #onTouchEnd: a stick has
  // to remember where and when it began to be able to say, on release, that
  // nothing actually happened.
  static #beginStick(stick, touchId, x, y) {
    stick.active = true;
    stick.touchId = touchId;
    stick.originX = x;
    stick.originY = y;
    stick.x = 0;
    stick.y = 0;
    stick.startedAt = now();
    stick.wandered = 0;
  }

  // Converts a thumb position into a stick deflection, shared by both sticks
  // so they can never drift apart in feel.
  // Where the move stick's half of the screen ends. Measured on the visible
  // box so that a phone with the toolbar up splits the screen a player can see
  // rather than one they cannot.
  static #stickZoneEdge() {
    const box = Input.controlBounds;
    return box.left + box.width / 2;
  }

  static #dragStick(stick, clientX, clientY) {
    const dx = clientX - stick.originX;
    const dy = clientY - stick.originY;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) {
      stick.x = 0;
      stick.y = 0;
      return;
    }
    const clampedDistance = Math.min(distance, JOYSTICK_MAX_RADIUS_PX);
    // Normalize direction, then scale by how far the thumb dragged
    // (capped at the max radius) so the stick saturates at 1.0 instead
    // of reporting values greater than a real analog stick ever would.
    stick.x = (dx / distance) * (clampedDistance / JOYSTICK_MAX_RADIUS_PX);
    stick.y = (dy / distance) * (clampedDistance / JOYSTICK_MAX_RADIUS_PX);
  }

  static #hitTestTouchButton(x, y) {
    // The resolved cluster, asked for once: where a pad ends up depends on
    // where the others did, so testing them one at a time would re-run the
    // whole relaxation for every button.
    const centers = Input.touchButtonCenters();
    for (const button of Input.#touchLayout) {
      const at = centers.get(button.name);
      if (!at) continue;
      if (Math.hypot(x - at.x, y - at.y) <= button.radius) return button.name;
    }
    return null;
  }

  // The rule this handler follows, and the reason it is written this way:
  // CLAIM FIRST, THEN preventDefault -- never the other way round.
  //
  // preventDefault() on a touch event suppresses the compatibility mouse
  // events the browser would otherwise synthesize, which means it suppresses
  // `click`. Calling it unconditionally on a window-level listener therefore
  // kills every button, link, and form control on the page for touch users,
  // everywhere, for the entire session -- while leaving mouse and keyboard
  // working perfectly, so it looks like a phone-only mystery. So the default
  // is only prevented for touches this module has actually taken ownership
  // of, and untouched taps pass through to whatever the player aimed at.
  static #onTouchStart(event) {
    // Still a touch device even when the tap isn't ours, so UI hints should
    // switch to touch variants regardless of who ends up handling it.
    Input.#activeDevice = 'touch';

    if (!Input.#touchControlsEnabled) return;
    if (startedOnPageUi(event.target)) return;

    let claimed = false;

    for (const touch of event.changedTouches) {
      const x = touch.clientX;
      const y = touch.clientY;
      const buttonName = Input.#hitTestTouchButton(x, y);
      if (buttonName) {
        Input.#touchButtonTouches.set(touch.identifier, buttonName);
        Input.#touchButtonState[buttonName] = true;
        claimed = true;
      } else if (
        Input.#directionalTouch
        && !Input.#joystick.active
        && x < Input.#stickZoneEdge()
      ) {
        // Left half of the screen, and no stick running yet: this touch
        // spawns the virtual joystick right where the thumb landed.
        //
        // Only for a game that steers. The flag used to govern only whether
        // engine/shell.js DREW the resting ring, so a game that declared it
        // did not steer still had every touch in its left half swallowed by an
        // invisible joystick -- the control was hidden, not absent, which is
        // the worst of both.
        Input.#beginStick(Input.#joystick, touch.identifier, x, y);
        claimed = true;
      } else if (
        Input.#aimStickEnabled
        && !Input.#aimStick.active
        && x >= Input.#stickZoneEdge()
      ) {
        // Right half, same deal, for the aim stick. Reached only after the
        // action pads have had their say, so a button always wins the touch.
        Input.#beginStick(Input.#aimStick, touch.identifier, x, y);
        claimed = true;
      }
    }

    // A touch no button and no stick wanted is a TAP at that spot. Checked
    // last, after both have had their turn, so a thumb on a fire pad never
    // also reads as a poke at whatever is behind it.
    for (const touch of event.changedTouches) {
      if (Input.#touchButtonTouches.has(touch.identifier)) continue;
      if (Input.#stickOwning(touch.identifier)) continue;
      Input.#pendingTap = { x: touch.clientX, y: touch.clientY };
      Input.#pointerDown = true;
      Input.#pointerX = touch.clientX;
      Input.#pointerY = touch.clientY;
    }

    // Only now, having taken the touch, is it ours to stop scrolling with.
    if (claimed) event.preventDefault();
  }

  static #onTouchMove(event) {
    // Same claim rule: only swallow the scroll for fingers we're tracking,
    // so a drag that started on the page can still scroll it.
    let tracking = false;

    for (const touch of event.changedTouches) {
      if (Input.#touchButtonTouches.has(touch.identifier)) tracking = true;
      const stick = Input.#stickOwning(touch.identifier);
      if (!stick) continue;
      tracking = true;
      // The FURTHEST it ever got, not where it ended up: a thumb that swung
      // out and came back has plainly been steering, and must not be handed
      // back as a tap.
      stick.wandered = Math.max(stick.wandered ?? 0, Math.hypot(
        touch.clientX - stick.originX, touch.clientY - stick.originY,
      ));
      Input.#dragStick(stick, touch.clientX, touch.clientY);
    }

    if (tracking) event.preventDefault();
  }

  static #onTouchEnd(event) {
    // touchend matters as much as touchstart here: preventing its default
    // also cancels the click the browser was about to synthesize.
    let tracking = false;

    for (const touch of event.changedTouches) {
      const stick = Input.#stickOwning(touch.identifier);
      if (stick) {
        // A TOUCH THAT NEVER MOVED IS A TAP, even though a stick claimed it.
        //
        // The stick spawns wherever a thumb lands in its half of the play
        // area, which is right for steering and wrong for everything else: it
        // means half the screen cannot be tapped. Hangman's letter grid fills
        // the play area and the left-hand letters were unreachable on a phone;
        // Number Crunch, Keystroke and Circuit Racer all draw a setup screen
        // before the run starts and the left half of it was dead. That last
        // one is what a player reports as "the menu doesn't respond", and it
        // was never one game's bug.
        //
        // A game cannot fix this by declaring it does not steer, because these
        // games DO steer -- afterwards. So the disambiguation is the ordinary
        // one every touch UI makes: a press that goes nowhere and ends quickly
        // was a poke, not a drag. The stick still ran for those few frames,
        // deflected by less than a thumb's own width, which is inside the
        // deadzone and moves nothing.
        const wandered = stick.wandered ?? 0;
        const held = now() - (stick.startedAt ?? 0);
        if (wandered <= TAP_SLOP_PX && held <= TAP_HOLD_MS) {
          Input.#pendingTap = { x: touch.clientX, y: touch.clientY };
        }
        stick.active = false;
        stick.touchId = null;
        stick.x = 0;
        stick.y = 0;
        tracking = true;
      }
      const buttonName = Input.#touchButtonTouches.get(touch.identifier);
      if (buttonName) {
        Input.#touchButtonState[buttonName] = false;
        Input.#touchButtonTouches.delete(touch.identifier);
        tracking = true;
      }
    }

    if (tracking) event.preventDefault();
  }

  // -------------------------------------------------------------------
  // One-time wiring
  // -------------------------------------------------------------------

  // Attaches every DOM listener this module needs. Runs exactly once, from
  // the static block at the bottom of the class, so simply importing this
  // file is enough to make Input work -- no separate init() call for every
  // game to remember.
  static #ensureInit() {
    window.addEventListener('gamepadconnected', (event) => {
      for (const cb of Input.#connectCallbacks) cb(event.gamepad.index, event.gamepad);
    });
    window.addEventListener('gamepaddisconnected', (event) => {
      for (const cb of Input.#disconnectCallbacks) cb(event.gamepad.index);
    });

    // A mouse is a pointer too, and somebody on a desktop poking at a letter
    // grid expects it to work. Same edge, same coordinates.
    window.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') return;   // the touch path owns those
      Input.#pendingTap = { x: event.clientX, y: event.clientY };
      Input.#pointerDown = true;
      Input.#pointerX = event.clientX;
      Input.#pointerY = event.clientY;
      Input.#activeDevice = 'keyboard';
    });
    window.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      Input.#pointerX = event.clientX;
      Input.#pointerY = event.clientY;
    });
    window.addEventListener('pointerup', () => { Input.#pointerDown = false; });

    window.addEventListener('keydown', (event) => {
      if (Input.#isTypingIntoField()) return;
      Input.#heldKeys.add(event.code);
      Input.#activeDevice = 'keyboard';
      if (PREVENT_DEFAULT_KEY_CODES.has(event.code)) event.preventDefault();
    });
    window.addEventListener('keyup', (event) => {
      Input.#heldKeys.delete(event.code);
    });

    // Alt-tabbing (or clicking off the page) while holding a key means the
    // matching keyup is delivered to whatever took focus, not to us -- the
    // key would otherwise read as held forever and the player would come
    // back to a character still running into a wall. Same reasoning for
    // touches: a touch interrupted by a system gesture never sends touchend.
    window.addEventListener('blur', () => {
      Input.#heldKeys.clear();
      Input.#releaseAllTouches();
      Input.#pointerDown = false;
    });

    if (Input.#touchEnabled) {
      // { passive: false } is required so preventDefault() inside these
      // handlers actually stops browser scroll/zoom gestures.
      window.addEventListener('touchstart', Input.#onTouchStart, { passive: false });
      window.addEventListener('touchmove', Input.#onTouchMove, { passive: false });
      window.addEventListener('touchend', Input.#onTouchEnd, { passive: false });
      window.addEventListener('touchcancel', Input.#onTouchEnd, { passive: false });
    }
  }

  // Named presets available to setKeyboardLayout(), exposed for party-mode
  // UI that needs to list/label them.
  static LAYOUTS = KEYBOARD_LAYOUTS;

  static {
    Input.#ensureInit();
  }
}

// -------------------------------------------------------------------
// Usage example (not executed -- for games importing this module)
// -------------------------------------------------------------------
//
// import { Input } from '../../engine/input.js';
//
// function gameLoop() {
//   Input.update(); // once per frame, before any reads
//
//   const state = Input.get(0); // player 0's normalized state
//   player.x += state.x * MOVE_SPEED;
//   player.y += state.y * MOVE_SPEED;
//
//   if (Input.pressed('a', 0)) {
//     player.jump(); // fires once on the frame the button goes down,
//                    // not once per frame it's held
//   }
//
//   requestAnimationFrame(gameLoop);
// }
