// Map-drop routing harness (brief D 4.5 and 12): the kill-stream bot of the Atlas tree harness (same wave budgets, pack
// rarities and loot rules, common random numbers) reduced to ONE question: where do the maps of a run go? It opens a real map
// through rules.openMap (so the frozen routing table is the real one), feeds every kill, the boss and the chest through the real
// loot rules, and tallies the dropped maps by area and tier. Time per run comes from the harness's wave-queue model.
import type { AtlasAreaId, AtlasProgress } from '../../src/contracts/atlas';
import type { KillLootContext } from '../../src/contracts/sim';
import type { MapItem } from '../../src/contracts/items';
import { createRng } from '../../src/core/rng';
import { BASE_MAGIC_PACK_CHANCE, BASE_RARE_PACK_CHANCE, WAVES } from '../../src/data/progression';
import { ATLAS_AREAS, atlasTierCeiling, findAtlasArea } from '../../src/data/progression/atlas';
import { THEME_ROSTER } from '../../src/contracts/bestiary';
import { rules } from '../../src/game';
import { isMapAddress } from '../../src/game/progression/map-binding';
import { discoverAfterBoss } from '../../src/game/progression/atlas';
import { REFERENCE_KILL_SECONDS, clearSeconds, standardMap } from './atlas-tree-harness';
import { bareCharacter, expectOk, openAt } from './fixtures';

void BASE_MAGIC_PACK_CHANCE; void BASE_RARE_PACK_CHANCE;

export const ADDRESSES = ATLAS_AREAS.filter(isMapAddress);

/** Every bindable area is charted (the late game). */
export const allCharted = (): AtlasAreaId[] => ADDRESSES.map((a) => a.id);
/** What a player pushing the ladder has charted on arriving at `area`: every area no deeper than it. */
export const frontierCharted = (area: AtlasAreaId): AtlasAreaId[] => {
  const depth = findAtlasArea(area)!.depth;
  return ADDRESSES.filter((a) => a.depth <= depth || a.id === area).map((a) => a.id);
};

export function atlasOf(discovered: readonly AtlasAreaId[]): AtlasProgress {
  return { discovered: [...discovered], completed: [], clears: 0, treeVersion: 2 };
}

export interface RouteRun {
  maps: MapItem[];
  seconds: number;
  units: number;
  pending: AtlasAreaId[];
}

/** One run of `area` at `tier` for a looter who has charted `discovered`: every map it drops. */
export function routeRun(area: AtlasAreaId, tier: number, discovered: readonly AtlasAreaId[], seed: number, speed?: number, nodes: string[] = [], legacy = false): RouteRun {
  const atlas = { ...atlasOf(discovered), ...(nodes.length ? { nodes } : {}) };
  const m = standardMap(tier);
  const ch = bareCharacter({ atlas, currencyStash: { scrap: 1000 }, mapDevice: m, rngState: seed * 7919 + tier });
  const opened = expectOk(openAt(rules, ch, area)).setup;
  // `legacy`: the same run frozen without a routing table (the T0 behaviour: a theme is rolled, the area follows, no ceilings clamp).
  const { routing: _routing, ...old } = opened;
  const setup = legacy ? old : opened;
  const cfg = rules.buildRunConfig(setup, {} as never);
  const s = cfg.monsters;
  const rng = createRng(seed * 104729 + tier * 31);
  const boss = THEME_ROSTER[setup.map.baseId].boss;
  const maps: MapItem[] = [];
  let kills = 0;
  const lifeByWave: number[] = [];
  const take = (items: ReturnType<typeof rules.rollKillLoot>) => { for (const i of items) if (i.kind === 'map') maps.push(i); };
  const kill = (rarity: KillLootContext['rarity'], wave: number) => {
    take(rules.rollKillLoot(setup, { kind: 'ashling', summoned: false, rarity, isLieutenant: false, isBoss: false, wave, x: 0, y: 0 }, rng.fork(0x1000 + kills), ch));
    kills++;
  };
  for (let w = 1; w <= cfg.waves.count; w++) {
    const budget = Math.round((WAVES.baseMonsters + WAVES.monstersPerWave * (w - 1)) * s.countMultiplier);
    const packMembers = Math.round(budget * 0.6);
    let life = budget - packMembers;
    for (let n = 0; n < budget - packMembers; n++) kill('normal', w);
    for (let left = packMembers; left > 0;) {
      const size = Math.min(left, 4 + Math.floor(rng.next() * 5));
      const leader = rng.next() < s.rarePackChance ? 'rare' : rng.next() < s.magicPackChance ? 'magic' : 'normal';
      kill(leader, w); life += leader === 'rare' ? 3 : leader === 'magic' ? 1.5 : 1;
      for (let n = 1; n < size; n++) kill('normal', w);
      life += size - 1;
      left -= size;
    }
    lifeByWave.push(life * s.lifeMultiplier);
  }
  // The lieutenant roll of the real sim: one lieutenant per run, then the boss and the chest.
  if (cfg.waves.lieutenantWave > 0) take(rules.rollKillLoot(setup, { kind: boss, summoned: false, rarity: 'rare', isLieutenant: true, isBoss: false, wave: cfg.waves.lieutenantWave, x: 0, y: 0 }, rng.fork(3), ch));
  take(rules.rollKillLoot(setup, { kind: boss, summoned: false, rarity: 'rare', isLieutenant: false, isBoss: true, wave: cfg.waves.bossWave, x: 0, y: 0 }, rng.fork(1), ch));
  take(rules.rollChestLoot(setup, rng.fork(2), ch));
  const bossLife = 40 * s.lifeMultiplier * (cfg.bossLifeMultiplier ?? 1);
  const units = lifeByWave.reduce((a, b) => a + b, 0) + bossLife;
  const sp = speed ?? units / (cfg.waves.count * REFERENCE_KILL_SECONDS);
  const seconds = clearSeconds({ count: cfg.waves.count, waveDuration: cfg.waves.waveDuration, bossWave: cfg.waves.bossWave, tellDuration: cfg.waves.tellDuration }, lifeByWave, bossLife, sp);
  return { maps, seconds, units, pending: (opened.routing?.candidates ?? []).filter((c) => c.pending).map((c) => c.areaId) };
}

