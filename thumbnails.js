// thumbnails.js
//
// The artwork on the arcade cards, drawn as inline SVG.
//
// WHY SVG, AND WHY INLINE
// -----------------------
// The site makes zero image requests. Every card previously pointed at a PNG
// that does not exist, which meant six failed network requests on every visit
// to the arcade and six tinted gradients with a letter in the middle -- the
// same picture six times over, which tells a visitor nothing about what any of
// these games actually is. These are markup: no request, no layout shift, no
// second copy to keep in step, and they scale to any card size.
//
// WHY NOT IN engine/
// ------------------
// engine/ is the part every game imports. Artwork for the hub is the opposite
// direction -- it is site chrome, and it knows the name of every game, which
// is knowledge the engine must never have.
//
// WHY THE COLOURS ARE COPIED
// --------------------------
// Each thumbnail uses its own game's ART palette, so the grid reads as six
// different games rather than six variations of the site's chrome -- which is
// exactly what CLAUDE.md's "game palettes" section asks for. The values are
// DUPLICATED here rather than imported, and that is deliberate: importing a
// game's game.js would make site chrome depend on games/, and would run that
// game's module side effects -- a canvas, an audio context, an input listener
// -- just to look up six hex codes on the arcade page.
//
// The cost of the duplication is that a game restyled at the source does not
// restyle its card. That is a card looking slightly dated, which is a much
// smaller problem than the hub booting every game to draw itself.
//
// ADDING A GAME
// -------------
// Nothing here is required. A game with no entry below falls back to the
// monogram the cards have always used, so games.json remains the only file you
// have to touch to add one.

const VIEW = 'viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" '
  + 'width="100%" height="100%" aria-hidden="true" focusable="false"';

/**
 * Updraft -- the climb.
 *
 * Platforms receding upward, the bird already above them, and the streaks it
 * left on the way. The eye is meant to travel up the card.
 */
function updraft() {
  return '<svg ' + VIEW + '>'
    + '<defs><linearGradient id="ud-sky" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#0d1b2a"/><stop offset="1" stop-color="#1b3a5c"/>'
    + '</linearGradient>'
    + '<linearGradient id="ud-plat" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#7ad4ff"/><stop offset="1" stop-color="#3a86c9"/>'
    + '</linearGradient></defs>'
    + '<rect width="320" height="200" fill="url(#ud-sky)"/>'
    + '<circle cx="46" cy="34" r="1.6" fill="#cfe8ff" opacity=".7"/>'
    + '<circle cx="268" cy="26" r="1.9" fill="#cfe8ff" opacity=".6"/>'
    + '<circle cx="204" cy="58" r="1.3" fill="#cfe8ff" opacity=".5"/>'
    // Platforms, widest and lowest first: the ladder already climbed.
    + '<rect x="34" y="164" width="96" height="12" rx="6" fill="url(#ud-plat)"/>'
    + '<rect x="182" y="128" width="84" height="12" rx="6" fill="url(#ud-plat)"/>'
    + '<rect x="76" y="94" width="76" height="12" rx="6" fill="#5ee7a0"/>'
    + '<rect x="196" y="62" width="64" height="12" rx="6" fill="url(#ud-plat)"/>'
    // Rising streaks, fading with height.
    + '<path d="M118 154 L118 116" stroke="rgba(255,255,255,.35)" stroke-width="3" stroke-linecap="round"/>'
    + '<path d="M170 118 L170 88" stroke="rgba(255,255,255,.22)" stroke-width="3" stroke-linecap="round"/>'
    // The bird, mid-hop above the highest platform.
    + '<g transform="translate(228 36)">'
    + '<ellipse cx="0" cy="0" rx="15" ry="13" fill="#ffe66d"/>'
    + '<ellipse cx="0" cy="5" rx="10" ry="7" fill="#f2c94c"/>'
    + '<circle cx="5" cy="-4" r="4.2" fill="#fff"/>'
    + '<circle cx="6.4" cy="-4" r="2.2" fill="#22303f"/>'
    + '<path d="M13 -1 L22 2 L13 5 Z" fill="#f2994a"/>'
    + '</g></svg>';
}

/**
 * Comet -- the burning tail.
 *
 * The tail is the weapon, so it is the biggest thing on the card: a long arc
 * running cold blue into hot gold, with the head at the sharp end of it.
 */
