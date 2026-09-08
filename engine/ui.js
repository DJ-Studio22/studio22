// engine/ui.js
//
// Canvas drawing primitives for Studio 22 chrome -- panels, buttons, text.
//
// Why this is separate from shell.js: the shell is a state machine (which
// screen is open, what's selected, what happens on confirm). This file is
// pure pixels, with no state of its own beyond a cached color lookup.
// Splitting them means shell.js reads as menu logic instead of font
// arithmetic, and a game that wants its own title screen to match the rest
// of the suite can draw one without importing the whole shell.
//
// Two rules everything here follows:
//
//   1. Draw in GAME COORDINATES. Callers are already inside a GameCanvas
//      transform (see canvas.js), so a button at x=100 is at x=100 in game
//      space on every screen size. Nothing here reads the window.
//
//   2. Take an explicit `scale`. TV mode makes text bigger and outlines
//      thicker, and passing GameCanvas's uiScale in means no caller has to
//      do that arithmetic itself. Default 1 so it can be ignored.
//
// Colors and fonts come from styles/tokens.css, resolved once and cached --
// canvas fillStyle can't read a CSS custom property directly, so the values
// have to be pulled out of the document first.

// Token name for each key this module exposes, per theme. tokens.css remains
// the only place the palette is actually defined.
//
// TWO THEMES, ONE SHAPE. The site is dark and stays dark; the light set
// exists because the shell draws ON TOP OF a game, and a game is free to be
// bright. Both maps carry exactly the same keys, so switching themes swaps
// one lookup table for another and no drawing code below has to know which
// one is in force.
//
// Fonts are shared: a theme is a palette, not a typeface.
const FONT_NAMES = {
  fontDisplay: '--font-display',
  fontBody: '--font-body',
  fontMono: '--font-mono',
};

const THEME_TOKENS = {
  dark: {
    bg0: '--color-bg-0',
    bg1: '--color-bg-1',
    bg2: '--color-bg-2',
    bg3: '--color-bg-3',
    accent: '--color-accent',
    accent2: '--color-accent-2',
    textPrimary: '--color-text-primary',
    textSecondary: '--color-text-secondary',
    textDisabled: '--color-text-disabled',
    ...FONT_NAMES,
  },
  light: {
    bg0: '--color-shell-light-bg-0',
    bg1: '--color-shell-light-bg-1',
    bg2: '--color-shell-light-bg-2',
    bg3: '--color-shell-light-bg-3',
    accent: '--color-shell-light-accent',
    accent2: '--color-shell-light-accent-2',
    textPrimary: '--color-shell-light-text-primary',
    textSecondary: '--color-shell-light-text-secondary',
    textDisabled: '--color-shell-light-text-disabled',
    ...FONT_NAMES,
  },
};

export const THEMES = Object.keys(THEME_TOKENS);

// Only reached if tokens.css failed to load. Deliberately generic CSS
// keywords rather than copies of the real palette: the design values live in
// tokens.css and nowhere else, and these exist purely so a missing
// stylesheet degrades to "plain but readable" instead of "invisible".
const DEGRADED = {
  dark: {
    bg0: 'black',
    bg1: 'black',
    bg2: 'dimgray',
    bg3: 'gray',
    accent: 'cyan',
    accent2: 'magenta',
    textPrimary: 'white',
    textSecondary: 'silver',
    textDisabled: 'gray',
    fontDisplay: 'sans-serif',
    fontBody: 'sans-serif',
    fontMono: 'monospace',
  },
  light: {
    bg0: 'white',
    bg1: 'white',
    bg2: 'gainsboro',
    bg3: 'silver',
    accent: 'darkred',
    accent2: 'darkgreen',
    textPrimary: 'black',
    textSecondary: 'dimgray',
    textDisabled: 'gray',
    fontDisplay: 'sans-serif',
    fontBody: 'sans-serif',
    fontMono: 'monospace',
  },
};

// One cache per theme. A page only ever uses one, but caching by name means
// switching costs a single lookup rather than a fresh getComputedStyle pass.
const cachedTokens = { dark: null, light: null };

// Which palette tokens() hands back when no theme is named. Set once per page
// by engine/shell.js from its shellTheme option; there is exactly one shell
// per document, so this is a page-level fact rather than shared mutable state
// two callers could fight over.
let currentTheme = 'dark';

