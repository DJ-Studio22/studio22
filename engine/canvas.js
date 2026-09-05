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

// Optional ceiling on devicePixelRatio. OFF by default -- see below.
//
// Phones report ratios of 3 and up, so a full-screen landscape canvas can
// allocate around 2.4 million pixels to clear and refill every frame.
// Capping at 2 cuts that by more than half, and at normal phone viewing
// distance the third pixel of detail is barely resolvable.
//
// It is deliberately not applied by default: capping trades away real
// sharpness on every device to buy fill rate, and that is only worth doing
// once a frame-rate problem has actually been traced to fill cost. Measure
// first -- a phone in Low Power Mode, for instance, is throttled to 30Hz by
// the OS and no amount of capping will move it. Games (or a diagnosis that
// pins the blame on fill rate) can opt in with the maxPixelRatio option:
// 2 is the usual choice, 1.5 for fill-heavy games, 1 for pixel art.
const DEFAULT_MAX_PIXEL_RATIO = Infinity;

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
  #maxPixelRatio;

  // Last applied layout, so repeated notifications that change nothing don't
  // reallocate the backing store (which is destructive -- see #applyLayout).
  #lastWidth = 0;
  #lastHeight = 0;
  #lastPixelRatio = 0;

  #resizeObserver = null;

  #requireOrientation; // 'landscape' | 'portrait' | null
  // Letterbox and orientation-overlay colour. The site default; a light
  // game changes it through setLetterboxColor(), which engine/shell.js calls
  // from its shellTheme option.
  #letterboxColor = 'var(--color-bg-0)';

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
   * @param {number}  [options.maxPixelRatio=Infinity]  Ceiling on devicePixelRatio.
   *                                             Uncapped by default; set 2 (or 1.5,
   *                                             or 1 for pixel art) only once fill
   *                                             rate is the confirmed bottleneck.
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
    this.#maxPixelRatio = options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO;
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

  // The pixel ratio actually in use after capping, which is not necessarily
  // window.devicePixelRatio. Exposed so a debug readout can show what the
  // canvas is really allocating rather than what the screen claims.
  get pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.#maxPixelRatio);
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

  /**
   * Colour of the letterbox bars and the orientation overlay.
   *
   * Defaults to the site's near-black. A LIGHT game needs this changed or it
   * plays inside two black bars, which reads as a rendering fault rather than
   * as framing. engine/shell.js calls this from its shellTheme option, so a
   * game declares the theme once and the frame follows.
   *
   * Takes a CSS value, so callers pass a var(--token) rather than a literal
   * and the palette stays in styles/tokens.css.
   */
  setLetterboxColor(cssValue) {
    this.#letterboxColor = cssValue;
    this.#container.style.background = cssValue;
    // The orientation overlay is built lazily, so it may not exist yet. It
    // reads #letterboxColor when it is created.
    if (this.#overlay) this.#overlay.style.background = cssValue;
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
    this.#container.style.background = this.#letterboxColor;
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
    this.#overlay.style.background = this.#letterboxColor;
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

    // Capped, not raw -- see DEFAULT_MAX_PIXEL_RATIO. This is the single
    // biggest lever on frame rate for a phone, because every pixel here is
    // one the GPU clears and refills on every single frame.
    const dpr = Math.min(window.devicePixelRatio || 1, this.#maxPixelRatio);

    // Nothing changed: skip the work entirely. Worth checking because a
    // ResizeObserver fires for every layout change, not just meaningful
    // ones, and reassigning canvas.width below throws away the pixel buffer
    // and every piece of context state along with it.
    if (displayWidth === this.#lastWidth
      && displayHeight === this.#lastHeight
      && dpr === this.#lastPixelRatio) {
      return;
    }
    this.#lastWidth = displayWidth;
    this.#lastHeight = displayHeight;
    this.#lastPixelRatio = dpr;

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

    // Watch the container itself, not just the window.
    //
    // This is the one that matters on a phone. The container's size changes
    // for plenty of reasons that never fire a window resize: a mobile URL
    // bar collapsing on first scroll (which changes what vh means), layout
    // settling after a webfont loads, a parent element being restyled. Left
    // to window events alone the canvas keeps whatever size it measured at
    // construction, and the letterbox bars are then computed against a
    // container that no longer exists -- the play area ends up too small
    // for its box, with dead space around it that no amount of rotating
    // the device clears up.
    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObserver = new ResizeObserver(() => this.resize());
      this.#resizeObserver.observe(this.#container);
    }

    // Belt and braces for mobile Safari, where the visual viewport can move
    // under the layout viewport (URL bar, on-screen keyboard) without either
    // a window resize or a container resize being reported.
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this.resize());
    }
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
