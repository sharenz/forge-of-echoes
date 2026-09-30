// Online integration helpers for the authoritative server (beyond the frozen GameRulesApi).
//
// WHY: every out-of-run random outcome — crafting (Workbench and map currencies, Void Needle, the value a
// Crafting Bench recipe rolls), the gamble, and the seed of an opened map — is drawn from CharacterSave.rngState, a 32-bit state that
// the pure rules advance deterministically. The client runs the same rules for display, so if it ever
// learns rngState it can compute the exact result of the next craft or gamble before sending it, and
// burn rng steps with cheap actions (Map Dust, a free Tier 1 map) until the next result is the one it
// wants. Two rules close that hole, and the server must apply BOTH:
//
//   1. Reseed before use. Mix fresh, server-only entropy into rngState right before every command that
//      draws from it (RNG_COMMANDS). The easiest way: build the server's rules once with
//        const serverRules = withServerEntropy(rules, () => crypto.randomInt(0, 2 ** 32));
//      and use serverRules for command handling. (Or call reseedCharacter(ch, entropy) yourself.)
//   2. Redact on the way out. Send redactForClient(ch) in every { t: 'character' } message (rngState 0),
//      and redactSetupForClient(setup) in ZoneInfo.setup (seed 0). Nothing the client computes for
//      display — tooltips, craftPreview, merchantOffers, the openMap preview + lootLuck, deriveStats —
//      reads either value (tests/game-progression/online.test.ts guards this).
//
// In-run loot uses the Rng the sim hands to the loot hooks (forked from RunConfig.seed). Its 32-bit state
// is in principle recoverable from observed drops, so a server that wants loot to be unpredictable even
// to a determined cheater can pass `createRng(serverEntropy())` (src/core/rng) to rules.rollKillLoot /
// rollChestLoot instead of the sim's stream; the rules accept any Rng. Doing so trades replayable drops
// (tests, balance runs) for unpredictability.
import type { GameRulesApi, Result, RunSetup } from '../contracts/game';
import type { CharacterSave } from '../contracts/items';
import type { Command } from '../contracts/net';
import { hashU32 } from '../core/rng';
import { maskLocked, unmaskLocked } from './items';

/** Commands whose outcome draws from CharacterSave.rngState: reseed right before handling them. */
export const RNG_COMMANDS: ReadonlySet<Command['c']> = new Set<Command['c']>([
  'applyCurrency', 'benchCraft', 'buyOffer', 'buyDebugOffer', 'activateMapDevice',
]);

/**
 * Mix server-only entropy (any u32, e.g. crypto.randomInt(0, 2 ** 32)) into the character's rng. Pure:
 * the same (rngState, entropy) always gives the same state, so tests can pin it. The previous state is
 * mixed in, so even a weak entropy source never rewinds the stream.
 */
export function reseedCharacter(ch: CharacterSave, entropy: number): CharacterSave {
  const e = Number.isFinite(entropy) ? Math.floor(entropy) >>> 0 : 0;
  const rngState = hashU32((hashU32(ch.rngState >>> 0) ^ hashU32((e ^ 0x6a09e667) >>> 0)) >>> 0);
  return { ...ch, rngState };
}

/** The CharacterSave a client may see: rngState zeroed (display rules never read it). */
export function redactForClient(ch: CharacterSave): CharacterSave {
  return ch.rngState === 0 ? ch : { ...ch, rngState: 0 };
}

/**
 * The RunSetup a client may see (ZoneInfo.setup): seed zeroed and the event plan removed, so neither
 * the loot stream nor an unrevealed encounter can be read ahead. Display rules (lootLuck, lootLuckLines,
 * deriveStats and summary lines) never read either field.
 */
export function redactSetupForClient(setup: RunSetup): RunSetup {
  const { event: _event, ...publicSetup } = setup;
  return { ...publicSetup, seed: 0 };
}

/**
 * The rules for command handling on the server: identical to `base`, except that applyCurrency,
 * applyBenchRecipe, buyOffer and openMap reseed the character with `entropy()` first. `entropy` must be server-only
 * randomness (Node's crypto.randomInt), never anything the client can observe or influence.
 */
