// The unit ledger (brief B 4.1): one exchange rate prices tree nodes, map mods and scarabs alike.
// Retuning the tree globally means editing these numbers, not 148 nodes.
import { findCurrency } from '../../items';
import { MAP_BASES } from '../maps';
import type { AtlasCondition, AtlasEffect, AtlasNode, AtlasNodeSpec, AtlasNodeUnits, AtlasRule, AtlasUnits } from './types';

interface Rate { /** Magnitude (percent or points) worth one unit; sign flips which side the effect lands on. */ rate: number; kind: 'reward' | 'danger' }
const R = (rate: number): Rate => ({ rate, kind: 'reward' });
const D = (rate: number): Rate => ({ rate, kind: 'danger' });

/** 1 unit is about +3% item quantity, +4% rarity, +6.5% monster life ... (the map-mod exchange rate). */
export const UNIT_RATES: Readonly<Record<string, Rate>> = {
  'itemQuantity:increased': R(3), 'itemQuantity:more': R(2.5),
  'itemRarity:increased': R(4), 'itemRarity:more': R(3),
  'packRarity:increased': R(10),
  'magicPackChance:more': R(10), 'rarePackChance:more': D(12),
  'mapDropChance:increased': R(8),
  'essenceDropChance:increased': R(8), 'essenceDropChance:more': R(8),
  'emberEssenceChance:increased': R(8), 'emberEssenceChance:more': R(8),
  'rimeEssenceChance:increased': R(8), 'rimeEssenceChance:more': R(8),
  'armourStability:flat': R(0.3), 'equipmentStability:flat': R(0.25),
  'eventChance:flat': R(1.5), 'chestUpgradeChance:flat': R(2.5), 'chestQuality:flat': R(2.5), 'droppedMapQuality:flat': R(2),
  'scarabDropChance:increased': R(12),
  'rareQuantity:increased': R(8), 'rareQuantity:more': R(8), 'normalQuantity:more': R(3),
  'equipmentDropChance:more': R(10), 'bossIngredientChance:more': R(12),
  'bossLife:more': D(6), 'bossUnique:more': R(6), 'bossLoot:more': R(20), 'chestLoot:more': R(20),
  'chestRareChance:flat': R(8), 'chestCurrency:flat': R(0.25),
  'territoryFee:flat': R(-1), 'revealChance:flat': R(9),
  'monsterLife:increased': D(6.5), 'monsterLife:more': D(2.5),
  'monsterDamage:increased': D(3.5), 'monsterDamage:more': D(2.2),
  'monsterCount:increased': D(5), 'monsterCount:more': D(4),
  'monsterSpeed:increased': D(4), 'monsterSpeed:more': D(3.5), 'monsterResist:flat': D(5),
  'playerResist:flat': D(-4.4), 'playerFocusRegen:increased': D(-8),
  'currencyWeight:increased': R(8), 'currencyWeight:more': R(8),
};

const NIL: AtlasUnits = { reward: 0, danger: 0 };
const add = (a: AtlasUnits, b: AtlasUnits): AtlasUnits => ({ reward: a.reward + b.reward, danger: a.danger + b.danger });

function priced(key: string, value: number): AtlasUnits {
  const r = UNIT_RATES[key];
  if (!r) return NIL;
  const u = value / r.rate;
  const toReward = r.kind === 'reward' ? u : -u;
  return toReward >= 0 ? { reward: toReward, danger: 0 } : { reward: 0, danger: -toReward };
}

/** Units of one effect; a per-tier effect is priced at `tier`. */
export function effectUnits(e: AtlasEffect, tier = 9): AtlasUnits {
  return priced(`${e.stat}:${e.mode}`, e.perTier ? e.value * tier : e.value);
}

export function ruleUnits(rule: AtlasRule): AtlasUnits {
  return rule.id === 'currencyWeight' ? priced(`currencyWeight:${rule.mode}`, rule.value) : NIL;
}

/** Gross reward and carried danger of a node. Manual units replace what effects cannot price. */
export function nodeUnits(node: { effects: readonly AtlasEffect[]; rules: readonly AtlasRule[]; units?: AtlasNodeUnits }, tier = 9): AtlasUnits & { net: number } {
  if (node.units?.manual) return { reward: node.units.reward, danger: node.units.danger, net: node.units.reward - node.units.danger };
  let u = NIL;
  for (const e of node.effects) u = add(u, effectUnits(e, tier));
  for (const r of node.rules) u = add(u, ruleUnits(r));
  if (node.units) u = add(u, node.units);
  return { ...u, net: u.reward - u.danger };
}

// ---------------------------------------------------------------------------------------------
// Player-facing text (generated from the numbers so text and data cannot drift)
// ---------------------------------------------------------------------------------------------

