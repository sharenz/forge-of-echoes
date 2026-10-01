// Late crafting ingredients. Pool builders are shared by validation, rolls and exact previews.
import type { CurrencyId } from '../../contracts/content';
import type { EquipmentItem, RolledAffix } from '../../contracts/items';
import type { Rng } from '../../contracts/rng';
import { BASES, findBase, findUnique, getAffix, getScar } from '../../data/items';
import type { BaseDef } from '../../data/items';
import { affixAllowedOnBase, affixCandidates, baseHasProperty, rollValue, singlePickOdds, sortAffixes } from './affix-pool';
import { formatChance, formatLine, formatSpan } from './format';

export const ADVANCED_EQUIPMENT_CURRENCIES = ['scarBalm', 'anneal', 'graft', 'transmute', 'echoShard', 'crownFragment'] as const;
export type AdvancedEquipmentCurrency = typeof ADVANCED_EQUIPMENT_CURRENCIES[number];
export const isAdvancedEquipmentCurrency = (id: CurrencyId): id is AdvancedEquipmentCurrency =>
  (ADVANCED_EQUIPMENT_CURRENCIES as readonly string[]).includes(id);
export const preservesSeals = (id: CurrencyId): boolean => id === 'scarBalm' || id === 'anneal' || id === 'crownFragment';

export function graftPool(item: EquipmentItem, base: BaseDef, index: number) {
  const old = item.affixes[index];
  const def = old && getAffix(old.affixId);
  if (!def) return [];
  const groups = new Set(item.affixes.map(a => getAffix(a.affixId)?.group));
  return affixCandidates(base, item.itemLevel).flatMap(c => {
    if (c.affix.kind !== def.kind || groups.has(c.affix.group)) return [];
    const tier = c.tiers.find(t => t.tier === old.tier);
    if (!tier) return [];
    // Keep the material multiplier, but only this exact tier contributes weight.
    const weight = c.weight * tier.weight / c.tiers.reduce((n, t) => n + t.weight, 0);
    return [{ ...c, tiers: [tier], weight }];
  });
}

export function graftTargetError(item: EquipmentItem, index: number): string | null {
  const a = item.affixes[index];
  if (!Number.isInteger(index) || !a) return 'Choose an affix to replace.';
  if (a.sealed || a.fractured) return 'Sealed and fractured affixes cannot be replaced.';
  const base = findBase(item.baseId)!;
  return graftPool(item, base, index).length ? null : `No different affix family of the same type can roll at T${a.tier} on this item.`;
}

/** A transmutation never invalidates an affix, scar, occupied cell or stored Stability budget. */
export function transmuteBases(item: EquipmentItem): BaseDef[] {
  const from = findBase(item.baseId)!;
  return Object.values(BASES).filter(b => b.id !== from.id && b.itemClass === from.itemClass
    && b.levelRequirement <= item.itemLevel && b.size.w === from.size.w && b.size.h === from.size.h
    && b.maxStability + 4 >= item.maxStability
    && item.affixes.every(a => { const d = getAffix(a.affixId); return !!d && affixAllowedOnBase(d, b); })
    && item.scars.every(s => { const d = getScar(s.scarId); return !!d && (!d.classes || d.classes.includes(b.itemClass))
      && (!d.requiresProperty || baseHasProperty(b, d.requiresProperty)); }));
}

function rollingTier(a: RolledAffix) {
  if (a.sealed || a.fractured) return undefined;
  const t = getAffix(a.affixId)?.tiers.find(t => t.tier === a.tier);
  return t && t.min !== t.max ? t : undefined;
}

export function advancedCraftError(item: EquipmentItem, id: AdvancedEquipmentCurrency, index?: number): string | null {
  switch (id) {
    case 'scarBalm': return item.scars.length ? null : 'This item has no scar to remove.';
    case 'anneal': return item.maxStability > 1 && item.stability < item.maxStability - 1
      ? null : 'Anneal needs at least two missing Stability and at least two maximum Stability.';
    case 'graft': return index !== undefined ? graftTargetError(item, index)
      : item.affixes.some((_, i) => !graftTargetError(item, i)) ? null : 'No unprotected affix has a different family available at its tier.';
    case 'transmute': return transmuteBases(item).length ? null : 'No different compatible base is available at this item level.';
    case 'echoShard': return item.affixes.some(a => rollingTier(a)) ? null : 'No unsealed, unfractured affix has a value range to reroll.';
    case 'crownFragment': {
      const unique = item.uniqueId && findUnique(item.uniqueId);
      if (item.rarity !== 'unique' || !unique) return 'Crown Fragments refine Unique items only.';
      return unique.mods.some(m => m.min !== m.max) ? null : 'Every modifier on this Unique has a fixed value.';
    }
  }
}

