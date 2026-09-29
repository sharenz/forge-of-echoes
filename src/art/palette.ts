// The one palette every generated pixel comes from.
//
// The named groups in GAME_SPEC §10 are kept verbatim; everything else is a hue-shifted ramp step added so
// materials can be shaded in 3–6 steps: shadows drift cool (towards purple/blue), highlights drift warm
// (towards ochre/cream). Ember orange and hot white are reserved for small emissive focal points.

export const PALETTE = {
  // --- neutrals (spec) ---
  ink: '#0d0b0e',
  coal: '#1a1619',
  char: '#2a2326',
  iron: '#3b3438',
  stone: '#5a5057',
  stoneLight: '#7d7278',
  ashGrey: '#a0948d',
  bone: '#cbbfa8',
  parchment: '#e8dcc0',
  white: '#fbf4e6',

  // --- earth (spec) ---
  moss: '#4b5a3a',
  olive: '#6e7447',
  rust: '#7a3b24',
  blood: '#7a1e22',
  burgundy: '#5a1a2a',
  ochre: '#b8862f',
  gold: '#e0b04a',

  // --- emissive (spec) ---
  ember: '#e8662a',
  flame: '#ff9a3c',
  hot: '#ffe7a8',

  // --- elements (spec) ---
  frost: '#7fc6e8',
  ice: '#d4f1ff',
  mana: '#4a7bd6',
  storm: '#b9a6ff',
  lightning: '#efe9ff',
  void: '#7b3fa0',
  voidGlow: '#c07bff',

  // --- rarity (spec; runtime treatments only, never baked into sprites) ---
  rarityNormal: '#d8d2c4',
  rarityMagic: '#7aa2ff',
  rarityRare: '#f2d15c',
  rarityUnique: '#e8772e',
  rarityCurrency: '#c9b58a',
  rarityMap: '#d0d0dc',

  // --- ramp extensions ---
  // burgundy cloth (sorceress hood/mantle, banners)
  wineDeep: '#1c0a17',
  wineDark: '#34101f',
  wineMid: '#7a2433',
  wineLight: '#9c3a38',
  wineHi: '#bd5b44',
  // pale skin
  skinDeep: '#5b3a4c',
  skinShadow: '#8e6270',
  skin: '#d4ae9c',
  skinLight: '#efd5bf',
  // bone-white hair / bone
  hairShadow: '#6e6878',
  hairMid: '#9f97a0',
  // rust / leather / ochre
  rustDeep: '#2a1316',
  rustDark: '#4b2119',
  rustLight: '#9d5629',
  goldDark: '#6a4520',
  goldHi: '#f7dc8c',
  // blackened iron (cool)
  metalDeep: '#100d13',
  metalDark: '#1e1a22',
  metal: '#322d36',
  metalMid: '#4a4350',
  metalLight: '#6c6472',
  metalHi: '#9a919c',
  // wood
  woodDeep: '#1e1215',
  woodDark: '#3a2219',
  wood: '#5a3924',
  woodLight: '#7e5530',
  woodHi: '#a3763f',
  // straw / burlap
  strawDark: '#5b4524',
  straw: '#8c7036',
  strawLight: '#bb9a4d',
  strawHi: '#dcc277',
  // moss
  mossDeep: '#1a1f17',
  mossDark: '#2c3524',
  oliveLight: '#8d8a57',
  // ember / lava (mostly emissive)
  lavaDeep: '#3d0f12',
  lavaDark: '#9a2a1a',
  // frost / cold stone
  frostDeep: '#141a2e',
  frostDark: '#23355c',
  frostMid: '#3c5a8e',
  // ossuary stone (cool bone tiles)
  ossDeep: '#161922',
  ossDark: '#262b38',
  ossMid: '#3d4455',
  ossLight: '#5d677c',
  ossPale: '#8b97ab',
  ossFrost: '#c3d3e4',
  // void
  voidDeep: '#130b1c',
  voidDark: '#291540',
  voidMid: '#4d236c',
  voidLight: '#9d5ccc',
  voidHi: '#e6cbff',
  // basalt (ashen forge)
  basaltDeep: '#0f0c0f',
  basaltDark: '#191417',
  basalt: '#241d21',
  basaltLight: '#33292d',
  basaltHi: '#4a3c3d',
  // sand (iron coliseum)
  sandDeep: '#2e241f',
  sandDark: '#4a3a2c',
  sandDim: '#5b4834',
  sandMid: '#6d583f',
  sand: '#927652',
  sandLight: '#b39468',
  // warm flagstone (hideout)
  flagDeep: '#1b1517',
  flagDark: '#2d2427',
  flag: '#43383a',
  flagLight: '#5c4e4d',
  flagHi: '#7a6a63',
  // flask liquids / essences
  lifeDark: '#5a0f1a',
  life: '#b0222c',
  lifeLight: '#e8504a',
  vitalGreen: '#6fa35a',
  vitalDeep: '#2d4a2c',
  vitalMid: '#4a8a3e',
  vitalLight: '#a9dc86',
  swiftTeal: '#5ac8b4',
  swiftLight: '#b4ecd8',
  swiftDeep: '#1d4a4a',
  swiftMid: '#2f8f86',
  stormMid: '#7c6ad0',
  acid: '#a8c84a',
  acidDark: '#4a5a1e',
} as const;

