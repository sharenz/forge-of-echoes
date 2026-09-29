// Tooltip descriptions (ItemDescription) for equipment, currency and flasks.
//
// Invariant the UI relies on: for equipment, `description.affixes[i]` describes `item.affixes[i]`
// (so an affix-choice click on line i maps to affixIndex i). Unique flag lines follow the unique mods.
import type {
  CurrencyStack, EquipmentItem, FlaskStack, Item, ItemDescription, ItemTone, TooltipLine,
} from '../../contracts/items';
import type { FlaskId } from '../../contracts/content';
import { iconIdForBase, iconIdForCurrency, iconIdForFlask, iconIdForUnique } from '../../contracts/content';
import {
  BELT_SLOT_CAPACITY, CLASS_LABEL, CURRENCY_FAMILY_LABEL, FLASK_STACK, TAG_LABEL, findBase, findCurrency, findFlask,
  findUnique, getAffix, getScar,
} from '../../data/items';
import { CURRENCY_STASH_MAX } from '../../contracts/items';
import { formatCount, formatLine, formatNumber, formatRange } from './format';
import { parseBeltUid, parseCurrencyStashUid } from './ids';
import { equipmentLevelRequirement, itemDisplayName, itemProperties, uniqueModDef } from './modifiers';

export interface EquipmentDescribeOptions {
  /** When given, an unmet level requirement is spelled out. */
  characterLevel?: number;
}

function affixLine(item: EquipmentItem, index: number): TooltipLine {
  const rolled = item.affixes[index];
  const def = getAffix(rolled.affixId);
  if (def) {
    const tier = def.tiers.find((t) => t.tier === rolled.tier);
    const line: TooltipLine = {
      text: formatLine(def, rolled.value),
      kind: def.kind,
      tier: rolled.tier,
      affixName: def.name,
      tags: def.tags.map((t) => TAG_LABEL[t]),
    };
    const range = tier ? formatRange(tier.min, tier.max) : undefined;
    if (range) line.range = range;
    if (rolled.sealed) line.sealed = true;
    if (rolled.fractured) line.fractured = true;
    // Bench-crafted: flagged only; the UI decides how to mark it (the text stays the plain stat line).
    if (rolled.crafted) line.crafted = true;
    return line;
  }
  const mod = uniqueModDef(rolled.affixId);
  if (mod) {
    const line: TooltipLine = { text: formatLine(mod, rolled.value), kind: 'unique' };
    const range = formatRange(mod.min, mod.max);
    if (range) line.range = range;
    if (rolled.value < 0 || mod.stats.includes('damageTaken')) line.negative = true;
    return line;
  }
  return { text: 'Unknown affix', kind: 'info' };
}

