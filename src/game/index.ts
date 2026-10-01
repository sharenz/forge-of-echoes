// The pure game rules: `export const rules: GameRulesApi` (src/contracts/game.ts).
//
// Assembled from two modules:
//   src/game/items        items, affixes, the Workbench (equipment crafting), inventory and the belt
//   src/game/progression  stats, skills, maps and map crafting, loot, merchant, save and run config
// Read the header of each module's index.ts for integration notes (belt uids, drop labels, map mods…).
//
// Every function is pure: a CharacterSave in, a new CharacterSave out. Randomness outside runs comes
// from CharacterSave.rngState; inside runs from the Rng the sim hands to the loot hooks.
//
// Online: an instance's RunConfig comes from buildRunConfig(setup, hooks); every player joins it with
// playerRuntime(ch, setup). Luck is personal and loot instanced: RunSetup luck is map-side only,
// lootLuck(setup, ch) adds that player's gear, and the server rolls rollKillLoot / rollChestLoot once
// per player with their own CharacterSave, tagging drops with dropSpec(item, token, owner).
//
// SERVER CHECKLIST (src/server) — beyond the contract, all exported below:
//   • RNG SECRECY (required). Handle commands with `withServerEntropy(rules, () => crypto.randomInt(0, 2 ** 32))`
//     (reseeds rngState from server entropy before applyCurrency / applyBenchRecipe / buyOffer / openMap;
//     RNG_COMMANDS lists the commands), and send `redactForClient(ch)` in every { t: 'character' } and
//     `redactSetupForClient(setup)` in ZoneInfo.setup. Otherwise a client that knows rngState can
//     preview and steer every craft, gamble and map seed. Details: src/game/online.ts.
//   • Names: `validateCharacterName(name)` (3–16 ASCII letters/digits/space/'-_, starts with a letter)
//     before createCharacter(name, crypto seed); check uniqueness on the created `ch.name`.
//   • Deaths: `recordDeath(ch)` on every playerDied outcome. applyRunEnd once per player per map
//     instance, with that player's own kills and time (semantics in its doc comment).
//   • Hideouts: `hideoutSeed(ownerCharacterId)` for RunConfig.seed, so each hideout has its own decor.
//   • Drops: rules.dropSpec(item, token, owner) for loot (equipment autoPickup false = click to pick up);
//     rules.dropSpec(item, token, 0, true) for an item a player drops on the floor (public, never
//     auto-collected — owner 0 alone already makes a drop click-only). A crafted item stays crafted
//     wherever it goes (trade, floor, stash).
//   • Crafting Bench: benchCraft → rules.applyBenchRecipe (reseeded), benchClear → rules.clearCraftedAffix
//     (no randomness). Both work on items in the backpack, stash or equipment; only in a hideout.
//   • RESTART SAFETY (GAME_SPEC §11 — "after deployment we lost our party and our map"): persist every open,
//     uncleared map as `setup.map` + `setup.seed` (+ portals left, owner, members) and rebuild it on startup
//     with `restoreRunSetup(map, seed)` — pure, never throws, null for a bad row, recomputed with the
//     current rules. When a map cannot be restored, give the item back with `stowItem(owner, map)` (Map
//     Device, else backpack, else stash, else a new "Recovered" tab) instead of addToBackpack, which fails
//     on a full backpack and would lose the map. Parties are server state (src/server) — persist them too.
//   • TRADING: validate `tradeOffer` with `tradeOfferError(ch, uids)`; swap with `tradeItems(a, aUids, b,
//     bUids)` (atomic, all or nothing, uids kept unique on the receiver). Lock offered items by handling
//     every command and pickup with `withItemLocks(rules, lockedOf)` (see src/game/online.ts), and still
//     compare the offers with the live characters when both accept.
//   • UIDS are unique per character only: every character mints "i0", "i1", … An item from another
//     character (trade, public drop) must enter through addToBackpack / tradeItems / stowItem, which keep
//     the receiver's uids unique; never splice it into a CharacterSave by hand.
//   • Party scaling text: `partyScalingLines(livingPlayers)` for a HUD tooltip (the map readout already
//     carries a static "Party Scaling" line); the numbers mirror src/sim (PARTY_SCALING).
//   • XP: the harness in tests/game-progression grants { t: 'xp' } to LIVING players only, following
//     the sim's guidance; the contract text says every player — pick one reading on the server.
//   • SPECIAL STASH TABS (GAME_SPEC §12; details in src/game/items/index.ts). New locations
//     { kind: 'currencyStash' } and { kind: 'mapStash' }, and Crafting Stash slot uids "cstash:<id>" (findItem
//     returns a CurrencyStack view of a slot). Gate them like normal stash tabs — hideout only — both as a
//     source (findItem(...).location.kind) and a destination (moveItem `to.kind`, quickMove stashTab
//     'currency' | 'mapCurrency' | 'maps'), and depositAllCurrency too. applyCurrency accepts a slot uid as
//     the currency (crafting stays hideout-only). discardItem refuses a slot ("Take currency out of the
//     Crafting Stash first."), so dropItem on a slot fails cleanly; a Map Stash map can be discarded /
//     dropped like a stashed item. Neither can be offered in a trade (tradeOfferError: backpack only).
//     withItemLocks wraps depositAllCurrency (locked stacks stay in the backpack). Rook and the Crafting
//     Bench also pay from the Crafting Stash; stowItem files refunds there when the backpack is full.
//
// Also for src/client and src/ui (display):
//   lootLuckLines(setup, ch)  the two personal luck lines with every source (tooltips, HUD)
//   gearLuck(ch)              % item quantity / rarity from gear alone
//   deriveRunStats(ch, setup) deprecated alias of rules.deriveStats(ch, setup)
import { setMapTreeNode } from './progression/map-tree';
import { setPin } from './progression/atlas';
import { refillSurge } from './progression/surge';
import { recycleMaps, recycleQuote } from './items/bench';
import { rookMapAreas, rookMapOffers } from './progression/merchant';
import { buyDebugOffer } from './progression/debug-merchant';
import type { ContentInfo, GameRulesApi } from '../contracts/game';
import {
  BASE_INFO, CURRENCY_INFO, FLASK_INFO, UNIQUE_INFO, addStashTab, addToBackpack, applyBenchRecipe, benchRecipes, benchServices, canEquip,
  clearCraftedAffix, clearNewFlags, depositAllCurrency, discardItem, findItem, itemSize, moveItem, quickMove, renameStashTab,
} from './items';
import {
  MAP_BASE_INFO, SKILL_INFO, allocateAttribute, applyCurrency, applyRunEnd, buildRunConfig, buyOffer, canRankUpSkill,
  compareWithEquipped, consumeFlask, craftPreview, craftingTargetError, createCharacter, deriveStats, describeItem, dropSpec,
  grantXp, lootLuck, mapSummary, merchantOffers, sellItems, sellQuote, newSave, openMap, parseSave, playerRuntime, rankUpSkill, rollChestLoot,
  rollEventReward, rollKillLoot, serializeSave, setLoadoutSlot, skillSheetFor, xpToNext,
} from './progression';

