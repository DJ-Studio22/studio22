// games/circuit-racer/tracks.js
//
// The circuits, and the geometry that reads them.
//
// Tracks are DATA. Adding one means appending an entry to TRACKS below and
// nothing else — no new code, no new draw call, no case statement. The setup
// screen, the minimap, lap counting, the off-track test and the AI's racing
// line all derive from the same centre line.
//
// Free of the DOM on purpose, like words.js and problems.js in the other
// games: a circuit with a start line on a corner, or two straights close
// enough that a car's nearest-point lookup snaps to the wrong one, is a bug
// you cannot see in a screenshot until it ruins a race. The checks that
// enforce those rules run against this file directly.

// --- The rules a circuit has to satisfy ---------------------------------
//
// These are not style preferences. Each one is a bug that has already
// happened or would happen.

// s = 0 is the start/finish line AND where a lap ticks over. It must sit on
// a straight: the road is stroked with round joins, so at a corner the
// tarmac has no clean perpendicular cross-section and a chequered band one
// road-width wide cannot span it.
const START_STRAIGHT_TOLERANCE = 0.02;   // radians of bend allowed at s = 0

// Two parts of the circuit that pass closer than this would overlap on
// screen, and — worse — a car on one could be nearest to the other, which
// is how a lap gets miscounted. Expressed as a multiple of the road width.
const MIN_SEPARATION_FACTOR = 2.3;

// Keep the whole circuit, kerbs included, inside the canvas.
const CANVAS = { w: 960, h: 600 };
const EDGE_MARGIN = 14;

export const TRACKS = [
  {
    id: 'sunset',
    name: 'Sunset Loop',
    blurb: 'Wide and flowing. Good for a first race.',
    roadHalf: 52,
    // s = 0 at [430,104], collinear with its neighbours either side.
    center: [
      [430, 104],
      [520, 100], [680, 130], [800, 210], [852, 320], [820, 430],
      [700, 494], [540, 512], [400, 496], [290, 430], [240, 340],
      [230, 240], [280, 160], [340, 108],
    ],
  },
  {
    id: 'hairpins',
    name: 'The Pin Works',
    blurb: 'Tight and technical. Brake early, get the exit right.',
    // Narrower road, which is what lets the corners actually be tight
    // without the two sides of a hairpin touching.
    roadHalf: 38,
    center: [
      [500, 120],
      [660, 120], [780, 150], [850, 240], [820, 340], [700, 390],
      [520, 400], [380, 430], [300, 500], [200, 500], [130, 420],
      [150, 300], [230, 215], [330, 185], [400, 120],
    ],
  },
  {
    id: 'longway',
    name: 'The Long Way',
    blurb: 'Twice around the houses. Settle in.',
    roadHalf: 48,
    center: [
      [420, 80],
      [620, 80], [760, 100], [870, 180], [890, 300], [840, 390],
      [740, 430], [660, 500], [520, 530], [380, 510], [280, 480],
      [170, 478], [90, 390], [80, 270], [130, 170], [230, 110],
      [320, 80],
    ],
  },
  {
    id: 'triangle',
    name: 'Three Sides',
    blurb: 'Three long straights, three places to get it wrong.',
    roadHalf: 50,
    center: [
      [400, 515],
      [700, 515], [790, 508], [860, 450], [845, 400], [600, 160],
      [540, 110], [468, 104], [405, 150], [150, 412], [118, 458],
      [145, 500], [220, 515], [300, 515],
    ],
  },
];

export const DEFAULT_TRACK = TRACKS[0].id;

// --- Geometry ------------------------------------------------------------

/**
 * Turns a track's point list into something the game can ask questions of.
 *
 * Everything downstream — where the road is, how far round the lap a car is,
 * whether it is on the tarmac, which way the finish line faces — comes from
 * here, so there is one description of the circuit rather than several that
 * could disagree.
 */
export function buildTrack(data) {
  const center = data.center;
  const segments = [];
  let length = 0;

  for (let i = 0; i < center.length; i++) {
    const a = center[i];
    const b = center[(i + 1) % center.length];
    const segLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segments.push({ a, b, length: segLength, start: length });
    length += segLength;
  }

  const wrap = (s) => ((s % length) + length) % length;

  const pointAt = (s) => {
    let d = wrap(s);
    for (const seg of segments) {
      if (d <= seg.length) {
        const t = seg.length > 0 ? d / seg.length : 0;
        return [seg.a[0] + (seg.b[0] - seg.a[0]) * t, seg.a[1] + (seg.b[1] - seg.a[1]) * t];
      }
      d -= seg.length;
    }
    return center[0];
  };

  // A CENTRAL difference. A forward one reports the direction of the segment
  // ahead rather than the direction at the point, which is wrong wherever
  // the sample straddles a corner.
  const tangentAt = (s) => {
    const [ax, ay] = pointAt(s - 8);
    const [bx, by] = pointAt(s + 8);
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    return [dx / len, dy / len];
  };

  const normalAt = (s) => {
    const [tx, ty] = tangentAt(s);
    return [-ty, tx];
  };

  /**
   * Nearest point on the centre line, as a distance around the lap plus how
   * far off the line it is — which is all the off-track test needs.
   */
  const project = (x, y) => {
    let best = { s: 0, dist: Infinity };
    for (const seg of segments) {
      const dx = seg.b[0] - seg.a[0];
      const dy = seg.b[1] - seg.a[1];
      const lenSq = dx * dx + dy * dy || 1;
      let t = ((x - seg.a[0]) * dx + (y - seg.a[1]) * dy) / lenSq;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = seg.a[0] + dx * t;
      const py = seg.a[1] + dy * t;
      const dist = Math.hypot(x - px, y - py);
      if (dist < best.dist) best = { s: seg.start + seg.length * t, dist };
    }
    return best;
  };

  /**
   * How sharply the track bends at s, in radians per unit travelled.
   *
   * The AI reads this to decide how much to slow for what is coming, which
   * is what stops it arriving at a hairpin flat out and understeering into
   * the scenery.
   */
  const curvatureAt = (s) => {
    const [ax, ay] = tangentAt(s - 22);
    const [bx, by] = tangentAt(s + 22);
    let turn = Math.atan2(by, bx) - Math.atan2(ay, ax);
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    return Math.abs(turn) / 44;
  };

  return {
    ...data, segments, length,
    pointAt, tangentAt, normalAt, project, curvatureAt,
  };
}

