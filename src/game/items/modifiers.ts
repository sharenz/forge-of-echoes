// What an equipment item does: resolved lines (implicits, affixes, unique mods, scars), local base
// properties (Armour / Evasion Rating / Added Spell Damage), StatModifiers and player flags.
import type { EquipmentItem, StatModifier } from '../../contracts/items';
import type { PlayerFlag } from '../../contracts/content';
import { findBase, findUnique, getAffix, getScar } from '../../data/items';
import type { ModLineDef } from '../../data/items';
import { formatLine } from './format';

export type LinePart = 'implicit' | 'affix' | 'unique' | 'scar';

export interface ItemLine {
  def: ModLineDef;
  /** Signed value applied to each stat of the line. */
  value: number;
  part: LinePart;
  /** Short origin tag: "implicit", "Blazing T4", "Hale T4, crafted", "unique", "scar: Frail". */
  origin: string;
  /** Index into item.affixes / implicitValues / scars. */
  index: number;
}

const UNIQUE_MOD_RE = /^unique:([A-Za-z]+):(\d+)$/;

/** The unique mod definition a stored affix id points to, if any. */
export function uniqueModDef(affixId: string) {
  const m = UNIQUE_MOD_RE.exec(affixId);
  if (!m) return undefined;
  return findUnique(m[1])?.mods[Number(m[2])];
}

/** Every resolved line of an item, in tooltip order. Unknown ids (stale saves) are skipped. */
export function itemLines(item: EquipmentItem): ItemLine[] {
  const base = findBase(item.baseId);
  const out: ItemLine[] = [];
  if (base) {
    base.implicits.forEach((def, i) => {
      const value = item.implicitValues[i];
      if (value !== undefined) out.push({ def, value, part: 'implicit', origin: 'implicit', index: i });
    });
  }
  item.affixes.forEach((a, i) => {
    const def = getAffix(a.affixId);
    if (def) {
      out.push({ def, value: a.value, part: 'affix', origin: `${def.name} T${a.tier}${a.crafted ? ', crafted' : ''}`, index: i });
      return;
    }
    const mod = uniqueModDef(a.affixId);
    if (mod) out.push({ def: mod, value: a.value, part: 'unique', origin: 'unique', index: i });
  });
  item.scars.forEach((s, i) => {
    const def = getScar(s.scarId);
    if (def) out.push({ def, value: def.sign * s.value, part: 'scar', origin: `scar: ${def.name}`, index: i });
  });
  return out;
}

export interface ItemPropertyValue {
  stat: ModLineDef['stats'][number];
  label: string;
  /** Item-level base value. */
  base: number;
  /** Local flat added by the item's own lines. */
  flat: number;
  /** Local % increased from the item's own lines. */
  increased: number;
  /** Final value: floor((base + flat) × (1 + increased/100)), never below 0. */
  value: number;
}

/**
 * Base properties with local modifiers folded in. On a base with an Armour property, every flat or
 * % Armour line on the same item modifies that property instead of the character (PoE-style locals).
 */
export function itemProperties(item: EquipmentItem): ItemPropertyValue[] {
  const base = findBase(item.baseId);
  if (!base || !base.properties.length) return [];
  const lines = itemLines(item);
  return base.properties.map((p) => {
    const baseValue = Math.floor(p.base + p.perItemLevel * item.itemLevel);
    let flat = 0;
    let increased = 0;
    for (const line of lines) {
      if (!line.def.stats.includes(p.stat)) continue;
      if (line.def.mode === 'flat') flat += line.value;
      else if (line.def.mode === 'increased') increased += line.value;
    }
    const value = Math.max(0, Math.floor((baseValue + flat) * (1 + increased / 100)));
    return { stat: p.stat, label: p.label, base: baseValue, flat, increased, value };
  });
}

/** Rare/unique name, or the derived magic name ("Blazing Ashwood Wand of Haste"), or the base name. */
export function itemDisplayName(item: EquipmentItem): string {
  const base = findBase(item.baseId);
  const baseName = base?.name ?? 'Unknown Item';
  if (item.name) return item.name;
  if (item.rarity !== 'magic') return baseName;
  let prefix = '';
  let suffix = '';
  for (const a of item.affixes) {
    const def = getAffix(a.affixId);
    if (!def) continue;
    if (def.kind === 'prefix' && !prefix) prefix = def.name;
    if (def.kind === 'suffix' && !suffix) suffix = def.name;
  }
  return [prefix, baseName, suffix].filter(Boolean).join(' ');
}

/** Level needed to equip: the unique's requirement, else the base's. Crafting never changes it. */
export function equipmentLevelRequirement(item: EquipmentItem): number {
  if (item.uniqueId) {
    const u = findUnique(item.uniqueId);
    if (u) return u.levelRequirement;
  }
  return findBase(item.baseId)?.levelRequirement ?? 1;
}

/**
 * Every stat modifier the item grants, labelled for character-sheet breakdowns.
 * `source` = "<item name> (<origin>)", `label` = the tooltip text of the line.
 * Local property stats are emitted once as the property total ("Iron Visor (Armour)").
 */
export function itemModifiers(item: EquipmentItem): StatModifier[] {
  const name = itemDisplayName(item);
  const props = itemProperties(item);
  const local = new Set(props.map((p) => p.stat));
  const out: StatModifier[] = [];
  for (const p of props) {
    if (p.value === 0) continue;
    out.push({ stat: p.stat, mode: 'flat', value: p.value, source: `${name} (${p.label})`, label: `${p.label}: ${p.value}` });
  }
  for (const line of itemLines(item)) {
    const label = formatLine(line.def, line.value);
    for (const stat of line.def.stats) {
      if (local.has(stat) && line.def.mode !== 'more') continue;
      out.push({ stat, mode: line.def.mode, value: line.value, source: `${name} (${line.origin})`, label });
    }
  }
  return out;
}

/** Player flags granted by the item (uniques only). */
export function itemFlags(item: EquipmentItem): PlayerFlag[] {
  if (!item.uniqueId) return [];
  return findUnique(item.uniqueId)?.flags.map((f) => f.flag) ?? [];
}
