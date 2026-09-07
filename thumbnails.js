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

/**
 * Block Buster -- the well, mid-collapse.
 *
 * A row lit white on the point of clearing, the charged cell that took it, and
 * the next piece already on its way down. The card has to say "this stack is
 * about to come apart", because that is the game.
 */
function blockBuster() {
  // The chip treatment from the game's first theme: a flat plate with a lit
  // top edge and a dark bottom one. Repeated a dozen times, so it is a helper.
  const chip = (x, y, fill) =>
    '<g><rect x="' + x + '" y="' + y + '" width="26" height="26" fill="' + fill + '"/>'
    + '<rect x="' + x + '" y="' + y + '" width="26" height="3" fill="rgba(255,255,255,.28)"/>'
    + '<rect x="' + x + '" y="' + (y + 23) + '" width="26" height="3" fill="rgba(0,0,0,.30)"/></g>';

  return '<svg ' + VIEW + '>'
    + '<defs><linearGradient id="bb-sky" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#04161c"/><stop offset="1" stop-color="#072a30"/>'
    + '</linearGradient></defs>'
    + '<rect width="320" height="200" fill="url(#bb-sky)"/>'
    // The well.
    + '<rect x="86" y="8" width="148" height="184" rx="7" fill="#02090c" '
    + 'stroke="#1d5c63" stroke-width="2"/>'
    // Ruled faintly, so it reads as a grid rather than a hole.
    + '<g stroke="rgba(120,240,220,.07)" stroke-width="1" fill="none">'
    + '<path d="M114 10 L114 190 M142 10 L142 190 M170 10 L170 190 M198 10 L198 190"/>'
    + '<path d="M88 66 L232 66 M88 94 L232 94 M88 122 L232 122 M88 150 L232 150"/>'
    + '</g>'
    // The settled stack.
    + chip(88, 150, '#31e0c0') + chip(116, 150, '#2bb8e0') + chip(144, 150, '#7ce06a')
    + chip(172, 150, '#e0d24a') + chip(200, 150, '#e06a9a')
    + chip(88, 122, '#8a7ce0') + chip(116, 122, '#48d0a0') + chip(200, 122, '#4ac6e0')
    // The row going out, lit white, with the charged cell that took it.
    + '<rect x="87" y="177" width="146" height="14" fill="rgba(255,255,255,.85)"/>'
    + '<circle cx="157" cy="184" r="5" fill="#fff3b0"/>'
    + '<circle cx="157" cy="184" r="2.2" fill="#ffffff"/>'
    // The next piece, falling.
    + chip(144, 30, '#e0d24a') + chip(172, 30, '#e0d24a') + chip(144, 58, '#e0d24a')
    + '</svg>';
}

/**
 * Neon Drift Delivery -- the road at speed.
 *
 * Lanes running away up the card, traffic to squeeze past, and the lit drop
 * pad on the shoulder. The player's car is the only warm thing on it.
 */
