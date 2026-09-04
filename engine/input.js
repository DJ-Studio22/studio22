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

// How far (in CSS pixels) a thumb has to drag from the virtual joystick's
// origin before it's reporting full deflection (1.0).
const JOYSTICK_MAX_RADIUS_PX = 55;

// The full set of digital buttons in the normalized state object. Kept as a
// list (rather than re-typing it everywhere) so merge/copy helpers below
// can loop instead of repeating ten field names.
// ls/rs are the stick clicks (L3/R3) -- pressing straight down on a thumb
// stick. Gamepad and keyboard only: there is no thumb-stick to click on a
// touchscreen, so the virtual controls never produce them.
const BUTTON_NAMES = [
  'a', 'b', 'btnX', 'btnY', 'start', 'back', 'lb', 'rb', 'lt', 'rt', 'ls', 'rs',
];

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
function pickStrongestVector(vectors) {
  let best = { x: 0, y: 0 };
  let bestMagnitude = 0;
  for (const vector of vectors) {
    if (!vector) continue;
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

  static #connectCallbacks = [];
  static #disconnectCallbacks = [];

  // Touch is only wired up on touch-capable devices, per the spec -- a
  // desktop browser with no touchscreen should never pay for (or show) a
  // virtual joystick.
  static #touchEnabled =
    typeof window !== 'undefined' &&
    (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
  static #touchLayout = DEFAULT_TOUCH_LAYOUT;
  static #joystick = { active: false, touchId: null, originX: 0, originY: 0, x: 0, y: 0 };
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
      // Only gamepads currently have a second stick; keyboard/touch have no
      // aim input of their own, so aim simply falls back to zero for them.
      const aim = gamepadFrame ? { x: gamepadFrame.aimX, y: gamepadFrame.aimY } : { x: 0, y: 0 };
      const buttons = mergeButtonsWithOr([gamepadFrame, keyboardFrame, touchFrame]);

      Input.#players[i] = { x: move.x, y: move.y, aimX: aim.x, aimY: aim.y, ...buttons };

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

    Input.#curButtons = Input.#players.map((frame) => {
      const buttons = {};
      for (const name of BUTTON_NAMES) buttons[name] = frame[name];
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
    Input.#keyboardLayouts[playerIndex] = resolved;
  }

  // Replaces the touch action-button cluster. `config` is an array of
  // { name, xRatio, yRatio, radius } describing each button as a fraction
  // of the viewport (so layouts hold up across screen sizes) plus a touch
  // radius in CSS pixels. `name` must be one of the button fields returned
  // by get() (e.g. 'a', 'b', 'btnX', 'rb'...).
  static setTouchLayout(config) {
    Input.#touchLayout = config;
    // Clear any buttons that were mid-press under the old layout so a
    // stale "held" state can't get stuck on forever.
    for (const name of BUTTON_NAMES) Input.#touchButtonState[name] = false;
    Input.#touchButtonTouches.clear();
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
    for (const name of BUTTON_NAMES) frame[name] = Boolean(Input.#touchButtonState[name]);
    return frame;
  }

  // Checks whether (x, y) landed on a configured touch button; returns the
  // button's name, or null if it didn't hit any of them.
  static #hitTestTouchButton(x, y) {
    for (const button of Input.#touchLayout) {
      const bx = button.xRatio * window.innerWidth;
      const by = button.yRatio * window.innerHeight;
      if (Math.hypot(x - bx, y - by) <= button.radius) return button.name;
    }
    return null;
  }

  static #onTouchStart(event) {
    for (const touch of event.changedTouches) {
      const x = touch.clientX;
      const y = touch.clientY;
      const buttonName = Input.#hitTestTouchButton(x, y);
      if (buttonName) {
        Input.#touchButtonTouches.set(touch.identifier, buttonName);
        Input.#touchButtonState[buttonName] = true;
      } else if (!Input.#joystick.active && x < window.innerWidth / 2) {
        // Left half of the screen, and no stick running yet: this touch
        // spawns the virtual joystick right where the thumb landed.
        Input.#joystick.active = true;
        Input.#joystick.touchId = touch.identifier;
        Input.#joystick.originX = x;
        Input.#joystick.originY = y;
        Input.#joystick.x = 0;
        Input.#joystick.y = 0;
      }
    }
    Input.#activeDevice = 'touch';
    // Stops the page from scrolling/zooming while the player is dragging
    // the stick or mashing buttons.
    event.preventDefault();
  }

  static #onTouchMove(event) {
    for (const touch of event.changedTouches) {
      if (touch.identifier !== Input.#joystick.touchId) continue;
      const dx = touch.clientX - Input.#joystick.originX;
      const dy = touch.clientY - Input.#joystick.originY;
      const distance = Math.hypot(dx, dy);
      if (distance === 0) {
        Input.#joystick.x = 0;
        Input.#joystick.y = 0;
        continue;
      }
      const clampedDistance = Math.min(distance, JOYSTICK_MAX_RADIUS_PX);
      // Normalize direction, then scale by how far the thumb dragged
      // (capped at the max radius) so the stick saturates at 1.0 instead
      // of reporting values greater than a real analog stick ever would.
      Input.#joystick.x = (dx / distance) * (clampedDistance / JOYSTICK_MAX_RADIUS_PX);
      Input.#joystick.y = (dy / distance) * (clampedDistance / JOYSTICK_MAX_RADIUS_PX);
    }
    event.preventDefault();
  }

  static #onTouchEnd(event) {
    for (const touch of event.changedTouches) {
      if (touch.identifier === Input.#joystick.touchId) {
        Input.#joystick.active = false;
        Input.#joystick.touchId = null;
        Input.#joystick.x = 0;
        Input.#joystick.y = 0;
      }
      const buttonName = Input.#touchButtonTouches.get(touch.identifier);
      if (buttonName) {
        Input.#touchButtonState[buttonName] = false;
        Input.#touchButtonTouches.delete(touch.identifier);
      }
    }
    event.preventDefault();
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
      Input.#joystick.active = false;
      Input.#joystick.touchId = null;
      Input.#joystick.x = 0;
      Input.#joystick.y = 0;
      for (const name of BUTTON_NAMES) Input.#touchButtonState[name] = false;
      Input.#touchButtonTouches.clear();
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
