// Command handling (contracts/net.ts Command): authority checks, then the shared rules. Every command answers
// with a CommandResult (sent as { t: 'result', id, ok, error?, message?, offers? }); state changes are pushed
// as 'character' (debounced) and, while the player stands in an instance, refreshed into the sim.
// handleCommand returns null when the answer comes later (a pickup click still out of reach: src/server/ground.ts).
//
// Where things may happen (GAME_SPEC §11–12):
//   anywhere          inventory moves between backpack / equipment / belt, discarding, dropping items on the
//                     floor, picking items up, attributes, skills, loadout, party and trade commands, chat
//   any hideout       crafting (applyCurrency, also straight from a Crafting Stash slot "cstash:<id>") and the
//                     crafting bench; the stash — the normal tabs AND the special tabs (Crafting Stash
//                     { kind: 'currencyStash' }, its work slot { kind: 'craftSlot' }, Map Stash { kind: 'mapStash' }): moves in or out (withdrawing
//                     into the backpack too), quick-moves to or from any tab, "Deposit all", tabs, dropping
//                     stashed items; and the merchant (Rook trades with everyone; you pay with your own currency)
//   own hideout       the map device (loading / unloading / activating)
// Every item command (moves, discards, "Deposit all", crafting, the bench, Rook) is checked twice: before the
// rules run (where the items sit and the named destination), and after (every stash tab and the map device the
// result changed — a quick-move routes by item kind, a swap sends the displaced item back where the moved one
// came from), so no path can reach a place that is not usable here. Crafting the map in the device therefore
// needs the owner's own hideout, like moving it.
// Leaving a map (leaveMap, respawn, the return portal) goes back to the map owner's hideout — where its portals
// are — while you may still visit it; otherwise to your own hideout (Game.sendBackFromMap).
//
// Items in an open trade offer are LOCKED: a command aimed at one is refused with ITEM_IN_TRADE, and every
// item rule runs through game.serverRules (withItemLocks), which also refuses side effects on locked items —
// "Deposit all" files every other currency stack and leaves the locked ones in the backpack.
import type { MerchantBoard, MerchantOffer, Result } from '../contracts/game';
import type { CharacterSave, CurrencyStack, ItemLocation } from '../contracts/items';
import type { Command } from '../contracts/net';
import { ROOK_MAP_OFFER_PREFIX } from '../data/progression';
import { rules } from '../game';
import { applyGuideOp } from '../game/progression/guide';
import { sortBackpack } from '../game/items/sort';
import type { Game } from './game';
import type { PlayerSession } from './session';
import { ITEM_IN_TRADE } from './trade';

export type CommandResult =
  | { ok: true; message?: string; offers?: MerchantOffer[]; board?: MerchantBoard }
  | { ok: false; error: string };

/** Longest chat line (the wire allows a little more; the server trims and enforces this). */
export const MAX_CHAT_CHARS = 200;

const OK: CommandResult = { ok: true };
const fail = (error: string): CommandResult => ({ ok: false, error });

function inHideout(s: PlayerSession): boolean {
  return s.instance?.kind === 'hideout';
}

function inOwnHideout(s: PlayerSession): boolean {
  return s.instance?.kind === 'hideout' && s.instance.ownerId === s.characterId;
}

const NEED_HIDEOUT_STASH = 'The stash can only be used in a hideout.';
const NEED_OWN_HIDEOUT_DEVICE = 'The map device is in your own hideout.';
const NEED_HIDEOUT_BENCH = 'The crafting bench is in the hideout.';

/** Whether any of `uids` sits in the sender's open trade offer. */
function lockedIn(game: Game, s: PlayerSession, ...uids: string[]): boolean {
  return uids.some((uid) => game.trades.isLocked(s.characterId, uid));
}

/** The stash: its normal tabs and the special tabs (Crafting Stash, its work slot, Map Stash) — usable in any hideout only. */
export function isStashLocation(loc: ItemLocation | null | undefined): boolean {
  return loc?.kind === 'stash' || loc?.kind === 'currencyStash' || loc?.kind === 'mapStash' || loc?.kind === 'craftSlot';
}

