// engine/best-marker.js
//
// The session-best line, and the small celebration for crossing it.
//
// WHAT THIS IS
// ------------
// In a game scored on how far you got -- height, depth, distance -- the
// session best is a place in the world, not only a number in the corner. This
// draws it there: a dashed line across the course at the point the last best
// run reached, labelled with the figure. Passing it is the moment a run turns
// from "another go" into "further than before", and the marker marks that too,
// with a brief burst of confetti at the player and a pulse on the label.
//
// It is deliberately small. Nothing pauses, nothing is obscured, the run costs
// nothing: the intent is the feeling of progress, not an event. If a player
// never notices the confetti, the line on its own has done the job.
//
// WHY IT LIVES IN THE ENGINE
// --------------------------
// Five games want exactly the same thing, and the part that can be wrong --
// firing the celebration at the right moment, exactly once, and never on a
// run with no best to beat -- is the part that should exist once. The part
// that differs, WHERE the line goes, stays with the game: only Updraft knows
// that a height is a screen-y, only Rift Runner that a metre is 30 pixels.
//
// So the split is:
//
//   the game     tells the marker the best at the start of a run, feeds it the
//                run's progress every tick, and draws the line where it maps
//                that best to -- through drawLine(), which handles the look.
//   the marker   detects the crossing, owns the confetti, and draws both the
//                line and the burst in the shell's palette, because a marker
//                that changed colour per game would stop being recognisable
//                as the same thing.
//
// The line is drawn in shell chrome (tokens.css via engine/ui.js), like the
// HUD it belongs with, and unlike the game's own artwork around it.

import { UI } from './ui.js';
import { ParticleSystem } from './util.js';

// The celebration, in seconds. Short on purpose: the run is still going.
const PULSE_SECONDS = 1.2;

// Confetti tuning. Enough pieces to read as a burst, few enough to be gone
// before the eye has to look past them.
const CONFETTI_COUNT = 42;
const CONFETTI_SPEED = [120, 320];
const CONFETTI_LIFE = [0.5, 0.9];
const CONFETTI_SIZE = [3, 6];
const CONFETTI_GRAVITY = 420;
const CONFETTI_DRAG = 0.6;

// Dash pattern of the line, in game units before scale.
const DASH = [10, 8];

export class BestMarker {
  #best = null;         // the figure to beat this run, or null when there is none
  #crossed = false;     // fired yet this run?
  #pulse = 0;           // seconds of label pulse remaining
  #particles = new ParticleSystem({ max: CONFETTI_COUNT });

  /**
   * Start of a run. `best` is the session best in the game's own progress
   * unit -- the same number the game will feed to update(). null, undefined
   * or a figure of zero means there is nothing to beat, and the marker stays
   * silent and invisible for the run.
   */
  reset(best) {
    this.#best = Number.isFinite(best) && best > 0 ? best : null;
    this.#crossed = false;
    this.#pulse = 0;
    this.#particles.clear();
  }

  /** The figure the line stands at, or null. */
  get best() {
    return this.#best;
  }

  /** True once this run has passed the line. */
  get crossed() {
    return this.#crossed;
  }

  /**
   * True while there is a line to draw. False on a run with no best, and
   * ALSO false once the line has been passed: the run is now the best, the
   * number in the HUD says so, and a line behind the player is clutter.
   */
  get visible() {
    return this.#best !== null && !this.#crossed;
  }

  /**
   * Every tick. `progress` is the run's current figure in the unit of `best`.
   * `burstX`/`burstY` are where the confetti should appear if this is the
   * tick the line is crossed -- in whatever coordinate space the game will
   * call drawBurst() in, normally screen space.
   *
   * Returns true on the one tick the crossing happens, so a game can add a
   * sound or a shake of its own.
   */
  update(progress, dt, { burstX = 0, burstY = 0 } = {}) {
    this.#particles.update(dt);
    if (this.#pulse > 0) this.#pulse = Math.max(0, this.#pulse - dt);

    if (this.#best === null || this.#crossed) return false;
    if (!(progress > this.#best)) return false;

    this.#crossed = true;
    this.#pulse = PULSE_SECONDS;
    const t = UI.tokens();
    this.#particles.emit(burstX, burstY, {
      count: CONFETTI_COUNT,
      colors: [t.accent, t.accent2, t.textPrimary],
      angle: -Math.PI / 2,
      spread: Math.PI * 1.4,
      speed: CONFETTI_SPEED,
      life: CONFETTI_LIFE,
      size: CONFETTI_SIZE,
      gravity: CONFETTI_GRAVITY,
      drag: CONFETTI_DRAG,
      shape: 'square',
      shrink: true,
    });
    return true;
  }

  /** How far through the celebration pulse we are, 1 at the crossing to 0. */
  get pulse() {
    return this.#pulse / PULSE_SECONDS;
  }

  /**
   * Draws the line. The game works out where; this handles how.
   *
   *   orientation  'horizontal' -- a line at y = `at` from x = `from` to `to`
   *                (Updraft, Sinkhole: progress is vertical)
   *                'vertical'   -- a line at x = `at` from y = `from` to `to`
   *                (Skyhook, Rift Runner, Ember: progress is horizontal)
   *   label        text beside it, normally the best with its unit
   *   scale        the canvas's uiScale, for TV mode
   *
   * Culls itself when `at` is outside [min, max] (pass the visible range) so
   * callers need not check. Does nothing when there is no line to draw.
   */
  drawLine(ctx, { orientation = 'horizontal', at, from, to, min = -Infinity, max = Infinity, label = '', scale = 1 } = {}) {
    if (!this.visible) return;
    if (!(at >= min && at <= max)) return;

    const t = UI.tokens();
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = t.accent;
    ctx.lineWidth = 2 * scale;
    ctx.setLineDash(DASH.map((d) => d * scale));
    ctx.beginPath();
    if (orientation === 'horizontal') {
      ctx.moveTo(from, at);
      ctx.lineTo(to, at);
    } else {
      ctx.moveTo(at, from);
      ctx.lineTo(at, to);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (label) {
      // Sits just past the line on the side the player approaches from, so it
      // is read before the line is reached rather than after.
      const pad = 6 * scale;
      if (orientation === 'horizontal') {
        UI.text(ctx, label, from + 12 * scale, at - pad, {
          size: 11, color: t.accent, font: 'mono', weight: '700', baseline: 'bottom', scale,
        });
      } else {
        UI.text(ctx, label, at + pad, from + 14 * scale, {
          size: 11, color: t.accent, font: 'mono', weight: '700', baseline: 'top', scale,
        });
      }
    }
    ctx.restore();
  }

  /**
   * Draws the confetti, in whatever space the burst position was given in.
   * Cheap when nothing is live, so games call it every frame.
   */
  drawBurst(ctx) {
    if (this.#particles.activeCount === 0) return;
    this.#particles.draw(ctx);
  }
}
