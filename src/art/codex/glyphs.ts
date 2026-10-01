// Codex glyph grammar (brief A, 8.2): about 40 small vector-ish primitives (discs, rings, polygons, thick lines) in unit
// space, rasterised at any size into a 1-bit mask and shaded as a relief (lit top-left edge, dark bottom-right edge).
// One mask function serves the 9 px small-node glyph and the 15 px keystone glyph; recolouring happens in plates.ts.
import type { AtlasNode } from '../../data/progression/atlas-tree/types';

type Pt = readonly [number, number];
type Prim =
  | { k: 'disc'; x: number; y: number; r: number; cut?: boolean }
  | { k: 'ring'; x: number; y: number; r: number; w: number; cut?: boolean }
  | { k: 'poly'; p: readonly Pt[]; cut?: boolean }
  | { k: 'line'; a: Pt; b: Pt; w: number; cut?: boolean }
  | { k: 'rect'; x: number; y: number; w: number; h: number; cut?: boolean };

const disc = (x: number, y: number, r: number, cut = false): Prim => ({ k: 'disc', x, y, r, cut });
const ring = (x: number, y: number, r: number, w: number, cut = false): Prim => ({ k: 'ring', x, y, r, w, cut });
const poly = (p: readonly Pt[], cut = false): Prim => ({ k: 'poly', p, cut });
const line = (a: Pt, b: Pt, w: number, cut = false): Prim => ({ k: 'line', a, b, w, cut });
const rect = (x: number, y: number, w: number, h: number, cut = false): Prim => ({ k: 'rect', x, y, w, h, cut });
const star = (cx: number, cy: number, r1: number, r2: number, n: number, rot = -Math.PI / 2): Pt[] =>
  Array.from({ length: n * 2 }, (_, i) => { const r = i % 2 ? r2 : r1, a = rot + (i * Math.PI) / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt; });
const spokes = (cx: number, cy: number, r0: number, r1: number, n: number, w: number, rot = 0): Prim[] =>
  Array.from({ length: n }, (_, i) => { const a = rot + (i * Math.PI * 2) / n; return line([cx + Math.cos(a) * r0, cy + Math.sin(a) * r0], [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1], w); });