function comet() {
  return '<svg ' + VIEW + '>'
    + '<defs><linearGradient id="cm-tail" x1="0" y1="0" x2="1" y2="0">'
    + '<stop offset="0" stop-color="#4dd8ff" stop-opacity="0"/>'
    + '<stop offset=".45" stop-color="#4dd8ff" stop-opacity=".75"/>'
    + '<stop offset="1" stop-color="#ffd84d"/></linearGradient>'
    + '<radialGradient id="cm-head"><stop offset="0" stop-color="#ffffff"/>'
    + '<stop offset="1" stop-color="#ffd84d"/></radialGradient></defs>'
    + '<rect width="320" height="200" fill="#05060f"/>'
    + '<circle cx="38" cy="44" r="1.5" fill="#9fb4ff"/>'
    + '<circle cx="96" cy="24" r="1.1" fill="#9fb4ff" opacity=".8"/>'
    + '<circle cx="286" cy="150" r="1.4" fill="#9fb4ff" opacity=".7"/>'
    + '<circle cx="150" cy="176" r="1.1" fill="#9fb4ff" opacity=".6"/>'
    + '<path d="M18 158 Q120 150 232 78" fill="none" stroke="url(#cm-tail)" '
    + 'stroke-width="17" stroke-linecap="round"/>'
    + '<circle cx="240" cy="72" r="13" fill="url(#cm-head)"/>'
    // Stardust, the thing the tail is chasing.
    + '<circle cx="272" cy="42" r="4.5" fill="#ffd84d"/>'
    + '<circle cx="292" cy="98" r="3.4" fill="#ffd84d" opacity=".8"/>'
    + '<circle cx="196" cy="34" r="3" fill="#ffd84d" opacity=".65"/>'
    // A hunter closing from the dark, so the card has a threat in it.
    + '<circle cx="70" cy="72" r="9" fill="#ff6b8a"/>'
    + '<circle cx="70" cy="72" r="15" fill="none" stroke="#ff2d55" stroke-opacity=".35" stroke-width="2"/>'
    + '</svg>';
}

/**
 * Number Crunch -- the falling problems.
 *
 * The sum at the top, the three answers dropping away from it, the ship
 * underneath. That is the whole loop in one picture.
 */
function numberCrunch() {
  return '<svg ' + VIEW + '>'
    + '<defs><linearGradient id="nc-sky" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#2a1b6b"/><stop offset="1" stop-color="#6b3fa0"/>'
    + '</linearGradient></defs>'
    + '<rect width="320" height="200" fill="url(#nc-sky)"/>'
    + '<circle cx="252" cy="150" r="46" fill="rgba(255,255,255,.07)"/>'
    + '<circle cx="40" cy="30" r="1.4" fill="#fff" opacity=".8"/>'
    + '<circle cx="300" cy="42" r="1.2" fill="#fff" opacity=".6"/>'
    + '<rect x="96" y="14" width="128" height="34" rx="8" fill="#180c3e"/>'
    + '<text x="160" y="38" text-anchor="middle" font-family="ui-monospace, monospace" '
    + 'font-size="21" font-weight="700" fill="#ffffff">7 x 8</text>'
    // Three answers, falling at different rates.
    + '<g><circle cx="62" cy="104" r="25" fill="#63f5c0"/>'
    + '<circle cx="62" cy="108" r="21" fill="#2fbb8c"/>'
    + '<text x="62" y="114" text-anchor="middle" font-family="ui-monospace, monospace" '
    + 'font-size="18" font-weight="700" fill="#241553">56</text></g>'
    + '<g><circle cx="160" cy="82" r="22" fill="#ffd93d"/>'
    + '<circle cx="160" cy="86" r="18" fill="#d9ad00"/>'
    + '<text x="160" y="92" text-anchor="middle" font-family="ui-monospace, monospace" '
    + 'font-size="16" font-weight="700" fill="#241553">54</text></g>'
    + '<g><circle cx="252" cy="96" r="22" fill="#ff8a8a"/>'
    + '<circle cx="252" cy="100" r="18" fill="#d95c5c"/>'
    + '<text x="252" y="106" text-anchor="middle" font-family="ui-monospace, monospace" '
    + 'font-size="16" font-weight="700" fill="#241553">63</text></g>'
    // The ship, and the shot already on its way.
    + '<rect x="156" y="140" width="4" height="18" rx="2" fill="#ffe66d"/>'
    + '<path d="M158 168 L146 190 L170 190 Z" fill="#ffffff"/>'
    + '<rect x="152" y="188" width="12" height="5" rx="2" fill="#45d9ff"/>'
    + '</svg>';
}

/**
 * Keystroke -- the keys.
 *
 * Physical keycaps on ruled paper: one already typed and green, one under the
 * finger, one still to come. The only card in the set that is light, because
 * the only game in the set that is.
 */