export function withServerEntropy(base: GameRulesApi, entropy: () => number): GameRulesApi {
  return {
    ...base,
    applyCurrency: (ch, currencyUid, targetUid, affixIndex) =>
      base.applyCurrency(reseedCharacter(ch, entropy()), currencyUid, targetUid, affixIndex),
    applyBenchRecipe: (ch, targetUid, recipeId) => base.applyBenchRecipe(reseedCharacter(ch, entropy()), targetUid, recipeId),
    buyOffer: (ch, offerId) => base.buyOffer(reseedCharacter(ch, entropy()), offerId),
    buyDebugOffer: (ch, offerId, options) => base.buyDebugOffer(reseedCharacter(ch, entropy()), offerId, options),
    openMap: (ch, areaId, lootClass) => base.openMap(reseedCharacter(ch, entropy()), areaId, lootClass),
  };
}

// ---------------------------------------------------------------------------------------------
// Trade locks (GAME_SPEC §12: items in an open trade stay in the backpack but are locked)
// ---------------------------------------------------------------------------------------------

/** Refusal for a command aimed straight at a locked item. */
export const LOCKED_ITEM_ERROR = 'That item is in your trade offer. Take it out of the offer or cancel the trade first.';
/** Refusal for a command that would have moved, merged into, spent or changed a locked item on the way. */
export const LOCKED_CHANGE_ERROR = 'That would change an item in your trade offer. Take it out of the offer or cancel the trade first.';
/** Refusal for "Deposit all" when every currency stack in the backpack is in the trade offer. */
export const LOCKED_CURRENCY_ERROR = 'Your currency is in your trade offer. Take it out of the offer or cancel the trade first.';

/** The uids locked for a character (its items in an open trade offer); null / empty = nothing locked. */
export type LockedUids = (ch: CharacterSave) => ReadonlySet<string> | null | undefined;

/**
 * The rules with trade locks: identical to `base` while a character has nothing locked; otherwise every
 * rule that can touch an item refuses to move, craft, discard, spend or top up a locked one, and pays
 * from the other stacks instead (src/game/items/locks.ts):
 *   moveItem / quickMove / discardItem / applyCurrency / applyBenchRecipe / clearCraftedAffix aimed at a
 *     locked uid → LOCKED_ITEM_ERROR; craftingTargetError answers the same text; depositAllCurrency files
 *     every other currency stack and leaves the locked ones in the backpack (LOCKED_CURRENCY_ERROR when
 *     they are all it holds);
 *   anything that would disturb a locked item on the way (a swap that displaces it, a stack merged into
 *     it) → LOCKED_CHANGE_ERROR;
 *   addToBackpack (pickups, refunds) never tops up a locked stack; buyOffer / applyBenchRecipe never pay
 *     with one, and merchantOffers / benchRecipes judge affordability without them (a locked bench
 *     target lists every recipe unavailable with LOCKED_ITEM_ERROR).
 * Server: `lockedOf(ch)` returns the uids of ch's current offer (by ch.id) and the server handles every
 * command AND every pickup with the wrapped rules, e.g.
 *   const serverRules = withItemLocks(withServerEntropy(rules, entropy), (ch) => trades.offeredUids(ch.id));
 * (either nesting order works). The swap itself goes through tradeItems (src/game/items/transfer.ts),
 * which is not wrapped. Keep the server's own check too: snapshot both offers at every offer change and
 * compare them with the live characters when both accept — defence in depth against any path that
 * changes a character outside the rules. A client may wrap its display rules the same way with the uids
 * of UiState.trade.yourItems so tooltips and bench / merchant affordability match what the server allows.
 */