function neonDrift() {
  const car = (x, y, fill, tail) =>
    '<g><rect x="' + x + '" y="' + y + '" width="24" height="42" rx="5" fill="' + fill + '"/>'
    + '<rect x="' + (x + 4) + '" y="' + (y + 13) + '" width="16" height="17" rx="3" fill="rgba(0,0,0,.34)"/>'
    + '<rect x="' + (x + 2) + '" y="' + (y + 36) + '" width="6" height="3" fill="' + tail + '"/>'
    + '<rect x="' + (x + 16) + '" y="' + (y + 36) + '" width="6" height="3" fill="' + tail + '"/></g>';

  return '<svg ' + VIEW + '>'
    + '<defs><linearGradient id="nd-sky" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#05030f"/><stop offset="1" stop-color="#140a26"/>'
    + '</linearGradient></defs>'
    + '<rect width="320" height="200" fill="url(#nd-sky)"/>'
    // Skyline either side, lit windows and all.
    + '<g fill="#0d0820" stroke="#2a1a4a" stroke-width="1">'
    + '<rect x="2" y="52" width="34" height="148"/><rect x="40" y="86" width="26" height="114"/>'
    + '<rect x="256" y="66" width="30" height="134"/><rect x="290" y="40" width="28" height="160"/>'
    + '</g>'
    + '<g fill="rgba(255,190,120,.85)">'
    + '<rect x="9" y="64" width="4" height="6"/><rect x="21" y="80" width="4" height="6"/>'
    + '<rect x="47" y="100" width="4" height="6"/><rect x="297" y="56" width="4" height="6"/>'
    + '<rect x="264" y="88" width="4" height="6"/></g>'
    // Road, shoulders, and the hot edge lines.
    + '<rect x="70" y="0" width="180" height="200" fill="#241c30"/>'
    + '<rect x="86" y="0" width="148" height="200" fill="#15121c"/>'
    + '<rect x="84" y="0" width="3" height="200" fill="rgba(255,120,200,.65)"/>'
    + '<rect x="233" y="0" width="3" height="200" fill="rgba(255,120,200,.65)"/>'
    // Lane dashes.
    + '<g fill="rgba(230,230,255,.55)">'
    + '<rect x="134" y="6" width="3" height="26"/><rect x="134" y="62" width="3" height="26"/>'
    + '<rect x="134" y="118" width="3" height="26"/><rect x="134" y="174" width="3" height="26"/>'
    + '<rect x="183" y="30" width="3" height="26"/><rect x="183" y="86" width="3" height="26"/>'
    + '<rect x="183" y="142" width="3" height="26"/></g>'
    // The drop pad on the shoulder: the thing the run is actually about.
    + '<rect x="70" y="96" width="16" height="56" fill="rgba(40,224,255,.18)" '
    + 'stroke="#28e0ff" stroke-width="2" stroke-dasharray="7 5"/>'
    // Traffic, then the player, low on the card where the eye lands last.
    + car(96, 22, '#3f4a6b', '#ff3a3a')
    + car(196, 60, '#5a3f6b', '#ff3a3a')
    + car(146, 130, '#28e0ff', '#ff3d9a')
    + '<rect x="148" y="126" width="20" height="3" fill="#ff3d9a"/>'
    + '<path d="M152 174 L158 194 L164 174 Z" fill="#ffd166" opacity=".9"/>'
    + '</svg>';
}

/**
 * Skyhook -- mid-swing, over the gap.
 *
 * Two towers, a rope under tension, and a ring hanging in the space between
 * them. The figure is drawn part-way down the arc, which is the moment the
 * whole game is about.
 */
function skyhook() {
  return '<svg ' + VIEW + '>'
    + '<defs><linearGradient id="sk-sky" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#151033"/><stop offset=".45" stop-color="#4a2a5c"/>'
    + '<stop offset=".78" stop-color="#c05a5a"/><stop offset="1" stop-color="#f5a15c"/>'
    + '</linearGradient></defs>'
    + '<rect width="320" height="200" fill="url(#sk-sky)"/>'
    + '<circle cx="230" cy="150" r="46" fill="rgba(255,220,150,.30)"/>'
    + '<g fill="rgba(255,240,220,.7)">'
    + '<rect x="40" y="24" width="2" height="2"/><rect x="96" y="14" width="2" height="2"/>'
    + '<rect x="188" y="30" width="2" height="2"/><rect x="272" y="18" width="2" height="2"/></g>'
    // Distant skyline, then the two towers that matter.
    + '<g fill="#2a1f45"><rect x="0" y="128" width="46" height="72"/>'
    + '<rect x="126" y="150" width="52" height="50"/><rect x="272" y="136" width="48" height="64"/></g>'
    + '<g fill="#100c22" stroke="#453a75" stroke-width="1.5">'
    + '<rect x="30" y="92" width="62" height="108"/><rect x="212" y="118" width="66" height="82"/></g>'
    + '<g fill="rgba(255,196,120,.85)">'
    + '<rect x="40" y="104" width="7" height="10"/><rect x="58" y="104" width="7" height="10"/>'
    + '<rect x="40" y="126" width="7" height="10"/><rect x="76" y="126" width="7" height="10"/>'
    + '<rect x="224" y="132" width="7" height="10"/><rect x="252" y="132" width="7" height="10"/></g>'
    // Masts, with the lit anchor at each tip.
    + '<path d="M61 92 L61 34 M245 118 L245 72" stroke="#5a4a8c" stroke-width="3" fill="none"/>'
    + '<circle cx="61" cy="34" r="11" fill="rgba(255,209,102,.25)"/>'
    + '<circle cx="61" cy="34" r="4.5" fill="#ffd166"/>'
    + '<circle cx="245" cy="72" r="11" fill="rgba(255,209,102,.25)"/>'
    + '<circle cx="245" cy="72" r="4.5" fill="#ffd166"/>'
    // The ring over the gap: what swinging well is worth.
    + '<circle cx="152" cy="70" r="22" fill="rgba(94,242,192,.16)" stroke="#5ef2c0" stroke-width="4"/>'
    // The rope, taut, and the figure hanging off it.
    + '<path d="M61 34 L104 118" stroke="#ffffff" stroke-width="2" opacity=".85" fill="none"/>'
    + '<g transform="translate(104 118) rotate(28)">'
    + '<path d="M0 -2 L-8 16 L8 16 Z" fill="#ff5f7e"/>'
    + '<ellipse cx="0" cy="0" rx="6.5" ry="10" fill="#ffd166"/>'
    + '<circle cx="0" cy="-10" r="4.6" fill="#ffe9c4"/>'
    + '</g></svg>';
}

