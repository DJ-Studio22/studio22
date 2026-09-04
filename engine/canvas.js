// engine/canvas.js
//
// Fixed-resolution, letterboxed, DPI-correct canvas for Studio 22.
//
// The problem this solves: a game that draws straight into a canvas sized to
// the window has to re-think every coordinate for every screen -- a 40px
// player is huge on a phone and a speck on a 4K monitor, and hit boxes tuned
// on a laptop are wrong everywhere else. So instead, every Studio 22 game
// draws into ONE fixed coordinate system (960x540 by default) and this class
// is solely responsible for getting those 960x540 units onto whatever glass
// the player actually has. Game code never asks how big the screen is.
//
// Three separate sizes are in play here, and keeping them straight is most
// of what this file does:
//
//   1. GAME SIZE     -- 960x540. Constant forever. What game code draws in.
//   2. DISPLAY SIZE  -- CSS pixels the canvas occupies on screen after being
//                       scaled to fit the viewport. Changes on every resize.
//   3. BACKING SIZE  -- the canvas element's real pixel buffer: display size
//                       multiplied by devicePixelRatio. This is the bit that
//                       keeps things sharp on a phone or a Retina display;
//                       skip it and everything looks soft.
//
// A single ctx transform maps (1) onto (3), so game code says
// ctx.fillRect(100, 100, 40, 40) and never learns that it actually landed at
// device pixel 237 on someone's 2.75x Android screen.
//
// Aspect ratio is always preserved -- the canvas is scaled by the smaller of
// the two axis ratios and centered, so any leftover space shows up as
// letterbox bars (top/bottom) or pillarbox bars (left/right). Games never
// stretch.

// --- Tunables -----------------------------------------------------------

// 16:9 at a size that's a clean divisor of most common resolutions, big
// enough for detail and small enough to fill cheaply.
const DEFAULT_GAME_WIDTH = 960;
const DEFAULT_GAME_HEIGHT = 540;

// How much bigger UI should get in TV mode. A player on a couch is roughly
// 3x further from the screen than a player at a desk, but text doesn't need
// to grow 3x to stay readable -- 1.5x is the point where HUD text stops
// being a squint without eating the play area.
const DEFAULT_TV_UI_SCALE = 1.5;

export class GameCanvas {
  // --- Internal state -----------------------------------------------------

  #gameWidth;
  #gameHeight;
  #container;
  #canvas;
  #ctx;
  #parent;

  #pixelArt;
  #tvMode;
  #tvUiScale;

  #requireOrientation; // 'landscape' | 'portrait' | null
  #overlay = null;
  #orientationBlocked = false;

  // Display size / game size. Exposed via the `scale` getter so games can
  // reason about things like touch target sizes in real screen terms.
  #scale = 1;

  /**
   * @param {object} options
   * @param {number}  [options.width=960]        Fixed internal width, in game units.
   * @param {number}  [options.height=540]       Fixed internal height, in game units.
   * @param {Element} [options.parent]           Where to mount. Defaults to document.body.
   * @param {boolean} [options.pixelArt=false]   Disable image smoothing for crisp sprites.
   * @param {boolean} [options.tvMode=false]     Scale UI up for couch viewing distance.
   * @param {number}  [options.tvUiScale=1.5]    Multiplier used when tvMode is on.
   * @param {string}  [options.requireOrientation]  'landscape' | 'portrait'. Shows a
   *                                             "rotate your device" overlay when the
   *                                             device is held the other way.
   * @param {string}  [options.rotateMessage]    Text for that overlay.
   */
  constructor(options = {}) {
    this.#gameWidth = options.width ?? DEFAULT_GAME_WIDTH;
    this.#gameHeight = options.height ?? DEFAULT_GAME_HEIGHT;
    this.#parent = options.parent ?? document.body;
    this.#pixelArt = options.pixelArt ?? false;
    this.#tvMode = options.tvMode ?? false;
    this.#tvUiScale = options.tvUiScale ?? DEFAULT_TV_UI_SCALE;
    this.#requireOrientation = options.requireOrientation ?? null;

    this.#buildDom(options.rotateMessage ?? 'Rotate your device');
    this.#listen();

    // Lay out once immediately so the canvas is usable the moment the
    // constructor returns -- a game shouldn't have to wait for a resize
    // event before its first frame draws correctly.
    this.resize();
  }

  // --- Public surface -----------------------------------------------------

  // The <canvas> element itself, for games that need to attach their own
  // pointer listeners to exactly the drawable area.
  get canvas() {
    return this.#canvas;
  }

  // The 2D context, already transformed into game coordinates.
  get ctx() {
    return this.#ctx;
  }

  // Fixed game-space dimensions. These never change for the life of the
  // page, which is the entire point of this class.
  get width() {
    return this.#gameWidth;
  }

  get height() {
    return this.#gameHeight;
  }

