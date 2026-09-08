// engine/viewport.js
//
// WHERE THE SCREEN ACTUALLY IS.
//
// On a desktop browser this is a boring question: the window is the window.
// On a phone it is three different answers that disagree with each other, and
// every one of them is wrong somewhere:
//
//   window.innerWidth/innerHeight   the LAYOUT viewport. On iOS Safari this is
//                                   the size the page gets once the toolbars
//                                   have collapsed -- which is TALLER than what
//                                   the player can see while the toolbar is
//                                   still up. Anything positioned against it
//                                   before that first scroll is placed partly
//                                   underneath the browser chrome.
//
//   visualViewport                  what is actually on screen right now,
//                                   including the effect of the toolbar and the
//                                   on-screen keyboard. This is the honest one.
//
//   env(safe-area-inset-*)          the parts of that which are behind the
//                                   notch, the rounded corners and the home
//                                   indicator. The page is allowed to draw
//                                   there -- with viewport-fit=cover it must,
//                                   or there are black bands down the sides in
//                                   landscape -- but nothing a finger has to
//                                   FIND should live there.
//
// The bug this module exists to kill: engine/shell.js drew the touch pads at
// `ratio * window.innerHeight` and engine/input.js hit-tested them at exactly
// the same figure. They agreed with each other perfectly and both were wrong,
// so on an iPhone with the toolbar showing the bottom row of controls sat below
// the visible area -- present, consistent, and unreachable.
//
// So: one box, asked for in one place, and everything that has to line up with
// a thumb reads it.

const listeners = new Set();
let probe = null;

/**
 * A hidden element whose padding is the safe-area insets.
 *
 * There is no JavaScript API for env(), so the only way to read it is to let
 * CSS resolve it onto something and then ask for the computed value. Padding
 * rather than margin because a collapsed margin reads back as zero.
 */
function ensureProbe() {
  if (probe || typeof document === 'undefined') return probe;
  probe = document.createElement('div');
  // Findable from a test: the only way to check that a non-zero inset actually
  // moves a control is to force one onto this element and look at where the
  // control went. Headless Chrome always reports zero for env(), so nothing
  // else can exercise the path.
  probe.dataset.viewportProbe = 'true';
  probe.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'width:0',
    'height:0',
    'visibility:hidden',
    'pointer-events:none',
    'padding-top:env(safe-area-inset-top, 0px)',
    'padding-right:env(safe-area-inset-right, 0px)',
    'padding-bottom:env(safe-area-inset-bottom, 0px)',
    'padding-left:env(safe-area-inset-left, 0px)',
  ].join(';');
  document.documentElement.appendChild(probe);
  return probe;
}

const px = (value) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

export class Viewport {
  /**
   * The visible box, in CSS pixels, relative to the layout viewport origin.
   *
   * visualViewport is preferred because it is the only one that knows about
   * the toolbar -- but NOT while the player is pinch-zoomed, because then it
   * describes the zoomed window rather than the screen, and sizing a game to it
   * would shrink the game every time somebody's thumb slipped.
   */
  static get box() {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const zoomed = vv && vv.scale > 1.01;
    if (vv && !zoomed) {
      return {
        left: vv.offsetLeft,
        top: vv.offsetTop,
        width: vv.width,
        height: vv.height,
      };
    }
    return {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  /** The parts of the box that are behind a notch, a corner or a home bar. */
  static get insets() {
    const element = ensureProbe();
    if (!element) return { top: 0, right: 0, bottom: 0, left: 0 };
    const style = getComputedStyle(element);
    return {
      top: px(style.paddingTop),
      right: px(style.paddingRight),
      bottom: px(style.paddingBottom),
      left: px(style.paddingLeft),
    };
  }

  /**
   * The box a thumb can actually reach: visible, minus the hardware.
   *
   * This is what touch controls are placed and hit-tested against. A pad in the
   * home-indicator strip is a pad that either does nothing or fights the
   * system gesture, and both feel like the game is broken.
   */
  static get safe() {
    const box = Viewport.box;
    const insets = Viewport.insets;
    return {
      left: box.left + insets.left,
      top: box.top + insets.top,
      width: Math.max(0, box.width - insets.left - insets.right),
      height: Math.max(0, box.height - insets.top - insets.bottom),
    };
  }

  /**
   * Run `fn` whenever the answer changes.
   *
   * All four events matter and none of them is redundant: `resize` for
   * rotation and desktop windows, `orientationchange` because iOS fires it
   * before the dimensions settle, and the two visualViewport events because
   * the toolbar sliding away moves the visible box without either of the
   * others firing at all.
   */
  static onChange(fn) {
    listeners.add(fn);
    if (listeners.size === 1) Viewport.#listen();
    return () => listeners.delete(fn);
  }

  static #listening = false;

  static #listen() {
    if (Viewport.#listening || typeof window === 'undefined') return;
    Viewport.#listening = true;
    const fire = () => { for (const fn of listeners) fn(); };
    window.addEventListener('resize', fire);
    window.addEventListener('orientationchange', () => {
      // iOS reports the pre-rotation size if you measure immediately.
      requestAnimationFrame(fire);
      setTimeout(fire, 250);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', fire);
      window.visualViewport.addEventListener('scroll', fire);
    }
  }
}