/**
 * Tower Stack -- the tower, tapering.
 *
 * Every slab narrower than the one beneath it, so the card states the rule
 * without a word of explanation, and the sheared-off slice is still falling.
 */
function towerStack() {
  const slab = (cx, y, w, fill) =>
    '<g><rect x="' + (cx - w / 2) + '" y="' + y + '" width="' + w + '" height="18" fill="' + fill + '"/>'
    + '<rect x="' + (cx - w / 2) + '" y="' + y + '" width="' + w + '" height="3" fill="rgba(255,255,255,.30)"/>'
    + '<rect x="' + (cx - w / 2) + '" y="' + (y + 15) + '" width="' + w + '" height="3" fill="rgba(0,0,0,.28)"/></g>';

  return '<svg ' + VIEW + '>'
    + '<defs><linearGradient id="ts-sky" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#5aa0d8"/><stop offset="1" stop-color="#f0b48a"/>'
    + '</linearGradient></defs>'
    + '<rect width="320" height="200" fill="url(#ts-sky)"/>'
    + '<g fill="rgba(255,255,255,.30)">'
    + '<circle cx="56" cy="42" r="17"/><circle cx="74" cy="47" r="12"/><circle cx="40" cy="48" r="11"/>'
    + '<circle cx="258" cy="28" r="13"/><circle cx="272" cy="32" r="9"/></g>'
    // The ground, already a long way down.
    + '<rect x="0" y="186" width="320" height="14" fill="#2e4a34"/>'
    // The tower, losing a slice at every level.
    + slab(160, 168, 108, '#ff8a5c')
    + slab(154, 150, 96, '#ffc857')
    + slab(163, 132, 82, '#5ef2a0')
    + slab(156, 114, 68, '#5ec8f2')
    + slab(164, 96, 52, '#a78bfa')
    + slab(158, 78, 40, '#ff6b9a')
    // The slab in the air, and the guides it has to land between.
    + '<g stroke="rgba(255,255,255,.35)" stroke-width="1" stroke-dasharray="4 5" fill="none">'
    + '<path d="M138 40 L138 78 M178 40 L178 78"/></g>'
    + slab(206, 24, 40, '#ff8a5c')
    // The slice sheared off the last one, still falling.
    + '<g transform="translate(96 106) rotate(24)">'
    + '<rect x="-11" y="-8" width="22" height="16" fill="#5ec8f2"/></g>'
    + '</svg>';
}

/**
 * Gravity Flip -- the corridor, upside down.
 *
 * The runner is on the CEILING with its trail behind it and the spikes on the
 * floor below, which is the one picture that explains the button.
 */
