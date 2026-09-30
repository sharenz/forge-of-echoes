// Runs: the map device readout, opening a map (RunSetup), the sim RunConfig of an instance (a hideout
// or a map — players join it separately through SimRun.addPlayer), and one player's live runtime
// (stats, skills, loadout, flasks).
import { mapTreeBonuses, mapTreeNodes } from '../../data/progression/map-tree';
import { normalizeMapTree } from './map-tree';
import { CHEST_LOOT } from '../../data/progression/loot';
import type { MapSummaryLine, Result, RunSetup } from '../../contracts/game';
import type { AtlasAreaId, MapTreeNodeId } from '../../contracts/atlas';
import type { CharacterSave, MapItem } from '../../contracts/items';
import { ITEM_CLASSES, type ItemClass } from '../../contracts/content';
import { BASES, CURRENCIES } from '../../data/items';
import type { MonsterScaling, PlayerRuntime, RunConfig, RunHooks, WaveConfig } from '../../contracts/sim';
import { createRng, hashString, hashU32 } from '../../core/rng';
import { HIDEOUT_ARENA_RADIUS, HIDEOUT_SEED, WAVES, findMapBase } from '../../data/progression';
import { flaskRuntimes } from './character';
import { buildMapSummary, clampTier, mapLuck, mapPlayerModifiers, mapTitle, monsterLevelForTier, monsterScaling, waveConfig } from './maps';
import { buildPlayerModel } from './model';
import { normalizeMap } from './save';
import { normalizeLoadout, playerSkills } from './skills';
import { computeCombat } from './stats';
import { clean, fail, ok } from './util';
import { atlasKeyDestination, findAtlasArea } from '../../data/progression/atlas';
import { atlasAccessError, newAtlas, paidTerritoryFee, territoryEntryFee } from './atlas';
import { spendCurrency } from './merchant';
import { normalizeMapEvent, rollMapEvent } from './map-events';

/**
 * Base map readout, including the opener's tree modifiers but no gear. The successful openMap preview
 * adds destination and expedition details. Personal luck (map + own gear) is lootLuck(setup, ch).
 */
export function mapSummary(ch: CharacterSave, map: MapItem): MapSummaryLine[] {
  return buildMapSummary(map, ch.atlas?.nodes);
}

function snapshotMap(map: MapItem): MapItem {
  const { isNew: _n, ...rest } = map;
  return { ...rest, mods: rest.mods.map((m) => ({ ...m })) };
}

/** The run parameters of `map` (an already snapshotted map) with `seed`: map-side luck only. */
function setupFor(source: MapItem, seed: number, areaId?: AtlasAreaId, lootClass?: ItemClass, nodes: MapTreeNodeId[] = []): RunSetup {
  const area = findAtlasArea(areaId);
  let map = area ? { ...source, baseId: area.baseId } : source;
  if (area?.echoWave && !map.mods.some(m => m.modId === 'echo')) map = { ...map, mods: [...map.mods, { modId: 'echo', value: 100 }] };
  const luck = mapLuck(map, null, nodes);
  const summary = buildMapSummary(map, nodes);
  if (area?.quantityMore) summary.push({ label: area.name, value: `${area.quantityMore}% more item quantity`, breakdown: ['Multiplies map and personal gear quantity.'] });
  if (area?.currencyMultiplier) summary.push({ label: 'Area currency', value: `x${area.currencyMultiplier}`, breakdown: ['Ordinary currency chances and boss/chest currency guarantees. Special keys and ingredients are unchanged.'] });
  if (area?.bossLifeMultiplier) summary.push({ label: 'Area boss', value: 'Empowered', breakdown: [`${(area.bossLifeMultiplier - 1) * 100}% more life`, `${((area.bossDamageMultiplier ?? 1) - 1) * 100}% more damage`] });
  if (area?.noBoss) summary.push({ label: 'Area objective', value: `Clear ${waveConfig(map).count} waves`, breakdown: ['No final boss; the last wave grants Atlas completion and a reward chest.'] });
  if (nodes.length) {
    summary.push({ label: 'Map tree', value: `${nodes.length} allocated`, breakdown: mapTreeNodes(nodes).map(n => `${n.name}: ${n.text}`) });
    summary.push({ label: 'Completion map upgrade', value: `${map.tier >= 15 ? 0 : map.charted ? 100 : Math.round((CHEST_LOOT.mapTierUpgradeChance + mapTreeBonuses(nodes).chestUpgradeChance) * 100)}%`, breakdown: ['Chance for the guaranteed chest map to be one tier higher; Tier 15 is capped.'] });
  }
  return {
    ...(nodes.length ? { mapTree: [...nodes] } : {}),
    map,
    event: rollMapEvent(map, seed, areaId, nodes),
    ...(area ? { atlasAreaId: area.id, sourceMap: source } : {}),
    ...(area?.chosenClass && lootClass ? { lootClass } : {}),
    seed: seed >>> 0,
    monsterLevel: monsterLevelForTier(map.tier),
    itemQuantity: clean(luck.quantity.value * (1 + (area?.quantityMore ?? 0) / 100)),
    itemRarity: clean(luck.rarity.value),
    summary,
  };
}