  // Display size / game size -- i.e. how many CSS pixels one game unit
  // currently occupies.
  get scale() {
    return this.#scale;
  }

  // Multiplier games should apply to HUD text and UI element sizes. 1 at a
  // desk, larger in TV mode. Kept as a plain number so draw code can do
  // `ctx.font = ${16 * canvas.uiScale}px ...` without branching.
  get uiScale() {
    return this.#tvMode ? this.#tvUiScale : 1;
  }

  // True while the "rotate your device" overlay is covering the screen.
  // Games can poll this to pause themselves; this class deliberately does
  // not reach into the game loop to do it for them.
  get isOrientationBlocked() {
    return this.#orientationBlocked;
  }

  /**
   * Converts a viewport coordinate (a MouseEvent's clientX/clientY, or a
   * Touch's clientX/clientY) into game space.
   *
   * Note the result is NOT clamped: a touch that lands on a letterbox bar
   * returns coordinates outside 0..width / 0..height. That's deliberate --
   * "the player touched outside the play area" is real information, and a
   * game that wants to ignore it can just range-check the result.
   */
  screenToGame(clientX, clientY) {
    const rect = this.#canvas.getBoundingClientRect();
    // A zero-sized rect means the canvas is hidden (display:none, or laid
    // out inside a collapsed parent). Return the origin rather than NaN.
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };

