// games/beat-blocker/chart.js
//
// Beat Blocker's simulation: the chart, the judging, and the phrases that keep
// coming. No canvas, no input device, no audio.
//
// HOW A RHYTHM GAME WORKS WITHOUT ANY MUSIC TO PLAY
// -------------------------------------------------
// engine/audio.js synthesises tones. There are no samples, no tracks, and no
// backend to fetch one from — so there is nothing to follow, and the usual
// arrangement of a rhythm game (a recording, and a chart hand-authored against
// it) is not available.
//
// So it is inverted. THE CHART IS THE SOURCE OF TRUTH AND THE MUSIC IS ITS
// CONSEQUENCE. This file owns a tempo and a list of beat times as plain
// numbers; game.js schedules a tone at each of those numbers and judges a
// press against the same ones. The music cannot drift out of time with the
// gameplay because they are not two things being kept in step — they are one
// list read twice.
//
// That has a real benefit beyond convenience: the fairness of the timing is
// testable with no audio at all. Whether a window is hittable is a question
// about numbers, and tests/ can answer it without a speaker.
//
// It also has an honest cost, and it is worth stating plainly: a chart
// generated from a rule is a drum pattern, not a song. It can be made to
// swing, syncopate and build, and it does — but nobody will hum it.
//
// THE CLAIM
// ---------
//   THE WINDOW IS ONE A PERSON CAN HIT, AT EVERY TEMPO.
//
// Which is convention 11 applied to the one genre that is entirely made of
// timing windows. Two ways a rhythm game gets this wrong, and both are guarded
// here:
//
//   A window measured in BEATS shrinks as the tempo rises, so a chart that is
//   fair at 90bpm demands frame-perfect input at 180. The window here is in
//   MILLISECONDS and does not move. Fast is harder because more is coming, not
//   because you must be more precise.
//
//   A pattern can ask you to be in two places at once. Moving the shield takes
//   time; two attacks in different lanes 90ms apart is not difficulty, it is a
//   pattern that cannot be played. The generator enforces a floor and a test
//   walks every phrase it will ever deal looking for a breach.

