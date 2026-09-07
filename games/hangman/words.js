// games/hangman/words.js
//
// The lexicon, and nothing else. Kept apart from the rules so that a change to
// the word list cannot quietly change the game, and so the solvability check
// in tests/ can be run against the real words rather than a fixture.
//
// WHY IT IS EMBEDDED
// ------------------
// No backend, no API calls, no fetch. Every word the game will ever show is in
// this file, which is also what lets the solver reason: the candidate set the
// deducer filters is exactly the set the game draws from, so "solvable by
// reasoning" is a claim about this list and can be proved against it.
//
// TIERS
// -----
// Tier 0 is short and common. Tier 2 is long or awkward — letters that cluster
// (RHYTHM), letters that repeat (BALLOON), or words whose vowels are unusual.
// A run walks up the tiers, so escalation is a property of the list rather
// than a multiplier applied to it.

export const CATEGORY = {
  ANIMALS: 'Animals',
  FOOD: 'Food and drink',
  PLACES: 'Places',
  SCIENCE: 'Science',
  HOUSE: 'Around the house',
  WEATHER: 'Weather and nature',
};

/**
 * Every word, as [word, category, tier].
 *
 * Uppercase, A-Z only, no spaces or hyphens — the letter grid is 26 keys and a
 * word it cannot spell is a word the game cannot fairly ask for.
 */
