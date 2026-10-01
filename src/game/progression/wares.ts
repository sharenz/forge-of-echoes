// Rook's wares board (GAME_SPEC §9). Four maps and eight items per character, rolled from a seed and mostly junk; sometimes a really
// good find. The player picks nothing: no tier, quality or area. Everything here is pure; the server clock is always an argument.
//
//   stock epoch   (rotation, character level, rerolls). rotation = floor((now - 04:00 UTC) / 6 h), the forge clock of the daily surge.
//                 A new rotation, a level-up or a paid reroll gives new wares; the sold slots clear with the epoch.
//   the board     generateWares(characterId, state): a pure function of the character id and the stock epoch (plus the inputs snapshotted
//                 in `state` when the epoch began, so discovering an area mid-rotation cannot move the stock).
//   luck          every slot rolls junk / okay / good / jackpot (data/progression/merchant.ts WARES.odds); the first item slot,
//                 "Rook's pick", has doubled odds of the lucky tiers. Slot 0 is always a plain Normal quality-0 map at the character's
//                 current tier (the guaranteed cheap map), so nobody is map-locked.
//   persistence   CharacterSave.wares (epoch + sold slots + snapshot). A purchase commits the Scrap payment, the item and the sold slot as one
//                 character value, so the server saves them in one transaction.
import type { AtlasAreaId } from '../../contracts/atlas';
import type { CharacterSave, EquipmentItem, Item, MapItem, WaresState } from '../../contracts/items';
import type { MerchantBoard, MerchantWare, Result, WareQuality } from '../../contracts/game';
import type { CurrencyId } from '../../contracts/content';
import { createRng, hashString } from '../../core/rng';
import type { Rng } from '../../contracts/rng';
import { findCurrency } from '../../data/items';
import { GAMBLE, MERCHANT_NAME, WARES, WARE_ITEM_TABLE, WARE_ORIGIN, WARE_QUALITIES } from '../../data/progression';
import type { WareItemEntry } from '../../data/progression';
import { ATLAS_START, atlasTierCeiling, findAtlasArea } from '../../data/progression/atlas';
import { SCARABS, findScarab } from '../../data/scarabs';
import {
  clampItemLevel, currencyStack, generateEquipment, generateUnique, mintUid, pickRandomBase, uniqueIdsFor,
} from '../items';
import { addBoughtItem, canAfford, currencyOnHand, pay, sellQuote } from './merchant';
import type { BackpackCell } from './merchant';
import { isMapAddress } from './map-binding';
import { createMapItem, rollMapWithRarity } from './maps';
import { forgeRotation, forgeRotationStart } from './surge';
import { fail, ok } from './util';

/** Slots of a board: 0..3 maps, 4..11 items; 4 is Rook's pick. */
export const MAP_SLOT_COUNT = WARES.mapSlots;
export const WARE_SLOT_COUNT = WARES.mapSlots + WARES.itemSlots;
export const FEATURED_SLOT = WARES.mapSlots;
export const GUARANTEED_MAP_SLOT = 0;

const SCRAP: CurrencyId = 'scrap';

// ---------------------------------------------------------------------------------------------
// The stock epoch
// ---------------------------------------------------------------------------------------------

/** Rotation index of a server time (ms): wares change at 04:00 UTC + n x 6 h. */
export const waresRotation = (now: number): number => forgeRotation(now, WARES.rotationHours);

/** Server time (ms) at which rotation `index` starts. */
export const waresRotationStart = (index: number): number => forgeRotationStart(index, WARES.rotationHours);

/** The epoch id: any change of rotation, level or reroll count means new wares. */
export const epochId = (s: Pick<WaresState, 'rotation' | 'level' | 'rerolls'>): string => `${s.rotation}.${s.level}.${s.rerolls}`;

export const wareId = (epoch: string, slot: number): string => `ware:${epoch}:${slot}`;

/** `ware:<rotation>.<level>.<rerolls>:<slot>` back to its parts, or null when malformed. */
export function parseWareId(id: unknown): { epoch: string; slot: number } | null {
  if (typeof id !== 'string') return null;
  const m = /^ware:(-?\d{1,9}\.\d{1,4}\.\d{1,4}):(0|[1-9]\d?)$/.exec(id);
  return m ? { epoch: m[1], slot: Number(m[2]) } : null;
}