export function withItemLocks(base: GameRulesApi, lockedOf: LockedUids): GameRulesApi {
  const locksOf = (ch: CharacterSave): ReadonlySet<string> | null => {
    const set = lockedOf(ch);
    return set && set.size > 0 ? set : null;
  };
  const isLocked = (locked: ReadonlySet<string>, uid: unknown) => typeof uid === 'string' && locked.has(uid);
  /** Run `call` on the masked character; refuse direct hits and anything that disturbed a locked item. */
  function guard<T>(
    ch: CharacterSave,
    targets: readonly unknown[],
    call: (c: CharacterSave) => Result<T>,
    characterOf: (value: T) => CharacterSave,
    withCharacter: (value: T, c: CharacterSave) => T,
  ): Result<T> {
    const locked = locksOf(ch);
    if (!locked) return call(ch);
    if (targets.some((uid) => isLocked(locked, uid))) return { ok: false, error: LOCKED_ITEM_ERROR };
    const { character, mask } = maskLocked(ch, locked);
    const result = call(character);
    if (!result.ok) return result;
    const restored = unmaskLocked(characterOf(result.value), mask);
    return restored ? { ok: true, value: withCharacter(result.value, restored) } : { ok: false, error: LOCKED_CHANGE_ERROR };
  }
  const plain = (c: CharacterSave) => c;
  const replace = (_: CharacterSave, c: CharacterSave) => c;
  const outcomeCharacter = <T extends { character: CharacterSave }>(v: T) => v.character;
  const withOutcomeCharacter = <T extends { character: CharacterSave }>(v: T, c: CharacterSave): T => ({ ...v, character: c });
  return {
    ...base,
    moveItem: (ch, uid, to, count) => guard(ch, [uid], (c) => base.moveItem(c, uid, to, count), plain, replace),
    quickMove: (ch, uid, ctx) => guard(ch, [uid], (c) => base.quickMove(c, uid, ctx), plain, replace),
    // Locked currency stacks are masked as inert stand-ins, so "Deposit all" leaves them in the backpack.
    // When they are all the backpack holds, the refusal says so instead of "There is no currency".
    depositAllCurrency: (ch) => {
      const result = guard(ch, [], (c) => base.depositAllCurrency(c), plain, replace);
      const locked = locksOf(ch);
      if (result.ok || !locked) return result;
      const stacks = ch.backpack.entries.filter((e) => e.item.kind === 'currency' && e.item.count > 0);
      return stacks.length > 0 && stacks.every((e) => locked.has(e.item.uid)) ? { ok: false, error: LOCKED_CURRENCY_ERROR } : result;
    },
    addToBackpack: (ch, item) => guard(ch, [], (c) => base.addToBackpack(c, item), plain, replace),
    discardItem: (ch, uid) => guard(ch, [uid], (c) => base.discardItem(c, uid), plain, replace),
    applyCurrency: (ch, currencyUid, targetUid, affixIndex) => guard(
      ch, [currencyUid, targetUid], (c) => base.applyCurrency(c, currencyUid, targetUid, affixIndex), outcomeCharacter, withOutcomeCharacter,
    ),
    applyBenchRecipe: (ch, targetUid, recipeId) => guard(
      ch, [targetUid], (c) => base.applyBenchRecipe(c, targetUid, recipeId), outcomeCharacter, withOutcomeCharacter,
    ),
    clearCraftedAffix: (ch, targetUid) => guard(
      ch, [targetUid], (c) => base.clearCraftedAffix(c, targetUid), outcomeCharacter, withOutcomeCharacter,
    ),
    setMapTreeNode: (ch, id, allocate) => guard(ch, [], c => base.setMapTreeNode(c, id, allocate), plain, replace),
    sellItems: (ch, uids, expectedScrap) => guard(ch, uids, c => base.sellItems(c, uids, expectedScrap), outcomeCharacter, withOutcomeCharacter),
    buyOffer: (ch, offerId) => guard(ch, [], (c) => base.buyOffer(c, offerId), outcomeCharacter, withOutcomeCharacter),
    buyDebugOffer: (ch, offerId, options) => guard(ch, [], c => base.buyDebugOffer(c, offerId, options), outcomeCharacter, withOutcomeCharacter),
    openMap: (ch, areaId, lootClass) => guard(ch, [ch.mapDevice?.uid], (c) => base.openMap(c, areaId, lootClass), outcomeCharacter, withOutcomeCharacter),
    craftingTargetError: (ch, currencyUid, targetUid) => {
      const locked = locksOf(ch);
      if (locked && (isLocked(locked, currencyUid) || isLocked(locked, targetUid))) return LOCKED_ITEM_ERROR;
      return base.craftingTargetError(ch, currencyUid, targetUid);
    },
    benchServices: (ch, targetUid) => {
      const locked = locksOf(ch);
      if (!locked) return base.benchServices(ch, targetUid);
      if (isLocked(locked, targetUid)) return base.benchServices(ch, targetUid)
        .map(s => ({ ...s, available: false, reason: LOCKED_ITEM_ERROR }));
      return base.benchServices(maskLocked(ch, locked).character, targetUid);
    },
    benchRecipes: (ch, targetUid) => {
      const locked = locksOf(ch);
      if (!locked) return base.benchRecipes(ch, targetUid);
      if (isLocked(locked, targetUid)) {
        return base.benchRecipes(ch, targetUid).map((r) => ({ ...r, available: false, reason: LOCKED_ITEM_ERROR }));
      }
      return base.benchRecipes(maskLocked(ch, locked).character, targetUid);
    },
    merchantOffers: (ch) => {
      const locked = locksOf(ch);
      return base.merchantOffers(locked ? maskLocked(ch, locked).character : ch);
    },
  };
}