// --- Validation ----------------------------------------------------------

// Shortest distance between two line segments, used to prove no two parts of
// a circuit pass close enough to overlap or confuse the nearest-point lookup.
function segmentDistance(p1, p2, p3, p4) {
  const pointToSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  };
  return Math.min(
    pointToSeg(p1[0], p1[1], p3[0], p3[1], p4[0], p4[1]),
    pointToSeg(p2[0], p2[1], p3[0], p3[1], p4[0], p4[1]),
    pointToSeg(p3[0], p3[1], p1[0], p1[1], p2[0], p2[1]),
    pointToSeg(p4[0], p4[1], p1[0], p1[1], p2[0], p2[1]),
  );
}

/**
 * Shortest distance ALONG THE LAP between two segments, treating each as the
 * stretch of track it occupies rather than as a point.
 *
 * Adjacent segments touch, so this is 0 for them, which is what lets the
 * separation check skip corners without a special case for them.
 */
function arcGap(segA, segB, length) {
  const aStart = segA.start;
  const aEnd = segA.start + segA.length;
  const bStart = segB.start;
  const bEnd = segB.start + segB.length;
  const forward = bStart - aEnd;              // a ahead into b
  const backward = aStart - bEnd + length;    // b onward round to a
  return Math.max(0, Math.min(forward, backward));
}

/**
 * Everything wrong with a circuit, as a list of sentences. Empty means it is
 * safe to race on.
 */
export function validateTrack(data) {
  const problems = [];
  const where = `track "${data.id}"`;

  if (!Array.isArray(data.center) || data.center.length < 6) {
    problems.push(`${where}: needs at least 6 centre-line points.`);
    return problems;
  }
  if (!(data.roadHalf > 0)) problems.push(`${where}: roadHalf must be positive.`);

  const track = buildTrack(data);
  const edge = data.roadHalf + EDGE_MARGIN;

  // Inside the canvas, kerbs included.
  for (const [x, y] of data.center) {
    if (x - edge < 0 || x + edge > CANVAS.w || y - edge < 0 || y + edge > CANVAS.h) {
      problems.push(`${where}: point (${x}, ${y}) puts the road off the canvas.`);
      break;
    }
  }

  // s = 0 must be on a straight, or the finish line cannot span the road.
  const [ax, ay] = track.tangentAt(-14);
  const [bx, by] = track.tangentAt(14);
  let bend = Math.atan2(by, bx) - Math.atan2(ay, ax);
  while (bend > Math.PI) bend -= Math.PI * 2;
  while (bend < -Math.PI) bend += Math.PI * 2;
  if (Math.abs(bend) > START_STRAIGHT_TOLERANCE) {
    problems.push(
      `${where}: the start line at s=0 sits on a bend of ${Math.abs(bend).toFixed(3)} rad. `
      + 'It must be on a straight so the chequered band can span the road.',
    );
  }

  // No two parts of the circuit may pass close enough to overlap, or for a
  // car on one to be nearest to the other.
  const minGap = data.roadHalf * MIN_SEPARATION_FACTOR;
  const segs = track.segments;

  // Only compare parts of the circuit that are FAR APART ALONG THE LAP.
  // Consecutive segments around a corner are close together in space by
  // definition — that is what a corner is — and flagging them would just be
  // measuring the corner radius. What actually matters is two different
  // parts of the loop passing near each other.
  const apartAlongTrack = data.roadHalf * 6;

  let worst = { gap: Infinity, a: -1, b: -1 };
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (arcGap(segs[i], segs[j], track.length) < apartAlongTrack) continue;
      const gap = segmentDistance(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
      if (gap < worst.gap) worst = { gap, a: i, b: j };
    }
  }
  if (worst.gap < minGap) {
    problems.push(
      `${where}: segments ${worst.a} and ${worst.b} are far apart along the lap but `
      + `pass ${worst.gap.toFixed(1)} apart in space, closer than the `
      + `${minGap.toFixed(1)} two parts of this road need.`,
    );
  }

  return problems;
}

/** Every problem across every circuit, for the checks and for a boot warning. */
export function validateAllTracks() {
  return TRACKS.flatMap(validateTrack);
}