// --- Tuning ---------------------------------------------------------------
//
// A plain exported object, so a test can clone it, change one figure and run
// both versions side by side. See tests/README.md, convention 3.
export const TUNING = {
  lanes: 3,

  // The tempo, and how it climbs. No ceiling — this is what makes it endless.
  bpmBase: 84,
  bpmPerPhrase: 4.5,
  bpmMax: 260,          // not a difficulty ceiling; see subdivisionFor()

  // Beats in a phrase. Four bars of four.
  beatsPerPhrase: 16,

  // JUDGING, IN MILLISECONDS AND DELIBERATELY NOT IN BEATS.
  //
  // A window in beats is the classic way to make a rhythm game unplayable at
  // speed without noticing: at 84bpm an eighth of a beat is 89ms and generous,
  // and at 240bpm the same eighth is 31ms and frame-perfect. These do not
  // move, so the tempo changes how much is coming rather than how precise you
  // have to be.
  perfectMs: 55,
  goodMs: 115,

  // HOW LONG IT TAKES TO GET THE SHIELD FROM ONE LANE TO THE NEXT.
  //
  // Not a display figure -- the shield genuinely travels, and a press only
  // counts against the lane the shield is actually covering when it lands.
  // Without that the shield is in every lane at once, the lane floor below
  // guards nothing, and the game is a one-button timing exercise with three
  // columns drawn behind it. It is also what makes moving EARLY a skill: you
  // commit to the next lane before the current attack has arrived.
  laneMoveMs: 150,
  // How near the shield has to be to a lane's centre to count as covering it.
  // Generous, because the alternative is arriving a hair late and having a
  // well-timed press ignored with nothing on screen explaining why.
  laneCoverage: 0.42,
  // Plus a little for the press itself. A pattern that is exactly playable by
  // a machine is not playable.
  laneMarginMs: 90,

  // The shortest gap between attacks in the SAME lane. Below this it stops
  // being a rhythm and becomes a drum roll.
  sameLaneFloorMs: 130,

  // THE RUN-UP BEFORE THE FIRST ATTACK. Four beats of music with nothing to
  // block, so the first thing a player does is hear the tempo rather than lose
  // a heart to it. A number chosen and pointed at, per CLAUDE.md, rather than
  // whatever the generator happened to leave.
  // Eight, not four, and the figure came from playing it cold. Four beats is
  // 2.9 seconds, after which attacks arrive every 1.4 -- so five seconds spent
  // looking at a game you have never seen before cost three of four hearts
  // before you had touched anything. Eight beats is two full bars of pulse with
  // nothing falling, which is long enough to hear the tempo, find the shield
  // and watch the first attack coming.
  leadInBeats: 8,

  // How far ahead an attack is visible. Constant in SECONDS, so the approach
  // looks the same at every tempo and reading it never gets harder.
  approachSeconds: 1.9,

  // Health, and what a miss costs.
  hearts: 4,
  // A HEART BACK FOR A CLEAN RUN OF BLOCKS.
  //
  // Four hearts and no way to get one back turned an endless game into a
  // pass/fail exam: over twelve phrases a player with 30ms of slop survived
  // 93% of runs and one with 50ms survived none, because a couple of hundred
  // attacks will find any miss rate above about two per cent. That is a cliff,
  // not a difficulty curve. Healing on a streak turns the same numbers into a
  // slope, and it makes recovering from a bad phrase a thing you can actually
  // do rather than a run you are already finished with.
  healStreak: 30,
  // A blocked attack on the beat is worth more than a scrambled one, which is
  // what makes precision worth having when survival alone would not.
  perfectScore: 3,
  goodScore: 1,

  // How busy a phrase is. Rises, then the tempo takes over — see
  // subdivisionFor().
  densityBase: 0.55,
  densityPerPhrase: 0.035,
  densityMax: 0.95,

  // HOW OFTEN THE NEXT ATTACK IS IN A DIFFERENT LANE, and how often that lane
  // is the far one rather than next door.
  //
  // This is the escalation that carries on after the others have run out. The
  // tempo stops at bpmMax and the subdivision stops at sixteenths, and the
  // reachability floors mean packing more notes in only gets them dropped
  // again -- so past about phrase sixty the note rate saturates and every
  // further phrase would have been the same phrase. Movement is the axis that
  // still has room: the same number of attacks, spread wider, is more running
  // about for the same music, and it stays honest because the floors still
  // decide what is reachable.
  crossBase: 0.45,
  crossPerPhrase: 0.006,
  crossMax: 0.92,
  farBase: 0.18,
  farPerPhrase: 0.006,
  farMax: 0.75,
};

export const END = { OVERWHELMED: 'Overwhelmed' };
export const JUDGE = { PERFECT: 'perfect', GOOD: 'good', MISS: 'miss' };

// --- The tempo ------------------------------------------------------------

export const bpmAt = (phrase, t = TUNING) =>
  Math.min(t.bpmMax, t.bpmBase + (phrase - 1) * t.bpmPerPhrase);

export const beatSeconds = (bpm) => 60 / bpm;

/**
 * How finely a phrase is subdivided, and why the tempo has a cap.
 *
 * A rhythm game that escalates only by tempo runs into a wall: past about
 * 260bpm the beat itself is faster than a person can tap, and everything after
 * that is the same unplayable pattern with a bigger number on it. So the tempo
 * climbs to a stop and then the SUBDIVISION takes over — eighths, then
 * sixteenths — which keeps the pulse readable while the notes keep coming
 * faster. There is no ceiling on that, which is what makes it endless.
 */
export function subdivisionFor(phrase, t = TUNING) {
  const bpm = bpmAt(phrase, t);
  if (bpm < t.bpmMax) return 1;
  const over = phrase - Math.ceil((t.bpmMax - t.bpmBase) / t.bpmPerPhrase + 1);
  return over < 8 ? 2 : 4;
}