export const GLYPHS = {
  map: [rect(0.1, 0.2, 0.8, 0.6), line([0.37, 0.2], [0.37, 0.8], 0.07, true), line([0.63, 0.2], [0.63, 0.8], 0.07, true), disc(0.5, 0.5, 0.07, true)],
  compass: [ring(0.5, 0.5, 0.42, 0.12), poly([[0.5, 0.16], [0.62, 0.5], [0.5, 0.84], [0.38, 0.5]]), disc(0.5, 0.5, 0.06, true)],
  coin: [ring(0.5, 0.5, 0.44, 0.2), disc(0.5, 0.5, 0.16)],
  eye: [poly([[0.04, 0.5], [0.26, 0.28], [0.5, 0.2], [0.74, 0.28], [0.96, 0.5], [0.74, 0.72], [0.5, 0.8], [0.26, 0.72]]), disc(0.5, 0.5, 0.22, true), disc(0.5, 0.5, 0.11)],
  drop: [poly([[0.5, 0.04], [0.68, 0.36], [0.8, 0.6], [0.72, 0.82], [0.5, 0.95], [0.28, 0.82], [0.2, 0.6], [0.32, 0.36]])],
  flame: [poly([[0.5, 0.03], [0.66, 0.28], [0.84, 0.55], [0.76, 0.85], [0.5, 0.97], [0.24, 0.85], [0.16, 0.55], [0.3, 0.42], [0.4, 0.55], [0.42, 0.3]]), poly([[0.5, 0.6], [0.6, 0.78], [0.5, 0.9], [0.4, 0.78]], true)],
  gear: [disc(0.5, 0.5, 0.32), ...Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return line([0.5 + Math.cos(a) * 0.28, 0.5 + Math.sin(a) * 0.28], [0.5 + Math.cos(a) * 0.46, 0.5 + Math.sin(a) * 0.46], 0.2); }), disc(0.5, 0.5, 0.12, true)],
  skull: [disc(0.5, 0.42, 0.38), rect(0.3, 0.6, 0.4, 0.34), disc(0.35, 0.44, 0.1, true), disc(0.65, 0.44, 0.1, true), rect(0.46, 0.58, 0.08, 0.12, true), line([0.42, 0.78], [0.42, 0.94], 0.05, true), line([0.58, 0.78], [0.58, 0.94], 0.05, true)],
  star: [poly(star(0.5, 0.54, 0.5, 0.21, 5))],
  crown: [poly([[0.06, 0.8], [0.06, 0.26], [0.3, 0.5], [0.5, 0.14], [0.7, 0.5], [0.94, 0.26], [0.94, 0.8]]), rect(0.06, 0.72, 0.88, 0.14), disc(0.5, 0.55, 0.05, true)],
  key: [ring(0.3, 0.3, 0.24, 0.16), line([0.44, 0.44], [0.86, 0.86], 0.14), line([0.7, 0.7], [0.58, 0.82], 0.12), line([0.82, 0.82], [0.7, 0.94], 0.12)],
  chain: [ring(0.33, 0.5, 0.26, 0.12), ring(0.67, 0.5, 0.26, 0.12)],
  hourglass: [poly([[0.2, 0.06], [0.8, 0.06], [0.8, 0.14], [0.56, 0.5], [0.8, 0.86], [0.8, 0.94], [0.2, 0.94], [0.2, 0.86], [0.44, 0.5], [0.2, 0.14]])],
  chest: [rect(0.08, 0.36, 0.84, 0.54), poly([[0.08, 0.36], [0.16, 0.14], [0.84, 0.14], [0.92, 0.36]]), line([0.1, 0.4], [0.9, 0.4], 0.05, true), disc(0.5, 0.56, 0.09, true)],
  anvil: [poly([[0.04, 0.22], [0.96, 0.22], [0.86, 0.44], [0.62, 0.5], [0.68, 0.74], [0.86, 0.84], [0.86, 0.96], [0.14, 0.96], [0.14, 0.84], [0.32, 0.74], [0.38, 0.5], [0.14, 0.44]])],
  scarab: [disc(0.5, 0.6, 0.3), disc(0.5, 0.25, 0.16), line([0.27, 0.5], [0.08, 0.38], 0.09), line([0.73, 0.5], [0.92, 0.38], 0.09), line([0.24, 0.68], [0.06, 0.74], 0.09), line([0.76, 0.68], [0.94, 0.74], 0.09), line([0.5, 0.36], [0.5, 0.9], 0.05, true)],
  bloom: [...[0, 1, 2, 3, 4].map((i) => disc(0.5 + Math.cos(-Math.PI / 2 + (i * Math.PI * 2) / 5) * 0.27, 0.5 + Math.sin(-Math.PI / 2 + (i * Math.PI * 2) / 5) * 0.27, 0.21)), disc(0.5, 0.5, 0.1, true)],
  bell: [poly([[0.5, 0.06], [0.68, 0.18], [0.72, 0.52], [0.92, 0.78], [0.08, 0.78], [0.28, 0.52], [0.32, 0.18]]), disc(0.5, 0.88, 0.1)],
  paw: [disc(0.5, 0.66, 0.24), disc(0.18, 0.44, 0.12), disc(0.38, 0.24, 0.12), disc(0.62, 0.24, 0.12), disc(0.82, 0.44, 0.12)],
  hook: [line([0.62, 0.06], [0.62, 0.6], 0.16), ring(0.4, 0.62, 0.24, 0.16), rect(0.05, 0.3, 0.4, 0.36, true), disc(0.62, 0.06, 0.09, true)],
  snowflake: [...spokes(0.5, 0.5, 0, 0.47, 6, 0.1, Math.PI / 2), disc(0.5, 0.5, 0.13), ...[0, 1, 2, 3, 4, 5].map((i) => disc(0.5 + Math.cos((i * Math.PI) / 3 + Math.PI / 6) * 0.3, 0.5 + Math.sin((i * Math.PI) / 3 + Math.PI / 6) * 0.3, 0.09))],
  ring: [ring(0.5, 0.58, 0.34, 0.18), poly([[0.5, 0.06], [0.68, 0.2], [0.5, 0.34], [0.32, 0.2]])],
  blades: [line([0.12, 0.88], [0.86, 0.14], 0.12), line([0.88, 0.88], [0.14, 0.14], 0.12), line([0.2, 0.5], [0.44, 0.74], 0.1), line([0.8, 0.5], [0.56, 0.74], 0.1)],
  shield: [poly([[0.12, 0.08], [0.88, 0.08], [0.88, 0.52], [0.5, 0.96], [0.12, 0.52]]), poly([[0.28, 0.24], [0.72, 0.24], [0.72, 0.48], [0.5, 0.74], [0.28, 0.48]], true)],
  hammer: [rect(0.1, 0.1, 0.8, 0.3), line([0.5, 0.4], [0.5, 0.94], 0.16)],
  bolt: [poly([[0.62, 0.02], [0.18, 0.56], [0.46, 0.56], [0.36, 0.98], [0.84, 0.4], [0.54, 0.4]])],
  moon: [disc(0.5, 0.5, 0.44), disc(0.68, 0.4, 0.36, true)],
  tower: [rect(0.22, 0.32, 0.56, 0.64), rect(0.22, 0.1, 0.14, 0.26), rect(0.43, 0.1, 0.14, 0.26), rect(0.64, 0.1, 0.14, 0.26), rect(0.42, 0.64, 0.16, 0.32, true), disc(0.5, 0.64, 0.08, true)],
  horn: [poly([[0.06, 0.66], [0.1, 0.42], [0.32, 0.24], [0.62, 0.16], [0.94, 0.08], [0.84, 0.4], [0.62, 0.62], [0.36, 0.8], [0.14, 0.86]]), disc(0.16, 0.74, 0.1)],
  wave: [line([0.04, 0.34], [0.26, 0.16], 0.12), line([0.26, 0.16], [0.5, 0.34], 0.12), line([0.5, 0.34], [0.74, 0.16], 0.12), line([0.74, 0.16], [0.96, 0.34], 0.12),
    line([0.04, 0.72], [0.26, 0.54], 0.12), line([0.26, 0.54], [0.5, 0.72], 0.12), line([0.5, 0.72], [0.74, 0.54], 0.12), line([0.74, 0.54], [0.96, 0.72], 0.12)],
  padlock: [rect(0.2, 0.46, 0.6, 0.46), ring(0.5, 0.36, 0.24, 0.12), disc(0.5, 0.62, 0.08, true), rect(0.47, 0.62, 0.06, 0.16, true)],
  stack: [rect(0.12, 0.62, 0.76, 0.2), rect(0.18, 0.4, 0.64, 0.2), rect(0.26, 0.18, 0.48, 0.2)],
  sun: [disc(0.5, 0.5, 0.24), ...spokes(0.5, 0.5, 0.34, 0.5, 8, 0.1)],
  heart: [disc(0.32, 0.34, 0.24), disc(0.68, 0.34, 0.24), poly([[0.1, 0.44], [0.9, 0.44], [0.5, 0.92]])],
  sword: [line([0.16, 0.84], [0.8, 0.2], 0.14), line([0.3, 0.44], [0.56, 0.7], 0.12), poly([[0.8, 0.2], [0.94, 0.06], [0.94, 0.2], [0.8, 0.34]])],
  swarm: [disc(0.24, 0.3, 0.14), disc(0.72, 0.24, 0.14), disc(0.46, 0.5, 0.14), disc(0.2, 0.74, 0.14), disc(0.76, 0.72, 0.14)],
  chevrons: [poly([[0.04, 0.14], [0.42, 0.5], [0.04, 0.86], [0.04, 0.64], [0.2, 0.5], [0.04, 0.36]]), poly([[0.5, 0.14], [0.94, 0.5], [0.5, 0.86], [0.5, 0.64], [0.68, 0.5], [0.5, 0.36]])],
  vial: [poly([[0.38, 0.06], [0.62, 0.06], [0.62, 0.36], [0.9, 0.9], [0.1, 0.9], [0.38, 0.36]]), line([0.24, 0.66], [0.76, 0.66], 0.06, true)],
  seal: [disc(0.5, 0.5, 0.46), poly(star(0.5, 0.52, 0.28, 0.12, 5), true)],
  spiral: [ring(0.5, 0.5, 0.44, 0.13), ring(0.5, 0.5, 0.2, 0.13), rect(0.5, 0.02, 0.5, 0.3, true), disc(0.5, 0.5, 0.05, true)],
  diamond: [poly([[0.5, 0.04], [0.92, 0.5], [0.5, 0.96], [0.08, 0.5]]), poly([[0.5, 0.28], [0.7, 0.5], [0.5, 0.72], [0.3, 0.5]], true)],
  cracked: [disc(0.5, 0.5, 0.44), line([0.5, 0.06], [0.4, 0.34], 0.07, true), line([0.4, 0.34], [0.58, 0.54], 0.07, true), line([0.58, 0.54], [0.44, 0.94], 0.07, true)],
  hand: [rect(0.2, 0.44, 0.6, 0.48), line([0.28, 0.44], [0.28, 0.1], 0.13), line([0.46, 0.44], [0.46, 0.04], 0.13), line([0.64, 0.44], [0.64, 0.08], 0.13), line([0.78, 0.5], [0.94, 0.3], 0.13)],
  fist: [rect(0.16, 0.3, 0.68, 0.6), line([0.3, 0.3], [0.3, 0.14], 0.14), line([0.5, 0.3], [0.5, 0.1], 0.14), line([0.7, 0.3], [0.7, 0.14], 0.14), line([0.2, 0.62], [0.8, 0.62], 0.04, true)],
} as const satisfies Record<string, readonly Prim[]>;
export type GlyphId = keyof typeof GLYPHS;
export const GLYPH_IDS = Object.keys(GLYPHS) as GlyphId[];