/** Location rules for moving an item from `from` to `to` (null = not a move, e.g. discard). */
function locationError(s: PlayerSession, from: ItemLocation, to: ItemLocation | null): string | null {
  if ((isStashLocation(from) || isStashLocation(to)) && !inHideout(s)) return NEED_HIDEOUT_STASH;
  if ((from.kind === 'mapDevice' || from.kind === 'scarabSlot' || to?.kind === 'mapDevice' || to?.kind === 'scarabSlot') && !inOwnHideout(s)) return NEED_OWN_HIDEOUT_DEVICE;
  return null;
}

/** Structural equality of plain JSON values (independent of key order; undefined fields ignored). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(rb, k) && sameValue(ra[k], rb[k]));
}

/** A part of the character differs after an operation (the rules never mutate: equal references are unchanged). */
function changed(a: unknown, b: unknown): boolean {
  return a !== b && !sameValue(a, b);
}

/**
 * The places a rules result changed must be usable where the player stands: every stash tab (normal and
 * special) only in a hideout, the map device only in their own. Checked after the rule ran, so it also covers
 * destinations the command did not name (a quick-move routes by item kind; a swap sends the displaced item
 * back where the moved one came from).
 */
function placeError(s: PlayerSession, before: CharacterSave, after: CharacterSave): string | null {
  if (before === after) return null;
  if (!inHideout(s) && (
    changed(before.stash, after.stash) || changed(before.currencyStash, after.currencyStash) || changed(before.mapStash, after.mapStash)
    || changed(before.craftSlot ?? null, after.craftSlot ?? null)
  )) return NEED_HIDEOUT_STASH;
  if (!inOwnHideout(s) && (changed(before.mapDevice, after.mapDevice) || changed(before.mapScarabs, after.mapScarabs))) return NEED_OWN_HIDEOUT_DEVICE;
  return null;
}

/** Commit a rules result: save, push, and refresh the sim runtime when it can affect combat. */
function commit(game: Game, s: PlayerSession, next: CharacterSave, runtime: boolean): void {
  if (next === s.record.ch) return;
  const slotBefore = s.record.ch.craftSlot ?? null;
  game.setCharacter(s, next);
  // The work slot holds an item that lives in no other container: write a move into, out of or crafted in it at
  // once (one transaction with the character row), so a restart can never replay half of a hand-over.
  if ((next.craftSlot ?? null) !== slotBefore) game.flushSave(s);
  if (runtime && s.instance) s.instance.updateRuntime(s);
}

function applyResult(
  game: Game, s: PlayerSession, r: Result<CharacterSave>, runtime: boolean, message?: string,
): CommandResult {
  if (!r.ok) return fail(r.error);
  commit(game, s, r.value, runtime);
  return message === undefined ? OK : { ok: true, message };
}

/** applyResult for an item move: refused (changing nothing) when it touched a place not usable here. */
function applyMove(game: Game, s: PlayerSession, before: CharacterSave, r: Result<CharacterSave>): CommandResult {
  if (!r.ok) return fail(r.error);
  const where = placeError(s, before, r.value);
  if (where) return fail(where);
  return applyResult(game, s, r, true);
}

/**
 * Commit an item-changing outcome (crafting, the bench, Rook) with its message: refused (changing nothing)
 * when it changed a place not usable here, exactly like a move — e.g. a guest crafting the map in their own
 * map device from a party member's hideout.
 */
function applyOutcome(
  game: Game, s: PlayerSession, before: CharacterSave, r: Result<{ character: CharacterSave; message: string }>,
): CommandResult {
  if (!r.ok) return fail(r.error);
  const where = placeError(s, before, r.value.character);
  if (where) return fail(where);
  commit(game, s, r.value.character, true);
  return { ok: true, message: r.value.message };
}

/** Where `uids` (items of the character) sit must be usable here; the first refusal, or null. */
function itemsPlaceError(s: PlayerSession, ch: CharacterSave, ...uids: string[]): string | null {
  for (const uid of uids) {
    const found = rules.findItem(ch, uid);
    const where = found ? locationError(s, found.location, null) : null;
    if (where) return where;
  }
  return null;
}

const formatCount = (n: number): string => n.toLocaleString('en-US');

