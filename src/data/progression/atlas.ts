import type { AtlasAreaId } from '../../contracts/atlas';
import type { CurrencyId, ItemClass, MapBaseId } from '../../contracts/content';

export type AtlasAreaType = 'frontier' | 'forge' | 'crypt' | 'arena' | 'vault' | 'reliquary';
export interface AtlasAreaDef {
  id: AtlasAreaId;
  name: string;
  type: AtlasAreaType;
  baseId: MapBaseId;
  depth: number;
  /** Optional exception: a side destination keeps its entrance's tier ceiling. */
  tierCeiling?: number;
  neighbours: readonly AtlasAreaId[];
  /** Fixed atlas coordinates, used by the map-device graph. */
  x: number;
  y: number;
  description: string;
  /** Additional weights within drop tables, not more total drops. */
  currencyWeights?: Partial<Record<CurrencyId, number>>;
  /** Exclusive extra boss ingredients, rolled per living player. */
  ingredientDrops?: readonly { currencyId: CurrencyId; chance: number; minTier: number }[];
  classWeights?: Partial<Record<ItemClass, number>>;
  /** A sealed destination is revealed by the rare-door roll, never by ordinary neighbour discovery. */
  sealed?: boolean;
  deadEnd?: boolean;
  /** Theme-preserving arena variation. */
  arenaScale?: number;
}

export const ATLAS_START: AtlasAreaId = 'cinderCrossing';
export const ATLAS_REVEALS_PER_BOSS = 2;
export const ATLAS_RARE_DOOR_CHANCE = 1 / 8;
export const RELIQUARY_KEY_CHANCE = { vault: 0.25, crypt: 0.08, elsewhere: 0.02, elsewhereMinTier: 3 } as const;
export const ATLAS_AREA_TYPE_LABELS: Record<AtlasAreaType, string> = {
  frontier: 'Frontier', forge: 'Forge', crypt: 'Crypt', arena: 'Arena', vault: 'Dead end', reliquary: 'Sealed area',
};