export type PaletteName = keyof typeof PALETTE;

/** Packed colour 0xRRGGBBAA (unsigned). */
export type Color = number;

export function hexToColor(hex: string, alpha = 255): Color {
  const v = parseInt(hex.slice(1), 16);
  return ((v << 8) | (alpha & 255)) >>> 0;
}

/** Numeric palette: C.ember etc. */
export const C: Record<PaletteName, Color> = Object.fromEntries(
  Object.entries(PALETTE).map(([k, v]) => [k, hexToColor(v)]),
) as Record<PaletteName, Color>;

/** Dark → light colour ramps. Index 0 is the deepest shadow. */
export type Ramp = readonly Color[];

const ramp = (...names: PaletteName[]): Ramp => names.map((n) => C[n]);

export const RAMPS = {
  // cloth
  wine: ramp('wineDeep', 'wineDark', 'burgundy', 'wineMid', 'wineLight', 'wineHi'),
  robe: ramp('ink', 'coal', 'char', 'iron', 'stone'),
  // bodies
  skin: ramp('skinDeep', 'skinShadow', 'skin', 'skinLight'),
  hair: ramp('hairShadow', 'hairMid', 'bone', 'parchment'),
  bone: ramp('stone', 'stoneLight', 'ashGrey', 'bone', 'parchment'),
  ash: ramp('ink', 'coal', 'char', 'iron', 'stone', 'stoneLight'),
  cinder: ramp('ink', 'coal', 'char', 'rustDeep', 'iron', 'stone'),
  // materials
  metal: ramp('metalDeep', 'metalDark', 'metal', 'metalMid', 'metalLight', 'metalHi'),
  rust: ramp('rustDeep', 'rustDark', 'rust', 'rustLight', 'ochre'),
  gold: ramp('goldDark', 'ochre', 'gold', 'goldHi'),
  wood: ramp('woodDeep', 'woodDark', 'wood', 'woodLight', 'woodHi'),
  straw: ramp('strawDark', 'straw', 'strawLight', 'strawHi'),
  stone: ramp('coal', 'char', 'iron', 'stone', 'stoneLight', 'ashGrey'),
  flag: ramp('flagDeep', 'flagDark', 'flag', 'flagLight', 'flagHi'),
  basalt: ramp('basaltDeep', 'basaltDark', 'basalt', 'basaltLight', 'basaltHi'),
  oss: ramp('ossDeep', 'ossDark', 'ossMid', 'ossLight', 'ossPale', 'ossFrost'),
  sand: ramp('sandDeep', 'sandDark', 'sandMid', 'sand', 'sandLight'),
  moss: ramp('mossDeep', 'mossDark', 'moss', 'olive', 'oliveLight'),
  parchment: ramp('goldDark', 'ochre', 'bone', 'parchment', 'white'),
  // energy (emissive)
  ember: ramp('lavaDeep', 'blood', 'lavaDark', 'ember', 'flame', 'hot', 'white'),
  frost: ramp('frostDeep', 'frostDark', 'frostMid', 'mana', 'frost', 'ice', 'white'),
  void: ramp('voidDeep', 'voidDark', 'voidMid', 'void', 'voidLight', 'voidGlow', 'voidHi'),
  storm: ramp('voidDark', 'voidMid', 'mana', 'storm', 'lightning', 'white'),
  life: ramp('wineDeep', 'lifeDark', 'blood', 'life', 'lifeLight', 'hot'),
  vital: ramp('mossDeep', 'vitalDeep', 'moss', 'vitalGreen', 'oliveLight', 'hot'),
  swift: ramp('frostDeep', 'swiftDeep', 'frostMid', 'swiftTeal', 'ice', 'white'),
  acid: ramp('mossDeep', 'acidDark', 'olive', 'acid', 'hot'),
} as const satisfies Record<string, Ramp>;

export type RampName = keyof typeof RAMPS;