const CSTASH_PREFIX = 'cstash:';

/**
 * Why `uid` cannot be found: an empty Crafting Stash slot ("cstash:<id>") says which currency it lacks.
 * Every item command answers a missing uid with this (src/server/ground.ts too).
 */
export function missingItem(uid: string): string {
  if (uid.startsWith(CSTASH_PREFIX)) {
    const info = (rules.content.currencies as Partial<Record<string, { name: string }>>)[uid.slice(CSTASH_PREFIX.length)];
    if (info) return `Your Crafting Stash holds no ${info.name}.`;
  }
  return 'That item no longer exists.';
}

function backpackCurrency(ch: CharacterSave): CurrencyStack[] {
  const out: CurrencyStack[] = [];
  for (const e of ch.backpack.entries) if (e.item.kind === 'currency' && e.item.count > 0) out.push(e.item);
  return out;
}

/**
 * The answer to "Deposit all": how much went into the Crafting Stash and, when some stayed behind, why (a full
 * slot, or a stack locked in the trade offer).
 */
function depositMessage(before: CharacterSave, after: CharacterSave, locked: ReadonlySet<string> | null): string {
  const total = (stacks: readonly CurrencyStack[]) => stacks.reduce((n, c) => n + c.count, 0);
  const left = backpackCurrency(after);
  const moved = total(backpackCurrency(before)) - total(left);
  const text = `Stored ${formatCount(moved)} currency in the Crafting Stash.`;
  if (left.length === 0) return text;
  const reasons: string[] = [];
  const full = new Set<string>();
  let inOffer = false;
  for (const c of left) {
    if (locked?.has(c.uid)) inOffer = true;
    else full.add(rules.content.currencies[c.currencyId]?.name ?? c.currencyId);
  }
  if (full.size > 0) reasons.push(`${[...full].join(', ')}: slot full`);
  if (inOffer) reasons.push('in your trade offer');
  return `${text} ${formatCount(total(left))} stayed in your backpack (${reasons.join('; ')}).`;
}

/**
 * Handle one command for `s`. `id` is the client's request id (for answers that come later). Returns the
 * result, or null when it will be sent later through game.answer (exactly one result per command).
 */
