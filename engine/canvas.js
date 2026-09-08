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
//
// EXCEPT THAT A PHONE IS NOT 16:9, and preserving an aspect ratio nothing on
// the device shares means throwing away a third of the screen.
//
// An iPhone 14 Pro Max in landscape is 932x430 CSS pixels: an aspect of 2.17,
// far wider than any stage in the arcade. Measured across all twenty-three
// games at that viewport, the play area covered between 63% and 92% of the
// screen, with 72 to 348 pixels of black bar down the sides. Mini Golf drew
// into 584 pixels of a 932-pixel screen. The framing was correct and the game
// was playing in a strip.
//
// So there is a fourth size, and it is the one this file now exists to
// produce:
//
//   4. STAGE SIZE -- the game size, WIDENED to whatever the screen actually
//                    is. The extra arrives as a MARGIN on each side, in game
//                    units, at negative x on the left and beyond width on the
//                    right. Game coordinates do not move: x=0 is still the
//                    left edge of the game's own 960, and everything a game
//                    already draws lands exactly where it always did.
//
// That last property is the whole design. A game needs no changes to keep
// working; it needs one change -- painting its background across the margin --
// to fill the screen. For a game with a camera that is all it needs, because
// the extra margin then shows more world. For a game with a fixed board the
// board stays centred and the margin becomes backdrop, which is the honest
// answer: a golf hole is a fixed shape and the alternative to framing it is
// stretching it.
//
// The margin is CAPPED (see MAX_STAGE_MARGIN). An ultra-wide desktop monitor
// would otherwise hand a runner half a screen of extra look-ahead, which is
// not framing, it is a difficulty change.

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

// How far the stage may widen, as a fraction of the game's own width, on each
// side. 0.35 each side is 1.7x overall, which takes a 16:9 game to 3.02:1 --
// past every phone in landscape (an iPhone 14 Pro Max is 2.17) and short of
// the point where a game is showing so much extra world that the difficulty
// moved. Games that want a different ceiling pass maxStageMargin; a game that
// must never widen passes 0.
const MAX_STAGE_MARGIN = 0.35;

// How much better the OTHER orientation has to be before the player is asked to
// turn the device. 1.2, and the fifteen per cent it came down from is a real
// bug rather than a rounding: Number Crunch, Sinkhole and Neon Drift cover 0.523
// held landscape and 0.692 held portrait -- a third more screen, plainly worth
// turning for -- and 0.692 is just under 0.523 x 1.35, so all three sat in a
// strip with bars down both sides and no prompt to fix it. Measured across all
// twenty-three games in both orientations: at 1.2 every game that bars asks, and
// no game that fills does.
const TURN_IS_WORTH_IT = 1.2;

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