function gravityFlip() {
  return '<svg ' + VIEW + '>'
    + '<defs><linearGradient id="gf-bg" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#0b1424"/><stop offset="1" stop-color="#122036"/>'
    + '</linearGradient></defs>'
    + '<rect width="320" height="200" fill="url(#gf-bg)"/>'
    + '<g stroke="rgba(120,190,255,.06)" stroke-width="1" fill="none">'
    + '<path d="M40 0 L40 200 M80 0 L80 200 M120 0 L120 200 M160 0 L160 200 '
    + 'M200 0 L200 200 M240 0 L240 200 M280 0 L280 200"/>'
    + '<path d="M0 40 L320 40 M0 80 L320 80 M0 120 L320 120 M0 160 L320 160"/></g>'
    // Ceiling and floor: the two surfaces, both solid, both standable.
    + '<rect x="0" y="0" width="320" height="30" fill="#1f3a5c"/>'
    + '<rect x="0" y="0" width="320" height="4" fill="#2e5686"/>'
    + '<rect x="0" y="170" width="320" height="30" fill="#1f3a5c"/>'
    + '<rect x="0" y="170" width="320" height="4" fill="#2e5686"/>'
    // A block hanging off the ceiling, the kind you have to drop away from.
    + '<g><rect x="196" y="30" width="60" height="46" fill="#1f3a5c"/>'
    + '<rect x="196" y="30" width="60" height="4" fill="#2e5686"/></g>'
    // Floor spikes.
    + '<g fill="#ff4d6d">'
    + '<path d="M84 170 L96 170 L90 146 Z"/><path d="M98 170 L110 170 L104 146 Z"/>'
    + '<path d="M112 170 L124 170 L118 146 Z"/>'
    + '<path d="M262 170 L274 170 L268 146 Z"/><path d="M276 170 L288 170 L282 146 Z"/></g>'
    // A saw, in the middle band where saws are allowed to be.
    + '<g transform="translate(168 100)">'
    + '<circle r="19" fill="rgba(255,77,109,.18)"/>'
    + '<g fill="#9aa8c0"><path d="M-4 -16 L4 -16 L0 -9 Z"/><path d="M-4 16 L4 16 L0 9 Z"/>'
    + '<path d="M-16 -4 L-16 4 L-9 0 Z"/><path d="M16 -4 L16 4 L9 0 Z"/></g>'
    + '<circle r="11" fill="#e0e6f0"/><circle r="3.6" fill="#ff4d6d"/></g>'
    // The runner, on the ceiling, trailing.
    + '<g fill="rgba(158,242,255,.45)">'
    + '<rect x="26" y="43" width="9" height="9"/><rect x="40" y="43" width="9" height="9" opacity=".7"/>'
    + '<rect x="54" y="43" width="9" height="9" opacity=".45"/></g>'
    + '<g><rect x="68" y="34" width="26" height="30" rx="6" fill="#9ef2ff"/>'
    + '<circle cx="76" cy="43" r="2.8" fill="#1a1a24"/><circle cx="86" cy="43" r="2.8" fill="#1a1a24"/></g>'
    + '</svg>';
}

/**
 * Rift Runner -- the runner mid-dash, and the portal that changes the rules.
 *
 * The card has to say 'the portal is the point', so it is split down the
 * middle: cool Surface on the left, hot Forge on the right, with the rift
 * standing on the seam. Same ground, same runner, different world either side.
 */
