import type { AtlasAreaId } from '../../contracts/atlas';
import type { CurrencyId, ItemClass, MapBaseId, MonsterKind } from '../../contracts/content';
import type { MapEventKind } from '../../contracts/map-events';

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
  entranceKey?: CurrencyId;
  requiresBounty?: boolean;
  quantityMore?: number;
  currencyMultiplier?: number;
  bossLifeMultiplier?: number;
  bossDamageMultiplier?: number;
  echoWave?: boolean;
  noBoss?: boolean;
  eventMultiplier?: number;
  encounters?: readonly { kind: MapEventKind; wave: number }[];
  chosenClass?: boolean;
  /** This destination's named boss has a separate exclusive unique roll. */
  uniquePool?: MonsterKind;
}

export const ATLAS_START: AtlasAreaId = 'cinderCrossing';
export const ATLAS_REVEALS_PER_BOSS = 2;
export const ATLAS_RARE_DOOR_CHANCE = 1 / 8;
/** Per living player, multiplied by personal item rarity, capped at 100%. */
export const KEYSTONE_UNIQUE_CHANCE = 0.12;
export const RELIQUARY_KEY_CHANCE = { vault: 0.25, crypt: 0.08, elsewhere: 0.02, elsewhereMinTier: 3 } as const;
export const ATLAS_AREA_TYPE_LABELS: Record<AtlasAreaType, string> = {
  frontier: 'Frontier', forge: 'Forge', crypt: 'Crypt', arena: 'Arena', vault: 'Dead end', reliquary: 'Sealed area',
};

export const ATLAS_KEYS = [
  { currencyId: 'reliquaryKey', areaId: 'sealedReliquary', type: 'crypt', chance: 0.08, minTier: 3 },
  { currencyId: 'gildedKey', areaId: 'gildedVault', type: 'vault', chance: 0.12, minTier: 3 },
  { currencyId: 'blackKey', areaId: 'blackPit', type: 'forge', chance: 0.08, minTier: 3 },
  { currencyId: 'huntingKey', areaId: 'huntingGround', type: 'arena', chance: 0.08, minTier: 3 },
  { currencyId: 'riftKey', areaId: 'riftNexus', type: 'crypt', chance: 0.06, minTier: 5 },
] as const;
export const ATLAS_GLOBAL_KEY_CHANCE = 0.005;
export const ATLAS_GLOBAL_KEY_MIN_TIER = 8;
export function atlasKeyDestination(id: CurrencyId): AtlasAreaId | undefined {
  return ATLAS_KEYS.find(k => k.currencyId === id)?.areaId;
}

