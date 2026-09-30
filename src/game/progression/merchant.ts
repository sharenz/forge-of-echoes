// Rook's stall (GAME_SPEC §9): Tier 1 maps for free, Tier 2 maps, flasks, Kindling and Map Dust for
// Forge Scrap, and gambling a random item of a chosen class at the player's level (a unique only when
// the class has one the player can already wear).
import type { MerchantOffer, Result } from '../../contracts/game';
import type { CharacterSave, CurrencyStack, Item, Rarity } from '../../contracts/items';
import type { CurrencyId, ItemClass } from '../../contracts/content';
import { createRng } from '../../core/rng';
import { CLASS_LABEL, findCurrency, getFlask, getBase, getAffix, getUnique } from '../../data/items';
import { EQUIPMENT_APPRAISAL, GAMBLE, GAMBLE_OFFER_PREFIX, MERCHANT_NAME, MERCHANT_STOCK } from '../../data/progression';
import type { MerchantStockDef, PriceDef } from '../../data/progression';
import {
  addToBackpack, allItems, baseWeights, currencyStack, currencyStashItem, currencyStashCount, currencyStashRoom, withCurrencyStashCount, flaskStack, formatDistribution, generateEquipment,
  generateUnique, mintUid, pickRandomBase, setStackCount, uniqueIdsFor,
} from '../items';
import type { FoundItem } from '../items';
import { createMapItem, mapBaseImplicitText, mapBaseName } from './maps';
import { buildPlayerModel } from './model';
import { fail, ok } from './util';

// ---------------------------------------------------------------------------------------------
// Currency on hand
// ---------------------------------------------------------------------------------------------

/**
 * Stacks of a currency the character owns: backpack first (top-left onward), then stash tabs, then its
 * Crafting Stash slot (so "Deposit all" never leaves a player unable to pay Rook).
 */
function stacksOf(ch: CharacterSave, id: CurrencyId): (FoundItem & { item: CurrencyStack })[] {
  const stacks = allItems(ch).filter(
    (f): f is FoundItem & { item: CurrencyStack } => f.item.kind === 'currency' && f.item.currencyId === id
      && (f.location.kind === 'backpack' || f.location.kind === 'stash'),
  );
  const slot = currencyStashItem(ch, id);
  if (slot.count > 0) stacks.push({ item: slot, location: { kind: 'currencyStash' } });
  return stacks;
}

export function currencyOnHand(ch: CharacterSave, id: CurrencyId): number {
  return stacksOf(ch, id).reduce((s, f) => s + f.item.count, 0);
}

function canAfford(ch: CharacterSave, price: readonly PriceDef[]): boolean {
  return price.every((p) => currencyOnHand(ch, p.currencyId) >= p.count);
}

function pay(ch: CharacterSave, price: readonly PriceDef[]): CharacterSave {
  let next = ch;
  for (const p of price) {
    let left = p.count;
    while (left > 0) {
      const stack = stacksOf(next, p.currencyId)[0];
      if (!stack) break;
      const take = Math.min(left, stack.item.count);
      next = setStackCount(next, stack, stack.item.count - take);
      left -= take;
    }
  }
  return next;
}

/** Account-funded map costs use the same backpack → normal stash → Crafting Stash order as Rook. */
export function spendCurrency(ch: CharacterSave, id: CurrencyId, count: number): CharacterSave | null {
  if (!Number.isInteger(count) || count < 0 || currencyOnHand(ch, id) < count) return null;
  return pay(ch, [{ currencyId: id, count }]);
}

function priceText(price: readonly PriceDef[]): string {
  if (!price.length) return 'Free';
  return price.map((p) => `${p.count} ${findCurrency(p.currencyId)?.name ?? p.currencyId}`).join(', ');
}

// ---------------------------------------------------------------------------------------------
// Gambling
// ---------------------------------------------------------------------------------------------

/**
 * Gamble rarity chances (fractions) for a class at gear rarity multiplier m. A unique is possible only
 * when the class has one wearable at `level` (the character's level; omitted = any level).
 */
export function gambleOdds(itemClass: ItemClass, m: number, level?: number): Record<Rarity, number> {
  const hasUnique = uniqueIdsFor({ classes: [itemClass], maxLevel: level }).length > 0;
  let magic = (GAMBLE.chances.magic / 100) * m;
  let rare = (GAMBLE.chances.rare / 100) * m;
  let unique = hasUnique ? (GAMBLE.chances.unique / 100) * m : 0;
  const total = magic + rare + unique;
  if (total > 1) {
    magic /= total;
    rare /= total;
    unique /= total;
  }
  return { normal: Math.max(0, 1 - magic - rare - unique), magic, rare, unique };
}

/** Gear rarity as a multiplier (1 = no gear rarity). */
function gearRarityMultiplier(ch: CharacterSave): number {
  return buildPlayerModel(ch).breakdown('itemRarity').value / 100;
}

