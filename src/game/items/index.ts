// =============================================================================================
// Item & crafting rules — internal API for src/game (the GameRulesApi is assembled in
// src/game/index.ts on top of this module). Pure functions; no DOM, no Math.random / Date.now.
// =============================================================================================
//
// CONVENTIONS
//   • Functions taking a CharacterSave never mutate it; they return a new one (untouched containers
//     keep their object identity). Failures are `Result` errors with player-facing text.
//   • Randomness: pass an Rng. For hideout operations resume it from the character with
//     `withCharacterRng(ch, fn)` (or createRng(ch.rngState)) and store `rng.state()` back.
//     `applyEquipmentCurrency` already does this itself.
//   • Uids: `mintUid(ch)` ("i…", advances nextUid) for hideout-created items; `randomUid(rng)`
//     ("d…") for in-run loot; generators draw a random uid when `opts.uid` is omitted.
//   • Affix order: item.affixes is kept sorted (prefixes, then suffixes, in affix-table order) and
//     describeEquipment(item).affixes[i] always describes item.affixes[i], so a clicked tooltip line
//     index is the `affixIndex` for Seal / Catalyst / Fracture Core.
//   • Local properties: Armour / Evasion Rating / Added Spell Damage base properties absorb the
//     item's own flat and % lines of that stat; itemModifiers emits them once as the property total.
//   • Level requirements come from the base (or unique) only, so crafting never changes them.
//   • Uniques: stability 0/0, fixed mod families ("unique:<id>:<n>"); only Crown Fragments reroll their values.
//   • Player-facing text only uses glyphs the UI fonts' latin subset covers (no →, ≈, ≤ …);
//     tests/game-items/describe.test.ts enforces it.
//
// ---------------------------------------------------------------------------------------------
// INTEGRATION NOTES (rules assembly, app and UI — read these)
// ---------------------------------------------------------------------------------------------
//   BELT SLOTS HAVE SYNTHETIC UIDS. The frozen BeltSlot has no uid, but moveItem / quickMove /
//   discardItem / findItem / describeItem take one. Belt slot i is addressed as `belt:${i}`
//   (beltUid(i); parseBeltUid(uid) → i | null). Everything here accepts it:
//     findItem(ch, 'belt:1')                → { item: FlaskStack, location: { kind: 'belt', index: 1 } }
//     moveItem(ch, 'belt:1', backpack cell) → unloads the charges (they get a fresh "i…" uid)
//     quickMove(ch, 'belt:1', ctx)          → charges back to the backpack
//     discardItem(ch, 'belt:1')             → clears the slot and its assignment
//     moveItem(ch, flaskUid, { kind: 'belt', index }) / quickMove(flask in backpack) load a belt.
//   beltItem(ch, i) builds the FlaskStack the UI renders for slot i (null = unassigned). A stack with
//   count 0 is an emptied slot that stays assigned: draw it empty-but-labelled; pickups refill it.
//   describeItem(item, ch) for kind 'flask' → describeFlask(item, { characterLevel: ch.level,
//   flaskEffect: 1 + flaskEffect% / 100 }); it recognises belt uids itself (header "Belt Charges",
//   hint "Press <i+1> during a map to drink.").
//
//   SPECIAL STASH TABS (GAME_SPEC §12, end; src/game/items/special-stash.ts). Every character has a
//   Crafting Stash (CharacterSave.currencyStash: one slot per currency, ≤ CURRENCY_STASH_MAX each; the UI
//   shows equipment currencies as tab 'currency' and map currencies as tab 'mapCurrency', slot order
//   CRAFTING_STASH_EQUIPMENT_SLOTS / CRAFTING_STASH_MAP_SLOTS) and a Map Stash (CharacterSave.mapStash,
//   ≤ MAP_STASH_CAPACITY maps in deposit order; the UI groups them by tier and base).
//   A slot is the synthetic uid `cstash:${id}` (currencyStashUid(id); parseCurrencyStashUid(uid) → id | null):
//     findItem(ch, 'cstash:scrap')          → { item: CurrencyStack (count = the slot), location: { kind: 'currencyStash' } }
//                                              (null while the slot is empty; currencyStashItem(ch, id) builds the
//                                              view of any slot, count 0 included, for the UI to render / describe)
//     describeItem(slotView, ch)            → headerLines ['Crafting Stash 1,234 / 5,000'], withdraw hints
//     moveItem(ch, stackUid, { kind: 'currencyStash' }, count?)  deposit (anything that does not fit stays)
//     moveItem(ch, 'cstash:scrap', backpack/stash cell, count?)   withdraw min(count ?? 40, 40, held): into the
//                                              cell, onto a matching stack there, else anywhere in that grid; a grid
//                                              without a free cell takes what its matching stacks still hold room for
//     quickMove(ch, stackUid, { stashTab: 'currency' | 'mapCurrency' }) deposit · quickMove(ch, 'cstash:scrap',
//       { stashTab, count: 1 }) withdraw one (Shift+Ctrl-click) or a full stack to the backpack
//     depositAllCurrency(ch)                every backpack currency stack into its slot
//     applyCurrency / craftPreview / craftingTargetError(ch, 'cstash:scrap', targetUid)  craft straight from a
//       slot (one is taken from the slot); targets may sit in the Map Stash too
//   WORK SLOT (Crafting Stash): ch.craftSlot holds ONE gear or map item (craftSlotOf / withCraftSlot); it keeps its
//   own uid at location { kind: 'craftSlot' }, so findItem, applyCurrency (currency from the backpack or a
//   'cstash:<id>' slot), the bench and every move reach it. moveItem(ch, uid, { kind: 'craftSlot' }) loads it from
//   anywhere (an occupant goes back where the new item came from); out via any move or quickMove (→ backpack). With a
//   Crafting Stash tab open quickMove(ch, uid, { stashTab: 'currency' | 'mapCurrency' }) loads gear / maps from the
//   backpack or the body.
//   Maps: moveItem(ch, mapUid, { kind: 'mapStash' }) / quickMove(…, { stashTab: 'maps' }) deposit; a Map Stash
//   map moves to a grid cell or { kind: 'mapDevice' } (the device's old map is filed into the Map Stash),
//   and quickMove sends it to the backpack; with the Map Stash open, quickMove files the Map Device's map
//   into it. `count` splits ordinary stacks too (moveItem onto an empty cell or a matching stack; quickMove
//   to the other container). Rook and the Crafting Bench also pay from the Crafting Stash (after the backpack).
//
//   PICKUPS: addToBackpack(ch, item) refills matching belt slots with flask pickups first
//   (CONCEPTS §10) — rules.addToBackpack can pass straight through. `{ refillBelt: false }` opts out.
//
//   STARTING KIT (GAME_SPEC §3 "magic ilvl 1 Ashwood Wand, T7-ish fire affix"): T7 needs item level
//   6, so build the wand with the best tier item level 1 can roll:
//     buildEquipment({ baseId: 'ashwoodWand', itemLevel: 1, rarity: 'magic',
//                      affixes: [{ affixId: 'fireDamage', tier: 8 }], uid }, rng)
//   (`ignoreItemLevel: true` exists for deliberately scripted rewards; the kit does not need it.)
//
//   LOOT: generateUnique(id, rng, { itemLevel: monsterLevel }) — without itemLevel a unique uses its
//   level requirement, so a late boss drop would show early-game Armour / Evasion base values.
//   generateEquipment(base, monsterLevel, rarity, rng, { tagWeights, extraStability, origin, isNew }).
//
//   GAMBLING: pickRandomBase(rng, { classes: [c], itemLevel: ch.level }) returns null when every base
//   of the class needs a higher level (Ember Sceptre needs 20, so 'sceptre' at levels 1–19). Offer or
//   enable a gamble class only when `baseWeights({ classes: [c], itemLevel: ch.level }).length > 0`.
//
//   MAP CURRENCIES: craftingTargetError / craftPreview / applyEquipmentCurrency answer map
//   currencies on maps with "<name> is applied by the map rules." — route those to the map rules.
//
// ---------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------
// DATA (src/data/items): BASES, AFFIXES, UNIQUES, SCARS, CURRENCIES, FLASKS, rare-name lists,
//   STAT_TEXT / STAT_LABEL / TAG_LABEL / CLASS_LABEL, rules constants (AFFIX_LIMITS, SCAR_*,
//   CURRENCY_STACK, FLASK_STACK, BELT_SLOT_CAPACITY, ARMOUR_CLASSES…) and lookups
//   (getBase, getAffix, getUnique, getCurrency, getFlask, isMapCurrency…).
//
// CONTENT INFO (for GameRulesApi.content)
//   BASE_INFO, CURRENCY_INFO (all 16), FLASK_INFO, UNIQUE_INFO
//
// IDS & RNG
//   mintUid(ch) → { uid, character }        the next "i…" uid the character does NOT hold yet
//   adoptUid(ch, uid) → ch                   counter past a received minted-looking uid · heldUids(ch)
//   randomUid(rng) → string                  beltUid(i) / parseBeltUid(uid)
//   withCharacterRng(ch, rng => T) → { value, rngState }
//   Uids are unique per character, not per server (every character mints i0, i1, …): items from another
//   character enter through addToBackpack / tradeItems / stowItem, which re-mint a taken uid.
//
// GENERATION
//   generateEquipment(baseId, itemLevel, 'normal'|'magic'|'rare', rng, opts?) → EquipmentItem
//       opts: uid, extraStability (map "armour bases +2 stability"), tagWeights, affixCount, origin
//             (first history line), isNew
//   generateUnique(uniqueId, rng, { uid?, itemLevel?, origin?, isNew? }) → EquipmentItem
//   buildEquipment(spec, rng) → EquipmentItem   explicit items (starting kit, merchant); throws on
//       anything a rolled item could not be (see STARTING KIT above)
//   pickRandomBase(rng, { classes?, itemLevel?, weights?, classWeights? }) → BaseId | null
//   baseWeights(opts) · pickRandomUnique(rng, { classes?, maxLevel? }) · uniqueIdsFor({ baseId?, classes?, maxLevel? })
//   uniqueLevelRequirement(id)   maxLevel keeps uniques wearable: drops pass the item level, gambles the
//                                character level (a Tier 1 boss cannot drop a level 24 unique)
//   currencyStack(id, count, uid, isNew?) · flaskStack(id, count, uid, isNew?)
//   rollRareName(rng) · clampItemLevel(n) · ARMOUR_CLASSES (data)
//
// WHAT ITEMS DO
//   itemModifiers(item) → StatModifier[]    labelled sources: "<name> (implicit|Blazing T4|unique|
//                                           scar: Frail|Armour)"; feed straight into resolveStat
//   itemFlags(item) → PlayerFlag[]          itemLines(item) · itemProperties(item)
//   itemDisplayName(item) · equipmentLevelRequirement(item)
//
// DESCRIPTIONS (ItemDescription)
//   describeEquipment(item, { characterLevel? })
//   describeCurrency(stack)
//   describeFlask(stack, { characterLevel?, flaskEffect? })   flaskRecovery(flaskId, level, mult)
//   itemLabel(item) ("Forge Scrap ×3", rare name…) · itemTone(item)
//   (maps are described by the map rules)
//
// CRAFTING (equipment currencies)
//   craftingTargetError(ch, currencyUid, targetUid) → string | null
//   craftPreview(ch, currencyUid, targetUid) → string[]          exact odds from the real weights:
//       outcome splits, per-affix inclusion odds (Kindling / Reforge) and per-affix tier odds
//   applyEquipmentCurrency(ch, currencyUid, targetUid, affixIndex?) → Result<CraftOutcome>
//   item-level variants: equipmentCraftError(item, currencyId, affixIndex?),
//     equipmentCraftPreview(item, currencyId) → { lines, outcomes, inclusion, inclusionExact,
//     stabilityCost, stabilityAfter, scarChance }, craftEquipment(item, currencyId, rng, affixIndex?),
//     affixTargetError(item, currencyId, index), affixChoices(item, currencyId)
//   affix pools: affixCandidates(base, ilvl, opts?) · inclusionOdds(...) → { odds, exact } ·
//     singlePickOdds(pool)
//   Bench-crafted affixes (RolledAffix.crafted) are ordinary affixes to every currency, except that
//   Fracture Core cannot fracture one and Tempering Catalyst cannot raise one above T4.
//
// CRAFTING BENCH (GAME_SPEC §12; recipes in src/data/items/bench.ts)
//   benchRecipes(ch, targetUid) → BenchRecipe[]      every recipe fitting the item (class + base
//       property), prefixes first: tier = best tier the item level unlocks capped at T4, label with the
//       tier's range ("+(32–40) to maximum Life"), cost (Scrap by tier + the matching essence, or extra
//       Scrap for affixes no essence can add), available / precise reason. [] for non-equipment.
//   applyBenchRecipe(ch, targetUid, recipeId) → Result<CraftOutcome>   pays from BACKPACK stacks (then the
//       Crafting Stash; never normal stash tabs), adds
//       { crafted: true } rolled with the character rng (the server reseeds it: see src/game/online.ts),
//       -1 Stability without a scar roll, Normal → Magic, history "Bench: added Hale (T4)". It never
//       changes rarity otherwise (a Magic item keeps ≤1 prefix / ≤1 suffix) and leaves seals in place.
//   clearCraftedAffix(ch, targetUid) → Result<CraftOutcome>   free; 0 affixes left → Normal
//   helpers: findBenchRecipe(id) · benchTier(def, ilvl) · benchCost(def, tier) · benchEssence(def) ·
//     benchItemError(item) · benchAffixError(item, base, def) · craftedAffixIndex(item) ·
//     backpackCurrency(ch, id) · benchCurrency(ch, id) (backpack + Crafting Stash: what the bench can spend)
//
// INVENTORY
//   itemSize(item) · findItem(ch, uid) → { item, location } | null · allItems(ch) (Map Stash included)
//   canEquip(ch, item, slot) → { ok, reason? }
//   moveItem(ch, uid, to: ItemLocation, count?) → Result<CharacterSave>
//   quickMove(ch, uid, { stashTab: number | 'currency' | 'mapCurrency' | 'maps' | null, count? }) → Result<CharacterSave>
//   depositAllCurrency(ch) → Result<CharacterSave>
//   special stash: currencyStashItem(ch, id) · currencyStashCount / currencyStashRoom · currencyStashTab(id) ·
//     mapStashOf(ch) · specialStashTab(value) · CRAFTING_STASH_EQUIPMENT_SLOTS / CRAFTING_STASH_MAP_SLOTS
//   addToBackpack(ch, item, { refillBelt? = true }) → Result<CharacterSave>   (atomic; re-mints
//     clashing uids)
//   discardItem(ch, uid) · addStashTab(ch) · renameStashTab(ch, tab, name) · clearNewFlags(ch)
//   grid helpers: createGrid, canPlace, placeItem, removeFromGrid, findFreeSpot, autoPlace,
//     overlappingEntries, maxStackSize, canStack, beltItem, beltSlots, replaceItemAt, removeItemAt,
//     setStackCount, createStashTab, SLOT_LABEL — removals / replacements act on ONE entry (the one at the
//     given location), never on every entry that shares a uid
//
// TRANSFERS (src/game/items/transfer.ts)
//   tradeOfferError(ch, uids) → string | null     backpack items only, distinct, ≤ TRADE_MAX_ITEMS
//   tradeItems(a, aUids, b, bUids) → Result<{ a, b }>   atomic swap; both give first, then receive into the
//       backpack (flasks too; marked new); fails with a player-facing reason and changes nothing
//   stowItem(ch, item) → Result<Stowed>          never-lose return: empty Map Device (maps), backpack,
//       stash tabs, a new "Recovered" tab
//
// LOCKS (src/game/items/locks.ts; the GameRulesApi wrapper is withItemLocks in src/game/online.ts)
//   maskLocked(ch, uids) → { character, mask }   locked stacks swapped for inert stand-ins
//   unmaskLocked(ch, mask) → ch | null           null when an operation moved or changed a locked item
// =============================================================================================