export const densityFor = (phrase, t = TUNING) =>
  Math.min(t.densityMax, t.densityBase + (phrase - 1) * t.densityPerPhrase);

/**
 * WHERE THE CHART STOPS GETTING HARDER, and it is a real place.
 *
 * The tempo climbs to a cap, the subdivision goes to sixteenths and stops, and
 * the movement dials reach their limits -- and past that point the reachability
 * floors are the binding constraint, so packing in more only gets it spaced out
 * again. Every phrase after this one is the same phrase.
 *
 * That is the honest end of the escalation rather than a failure of nerve: a
 * chart faster than a hand is not a harder game, it is an unplayable one. But
 * an endless game that quietly stops escalating reads as one that ran out of
 * ideas, so the player is told. game.js draws it; this is the one place that
 * decides it.
 */
export function ceilingPhrase(t = TUNING) {
  const capped = (n) => bpmAt(n, t) >= t.bpmMax
    && subdivisionFor(n, t) >= 4
    && densityFor(n, t) >= t.densityMax
    && movementFor(n, t).cross >= t.crossMax
    && movementFor(n, t).far >= t.farMax;
  for (let n = 1; n <= 2000; n++) if (capped(n)) return n;
  return Infinity;
}

/** Has the chart reached the hardest it will ever be? */
export const atCeiling = (phrase, t = TUNING) => phrase >= ceilingPhrase(t);

const clamp = (value, max) => Math.min(max, value);

/** How much moving a phrase asks for: chance of a change, chance it is far. */
export const movementFor = (phrase, t = TUNING) => ({
  cross: clamp(t.crossBase + (phrase - 1) * t.crossPerPhrase, t.crossMax),
  far: clamp(t.farBase + (phrase - 1) * t.farPerPhrase, t.farMax),
});

/** A lane that is not `from`, preferring a distant one `far` of the time. */
function pickLane(from, far, t = TUNING) {
  const others = [];
  for (let i = 0; i < t.lanes; i++) if (i !== from) others.push(i);
  const distance = (l) => Math.abs(l - from);
  const furthest = Math.max(...others.map(distance));
  const pool = Math.random() < far
    ? others.filter((l) => distance(l) === furthest)
    : others.filter((l) => distance(l) === 1);
  const choose = pool.length ? pool : others;
  return choose[(Math.random() * choose.length) | 0];
}

// --- Building a phrase ----------------------------------------------------

/**
 * The attacks in phrase `n`, as { time, lane } in seconds from the phrase's
 * start.
 *
 * Generated, then FILTERED against the two floors — a pattern the generator
 * would like is not the same as a pattern that can be played, and the second
 * one is the only one worth dealing. Same discipline as the mini golf
 * generator proving its holes and the Colour Heist vault proving its route.
 */
/**
 * The time the shield needs between an attack in `from` and one in `to`.
 *
 * THE LANES ARE NOT ALL ADJACENT, and that was the first thing this got wrong.
 * A flat lane floor is right for lane 0 to lane 1 and a lie for lane 0 to lane
 * 2, which takes twice as long to cross; charts passed the floor, looked fine,
 * and cost a heart every few phrases to a bot with perfect timing and zero
 * jitter, because it was still in transit when the attack landed. The distance
 * has to be in the arithmetic.
 */
export function reachMs(from, to, t = TUNING) {
  if (from === to) return t.sameLaneFloorMs;
  return Math.abs(to - from) * t.laneMoveMs + t.laneMarginMs;
}

/**
 * Every pair in `events` the shield could not physically get between.
 *
 * The generator places notes so this is always empty; this is the independent
 * check on that, and the test walks hundreds of phrases through it. It reads
 * the same reachMs() the generator does, so the two cannot come to disagree
 * about what reachable means -- but it is a separate walk over the finished
 * chart, which is the part that makes it worth having.
 */