export function advancedCraftOp(item: EquipmentItem, id: AdvancedEquipmentCurrency, rng: Rng, index?: number): {
  item: EquipmentItem; line: string; targetIndex?: number;
} {
  switch (id) {
    case 'scarBalm': return { item: { ...item, scars: item.scars.slice(1) }, line: `Scar Balm removed ${getScar(item.scars[0].scarId)!.name}` };
    case 'anneal': {
      const maximum = item.maxStability - 1;
      return { item: { ...item, stability: maximum, maxStability: maximum },
        line: `Anneal restored Stability to ${maximum}; maximum Stability fell from ${item.maxStability} to ${maximum}` };
    }
    case 'graft': {
      const old = item.affixes[index!];
      const pick = rng.weighted(graftPool(item, findBase(item.baseId)!, index!), c => c.weight)!;
      const tier = pick.tiers[0];
      const added = { affixId: pick.affix.id, tier: tier.tier, value: rollValue(rng, tier.min, tier.max) };
      return { item: { ...item, affixes: sortAffixes(item.affixes.map((a, i) => i === index ? added : a)) },
        line: `Graft replaced ${getAffix(old.affixId)!.name} with ${pick.affix.name} at T${tier.tier}`, targetIndex: index };
    }
    case 'transmute': {
      const base = rng.pick(transmuteBases(item));
      return { item: { ...item, baseId: base.id, implicitValues: base.implicits.map(m => rollValue(rng, m.min, m.max)) },
        line: `Transmute changed ${findBase(item.baseId)!.name} into ${base.name}, rerolling its implicit` };
    }
    case 'echoShard': return { item: { ...item, affixes: item.affixes.map(a => {
      const t = rollingTier(a);
      return t ? { ...a, value: Math.max(rollValue(rng, t.min, t.max), rollValue(rng, t.min, t.max)) } : a;
    }) }, line: 'Echo Shard rolled each unprotected affix value twice and kept the higher new roll' };
    case 'crownFragment': {
      const unique = findUnique(item.uniqueId!)!;
      return { item: { ...item, affixes: item.affixes.map((a, i) => ({ ...a, value: rollValue(rng, unique.mods[i].min, unique.mods[i].max) })) },
        line: `Crown Fragment rerolled ${unique.name}’s numeric modifiers` };
    }
  }
}

export function advancedCraftPreview(item: EquipmentItem, id: AdvancedEquipmentCurrency): {
  lines: string[]; outcomes: { label: string; chance: number }[];
} {
  const lines: string[] = [], outcomes: { label: string; chance: number }[] = [];
  switch (id) {
    case 'scarBalm':
      lines.push(`Removes the oldest scar: ${getScar(item.scars[0].scarId)!.name}.`, 'Affixes, seals and Stability are preserved.'); break;
    case 'anneal':
      lines.push(`Restores Stability from ${item.stability} to ${item.maxStability - 1}.`,
        `Maximum Stability permanently falls from ${item.maxStability} to ${item.maxStability - 1}. Scars, seals and lifetime repair costs remain.`); break;
    case 'graft':
      lines.push('Choose an unprotected affix. Its prefix/suffix type and tier stay the same; its family changes. Other affixes and rarity are preserved.');
      item.affixes.forEach((a, i) => {
        if (graftTargetError(item, i)) return;
        const odds = singlePickOdds(graftPool(item, findBase(item.baseId)!, i));
        lines.push(`${getAffix(a.affixId)!.name} T${a.tier}: ${odds.map(o => `${o.cand.affix.name} (${formatSpan(o.cand.tiers[0].min, o.cand.tiers[0].max)}) ${formatChance(o.chance)}`).join(' · ')}`);
      }); break;
    case 'transmute': {
      const bases = transmuteBases(item);
      outcomes.push(...bases.map(b => ({ label: b.name, chance: 1 / bases.length })));
      lines.push(`New base: ${outcomes.map(o => `${o.label} ${formatChance(o.chance)}`).join(' · ')}.`,
        'The new base implicit is rerolled. Affixes, scars, item level, name, Stability budget and lifetime repair prices remain.',
        'Base properties, material and equip requirements change. Put the item in your backpack or stash first.'); break;
    }
    case 'echoShard':
      lines.push('Each unprotected value is rolled twice within its current tier; the higher new roll wins. A new roll may still be lower than the current value.');
      for (const a of item.affixes) {
        const t = rollingTier(a); if (!t) continue;
        const cdf = Math.max(0, Math.min(1, (Math.floor(a.value) - t.min + 1) / (t.max - t.min + 1)));
        lines.push(`${getAffix(a.affixId)!.name}: ${formatSpan(t.min, t.max)} · ${formatChance(1 - cdf * cdf)} chance to exceed ${a.value}.`);
      } break;
    case 'crownFragment':
      lines.push('Rerolls numeric modifiers; the base implicit and special behaviour stay the same. Values can rise or fall.');
      for (const m of findUnique(item.uniqueId!)!.mods) lines.push(m.min === m.max ? formatLine(m, m.min) : `${formatLine(m, m.min)} to ${formatLine(m, m.max)}`);
      break;
  }
  return { lines, outcomes };
}
