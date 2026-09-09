// engine/shell.js
//
// The standard wrapper every Studio 22 game runs inside: pause menu, game
// over screen, how-to-play overlay, HUD helpers, and a loading state.
//
// The point is that a game never builds any of this. It hands the shell a
// canvas, a loop, and a description of its controls, and gets identical
// chrome to every other game in the suite -- which matters more than it
// sounds, because a player who learns that Start pauses and B backs out in
// one game has learned it for all of them.
//
// EVERYTHING IS DRAWN INTO THE CANVAS, not into DOM overlays. That is a
// deliberate constraint: the canvas is already letterboxed and DPI-scaled by
// GameCanvas, so menus inherit that for free and TV mode scales the pause
// menu by exactly the same factor it scales the game. A DOM overlay would
// need its own parallel scaling story and would drift out of alignment with
// the letterbox the moment the window changed shape.
//
// HOW A GAME WIRES IT UP
// ----------------------
// The shell needs two calls from inside the game's own loop callbacks:
//
//   update(dt) { if (!shell.update(dt)) return;  ...game logic... }
//   render(a)  { ...draw game...; shell.drawHud({ score }); shell.render(); }
//
// shell.update() returns false when an overlay owns the frame, which is the
// game's cue to skip its simulation. See the usage example at the bottom.
//
// WHY THE SHELL RUNS ITS OWN ANIMATION FRAME
// ------------------------------------------
// GameLoop.pause() cancels its requestAnimationFrame outright, which is
// correct -- there is no reason to burn a phone's battery simulating a world
// nobody is looking at. But a pause menu still has to redraw: the selection
// highlight moves as the player navigates it. So when an overlay opens, the
// shell suspends the game loop and starts a small loop of its own that polls
// input and redraws the menu, then hands control back on close. The frozen
// game behind the menu is a snapshot of the last rendered frame rather than
// a live one, for the same battery reason.

import { Input, JOYSTICK_MAX_RADIUS_PX } from './input.js';
import { Session } from './session.js';
import { UI } from './ui.js';

// --- Tunables -----------------------------------------------------------

const ARCADE_URL = '/arcade.html';
const PARTY_URL = '/party.html';

// Which screen owns the display. `null` means the game does.
const SCREEN = {
  TITLE: 'title',
  LOADING: 'loading',
  PAUSE: 'pause',
  GAMEOVER: 'gameover',
  HOWTO: 'howto',
};

// Five steps, drawn as blocks. A number would be more precise and less
// readable from ten feet away, which is the distance this menu is designed for.
const VOLUME_STEPS = 5;

function volumeBar(value) {
  const filled = Math.round(value * VOLUME_STEPS);
  if (filled === 0) return 'Off';
  return '\u25A0'.repeat(filled) + '\u25A1'.repeat(VOLUME_STEPS - filled);
}

// How far a stick has to push before it counts as a menu move. Well above
// input.js's 0.15 deadzone: a menu should need a deliberate flick, not a
// lean, or the selection skids past the item the player wanted.
const NAV_THRESHOLD = 0.5;

// Menu geometry, in game units.
const ITEM_HEIGHT = 52;
const ITEM_GAP = 10;
const PANEL_PAD = 28;
const PANEL_MAX_WIDTH = 560;

// Touch-only pause button, top-right corner. These are MINIMUMS in game
// units; the real size is worked out per frame -- see #minTouchUnits.
const TOUCH_PAUSE_SIZE = 44;
const TOUCH_PAUSE_MARGIN = 16;

// The smallest a touch target may be ON SCREEN, in CSS pixels, which is the
// number both Apple and Android publish as the reliable minimum.
//
// This exists because game units are not screen pixels. A 44-unit button in a
// 960x540 game is 44 CSS pixels only when the canvas happens to render 1:1.
// On a phone the canvas scales down to about 0.4, so that same button lands
// at roughly 18 physical pixels -- far too small to hit, which reads to the
// player as a button that simply ignores them. Anything a finger has to find
// must therefore be sized in screen pixels and converted back into game
// units, never fixed in game units.
const MIN_TOUCH_PX = 44;


// Run stats are a debug-ish courtesy, not a scoreboard -- cap them so a game
// that reports twenty fields can't overflow the panel.
const MAX_STAT_LINES = 6;

// --- Small formatting helpers -------------------------------------------