export function breaches(events, t = TUNING) {
  const out = [];
  for (let i = 1; i < events.length; i++) {
    const gap = (events[i].time - events[i - 1].time) * 1000;
    const need = reachMs(events[i - 1].lane, events[i].lane, t);
    if (gap < need - 1e-6) out.push({ index: i, gap, need, from: events[i - 1], to: events[i] });
  }
  return out;
}

export function buildPhrase(n, t = TUNING, anchor = null) {
  const beat = beatSeconds(bpmAt(n, t));
  const sub = subdivisionFor(n, t);
  const step = beat / sub;
  const slots = t.beatsPerPhrase * sub;
  const density = densityFor(n, t);
  const { cross, far } = movementFor(n, t);

  // THE CHART IS PLACED, NOT FILTERED, and that is the whole of this function.
  //
  // The first version generated a note in every slot the density allowed, gave
  // each a random lane, and then deleted whatever broke the reachability
  // floors. It read fine and it was wrong: at speed almost every crossing
  // breaks a floor and almost every same-lane note survives one, so the filter
  // quietly sorted the late game into a SINGLE COLUMN. Measured at phrase 90 it
  // was six notes a second and zero lane changes a second -- a three-lane game
  // that had stopped using two of them, with nothing failing anywhere.
  //
  // So the generator walks forward instead. It picks the lane first, asks how
  // long the shield needs to get there, and puts the note at the first slot
  // that far away. A chart cannot then be both maximally fast and maximally
  // wide, which is exactly the trade the escalation should be making.
  const events = [];
  let lane = anchor ? anchor.lane : Math.floor(t.lanes / 2);
  let at = anchor ? anchor.time : -step;

  for (let guard = 0; guard < slots * 2; guard++) {
    const nextLane = Math.random() < cross ? pickLane(lane, far, t) : lane;
    const earliest = at + reachMs(lane, nextLane, t) / 1000;
    // Snap to the grid, so everything lands on a subdivision of the beat and
    // the chart is still music rather than a scatter of taps.
    // Never behind the start of the phrase. The anchor sits at a negative
    // time -- it is the previous phrase's last attack -- and without this clamp
    // the first note or two of a phrase could be placed at a negative time as
    // well, which is to say already missed. It cost a bot with perfect timing
    // two hearts at the seam and looked exactly like a timing failure.
    let slot = Math.max(0, Math.ceil(earliest / step - 1e-9));
    // Rests. Density is how often a playable slot is actually used, which is
    // what stops a full chart being the only chart at a given tempo.
    while (Math.random() > density) slot += 1;
    const time = slot * step;
    if (time >= t.beatsPerPhrase * beat) break;
    events.push({ time, lane: nextLane, slot });
    lane = nextLane;
    at = time;
  }

  return events;
}

/** The gap the pattern demands between an attack and the one before it. */
export function tightestGaps(events, t = TUNING) {
  let sameLane = Infinity;
  let laneChange = Infinity;
  for (let i = 1; i < events.length; i++) {
    const gap = (events[i].time - events[i - 1].time) * 1000;
    if (events[i].lane === events[i - 1].lane) sameLane = Math.min(sameLane, gap);
    else laneChange = Math.min(laneChange, gap);
  }
  return { sameLane, laneChange };
}

// --- Judging --------------------------------------------------------------

/**
 * How good a press was, given how far it was from the attack in milliseconds.
 *
 * Absolute, so early and late are treated the same — a rhythm game that
 * forgives late presses more than early ones teaches the wrong thing.
 */
export function judge(deltaMs, t = TUNING) {
  const off = Math.abs(deltaMs);
  if (off <= t.perfectMs) return JUDGE.PERFECT;
  if (off <= t.goodMs) return JUDGE.GOOD;
  return null;
}

// --- The run --------------------------------------------------------------