/** Full tooltip for an equipment item. */
export function describeEquipment(item: EquipmentItem, opts: EquipmentDescribeOptions = {}): ItemDescription {
  const base = findBase(item.baseId);
  const unique = item.uniqueId ? findUnique(item.uniqueId) : undefined;
  const title = itemDisplayName(item);
  const baseName = base?.name ?? 'Unknown Item';
  const isUnique = item.rarity === 'unique';
  const finished = !isUnique && item.stability <= 0;

  const implicits: TooltipLine[] = (base?.implicits ?? []).map((def, i) => {
    const line: TooltipLine = { text: formatLine(def, item.implicitValues[i] ?? def.min), kind: 'implicit' };
    const range = formatRange(def.min, def.max);
    if (range) line.range = range;
    return line;
  });

  const affixes: TooltipLine[] = item.affixes.map((_, i) => affixLine(item, i));
  if (unique) for (const f of unique.flags) affixes.push({ text: f.text, kind: 'unique' });

  const scars: TooltipLine[] = item.scars.flatMap((s) => {
    const def = getScar(s.scarId);
    if (!def) return [];
    const line: TooltipLine = { text: `${def.name}: ${formatLine(def, def.sign * s.value)}`, kind: 'scar', negative: true };
    const range = formatRange(def.min, def.max);
    if (range) line.range = range;
    return [line];
  });

  const headerLines = [`Item Level ${item.itemLevel}`];
  if (finished) headerLines.push('Finished');

  const req = equipmentLevelRequirement(item);
  let requirements: string | undefined;
  if (req > 1 || (opts.characterLevel !== undefined && opts.characterLevel < req)) {
    requirements = `Requires Level ${req}`;
    if (opts.characterLevel !== undefined && opts.characterLevel < req) requirements += ` (you are level ${opts.characterLevel})`;
  }

  let hint: string | undefined;
  if (isUnique) hint = 'Unique items cannot be crafted.';
  else if (finished) hint = 'Finished at 0 Stability: repair Stability with Scrap at the bench to keep crafting.';
  else if (item.rarity === 'normal') hint = 'A clean Normal base: a Kindling Shard, an Essence or the Crafting Bench starts a craft.';
  else if (item.affixes.some((a) => a.crafted)) hint = 'The crafted affix can be removed for free at the Crafting Bench.';

  const desc: ItemDescription = {
    title,
    subtitle: item.rarity === 'rare' || isUnique ? baseName : null,
    tone: item.rarity,
    iconId: unique ? iconIdForUnique(unique.id) : iconIdForBase(item.baseId),
    classLabel: base ? CLASS_LABEL[base.itemClass] : 'Item',
    size: base ? { ...base.size } : { w: 1, h: 1 },
    headerLines,
    properties: itemProperties(item).map((p) => ({ label: p.label, value: String(p.value) })),
    implicits,
    affixes,
    scars,
  };
  if (!isUnique) desc.stability = { current: item.stability, max: item.maxStability };
  if (!isUnique && base?.material) desc.description = base.materialNote;
  if (unique) desc.flavor = unique.flavor;
  if (requirements) desc.requirements = requirements;
  if (item.history.length) desc.history = [...item.history];
  if (hint) desc.hint = hint;
  return desc;
}

/** Tooltip for a currency stack. */
export function describeCurrency(stack: CurrencyStack): ItemDescription {
  const def = findCurrency(stack.currencyId);
  const name = def?.name ?? 'Unknown Currency';
  const isMap = def?.family === 'map';
  const properties: { label: string; value: string }[] = [];
  if (def) {
    properties.push({ label: 'Family', value: CURRENCY_FAMILY_LABEL[def.family] });
    if (!isMap) properties.push({ label: 'Stability Cost', value: def.stabilityCost === 0 ? 'None' : String(def.stabilityCost) });
  }
  let hint = isMap
    ? 'Right-click to arm, then left-click a map in the hideout.'
    : 'Right-click to arm, then left-click an item in the hideout.';
  if (def?.needsAffixChoice) hint = 'Right-click to arm, left-click an item, then choose an affix.';
  if (stack.currencyId === 'reliquaryKey') hint = 'Select the Sealed Reliquary in the Map Device. Activation consumes one key from your inventory or stash.';
  // A Crafting Stash slot (uid "cstash:<id>", see src/game/items/special-stash.ts).
  const inStash = parseCurrencyStashUid(stack.uid) !== null;
  if (inStash) {
    const stackSize = def?.maxStack ?? 1;
    hint = stack.count > 0
      ? `${hint} Each use takes one from here. Drag or Ctrl+click to take a stack of up to ${stackSize}; Shift+Ctrl+click takes one.`
      : `Empty. Any ${name} you deposit is filed here.`;
  }
  const desc: ItemDescription = {
    title: name,
    subtitle: null,
    tone: 'currency',
    iconId: iconIdForCurrency(stack.currencyId),
    classLabel: isMap ? 'Map Currency' : 'Currency',
    size: { w: 1, h: 1 },
    headerLines: [inStash
      ? `Crafting Stash ${formatCount(stack.count)} / ${formatCount(CURRENCY_STASH_MAX)}`
      : `Stack ${stack.count} / ${def?.maxStack ?? stack.count}`],
    properties,
    implicits: [],
    affixes: [],
    scars: [],
    hint,
  };
  if (def) desc.description = def.description;
  return desc;
}