function gambleClasses(ch: CharacterSave): ItemClass[] {
  return GAMBLE.classes.filter((c) => baseWeights({ classes: [c], itemLevel: ch.level }).length > 0);
}

// ---------------------------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------------------------

function stockItem(def: MerchantStockDef): Item {
  const uid = `offer:${def.id}`;
  switch (def.kind) {
    case 'map': return createMapItem(def.baseId, def.tier, uid);
    case 'flask': return flaskStack(def.flaskId, def.count, uid);
    case 'currency': return currencyStack(def.currencyId, def.count, uid);
  }
}

function stockOffer(ch: CharacterSave, def: MerchantStockDef): MerchantOffer {
  let label: string;
  let description: string;
  switch (def.kind) {
    case 'map':
      label = `${mapBaseName(def.baseId)} (Tier ${def.tier})`;
      description = `A Normal Tier ${def.tier} map. ${mapBaseImplicitText(def.baseId)}`;
      break;
    case 'flask': {
      const f = getFlask(def.flaskId);
      label = def.count > 1 ? `${f.name} x${def.count}` : f.name;
      description = `${f.description} Refills a matching belt slot first.`;
      break;
    }
    case 'currency': {
      const c = findCurrency(def.currencyId);
      label = def.count > 1 ? `${c?.name} x${def.count}` : (c?.name ?? def.currencyId);
      description = c?.description ?? '';
      break;
    }
  }
  return {
    id: def.id,
    kind: def.kind,
    label,
    description: `${description} Price: ${priceText(def.price)}.`,
    item: stockItem(def),
    price: def.price.map((p) => ({ ...p })),
    affordable: canAfford(ch, def.price),
  };
}

function gambleOffer(ch: CharacterSave, itemClass: ItemClass, m: number): MerchantOffer {
  const odds = gambleOdds(itemClass, m, ch.level);
  const parts = (['magic', 'rare', 'unique', 'normal'] as const)
    .filter((r) => odds[r] > 0)
    .map((r) => ({ label: r[0].toUpperCase() + r.slice(1), chance: odds[r] }));
  const name = CLASS_LABEL[itemClass];
  return {
    id: `${GAMBLE_OFFER_PREFIX}${itemClass}`,
    kind: 'gamble',
    label: `Gamble: ${name}`,
    description: `A random ${name} of item level ${ch.level}: ${formatDistribution(parts).join(' · ')}. Price: ${priceText(GAMBLE.price)}.`,
    item: null,
    gambleClass: itemClass,
    price: GAMBLE.price.map((p) => ({ ...p })),
    affordable: canAfford(ch, GAMBLE.price),
  };
}

/** Everything Rook sells right now, with prices and affordability. */
export function merchantOffers(ch: CharacterSave): MerchantOffer[] {
  const m = gearRarityMultiplier(ch);
  return [
    ...MERCHANT_STOCK.map((def) => stockOffer(ch, def)),
    ...gambleClasses(ch).map((c) => gambleOffer(ch, c, m)),
  ];
}

function rollGamble(ch: CharacterSave, itemClass: ItemClass, uid: string): { item: Item; rngState: number } {
  const rng = createRng(ch.rngState >>> 0);
  const odds = gambleOdds(itemClass, gearRarityMultiplier(ch), ch.level);
  const rarity = rng.weighted(['unique', 'rare', 'magic', 'normal'] as const, (r) => odds[r]) ?? 'normal';
  const origin = `Gambled at ${MERCHANT_NAME}'s stall`;
  let item: Item;
  const uniques = uniqueIdsFor({ classes: [itemClass], maxLevel: ch.level });
  if (rarity === 'unique' && uniques.length) {
    const id = rng.pick(uniques);
    item = generateUnique(id, rng, { uid, itemLevel: ch.level, origin, isNew: true });
  } else {
    const baseId = pickRandomBase(rng, { classes: [itemClass], itemLevel: ch.level }) ?? 'ashwoodWand';
    const r = rarity === 'unique' ? 'rare' : rarity;
    item = generateEquipment(baseId, ch.level, r, rng, { uid, origin, isNew: true });
  }
  return { item, rngState: rng.state() };
}