const num = (v: number): string => String(Math.round(Math.abs(v) * 100) / 100);
const NOUN: Readonly<Record<string, string>> = {
  monsterCount: 'number of monsters', monsterLife: 'monster life', monsterDamage: 'monster damage', monsterSpeed: 'monster movement speed',
  packRarity: 'chance of magic and rare packs', itemQuantity: 'item quantity', itemRarity: 'item rarity',
  mapDropChance: 'chance to find maps', essenceDropChance: 'essence weight', emberEssenceChance: 'ember essence weight',
  rimeEssenceChance: 'rime essence weight', playerFocusRegen: 'focus regeneration for players', scarabDropChance: 'chance to find scarabs',
  rareQuantity: 'quantity from rare monsters', normalQuantity: 'quantity from ordinary monsters', equipmentDropChance: 'equipment drops',
  bossIngredientChance: 'boss ingredient chances', bossLife: 'life for final bosses', bossUnique: 'unique chance from final bosses',
  bossLoot: 'boss loot', chestLoot: 'completion chest loot', waveDuration: 'wave duration', magicPackChance: 'chance of magic packs',
  rarePackChance: 'chance of rare packs', dangerModStrength: 'strength of danger mods on your maps (both sides)',
  corruptedModStrength: 'strength of corrupted mods (both sides)',
};
const FLAT: Readonly<Record<string, (v: number) => string>> = {
  monsterResist: v => `monsters have ${v < 0 ? '-' : '+'}${num(v)}% to all resistances`,
  playerResist: v => `players have ${v < 0 ? '-' : '+'}${num(v)}% to all resistances`,
  armourStability: v => `non-unique armour drops with +${num(v)} maximum Stability`,
  equipmentStability: v => `non-unique equipment drops with +${num(v)} maximum Stability`,
  eventChance: v => `+${num(v)} percentage points to random encounter chance`,
  chestUpgradeChance: v => `completion chests upgrade the map one tier +${num(v)} percentage points more often`,
  chestQuality: v => `the completion chest map has +${num(v)} quality`,
  droppedMapQuality: v => `dropped maps have +${num(v)} quality`,
  territoryFee: v => `territory fee ${v < 0 ? '-' : '+'}${num(v)} Scrap (minimum 0)`,
  revealChance: v => `a boss kill has a ${num(v)}% chance to reveal one more neighbour`,
  chestRareChance: v => `completion chest equipment is Rare ${num(v)}% of the time`,
  chestCurrency: v => `the completion chest holds ${num(v)} more currency roll${Math.abs(v) === 1 ? '' : 's'}`,
  hazards: () => 'volcanic eruptions burst around you',
};

function scope(w: AtlasCondition | undefined): string {
  if (!w) return '';
  const parts: string[] = [];
  if (w.base) parts.push(`on ${MAP_BASES[w.base]?.name ?? w.base} maps`);
  if (w.area === 'deadEnd') parts.push('in dead-end and sealed areas');
  if (w.area === 'throughRoute') parts.push('in through-route areas');
  if (w.corrupted === true) parts.push('on corrupted maps');
  if (w.corrupted === false) parts.push('on uncorrupted maps');
  if (w.event) parts.push('on maps with an encounter');
  if (w.minTier) parts.push(`from Tier ${w.minTier}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

export function effectLine(e: AtlasEffect): string {
  const v = e.value;
  const per = e.perTier ? ' per map tier' : '';
  let s: string;
  if (e.mode === 'flat') s = (FLAT[e.stat] ?? (x => `${x} ${e.stat}`))(v);
  else {
    const noun = NOUN[e.stat] ?? e.stat;
    const word = e.mode === 'increased' ? (v < 0 ? 'reduced' : 'increased') : (v < 0 ? 'less' : 'more');
    s = e.stat === 'monsterCount' && e.mode === 'more' ? `${num(v)}% ${word} monsters` : `${num(v)}% ${word} ${noun}`;
  }
  s += per + scope(e.when);
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

export function ruleLine(r: AtlasRule): string | null {
  switch (r.id) {
    case 'currencyWeight': {
      const names = r.currencies.map(id => findCurrency(id)?.name ?? id);
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
      return `${num(r.value)}% ${r.mode === 'increased' ? 'increased' : 'more'} ${list} weight in ordinary currency drops${scope(r.when)}.`;
    }
    case 'bossWave': return `The final boss arrives on wave ${r.wave}.`;
    case 'equipmentNormalOnly': return 'All equipment drops Normal; Item Rarity no longer affects equipment.';
    default: return null;
  }
}

export function nodeLines(spec: Pick<AtlasNodeSpec, 'effects' | 'rules' | 'notes'>): string[] {
  return [
    ...(spec.effects ?? []).map(effectLine),
    ...(spec.rules ?? []).map(ruleLine).filter((l): l is string => l !== null),
    ...(spec.notes ?? []),
  ];
}