function inPoly(p: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(x: number, y: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
  return Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
}
function hit(p: Prim, x: number, y: number, minW: number): boolean {
  switch (p.k) {
    case 'disc': return Math.hypot(x - p.x, y - p.y) <= Math.max(p.r, minW * 0.5);
    case 'ring': { const d = Math.hypot(x - p.x, y - p.y); return d <= p.r && d >= p.r - Math.max(p.w, minW); }
    case 'poly': return inPoly(p.p, x, y);
    case 'line': return segDist(x, y, p.a, p.b) <= Math.max(p.w, minW) / 2;
    case 'rect': return x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;
  }
}

const maskCache = new Map<string, Uint8Array>();
/** 1-bit coverage mask of a glyph at n x n (cached). Strokes never get thinner than a pixel. */
export function glyphMask(id: GlyphId, n: number): Uint8Array {
  const key = `${id}|${n}`;
  let m = maskCache.get(key);
  if (m) return m;
  m = new Uint8Array(n * n);
  const prims = GLYPHS[id] as readonly Prim[];
  const minW = 1 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const ux = (x + 0.5) / n, uy = (y + 0.5) / n;
    let on = false;
    for (const p of prims) if (hit(p, ux, uy, minW)) on = !p.cut;
    m[y * n + x] = on ? 1 : 0;
  }
  maskCache.set(key, m);
  return m;
}

