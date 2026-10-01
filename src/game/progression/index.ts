// =============================================================================================
// Progression rules — stats, skills, maps, loot, merchant, save and run config. Internal API for
// src/game; `rules: GameRulesApi` is assembled in src/game/index.ts from this module and src/game/items.
// Pure functions; no DOM, no Math.random / Date.now (randomness: CharacterSave.rngState or a passed Rng).
// =============================================================================================
//
// INTEGRATION NOTES
//   • createCharacter(name, seed) leaves createdAt / updatedAt at 0 — the rules never read the clock,
//     so the app stamps them (and updatedAt on save). Character ids derive from (name, seed): pass a
//     fresh, server-random seed per character (parseSave also de-duplicates ids). New names go through
//     validateCharacterName first (3–16 chars, ASCII, unique server-wide is the server's check);
//     sanitizeName is the lenient stored form used for old saves.
//   • RNG SECRECY: rngState must never reach a client, and the server reseeds it from its own entropy
//     before applyCurrency / buyOffer / openMap — see src/game/online.ts (withServerEntropy,
//     redactForClient, redactSetupForClient). Display rules (tooltips, previews, sheet, lootLuck) never
//     read rngState or RunSetup.seed.
//   • Numbers shown in the UI and used by the sim come from the same resolution: playerRuntime() and
//     skillSheet() both call resolveSkill(). After a level-up, equip change or flask use during a run,
//     push playerRuntime(ch, setup) through sim.updatePlayer (with the sim's `level` on a level-up).
//   • ONLINE INSTANCES. buildRunConfig(setup, hooks) describes an instance only (setup null = hideout,
//     seed HIDEOUT_SEED — the server sets RunConfig.seed = hideoutSeed(ownerId)). Every player joins it
//     with sim.addPlayer({ id, name: ch.name, level: ch.level, runtime: playerRuntime(ch, setup) }).
//   • RESTARTS. restoreRunSetup(persistedMap, seed) rebuilds an open map's RunSetup after a deploy (pure,
//     null on a bad row, recomputed with the current rules): persist setup.map + setup.seed, not the
//     client's redacted setup.
//   • Party scaling lives in the sim (living players n: life ×(1 + 0.5·(n−1)), wave budget
//     ×(1 + 0.25·(n−1)), magic/rare packs ×(1 + 0.1·(n−1))). The rules explain it: a static
//     "Party Scaling" line ends every map readout, and partyScalingLines(n) gives the live numbers for a
//     HUD tooltip. PARTY_SCALING (src/data/progression/maps.ts) mirrors src/sim/constants.ts (tested).
//   • Run log: applyRunEnd once per player per map instance (own kills, own time inside; 'failed' =
//     closed uncleared with every portal spent, 'abandoned' = closed uncleared otherwise), and
//     recordDeath(ch) on every playerDied outcome (a player can die several times in one map).
//   • Map penalties (Exhausting focus regen, Hexed resistances, Unravelling) apply through
//     playerRuntime(ch, setup) and deriveStats(ch, setup) — pass the map's RunSetup for the in-map
//     character sheet; its `combat` is exactly what the sim gets. deriveRunStats is a deprecated alias.
//   • Skill numbers: SkillSheet.dps is the contract's single-target estimate (label it "single target").
//     Two more honest numbers are in SkillSheet.lines and the sheet's Skills section: the damage of one
//     cast if every flame / bolt / strike lands ("206 damage per cast if all 12 flames hit"), and — for
//     Focus-hungry skills — the DPS your Focus regeneration sustains. The Skills section headlines the
//     sustained DPS, plus "· N per cast" for multi-hit skills. resolveSkill() returns all of them
//     (dps, hits, perCast, focusSustain, sustainedDps); a Nova echo counts twice.
//   • Monster life and damage scale with monster level (MONSTER_LEVEL_SCALING in src/data/progression/maps.ts),
//     with no early-tier easing. Evasion uses that same level; the hideout sheet uses reference level 10.
//     Tier 1 is deliberately hard for a fresh character. Balance is guarded by
//     tests/game-progression/balance.test.ts (real rules + the multiplayer sim + bots; a solo Tier 1 and
//     the death / re-entry paths always run, the full suite with BALANCE=1): re-run it after changing
//     skills, class numbers, monster-level scaling or the sim's monsters.
//   • LUCK IS PERSONAL, LOOT IS INSTANCED. RunSetup.itemQuantity / itemRarity (and mapSummary /
//     RunSetup.summary, labelled "Map Item Quantity" / "Map Item Rarity", like the map tooltip's
//     properties) are MAP-SIDE only: tier, quality, implicit and mods (100 = base). A player's personal
//     luck is lootLuck(setup, ch) = map-side + that player's gear (HudRun.itemQuantity / itemRarity);
//     lootLuckLines(setup, ch) gives the two lines with every source ("Item Quantity in this Map"), and
//     deriveStats(ch, setup) leads its Luck section with them (then "Item Quantity from Gear" …).
//     Server loot hooks, per kill: for each playerId → rules.rollKillLoot(setup, ctx, rng, thatCh) →
//     rules.dropSpec(item, token, playerId); same for rollChestLoot (every player present gets their own
//     chest). Iterate players in a fixed order (the sim's ids) so a seed replays the same drops. The roll
//     applies monster rarity (magic ×1.5 Q ×2 R, rare ×4 Q ×3 R; lieutenant and boss like rares) and the
//     Echo wave's double quantity on top; summoned minions (KillLootContext.summoned) never drop.
//     Uniques only drop when wearable at the item level (the first eligible uniques appear in Tier 3);
//     the gamble likewise only offers uniques the character can wear.
//   • Echo corruption: WaveConfig.count = 7 with bossWave 6 — a bonus wave after the Matriarch
//     (the sim clears the map when wave 7 is cleared). Kills in wave ≥ 7 drop double loot.
//   • dropSpec autoPickup: currency, flasks and maps true; equipment false (clicked, GAME_SPEC §12); anything
//     a player dropped on the floor (playerDropped, owner 0 = public) false.
//   • dropSpec labels are ASCII (the in-world pixel font covers ASCII only): "Forge Scrap x3",
//     "Howling Crucible (T4)". iconId identifies the exact currency (e.g. icon/currency/voidNeedle) so
//     the presenter can give rare currency a beam.
//   • Map tooltips: tone follows rarity ('map' for Normal). Each map mod contributes one TooltipLine per
//     effect (danger lines negative: true); affixName is the mod name; corrupted mods use kind
//     'corrupted'. Maps have no affix choice.
//   • Merchant offer ids: "map-t1-<base>", "map-t2-<base>", "flask-life", "flask-focus",
//     "currency-kindling", "currency-mapDust", "gamble-<itemClass>" (only classes with a base at the
//     player's level). Preview items carry uid "offer:<id>"; buyOffer mints a real one.
//   • compareWithEquipped: `delta` is signed so that positive = improvement (Damage Taken and cooldowns
//     are inverted); percentages are in percentage points. Lines, in order: resources and defences;
//     offence (Spell Power, Fire/Cold/Lightning Skill Damage, Cast Speed, Critical Strike Chance and
//     Multiplier, Projectile Speed, Area of Effect, Skill Duration, Cooldown Recovery, Additional
//     Projectiles / Pierce, Ignite / Chill / Shock Chance); per loadout skill "<Skill> DPS" (sustained),
//     "<Skill> Damage per Cast" (multi-hit skills), Cooldown, Projectiles; then utility, luck and
//     attributes. Only changed numbers are listed.
//   • The Map readout has an "Experience" line (1.28x per tier above 1) and map tooltips an "Experience"
//     property.
//   • PER-MAP ROSTERS (GAME_SPEC §14): each map base carries its theme's family, lieutenant and boss from
//     contracts/bestiary.ts THEME_ROSTER (MAP_BASES.*.family / lieutenant / boss), so the text always names
//     what the sim spawns. The map tooltip has a "Boss" property and names the boss in its description;
//     the readout's Waves line lists the monsters, wave 3's lieutenant and the boss, then a "Boss" line and an
//     "Afflictions" line (the debuffs that map's monsters inflict, their sources and counterplay; data in
//     src/data/progression/bestiary.ts). Item histories read "Dropped by The Hollow Warden in …".
//   • Flask descriptions name their cleanse (Life: Burning and Bleeding; Focus: Withered); the sim applies it.
//   • Rook pays from the backpack, stash tabs, then the Crafting Stash (currencyOnHand counts all three).
//   • deriveStats sections: Attributes, Resources, Defence, Offence, Skills (loadout DPS), Luck,
//     Utility, and Unique Effects when a unique grants a flag.
//
// API
//   character: createCharacter, validateCharacterName, xpToNext, grantXp, allocateAttribute, consumeFlask, applyRunEnd,
//              recordDeath, flaskRuntimes, sanitizeName
//   stats:     deriveStats(ch, setup?), deriveRunStats (deprecated alias), deriveFromModel, computeCombat, compareWithEquipped,
//              breakdownLines / sourceLine (breakdown text)
//   model:     buildPlayerModel(ch, extra?) → PlayerModel (all modifiers, attributes, flags)
//   skills:    SKILL_INFO, resolveSkill(model, id, rank), estimateLines, isMultiHit, playerSkills, canRankUpSkill, rankUpSkill,
//              setLoadoutSlot, normalizeLoadout, skillSheetFor, skillRank
//   binding:   a map is bound to ONE Atlas area (createMapItem(areaId, tier, uid); baseId is the area's theme): bindLegacyMaps(ch)
//              (the load-time migration of maps saved without an area), areaForTheme (loot/Rook: area from a rolled theme),
//              isMapAddress / mapAddresses (sealed areas and the Pit are passages, not addresses)
//   routing:   chart-driven map drops (brief D 4, map-routing.ts): buildRouting(input) -> the frozen RunSetup.routing, routeMapDrop(routing,
//              query, rng), advanceTarget / advanceFor (the chest upgrade's destination), routingReadout(routing, tier, discovered?) ("where
//              your maps come from" as data), pendingReveals(atlas, area), routingBiasFor(atlas, scarabs) (hook for pins P1 and area scarabs S1)
//   maps:      MAP_BASE_INFO, describeMap, mapTitle, mapModifiers, monsterScaling, experienceMultiplier, waveConfig, mapLuck,
//              buildMapSummary, createMapItem, rollMapWithRarity, mapCraftError / mapCraftPreview / craftMap,
//              partyScaling(n), partyScalingLines(n), mapBosses(baseId) (lieutenant + boss: kind, name, sentence
//              form), monsterName(kind), monsterSentenceName(kind), mapModName(def, baseId) (a mod's name on that
//              base: the corrupted Wrath is named after the map's boss)
//   runs:      mapSummary(ch, map), openMap(ch, { lootClass?, passage? }), restoreRunSetup(map, seed), buildRunConfig(setup, hooks),
//              playerRuntime(ch, setup), hideoutSeed(ownerId)
//   luck:      lootLuck(setup, looter), lootLuckLines(setup, looter), gearLuck(ch)
//   loot:      rollKillLoot(setup, ctx, rng, looter), rollChestLoot(setup, rng, looter),
//              dropSpec(item, token, owner, playerDropped?) (autoPickup: equipment and player-dropped items false),
//              dropLabel, categoryChances, killLuck, equipmentRarityOdds, rollEquipmentRarity
//   merchant:  merchantOffers, buyOffer, gambleOdds(class, m, level?), currencyOnHand
//   save:      newSave, parseSave, serializeSave, normalizeSave, normalizeCharacter, normalizeItem,
//              normalizeCharacterReport (the character + the items it could not re-home, for server logs)
//   dispatch:  describeItem, craftingTargetError, craftPreview, applyCurrency
// =============================================================================================
import type { MapBaseInfo } from '../../contracts/game';
import type { MapBaseId } from '../../contracts/content';
import { MAP_BASE_IDS } from '../../contracts/content';
import { MAP_BASES } from '../../data/progression';
import { mapBaseImplicitText } from './maps';