/**
 * Consume the map in the device and produce the run parameters: seed from the character rng, and the
 * map-side luck (no gear — every player adds their own through lootLuck). Pure, so the UI may call it
 * as a preview.
 */
export function openMap(ch: CharacterSave, areaId?: AtlasAreaId, lootClass?: ItemClass): Result<{ character: CharacterSave; setup: RunSetup }> {
  const map = ch.mapDevice;
  if (!map) return fail('Place a map in the Map Device first.');
  if (!findMapBase(map.baseId)) return fail('This map can no longer be opened.');
  let next = ch;
  const area = findAtlasArea(areaId);
  if (areaId !== undefined) {
    const error = atlasAccessError(ch.atlas ?? newAtlas(), areaId, map.tier);
    if (error) return fail(error);
    if (area?.requiresBounty && !map.bounty) return fail(`${area.name} requires a Bounty map. Commission one at the crafting bench.`);
    if (area?.chosenClass && (!lootClass || !ITEM_CLASSES.includes(lootClass)
      || !Object.values(BASES).some(b => b.itemClass === lootClass && b.levelRequirement <= monsterLevelForTier(map.tier)))) {
      return fail('Choose an equipment class available at this map’s item level.');
    }
    if (area?.entranceKey) {
      const paid = spendCurrency(next, area.entranceKey, 1);
      if (!paid) return fail(`${area.name} requires one ${CURRENCIES[area.entranceKey].name}. Find its source on the key tooltip or trade for one.`);
      next = paid;
    }
  }
  const fee = territoryEntryFee(map.tier, areaId);
  if (fee > 0) {
    const paid = spendCurrency(next, 'scrap', fee);
    if (!paid) return fail(`This territory expedition costs ${fee} Forge Scrap from your inventory or stash.`);
    next = paid;
  }
  const rng = createRng(ch.rngState >>> 0);
  const seed = Math.floor(rng.next() * 0x100000000) >>> 0;
  const setup = setupFor(snapshotMap(map), seed, areaId, lootClass, normalizeMapTree(ch.atlas?.nodes, ch.atlas?.completed.length ?? 0));
  if (fee > 0) setup.entranceScrap = fee;
  if (area?.entranceKey) setup.entranceKey = area.entranceKey;
  return ok({ character: { ...next, mapDevice: null, rngState: rng.state() }, setup });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** JSON text parsed (null when it is not valid JSON); anything else passes through. */
function parsedJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Rebuild an open map's RunSetup after a server restart (GAME_SPEC §11 "Restart safety") from what the
 * server persisted: the map (`setup.map`) — or the whole RunSetup, whose `map` is then used; either as
 * a value or as the JSON text of a database column — plus the run's seed. Pure and total: never throws,
 * and returns null for anything that is not a restorable map (a corrupted row, a map base that no
 * longer exists, a non-finite seed), so one bad row cannot stop the server from starting. The map is normalised exactly like a saved one (unknown mods dropped,
 * tier / quality clamped, rarity recomputed), and monster level, luck and summary are recomputed with
 * the CURRENT rules, so balance changes shipped by the deploy apply to the restored run. Persist the whole
 * setup, including its area ID and original source map (never a client's redacted setup, whose seed is 0).
 */
export function restoreRunSetup(raw: unknown, seed: number): RunSetup | null {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return null;
  const value = parsedJson(raw);
  const wrapper = isRecord(value) && value.kind !== 'map' && isRecord(value.map) ? value : null;
  const area = wrapper?.atlasAreaId === undefined ? undefined : findAtlasArea(wrapper.atlasAreaId);
  if (wrapper?.atlasAreaId !== undefined && !area) return null;
  const source = wrapper ? (isRecord(wrapper.sourceMap) ? wrapper.sourceMap : wrapper.map) : value;
  if (!isRecord(source) || source.kind !== 'map') return null;
  const uid = typeof source.uid === 'string' && source.uid.length > 0 && source.uid.length <= 64 ? source.uid : 'restored-map';
  const map = normalizeMap(source, uid);
  if (!map || !findMapBase(map.baseId)) return null;
  const lootClass = area?.chosenClass && typeof wrapper?.lootClass === 'string' && (ITEM_CLASSES as readonly string[]).includes(wrapper.lootClass)
    ? wrapper.lootClass as ItemClass : undefined;
  if (area?.chosenClass && (!lootClass || !Object.values(BASES).some(b => b.itemClass === lootClass && b.levelRequirement <= monsterLevelForTier(map.tier)))) return null;
  const setup = setupFor(snapshotMap(map), Math.floor(seed), area?.id, lootClass, normalizeMapTree(wrapper?.mapTree));
  // Preserve the creation decision; pre-event maps do not gain a surprise on restart.
  if (wrapper && 'event' in wrapper) setup.event = normalizeMapEvent(wrapper.event);
  else delete setup.event;
  const fee = paidTerritoryFee(wrapper?.entranceScrap);
  if (fee > 0) setup.entranceScrap = fee;
  const key = paidEntranceKey(wrapper);
  if (key) setup.entranceKey = key;
  return setup;
}

/** Legacy Reliquary runs predate explicit receipts. No other area infers a payment. */
export function paidEntranceKey(raw: unknown): RunSetup['entranceKey'] {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.entranceKey === 'string' && atlasKeyDestination(raw.entranceKey as NonNullable<RunSetup['entranceKey']>))
    return raw.entranceKey as NonNullable<RunSetup['entranceKey']>;
  return raw.entranceKey === undefined && raw.atlasAreaId === 'sealedReliquary' ? 'reliquaryKey' : undefined;
}

/**
 * One player's resolved stats, skills, loadout and flasks for an instance (setup null = hideout). A
 * map's player penalties (Exhausting, Hexed, Unravelling) apply inside it — exactly what
 * deriveStats(ch, setup) shows. Push it again (SimRun.updatePlayer) after a level-up, gear or flask change.
 */
export function playerRuntime(ch: CharacterSave, setup: RunSetup | null): PlayerRuntime {
  const model = buildPlayerModel(ch, setup ? mapPlayerModifiers(setup.map, setup.monsterLevel) : [], undefined, setup?.monsterLevel ?? null);
  const { combat } = computeCombat(model);
  return {
    stats: combat,
    skills: playerSkills(ch, model),
    loadout: normalizeLoadout(ch),
    flasks: flaskRuntimes(ch, combat.flaskEffect),
  };
}

/** The hideout has only the training dummy: neutral scaling, no packs, no experience. */
function hideoutScaling(): MonsterScaling {
  return {
    level: 1,
    lifeMultiplier: 1,
    damageMultiplier: 1,
    speedMultiplier: 1,
    countMultiplier: 1,
    magicPackChance: 0,
    rarePackChance: 0,
    resistBonus: 0,
    xpMultiplier: 0,
    extraProjectiles: 0,
    hazards: false,
  };
}

const HIDEOUT_WAVES: WaveConfig = {
  count: 0,
  baseMonsters: 0,
  monstersPerWave: 0,
  waveDuration: WAVES.waveDuration,
  tellDuration: WAVES.tellDuration,
  lieutenantWave: 0,
  bossWave: 0,
};

/**
 * Seed of one character's hideout instance (its decor layout), for RunConfig.seed. buildRunConfig(null,
 * hooks) has no owner, so it uses HIDEOUT_SEED; the server sets `config.seed = hideoutSeed(ownerId)`
 * before createRun so every hideout looks like its owner's (stable across restarts).
 */
export function hideoutSeed(ownerCharacterId: string): number {
  return hashU32((HIDEOUT_SEED ^ hashString(String(ownerCharacterId))) >>> 0);
}

/**
 * The sim config of an instance: the hideout when `setup` is null, otherwise the map described by the
 * setup (seed, theme, arena, monster scaling, waves). Players are not part of it: each one joins with
 * SimRun.addPlayer({ id, name, level, runtime: playerRuntime(ch, setup) }). Hideouts all start from
 * HIDEOUT_SEED; the server overwrites `seed` with hideoutSeed(owner) before createRun.
 */
export function buildRunConfig(setup: RunSetup | null, hooks: RunHooks): RunConfig {
  if (!setup) {
    return {
      mode: 'hideout',
      seed: HIDEOUT_SEED,
      theme: 'hideout',
      mapName: 'Hideout',
      tier: 0,
      arenaRadius: HIDEOUT_ARENA_RADIUS,
      monsters: hideoutScaling(),
      waves: { ...HIDEOUT_WAVES },
      hooks,
    };
  }
  const map = setup.map;
  const base = findMapBase(map.baseId);
  const area = findAtlasArea(setup.atlasAreaId);
  const tree = mapTreeBonuses(setup.mapTree);
  return {
    mode: 'map',
    event: setup.event ?? null,
    ...((area?.bossLifeMultiplier ?? 1) * tree.bossLifeMultiplier !== 1 ? { bossLifeMultiplier: (area?.bossLifeMultiplier ?? 1) * tree.bossLifeMultiplier } : {}),
    ...(area?.bossDamageMultiplier ? { bossDamageMultiplier: area.bossDamageMultiplier } : {}),
    seed: setup.seed >>> 0,
    theme: base?.theme ?? 'ashenForge',
    mapName: area?.name ?? mapTitle(map),
    tier: clampTier(map.tier),
    arenaRadius: (base?.arenaRadius ?? 900) * (area?.arenaScale ?? 1),
    monsters: monsterScaling(map, setup.mapTree),
    waves: area?.noBoss ? { ...waveConfig(map), bossWave: 0 } : waveConfig(map),
    hooks,
  };
}