function keystroke() {
  return '<svg ' + VIEW + '>'
    + '<rect width="320" height="200" fill="#f4efe4"/>'
    + '<g stroke="#d9d2c2" stroke-width="1.5">'
    + '<path d="M0 44 H320"/><path d="M0 156 H320"/></g>'
    // The racer's track, the thing your words move you along.
    + '<path d="M20 172 H300" stroke="#cfc6b2" stroke-width="3" stroke-linecap="round"/>'
    + '<path d="M20 172 H196" stroke="#c2551a" stroke-width="3" stroke-linecap="round"/>'
    + '<circle cx="196" cy="172" r="7" fill="#c2551a"/>'
    + '<circle cx="128" cy="172" r="6" fill="rgba(90,80,70,.30)"/>'
    // Three keycaps. Sizes differ so they read as keys, not as tiles.
    + keycap(40, 74, 'T', '#1f7a45', '#ffffff')
    + keycap(122, 62, 'Y', '#2a241c', '#fffaf0')
    + keycap(204, 74, 'P', '#a79c88', '#efe9db')
    + '<text x="160" y="30" text-anchor="middle" font-family="ui-monospace, monospace" '
    + 'font-size="15" fill="#6f6555">62 wpm  98%</text>'
    + '</svg>';
}

function keycap(x, y, letter, ink, face) {
  return '<g transform="translate(' + x + ' ' + y + ')">'
    + '<rect x="0" y="6" width="70" height="62" rx="10" fill="#cfc6b2"/>'
    + '<rect x="0" y="0" width="70" height="62" rx="10" fill="' + face + '"/>'
    + '<text x="35" y="42" text-anchor="middle" font-family="ui-monospace, monospace" '
    + 'font-size="28" font-weight="700" fill="' + ink + '">' + letter + '</text></g>';
}

/**
 * Sinkhole -- the descent.
 *
 * Read top to bottom: the spiked ceiling waiting above, the player already
 * dropping, and the gaps staggered so you can see the steering the game is
 * actually about.
 */
function sinkhole() {
  return '<svg ' + VIEW + '>'
    + '<defs><linearGradient id="sh-rock" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#231a14"/><stop offset="1" stop-color="#3d2a1c"/>'
    + '</linearGradient>'
    + '<radialGradient id="sh-lamp"><stop offset="0" stop-color="rgba(255,214,150,.30)"/>'
    + '<stop offset="1" stop-color="rgba(255,214,150,0)"/></radialGradient></defs>'
    + '<rect width="320" height="200" fill="url(#sh-rock)"/>'
    + '<circle cx="150" cy="96" r="86" fill="url(#sh-lamp)"/>'
    // The ceiling, teeth down.
    + '<rect width="320" height="22" fill="#2a1410"/>'
    + '<path d="' + saw(0, 22, 320, 11, 20) + '" fill="#d8d2c4"/>'
    // Ledges with staggered gaps.
    + ledge(0, 78, 122) + ledge(168, 78, 152)
    + ledge(0, 134, 74) + ledge(126, 134, 194)
    + ledge(0, 184, 196) + ledge(244, 184, 76)
    // The player, falling through the first gap.
    + '<circle cx="146" cy="104" r="14" fill="#ffd166" stroke="#c98f24" stroke-width="3"/>'
    + '<circle cx="142" cy="101" r="2.6" fill="#231a14"/>'
    + '<circle cx="151" cy="101" r="2.6" fill="#231a14"/>'
    + '</svg>';
}

function ledge(x, y, width) {
  return '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="14" fill="#8a6234"/>'
    + '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="4" fill="#c08d4e"/>';
}

// A row of triangles, used for both ceilings that bite.
function saw(x, y, width, height, step) {
  let d = 'M' + x + ' ' + y;
  for (let at = x; at < x + width; at += step) {
    d += ' L' + (at + step / 2) + ' ' + (y + height) + ' L' + (at + step) + ' ' + y;
  }
  return d + ' Z';
}

/**
 * Circuit Racer -- the track.
 *
 * The circuit seen from above, which is how the game is played: kerbs, the
 * chequered line, and a field mid-corner rather than a car on its own.
 */