/** Scrap price of "Ask for new wares" after `rerolls` uses in this rotation: 3, 6, 12, 24, 48, 48 ... */
export function rerollCost(rerolls: number): number {
  const n = Math.max(0, Math.floor(rerolls));
  return Math.min(WARES.reroll.max, WARES.reroll.base * 2 ** Math.min(n, 30));
}

/** The areas a map of Rook's can be bound to for this character: discovered and bindable (always at least the starting area). */
function openAreas(ch: CharacterSave): string[] {
  const seen = new Set<string>([ATLAS_START, ...(ch.atlas?.discovered ?? [])]);
  const out = [...seen].filter((id) => { const a = findAtlasArea(id); return !!a && isMapAddress(a); }).sort();
  return out.length ? out : [ATLAS_START];
}

function freshState(ch: CharacterSave, rotation: number, rerolls: number): WaresState {
  return { rotation, level: ch.level, rerolls, sold: [], tier: Math.max(0, Math.floor(ch.stats?.highestTierCompleted ?? 0)), areas: openAreas(ch) };
}

/**
 * The character's stock epoch at server time `now`: the saved one while it still holds, else a fresh one (no sold slots).
 * A new rotation resets the reroll count; a level-up keeps it (the price is per rotation). The clock stepping back never
 * brings an old rotation back.
 */
export function waresStateAt(ch: CharacterSave, now: number): WaresState {
  const current = waresRotation(now);
  const saved = ch.wares;
  if (!saved || saved.rotation < current) return freshState(ch, current, 0);
  if (saved.level !== ch.level) return freshState(ch, saved.rotation, saved.rerolls);
  return saved;
}

// ---------------------------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------------------------

/** Scrap price of a map: tier base, plus quality, times rarity. T1 Normal quality 0 costs 1. */
export function mapPrice(map: Pick<MapItem, 'tier' | 'quality' | 'rarity'>): number {
  const p = WARES.price;
  const base = p.mapBase + (Math.max(1, map.tier) - 1) * p.mapPerTier;
  return Math.max(1, Math.ceil(base * (1 + map.quality / p.mapQualityShare) * p.mapRarity[map.rarity]));
}