// The visible box and the safe-area insets. See engine/viewport.js: on a phone
// the window is three different sizes and only one of them is the one the
// player can see.
import { Viewport } from './viewport.js';
// The canvas is the only thing that knows where the play area ended up, and
// engine/input.js is the only thing that decides where a thumb should find a
// control. This is how the first tells the second.
import { Input } from './input.js';

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
  #lastMargin = -1;

  #resizeObserver = null;

  #requireOrientation; // 'landscape' | 'portrait' | null
  // Letterbox and orientation-overlay colour. The site default; a light
  // game changes it through setLetterboxColor(), which engine/shell.js calls
  // from its shellTheme option.
  #letterboxColor = 'var(--color-bg-0)';

  #overlay = null;
  #orientationBlocked = false;

  // The accessible name for the <canvas>. A game page is one canvas and
  // nothing else, so this is the only text an assistive reader has to go on.
  // Defaults to the page title, which every game index.html already sets to
  // "<Game> — Studio 22", so a game gets a correct label without passing one.
  #label;

  // Display size / game size. Exposed via the `scale` getter so games can
  // reason about things like touch target sizes in real screen terms.
  #scale = 1;

  // Extra game units visible on EACH side of the game's own width. Zero on a
  // screen no wider than the game. See the note at the top of this file.
  #margin = 0;
  #maxStageMargin;

  /**
   * @param {object} options
   * @param {number}  [options.width=960]        Fixed internal width, in game units.
   * @param {number}  [options.height=540]       Fixed internal height, in game units.
   * @param {Element} [options.parent]           Where to mount. Defaults to document.body.
   * @param {boolean} [options.pixelArt=false]   Disable image smoothing for crisp sprites.
   * @param {boolean} [options.tvMode=false]     Scale UI up for couch viewing distance.
   * @param {number}  [options.tvUiScale=1.5]    Multiplier used when tvMode is on.
   * @param {number}  [options.maxStageMargin=0.35]  How far the stage may widen on
   *                                             each side, as a fraction of width, on
   *                                             a screen wider than the game. 0 pins
   *                                             the stage and restores pillarboxing.
   * @param {number}  [options.maxPixelRatio=Infinity]  Ceiling on devicePixelRatio.
   *                                             Uncapped by default; set 2 (or 1.5,
   *                                             or 1 for pixel art) only once fill
   *                                             rate is the confirmed bottleneck.
   * @param {string}  [options.requireOrientation]  'landscape' | 'portrait'. Shows a
   *                                             "rotate your device" overlay when the
   *                                             device is held the other way.
   * @param {string}  [options.rotateMessage]    Text for that overlay.
   * @param {string}  [options.label]            Accessible name for the canvas.
   *                                             Defaults to document.title.
   */
  constructor(options = {}) {
    this.#gameWidth = options.width ?? DEFAULT_GAME_WIDTH;
    this.#gameHeight = options.height ?? DEFAULT_GAME_HEIGHT;
    this.#parent = options.parent ?? document.body;
    this.#pixelArt = options.pixelArt ?? false;
    this.#tvMode = options.tvMode ?? false;
    this.#tvUiScale = options.tvUiScale ?? DEFAULT_TV_UI_SCALE;
    this.#maxPixelRatio = options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO;
    this.#maxStageMargin = options.maxStageMargin ?? MAX_STAGE_MARGIN;
    this.#requireOrientation = options.requireOrientation ?? null;
    this.#label = options.label ?? document.title ?? 'Game';

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
  //
  // `width` stays the game's OWN width even when the stage is wider, because
  // every layout a game has ever written is expressed against it and moving it
  // would move all of them. What changed is that there is now visible canvas
  // outside 0..width; see `margin`, `left` and `right`.
  get width() {
    return this.#gameWidth;
  }

  get height() {
    return this.#gameHeight;
  }

  /**
   * Extra game units visible on each side of 0..width. Zero on a screen no
   * wider than the game, and on a desktop window that is not especially wide.
   *
   * A game paints its backdrop across `left..right` instead of `0..width` and
   * that is normally the entire change. Anything drawn with a camera transform
   * already lands correctly in the margin without being asked.
   */
  get margin() {
    return this.#margin;
  }

  /** Leftmost visible game x. Negative when the stage is wider than the game. */
  get left() {
    // Not `-this.#margin`: negating zero gives -0, which is equal to 0 under ==
    // and ===, and NOT equal to it under Object.is or assert.equal. So it reads
    // as zero everywhere a human looks and fails a test. Cheaper not to make it.
    return this.#margin === 0 ? 0 : -this.#margin;
  }

  /** Rightmost visible game x. */
  get right() {
    return this.#gameWidth + this.#margin;
  }

  /** Total visible width in game units: right - left. */
  get stageWidth() {
    return this.#gameWidth + this.#margin * 2;
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

    // Across the STAGE and then back into game coordinates, so a touch on the
    // left margin reports a negative x rather than being squashed into 0..width.
    // A pad drawn out there has to hit-test out there.
    return {
      x: ((clientX - rect.left) / rect.width) * this.stageWidth - this.#margin,
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
    // inset:0 is the layout viewport, which on iOS Safari is the size the page
    // gets once the toolbar has collapsed -- taller than what is on screen
    // while it is still up. #applyLayout replaces this with the visible box on
    // every layout; this is only the value before the first measurement.
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

    // A game page is a <body> with one canvas in it, so without this it has
    // no heading and no named content at all: a screen reader lands on an
    // unlabelled graphic on a page it cannot navigate. Both fixes live here
    // rather than in nine copies of index.html, so a new game gets them by
    // existing rather than by remembering.
    this.#canvas.setAttribute('role', 'img');
    this.#canvas.setAttribute('aria-label', this.#label);
    // Read by assistive tech that ignores canvas entirely, and by anyone who
    // has canvas turned off.
    this.#canvas.textContent =
      `${this.#label}. A game played on a canvas, which this browser cannot show.`;
    if (this.#pixelArt) {
      // Belt and braces: imageSmoothingEnabled governs what the 2D context
      // does when it scales images, this governs what the browser does when
      // it scales the finished canvas up to its CSS size. Pixel art needs
      // both off or it goes soft on the way to the screen.
      this.#canvas.style.imageRendering = 'pixelated';
    }

    this.#ctx = this.#canvas.getContext('2d');

    this.#container.appendChild(this.#canvas);
    // The game has booted, so the "if this stays, it failed" message can go.
    // Removed HERE rather than by the game, because this is the first thing
    // that runs once the whole module graph has actually parsed — which is
    // the failure the message exists for.
    document.getElementById('boot-fallback')?.remove();

    this.#parent.appendChild(this.#container);

    // Built for every game, because #updateOrientationOverlay can now decide
    // to ask on its own -- see the note there.
    this.#buildOverlay(rotateMessage);
  }

  // The "rotate your device" screen. Built once and shown/hidden, rather
  // than created on demand, so flipping a phone can't cost a layout hitch.
  #buildOverlay(message) {
    this.#overlay = document.createElement('div');
    // Tagged so a test can ask whether the game is currently asking to be
    // turned, rather than guessing from the text inside it.
    this.#overlay.dataset.orientationOverlay = 'true';
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
    // THE CONTAINER IS PINNED TO THE VISIBLE BOX, not to the layout viewport.
    //
    // Only when mounted to <body>: a game embedded in somebody else's element
    // should fill that element, which is what inset:0 already does.
    if (this.#parent === document.body) {
      const box = Viewport.box;
      this.#container.style.inset = 'auto';
      this.#container.style.left = `${box.left}px`;
      this.#container.style.top = `${box.top}px`;
      this.#container.style.width = `${box.width}px`;
      this.#container.style.height = `${box.height}px`;
    }

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

    // WIDEN THE STAGE RATHER THAN BAR IT, when the screen is wider than the
    // game and the game allows it.
    //
    // Height is what sets the scale in that case: the game keeps every unit
    // the size it would have been, and the screen's extra width buys extra
    // game units instead of black. On a screen that is NOT wider than the
    // game -- a portrait phone, a tall window -- fitScale already came from
    // the width, there is no spare width to spend, and this leaves everything
    // exactly as it was.
    const heightScale = availableHeight / this.#gameHeight;
    const wantedStage = availableWidth / heightScale;
    const ceiling = this.#gameWidth * (1 + this.#maxStageMargin * 2);
    const stageWidth = Math.max(
      this.#gameWidth,
      Math.min(wantedStage, ceiling),
    );
    this.#margin = (stageWidth - this.#gameWidth) / 2;
    // Only the widened case gets to leave fitScale behind. Past the ceiling
    // the leftover really is a bar again, and it is scaled to fit like always.
    const scale = this.#margin > 0 ? heightScale : fitScale;

    // Floor to whole CSS pixels: a fractional display size makes the browser
    // resample the canvas an extra time, which shows up as shimmer along
    // sprite edges.
    const displayWidth = Math.floor(stageWidth * scale);
    const displayHeight = Math.floor(this.#gameHeight * scale);

    // Capped, not raw -- see DEFAULT_MAX_PIXEL_RATIO. This is the single
    // biggest lever on frame rate for a phone, because every pixel here is
    // one the GPU clears and refills on every single frame.
    const dpr = Math.min(window.devicePixelRatio || 1, this.#maxPixelRatio);

    // Nothing changed: skip the work entirely. Worth checking because a
    // ResizeObserver fires for every layout change, not just meaningful
    // ones, and reassigning canvas.width below throws away the pixel buffer
    // and every piece of context state along with it.
    // The margin is part of the cache key. Two different stage widths can floor
    // to the same display width, and skipping the transform then would leave the
    // canvas drawing against the previous stage -- a half-pixel class of bug
    // that shows up as everything being shifted sideways by a hair after a
    // resize, which is the kind of thing nobody finds on purpose.
    if (displayWidth === this.#lastWidth
      && displayHeight === this.#lastHeight
      && this.#margin === this.#lastMargin
      && dpr === this.#lastPixelRatio) {
      return;
    }
    this.#lastWidth = displayWidth;
    this.#lastHeight = displayHeight;
    this.#lastMargin = this.#margin;
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
    //
    // The translate is what keeps the promise made at the top of this file:
    // the stage may be wider, but game x=0 still lands where the game's own
    // left edge has always been, so nothing a game already draws moves. The
    // margin is simply canvas that exists at negative x.
    const unitsAcross = this.stageWidth;
    this.#ctx.setTransform(
      backingWidth / unitsAcross, 0,
      0, backingHeight / this.#gameHeight,
      (this.#margin * backingWidth) / unitsAcross, 0,
    );

    // Re-applied here because the canvas.width assignment above may have
    // just cleared it.
    this.#ctx.imageSmoothingEnabled = !this.#pixelArt;

    this.#scale = displayWidth / this.stageWidth;

    // Touch controls belong on the play area, not on the letterbox bars beside
    // it. Pushed rather than pulled because this is the moment the answer
    // changes, and a control placed against a stale rectangle is a control in
    // the wrong place.
    const rect = this.#canvas.getBoundingClientRect();
    Input.setControlBounds({
      left: rect.left, top: rect.top, width: rect.width, height: rect.height,
    });
  }

  #updateOrientationOverlay() {
    if (!this.#overlay) return;

    // Comparing viewport dimensions rather than reading screen.orientation:
    // the orientation API reports the *device's* rotation, which is not the
    // same question as "is the window currently wider than it is tall" --
    // and it's the window shape that decides whether the game fits.
    const isLandscape = window.innerWidth >= window.innerHeight;

    let blocked = false;
    if (this.#requireOrientation) {
      blocked =
        (this.#requireOrientation === 'landscape' && !isLandscape) ||
        (this.#requireOrientation === 'portrait' && isLandscape);
    } else {
      blocked = this.#shouldAskToRotate();
    }

    this.#orientationBlocked = blocked;
    this.#overlay.style.display = blocked ? 'flex' : 'none';
  }

  /**
   * ASK THE PLAYER TO TURN THE PHONE, but only when turning it actually helps.
   *
   * No game in the arcade declared an orientation, so on a phone every one of
   * them was playable in both -- and in the wrong one, unrecognisably. Measured
   * across all twenty-three at iPhone-14-Pro-Max size, each game covers 63% to
   * 92% of the screen in the orientation it was drawn for and 23% to 34% in the
   * other: a postage stamp in the middle of a black field.
   *
   * The decision is made from the game's own shape rather than from a flag on
   * every game, because the shape is the thing that decides it. If rotating the
   * device would fit the play area appreciably better AND the current fit is
   * poor, say so. Otherwise stay out of the way -- a 4:3 game on a laptop is
   * letterboxed and nobody needs telling.
   *
   * Never on a desktop: a window that happens to be narrow is not a phone that
   * can be turned, and telling somebody to rotate their monitor is absurd.
   */
  #shouldAskToRotate() {
    const canRotate = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (!canRotate) return false;

    const width = this.#container.clientWidth;
    const height = this.#container.clientHeight;
    if (!width || !height) return false;

    // What share of the screen the play area covers held THIS way against
    // held the other way, both computed the way #applyLayout would -- widening
    // included, because a stage that widens to fill the screen is not asking
    // anybody to rotate anything.
    const covered = (w, h) => {
      const heightScale = h / this.#gameHeight;
      const ceiling = this.#gameWidth * (1 + this.#maxStageMargin * 2);
      const stage = Math.max(this.#gameWidth, Math.min(w / heightScale, ceiling));
      const scale = stage > this.#gameWidth
        ? heightScale
        : Math.min(w / this.#gameWidth, h / this.#gameHeight);
      return (stage * scale * this.#gameHeight * scale) / (w * h);
    };
    const now = covered(width, height);
    const turned = covered(height, width);
    if (now <= 0) return false;
    // 0.6 rather than 0.45: with the stage widening, a portrait game held
    // landscape now covers 43-52% instead of 25-31%, and half the screen is
    // still a strip. The old threshold would have quietly stopped asking.
    return now < 0.6 && turned > now * TURN_IS_WORTH_IT;
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

    // The visible box moving is its own event: a URL bar collapsing or an
    // on-screen keyboard opening changes what is on screen without firing a
    // window resize or a container resize at all. Viewport.onChange covers
    // resize, orientationchange and both visualViewport events in one place, so
    // this and engine/input.js cannot end up listening to different things.
    Viewport.onChange(() => this.resize());
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