const content: ContentInfo = {
  bases: BASE_INFO,
  currencies: CURRENCY_INFO,
  skills: SKILL_INFO,
  mapBases: MAP_BASE_INFO,
  flasks: FLASK_INFO,
  uniques: UNIQUE_INFO,
};

export {
  deriveRunStats, gearLuck, hideoutSeed, lootLuckLines, partyScaling, partyScalingLines, recordDeath, validateCharacterName,
} from './progression';
export type { Luck } from './progression';
export {
  LOCKED_CHANGE_ERROR, LOCKED_CURRENCY_ERROR, LOCKED_ITEM_ERROR, RNG_COMMANDS, redactForClient, redactSetupForClient, reseedCharacter, withItemLocks,
  withServerEntropy,
} from './online';
export type { LockedUids } from './online';
export { stowItem, tradeItems, tradeOfferError } from './items';
export type { Stowed } from './items';
export { restoreRunSetup } from './progression';

export const rules: GameRulesApi = {
  content,

  // --- save ---
  newSave,
  parseSave,
  serializeSave,

  // --- character ---
  createCharacter,
  deriveStats: (ch, setup) => deriveStats(ch, setup ?? null),
  xpToNext,
  grantXp,
  allocateAttribute,
  canRankUpSkill,
  rankUpSkill,
  setLoadoutSlot,
  skillSheet: (ch, skillId, rank) => skillSheetFor(ch, skillId, rank),

  // --- items & inventory ---
  describeItem,
  itemSize,
  findItem,
  canEquip,
  moveItem: (ch, uid, to, count) => moveItem(ch, uid, to, count),
  quickMove: (ch, uid, ctx) => quickMove(ch, uid, ctx),
  depositAllCurrency,
  addToBackpack: (ch, item) => addToBackpack(ch, item),
  discardItem,
  addStashTab,
  renameStashTab,
  clearNewFlags,
  compareWithEquipped,

  // --- crafting ---
  craftingTargetError,
  craftPreview,
  applyCurrency,
  benchRecipes,
  applyBenchRecipe,
  benchServices,
  clearCraftedAffix,

  // --- maps & runs ---
  setMapTreeNode,
  setPin,
  recycleQuote,
  recycleMaps,
  mapSummary,
  openMap,
  refillSurge,
  buildRunConfig,
  playerRuntime,
  lootLuck,
  rollKillLoot,
  rollChestLoot,
  rollEventReward,
  dropSpec,
  consumeFlask,
  applyRunEnd,

  // --- merchant ---
  merchantOffers,
  rookMapAreas,
  rookMapOffers,
  sellItems,
  sellQuote,
  buyOffer,
  buyDebugOffer,
};