function circuitRacer() {
  const loop = 'M96 44 H224 Q272 44 288 84 Q302 122 268 148 Q232 172 160 168 '
    + 'Q88 164 52 138 Q22 114 34 80 Q48 46 96 44 Z';
  return '<svg ' + VIEW + '>'
    + '<rect width="320" height="200" fill="#3e6b3a"/>'
    + '<g fill="#355c32">'
    + '<rect x="0" y="0" width="26" height="200"/><rect x="52" y="0" width="26" height="200"/>'
    + '<rect x="104" y="0" width="26" height="200"/><rect x="156" y="0" width="26" height="200"/>'
    + '<rect x="208" y="0" width="26" height="200"/><rect x="260" y="0" width="26" height="200"/>'
    + '</g>'
    // Kerb underneath, road over it, then the dashed centre line.
    + '<path d="' + loop + '" fill="none" stroke="#d6453f" stroke-width="52" stroke-linejoin="round"/>'
    // The white half of the kerb, laid over the red as dashes. One solid
    // red stroke read as an outline drawn round the track rather than as
    // painted kerbing.
    + '<path d="' + loop + '" fill="none" stroke="#f2f2f2" stroke-width="52" '
    + 'stroke-linejoin="round" stroke-dasharray="13 13"/>'
    + '<path d="' + loop + '" fill="none" stroke="#6a6a70" stroke-width="46" stroke-linejoin="round"/>'
    + '<path d="' + loop + '" fill="none" stroke="#4a4a4f" stroke-width="44" stroke-linejoin="round"/>'
    + '<path d="' + loop + '" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="2" '
    + 'stroke-dasharray="10 14"/>'
    // Start line, across the top straight.
    + '<g>' + chequer(150, 24, 5, 8) + '</g>'
    // Three cars into the first corner, player in front.
    + car(196, 36, 0, '#ffc93c', '#c9922a')
    + car(232, 44, 18, '#4da3ff', '#2c6fbd')
    + car(258, 62, 42, '#ff7a59', '#c25236')
    + '</svg>';
}

function chequer(x, y, cols, cell) {
  let out = '';
  for (let i = 0; i < cols; i++) {
    for (let row = 0; row < 5; row++) {
      out += '<rect x="' + (x + i * cell) + '" y="' + (y + row * cell) + '" '
        + 'width="' + cell + '" height="' + cell + '" fill="'
        + ((i + row) % 2 === 0 ? '#f2f2f2' : '#2b2b2f') + '"/>';
    }
  }
  return out;
}

function car(x, y, angle, body, dark) {
  return '<g transform="translate(' + x + ' ' + y + ') rotate(' + angle + ')">'
    + '<rect x="-14" y="-8" width="28" height="16" rx="2" fill="' + dark + '"/>'
    + '<rect x="-12" y="-6" width="24" height="12" rx="1" fill="' + body + '"/>'
    + '<rect x="2" y="-4" width="6" height="8" fill="rgba(20,24,32,.75)"/></g>';
}

/**
 * Ballast -- the falling-crate game, not yet built.
 *
 * The card has to sell the twist rather than the genre, so the hull is drawn
 * already leaning: the crates are stacked heavy to one side, and the waterline
 * says what that costs.
 */
function ballast() {
  return '<svg ' + VIEW + '>'
    + '<defs><linearGradient id="bl-sea" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#123243"/><stop offset="1" stop-color="#0a1d28"/>'
    + '</linearGradient></defs>'
    + '<rect width="320" height="200" fill="url(#bl-sea)"/>'
    // A crate still on its way down, so the card shows the verb.
    + '<g transform="translate(216 12) rotate(-14)">'
    + crate(0, 0, 24, 24, '#e0aa62', '#a9763a')
    + crate(24, 0, 24, 24, '#e0aa62', '#a9763a')
    + crate(24, 24, 24, 24, '#e0aa62', '#a9763a')
    + '</g>'
    // The barge, well over on her side. The point of the game is that a crate
    // is a WEIGHT and not just a shape, so the card has to show a hull that
    // has been tipped by where the stack went rather than a tidy tower.
    // Sat high enough that the cargo is above the waterline. Lower down, the
    // stack drowned in the dark water and the card read as an empty hull.
    + '<g transform="translate(146 100) rotate(-13)">'
    + '<path d="M-114 -46 L114 -46 L90 44 L-90 44 Z" fill="#2b5568" '
    + 'stroke="#a8d4e6" stroke-width="3" stroke-linejoin="round"/>'
    + '<path d="M-114 -46 L114 -46" stroke="#cfe9f4" stroke-width="4"/>'
    // Stacked heavy to port, which is why she is leaning that way.
    + crate(-88, 8, 36, 36, '#c98a4b', '#8e5f31')
    + crate(-50, 8, 36, 36, '#e0aa62', '#a9763a')
    + crate(-12, 8, 36, 36, '#c98a4b', '#8e5f31')
    + crate(-88, -30, 36, 36, '#e0aa62', '#a9763a')
    + crate(-50, -30, 36, 36, '#b9743c', '#7d4b25')
    + crate(-88, -68, 36, 36, '#e0aa62', '#a9763a')
    + '</g>'
    // The waterline, taking the low side under.
    + '<path d="M0 150 Q80 141 160 150 Q240 159 320 148 L320 200 L0 200 Z" '
    + 'fill="#0b2430" opacity=".9"/>'
    + '<path d="M0 150 Q80 141 160 150 Q240 159 320 148" fill="none" '
    + 'stroke="#5fd0c4" stroke-width="3" opacity=".8"/>'
    + '</svg>';
}