export { BASE_INFO, CURRENCY_INFO, FLASK_INFO, UNIQUE_INFO } from './content';
export {
  BELT_UID_PREFIX, CURRENCY_STASH_UID_PREFIX, adoptUid, beltUid, currencyStashUid, heldUids, isReservedUid, mintUid, parseBeltUid,
  parseCurrencyStashUid, randomUid, withCharacterRng,
} from './ids';
export {
  CRAFTING_STASH_EQUIPMENT_SLOTS, CRAFTING_STASH_MAP_SLOTS, craftSlotOf, currencyStashCount, currencyStashItem, currencyStashRoom,
  currencyStashTab, mapStashIndex, mapStashOf, specialStashTab, withCraftSlot, withCurrencyStashCount, withMapStash,
} from './special-stash';
export {
  baseWeights, buildEquipment, clampItemLevel, currencyStack, flaskStack, generateEquipment, generateUnique,
  pickRandomBase, pickRandomUnique, rollRareName, uniqueIdsFor, uniqueLevelRequirement, uniqueModId,
} from './generate';
export type {
  BasePickOptions, CraftableRarity, EquipmentSpec, GenerateOptions, UniqueFilter, UniqueOptions,
} from './generate';
export {
  equipmentLevelRequirement, itemDisplayName, itemFlags, itemLines, itemModifiers, itemProperties, uniqueModDef,
} from './modifiers';
export type { ItemLine, ItemPropertyValue, LinePart } from './modifiers';
export {
  describeCurrency, describeEquipment, describeFlask, flaskRecovery, itemLabel, itemTone,
} from './describe';
export type { EquipmentDescribeOptions, FlaskDescribeOptions } from './describe';
export {
  affixChoices, affixTargetError, appendHistory, applyEquipmentCurrency, craftEquipment, craftPreview, craftingTargetError,
  equipmentCraftError, equipmentCraftPreview, scarChanceFor,
} from './crafting';
export type { CraftPreviewData, EquipmentCraftResult, EquipmentCurrencyId, OddsEntry } from './crafting';
export {
  applyBenchRecipe, benchServices, stabilityRepairCost, backpackCurrency, benchAffixError, benchCost, benchCurrency, benchEssence, benchItemError, benchRecipes, benchTier,
  clearCraftedAffix, craftedAffixIndex, findBenchRecipe,
} from './bench';
export type { BenchPrice } from './bench';
export {
  affixCandidates, affixState, eligibleCandidates, inclusionOdds, rollNewAffixes, singlePickOdds, sortAffixes,
} from './affix-pool';
export type { AffixCandidate, CountChance, InclusionOdds, PoolOptions } from './affix-pool';
export {
  SLOT_LABEL, addStashTab, addToBackpack, allItems, autoPlace, beltItem, beltSlots, canEquip, canPlace, canStack,
  claimIncomingUid, clearNewFlags, createGrid, createStashTab, depositAllCurrency, discardItem, findFreeSpot, findItem, gridOf,
  isStackable, itemSize,
  maxStackSize, moveItem, overlappingEntries, placeItem, quickMove, removeFromGrid, removeItemAt, renameStashTab,
  replaceInGrid, replaceItemAt, setStackCount, withGrid,
} from './inventory';
export type { AddOptions, FoundItem, GridRef, QuickMoveContext } from './inventory';
export { maskLocked, sameJson, unmaskLocked } from './locks';
export type { LockMask } from './locks';
export { stowItem, tradeItems, tradeOfferError } from './transfer';
export type { Stowed } from './transfer';
export {
  EN_DASH, MINUS, distributeSteps, distributeTenths, formatChance, formatCount, formatDistribution, formatLine, formatNumber, formatRange,
  formatRangeLine, formatSigned, formatSpan, joinWords,
} from './format';