    return {
      x: ((clientX - rect.left) / rect.width) * this.#gameWidth,
      y: ((clientY - rect.top) / rect.height) * this.#gameHeight,
    };
  }

  // Toggle couch mode at runtime, e.g. from a settings screen.
  setTvMode(enabled) {
    this.#tvMode = Boolean(enabled);
    // Exposed to DOM UI as well, so HTML overlays can scale with the same
    // number the canvas draw code uses.
    this.#container.style.setProperty('--ui-scale', String(this.uiScale));
  }

  // Recomputes display size, backing store, and the game-space transform.
  // Called automatically on resize/orientation change; public so a game can
  // force it after doing something exotic to the layout itself.
  resize() {
    this.#applyLayout();
    this.#updateOrientationOverlay();
  }

  // --- DOM construction ---------------------------------------------------

  #buildDom(rotateMessage) {
    // The container is what actually produces the letterbox: it fills the
    // available area, paints the bar color, and centers the canvas inside
    // itself. Any space the canvas can't fill stays container background.
    this.#container = document.createElement('div');

    // When mounting to <body> we want the viewport, and position:fixed gets
    // that without depending on body having a height (an empty body is 0px
    // tall, which would collapse an absolutely-positioned container). For a
    // custom parent, fill that parent instead.
    const mountingToBody = this.#parent === document.body;
    this.#container.style.position = mountingToBody ? 'fixed' : 'absolute';
    this.#container.style.inset = '0';
    this.#container.style.display = 'flex';
    this.#container.style.alignItems = 'center';
    this.#container.style.justifyContent = 'center';
    this.#container.style.overflow = 'hidden';
    this.#container.style.background = 'var(--color-bg-0)';
    this.#container.style.setProperty('--ui-scale', String(this.uiScale));

    // An absolutely-positioned container needs a positioned ancestor or it
    // escapes to the nearest one and fills the wrong box.
    if (!mountingToBody && getComputedStyle(this.#parent).position === 'static') {
      this.#parent.style.position = 'relative';
    }

    this.#canvas = document.createElement('canvas');
    this.#canvas.style.display = 'block';
    if (this.#pixelArt) {
      // Belt and braces: imageSmoothingEnabled governs what the 2D context
      // does when it scales images, this governs what the browser does when
      // it scales the finished canvas up to its CSS size. Pixel art needs
      // both off or it goes soft on the way to the screen.
      this.#canvas.style.imageRendering = 'pixelated';
    }

    this.#ctx = this.#canvas.getContext('2d');

    this.#container.appendChild(this.#canvas);
    this.#parent.appendChild(this.#container);

    if (this.#requireOrientation) this.#buildOverlay(rotateMessage);
  }

  // The "rotate your device" screen. Built once and shown/hidden, rather
  // than created on demand, so flipping a phone can't cost a layout hitch.
  #buildOverlay(message) {
    this.#overlay = document.createElement('div');
    this.#overlay.style.position = 'absolute';
    this.#overlay.style.inset = '0';
    this.#overlay.style.display = 'none';
    this.#overlay.style.flexDirection = 'column';
    this.#overlay.style.alignItems = 'center';
    this.#overlay.style.justifyContent = 'center';
    this.#overlay.style.gap = 'var(--space-md)';
    this.#overlay.style.background = 'var(--color-bg-0)';
    this.#overlay.style.color = 'var(--color-text-primary)';
    this.#overlay.style.fontFamily = 'var(--font-display)';
    this.#overlay.style.textAlign = 'center';
    this.#overlay.style.padding = 'var(--space-xl)';
    // Above the canvas, and swallowing input so the player can't
    // accidentally play a game they can't see.
    this.#overlay.style.zIndex = '10';

    const icon = document.createElement('div');
    icon.textContent = '⟳';
    icon.style.fontSize = '4rem';
    icon.style.color = 'var(--color-accent)';

    const text = document.createElement('div');
    text.textContent = message;
    text.style.fontSize = '1.5rem';

    this.#overlay.appendChild(icon);
    this.#overlay.appendChild(text);
    this.#container.appendChild(this.#overlay);
  }

  // --- Layout -------------------------------------------------------------

  #applyLayout() {
    const availableWidth = this.#container.clientWidth;
    const availableHeight = this.#container.clientHeight;

    // Nothing sensible to compute while the container is collapsed (hidden
    // tab, display:none ancestor). Bail rather than divide by zero and
    // poison the transform with NaN.
    if (availableWidth === 0 || availableHeight === 0) return;

    // Fit-to-viewport: take the smaller ratio so the whole play area stays
    // visible, and whatever's left over becomes letterbox/pillarbox bars.
    // Using the larger ratio would fill the screen but crop the game.
    const fitScale = Math.min(
      availableWidth / this.#gameWidth,
      availableHeight / this.#gameHeight,
    );

    // Floor to whole CSS pixels: a fractional display size makes the browser
    // resample the canvas an extra time, which shows up as shimmer along
    // sprite edges.
    const displayWidth = Math.floor(this.#gameWidth * fitScale);
    const displayHeight = Math.floor(this.#gameHeight * fitScale);

    const dpr = window.devicePixelRatio || 1;
    const backingWidth = Math.round(displayWidth * dpr);
    const backingHeight = Math.round(displayHeight * dpr);

    // Assigning canvas.width/height is destructive -- it reallocates the
    // pixel buffer AND resets every piece of context state (transform,
    // smoothing, fillStyle, the lot). So only do it when the size actually
    // changed, and re-apply our state immediately afterwards.
    if (this.#canvas.width !== backingWidth || this.#canvas.height !== backingHeight) {
      this.#canvas.width = backingWidth;
      this.#canvas.height = backingHeight;
    }

    this.#canvas.style.width = `${displayWidth}px`;
    this.#canvas.style.height = `${displayHeight}px`;

    // The one transform that makes the whole abstraction work: game units in,
    // device pixels out. Set (not multiplied) every layout so repeated
    // resizes can't compound.
    this.#ctx.setTransform(
      backingWidth / this.#gameWidth, 0,
      0, backingHeight / this.#gameHeight,
      0, 0,
    );

    // Re-applied here because the canvas.width assignment above may have
    // just cleared it.
    this.#ctx.imageSmoothingEnabled = !this.#pixelArt;

    this.#scale = displayWidth / this.#gameWidth;
  }

  #updateOrientationOverlay() {
    if (!this.#requireOrientation || !this.#overlay) return;

    // Comparing viewport dimensions rather than reading screen.orientation:
    // the orientation API reports the *device's* rotation, which is not the
    // same question as "is the window currently wider than it is tall" --
    // and it's the window shape that decides whether the game fits.
    const isLandscape = window.innerWidth >= window.innerHeight;
    const blocked =
      (this.#requireOrientation === 'landscape' && !isLandscape) ||
      (this.#requireOrientation === 'portrait' && isLandscape);

    this.#orientationBlocked = blocked;
    this.#overlay.style.display = blocked ? 'flex' : 'none';
  }

  // --- Events -------------------------------------------------------------

  #listen() {
    window.addEventListener('resize', () => this.resize());

    window.addEventListener('orientationchange', () => {
      // iOS Safari (and some Android browsers) fire this *before* the
      // viewport dimensions actually change, so measuring right now reads
      // the pre-rotation size. Waiting one frame lets the viewport settle.
      requestAnimationFrame(() => this.resize());
    });
  }
}

// -------------------------------------------------------------------
// Usage example (not executed -- for games importing this module)
// -------------------------------------------------------------------
//
// import { GameCanvas } from '../../engine/canvas.js';
//
// const screen = new GameCanvas({ width: 960, height: 540 });
// const ctx = screen.ctx;
//
// function render() {
//   // Always in game units -- 960x540 no matter what the display is doing.
//   ctx.clearRect(0, 0, screen.width, screen.height);
//   ctx.fillStyle = 'white';
//   ctx.fillRect(100, 100, 40, 40);
//
//   // HUD text grows in TV mode without the game doing any math.
//   ctx.font = `${16 * screen.uiScale}px sans-serif`;
//   ctx.fillText('SCORE 0', 20, 30);
// }
//
// // Turning a tap into a game-space position:
// screen.canvas.addEventListener('pointerdown', (e) => {
//   const p = screen.screenToGame(e.clientX, e.clientY);
//   console.log('tapped game coords', p.x, p.y);
// });