// 'timeSurvived' -> 'Time survived'. Games pick their own stat keys, and
// without this every game over screen would show raw camelCase.
function humanizeKey(key) {
  const spaced = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function formatStatValue(value) {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

// Seconds -> M:SS, for the HUD timer.
function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function pointInRect(px, py, rect) {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

export class GameShell {
  // --- Internal state -----------------------------------------------------

  #gameId;
  #title;
  #controls;
  #canvas;
  #loop;
  #audio;
  #onRestart;
  #onPassToNextPlayer;

  #screen = null;
  #selected = 0;
  #navLatch = 0; // last frame's nav direction, for edge-triggered movement

  // Seeded from the visit's preference rather than hardcoded on, so a player
  // who muted the site on the landing page gets a muted game. The pause menu
  // still flips it per game, and that writes back through setSound().
  #soundOn = Session.isSoundOn();
  // Set by a game declaring music: true. Governs whether the pause menu offers
  // a music row at all, and whether engine/music.js is ever asked to start.
  #hasMusic = false;
  #music = null;
  // Separate from #navLatch: up/down and left/right have to be able to repeat
  // independently, or nudging a volume would block moving off the row.
  #sideLatch = 0;
  #musicLoading = false;
  #tournamentMode = false;
  #touchCapable = false;

  // Which screen HOWTO returns to when backed out of. null means nothing was
  // behind it and closing begins play.
  #howToReturn = null;

  // The last loop frame this shell drew its overlay on, so the game's own
  // call and the loop's automatic one cannot both land in the same frame.
  #renderedFrame = -1;

  // Extra title-screen rows a game asked for. See showTitle().
  #titleItems = [];

  // Title screen copy, set by showTitle().
  #titleName = '';
  #titleTagline = '';

  // Game over payload.
  #finalScore = 0;
  #isBest = false;
  #sessionBest = null;
  #runStats = null;

  // Resolves to the Tournament module, or null when it could not be loaded.
  // Never set at all outside tournament mode -- see #loadTournament().
  #tournamentPromise = null;

  #overlayRafId = 0;
  #snapshot = null;
  #hasSnapshot = false;

  /**
   * @param {object} options
   * @param {string} options.gameId    Session key for scores. Matches games.json.
   * @param {string} options.title     Shown on the pause and game over screens.
   * @param {Array}  [options.controls] Rows for the how-to-play overlay:
   *        [{ action: 'Move', gamepad: 'Left stick', keyboard: 'WASD', touch: 'Drag left' }]
   *        A row with no entry for the active device is skipped, on the
   *        grounds that an action you can't perform on this device has no
   *        business being listed on it.
   * @param {GameCanvas} options.canvas
   * @param {GameLoop}   options.loop
   * @param {() => void} [options.onRestart]  Reset the game. Defaults to a
   *        page reload, which always works but is slower than a real reset.
   * @param {'dark'|'light'} [options.shellTheme] Which palette the shell's own
   *        chrome draws in. Defaults to 'dark', which matches the site.
   *
   *        Set it to 'light' for a game with a BRIGHT background. The shell
   *        draws its HUD straight over the game with no scrim behind it, so
   *        near-white HUD text on a daylight sky is unreadable — and the fix
   *        is not for the game to go dark. Number Crunch was pulled back from
   *        a pale sky for exactly this reason before the option existed.
   *
   *        This also sets the default palette for engine/ui.js, so a game
   *        drawing its own screens with those primitives matches without
   *        passing anything: light chrome over a light game and dark chrome
   *        on its own setup screen would read as two different games.
   * @param {() => void} [options.onPassToNextPlayer] Tournament handoff (Phase 7).
   * @param {boolean} [options.music=false]  Play background music from
   *                                  engine/music.js. Opt-in per game: a game
   *                                  where a sound TELLS the player something
   *                                  (Beat Blocker, anything rhythmic) must
   *                                  leave this off. Nothing is downloaded
   *                                  unless this is true AND sound is on.
   * @param {object} [options.audio]  Anything with setMuted(bool). Optional
   *        until engine/audio.js exists.
   *
   * There is no "show how to play on start" option. A game that wants a
   * front door calls showTitle() — the how-to-play screen was never a title
   * screen, and using it as one gave the player a panel headed "How to Play"
   * with a button marked "Back" instead of the game's name and a Start.
   */
  constructor(options) {
    this.#gameId = options.gameId;
    this.#title = options.title ?? '';
    this.#controls = options.controls ?? [];
    this.#canvas = options.canvas;
    this.#loop = options.loop ?? null;
    this.#audio = options.audio ?? null;
    this.#hasMusic = Boolean(options.music) && Boolean(this.#audio);

    // The stored levels, applied before a single sound plays. Doing this at
    // construction rather than on the first note is what makes "muted means
    // silent from the first frame" true.
    this.#audio?.setMusicVolume?.(Session.getMusicVolume());
    this.#audio?.setSfxVolume?.(Session.getSfxVolume());
    this.#onRestart = options.onRestart ?? (() => window.location.reload());
    this.#onPassToNextPlayer = options.onPassToNextPlayer ?? null;

    // Applied before anything draws, and applied even for the default so a
    // second shell on the same page (there is never one, but still) cannot
    // inherit a theme it did not ask for.
    const theme = options.shellTheme ?? 'dark';
    UI.setTheme(theme);

    // The letterbox bars are part of the chrome too. A light game framed in
    // the site's near-black looks broken rather than framed, and the game
    // should not have to know that the bars exist to fix it.
    this.#canvas.setLetterboxColor(
      theme === 'light' ? 'var(--color-shell-light-bg-0)' : 'var(--color-bg-0)',
    );

    // Tournament mode is a URL param for now; Phase 7 decides whether that
    // stays. Any value except an explicit off counts as on, so both
    // ?tournament and ?tournament=1 work.
    const param = new URLSearchParams(window.location.search).get('tournament');
    this.#tournamentMode = param !== null && param !== '0' && param !== 'false';

    // Tournament support is a DYNAMIC import, started here and only when this
    // is actually a tournament turn.
    //
    // Statically importing it pulled the tournament and manifest modules into
    // every game page -- about 5 KB gzipped that the overwhelming majority of
    // runs never touch, since most people play a game on its own. Kicking the
    // fetch off in the constructor rather than at the moment it is needed
    // means it has the whole run to arrive, so the handoff is not waiting on
    // a network request at the exact moment the player finishes.
    if (this.#tournamentMode) this.#loadTournament();

    // Capability, not current device: the pause button has to be on screen
    // before the player has touched anything, so getActiveDevice() (which
    // reports the most recent input) is the wrong question here.
    this.#touchCapable = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

    this.#canvas.canvas.addEventListener('pointerdown', this.#onPointerDown);

    // DRAW THE OVERLAY WHETHER OR NOT THE GAME ASKS.
    //
    // render() is still public and eleven games still call it; this makes the
    // other twelve work too. Drawing twice in one frame is prevented below
    // rather than by asking anybody to remove their call.
    this.#loop?.onAfterRender?.(() => this.render());
  }

  #loadTournament() {
    this.#tournamentPromise ??= import('./tournament.js')
      .then((module) => module.Tournament)
      .catch((error) => {
        // Offline, or the chunk failed to fetch. The game itself is already
        // running and playable; only the handoff is lost, and the call sites
        // below fall back to behaving like a normal single-player run.
        console.warn('[shell] Tournament module failed to load: ' + error.message);
        return null;
      });
    return this.#tournamentPromise;
  }

  // --- Public surface -----------------------------------------------------

  get isOverlayOpen() {
    return this.#screen !== null;
  }

  get isPaused() {
    return this.#screen === SCREEN.PAUSE;
  }

  get isSoundOn() {
    return this.#soundOn;
  }

  get isTournamentMode() {
    return this.#tournamentMode;
  }

  /**
   * Call first thing in the game's update(). Returns false when an overlay
   * owns this frame, which means the game should skip its simulation.
   */
  update() {
    if (this.#screen !== null) {
      // An overlay is up but the game loop is still running -- happens when
      // the shell opened a screen before the game called loop.start().
      // Suspend it so the two don't both draw.
      this.#suspendLoop();
      return false;
    }

    // Start and Escape both open the pause menu. (Escape arrives as `back`,
    // per the default keyboard layout in input.js.)
    if (Input.pressed('start') || Input.pressed('back')) {
      this.pause();
      return false;
    }

    return true;
  }

  /**
   * Call at the end of the game's render(). Draws in-game chrome only --
   * overlays draw from the shell's own loop, because the game loop isn't
   * running while one is open.
   */
  render() {
    // Once per frame, however many callers there are. A game that calls this
    // itself gets its own call; the loop's automatic one then does nothing.
    const frame = this.#loop?.frameCount ?? -1;
    if (frame >= 0 && frame === this.#renderedFrame) return;
    this.#renderedFrame = frame;

    if (this.#screen !== null) return;
    if (this.#touchCapable) {
      this.#drawTouchControls();
      this.#drawTouchPauseButton();
    }
  }

  /**
   * HOW MUCH ROOM THE TOP-RIGHT CORNER OWES THE SHELL, in game units.
   *
   * Zero on a desktop, where there is no pause button drawn on the canvas --
   * Escape is the pause button. On a touch screen the shell puts one in the
   * top-right corner, and a game that right-aligns anything up there is drawing
   * underneath it: measured on a phone, six games had a readout half-covered
   * by it (Mini Golf's stroke bank, Gravity Well's fuel gauge, Tank Tactics'
   * alert line, Winter's wolf count, Ballast's next piece, Hangman's round
   * panel).
   *
   * It reads as a per-game bug and it is one fact about the shell, so the shell
   * publishes the number and a game right-aligns against
   * `screen.right - shell.rightInset()` instead of `W`. The alternative --
   * moving the button -- only relocates the collision, because every corner
   * belongs to somebody.
   *
   * Measured back from screen.right rather than from the game's own width,
   * because that is where the button is. On a screen no wider than the game
   * those are the same number.
   */
  rightInset() {
    if (!this.#touchCapable) return 0;
    const rect = this.#touchPauseRect();
    return this.#canvas.right - rect.x + TOUCH_PAUSE_MARGIN;
  }

  /**
   * Consistent HUD rendering. Games pass only the fields they have; anything
   * omitted simply isn't drawn, so no game is forced into a shape that
   * doesn't fit it.
   *
   * @param {object} hud { score, best, lives, timer, level } -- all optional.
   */
  drawHud(hud = {}) {
    const ctx = this.#canvas.ctx;
    // ANCHORED TO THE STAGE, not to the game's own width.
    //
    // On a screen wider than the game the canvas extends past both edges (see
    // engine/canvas.js), so a score drawn at x=20 is twenty units in from a
    // line that is no longer the edge of anything -- on an iPhone in landscape
    // it floated about 150 real pixels inside the screen, which reads as a
    // mistake rather than as a margin. `left` and `right` are the real edges
    // and collapse to 0 and width on every screen that is not wider.
    const left = this.#canvas.left;
    const w = this.#canvas.right;
    const scale = this.#canvas.uiScale;
    const t = UI.tokens();
    const top = 14;

    if (hud.score !== undefined) {
      UI.text(ctx, 'SCORE', left + 20, top + 4, {
        size: 11, color: t.textSecondary, font: 'display', align: 'left', baseline: 'top', scale,
      });
      UI.text(ctx, hud.score, left + 20, top + 20, {
        size: 26, color: t.textPrimary, font: 'mono', weight: '700', align: 'left', baseline: 'top', scale,
      });
    }

    // Score and best stack under one another, because a high-score game
    // almost always wants both and every one of them was otherwise going to
    // hand-draw this line. `best` is skipped when null, which is what
    // Session.getBest() returns for a game not yet played this visit — so a
    // game can pass it straight through without a guard.
    let stackY = top + 20 + 30 * scale;

    if (hud.best !== undefined && hud.best !== null) {
      UI.text(ctx, `BEST ${hud.best}`, 20, stackY, {
        size: 13, color: t.textDisabled, font: 'display', align: 'left', baseline: 'top', scale,
      });
      stackY += 20 * scale;
    }

    if (hud.level !== undefined) {
      UI.text(ctx, `LEVEL ${hud.level}`, 20, stackY, {
        size: 13, color: t.textSecondary, font: 'display', align: 'left', baseline: 'top', scale,
      });
    }

    if (hud.timer !== undefined) {
      UI.text(ctx, formatClock(hud.timer), w / 2, top + 8, {
        size: 26, color: t.textPrimary, font: 'mono', weight: '700', align: 'center', baseline: 'top', scale,
      });
    }

    if (hud.lives !== undefined) {
      this.#drawLives(hud.lives, w - 20, top + 10, scale);
    }
  }

  // Opens the pause menu.
  //
  // Only the playing state can be interrupted. Guarding on "an overlay is
  // already open" rather than "the pause menu is already open" matters more
  // than it looks: showGameOver() suspends the game loop, which fires
  // GameLoop's onPause, which games are told to wire straight back to this
  // method -- so a narrower guard would let the pause menu overwrite the
  // game over screen a frame after it opened, and the player would never
  // see the score they just earned. This also makes the method idempotent,
  // so that onPause round trip terminates.
  pause() {
    if (this.#screen !== null) return;
    this.#openScreen(SCREEN.PAUSE);
  }

  // Closes whatever overlay is open and hands the frame back to the game.
  resume() {
    if (this.#screen === null) return;
    this.#closeScreen();
  }

  /**
   * Ends the run: records the score, records any stats, and shows the game
   * over screen with a celebration if the score is a new session best.
   */
  /**
   * Ends the run: submits the score and shows the results panel.
   *
   * `variant` is for a game that keeps several separate records -- Circuit
   * Racer has one per circuit. Pass it and the panel shows the record for
   * the thing that was just played, rather than a number set somewhere the
   * player has not been. The game-level best is still kept for the arcade
   * card; see Session.submitScore.
   *
   * @param {number} score
   * @param {object|null} [stats]   Extra lines for the panel.
   * @param {object} [options]
   * @param {string|null} [options.variant]
   */
  showGameOver(score, stats = null, { variant = null } = {}) {
    this.#finalScore = score;

    const result = Session.submitScore(this.#gameId, score, { variant });
    this.#isBest = result.isBest;

    if (stats) Session.setRunStats(this.#gameId, stats);
    this.#runStats = stats;

    // Read back rather than reusing the submitted score: on a run that
    // didn't beat the best, the best is the older, better number.
    this.#sessionBest = Session.getBest(this.#gameId, { variant });

    this.#openScreen(SCREEN.GAMEOVER);
  }

  // Shows or hides the loading screen.
  setLoading(isLoading) {
    if (isLoading) {
      this.#openScreen(SCREEN.LOADING);
    } else if (this.#screen === SCREEN.LOADING) {
      this.#closeScreen();
    }
  }

  /**
   * Shows the game's own title screen: its name, a line beneath it, and a
   * Start button. Call it at boot, before or after loop.start().
   *
   * This is the front door of a game and it belongs to the game, not to the
   * suite — which is why the name and tagline are passed in rather than
   * reused from the arcade manifest. Nothing starts until Start is pressed.
   *
   * @param {object} options
   * @param {string} options.name     The game's title, shown large.
   * @param {string} [options.tagline] One line under it.
   */
  /**
   * @param {object}   [options]
   * @param {string}   [options.name]     Big line on the title screen.
   * @param {string}   [options.tagline]  Small line under it.
   * @param {Array}    [options.items]    Extra menu rows, between Start and
   *                                      How to Play. Each is
   *                                      { label, run }, where label may be a
   *                                      function so it can show current state,
   *                                      and run() leaves the screen up unless
   *                                      it says otherwise.
   *
   * The items exist because a game with a SETTING had nowhere to put it.
   * Bigger Fish needed to ask how good the other fish should be, so it drew its
   * own screen and read the stick and a face button directly -- which on a
   * phone was a screen saying "SPLIT BUTTON TO DIVE IN" with no button on it
   * and nothing tappable anywhere. Every hand-rolled menu is a menu that has to
   * reimplement touch, gamepad and keyboard, and that one reimplemented none of
   * them. A row here is tappable, navigable and readable because the shell's
   * menu already is.
   */
  showTitle({ name, tagline = '', items = [] } = {}) {
    this.#titleItems = items;
    this.#titleName = name ?? this.#title;
    this.#titleTagline = tagline;
    this.#openScreen(SCREEN.TITLE);
  }

  // Opens the how-to-play overlay. Backing out returns to whichever screen
  // it was opened from -- the title screen or the pause menu -- rather than
  // dropping the player into a game they have not started.
  showHowToPlay() {
    this.#howToReturn = (this.#screen === SCREEN.PAUSE || this.#screen === SCREEN.TITLE)
      ? this.#screen
      : null;
    this.#openScreen(SCREEN.HOWTO);
  }

  /**
   * Steps one of the two volumes, wrapping at the ends.
   *
   * Wraps rather than clamping so a single button can drive it: pressing
   * "Music" over and over walks 0, 20, 40 ... 100, 0, which is the whole
   * control on a device with no left and right. Left/right still nudge without
   * wrapping, which is what somebody with a stick expects.
   */
  #nudgeVolume(which, direction) {
    const step = 0.2;
    const current = which === 'music' ? Session.getMusicVolume() : Session.getSfxVolume();
    let next = Math.round((current + step * direction) * 100) / 100;
    if (next > 1.0001) next = 0;
    if (next < -0.0001) next = 1;
    next = Math.min(1, Math.max(0, next));
    if (which === 'music') {
      Session.setMusicVolume(next);
      this.#audio?.setMusicVolume?.(next);
    } else {
      Session.setSfxVolume(next);
      this.#audio?.setSfxVolume?.(next);
      // Play something, so the number means something. Without this the player
      // is adjusting a level they cannot hear until they close the menu.
      this.#audio?.play?.('move');
    }
  }

  setSound(on) {
    this.#soundOn = Boolean(on);
    Session.setSoundOn(this.#soundOn);
    // Sound off means the music stops AND stops downloading. Back on starts it
    // again, which is the first moment a file is fetched for a player who
    // opened the site muted.
    if (this.#hasMusic) {
      if (this.#soundOn) this.#music?.start();
      else this.#music?.stop({ fadeOut: 0.3 });
    }
    this.#applyAudio();
    this.#applyMusic();
  }

  // --- Screen transitions -------------------------------------------------

  #openScreen(screen) {
    // Set the screen BEFORE touching the loop: loop.pause() may fire an
    // onPause callback that calls back into shell.pause(), and the guard
    // there reads this field.
    const wasPlaying = this.#screen === null;
    this.#screen = screen;
    this.#selected = 0;
    this.#navLatch = 0;

    if (wasPlaying) this.#suspendLoop();
    // Hand the touchscreen back to the menu. Left running, the virtual stick
    // would scroll the selection whenever a thumb rested on the left half,
    // and the A pad -- which sits at a fixed screen position that can land on
    // top of a menu row -- would confirm whatever was highlighted the instant
    // it was tapped.
    Input.setTouchControlsEnabled(false);
    this.#applyAudio();
    this.#applyMusic();
    this.#startOverlayLoop();
  }

  #closeScreen() {
    this.#screen = null;
    this.#stopOverlayLoop();
    Input.setTouchControlsEnabled(true);
    this.#applyAudio();
    this.#applyMusic();
    // No-op if the game never started its loop (a how-to shown before play).
    this.#loop?.resume();
  }

  // Freezes the game loop and grabs the last frame to sit behind the menu.
  #suspendLoop() {
    if (!this.#loop || !this.#loop.isRunning || this.#loop.isPaused) return;
    this.#captureSnapshot();
    this.#loop.pause();
  }

  // Copies the live canvas into an offscreen buffer. Stored at backing-store
  // resolution and drawn back in game coordinates, so it stays correct even
  // if the window is resized while the menu is open.
  #captureSnapshot() {
    const source = this.#canvas.canvas;
    if (!source.width || !source.height) return;

    if (!this.#snapshot) this.#snapshot = document.createElement('canvas');
    this.#snapshot.width = source.width;
    this.#snapshot.height = source.height;
    this.#snapshot.getContext('2d').drawImage(source, 0, 0);
    this.#hasSnapshot = true;
  }

  #applyAudio() {
    // Muted while the game is suspended behind a menu. Game over and loading
    // deliberately keep playing -- a game over sting is part of the moment.
    const suspended = this.#screen === SCREEN.PAUSE || this.#screen === SCREEN.HOWTO;
    this.#audio?.setMuted?.(!this.#soundOn || suspended);
  }

  /**
   * Starts or stops the music to match what is on screen.
   *
   * Music plays while the game is being PLAYED. It fades out on the pause menu
   * and on game over -- the first because a paused game is a conversation
   * happening in the room, the second because a score screen wants the sting
   * and then quiet. It does not play under the title, because nobody has
   * chosen to play anything yet.
   *
   * The module is imported lazily, so a game without music never downloads the
   * code either, and a game with music does not fetch a note until the first
   * run begins.
   */
  #applyMusic() {
    if (!this.#hasMusic) return;
    const playing = this.#screen === null && this.#soundOn;
    if (playing) {
      if (this.#music) { this.#music.start(); this.#music.resume(); return; }
      if (this.#musicLoading) return;
      this.#musicLoading = true;
      import('./music.js')
        .then(({ Music }) => {
          this.#music = new Music(this.#audio);
          // Re-checked rather than assumed: the player may have paused, muted
          // or left the game while this module was in flight.
          if (this.#screen === null && this.#soundOn) this.#music.start();
        })
        .catch((error) => {
          // A chunk that would not load is a reason for silence, not for a
          // broken game.
          console.warn('[shell] Music module failed to load: ' + error.message);
        })
        .finally(() => { this.#musicLoading = false; });
      return;
    }
    // SUSPEND rather than stop. A pause menu holds the game still, and it
    // should hold the music still with it -- stopping threw away both the track
    // and the position, so every pause changed the song.
    //
    // Leaving the game entirely (sound switched off, or a game over that is not
    // coming back) still stops; that path is setSound() and the game's own
    // teardown, not this one.
    this.#music?.suspend();
  }

  // --- The overlay's own animation frame ----------------------------------

  #startOverlayLoop() {
    if (this.#overlayRafId) return;
    this.#overlayRafId = requestAnimationFrame(this.#overlayFrame);
  }

  #stopOverlayLoop() {
    cancelAnimationFrame(this.#overlayRafId);
    this.#overlayRafId = 0;
  }

  #overlayFrame = () => {
    if (this.#screen === null) {
      this.#overlayRafId = 0;
      return;
    }
    this.#overlayRafId = requestAnimationFrame(this.#overlayFrame);

    // The game loop is suspended, so nothing else is polling input.
    Input.update();
    this.#handleMenuInput();

    // handleMenuInput may have closed the overlay; don't draw a menu that
    // no longer exists over the frame the game is about to resume drawing.
    if (this.#screen !== null) this.#drawOverlay();
  };

  // --- Menu navigation ----------------------------------------------------

  #handleMenuInput() {
    if (this.#screen === SCREEN.LOADING) return; // not interactive

    const items = this.#currentItems();
    const state = Input.get(0);

    // Edge-triggered: the stick has to return past the threshold before it
    // moves the selection again. Holding a direction parks on one item
    // rather than scrolling the menu at 60 items a second, and the same code
    // serves d-pad, stick, and arrow keys because input.js merges all three
    // into x/y.
    const direction = Math.abs(state.y) > NAV_THRESHOLD ? Math.sign(state.y) : 0;
    if (direction !== 0 && this.#navLatch === 0 && items.length > 0) {
      this.#selected = (this.#selected + direction + items.length) % items.length;
    }
    this.#navLatch = direction;

    // SIDEWAYS ADJUSTS A ROW THAT CAN BE ADJUSTED. A volume is a quantity, and
    // the gesture for a quantity is left and right -- pressing A five times to
    // wrap back round to quiet is what you do when there is no other way, not
    // what anybody reaches for. Edge-triggered on its own latch so holding
    // right does not empty the slider in a frame.
    const sideways = Math.abs(state.x) > NAV_THRESHOLD ? Math.sign(state.x) : 0;
    if (sideways !== 0 && this.#sideLatch === 0) {
      items[this.#selected]?.nudge?.(sideways);
    }
    this.#sideLatch = sideways;

    if (Input.pressed('a')) {
      items[this.#selected]?.run();
      return;
    }

    // B and Escape back out. Start also closes the pause menu, matching the
    // button that opened it.
    const backPressed = Input.pressed('b') || Input.pressed('back');
    const startPressed = Input.pressed('start');

    if (this.#screen === SCREEN.PAUSE && (backPressed || startPressed)) {
      this.resume();
    } else if (this.#screen === SCREEN.HOWTO && backPressed) {
      this.#leaveHowTo();
    }
    // Game over deliberately ignores B: backing out of it by accident would
    // skip past the score the player just earned.
  }

  #leaveHowTo() {
    if (this.#howToReturn) {
      this.#openScreenFromOverlay(this.#howToReturn);
    } else {
      this.#closeScreen();
    }
  }

  // Switches screens while an overlay is already up: no snapshot, no loop
  // change, just a different set of items.
  #openScreenFromOverlay(screen) {
    this.#screen = screen;
    this.#selected = 0;
    this.#navLatch = 0;
    this.#applyAudio();
    this.#applyMusic();
  }

  // Item lists are rebuilt per frame rather than stored, so labels that
  // depend on state (the sound toggle) can never go stale.
  #currentItems() {
    if (this.#screen === SCREEN.TITLE) {
      // Game-supplied rows sit between Start and How to Play: after the thing
      // most players want, before the things most players do not.
      const extra = this.#titleItems.map((item) => ({
        label: typeof item.label === 'function' ? item.label() : item.label,
        run: item.run,
      }));
      return [
        { label: 'Start', run: () => this.#closeScreen() },
        ...extra,
        { label: 'How to Play', run: () => this.showHowToPlay() },
        { label: 'Back to Arcade', run: () => this.#backToArcade() },
      ];
    }

    if (this.#screen === SCREEN.PAUSE) {
      return [
        { label: 'Resume', run: () => this.resume() },
        { label: 'Restart', run: () => this.#restart() },
        { label: `Sound: ${this.#soundOn ? 'On' : 'Off'}`, run: () => this.setSound(!this.#soundOn) },
        // Two rows rather than one, because they are two decisions: turn the
        // song down and still hear a split land, or mute the blips and keep
        // the song. Left/right nudges by a step; the button cycles, so this
        // works on a gamepad, a keyboard and a thumb without three code paths.
        //
        // Only shown when the game HAS music -- a volume slider for a track
        // that does not exist is a control that does nothing, and a menu full
        // of those teaches players not to read the menu.
        ...(this.#hasMusic ? [{
          label: () => `Music: ${volumeBar(Session.getMusicVolume())}`,
          run: () => this.#nudgeVolume('music', 1),
          nudge: (direction) => this.#nudgeVolume('music', direction),
        }] : []),
        {
          label: () => `Effects: ${volumeBar(Session.getSfxVolume())}`,
          run: () => this.#nudgeVolume('sfx', 1),
          nudge: (direction) => this.#nudgeVolume('sfx', direction),
        },
        { label: 'How to Play', run: () => this.showHowToPlay() },
        {
          label: this.#tournamentMode ? 'Back to Tournament' : 'Back to Arcade',
          run: () => this.#leaveGame(),
        },
      ];
    }

    if (this.#screen === SCREEN.GAMEOVER) {
      return [
        this.#tournamentMode
          ? { label: 'Pass to next player', run: () => this.#passToNextPlayer() }
          : { label: 'Play Again', run: () => this.#restart() },
        {
          label: this.#tournamentMode ? 'Back to Tournament' : 'Back to Arcade',
          run: () => this.#leaveGame(),
        },
      ];
    }

    if (this.#screen === SCREEN.HOWTO) {
      return [{ label: 'Back', run: () => this.#leaveHowTo() }];
    }

    return [];
  }

  #restart() {
    this.#closeScreen();
    this.#onRestart();
  }

  #backToArcade() {
    window.location.href = ARCADE_URL;
  }

  /**
   * Hands the turn back to the tournament.
   *
   * A game needs to do nothing at all to be tournament-ready. The score is
   * already here, so the shell records it against the current turn and
   * returns to party.html itself, which is why Updraft and Comet work in a
   * tournament without a line of their own. A game CAN still pass
   * onPassToNextPlayer and take the handoff over, but none has to.
   *
   * With no tournament to hand back to -- someone typed ?tournament=1 by
   * hand, or it was cleared in another tab -- this restarts rather than
   * leaving the player on a button that does nothing.
   */
  async #passToNextPlayer() {
    if (this.#onPassToNextPlayer) {
      this.#closeScreen();
      this.#onPassToNextPlayer();
      return;
    }

    // Captured before awaiting: the score is what it was when the button was
    // pressed, and nothing should be able to change it while the module
    // resolves.
    const score = this.#finalScore;
    const Tournament = await this.#loadTournament();

    if (Tournament?.isActive()) {
      Tournament.recordTurn(this.#gameId, score);
      window.location.href = PARTY_URL;
      return;
    }

    console.warn('[shell] ?tournament is set but no tournament is running; restarting instead.');
    this.#restart();
  }

  // Leaving a game mid-tournament goes back to the TOURNAMENT, not out to
  // the arcade. The player still has a turn open, and the standings screen
  // is where they can skip it or drop out properly; sending them to the
  // arcade instead looks like the tournament has been thrown away, and
  // leaves it sitting in storage with nothing pointing at it.
  async #leaveGame() {
    if (this.#tournamentMode) {
      const Tournament = await this.#loadTournament();
      if (Tournament?.isActive()) {
        window.location.href = PARTY_URL;
        return;
      }
    }
    this.#backToArcade();
  }

  // --- Pointer input ------------------------------------------------------

  #onPointerDown = (event) => {
    const point = this.#canvas.screenToGame(event.clientX, event.clientY);

    if (this.#screen === null) {
      if (this.#touchCapable && pointInRect(point.x, point.y, this.#touchPauseRect())) {
        this.pause();
      }
      return;
    }

    if (this.#screen === SCREEN.LOADING) return;

    const items = this.#currentItems();
    const rects = this.#layout(items.length).itemRects;
    for (let i = 0; i < items.length; i++) {
      if (pointInRect(point.x, point.y, rects[i])) {
        // Move the highlight to what was tapped before running it, so a
        // player switching from touch to pad mid-menu picks up where their
        // finger left off rather than back at the top.
        this.#selected = i;
        items[i].run();
        return;
      }
    }
  };

  // How many game units currently make up MIN_TOUCH_PX on screen. Grows as
  // the canvas shrinks, which is exactly the point.
  #minTouchUnits() {
    const scale = this.#canvas.scale;
    if (!scale || scale <= 0) return MIN_TOUCH_PX; // pre-layout; harmless
    return MIN_TOUCH_PX / scale;
  }

  #touchPauseRect() {
    // Whichever is bigger: the designed size, or enough game units to make a
    // finger-sized target on this particular screen. Capped at an eighth of
    // the play area so a very small canvas can't produce a button that eats
    // the corner of the game.
    const size = Math.min(
      Math.max(TOUCH_PAUSE_SIZE, this.#minTouchUnits()),
      this.#canvas.stageWidth / 8,
    );
    const margin = Math.max(TOUCH_PAUSE_MARGIN, this.#minTouchUnits() * 0.25);
    return {
      x: this.#canvas.right - margin - size,
      y: margin,
      w: size,
      h: size,
    };
  }

  // --- Layout -------------------------------------------------------------

  // Shared by drawing and hit-testing, so a tap can never land somewhere the
  // button isn't. Pure function of canvas size, item count, and screen.
  #layout(itemCount) {
    const w = this.#canvas.width;
    const h = this.#canvas.height;
    const headerHeight = this.#headerHeight();

    const panelW = Math.min(PANEL_MAX_WIDTH, w * 0.62);
    const itemHeight = this.#itemHeight(itemCount, headerHeight);
    const itemsHeight = itemCount > 0
      ? itemCount * itemHeight + (itemCount - 1) * ITEM_GAP
      : 0;
    const panelH = headerHeight + itemsHeight + PANEL_PAD;
    const panelX = (w - panelW) / 2;
    const panelY = Math.max(16, (h - panelH) / 2);

    const itemRects = [];
    for (let i = 0; i < itemCount; i++) {
      itemRects.push({
        x: panelX + PANEL_PAD,
        y: panelY + headerHeight + i * (itemHeight + ITEM_GAP),
        w: panelW - PANEL_PAD * 2,
        h: itemHeight,
      });
    }

    return { panelX, panelY, panelW, panelH, headerHeight, itemRects };
  }

  // Menu rows grow on small screens for the same reason the pause button
  // does, but with a ceiling: a row tall enough to push the last button off
  // the bottom of the play area is worse than a slightly tight one, since
  // "Back to Arcade" being unreachable would strand the player in the game.
  #itemHeight(itemCount, headerHeight) {
    if (itemCount <= 0) return ITEM_HEIGHT;
    const wanted = Math.max(ITEM_HEIGHT, this.#minTouchUnits());
    const available = this.#canvas.height - headerHeight - PANEL_PAD - 32;
    const fits = (available - (itemCount - 1) * ITEM_GAP) / itemCount;
    return Math.max(ITEM_HEIGHT, Math.min(wanted, fits));
  }

  // Space above the buttons, which varies with what each screen has to say.
  #headerHeight() {
    if (this.#screen === SCREEN.GAMEOVER) {
      const statLines = Math.min(this.#statEntries().length, MAX_STAT_LINES);
      return 168 + (this.#isBest ? 32 : 0) + statLines * 24;
    }
    if (this.#screen === SCREEN.HOWTO) {
      return 96 + this.#visibleControlRows().length * 32;
    }
    if (this.#screen === SCREEN.TITLE) {
      return this.#titleTagline ? 150 : 118;
    }
    if (this.#screen === SCREEN.LOADING) return 108;
    return 100; // pause
  }

  #statEntries() {
    if (!this.#runStats) return [];
    return Object.entries(this.#runStats).slice(0, MAX_STAT_LINES);
  }

  // Rows that have something to say for whichever device is in the player's
  // hands right now.
  #visibleControlRows() {
    const device = Input.getActiveDevice();
    return this.#controls.filter((row) => Boolean(row[device]));
  }

  // --- Drawing ------------------------------------------------------------

  #drawOverlay() {
    const ctx = this.#canvas.ctx;
    // The dim and the backdrop cover the STAGE; the panel is centred on the
    // game, which is the same place because the margin is symmetric.
    const w = this.#canvas.width;
    const stageLeft = this.#canvas.left;
    const stageWidth = this.#canvas.stageWidth;
    const h = this.#canvas.height;
    const t = UI.tokens();

    // The frozen game, or a flat background when there was never a frame to
    // freeze (a loading screen shown before the first render).
    if (this.#hasSnapshot) {
      // The snapshot is the whole BACKING STORE, which spans the stage. Drawn
      // back into 0..width it would squeeze the frozen game into the middle of
      // itself, which looked like the pause menu had zoomed the game out.
      ctx.drawImage(
        this.#snapshot, 0, 0, this.#snapshot.width, this.#snapshot.height,
        stageLeft, 0, stageWidth, h,
      );
    } else {
      ctx.fillStyle = t.bg0;
      ctx.fillRect(stageLeft, 0, stageWidth, h);
    }
    UI.scrim(ctx, stageWidth, h, 0.72, stageLeft, 0);

    switch (this.#screen) {
      case SCREEN.TITLE: this.#drawTitle(); break;
      case SCREEN.PAUSE: this.#drawPause(); break;
      case SCREEN.GAMEOVER: this.#drawGameOver(); break;
      case SCREEN.HOWTO: this.#drawHowTo(); break;
      case SCREEN.LOADING: this.#drawLoading(); break;
    }
  }

  #drawPanelAndItems(items) {
    const ctx = this.#canvas.ctx;
    const scale = this.#canvas.uiScale;
    const layout = this.#layout(items.length);

    UI.panel(ctx, layout.panelX, layout.panelY, layout.panelW, layout.panelH, { scale });

    items.forEach((item, i) => {
      // A label may be a function, so a row that shows a live value -- a volume
      // -- redraws itself as the value changes rather than needing the whole menu
      // rebuilt around it.
      const label = typeof item.label === 'function' ? item.label() : item.label;
      UI.button(ctx, layout.itemRects[i], label, { selected: i === this.#selected, scale });
    });

    return layout;
  }

  #drawTitle() {
    const ctx = this.#canvas.ctx;
    const scale = this.#canvas.uiScale;
    const t = UI.tokens();
    const items = this.#currentItems();
    const layout = this.#drawPanelAndItems(items);
    const centerX = layout.panelX + layout.panelW / 2;

    // The game's name, sized to the panel rather than to a fixed number, so
    // a long title on a narrow portrait canvas still fits on one line.
    const available = layout.panelW - PANEL_PAD * 2;
    let nameSize = 46;
    const measured = UI.measure(ctx, this.#titleName, {
      size: nameSize, font: 'display', weight: '700', scale,
    });
    if (measured > available) nameSize *= available / measured;

    UI.text(ctx, this.#titleName, centerX, layout.panelY + 56, {
      size: nameSize, color: t.textPrimary, font: 'display', weight: '700',
      align: 'center', baseline: 'middle', scale,
    });

    if (this.#titleTagline) {
      UI.text(ctx, this.#titleTagline, centerX, layout.panelY + 100, {
        size: 15, color: t.accent, align: 'center', baseline: 'middle', scale,
      });
    }
  }

  #drawPause() {
    const ctx = this.#canvas.ctx;
    const scale = this.#canvas.uiScale;
    const t = UI.tokens();
    const items = this.#currentItems();
    const layout = this.#drawPanelAndItems(items);
    const centerX = layout.panelX + layout.panelW / 2;

    UI.text(ctx, 'PAUSED', centerX, layout.panelY + 34, {
      size: 30, color: t.accent, font: 'display', weight: '700', align: 'center', baseline: 'middle', scale,
    });
    if (this.#title) {
      UI.text(ctx, this.#title, centerX, layout.panelY + 64, {
        size: 14, color: t.textSecondary, align: 'center', baseline: 'middle', scale,
      });
    }
  }

  #drawGameOver() {
    const ctx = this.#canvas.ctx;
    const scale = this.#canvas.uiScale;
    const t = UI.tokens();
    const items = this.#currentItems();
    const layout = this.#drawPanelAndItems(items);
    const centerX = layout.panelX + layout.panelW / 2;
    let y = layout.panelY + 34;

    UI.text(ctx, 'GAME OVER', centerX, y, {
      size: 28, color: t.textPrimary, font: 'display', weight: '700', align: 'center', baseline: 'middle', scale,
    });
    y += 46;

    UI.text(ctx, this.#finalScore, centerX, y, {
      size: 46, color: t.accent, font: 'mono', weight: '700', align: 'center', baseline: 'middle', scale,
    });
    y += 40;

    if (this.#isBest) {
      // Gentle pulse so the celebration reads as celebratory rather than as
      // just another label. Driven off the clock, not a frame counter, so it
      // runs at the same speed on every refresh rate.
      const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 220);
      ctx.save();
      ctx.globalAlpha = pulse;
      UI.text(ctx, 'NEW BEST!', centerX, y, {
        size: 24, color: t.accent2, font: 'display', weight: '700', align: 'center', baseline: 'middle', scale,
      });
      ctx.restore();
      y += 32;
    }

    UI.text(ctx, `Session best: ${this.#sessionBest ?? '--'}`, centerX, y, {
      size: 15, color: t.textSecondary, align: 'center', baseline: 'middle', scale,
    });
    y += 28;

    for (const [key, value] of this.#statEntries()) {
      UI.text(ctx, `${humanizeKey(key)}: ${formatStatValue(value)}`, centerX, y, {
        size: 13, color: t.textDisabled, align: 'center', baseline: 'middle', scale,
      });
      y += 24;
    }
  }

  #drawHowTo() {
    const ctx = this.#canvas.ctx;
    const scale = this.#canvas.uiScale;
    const t = UI.tokens();
    const device = Input.getActiveDevice();
    const rows = this.#visibleControlRows();
    const items = this.#currentItems();
    const layout = this.#drawPanelAndItems(items);
    const centerX = layout.panelX + layout.panelW / 2;

    UI.text(ctx, 'HOW TO PLAY', centerX, layout.panelY + 32, {
      size: 26, color: t.accent, font: 'display', weight: '700', align: 'center', baseline: 'middle', scale,
    });
    UI.text(ctx, device, centerX, layout.panelY + 58, {
      size: 13, color: t.textSecondary, font: 'display', align: 'center', baseline: 'middle', scale,
    });

    // Two columns: what to press on the left, what it does on the right.
    const leftX = layout.panelX + PANEL_PAD;
    const rightX = layout.panelX + layout.panelW - PANEL_PAD;
    let y = layout.panelY + 92;

    if (rows.length === 0) {
      UI.text(ctx, 'No controls listed for this device.', centerX, y, {
        size: 14, color: t.textDisabled, align: 'center', baseline: 'middle', scale,
      });
      return;
    }

    // Two columns on one line only fit if they actually fit. On a narrow
    // canvas -- a portrait game is barely 420 units wide -- a long binding on
    // the left and a long action on the right will run straight through each
    // other, because canvas text neither wraps nor pushes anything aside.
    //
    // So measure the worst row first and shrink the type until the widest
    // pair clears, applying that one size to every row so the block stays
    // even. There is a floor: past it the columns stack instead, which is
    // taller but always legible.
    const available = layout.panelW - PANEL_PAD * 2;
    const GAP = 12;
    let size = 15;
    let widest = 0;

    for (const row of rows) {
      const pair = UI.measure(ctx, row[device], { size, font: 'mono', scale })
        + UI.measure(ctx, row.action, { size, scale });
      if (pair > widest) widest = pair;
    }

    if (widest + GAP > available) {
      size = Math.max(9, size * ((available - GAP) / widest));
    }
    const stacked = size <= 9.5 && widest + GAP > available;

    for (const row of rows) {
      UI.text(ctx, row[device], leftX, y, {
        size, color: t.accent, font: 'mono', align: 'left', baseline: 'middle', scale,
      });
      UI.text(ctx, row.action, stacked ? leftX : rightX, stacked ? y + 15 * scale : y, {
        size, color: t.textPrimary, align: stacked ? 'left' : 'right', baseline: 'middle', scale,
      });
      y += stacked ? 34 : 32;
    }
  }

  #drawLoading() {
    const ctx = this.#canvas.ctx;
    const scale = this.#canvas.uiScale;
    const t = UI.tokens();
    const layout = this.#layout(0);
    const centerX = layout.panelX + layout.panelW / 2;

    UI.panel(ctx, layout.panelX, layout.panelY, layout.panelW, layout.panelH, { scale });

    // Clock-driven so the animation speed doesn't depend on refresh rate.
    const dots = '.'.repeat(1 + (Math.floor(performance.now() / 400) % 3));
    UI.text(ctx, `LOADING${dots}`, centerX, layout.panelY + layout.panelH / 2, {
      size: 24, color: t.accent, font: 'display', weight: '700', align: 'center', baseline: 'middle', scale,
    });
  }

  /**
   * Draws the virtual sticks and action pads that engine/input.js is
   * listening for.
   *
   * Input owns where those regions ARE; this only renders them. Without it
   * they are invisible: the pads work perfectly and no player ever finds
   * them, which on a phone is indistinguishable from a broken game. Drawn
   * here rather than in each game so all twelve look and behave the same.
   */
  #drawTouchControls() {
    if (!Input.touchControlsEnabled) return;

    const ctx = this.#canvas.ctx;
    const t = UI.tokens();
    const toGame = (cx, cy) => this.#canvas.screenToGame(cx, cy);
    // One CSS pixel in game units -- radii arrive from Input in CSS pixels
    // because that is the only unit a thumb is actually measured in.
    const scale = this.#canvas.scale;
    const unitsPerPx = !scale || scale <= 0 ? 1 : 1 / scale;

    ctx.save();

    // Action pads. Faint until pressed: they have to be findable without
    // becoming the most prominent thing on top of the game.
    for (const button of Input.getTouchLayout()) {
      // Input owns where a pad is; this only renders it. Asking rather than
      // recomputing is what stops the drawn pad and the tappable pad drifting
      // apart, which is exactly what happened when both did their own
      // arithmetic against window.innerHeight.
      const at = Input.touchButtonCenter(button);
      const center = toGame(at.x, at.y);
      const radius = button.radius * unitsPerPx;
      const held = Input.get()[button.name];

      ctx.globalAlpha = held ? 0.55 : 0.22;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = held ? t.accent : t.bg1;
      ctx.fill();
      ctx.lineWidth = 2 * unitsPerPx;
      ctx.strokeStyle = held ? t.accent : t.textSecondary;
      ctx.stroke();

      ctx.globalAlpha = held ? 1 : 0.7;
      UI.text(ctx, (button.label ?? button.name).toUpperCase(), center.x, center.y, {
        size: 14,
        color: held ? t.bg0 : t.textPrimary,
        font: 'display',
        weight: '700',
        align: 'center',
        baseline: 'middle',
        scale: this.#canvas.uiScale,
      });
    }

    // A RESTING STICK, so the player can see there is one.
    //
    // The stick appears wherever a thumb lands, which is the right behaviour
    // and a terrible advertisement: until this was added the control was drawn
    // ONLY while it was already being used, so a player who did not happen to
    // try dragging the left side of the screen never found out the game had a
    // joystick at all. On a phone that is indistinguishable from a game with no
    // controls.
    //
    // Drawn faintly, in the bottom-left of the SAFE box, only for games that
    // asked for directional input, and only while nothing is being dragged --
    // the moment a thumb goes down the live stick below takes over from it.
    const sticks = Input.getTouchSticks();
    if (Input.usesDirectionalTouch && !sticks.move.active) {
      const home = Input.stickHome();
      const base = toGame(home.x, home.y);
      const baseRadius = JOYSTICK_MAX_RADIUS_PX * unitsPerPx;

      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      ctx.arc(base.x, base.y, baseRadius, 0, Math.PI * 2);
      ctx.fillStyle = t.bg1;
      ctx.fill();
      ctx.lineWidth = 2 * unitsPerPx;
      ctx.strokeStyle = t.textSecondary;
      ctx.stroke();

      // The knob, centred: a ring on its own reads as a target rather than a
      // stick, and a player has to know it is a thing you push.
      ctx.globalAlpha = 0.24;
      ctx.beginPath();
      ctx.arc(base.x, base.y, baseRadius * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = t.textSecondary;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Sticks, drawn wherever the thumb actually is once one is down.
    for (const stick of [sticks.move, sticks.aim]) {
      if (!stick.active) continue;

      const base = toGame(stick.originX, stick.originY);
      const knob = toGame(
        stick.originX + stick.x * JOYSTICK_MAX_RADIUS_PX,
        stick.originY + stick.y * JOYSTICK_MAX_RADIUS_PX,
      );
      const baseRadius = JOYSTICK_MAX_RADIUS_PX * unitsPerPx;

      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.arc(base.x, base.y, baseRadius, 0, Math.PI * 2);
      ctx.fillStyle = t.bg1;
      ctx.fill();
      ctx.lineWidth = 2 * unitsPerPx;
      ctx.strokeStyle = t.textSecondary;
      ctx.stroke();

      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(knob.x, knob.y, baseRadius * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = t.accent;
      ctx.fill();
    }

    ctx.restore();
  }

  #drawTouchPauseButton() {
    const ctx = this.#canvas.ctx;
    const scale = this.#canvas.uiScale;
    const t = UI.tokens();
    const rect = this.#touchPauseRect();

    ctx.save();
    ctx.globalAlpha = 0.65;
    UI.roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 8);
    ctx.fillStyle = t.bg1;
    ctx.fill();
    ctx.strokeStyle = t.bg3;
    ctx.lineWidth = 2 * scale;
    ctx.stroke();

    // Two bars: the universal pause glyph, cheaper and sharper than text.
    ctx.fillStyle = t.textPrimary;
    const barW = 5;
    const barH = rect.h * 0.42;
    const barY = rect.y + (rect.h - barH) / 2;
    ctx.fillRect(rect.x + rect.w / 2 - barW - 3, barY, barW, barH);
    ctx.fillRect(rect.x + rect.w / 2 + 3, barY, barW, barH);
    ctx.restore();
  }

  #drawLives(lives, rightX, y, scale) {
    const ctx = this.#canvas.ctx;
    const t = UI.tokens();
    const count = Math.max(0, Math.floor(lives));
    const MAX_PIPS = 5;

    // Past a handful, pips stop being countable at a glance and a number is
    // clearer -- and cheaper than drawing thirty circles every frame.
    if (count > MAX_PIPS) {
      UI.text(ctx, `LIVES x${count}`, rightX, y, {
        size: 16, color: t.accent2, font: 'mono', weight: '700', align: 'right', baseline: 'top', scale,
      });
      return;
    }

    const radius = 7 * scale;
    const gap = 8 * scale;
    for (let i = 0; i < count; i++) {
      const cx = rightX - radius - i * (radius * 2 + gap);
      ctx.beginPath();
      ctx.arc(cx, y + radius, radius, 0, Math.PI * 2);
      ctx.fillStyle = t.accent2;
      ctx.fill();
    }
  }
}

// -------------------------------------------------------------------
// Usage example (not executed -- for games importing this module)
// -------------------------------------------------------------------
//
// import { GameCanvas } from '../../engine/canvas.js';
// import { GameLoop } from '../../engine/loop.js';
// import { GameShell } from '../../engine/shell.js';
//
// const screen = new GameCanvas();
// let shell;
//
// const loop = new GameLoop({
//   update(dt) {
//     if (!shell.update(dt)) return;   // a menu owns this frame
//     world.step(dt);
//     if (world.playerDied) shell.showGameOver(world.score, { accuracy: 0.82 });
//   },
//   render(alpha) {
//     world.draw(screen.ctx, alpha);
//     shell.drawHud({ score: world.score, lives: world.lives });
//     shell.render();                  // touch pause button
//   },
//   // Auto-pause (tab hidden, window blurred) should raise the menu too.
//   onPause: () => shell.pause(),
// });
//
// shell = new GameShell({
//   gameId: 'updraft',
//   title: 'Updraft',
//   canvas: screen,
//   loop,
//   onRestart: () => world.reset(),
//   controls: [
//     { action: 'Move',  gamepad: 'Left stick', keyboard: 'WASD / Arrows', touch: 'Drag left side' },
//     { action: 'Jump',  gamepad: 'A',          keyboard: 'Space',         touch: 'A button' },
//     { action: 'Pause', gamepad: 'Start',      keyboard: 'Escape',        touch: 'Top-right button' },
//   ],
// });
//
// loop.start();