/**
 * One session.
 *
 * `step(dt, input)` is the whole game; game.js only draws what this says is
 * true and plays a tone at each time this hands it. `input` is
 * { lane, block } — where the shield is and whether the button went down this
 * frame — so a stick, a keyboard and a thumb are all playing the same game.
 */
/**
 * How far ahead of itself the chart is dealt, beyond the approach time.
 *
 * A phrase is generated before any of its attacks could be on screen, which is
 * the whole of the fix described in Session below. The extra second is slack so
 * a slow frame can never eat into it.
 */
export const DEAL_AHEAD_MARGIN = 1.0;

export class Session {
  constructor(tuning = TUNING) {
    this.t = tuning;
    this.reset();
  }

  reset() {
    const t = this.t;
    this.score = 0;
    this.blocked = 0;
    this.perfects = 0;
    this.missed = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.hearts = t.hearts;
    this.lane = Math.floor(t.lanes / 2);
    // Where the shield actually IS, in lane units, as opposed to where it has
    // been told to go. Fractional while it is travelling.
    this.shield = this.lane;
    this.running = true;
    this.reason = null;
    this.lastJudge = null;

    // ONE CLOCK, RUNNING FROM THE START OF THE RUN, and every attack carries the
    // absolute time it lands at.
    //
    // The first version kept a clock per phrase and dealt each phrase's attacks
    // at the moment that phrase began. Every rule about the chart was fine --
    // the reachability floors held, the seam anchoring held -- and the game was
    // still unfair, because a rule about whether the SHIELD could get there is
    // not a rule about whether the PLAYER could see it coming. An attack in the
    // first 1.9 seconds of a phrase had never been on screen: measured over
    // eight phrases, 18 of 78 attacks appeared with less than their full
    // approach and the opening attack of most phrases appeared AT the strike
    // line, warning -0.001s. Unblockable, and every test passed.
    //
    // That is convention 10 exactly: a check can be right about what it
    // measures and blind to everything else. The floors measured travel time.
    // Nothing measured visibility.
    //
    // So phrases are now dealt a full approach-and-a-bit before their first
    // attack could be drawn, into one list on one timeline. There is no seam to
    // fall through because there is no seam.
    this.now = -t.leadInBeats * beatSeconds(bpmAt(1, t));
    this.phrases = [];
    this.events = [];
    this.dealtTo = 0;
    this.#dealAhead();
  }

  // --- Dealing ------------------------------------------------------------