// ---- which glyph a node wears ----------------------------------------------------------------------------
const BY_ID: Record<string, GlyphId> = {
  // keystones
  wageredCharts: 'chest', twinnedSockets: 'scarab', deadEndDevotee: 'tower',
  singleMindedFurnace: 'flame', blankSlate: 'anvil',
  rareOrNothing: 'skull', emptyHalls: 'hand',
  kingslayersTithe: 'crown', earlyCrown: 'hourglass',
  twinOmens: 'spiral', swornToTheVeil: 'eye',
  thrillOfTheHex: 'bolt', voidtouchedAtlas: 'seal', overrunDoctrine: 'chevrons',
  // event lenses
  hunterPatience: 'paw', resonantRift: 'spiral', quickFingers: 'key', crownRivalry: 'crown', faultWalker: 'cracked', keeperOfTheFlame: 'flame',
  pactBroker: 'hand', greenThumb: 'bloom', ringmaster: 'fist', thawWarden: 'snowflake', anvilBlessing: 'anvil', bellringer: 'bell',
  // notables that deserve their own face
  chartKeeper: 'compass', farHorizon: 'sun', masterSurveyor: 'eye', lanternBearer: 'hourglass', fifthSocket: 'scarab',
  soundFoundations: 'tower', deepSeams: 'vial', steadyAnvil: 'anvil', ingredientHunter: 'vial', cataloguersShelf: 'chest',
  rareBlood: 'skull', fatPacks: 'swarm', elderBlood: 'star', wardedHunts: 'shield',
  crownedChallenge: 'crown', kingmakersCache: 'chest', gildedInstinct: 'star', deepPockets: 'coin', lodestone: 'diamond',
  hexSculptor: 'flame', riptide: 'wave', voidTithe: 'seal',
  risingStakes: 'coin', deepeningWealth: 'star', higherGround: 'tower', longShadow: 'moon', laddersReward: 'chest',
};
const BY_STAT: Record<string, GlyphId> = {
  mapDropChance: 'map', scarabDropChance: 'scarab', territoryFee: 'coin', droppedMapQuality: 'compass', chestQuality: 'compass',
  itemQuantity: 'coin', itemRarity: 'star', normalQuantity: 'coin', rareQuantity: 'skull',
  chestUpgradeChance: 'chest', chestLoot: 'chest', chestCurrency: 'chest', chestRareChance: 'chest',
  bossLoot: 'crown', bossLife: 'crown', bossUnique: 'crown', bossIngredientChance: 'vial', revealChance: 'eye',
  packRarity: 'skull', magicPackChance: 'skull', rarePackChance: 'skull',
  monsterCount: 'swarm', monsterLife: 'heart', monsterDamage: 'blades', monsterSpeed: 'chevrons', monsterResist: 'shield', playerResist: 'shield', playerFocusRegen: 'moon',
  monsterProjectiles: 'blades', hazards: 'flame',
  essenceDropChance: 'vial', emberEssenceChance: 'flame', rimeEssenceChance: 'snowflake',
  armourStability: 'tower', equipmentStability: 'tower', equipmentDropChance: 'anvil',
  eventChance: 'spiral', echoWave: 'spiral', waveDuration: 'hourglass', surgeCharges: 'hourglass', surgeKeep: 'hourglass', sandChance: 'hourglass', dangerModStrength: 'flame', corruptedModStrength: 'seal',
};
const BY_CURRENCY: Record<string, GlyphId> = {
  seal: 'seal', scrap: 'gear', solvent: 'drop', catalyst: 'vial', fractureCore: 'cracked', kindlingShard: 'flame', reforgingEmber: 'hammer', mapDust: 'sun',
  emberEssence: 'flame', rimeEssence: 'snowflake',
};
const BY_RULE: Record<string, GlyphId> = {
  bossWave: 'hourglass', equipmentNormalOnly: 'anvil', scarabSockets: 'scarab', scarabSameFamily: 'scarab', scarabKeepChance: 'scarab',
  essenceAttunement: 'flame', chestMapWager: 'chest', wardedRares: 'shield', stragglerBounty: 'paw', eventLens: 'spiral', eventSlots: 'spiral',
  eventsAlways: 'eye', voidBreach: 'seal', eventSmall: 'spiral',
};

export function glyphFor(node: Pick<AtlasNode, 'id' | 'kind' | 'effects' | 'rules'>): GlyphId {
  const own = BY_ID[node.id];
  if (own) return own;
  const rule = node.rules[0] as { id: string; currencies?: readonly string[] } | undefined;
  if (rule?.id === 'currencyWeight' && rule.currencies?.length) return BY_CURRENCY[rule.currencies[0]] ?? 'coin';
  const stat = node.effects[0]?.stat;
  if (stat && BY_STAT[stat]) return BY_STAT[stat];
  if (rule && BY_RULE[rule.id]) return BY_RULE[rule.id];
  return node.kind === 'keystone' ? 'crown' : node.kind === 'event' ? 'spiral' : node.kind === 'theme' ? 'seal' : 'diamond';
}