export function handleCommand(game: Game, s: PlayerSession, cmd: Command, id = 0): CommandResult | null {
  const ch = s.record.ch;
  const r = game.serverRules;
  switch (cmd.c) {
    // --- items & crafting ------------------------------------------------------------------
    case 'moveItem': {
      const found = rules.findItem(ch, cmd.uid);
      if (!found) return fail(missingItem(cmd.uid));
      if (lockedIn(game, s, cmd.uid)) return fail(ITEM_IN_TRADE);
      const where = locationError(s, found.location, cmd.to);
      if (where) return fail(where);
      return applyMove(game, s, ch, r.moveItem(ch, cmd.uid, cmd.to, cmd.count));
    }
    case 'quickMove': {
      const found = rules.findItem(ch, cmd.uid);
      if (!found) return fail(missingItem(cmd.uid));
      if (lockedIn(game, s, cmd.uid)) return fail(ITEM_IN_TRADE);
      const tab = cmd.stashTab;
      // An open stash tab (normal or special) means the stash is in use: hideouts only.
      if (tab !== null && !inHideout(s)) return fail(NEED_HIDEOUT_STASH);
      if (typeof tab === 'number' && (tab < 0 || tab >= ch.stash.length)) return fail('That stash tab does not exist.');
      const where = locationError(s, found.location, null);
      if (where) return fail(where);
      const ctx = cmd.count === undefined ? { stashTab: tab } : { stashTab: tab, count: cmd.count };
      return applyMove(game, s, ch, r.quickMove(ch, cmd.uid, ctx));
    }
    case 'depositAllCurrency': {
      if (!inHideout(s)) return fail(NEED_HIDEOUT_STASH);
      // Lock-aware: stacks in the trade offer stay in the backpack (refused when they are all there is).
      const deposited = r.depositAllCurrency(ch);
      if (!deposited.ok) return fail(deposited.error);
      const where = placeError(s, ch, deposited.value);
      if (where) return fail(where);
      commit(game, s, deposited.value, false);
      return { ok: true, message: depositMessage(ch, deposited.value, game.trades.lockedUids(s.characterId)) };
    }
    case 'discardItem': {
      const found = rules.findItem(ch, cmd.uid);
      if (!found) return fail(missingItem(cmd.uid));
      if (lockedIn(game, s, cmd.uid)) return fail(ITEM_IN_TRADE);
      const where = locationError(s, found.location, null);
      if (where) return fail(where);
      return applyMove(game, s, ch, r.discardItem(ch, cmd.uid));
    }
    case 'dropItem':
      return game.ground.drop(s, cmd.uid);
    case 'pickup':
      return game.ground.pickup(s, id, cmd.dropId);
    case 'applyCurrency': {
      // The currency may be a backpack / stash stack or a Crafting Stash slot ("cstash:<id>", each use draws
      // one from it): crafting — like the stash — works in any hideout and nowhere else; the map in the device
      // only in its owner's own hideout (where alone it can be moved).
      if (!inHideout(s)) return fail('Crafting only works in a hideout.');
      if (!rules.findItem(ch, cmd.currencyUid)) return fail(missingItem(cmd.currencyUid));
      if (!rules.findItem(ch, cmd.targetUid)) return fail(missingItem(cmd.targetUid));
      if (lockedIn(game, s, cmd.currencyUid, cmd.targetUid)) return fail(ITEM_IN_TRADE);
      const where = itemsPlaceError(s, ch, cmd.currencyUid, cmd.targetUid);
      if (where) return fail(where);
      return applyOutcome(game, s, ch, r.applyCurrency(ch, cmd.currencyUid, cmd.targetUid, cmd.affixIndex));
    }
    case 'benchCraft': {
      if (!inHideout(s)) return fail(NEED_HIDEOUT_BENCH);
      if (!rules.findItem(ch, cmd.targetUid)) return fail(missingItem(cmd.targetUid));
      if (lockedIn(game, s, cmd.targetUid)) return fail(ITEM_IN_TRADE);
      const where = itemsPlaceError(s, ch, cmd.targetUid);
      if (where) return fail(where);
      const service = r.benchServices(ch, cmd.targetUid).find(service => service.id === cmd.recipeId);
      if (service && cmd.expectedScrap !== service.cost[0].count) return fail('The Scrap price changed. Review the current price and try again.');
      return applyOutcome(game, s, ch, r.applyBenchRecipe(ch, cmd.targetUid, cmd.recipeId));
    }
    case 'benchClear': {
      if (!inHideout(s)) return fail(NEED_HIDEOUT_BENCH);
      if (!rules.findItem(ch, cmd.targetUid)) return fail(missingItem(cmd.targetUid));
      if (lockedIn(game, s, cmd.targetUid)) return fail(ITEM_IN_TRADE);
      const where = itemsPlaceError(s, ch, cmd.targetUid);
      if (where) return fail(where);
      return applyOutcome(game, s, ch, r.clearCraftedAffix(ch, cmd.targetUid));
    }
    case 'benchRecycle': {
      if (!inHideout(s)) return fail(NEED_HIDEOUT_BENCH);
      for (const uid of cmd.uids) if (!rules.findItem(ch, uid)) return fail(missingItem(uid));
      if (lockedIn(game, s, ...cmd.uids)) return fail(ITEM_IN_TRADE);
      const where = itemsPlaceError(s, ch, ...cmd.uids);
      if (where) return fail(where);
      const quote = r.recycleQuote(ch, cmd.uids, cmd.areaId);
      if (!quote.error && cmd.expectedScrap !== undefined && cmd.expectedScrap !== quote.scrap) return fail('The Scrap price changed. Review the current price and try again.');
      return applyOutcome(game, s, ch, r.recycleMaps(ch, cmd.uids, cmd.areaId));
    }
    case 'refillSurge': {
      // Hourglass Sand / Grand Hourglass (brief D 7.4): the item and the account's surge ledger change in one save, by the server clock.
      if (!inHideout(s)) return fail('Use an Hourglass on the Atlas table in a hideout.');
      const used = r.refillSurge(ch, cmd.areaId ? { kind: 'area', areaId: cmd.areaId } : { kind: 'all' }, game.now());
      if (!used.ok) return fail(used.error);
      if (!game.store.commit(s.record, used.value.character)) return fail('The hourglass could not be used. Nothing was spent; try again.');
      s.pushCharacter('now');
      return { ok: true, message: used.value.message };
    }
    case 'slotSigil': {
      // Beacons (brief D 6): the sigil leaves the backpack and the account's beacon changes in one save. Hideout only, inventory first.
      if (!inHideout(s)) return fail('Sigils are slotted on the Atlas table in a hideout.');
      if (!rules.findItem(ch, cmd.uid)) return fail(missingItem(cmd.uid));
      if (lockedIn(game, s, cmd.uid)) return fail(ITEM_IN_TRADE);
      const slotted = r.slotSigil(ch, cmd.areaId, cmd.slot, cmd.uid);
      if (!slotted.ok) return fail(slotted.error);
      if (!game.store.commit(s.record, slotted.value.character)) return fail('The sigil could not be slotted. Nothing changed; try again.');
      s.pushCharacter('now');
      return { ok: true, message: slotted.value.message };
    }
    case 'unslotSigil': {
      if (!inHideout(s)) return fail('Sigils are taken out on the Atlas table in a hideout.');
      const taken = r.unslotSigil(ch, cmd.areaId, cmd.slot);
      if (!taken.ok) return fail(taken.error);
      if (!game.store.commit(s.record, taken.value.character)) return fail('The sigil could not be taken out. Nothing changed; try again.');
      s.pushCharacter('now');
      return { ok: true, message: taken.value.message };
    }
    case 'pinArea':
      // Pins are an account setting: free, instant and allowed anywhere (the chart is read in the hideout, the result is what counts).
      return applyResult(game, s, r.setPin(ch, cmd.areaId, cmd.pinned), false);
    case 'addStashTab':
      if (!inHideout(s)) return fail(NEED_HIDEOUT_STASH);
      return applyResult(game, s, r.addStashTab(ch), false);
    case 'renameStashTab':
      if (!inHideout(s)) return fail(NEED_HIDEOUT_STASH);
      return applyResult(game, s, r.renameStashTab(ch, cmd.tab, cmd.name.trim()), false);
    case 'clearNewFlags':
      commit(game, s, rules.clearNewFlags(ch), false);
      return OK;
    case 'sortBackpack':
      return applyResult(game, s, sortBackpack(ch), false);
    case 'guide': {
      // The first-run guide is account state and purely informational: idempotent, never refused for being early or late.
      if (!ch.guide) return OK;
      const next = applyGuideOp(ch.guide, cmd, game.now());
      if (!next) return OK;
      commit(game, s, { ...ch, guide: next }, false);
      if (cmd.op === 'skip' || cmd.op === 'finish' || cmd.op === 'replay') game.log.info('guide', { character: s.name, op: cmd.op });
      return OK;
    }

    // --- character -------------------------------------------------------------------------
    case 'allocateAttribute':
      return applyResult(game, s, rules.allocateAttribute(ch, cmd.attr), true);
    case 'rankUpSkill':
      return applyResult(game, s, rules.rankUpSkill(ch, cmd.skillId), true);
    case 'setLoadoutSlot':
      return applyResult(game, s, rules.setLoadoutSlot(ch, cmd.slot, cmd.skillId), true);
    case 'pickAugment':
      return applyResult(game, s, rules.pickAugment(ch, cmd.skillId, cmd.augmentId), true);
    case 'refundAugment':
    case 'respec': {
      // Refunds are a hideout service paid in Scrap (skills.md 9): the price is checked against what the client showed, and the
      // Scrap, the points and the skill change are one character value written in one commit, so nothing can be half-refunded.
      if (!inHideout(s)) return fail('Skills and augments are refunded in a hideout.');
      const price = cmd.c === 'refundAugment'
        ? rules.respecPrice(ch, { skillId: cmd.skillId, augmentId: cmd.augmentId })
        : cmd.token ? { scrap: 0 } : rules.respecPrice(ch, cmd.skillId === null ? { all: true } : { skillId: cmd.skillId });
      if (price.scrap !== cmd.expectedScrap) return fail(`The refund costs ${price.scrap} Forge Scrap now. Look again and confirm.`);
      const done = cmd.c === 'refundAugment' ? rules.refundAugment(ch, cmd.skillId, cmd.augmentId) : rules.respec(ch, cmd.skillId, cmd.token);
      if (!done.ok) return fail(done.error);
      if (!game.store.commit(s.record, done.value)) return fail('The refund could not be saved. Nothing was refunded or paid; try again.');
      s.pushCharacter('now');
      s.instance?.updateRuntime(s);
      return { ok: true, message: price.scrap > 0 ? `Refunded for ${price.scrap} Forge Scrap.` : 'Refunded.' };
    }
    case 'setPreset':
      // Presets switch the whole bar: only between maps (skills.md 9), saving and renaming anywhere.
      if (cmd.op === 'load' && !inHideout(s)) return fail('Loadout presets are switched in a hideout.');
      return applyResult(game, s, rules.setPreset(ch, cmd.preset, cmd.op, cmd.name), cmd.op === 'load');

    // --- hideout ---------------------------------------------------------------------------
    case 'setMapTreeNode': {
      if (!inOwnHideout(s)) return fail('Change your map tree in your own hideout.');
      const changed = r.setMapTreeNode(ch, cmd.nodeId, cmd.allocate);
      if (!changed.ok) return fail(changed.error);
      if (!game.store.commit(s.record, changed.value)) return fail('The map tree could not be saved. No point or Scrap was spent; try again.');
      s.pushCharacter('now');
      return OK;
    }
    case 'activateMapDevice':
      {
      // A client from before area-bound maps may still send the area it chose: accepted only when it is the map's own.
      const device = ch.mapDevice;
      if (cmd.areaId && device && cmd.areaId !== device.areaId) return fail('This map is bound to another area. Reload the game to update.');
      return game.activateMapDevice(s, {
        ...(cmd.lootClass ? { lootClass: cmd.lootClass } : {}),
        ...(cmd.pit ? { passage: { kind: 'bounty' as const } } : cmd.passageKey ? { passage: { kind: 'key' as const, currencyId: cmd.passageKey } } : {}),
        ...(cmd.useSurge !== undefined ? { useSurge: cmd.useSurge } : {}),
      });
    }
    case 'merchantOffers':
      if (!inHideout(s)) return fail('Rook only trades in a hideout.');
      return { ok: true, offers: r.merchantOffers(ch) };
    case 'merchantWares': {
      if (!inHideout(s)) return fail('Rook only trades in a hideout.');
      // The board is a pure function of the character, the clock and the saved stock epoch; the first look at a new epoch saves its state.
      const { character, board } = r.waresBoard(ch, game.now());
      if (character !== ch) {
        game.setCharacter(s, character);
        game.flushSave(s);
      }
      return { ok: true, board };
    }
    case 'buyWare': {
      if (!inHideout(s)) return fail('Rook only trades in a hideout.');
      const now = game.now();
      const bought = r.buyWare(ch, cmd.wareId, now, cmd.at);
      if (!bought.ok) return fail(bought.error);
      const where = placeError(s, ch, bought.value.character);
      if (where) return fail(where);
      // Scrap, the item and the sold slot are one character value: written at once, so a restart can never replay or lose half of a sale.
      commit(game, s, bought.value.character, true);
      game.flushSave(s);
      return { ok: true, message: `Bought ${rules.describeItem(bought.value.item, bought.value.character).title}.`, board: r.waresBoard(bought.value.character, now).board };
    }
    case 'rerollWares': {
      if (!inHideout(s)) return fail('Rook only trades in a hideout.');
      const now = game.now();
      const asked = r.rerollWares(ch, now, { epoch: cmd.epoch, cost: cmd.cost });
      if (!asked.ok) return fail(asked.error);
      const where = placeError(s, ch, asked.value.character);
      if (where) return fail(where);
      commit(game, s, asked.value.character, false);
      game.flushSave(s);
      return { ok: true, message: 'Rook rummages for new wares.', board: r.waresBoard(asked.value.character, now).board };
    }
    case 'buyOffer': {
      if (!inHideout(s)) return fail('Rook only trades in a hideout.');
      // Maps come from the wares board only (buyWare); the old map:<area>:<tier>:<grade> picker rows are gone.
      if (cmd.offerId.startsWith(ROOK_MAP_OFFER_PREFIX)) return fail('Rook sells maps on his wares board now. Open the Wares tab.');
      const bought = r.buyOffer(ch, cmd.offerId, cmd.at);
      if (!bought.ok) return fail(bought.error);
      const where = placeError(s, ch, bought.value.character);
      if (where) return fail(where);
      commit(game, s, bought.value.character, true);
      return { ok: true, message: `Bought ${rules.describeItem(bought.value.item, bought.value.character).title}.` };
    }
    case 'sellItems': {
      if (!inHideout(s)) return fail('Visit Rook in a hideout to sell equipment.');
      const sold = r.sellItems(ch, cmd.uids, cmd.expectedScrap);
      if (!sold.ok) return fail(sold.error);
      if (!game.store.commit(s.record, sold.value.character)) return fail('The sale could not be saved. Nothing was sold; try again.');
      s.pushCharacter('now');
      return { ok: true, message: `Sold ${cmd.uids.length} item${cmd.uids.length === 1 ? '' : 's'} for ${sold.value.scrap} Forge Scrap.` };
    }
    case 'buyDebugOffer': {
      const instance = s.instance;
      if (!instance || instance.kind !== 'hideout' || !game.db.debugMerchantEnabled(instance.ownerId))
        return fail('The testing merchant is not active in this hideout.');
      const bought = r.buyDebugOffer(ch, cmd.offerId, cmd.options, cmd.at);
      if (!bought.ok) return fail(bought.error);
      if (!game.store.commit(s.record, bought.value.character)) return fail('The purchase could not be saved. Nothing was added; try again.');
      s.pushCharacter('now');
      instance.updateRuntime(s);
      return { ok: true, message: bought.value.message };
    }

    // --- party & social --------------------------------------------------------------------
    case 'partyInvite':
      return partyInvite(game, s, cmd.name);
    case 'partyRespond':
      return partyRespond(game, s, cmd.inviteId, cmd.accept);
    case 'partyLeave':
      if (!game.leaveParty(s.characterId, 'left')) return fail('You are not in a party.');
      return OK;
    case 'partyKick': {
      const error = game.parties.kickError(s.characterId, cmd.characterId);
      if (error) return fail(error);
      game.sessions.get(cmd.characterId)?.toast('You were removed from the party.', 'bad');
      game.leaveParty(cmd.characterId, 'kicked');
      return OK;
    }
    case 'partyPromote': {
      // Leadership must go to someone who can use it: an offline leader would leave the party stuck.
      if (game.parties.sameParty(s.characterId, cmd.characterId) && cmd.characterId !== s.characterId && !game.sessions.has(cmd.characterId)) {
        return fail(`${game.nameOf(cmd.characterId)} is offline.`);
      }
      const r = game.parties.promote(s.characterId, cmd.characterId);
      if (!r.ok) return fail(r.error);
      game.systemChat(r.value.members, `${game.nameOf(cmd.characterId)} now leads the party.`);
      game.markParty(s.characterId);
      return OK;
    }
    case 'visitHideout':
      return visitHideout(game, s, cmd.characterId);
    case 'usePortal':
      return game.usePortal(s, cmd.propId);
    case 'leaveMap':
      if (s.instance?.kind !== 'map') return fail('You are not in a map.');
      game.sendBackFromMap(s, s.instance);
      return OK;
    case 'respawn':
      if (s.instance?.kind !== 'map') return fail('There is nothing to return from.');
      if (!s.instance.isDead(s)) return fail('You are still alive.');
      game.sendBackFromMap(s, s.instance);
      return OK;
    case 'chat':
      return chat(game, s, cmd.text, cmd.channel ?? 'party');

    // --- trading ---------------------------------------------------------------------------
    case 'tradeRequest':
      return game.trades.request(s, cmd.name);
    case 'tradeRespond':
      return game.trades.respond(s, cmd.requestId, cmd.accept);
    case 'tradeOffer':
      return game.trades.offer(s, cmd.tradeId, cmd.uids);
    case 'tradeAccept':
      return game.trades.accept(s, cmd.tradeId, cmd.accept);
    case 'tradeCancel':
      return game.trades.cancel(s, cmd.tradeId);
  }
}