/** Total recovery of one flask charge: (base + perLevel × level) × flask effect multiplier. */
export function flaskRecovery(flaskId: FlaskId, characterLevel: number, flaskEffectMultiplier = 1): number {
  const def = findFlask(flaskId);
  if (!def) return 0;
  const level = Math.max(1, Math.floor(characterLevel));
  return Math.round((def.recoverBase + def.recoverPerLevel * level) * flaskEffectMultiplier);
}

export interface FlaskDescribeOptions {
  /** Shows the exact recovery amount for this level. */
  characterLevel?: number;
  /** Flask effect multiplier (1 = normal). */
  flaskEffect?: number;
}

/** Hint for a flask: belt key to drink (key = slot index + 1), an emptied slot, or how to load it. */
function beltHint(beltIndex: number | null, count: number): string {
  if (beltIndex === null) return 'Ctrl+click to load into the belt.';
  if (count <= 0) return 'Empty. Flask pickups refill this slot first.';
  return `Press ${beltIndex + 1} during a map to drink.`;
}

/**
 * Tooltip for a flask stack: grid stacks, and belt slots via their synthetic uid "belt:<index>"
 * (build them with beltItem(ch, index); a 0-charge stack is an emptied slot that stays assigned).
 */
export function describeFlask(stack: FlaskStack, opts: FlaskDescribeOptions = {}): ItemDescription {
  const def = findFlask(stack.flaskId);
  const beltIndex = parseBeltUid(stack.uid);
  const onBelt = beltIndex !== null;
  const resource = def?.resource === 'focus' ? 'Focus' : 'Life';
  const properties: { label: string; value: string }[] = [];
  if (def) {
    const value = opts.characterLevel !== undefined
      ? `${formatNumber(flaskRecovery(def.id, opts.characterLevel, opts.flaskEffect ?? 1))} ${resource}`
      : `${def.recoverBase} ${resource} + ${def.recoverPerLevel} per level`;
    properties.push({ label: 'Recovers', value });
    properties.push({ label: 'Duration', value: `${formatNumber(def.duration)} seconds` });
  }
  const desc: ItemDescription = {
    title: def?.name ?? 'Unknown Flask',
    subtitle: null,
    tone: 'flask',
    iconId: iconIdForFlask(stack.flaskId),
    classLabel: 'Flask',
    size: { w: 1, h: 1 },
    headerLines: [onBelt ? `Belt Charges ${stack.count} / ${BELT_SLOT_CAPACITY}` : `Stack ${stack.count} / ${FLASK_STACK}`],
    properties,
    implicits: [],
    affixes: [],
    scars: [],
    description: `${def?.description ?? ''} Each belt slot holds up to ${BELT_SLOT_CAPACITY} charges; drinking uses one.`.trim(),
    hint: beltHint(beltIndex, stack.count),
  };
  return desc;
}

/** Tooltip / drop-label tone of any item. */
export function itemTone(item: Item): ItemTone {
  if (item.kind === 'equipment') return item.rarity;
  return item.kind;
}

/**
 * Short label for toasts and drop plates: equipment display name, "Forge Scrap ×3", "Life Flask",
 * "Tier 4 Map" (the map rules may prefer their own base names).
 */
export function itemLabel(item: Item): string {
  switch (item.kind) {
    case 'equipment':
      return itemDisplayName(item);
    case 'currency': {
      const name = findCurrency(item.currencyId)?.name ?? 'Currency';
      return item.count > 1 ? `${name} \u00d7${item.count}` : name;
    }
    case 'flask': {
      const name = findFlask(item.flaskId)?.name ?? 'Flask';
      return item.count > 1 ? `${name} \u00d7${item.count}` : name;
    }
    case 'map':
      return `Tier ${item.tier} Map`;
  }
}