export const WORDS = [
  // --- Animals ---
  ['CAT', CATEGORY.ANIMALS, 0], ['DOG', CATEGORY.ANIMALS, 0],
  ['HORSE', CATEGORY.ANIMALS, 0], ['SHEEP', CATEGORY.ANIMALS, 0],
  ['MOUSE', CATEGORY.ANIMALS, 0], ['TIGER', CATEGORY.ANIMALS, 0],
  ['SNAKE', CATEGORY.ANIMALS, 0], ['EAGLE', CATEGORY.ANIMALS, 0],
  ['RABBIT', CATEGORY.ANIMALS, 0], ['MONKEY', CATEGORY.ANIMALS, 0],
  ['BADGER', CATEGORY.ANIMALS, 1], ['OTTER', CATEGORY.ANIMALS, 1],
  ['FALCON', CATEGORY.ANIMALS, 1], ['WALRUS', CATEGORY.ANIMALS, 1],
  ['PENGUIN', CATEGORY.ANIMALS, 1], ['DOLPHIN', CATEGORY.ANIMALS, 1],
  ['LEOPARD', CATEGORY.ANIMALS, 1], ['OSTRICH', CATEGORY.ANIMALS, 1],
  ['SQUIRREL', CATEGORY.ANIMALS, 1], ['HEDGEHOG', CATEGORY.ANIMALS, 1],
  ['PORCUPINE', CATEGORY.ANIMALS, 2], ['CHAMELEON', CATEGORY.ANIMALS, 2],
  ['ALBATROSS', CATEGORY.ANIMALS, 2], ['WOODPECKER', CATEGORY.ANIMALS, 2],
  ['JELLYFISH', CATEGORY.ANIMALS, 2], ['RHINOCEROS', CATEGORY.ANIMALS, 2],
  ['BUTTERFLY', CATEGORY.ANIMALS, 2], ['CHIMPANZEE', CATEGORY.ANIMALS, 2],
  ['MONGOOSE', CATEGORY.ANIMALS, 2], ['PLATYPUS', CATEGORY.ANIMALS, 2],

  // --- Food and drink ---
  ['BREAD', CATEGORY.FOOD, 0], ['APPLE', CATEGORY.FOOD, 0],
  ['CHEESE', CATEGORY.FOOD, 0], ['BUTTER', CATEGORY.FOOD, 0],
  ['ORANGE', CATEGORY.FOOD, 0], ['BANANA', CATEGORY.FOOD, 0],
  ['COFFEE', CATEGORY.FOOD, 0], ['POTATO', CATEGORY.FOOD, 0],
  ['CARROT', CATEGORY.FOOD, 0], ['LEMON', CATEGORY.FOOD, 0],
  ['PEPPER', CATEGORY.FOOD, 1], ['YOGHURT', CATEGORY.FOOD, 1],
  ['MUSTARD', CATEGORY.FOOD, 1], ['PORRIDGE', CATEGORY.FOOD, 1],
  ['SPINACH', CATEGORY.FOOD, 1], ['PANCAKE', CATEGORY.FOOD, 1],
  ['NOODLES', CATEGORY.FOOD, 1], ['CUSTARD', CATEGORY.FOOD, 1],
  ['LIQUORICE', CATEGORY.FOOD, 2], ['ASPARAGUS', CATEGORY.FOOD, 2],
  ['MERINGUE', CATEGORY.FOOD, 2], ['COURGETTE', CATEGORY.FOOD, 2],
  ['ARTICHOKE', CATEGORY.FOOD, 2], ['MARZIPAN', CATEGORY.FOOD, 2],
  ['CINNAMON', CATEGORY.FOOD, 2], ['AUBERGINE', CATEGORY.FOOD, 2],

  // --- Places ---
  ['CITY', CATEGORY.PLACES, 0], ['BEACH', CATEGORY.PLACES, 0],
  ['ISLAND', CATEGORY.PLACES, 0], ['BRIDGE', CATEGORY.PLACES, 0],
  ['CASTLE', CATEGORY.PLACES, 0], ['MARKET', CATEGORY.PLACES, 0],
  ['GARDEN', CATEGORY.PLACES, 0], ['HARBOUR', CATEGORY.PLACES, 0],
  ['VILLAGE', CATEGORY.PLACES, 1], ['STATION', CATEGORY.PLACES, 1],
  ['LIBRARY', CATEGORY.PLACES, 1], ['MUSEUM', CATEGORY.PLACES, 1],
  ['FACTORY', CATEGORY.PLACES, 1], ['MEADOW', CATEGORY.PLACES, 1],
  ['QUARRY', CATEGORY.PLACES, 1], ['ORCHARD', CATEGORY.PLACES, 1],
  ['PENINSULA', CATEGORY.PLACES, 2], ['CATHEDRAL', CATEGORY.PLACES, 2],
  ['LIGHTHOUSE', CATEGORY.PLACES, 2], ['OBSERVATORY', CATEGORY.PLACES, 2],
  ['AQUEDUCT', CATEGORY.PLACES, 2], ['ESTUARY', CATEGORY.PLACES, 2],
  ['PLATEAU', CATEGORY.PLACES, 2], ['BOULEVARD', CATEGORY.PLACES, 2],

  // --- Science ---
  ['ATOM', CATEGORY.SCIENCE, 0], ['CELL', CATEGORY.SCIENCE, 0],
  ['ENERGY', CATEGORY.SCIENCE, 0], ['PLANET', CATEGORY.SCIENCE, 0],
  ['LIQUID', CATEGORY.SCIENCE, 0], ['MAGNET', CATEGORY.SCIENCE, 0],
  ['GRAVITY', CATEGORY.SCIENCE, 1], ['CIRCUIT', CATEGORY.SCIENCE, 1],
  ['NEUTRON', CATEGORY.SCIENCE, 1], ['MOLECULE', CATEGORY.SCIENCE, 1],
  ['PRESSURE', CATEGORY.SCIENCE, 1], ['SPECTRUM', CATEGORY.SCIENCE, 1],
  ['VELOCITY', CATEGORY.SCIENCE, 1], ['ISOTOPE', CATEGORY.SCIENCE, 1],
  ['CHROMOSOME', CATEGORY.SCIENCE, 2], ['CATALYST', CATEGORY.SCIENCE, 2],
  ['ENZYME', CATEGORY.SCIENCE, 2], ['QUANTUM', CATEGORY.SCIENCE, 2],
  ['VISCOSITY', CATEGORY.SCIENCE, 2], ['ALGORITHM', CATEGORY.SCIENCE, 2],
  ['CENTRIFUGE', CATEGORY.SCIENCE, 2], ['PHOTOSYNTHESIS', CATEGORY.SCIENCE, 2],

  // --- Around the house ---
  ['CHAIR', CATEGORY.HOUSE, 0], ['TABLE', CATEGORY.HOUSE, 0],
  ['WINDOW', CATEGORY.HOUSE, 0], ['KETTLE', CATEGORY.HOUSE, 0],
  ['MIRROR', CATEGORY.HOUSE, 0], ['CARPET', CATEGORY.HOUSE, 0],
  ['PILLOW', CATEGORY.HOUSE, 0], ['LADDER', CATEGORY.HOUSE, 0],
  ['CUPBOARD', CATEGORY.HOUSE, 1], ['BLANKET', CATEGORY.HOUSE, 1],
  ['CUSHION', CATEGORY.HOUSE, 1], ['TOASTER', CATEGORY.HOUSE, 1],
  ['CURTAIN', CATEGORY.HOUSE, 1], ['DRAWER', CATEGORY.HOUSE, 1],
  ['RADIATOR', CATEGORY.HOUSE, 1], ['SAUCEPAN', CATEGORY.HOUSE, 1],
  ['CHANDELIER', CATEGORY.HOUSE, 2], ['WARDROBE', CATEGORY.HOUSE, 2],
  ['MANTELPIECE', CATEGORY.HOUSE, 2], ['UPHOLSTERY', CATEGORY.HOUSE, 2],
  ['THERMOSTAT', CATEGORY.HOUSE, 2], ['BANNISTER', CATEGORY.HOUSE, 2],

  // --- Weather and nature ---
  ['RAIN', CATEGORY.WEATHER, 0], ['CLOUD', CATEGORY.WEATHER, 0],
  ['STORM', CATEGORY.WEATHER, 0], ['FROST', CATEGORY.WEATHER, 0],
  ['THUNDER', CATEGORY.WEATHER, 0], ['SUNSET', CATEGORY.WEATHER, 0],
  ['BREEZE', CATEGORY.WEATHER, 0], ['SHOWER', CATEGORY.WEATHER, 0],
  ['RAINBOW', CATEGORY.WEATHER, 1], ['DRIZZLE', CATEGORY.WEATHER, 1],
  ['BLIZZARD', CATEGORY.WEATHER, 1], ['MONSOON', CATEGORY.WEATHER, 1],
  ['LIGHTNING', CATEGORY.WEATHER, 1], ['HURRICANE', CATEGORY.WEATHER, 1],
  ['AVALANCHE', CATEGORY.WEATHER, 2], ['ATMOSPHERE', CATEGORY.WEATHER, 2],
  ['TWILIGHT', CATEGORY.WEATHER, 2], ['HUMIDITY', CATEGORY.WEATHER, 2],
  ['PERMAFROST', CATEGORY.WEATHER, 2], ['EQUINOX', CATEGORY.WEATHER, 2],
];

export const CATEGORIES = Object.values(CATEGORY);

/** Every word at or below a tier, optionally in one category. */
export function wordsFor(tier, category = null) {
  return WORDS.filter(([, cat, t]) => t <= tier && (category === null || cat === category));
}

/** Just the strings, which is what the solver filters. */
export const allWords = () => WORDS.map(([word]) => word);