function partyInvite(game: Game, s: PlayerSession, rawName: string): CommandResult {
  const name = rawName.trim().replace(/\s+/g, ' ');
  const lower = name.toLowerCase();
  let target: PlayerSession | null = null;
  for (const other of game.sessions.values()) if (other.name.toLowerCase() === lower) target = other;
  if (!target) {
    const row = game.db.characterByName(name);
    return fail(row ? `${row.name} is not online.` : `There is no character named "${name}".`);
  }
  const r = game.parties.invite({ id: s.characterId, name: s.name }, { id: target.characterId, name: target.name });
  if (!r.ok) return fail(r.error);
  // A repeated invite only renews the pending one: the invitee already has its popup.
  if (r.value.renewed) return { ok: true, message: `Your invite to ${target.name} is still pending.` };
  const inv = r.value.invite;
  target.send({ t: 'invite', invite: { inviteId: inv.id, fromCharacterId: s.characterId, fromName: s.name } });
  return { ok: true, message: `Invited ${target.name} to your party.` };
}

function partyRespond(game: Game, s: PlayerSession, inviteId: string, accept: boolean): CommandResult {
  if (!accept) {
    const r = game.parties.decline(s.characterId, inviteId);
    if (!r.ok) return fail(r.error);
    game.sessions.get(r.value.fromId)?.toast(`${s.name} declined your party invite.`, 'info');
    return OK;
  }
  const inv = game.parties.getInvite(inviteId);
  if (!inv || inv.toId !== s.characterId) return fail('That invite has expired or was withdrawn.');
  if (!game.sessions.has(inv.fromId)) {
    game.parties.decline(s.characterId, inviteId, false);
    return fail(`${inv.fromName} is no longer online.`);
  }
  const r = game.parties.accept(s.characterId, inviteId);
  if (!r.ok) return fail(r.error);
  game.systemChat(r.value.party.members, `${s.name} joined the party.`);
  game.markParty(s.characterId);
  return { ok: true, message: `You joined ${inv.fromName}'s party.` };
}