  #dealAhead() {
    const horizon = this.now + this.t.approachSeconds + DEAL_AHEAD_MARGIN;
    // At least one, always: during the run-up the clock is still negative and
    // the horizon has not reached zero, so a plain while() would leave the
    // session with no phrase at all.
    while (this.phrases.length === 0 || this.dealtTo <= horizon) this.#dealPhrase();
  }

  #dealPhrase() {
    const t = this.t;
    const n = this.phrases.length + 1;
    const bpm = bpmAt(n, t);
    const beat = beatSeconds(bpm);
    const length = t.beatsPerPhrase * beat;
    const start = this.dealtTo;

    // The last attack already dealt, expressed in this phrase's own clock, so
    // the reachability floors apply across the join as well as inside it.
    const previous = this.events[this.events.length - 1];
    const anchor = previous
      ? { time: previous.time - start, lane: previous.lane }
      : { time: -t.leadInBeats * beat, lane: Math.floor(t.lanes / 2) };

    for (const [i, event] of buildPhrase(n, t, anchor).entries()) {
      this.events.push({
        ...event, time: start + event.time, id: `${n}:${i}`, phrase: n, done: false,
      });
    }

    this.phrases.push({ n, start, end: start + length, bpm, beat, length });
    this.dealtTo = start + length;
  }

  /** The phrase the clock is in right now. Before the run-up ends, the first. */
  get current() {
    for (let i = this.phrases.length - 1; i >= 0; i--) {
      if (this.now >= this.phrases[i].start) return this.phrases[i];
    }
    return this.phrases[0];
  }

  get phrase() { return this.current.n; }

  get bpm() { return this.current.bpm; }

  get beat() { return this.current.beat; }

  get length() { return this.current.length; }

  get phraseStart() { return this.current.start; }

  /** The clock, which every attack's time is measured against. */
  get time() { return this.now; }

  set time(value) { this.now = value; }

  /** Beat times of the current phrase, absolute. The music is built from these. */
  get beatTimes() {
    const { start, beat } = this.current;
    const out = [];
    for (let i = 0; i < this.t.beatsPerPhrase; i++) out.push(start + i * beat);
    return out;
  }

  /**
   * Attacks close enough to be on screen.
   *
   * Every one of these entered at the spawn line and travelled, because the
   * chart is dealt further ahead than this window is wide.
   */
  get incoming() {
    return this.events.filter(
      (e) => !e.done && e.time > this.now - 0.3 && e.time < this.now + this.t.approachSeconds,
    );
  }

  // --- Judging ------------------------------------------------------------

  /** The attack a press would be judged against: nearest unjudged, in lane. */
  targetIn(lane) {
    let best = null;
    for (const event of this.events) {
      if (event.done || event.lane !== lane) continue;
      const delta = Math.abs(event.time - this.now) * 1000;
      if (delta > this.t.goodMs) continue;
      if (!best || delta < best.delta) best = { event, delta };
    }
    return best;
  }

  /** The lane the shield is covering right now, or null if it is between two. */
  coveredLane() {
    const nearest = Math.round(this.shield);
    return Math.abs(this.shield - nearest) <= this.t.laneCoverage ? nearest : null;
  }

  /** Press the block button. Returns the verdict, or null if nothing was near. */
  block() {
    if (!this.running) return null;
    const lane = this.coveredLane();
    if (lane === null) return null;
    const target = this.targetIn(lane);
    if (!target) return null;
    const verdict = judge((target.event.time - this.now) * 1000, this.t);
    if (!verdict) return null;

    target.event.done = true;
    target.event.verdict = verdict;
    this.blocked++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    if (this.streak % this.t.healStreak === 0 && this.hearts < this.t.hearts) {
      this.hearts++;
      this.healed = this.now;
    }
    if (verdict === JUDGE.PERFECT) {
      this.perfects++;
      this.score += this.t.perfectScore;
    } else {
      this.score += this.t.goodScore;
    }
    this.lastJudge = { verdict, at: this.now, lane };
    return verdict;
  }

  #miss(event) {
    event.done = true;
    event.verdict = JUDGE.MISS;
    this.missed++;
    this.streak = 0;
    this.hearts--;
    this.lastJudge = { verdict: JUDGE.MISS, at: this.now, lane: event.lane };
    if (this.hearts <= 0) {
      this.hearts = 0;
      this.running = false;
      this.reason = END.OVERWHELMED;
    }
  }

  /** One frame. */
  step(dt, input = {}) {
    if (!this.running) return;
    if (typeof input.lane === 'number') {
      this.lane = Math.max(0, Math.min(this.t.lanes - 1, Math.round(input.lane)));
    }
    this.now += dt;

    // The shield travels. It does not arrive because you asked it to.
    const travel = dt / (this.t.laneMoveMs / 1000);
    if (this.shield < this.lane) this.shield = Math.min(this.lane, this.shield + travel);
    else if (this.shield > this.lane) this.shield = Math.max(this.lane, this.shield - travel);

    if (input.block) this.block();

    // Anything now past the late edge of its window is a miss.
    const late = this.t.goodMs / 1000;
    for (const event of this.events) {
      if (event.done || this.now - event.time <= late) continue;
      this.#miss(event);
      if (!this.running) return;
    }

    this.#dealAhead();
    this.#forget();
  }

  /** Drop attacks that are finished and off the back of the screen. */
  #forget() {
    if (this.events.length < 256) return;
    this.events = this.events.filter((e) => !e.done || e.time > this.now - 2);
  }
}