/** Scrap price of any ware: the appraisal (sellQuote) times the markup for gear, tables for maps, scarabs and currency. Always >= 1. */
export function warePrice(item: Item): number {
  switch (item.kind) {
    case 'equipment': return Math.max(1, Math.ceil((sellQuote(item)?.scrap ?? 1) * WARES.price.markup * (item.uniqueId ? WARES.price.uniqueMarkup : 1)));
    case 'map': return mapPrice(item);
    case 'currency': {
      const scarab = findScarab(item.currencyId);
      const unit = scarab
        ? WARES.price.scarabByTier[Math.min(WARES.price.scarabByTier.length, scarab.tier) - 1]
        : (WARES.price.currency as Partial<Record<string, number>>)[item.currencyId] ?? WARES.price.currencyDefault;
      return Math.max(1, Math.ceil(unit * item.count));
    }
    case 'flask': return 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Rolling
// ---------------------------------------------------------------------------------------------

export interface WareSpec {
  slot: number;
  kind: 'map' | 'item';
  quality: WareQuality;
  featured: boolean;
  guaranteed: boolean;
  /** A preview item with uid `ware:<epoch>:<slot>`; buying mints a real uid, everything else is identical. */
  item: Item;
  /** Scrap. */
  price: number;
}

/** The luck tier of a slot: junk / okay / good / jackpot, from the slot's own stream. */
export function rollQuality(rng: Rng, featured: boolean): WareQuality {
  const odds = featured ? WARES.pickOdds : WARES.odds;
  return rng.weighted(WARE_QUALITIES, (q) => odds[q]) ?? 'junk';
}

/** The stream of one slot of one epoch of one character: independent of every other slot. */
const slotRng = (characterId: string, epoch: string, slot: number): Rng => createRng(hashString(`wares1|${characterId}|${epoch}|${slot}`));

/** Just the luck tiers of a board (the first draw of every slot's stream; slot 0 is always junk): what the generator rolls first, for distribution tests. */
export function boardQualities(characterId: string, state: WaresState): WareQuality[] {
  const epoch = epochId(state);
  return Array.from({ length: WARE_SLOT_COUNT }, (_, slot) => (slot === GUARANTEED_MAP_SLOT ? 'junk' : rollQuality(slotRng(characterId, epoch, slot), slot === FEATURED_SLOT)));
}

const span = (rng: Rng, [lo, hi]: readonly [number, number]): number => rng.int(lo, hi);

function rollMap(rng: Rng, state: WaresState, quality: WareQuality, uid: string): MapItem {
  const spec = WARES.map;
  const areaId = rng.pick(state.areas) as AtlasAreaId;
  const area = findAtlasArea(areaId)!;
  let tier = Math.max(1, state.tier + 1 + span(rng, spec.tierOffset[quality]));
  if (rng.chance(spec.higherChance)) tier += rng.int(1, 2);
  tier = Math.max(1, Math.min(atlasTierCeiling(area), tier));
  const q = rng.chance(spec.zeroQuality[quality]) ? 0 : span(rng, spec.quality[quality]);
  const odds = spec.rarity[quality];
  const rarity = rng.weighted(['normal', 'magic', 'rare'] as const, (r) => odds[r]) ?? 'normal';
  return rollMapWithRarity(rng, area.id, tier, rarity, uid, q, false);
}

function rollEquipment(rng: Rng, level: number, quality: WareQuality, rarity: 'normal' | 'magic' | 'rare', uid: string): EquipmentItem {
  const ilvl = clampItemLevel(level + span(rng, WARES.itemLevelOffset[quality]));
  const baseId = pickRandomBase(rng, { classes: GAMBLE.classes, itemLevel: ilvl }) ?? 'ashwoodWand';
  return generateEquipment(baseId, ilvl, rarity, rng, { uid, origin: WARE_ORIGIN });
}

function rollEntry(rng: Rng, state: WaresState, quality: WareQuality, entry: WareItemEntry, uid: string): Item | null {
  switch (entry.kind) {
    case 'equipment': return rollEquipment(rng, state.level, quality, entry.rarity, uid);
    case 'unique': {
      const ilvl = clampItemLevel(state.level + span(rng, WARES.itemLevelOffset[quality]));
      const ids = uniqueIdsFor({ maxLevel: state.level + WARES.uniqueLevelSlack });
      if (!ids.length) return null;
      return generateUnique(rng.pick(ids), rng, { uid, itemLevel: ilvl, origin: WARE_ORIGIN });
    }
    case 'currency': {
      const pick = rng.pick(entry.pool);
      return findCurrency(pick.id) ? currencyStack(pick.id, span(rng, pick.count), uid) : null;
    }
    case 'scarab': {
      const eligible = SCARABS.filter((s) => s.tier <= entry.maxTier && s.minMonsterLevel <= state.level + (quality === 'jackpot' ? 10 : 0));
      const pool = quality === 'jackpot' ? eligible.filter((s) => s.tier === Math.max(...eligible.map((e) => e.tier))) : eligible;
      const scarab = rng.weighted(pool, (s) => s.weight);
      return scarab ? currencyStack(scarab.id, 1, uid) : null;
    }
  }
}

/** An item slot: a table entry by weight; an entry that cannot yield anything yet (no scarab at level 1) falls back to gear of the tier. */
function rollItem(rng: Rng, state: WaresState, quality: WareQuality, uid: string): Item {
  const table = WARE_ITEM_TABLE[quality];
  const entry = rng.weighted(table, (e) => e.weight) ?? table[0];
  const made = rollEntry(rng, state, quality, entry, uid);
  if (made) return made;
  const gear = table.find((e): e is Extract<WareItemEntry, { kind: 'equipment' }> => e.kind === 'equipment')!;
  return rollEquipment(rng, state.level, quality, gear.rarity, uid);
}

/**
 * The whole board of a stock epoch. Pure: the same character id and state always give the same wares, in the same order.
 * Slots 0-3 are maps (0: the guaranteed plain map at the character's current tier), 4-11 are items (4: Rook's pick).
 */
export function generateWares(characterId: string, state: WaresState): WareSpec[] {
  const epoch = epochId(state);
  const out: WareSpec[] = [];
  for (let slot = 0; slot < WARE_SLOT_COUNT; slot++) {
    const rng = slotRng(characterId, epoch, slot);
    const uid = wareId(epoch, slot);
    const isMap = slot < MAP_SLOT_COUNT;
    const guaranteed = slot === GUARANTEED_MAP_SLOT;
    const featured = slot === FEATURED_SLOT;
    const quality: WareQuality = guaranteed ? 'junk' : rollQuality(rng, featured);
    let item: Item;
    if (guaranteed) {
      const area = findAtlasArea(rng.pick(state.areas))!;
      item = createMapItem(area.id, Math.max(1, Math.min(atlasTierCeiling(area), state.tier)), uid, { quality: 0, rarity: 'normal' });
    } else if (isMap) {
      item = rollMap(rng, state, quality, uid);
    } else {
      item = rollItem(rng, state, quality, uid);
    }
    out.push({ slot, kind: isMap ? 'map' : 'item', quality, featured, guaranteed, item, price: warePrice(item) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The board, buying and asking for new wares
// ---------------------------------------------------------------------------------------------

function boardOf(ch: CharacterSave, state: WaresState, now: number): MerchantBoard {
  const epoch = epochId(state);
  const sold = new Set(state.sold);
  const wares: MerchantWare[] = generateWares(ch.id, state).map((w) => ({
    id: wareId(epoch, w.slot), slot: w.slot, kind: w.kind, item: w.item, quality: w.quality, featured: w.featured, guaranteed: w.guaranteed,
    price: [{ currencyId: SCRAP, count: w.price }], sold: sold.has(w.slot),
  }));
  return {
    epoch, rotation: state.rotation, level: state.level, rerolls: state.rerolls, wares,
    nextRotationAt: waresRotationStart(state.rotation + 1), serverNow: now, rerollCost: rerollCost(state.rerolls),
  };
}

/** The character's board at `now`, and the character carrying the (possibly new) wares state: the server saves it so the epoch is stable. */
export function waresBoard(ch: CharacterSave, now: number): { character: CharacterSave; board: MerchantBoard } {
  const state = waresStateAt(ch, now);
  return { character: ch.wares === state ? ch : { ...ch, wares: state }, board: boardOf(ch, state, now) };
}

const STALE = `${MERCHANT_NAME} has new wares. Take another look.`;

function lack(ch: CharacterSave, count: number): string {
  return `You need ${count} Forge Scrap (you have ${currencyOnHand(ch, SCRAP)}).`;
}

/**
 * Buy one ware. Refused (nothing paid) when the id is malformed, its epoch is not the character's current one (stale view), the slot is
 * sold, the Scrap cannot be paid or the backpack has no room. The payment, the item and the sold slot are one returned character.
 */
export function buyWare(ch: CharacterSave, id: string, now: number, at?: BackpackCell): Result<{ character: CharacterSave; item: Item }> {
  const parsed = parseWareId(id);
  if (!parsed || parsed.slot >= WARE_SLOT_COUNT) return fail(`${MERCHANT_NAME} does not sell that.`);
  const state = waresStateAt(ch, now);
  if (parsed.epoch !== epochId(state)) return fail(STALE);
  if (state.sold.includes(parsed.slot)) return fail('That one is already sold.');
  const spec = generateWares(ch.id, state)[parsed.slot];
  const price = [{ currencyId: SCRAP, count: spec.price }];
  if (!canAfford(ch, price)) return fail(lack(ch, spec.price));
  const minted = mintUid(ch);
  const item: Item = { ...spec.item, uid: minted.uid, isNew: true };
  // Pay first, then place: paying can empty the very stack that blocked the only free cell. Every step is pure.
  const placed = addBoughtItem(pay(minted.character, price), item, at);
  if (!placed.ok) return fail(placed.error);
  return ok({ character: { ...placed.value, wares: { ...state, sold: [...state.sold, parsed.slot].sort((a, b) => a - b) } }, item });
}

/**
 * "Ask for new wares": pays the doubling Scrap price, bumps the reroll count (the salt) and clears the sold slots. `expect` (the epoch and
 * price the player saw) makes a stale click refuse instead of charging a different price.
 */
export function rerollWares(ch: CharacterSave, now: number, expect?: { epoch: string; cost: number }): Result<{ character: CharacterSave }> {
  const state = waresStateAt(ch, now);
  const cost = rerollCost(state.rerolls);
  if (expect && (expect.epoch !== epochId(state) || expect.cost !== cost)) return fail(STALE);
  const price = [{ currencyId: SCRAP, count: cost }];
  if (!canAfford(ch, price)) return fail(lack(ch, cost));
  const next = freshState(ch, state.rotation, state.rerolls + 1);
  return ok({ character: { ...pay(ch, price), wares: next } });
}