/** Normal edges are reciprocal. Sealed doors and dead ends never gate the deeper tier routes. */
export const ATLAS_AREAS: readonly AtlasAreaDef[] = [
  {
    id: 'cinderCrossing', name: 'Cinder Crossing', type: 'frontier', baseId: 'ashenForge', depth: 0,
    neighbours: ['emberRoad', 'boneApproach'], x: 5, y: 50,
    description: 'The frontier splits toward the forges and the frozen tombs.',
  },
  {
    id: 'emberRoad', name: 'Ember Road', type: 'forge', baseId: 'ashenForge', depth: 1,
    neighbours: ['cinderCrossing', 'emberVault', 'furnaceYard'], x: 15, y: 25,
    description: 'Fire essences and caster bases. The vault is a rewarding detour.',
    classWeights: { wand: 2, sceptre: 2, focus: 2 }, arenaScale: 0.95,
  },
  {
    id: 'boneApproach', name: 'Bone Approach', type: 'crypt', baseId: 'rimedOssuary', depth: 1,
    neighbours: ['cinderCrossing', 'glassSepulchre', 'ironMarch'], x: 15, y: 75,
    description: 'Frozen tombs favour jewellery and Rime Essences.',
    classWeights: { ring: 2, amulet: 2 },
  },
  {
    id: 'emberVault', name: 'Ember Vault', type: 'vault', baseId: 'cinderChapel', depth: 2, tierCeiling: 3,
    neighbours: ['emberRoad'], x: 25, y: 3, deadEnd: true, arenaScale: 0.8,
    description: 'A dead end for targeted crafting supplies. Its tier limit matches Ember Road.',
    currencyWeights: { essenceEmber: 2, seal: 3 },
    ingredientDrops: [{ currencyId: 'suffixRune', chance: 0.25, minTier: 3 }, { currencyId: 'transmute', chance: 0.15, minTier: 3 }],
  },
  {
    id: 'furnaceYard', name: 'Furnace Yard', type: 'forge', baseId: 'ashenForge', depth: 2,
    neighbours: ['emberRoad', 'shatteredForge', 'glassSepulchre'], x: 25, y: 25,
    description: 'Caster bases and Tempering Catalysts beyond the first furnaces.',
    classWeights: { wand: 2, sceptre: 2, focus: 2 }, currencyWeights: { catalyst: 2 }, arenaScale: 1.1,
  },
  {
    id: 'glassSepulchre', name: 'Glass Sepulchre', type: 'crypt', baseId: 'choralCrypt', depth: 2,
    neighbours: ['boneApproach', 'furnaceYard', 'hollowOssuary'], x: 25, y: 50,
    description: 'Jewellery and crafting Solvents, with a passage toward the furnaces.',
    classWeights: { ring: 2, amulet: 2 }, currencyWeights: { solvent: 2 }, arenaScale: 0.85,
    ingredientDrops: [{ currencyId: 'prefixRune', chance: 0.25, minTier: 3 }, { currencyId: 'scarBalm', chance: 0.15, minTier: 3 }],
  },
  {
    id: 'ironMarch', name: 'Iron March', type: 'arena', baseId: 'chainworks', depth: 2,
    neighbours: ['boneApproach', 'championsApproach', 'pitOfEchoes'], x: 25, y: 75,
    description: 'The Chainmaster’s factory favours armour and Fracture Cores, with more monsters and more drops.',
    classWeights: { helmet: 2, chest: 2, gloves: 2, boots: 2 }, currencyWeights: { fractureCore: 3 },
  },
  {
    id: 'shatteredForge', name: 'Shattered Forge', type: 'forge', baseId: 'ashenForge', depth: 3,
    neighbours: ['furnaceYard', 'crownFoundry', 'winterThrone'], x: 35, y: 20,
    description: 'Reforging Embers and caster bases. Both deep routes lie ahead.',
    classWeights: { wand: 2, sceptre: 2, focus: 2 }, currencyWeights: { reforge: 2 }, arenaScale: 1.05,
  },
  {
    id: 'championsApproach', name: "Champion's Approach", type: 'arena', baseId: 'ironColiseum', depth: 3,
    ingredientDrops: [{ currencyId: 'compass', chance: 0.20, minTier: 5 }],
    neighbours: ['ironMarch', 'winterThrone', 'crownFoundry'], x: 35, y: 75,
    description: 'Armour and Fracture Cores on the road to the deep territories.',
    classWeights: { helmet: 2, chest: 2, gloves: 2, boots: 2 }, currencyWeights: { fractureCore: 3 }, arenaScale: 0.9,
  },
  {
    id: 'crownFoundry', name: 'Crown Foundry', type: 'forge', baseId: 'ashenForge', depth: 4,
    uniquePool: 'cinderMatriarch',
    ingredientDrops: [{ currencyId: 'anneal', chance: 0.20, minTier: 5 }],
    neighbours: ['shatteredForge', 'championsApproach', 'emberCitadel'], x: 45, y: 20,
    description: 'Caster bases and Tempering Catalysts at the gateway to the deep citadel.',
    classWeights: { wand: 2, sceptre: 2, focus: 2 }, currencyWeights: { catalyst: 2 },
  },
  {
    id: 'winterThrone', name: 'Winter Throne', type: 'crypt', baseId: 'rimedOssuary', depth: 4,
    uniquePool: 'hollowWarden',
    ingredientDrops: [{ currencyId: 'graft', chance: 0.20, minTier: 5 }],
    neighbours: ['championsApproach', 'shatteredForge', 'frozenPassage'], x: 45, y: 75,
    description: 'High-level jewellery and preserving seals in the frozen depths.',
    classWeights: { ring: 2, amulet: 2 }, currencyWeights: { seal: 2 }, arenaScale: 1.1,
  },
  {
    id: 'sealedReliquary', name: 'Sealed Reliquary', type: 'reliquary', baseId: 'rimedOssuary', depth: 3,
    neighbours: [], x: 45, y: 50, sealed: true, arenaScale: 0.9, entranceKey: 'reliquaryKey',
    encounters: [{ kind: 'secondCrown', wave: 6 }],
    description: 'Two crowns guard the reliquary. Defeat both for one extra Unique (Rare at Tier 1) and a Crown Fragment, at every tier.',
  },
  {
    id: 'emberCitadel', name: 'Ember Citadel', type: 'forge', baseId: 'cinderChapel', depth: 5,
    uniquePool: 'ashboundHerald',
    neighbours: ['crownFoundry', 'frozenPassage', 'lastKiln'], x: 55, y: 20,
    description: 'A deep ritual city. Caster bases and fire essences, with a crossing toward the frozen route.',
    classWeights: { wand: 2, sceptre: 2, focus: 2 }, currencyWeights: { essenceEmber: 3 }, arenaScale: 1.1,
  },
  {
    id: 'frozenPassage', name: 'Frozen Passage', type: 'crypt', baseId: 'choralCrypt', depth: 5,
    uniquePool: 'boneChorister',
    neighbours: ['winterThrone', 'emberCitadel', 'echoBastion'], x: 55, y: 75,
    description: 'A sung passage between ancient tombs. Jewellery, Solvents and a crossing toward the citadel.',
    classWeights: { ring: 2, amulet: 2 }, currencyWeights: { solvent: 3 }, arenaScale: 1.05,
  },
  {
    id: 'lastKiln', name: 'The Last Kiln', type: 'forge', baseId: 'chainworks', depth: 6,
    uniquePool: 'chainmaster',
    neighbours: ['emberCitadel', 'echoBastion', 'heartOfForge'], x: 65, y: 20,
    description: 'Armour bases and Catalysts in the final working furnace. The bastion provides another approach.',
    classWeights: { helmet: 2, chest: 2, gloves: 2, boots: 2 }, currencyWeights: { catalyst: 3 }, arenaScale: 1.15,
  },
  {
    id: 'echoBastion', name: 'Echo Bastion', type: 'crypt', baseId: 'rimedOssuary', depth: 6,
    uniquePool: 'hollowWarden',
    neighbours: ['frozenPassage', 'lastKiln', 'eternalArena'], x: 65, y: 75,
    description: 'Binding Seals and jewellery beneath the last frozen battlements.',
    classWeights: { ring: 2, amulet: 2 }, currencyWeights: { seal: 3 }, arenaScale: 1.15,
  },
  {
    id: 'heartOfForge', name: 'Heart of the Forge', type: 'forge', baseId: 'ashenForge', depth: 7,
    uniquePool: 'cinderMatriarch',
    neighbours: ['lastKiln', 'eternalArena', 'shrineField'], x: 75, y: 20,
    description: 'The deepest forge accepts Tier 15 maps. Caster projects and Reforging Embers.',
    classWeights: { wand: 2, sceptre: 2, focus: 2 }, currencyWeights: { reforge: 3 },
  },
  {
    id: 'eternalArena', name: 'Eternal Arena', type: 'arena', baseId: 'ironColiseum', depth: 7,
    uniquePool: 'varkus',
    neighbours: ['echoBastion', 'heartOfForge'], x: 75, y: 75,
    description: 'The last champions guard the other Tier 15 approach. Armour and Fracture Cores.',
    classWeights: { helmet: 2, chest: 2, gloves: 2, boots: 2 }, currencyWeights: { fractureCore: 4 }, arenaScale: 1.1,
  },
  {
    id: 'hollowOssuary', name: 'Hollow Ossuary', type: 'crypt', baseId: 'rimedOssuary', depth: 3, tierCeiling: 5,
    neighbours: ['glassSepulchre'], x: 35, y: 50, deadEnd: true, quantityMore: 30,
    description: 'A jewellery detour: twice the ring and amulet weight, and 30% more item quantity.',
    classWeights: { ring: 2, amulet: 2 }, arenaScale: 0.85,
  },
  {
    id: 'pitOfEchoes', name: 'Pit of Echoes', type: 'arena', baseId: 'ironColiseum', depth: 3, tierCeiling: 5,
    neighbours: ['ironMarch'], x: 35, y: 98, deadEnd: true, requiresBounty: true, echoWave: true,
    bossLifeMultiplier: 1.5, bossDamageMultiplier: 1.25,
    description: 'Requires a Bounty map. The boss has 50% more life and 25% more damage; a seventh Echo wave follows with double kill quantity.',
  },
  {
    id: 'shrineField', name: 'Shrine Field', type: 'frontier', baseId: 'cinderChapel', depth: 8, tierCeiling: 15,
    neighbours: ['heartOfForge'], x: 85, y: 20, deadEnd: true, noBoss: true, eventMultiplier: 3,
    description: 'Six ordinary waves, no final boss. Encounter chances are tripled, capped at 100%. Clear the field to earn Atlas credit and the completion chest.',
  },
  {
    id: 'gildedVault', name: 'Gilded Vault', type: 'vault', baseId: 'chainworks', depth: 4,
    neighbours: [], x: 55, y: 50, sealed: true, entranceKey: 'gildedKey', currencyMultiplier: 3,
    encounters: [{ kind: 'vaultbreakers', wave: 2 }],
    description: 'Three fleeing carriers and triple ordinary currency drops, including boss and chest currency guarantees.',
  },
  {
    id: 'blackPit', name: 'Black Pit', type: 'forge', baseId: 'cinderChapel', depth: 5,
    neighbours: [], x: 65, y: 50, sealed: true, entranceKey: 'blackKey',
    encounters: [{ kind: 'blackout', wave: 2 }, { kind: 'wound', wave: 4 }],
    description: 'Restore three beacons, then face the Wound. Its final pack guarantees Twin Ink and a Void Splinter at every tier.',
  },
  {
    id: 'huntingGround', name: 'Hunting Ground', type: 'arena', baseId: 'ironColiseum', depth: 5,
    neighbours: [], x: 75, y: 50, sealed: true, entranceKey: 'huntingKey', chosenClass: true,
    encounters: [{ kind: 'hunted', wave: 2 }, { kind: 'hunted', wave: 3 }, { kind: 'hunted', wave: 4 }],
    description: 'Choose an equipment class before entry. Each of three rare hunters guarantees one Rare base of that class for every living player.',
  },
  {
    id: 'riftNexus', name: 'Rift Nexus', type: 'crypt', baseId: 'choralCrypt', depth: 6,
    neighbours: [], x: 85, y: 50, sealed: true, entranceKey: 'riftKey',
    encounters: [{ kind: 'echoRift', wave: 2 }, { kind: 'echoRift', wave: 3 }, { kind: 'echoRift', wave: 4 }],
    description: 'Three Echo Rifts in sequence. Each completed rift guarantees one event ingredient: Echo Shard, Twin Ink or Void Splinter, equally likely.',
  },
];

const BY_ID = new Map(ATLAS_AREAS.map((area) => [area.id, area]));
export function findAtlasArea(id: unknown): AtlasAreaDef | undefined {
  return typeof id === 'string' ? BY_ID.get(id as AtlasAreaId) : undefined;
}
export function atlasTierCeiling(area: AtlasAreaDef): number {
  return area.tierCeiling ?? Math.min(15, 1 + 2 * area.depth);
}