/** Twelve hand-authored destinations. Normal edges are reciprocal; the sealed door never gates a route. */
export const ATLAS_AREAS: readonly AtlasAreaDef[] = [
  {
    id: 'cinderCrossing', name: 'Cinder Crossing', type: 'frontier', baseId: 'ashenForge', depth: 0,
    neighbours: ['emberRoad', 'boneApproach'], x: 8, y: 50,
    description: 'The frontier splits toward the forges and the frozen tombs.',
  },
  {
    id: 'emberRoad', name: 'Ember Road', type: 'forge', baseId: 'ashenForge', depth: 1,
    neighbours: ['cinderCrossing', 'emberVault', 'furnaceYard'], x: 25, y: 24,
    description: 'Fire essences and caster bases. The vault is a rewarding detour.',
    classWeights: { wand: 2, sceptre: 2, focus: 2 }, arenaScale: 0.95,
  },
  {
    id: 'boneApproach', name: 'Bone Approach', type: 'crypt', baseId: 'rimedOssuary', depth: 1,
    neighbours: ['cinderCrossing', 'glassSepulchre', 'ironMarch'], x: 25, y: 76,
    description: 'Frozen tombs favour jewellery and Rime Essences.',
    classWeights: { ring: 2, amulet: 2 },
  },
  {
    id: 'emberVault', name: 'Ember Vault', type: 'vault', baseId: 'cinderChapel', depth: 2, tierCeiling: 3,
    neighbours: ['emberRoad'], x: 41, y: 6, deadEnd: true, arenaScale: 0.8,
    description: 'A dead end for targeted crafting supplies. Its tier limit matches Ember Road.',
    currencyWeights: { essenceEmber: 2, seal: 3 },
    ingredientDrops: [{ currencyId: 'suffixRune', chance: 0.25, minTier: 3 }],
  },
  {
    id: 'furnaceYard', name: 'Furnace Yard', type: 'forge', baseId: 'ashenForge', depth: 2,
    neighbours: ['emberRoad', 'shatteredForge', 'glassSepulchre'], x: 44, y: 30,
    description: 'Caster bases and Tempering Catalysts beyond the first furnaces.',
    classWeights: { wand: 2, sceptre: 2, focus: 2 }, currencyWeights: { catalyst: 2 }, arenaScale: 1.1,
  },
  {
    id: 'glassSepulchre', name: 'Glass Sepulchre', type: 'crypt', baseId: 'choralCrypt', depth: 2,
    neighbours: ['boneApproach', 'furnaceYard'], x: 44, y: 56,
    description: 'Jewellery and crafting Solvents, with a passage toward the furnaces.',
    classWeights: { ring: 2, amulet: 2 }, currencyWeights: { solvent: 2 }, arenaScale: 0.85,
    ingredientDrops: [{ currencyId: 'prefixRune', chance: 0.25, minTier: 3 }],
  },
  {
    id: 'ironMarch', name: 'Iron March', type: 'arena', baseId: 'chainworks', depth: 2,
    neighbours: ['boneApproach', 'championsApproach'], x: 44, y: 84,
    description: 'The Chainmaster’s factory favours armour and Fracture Cores, with more monsters and more drops.',
    classWeights: { helmet: 2, chest: 2, gloves: 2, boots: 2 }, currencyWeights: { fractureCore: 3 },
  },
  {
    id: 'shatteredForge', name: 'Shattered Forge', type: 'forge', baseId: 'ashenForge', depth: 3,
    neighbours: ['furnaceYard', 'crownFoundry', 'winterThrone'], x: 65, y: 26,
    description: 'Reforging Embers and caster bases. Both deep routes lie ahead.',
    classWeights: { wand: 2, sceptre: 2, focus: 2 }, currencyWeights: { reforge: 2 }, arenaScale: 1.05,
  },
  {
    id: 'championsApproach', name: "Champion's Approach", type: 'arena', baseId: 'ironColiseum', depth: 3,
    neighbours: ['ironMarch', 'winterThrone', 'crownFoundry'], x: 65, y: 73,
    description: 'Armour and Fracture Cores on the road to the deep territories.',
    classWeights: { helmet: 2, chest: 2, gloves: 2, boots: 2 }, currencyWeights: { fractureCore: 3 }, arenaScale: 0.9,
  },
  {
    id: 'crownFoundry', name: 'Crown Foundry', type: 'forge', baseId: 'ashenForge', depth: 4,
    neighbours: ['shatteredForge', 'championsApproach'], x: 87, y: 24,
    description: 'The deepest foundry. High-level caster bases and Tempering Catalysts.',
    classWeights: { wand: 2, sceptre: 2, focus: 2 }, currencyWeights: { catalyst: 2 },
  },
  {
    id: 'winterThrone', name: 'Winter Throne', type: 'crypt', baseId: 'rimedOssuary', depth: 4,
    neighbours: ['championsApproach', 'shatteredForge'], x: 87, y: 76,
    description: 'High-level jewellery and preserving seals in the frozen depths.',
    classWeights: { ring: 2, amulet: 2 }, currencyWeights: { seal: 2 }, arenaScale: 1.1,
  },
  {
    id: 'sealedReliquary', name: 'Sealed Reliquary', type: 'reliquary', baseId: 'rimedOssuary', depth: 3,
    neighbours: [], x: 87, y: 50, sealed: true, arenaScale: 0.9,
    description: 'A rare sealed door. Each expedition costs one Reliquary Key. Its boss guarantees an extra Unique at Tier 2+, or a Rare at Tier 1.',
  },
];

const BY_ID = new Map(ATLAS_AREAS.map((area) => [area.id, area]));
export function findAtlasArea(id: unknown): AtlasAreaDef | undefined {
  return typeof id === 'string' ? BY_ID.get(id as AtlasAreaId) : undefined;
}
export function atlasTierCeiling(area: AtlasAreaDef): number {
  return area.tierCeiling ?? Math.min(15, 1 + 2 * area.depth);
}