export const UI = {
  // Resolved token values, looked up on first use. Cached because
  // getComputedStyle is a layout read and this gets called every frame an
  // overlay is open.
  tokens(theme = currentTheme) {
    const name = THEME_TOKENS[theme] ? theme : 'dark';
    if (cachedTokens[name]) return cachedTokens[name];

    const style = getComputedStyle(document.documentElement);
    const resolved = {};
    for (const [key, cssName] of Object.entries(THEME_TOKENS[name])) {
      const value = style.getPropertyValue(cssName).trim();
      resolved[key] = value || DEGRADED[name][key];
    }
    cachedTokens[name] = resolved;
    return resolved;
  },

  /**
   * Chooses the palette every UI.* call draws in from here on.
   *
   * Called by engine/shell.js from its shellTheme option, so a game declares
   * this once in its config rather than passing a theme through every draw
   * call. A game drawing its own screens with these primitives picks up the
   * same choice for free, which is the point — a bright game with dark
   * chrome on its own setup screen would look like two different games.
   */
  setTheme(theme) {
    currentTheme = THEME_TOKENS[theme] ? theme : 'dark';
  },

  get theme() {
    return currentTheme;
  },

  // Drops the cache so the next draw re-reads tokens.css. Only needed if the
  // stylesheet is swapped at runtime; here mainly so tests can force a
  // re-read.
  refreshTokens() {
    cachedTokens.dark = null;
    cachedTokens.light = null;
  },

  // Rounded-rectangle path. Left as a path (not filled) so callers can fill,
  // stroke, or both without this needing options for every combination.
  roundRect(ctx, x, y, w, h, radius) {
    // Clamp so a large radius on a small box can't invert the curves.
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  // Full-area dim behind an overlay, so the frozen game stays readable as
  // context without competing with the menu on top of it.
  /**
   * The dim behind an overlay.
   *
   * `x` and `y` default to the origin, which is what every caller meant when
   * the canvas began at the origin. On a screen wider than the game it does
   * not: the canvas extends to negative x (see engine/canvas.js), and a scrim
   * that starts at zero leaves the left margin of the frozen game undimmed
   * beside a dimmed one.
   */
  scrim(ctx, w, h, alpha = 0.72, x = 0, y = 0) {
    const t = UI.tokens();
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = t.bg0;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  },

  // The card every overlay screen sits on.
  panel(ctx, x, y, w, h, { scale = 1, radius = 16 } = {}) {
    const t = UI.tokens();
    UI.roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = t.bg1;
    ctx.fill();
    ctx.strokeStyle = t.bg3;
    ctx.lineWidth = 2 * scale;
    ctx.stroke();
  },

  /**
   * Draws a line of text.
   * @param {object} [opts]
   *   size    font size in game units BEFORE scale is applied (default 18)
   *   color   any token value or CSS color (default textPrimary)
   *   font    'display' | 'body' | 'mono' (default 'body')
   *   weight  CSS font weight (default '400')
   *   align   canvas textAlign (default 'left')
   *   baseline canvas textBaseline (default 'alphabetic')
   *   scale   TV-mode multiplier (default 1)
   */
  text(ctx, value, x, y, opts = {}) {
    const t = UI.tokens();
    const {
      size = 18, color = t.textPrimary, font = 'body', weight = '400',
      align = 'left', baseline = 'alphabetic', scale = 1,
    } = opts;

    const family = font === 'display' ? t.fontDisplay : font === 'mono' ? t.fontMono : t.fontBody;

    ctx.save();
    ctx.font = `${weight} ${size * scale}px ${family}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(String(value), x, y);
    ctx.restore();
  },

  // Width of a string under the same font rules as text(), for callers that
  // need to lay something out beside it.
  measure(ctx, value, opts = {}) {
    const t = UI.tokens();
    const { size = 18, font = 'body', weight = '400', scale = 1 } = opts;
    const family = font === 'display' ? t.fontDisplay : font === 'mono' ? t.fontMono : t.fontBody;

    ctx.save();
    ctx.font = `${weight} ${size * scale}px ${family}`;
    const width = ctx.measureText(String(value)).width;
    ctx.restore();
    return width;
  },

  /**
   * A menu button. `rect` is { x, y, w, h } in game units.
   *
   * The selected state deliberately changes fill AND text color rather than
   * just adding an outline: on a phone in sunlight, or across a room in TV
   * mode, a thin highlight ring is the first thing to become invisible.
   */
  button(ctx, rect, label, { selected = false, scale = 1 } = {}) {
    const t = UI.tokens();
    const { x, y, w, h } = rect;

    UI.roundRect(ctx, x, y, w, h, 10);
    ctx.fillStyle = selected ? t.accent : t.bg2;
    ctx.fill();
    ctx.strokeStyle = selected ? t.accent : t.bg3;
    ctx.lineWidth = (selected ? 3 : 2) * scale;
    ctx.stroke();

    UI.text(ctx, label, x + w / 2, y + h / 2, {
      size: 20,
      color: selected ? t.bg0 : t.textPrimary,
      font: 'body',
      weight: selected ? '700' : '400',
      align: 'center',
      baseline: 'middle',
      scale,
    });
  },
};

// -------------------------------------------------------------------
// Usage example (not executed -- for callers importing this module)
// -------------------------------------------------------------------
//
// import { UI } from '../../engine/ui.js';
//
// const ctx = screen.ctx;
// const scale = screen.uiScale;          // 1, or 1.5 in TV mode
//
// UI.scrim(ctx, screen.width, screen.height);
// UI.panel(ctx, 240, 120, 480, 300, { scale });
// UI.text(ctx, 'PAUSED', 480, 170, {
//   size: 34, font: 'display', align: 'center', scale,
// });
// UI.button(ctx, { x: 300, y: 220, w: 360, h: 52 }, 'Resume', {
//   selected: true, scale,
// });