function visitHideout(game: Game, s: PlayerSession, targetId: string): CommandResult {
  if (targetId === s.characterId) {
    if (inOwnHideout(s)) return { ok: true, message: 'You are already home.' };
    game.sendHome(s);
    return OK;
  }
  if (!game.parties.sameParty(s.characterId, targetId)) return fail('You can only visit the hideouts of your party members.');
  const owner = game.sessions.get(targetId);
  if (!owner) return fail('That party member is offline.');
  const hideout = game.hideoutFor(targetId, owner.name);
  if (s.instance === hideout) return { ok: true, message: `You are already in ${owner.name}'s hideout.` };
  if (!hideout.hasRoom) return fail(`${owner.name}'s hideout is full.`);
  game.moveTo(s, hideout);
  return OK;
}

function chat(game: Game, s: PlayerSession, raw: string, channel: 'global' | 'party'): CommandResult {
  const text = raw.trim();
  if (!text) return fail('Type a message first.');
  // "/trade <name>" works even when the client sends it as a chat line.
  const trade = /^\/trade(?:\s+(.*))?$/i.exec(text);
  if (trade) return game.trades.request(s, trade[1] ?? '');
  if (text.length > MAX_CHAT_CHARS) return fail(`Messages can be at most ${MAX_CHAT_CHARS} characters.`);
  const party = game.parties.partyOf(s.characterId);
  if (channel === 'party' && !party) return fail('Join a party to use party chat.');
  if (!s.chat.take(game.now())) return fail('You are sending messages too quickly.');
  const msg = { t: 'chat' as const, fromName: s.name, text, time: Date.now(), channel };
  if (channel === 'global') for (const player of game.sessions.values()) player.send(msg);
  else for (const id of party!.members) game.sessions.get(id)?.send(msg);
  return OK;
}