function crate(x, y, w, h, face, edge) {
  return '<g><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" '
    + 'rx="2" fill="' + face + '" stroke="' + edge + '" stroke-width="2"/>'
    + '<path d="M' + x + ' ' + y + ' L' + (x + w) + ' ' + (y + h) + '" stroke="' + edge
    + '" stroke-width="1.5" opacity=".55"/></g>';
}

/**
 * Ember -- the one-button flyer, not yet built.
 *
 * A burner and a gorge. No bird and nothing green: the genre is shared, the
 * character and the place are not.
 */
function ember() {
  return '<svg ' + VIEW + '>'
    + '<defs><linearGradient id="em-dusk" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#33204f"/><stop offset=".5" stop-color="#9c4a6b"/>'
    + '<stop offset="1" stop-color="#f0a15c"/></linearGradient></defs>'
    + '<rect width="320" height="200" fill="url(#em-dusk)"/>'
    + '<circle cx="160" cy="188" r="46" fill="#ffd08a" opacity=".45"/>'
    // Gorge walls, narrowing towards the top, leaving the gap the balloon is
    // aimed at. Two tones per side with the lighter one as a rim, so the
    // silhouette reads against a dusk sky rather than sinking into it.
    + '<path d="M0 0 L108 0 L96 58 L118 104 L92 152 L108 200 L0 200 Z" fill="#5c4661"/>'
    + '<path d="M0 0 L96 0 L84 56 L106 104 L80 154 L96 200 L0 200 Z" fill="#2a2033"/>'
    + '<path d="M320 0 L210 0 L222 50 L202 96 L228 148 L210 200 L320 200 Z" fill="#5c4661"/>'
    + '<path d="M320 0 L222 0 L234 48 L214 96 L240 150 L222 200 L320 200 Z" fill="#2a2033"/>'
    // The balloon, patchwork, mid-climb with the burner lit.
    + '<g transform="translate(156 88)">'
    + '<path d="M0 -40 C28 -40 40 -19 35 2 C30 21 14 33 0 40 C-14 33 -30 21 -35 2 '
    + 'C-40 -19 -28 -40 0 -40 Z" fill="#e2603f"/>'
    + '<path d="M0 -40 C14 -40 23 -19 21 2 C19 21 9 33 0 40 Z" fill="#f0a03c"/>'
    + '<path d="M-35 2 C-30 21 -14 33 0 40 C-5 24 -9 10 -9 -2 Z" fill="#b9432f" opacity=".75"/>'
    + '<path d="M-9 42 L9 42 L7 55 L-7 55 Z" fill="#8a5a30" stroke="#5c3d20" stroke-width="1.5"/>'
    + '<path d="M-7 40 L-11 46 M7 40 L11 46" stroke="#2a2033" stroke-width="2"/>'
    // The burner: the one control, so it is lit and bright.
    + '<path d="M0 44 C7 36 7 30 0 24 C-7 30 -7 36 0 44 Z" fill="#ffe08a"/>'
    + '<path d="M0 40 C4 34 4 30 0 27 C-4 30 -4 34 0 40 Z" fill="#fff6d8"/>'
    + '</g></svg>';
}

// --- The lookup ----------------------------------------------------------

const ART = {
  updraft,
  comet,
  'number-crunch': numberCrunch,
  keystroke,
  sinkhole,
  'circuit-racer': circuitRacer,
  ballast,
  ember,
};

/**
 * The card artwork for a game, as an SVG string, or null if it has none yet.
 *
 * Null rather than a generic picture on purpose: the caller already has a
 * perfectly good fallback in the monogram, and a stand-in that pretended to be
 * artwork would be harder to notice as missing.
 */
export function thumbnailFor(gameId) {
  const draw = ART[gameId];
  return draw ? draw() : null;
}