function riftRunner() {
  const spike = (x) => '<path d="M' + x + ' 150 L' + (x + 11) + ' 128 L' + (x + 22) + ' 150 Z" fill="#ff5a6e"/>';
  return '<svg ' + VIEW + '>'
    + '<defs>'
    + '<linearGradient id="rr-a" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#141a2e"/><stop offset="1" stop-color="#2b3a5c"/></linearGradient>'
    + '<linearGradient id="rr-b" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#2a1206"/><stop offset="1" stop-color="#7a2c10"/></linearGradient>'
    + '</defs>'
    // Two worlds, meeting at the rift.
    + '<rect width="186" height="200" fill="url(#rr-a)"/>'
    + '<rect x="186" width="134" height="200" fill="url(#rr-b)"/>'
    // Parallax slabs, one palette each side.
    + '<g fill="#1d2742"><rect x="14" y="78" width="46" height="72"/>'
    + '<rect x="78" y="98" width="34" height="52"/></g>'
    + '<g fill="#3d1a09"><rect x="214" y="66" width="40" height="84"/>'
    + '<rect x="268" y="92" width="38" height="58"/></g>'
    // Ground, with its lit lip, changing colour at the seam.
    + '<rect y="150" width="186" height="50" fill="#27324f"/>'
    + '<rect y="150" width="186" height="4" fill="#5f7bb0"/>'
    + '<rect x="186" y="150" width="134" height="50" fill="#40200e"/>'
    + '<rect x="186" y="150" width="134" height="4" fill="#ff8b3d"/>'
    // An overhead bar to duck, and spikes to jump.
    + '<rect x="36" y="0" width="52" height="84" fill="#ffc857"/>'
    + '<rect x="36" y="79" width="52" height="5" fill="#8a6212"/>'
    + spike(238) + spike(276)
    // The rift itself, on the seam, edge-lit.
    + '<rect x="178" y="20" width="16" height="130" fill="rgba(255,255,255,.12)"/>'
    + '<path d="M178 20 L178 150 M194 20 L194 150" stroke="#ffffff" stroke-width="3"/>'
    // The runner, mid-dash through it, trailing.
    + '<g opacity=".28" fill="#f6f2e8">'
    + '<rect x="120" y="106" width="20" height="34"/><rect x="144" y="106" width="20" height="34"/></g>'
    + '<g><rect x="168" y="104" width="22" height="38" fill="#f6f2e8" stroke="#12161f" stroke-width="2"/>'
    + '<rect x="172" y="110" width="14" height="6" fill="#1b2436"/></g>'
    + '</svg>';
}
/**
 * Endless Mini Golf -- a dog-leg with water on the direct line.
 *
 * The card has to say what the game is ABOUT, which is not putting: it is the
 * decision between the short way over the water and the long way round. So
 * the aim line points at the corner rather than at the cup.
 */
function miniGolf() {
  const T = 32;
  const green = (x, y, w, h) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="#3f9d5a"/>';
  const wall  = (x, y, w, h) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="#e8ddc4"/>';
  return '<svg ' + VIEW + '>'
    + '<rect width="320" height="200" fill="#11261c"/>'
    // The fairway: along the bottom, then up and right. A dog-leg.
    + green(24, 128, 168, 48) + green(144, 40, 152, 136)
    // Boards around it.
    + wall(16, 120, 184, 8) + wall(16, 176, 128, 8)
    + wall(136, 32, 168, 8) + wall(296, 32, 8, 152) + wall(144, 176, 160, 8)
    + wall(16, 120, 8, 64) + wall(136, 40, 8, 88)
    // Water across the short line, which is the whole decision.
    + '<rect x="196" y="96" width="64" height="56" fill="#2b6ecf"/>'
    + '<g fill="rgba(190,225,255,.45)"><rect x="204" y="110" width="46" height="3"/>'
    + '<rect x="212" y="126" width="32" height="3"/></g>'
    // Sand on the long way round, so neither route is free.
    + '<rect x="160" y="56" width="32" height="32" fill="#e3c778"/>'
    // The cup, top right, with its flag.
    + '<circle cx="272" cy="72" r="9" fill="#0b1a12" stroke="#f6f2e8" stroke-width="2"/>'
    + '<path d="M272 72 L272 38" stroke="#f6f2e8" stroke-width="2"/>'
    + '<path d="M272 38 L290 44 L272 50 Z" fill="#ff4d5e"/>'
    // The ball, bottom left, aiming at the corner rather than the cup.
    + '<g fill="rgba(255,255,255,.35)">'
    + '<circle cx="92" cy="152" r="2.4"/><circle cx="106" cy="152" r="2.4"/>'
    + '<circle cx="120" cy="152" r="2.4"/><circle cx="134" cy="152" r="2.4"/>'
    + '<circle cx="148" cy="152" r="2.4"/><circle cx="162" cy="152" r="2.4"/></g>'
    + '<circle cx="72" cy="152" r="6" fill="#ffffff" stroke="#9aa6a0" stroke-width="1.5"/>'
    + '</svg>';
}
// --- The lookup ----------------------------------------------------------

const ART = {
  updraft,
  comet,
  'number-crunch': numberCrunch,
  keystroke,
  sinkhole,
  'circuit-racer': circuitRacer,
  'block-buster': blockBuster,
  'neon-drift': neonDrift,
  skyhook,
  'tower-stack': towerStack,
  'gravity-flip': gravityFlip,
  ballast,
  ember,
  'rift-runner': riftRunner,
  'mini-golf': miniGolf,
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