/** Buy an offer: pays the price, places the item (belt slots first for flasks). Nothing is paid on failure. */
export function buyOffer(ch: CharacterSave, offerId: string): Result<{ character: CharacterSave; item: Item }> {
  const offer = merchantOffers(ch).find((o) => o.id === offerId);
  if (!offer) return fail(`${MERCHANT_NAME} does not sell that.`);
  if (!offer.affordable) {
    const p = offer.price.find((q) => currencyOnHand(ch, q.currencyId) < q.count)!;
    const name = findCurrency(p.currencyId)?.name ?? p.currencyId;
    return fail(`You need ${p.count} ${name} (you have ${currencyOnHand(ch, p.currencyId)}).`);
  }
  const minted = mintUid(ch);
  let next = minted.character;
  let item: Item;
  if (offer.kind === 'gamble' && offer.gambleClass) {
    const g = rollGamble(next, offer.gambleClass, minted.uid);
    item = g.item;
    next = { ...next, rngState: g.rngState };
  } else {
    const def = MERCHANT_STOCK.find((d) => d.id === offerId)!;
    item = { ...stockItem(def), uid: minted.uid, isNew: true };
  }
  // Pay first, then place: paying can empty the very stack that blocked the only free cell. Every step
  // is pure, so a failed placement leaves `ch` untouched (nothing is paid).
  const placed = addToBackpack(pay(next, offer.price), item);
  if (!placed.ok) return fail(placed.error);
  return ok({ character: placed.value, item });
}

/** Appraise the actual base, item level and affixes. Rarity alone never sets the price. */
export function sellQuote(item: Item): { scrap: number; lines: string[] } | null {
  if (item.kind !== 'equipment') return null;
  const pricing = EQUIPMENT_APPRAISAL, base = getBase(item.baseId);
  const baseValue = pricing.base + base.levelRequirement * pricing.perBaseLevel;
  const levelValue = item.itemLevel * pricing.perItemLevel;
  const amount = (value: number) => `${(value / pricing.perScrap).toFixed(2)} Scrap`;
  const lines = [`Base · ${base.name}: ${amount(baseValue)}`, `Item level ${item.itemLevel}: ${amount(levelValue)}`];
  let points = baseValue + levelValue;
  const unique = item.uniqueId ? getUnique(item.uniqueId) : null;
  for (const [index, affix] of item.affixes.entries()) {
    if (unique && affix.affixId === `unique:${unique.id}:${index}`) {
      points += pricing.uniqueMod;
      lines.push(`Unique modifier ${index + 1}: ${amount(pricing.uniqueMod)}`);
    } else {
      const def = getAffix(affix.affixId);
      if (!def) continue;
      const tier = def.tiers.find(t => t.tier === affix.tier);
      if (!tier) continue;
      const worst = Math.max(...def.tiers.map(t => t.tier));
      const strength = worst === 1 ? 1 : (worst - tier.tier) / (worst - 1);
      const value = Math.round(pricing.worstAffix + (pricing.bestAffix - pricing.worstAffix) * strength);
      points += value;
      lines.push(`${def.name} · T${tier.tier}: ${amount(value)}`);
    }
  }
  if (unique?.flags.length) {
    const value = unique.flags.length * pricing.uniqueFlag;
    points += value;
    lines.push(`Unique effects (${unique.flags.length}): ${amount(value)}`);
  }
  const scrap = Math.max(1, Math.ceil(points / pricing.perScrap));
  lines.push(`Total: ${amount(points)} → ${scrap} Forge Scrap (rounded up)`);
  return { scrap, lines };
}

/** Remove a confirmed backpack selection and pay in one pure operation. No partial sales. */
export function sellItems(ch: CharacterSave, uids: readonly string[], expectedScrap: number): Result<{ character: CharacterSave; scrap: number }> {
  if (!Array.isArray(uids) || !uids.length || uids.length > 60 || new Set(uids).size !== uids.length)
    return fail('Choose distinct backpack items to sell.');
  let scrap = 0;
  for (const uid of uids) {
    const item = ch.backpack.entries.find(e => e.item.uid === uid)?.item;
    if (!item) return fail('An item is no longer in your backpack. Review the sale again.');
    const quote = sellQuote(item);
    if (quote === null) return fail('Rook only buys equipment. Maps, flasks and currencies cannot be sold.');
    scrap += quote.scrap;
  }
  if (!Number.isInteger(expectedScrap) || scrap !== expectedScrap) return fail('The sale value changed. Review the payout again.');
  const sold = new Set(uids);
  let next = { ...ch, backpack: { ...ch.backpack, entries: ch.backpack.entries.filter(e => !sold.has(e.item.uid)) } };
  const stashed = Math.min(scrap, currencyStashRoom(next, 'scrap'));
  if (stashed) next = withCurrencyStashCount(next, 'scrap', currencyStashCount(next, 'scrap') + stashed);
  // Overflow uses the space freed by the sale, respecting stack limits and trade-locked stacks.
  for (let left = scrap - stashed; left > 0;) {
    const count = Math.min(left, findCurrency('scrap')!.maxStack);
    const minted = mintUid(next);
    const added = addToBackpack(minted.character, currencyStack('scrap', count, minted.uid, true));
    if (!added.ok) return fail('There is no room for the payout. Nothing was sold.');
    next = added.value;
    left -= count;
  }
  return ok({ character: next, scrap });
}