export interface RouteStats {
  runs: number;
  mapsPerRun: number;
  secondsPerRun: number;
  mapsPerHour: number;
  /** Maps per run by destination area. */
  byArea: Record<string, number>;
  /** Maps per run by dropped tier. */
  byTier: Record<number, number>;
  /** Maps per run that accept (ceiling >=) tier + 1: the "can climb" supply. */
  climbPerRun: number;
  /** Share of runs whose drops hold at least one map accepting tier + 1 (run tier below 15). */
  runsWithClimb: number;
  /** Share of maps for the run's own area / the neighbours / further. */
  shares: { own: number; neighbour: number; other: number };
  /** The share of maps dropped as T`tier+1` or higher (the upward share, after ceilings). */
  upShare: number;
}

export function routeStats(area: AtlasAreaId, tier: number, discovered: readonly AtlasAreaId[], seeds: readonly number[], nodes: string[] = []): RouteStats {
  const baseline = routeRun(area, tier, discovered, seeds[0], undefined, nodes);
  const speed = baseline.units / (6 * REFERENCE_KILL_SECONDS);
  const home = findAtlasArea(area)!;
  const byArea: Record<string, number> = {};
  const byTier: Record<number, number> = {};
  let total = 0, seconds = 0, climb = 0, runsWithClimb = 0, own = 0, near = 0, up = 0;
  for (const seed of seeds) {
    const r = routeRun(area, tier, discovered, seed, speed, nodes);
    seconds += r.seconds;
    let anyClimb = false;
    for (const m of r.maps) {
      total++;
      byArea[m.areaId] = (byArea[m.areaId] ?? 0) + 1;
      byTier[m.tier] = (byTier[m.tier] ?? 0) + 1;
      if (atlasTierCeiling(findAtlasArea(m.areaId)!) >= tier + 1) { climb++; anyClimb = true; }
      if (m.tier > tier) up++;
      if (m.areaId === area) own++; else if (home.neighbours.includes(m.areaId) || findAtlasArea(m.areaId)!.neighbours.includes(area)) near++;
    }
    if (anyClimb || tier >= 15) runsWithClimb++;
  }
  const n = seeds.length;
  const norm = (o: Record<string | number, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v / n]));
  return {
    runs: n, mapsPerRun: total / n, secondsPerRun: seconds / n, mapsPerHour: total / seconds * 3600,
    byArea: norm(byArea), byTier: norm(byTier) as Record<number, number>, climbPerRun: climb / n, runsWithClimb: runsWithClimb / n,
    shares: { own: own / (total || 1), neighbour: near / (total || 1), other: (total - own - near) / (total || 1) },
    upShare: up / (total || 1),
  };
}

// ---------------------------------------------------------------------------------------------
// Ladder bot (brief D 12.2): "run the best available map" from the starter map to the first Tier 15 run
// ---------------------------------------------------------------------------------------------

export interface Ladder {
  /** Runs until the first Tier 15 run; the cap when it never got there (stranded). */
  runs: number;
  reached: boolean;
  /** Runs spent at a tier whose ceiling-mates held no map of a deeper tier ("waiting for a climb"). */
  stuckRuns: number;
  /** Longest stretch of runs without the best available tier improving. */
  longestPlateau: number;
  maps: number;
}

export function ladder(seed: number, legacy: boolean, cap = 1500): Ladder {
  let progress = atlasOf(['cinderCrossing']);
  const rng = createRng(seed * 40503 + 17);
  const bag: { areaId: AtlasAreaId; tier: number }[] = [{ areaId: 'cinderCrossing', tier: 1 }];
  let runs = 0, best = 1, plateau = 0, longest = 0, stuck = 0, maps = 0;
  while (runs < cap) {
    let pick = 0;
    for (let i = 1; i < bag.length; i++) if (bag[i].tier > bag[pick].tier) pick = i;
    const m = bag.splice(pick, 1)[0];
    runs++;
    if (m.tier >= 15) return { runs, reached: true, stuckRuns: stuck, longestPlateau: longest, maps };
    if (!progress.discovered.includes(m.areaId)) {
      if (!legacy) throw new Error(`routed drop for an undiscovered area ${m.areaId} (run ${runs}, seed ${seed})`);
      progress = { ...progress, discovered: [...progress.discovered, m.areaId] }; // T0 legacy: the map is its own chart fragment
    }
    const r = routeRun(m.areaId, m.tier, progress.discovered as AtlasAreaId[], seed * 100003 + runs, undefined, [], legacy);
    for (const d of r.maps) bag.push({ areaId: d.areaId, tier: d.tier });
    maps += r.maps.length;
    progress = discoverAfterBoss(progress, m.areaId, false, { revealRoll: rng.next(), tier: m.tier }).progress;
    const top = Math.max(0, ...bag.map((b) => b.tier));
    if (top > best) { best = top; plateau = 0; } else plateau++;
    longest = Math.max(longest, plateau);
    if (top <= m.tier) stuck++;
  }
  return { runs, reached: false, stuckRuns: stuck, longestPlateau: longest, maps };
}
