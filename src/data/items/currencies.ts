// Currency definitions (GAME_SPEC §6–§7): equipment/map crafting materials and Atlas entrance keys.
// Descriptions are verb-first and describe exactly what the rules do.
import type { CurrencyId } from '../../contracts/content';
import { CURRENCY_STACK, RARE_CURRENCY_STACK } from './rules';
import type { CurrencyDef } from './types';
import { SCARABS } from '../scarabs';
import type { ScarabId } from '../../contracts/content';

type Spec = Omit<CurrencyDef, 'id' | 'maxStack'> & { maxStack?: number };

function currency(id: CurrencyId, spec: Spec): CurrencyDef {
  return { id, maxStack: CURRENCY_STACK, ...spec };
}

function essence(id: CurrencyId, name: string, tags: CurrencyDef['essenceTags'], label: string): CurrencyDef {
  return currency(id, {
    name,
    description: `Adds one ${label} affix. A Normal item becomes Magic; a Magic item with two affixes becomes Rare.`,
    family: 'shape',
    stabilityCost: 2,
    needsAffixChoice: false,
    essenceTags: tags,
    essenceLabel: label,
    dropTier: 'uncommon',
  });
}

export const CURRENCIES: Record<CurrencyId, CurrencyDef> = {
  ...Object.fromEntries(SCARABS.map(s => [s.id, currency(s.id, {
    name: s.name, description: `${s.description} Place in a Map Device scarab socket; consumed when the map opens. Drops from monster level ${s.minMonsterLevel}+. Higher-level monsters can also drop lower tiers.`,
    family: 'map', stabilityCost: 0, needsAffixChoice: false, maxStack: 20, dropTier: 'rare',
  })])) as Record<ScarabId, CurrencyDef>,
  kindling: currency('kindling', {
    name: 'Kindling Shard',
    description: 'Awakens a Normal item into a Magic item with 1–2 random affixes.',
    family: 'shape',
    stabilityCost: 1,
    needsAffixChoice: false,
    dropTier: 'common',
  }),
  scrap: currency('scrap', {
    name: 'Forge Scrap',
    description: 'Rerolls the values of all unsealed, unfractured affixes within their tiers. Also the coin of Rook’s stall.',
    family: 'shape',
    stabilityCost: 1,
    needsAffixChoice: false,
    dropTier: 'common',
  }),
  reforge: currency('reforge', {
    name: 'Reforging Ember',
    description: 'Reforges all unsealed, unfractured affixes into a new Rare item with 3–6 affixes.',
    family: 'shape',
    stabilityCost: 2,
    needsAffixChoice: false,
    dropTier: 'uncommon',
  }),
  essenceEmber: essence('essenceEmber', 'Ember Essence', ['fire'], 'fire'),
  essenceRime: essence('essenceRime', 'Rime Essence', ['cold'], 'cold'),
  essenceStorm: essence('essenceStorm', 'Storm Essence', ['lightning'], 'lightning'),
  essenceVital: essence('essenceVital', 'Vital Essence', ['life', 'defense', 'resistance'], 'life, defence or resistance'),
  essenceSwift: essence('essenceSwift', 'Swift Essence', ['speed'], 'speed'),
  catalyst: currency('catalyst', {
    name: 'Tempering Catalyst',
    description: 'Upgrades a chosen affix by one tier, if the item level allows, and rerolls its value in the new tier.',
    family: 'refine',
    stabilityCost: 3,
    needsAffixChoice: true,
    dropTier: 'rare',
  }),
  solvent: currency('solvent', {
    name: 'Forge Solvent',
    description: 'Removes the lowest-tier unsealed, unfractured affix; ties are broken at random. An item with no affixes left becomes Normal.',
    family: 'remove',
    stabilityCost: 1,
    needsAffixChoice: false,
    dropTier: 'uncommon',
  }),
  seal: currency('seal', {
    name: 'Binding Seal',
    description: 'Seals a chosen affix, protecting it from the next crafting operation. Then the seal breaks.',
    family: 'preserve',
    stabilityCost: 0,
    needsAffixChoice: true,
    dropTier: 'uncommon',
  }),
  fractureCore: currency('fractureCore', {
    name: 'Fracture Core',
    description: 'Fractures a chosen affix, making it permanent and immune to all crafting. One fracture per item.',
    family: 'transform',
    stabilityCost: 3,
    needsAffixChoice: true,
    maxStack: RARE_CURRENCY_STACK,
    dropTier: 'rare',
  }),
  prefixRune: currency('prefixRune', {
    name: 'Prefix Rune',
    description: 'Reforges the unsealed, unfractured prefixes, preserving their count and every suffix. Found from the Glass Sepulchre boss on Tier 3+ maps (25% chance).',
    family: 'shape', stabilityCost: 3, needsAffixChoice: false, maxStack: RARE_CURRENCY_STACK, dropTier: 'rare',
  }),
  suffixRune: currency('suffixRune', {
    name: 'Suffix Rune',
    description: 'Reforges the unsealed, unfractured suffixes, preserving their count and every prefix. Found from the Ember Vault boss on Tier 3 maps (25% chance).',
    family: 'shape', stabilityCost: 3, needsAffixChoice: false, maxStack: RARE_CURRENCY_STACK, dropTier: 'rare',
  }),
  scarBalm: currency('scarBalm', {
    name: "Scar Balm",
    description: "Removes the oldest scar. Preserves affixes, seals and Stability; works on Finished equipment. Found from the Glass Sepulchre boss on Tier 3+ maps (15%).",
    family: 'remove', stabilityCost: 0, needsAffixChoice: false, maxStack: RARE_CURRENCY_STACK, dropTier: 'rare',
  }),
  anneal: currency('anneal', {
    name: "Anneal",
    description: "Sacrifices 1 maximum Stability permanently, then restores Stability to that new maximum. Preserves scars, seals and affixes. Found from the Crown Foundry boss on Tier 5+ maps (20%).",
    family: 'refine', stabilityCost: 0, needsAffixChoice: false, maxStack: RARE_CURRENCY_STACK, dropTier: 'rare',
  }),
  graft: currency('graft', {
    name: "Graft",
    description: "Replaces a chosen unsealed, unfractured affix with a different family of the same prefix/suffix type and tier. Preserves all other affixes. Found from the Winter Throne boss on Tier 5+ maps (20%).",
    family: 'transform', stabilityCost: 3, needsAffixChoice: true, maxStack: RARE_CURRENCY_STACK, dropTier: 'rare',
  }),
  transmute: currency('transmute', {
    name: "Transmute",
    description: "Changes equipment into a different compatible base of the same class and rerolls its implicit. Preserves affixes, scars and lifetime crafting costs. Unequip the item first. Found from the Ember Vault boss on Tier 3 maps (15%).",
    family: 'transform', stabilityCost: 3, needsAffixChoice: false, maxStack: RARE_CURRENCY_STACK, dropTier: 'rare',
  }),
  echoShard: currency('echoShard', {
    name: "Echo Shard",
    description: "Rerolls each unsealed, unfractured affix value twice and keeps the higher new roll. Values can still fall. Found from Echo Rifts on Tier 3+ maps (50%).",
    family: 'refine', stabilityCost: 2, needsAffixChoice: false, maxStack: RARE_CURRENCY_STACK, dropTier: 'rare',
  }),
  crownFragment: currency('crownFragment', {
    name: "Crown Fragment",
    description: "Rerolls a Unique item’s numeric modifiers within their ranges. Preserves its base implicit, identity and special behaviour. Guaranteed from Second Crown encounters on Tier 5+ maps.",
    family: 'refine', stabilityCost: 0, needsAffixChoice: false, maxStack: RARE_CURRENCY_STACK, dropTier: 'rare',
  }),
  compass: currency('compass', {
    name: "Compass",
    description: "Charts a map: its completion chest guarantees a map one tier higher, up to Tier 15. Found from the Champion’s Approach boss on Tier 5+ maps (20%).",
    family: 'map', stabilityCost: 0, needsAffixChoice: false, maxStack: RARE_CURRENCY_STACK, dropTier: 'rare',
  }),
  twinInk: currency('twinInk', {
    name: "Twin Ink",
    description: "Adds a second distinct reward-only mod to a map that already has one. Found from each Vaultbreaker carrier on Tier 3+ maps (20%).",
    family: 'map', stabilityCost: 0, needsAffixChoice: false, maxStack: RARE_CURRENCY_STACK, dropTier: 'rare',
  }),
  voidSplinter: currency('voidSplinter', {
    name: "Void Splinter",
    description: "Removes a map’s corruption and every corruption-marked mod. All quality is lost; tier and ordinary mods remain. Guaranteed from the Wound on Tier 3+ maps.",
    family: 'map', stabilityCost: 0, needsAffixChoice: false, maxStack: RARE_CURRENCY_STACK, dropTier: 'rare',
  }),
  mapDust: currency('mapDust', {
    name: 'Map Dust',
    description: 'Turns a Normal map Magic with 1–2 mods, or rerolls the mods of a Magic or Rare map.',
    family: 'map',
    stabilityCost: 0,
    needsAffixChoice: false,
    dropTier: 'common',
  }),
  threatGlyph: currency('threatGlyph', {
    name: 'Threat Glyph',
    description: 'Adds one danger mod paired with its reward. The map becomes Rare at 3 or more mods (maximum 4).',
    family: 'map',
    stabilityCost: 0,
    needsAffixChoice: false,
    dropTier: 'common',
  }),
  rewardInk: currency('rewardInk', {
    name: 'Reward Ink',
    description: 'Adds one reward-only mod to a map (maximum 1 per map).',
    family: 'map',
    stabilityCost: 0,
    needsAffixChoice: false,
    dropTier: 'uncommon',
  }),
  voidNeedle: currency('voidNeedle', {
    name: 'Void Needle',
    description: 'Corrupts a map with an unpredictable outcome. Further crafting requires a Void Splinter, which removes corruption, its modifiers and all quality.',
    family: 'map',
    stabilityCost: 0,
    needsAffixChoice: false,
    maxStack: RARE_CURRENCY_STACK,
    dropTier: 'rare',
  }),
  gildedKey: currency('gildedKey', {
    name: 'Gilded Key',
    description: 'Opens one expedition into the Gilded Vault. Found from vault bosses on Tier 3+ maps (12%), or any ordinary Atlas boss on Tier 8+ maps (0.5%). Tradeable; never expires.',
    family: 'map', stabilityCost: 0, needsAffixChoice: false, maxStack: RARE_CURRENCY_STACK, dropTier: 'rare',
  }),
  blackKey: currency('blackKey', {
    name: 'Black Key',
    description: 'Opens one expedition into the Black Pit. Found from forge bosses on Tier 3+ maps (8%), or any ordinary Atlas boss on Tier 8+ maps (0.5%). Tradeable; never expires.',
    family: 'map', stabilityCost: 0, needsAffixChoice: false, maxStack: RARE_CURRENCY_STACK, dropTier: 'rare',
  }),
  huntingKey: currency('huntingKey', {
    name: 'Hunting Key',
    description: 'Opens one expedition into the Hunting Ground. Found from arena bosses on Tier 3+ maps (8%), or any ordinary Atlas boss on Tier 8+ maps (0.5%). Tradeable; never expires.',
    family: 'map', stabilityCost: 0, needsAffixChoice: false, maxStack: RARE_CURRENCY_STACK, dropTier: 'rare',
  }),
  riftKey: currency('riftKey', {
    name: 'Rift Key',
    description: 'Opens one expedition into the Rift Nexus. Found from crypt bosses on Tier 5+ maps (6%), or any ordinary Atlas boss on Tier 8+ maps (0.5%). Tradeable; never expires.',
    family: 'map', stabilityCost: 0, needsAffixChoice: false, maxStack: RARE_CURRENCY_STACK, dropTier: 'rare',
  }),
  reliquaryKey: currency('reliquaryKey', {
    name: 'Reliquary Key',
    description: 'Opens one expedition into the Sealed Reliquary. Found most often in the Ember Vault; tradeable and never expires.',
    family: 'map', stabilityCost: 0, needsAffixChoice: false, maxStack: RARE_CURRENCY_STACK, dropTier: 'rare',
  }),
};

/** Human family labels. */
export const CURRENCY_FAMILY_LABEL: Record<CurrencyDef['family'], string> = {
  shape: 'Shape',
  refine: 'Refine',
  remove: 'Remove',
  preserve: 'Preserve',
  transform: 'Transform',
  map: 'Map',
};