/** MapBaseInfo for the UI (implicit text generated from the implicit effects). */
export const MAP_BASE_INFO: Record<MapBaseId, MapBaseInfo> = Object.fromEntries(
  MAP_BASE_IDS.map((id) => {
    const b = MAP_BASES[id];
    return [id, { id: b.id, name: b.name, theme: b.theme, implicit: mapBaseImplicitText(id), description: b.description }];
  }),
) as Record<MapBaseId, MapBaseInfo>;

export {
  allocateAttribute, applyRunEnd, attributeLabel, consumeFlask, createCharacter, flaskRuntimes, grantXp, recordDeath, sanitizeName,
  validateCharacterName, xpToNext,
} from './character';
export { breakdownLines, compareWithEquipped, computeCombat, deriveFromModel, deriveRunStats, deriveStats, sourceLine } from './stats';
export { buildPlayerModel, spellPowerAt } from './model';
export type { PlayerModel } from './model';
export {
  BASIC_SKILL, SKILL_INFO, canRankUpSkill, estimateLines, isMultiHit, normalizeLoadout, playerSkills, rankUpSkill, resolveSkill,
  setLoadoutSlot, skillRank, skillSheetFor,
} from './skills';
export type { ResolvedSkill } from './skills';
export {
  buildMapSummary, craftMap, createMapItem, dangerModCount, describeMap, echoWaveIndex, effectText, experienceMultiplier, hasEchoWave,
  mapBaseImplicitText, mapBosses, mapCraftError, mapCraftPreview, mapLuck, mapModName, mapModifiers, mapPlayerModifiers, mapTitle,
  monsterLevelForTier, monsterName, monsterScaling, monsterSentenceName, partyScaling, partyScalingLines, rarityForDangerCount,
  rollMapWithRarity, voidOutcomes, waveConfig,
} from './maps';
export type { GearLuck, MapCraftResult, MapModifier } from './maps';
export { buildRunConfig, hideoutSeed, mapSummary, openMap, playerRuntime, restoreRunSetup } from './runs';
//   surge:     forgeDay(now), msUntilReset(now), resetCountdownText(ms), surgeStatus(atlas, areaId, now) / surgeStatusAll, surgeMaxCharges(area, nodes),
//              refillSurge(ch, target, now) (Hourglass Sand / Grand Hourglass), refundSurge(atlas, runSurge, now) (server-loss refund)
export {
  forgeDay, forgeDayStart, msUntilReset, normalizeRunSurge, normalizeSurge, refillSurge, refundSurge, resetCountdownText, spendSurge, surgeBonusFor,
  surgeLedgerAt, surgeMaxCharges, surgeStatus, surgeStatusAll,
} from './surge';
export type { SurgeRefill, SurgeStatus } from './surge';
export { lootLuckWithoutSurge } from './luck';
export { gearLuck, lootLuck, lootLuckLines } from './luck';
export type { Luck } from './luck';
export {
  categoryChances, currencyWeightsFor, dropLabel, dropSpec, equipmentRarityOdds, killLuck, rollChestLoot, rollEquipmentRarity,
  rollEventReward, rollKillLoot,
} from './loot';
export type { KillLuck } from './loot';
export { buyOffer, currencyOnHand, gambleOdds, merchantOffers, sellItems, sellQuote } from './merchant';
export {
  NEUTRAL_ROUTING_BIAS, advanceFor, advanceTarget, attachRouting, buildRouting, normalizeRouting, pendingReveals, routeMapDrop, routingBiasFor, routingReadout,
} from './map-routing';
export type { BuildRoutingInput, RoutedDrop, RouteQuery, RoutingBias, RoutingReadout, RoutingReadoutRow } from './map-routing';
export { areaForTheme, bindLegacyChoice, bindLegacyMaps, discoveredAreaForTheme, hasUnboundMaps, isMapAddress, mapAddresses, provisionalBinding } from './map-binding';
export { newSave, normalizeCharacter, normalizeCharacterReport, normalizeItem, normalizeSave, parseSave, serializeSave } from './save';
export type { NormalizeReport } from './save';
export { applyCurrency, craftPreview, craftingTargetError, describeItem } from './dispatch';
