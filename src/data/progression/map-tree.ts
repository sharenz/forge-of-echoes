// The Atlas tree ("the Codex"): about 145 nodes in six branches around one origin, 14 keystones, five tier-bonus
// nodes and six theme seals (docs/atlas-rework/B-atlas-tree.md). Nodes change map rules only, never character stats.
// Every effect is a MapStat effect (shared modifier resolver, game/progression/atlas-rules.ts) or a typed rule.
import type { AtlasProgress } from '../../contracts/atlas';
import { BELT } from './atlas-tree/belt';
import { BOUNTY } from './atlas-tree/bounty';
import { BRIDGES } from './atlas-tree/bridges';
import { CARTOGRAPHY } from './atlas-tree/cartography';
import { ECHOES } from './atlas-tree/echoes';
import { FORTUNE } from './atlas-tree/fortune';
import { FOUNDRY } from './atlas-tree/foundry';
import { HUB } from './atlas-tree/hub';
import { PERIL } from './atlas-tree/peril';
import { nodeLines } from './atlas-tree/ledger';
import { flat, more } from './atlas-tree/dsl';
import type { AtlasBranch, AtlasEffect, AtlasEngine, AtlasNode, AtlasNodeGroup, AtlasNodeSpec } from './atlas-tree/types';
import { ATLAS_BRANCHES } from './atlas-tree/types';
import type { MapEffectDef } from './types';

export * from './atlas-tree/types';
export { nodeUnits, effectUnits, UNIT_RATES, effectLine } from './atlas-tree/ledger';

// ---------------------------------------------------------------------------------------------
// Economy and rules
// ---------------------------------------------------------------------------------------------

export const ATLAS_ORIGIN_ID = 'origin';
export const ATLAS_KEYSTONE_COST = 2;
/** Total attainable points: 25 area first-clears + 14 tier first-clears + 12 events + 6 bosses + 3 milestones. */
export const MAP_TREE_POINTS = { areas: 25, tiers: 14, events: 12, bosses: 6, milestones: 3, total: 60 } as const;
/** Tiers 2..15 grant a point on their first clear. */
export const ATLAS_POINT_TIERS: readonly number[] = Array.from({ length: 14 }, (_, i) => i + 2);
/** Milestones: this fraction of areas charted. */
export const ATLAS_MILESTONE_FRACTIONS = [0.5, 0.75, 1] as const;
/** The first refunds an account ever makes cost nothing. */
export const ATLAS_FREE_REFUNDS = 6;
/** Scrap to refund one node by class. */
export const ATLAS_RESPEC_COST = { small: 5, notable: 15, keystone: 40 } as const;
/** One respec session never costs more than this (reset when a map is opened). */
export const ATLAS_RESPEC_SESSION_CAP = 120;
export const ATLAS_WAVE_DURATION_FLOOR = 25;

/** Hard caps on what the tree alone may add (brief B 6.1); the resolver reports "(capped)". */
export const ATLAS_CAPS = {
  itemQuantityIncreased: 45,
  itemRarityIncreased: 60,
  packRarityIncreased: 100,
  mapDropChanceIncreased: 80,
  essenceIncreased: 60,
  /** At most one "more" source of Essence weight from the tree. */
  essenceMoreSources: 1,
  eventChancePoints: 12,
  chestUpgradePoints: 13,
  /** Product of the tree's "more monster life". */
  monsterLifeMoreMultiplier: 1.6,
} as const;

// ---------------------------------------------------------------------------------------------
// Assembly: layout in the 512 x 512 Codex world, reciprocal links
// ---------------------------------------------------------------------------------------------

const CENTER = 256;
const ringRadius = (ring: number) => (ring <= 0 ? 0 : 28 + 19 * ring);
const LANE_PX = 18;
const BRANCH_ANGLE: Record<AtlasBranch, number> = { cartography: -90, fortune: -30, echoes: 30, peril: 90, bounty: 150, foundry: 210 };
const point = (angleDeg: number, r: number) => ({ x: Math.round((CENTER + r * Math.cos(angleDeg * Math.PI / 180)) * 10) / 10, y: Math.round((CENTER + r * Math.sin(angleDeg * Math.PI / 180)) * 10) / 10 });
const BRANCH_SPECS: Record<AtlasBranch, readonly AtlasNodeSpec[]> = {
  cartography: CARTOGRAPHY, foundry: FOUNDRY, bounty: BOUNTY, fortune: FORTUNE, echoes: ECHOES, peril: PERIL,
};

interface Draft { spec: Omit<AtlasNodeSpec, 'ring' | 'lane' | 'from'>; group: AtlasNodeGroup; pos: { x: number; y: number }; from: string[] }

function build(): AtlasNode[] {
  const drafts: Draft[] = [];
  const spine = (branch: AtlasBranch, ring: number) => {
    const found = BRANCH_SPECS[branch].find(s => s.ring === ring && s.lane === 0);
    if (!found) throw new Error(`Atlas tree: ${branch} has no spine node at ring ${ring}`);
    return found.id;
  };
  for (const branch of ATLAS_BRANCHES) {
    for (const s of BRANCH_SPECS[branch]) {
      const r = ringRadius(s.ring);
      const angle = BRANCH_ANGLE[branch] + (s.lane * LANE_PX / r) * 180 / Math.PI;
      drafts.push({ spec: s, group: branch, pos: point(angle, r), from: typeof s.from === 'string' ? [s.from] : [...s.from] });
    }
  }
  for (const h of HUB) drafts.push({ spec: h, group: 'hub', pos: point(h.angle, 34), from: [ATLAS_ORIGIN_ID] });
  for (const b of BRIDGES) {
    const [a, c] = b.between;
    let angle = (BRANCH_ANGLE[a] + BRANCH_ANGLE[c]) / 2;
    if (Math.abs(BRANCH_ANGLE[a] - BRANCH_ANGLE[c]) > 180) angle += 180;
    let prev: string | undefined;
    for (const n of b.nodes) {
      const attach = Math.floor(n.ring);
      drafts.push({ spec: { id: n.id, name: n.name, kind: 'small', effects: n.effects, rules: n.rules }, group: 'bridge',
        pos: point(angle, ringRadius(n.ring)), from: [spine(a, attach), spine(c, attach), ...(prev ? [prev] : [])] });
      prev = n.id;
    }
  }
  for (const t of BELT) {
    drafts.push({ spec: t.small, group: 'belt', pos: point(t.angle, ringRadius(10)), from: t.between.map(b => spine(b as AtlasBranch, 8)) });
    drafts.push({ spec: t.seal, group: 'belt', pos: point(t.angle, ringRadius(11.3)), from: [t.small.id] });
  }
  const links = new Map<string, Set<string>>([[ATLAS_ORIGIN_ID, new Set()]]);
  for (const d of drafts) links.set(d.spec.id, new Set());
  for (const d of drafts) for (const f of d.from) {
    if (!links.has(f)) throw new Error(`Atlas tree: ${d.spec.id} links to unknown ${f}`);
    links.get(d.spec.id)!.add(f);
    links.get(f)!.add(d.spec.id);
  }
  const origin: AtlasNode = {
    id: ATLAS_ORIGIN_ID, name: 'Cinder Crossing Brazier', kind: 'origin', group: 'origin', pos: { x: CENTER, y: CENTER },
    links: [...links.get(ATLAS_ORIGIN_ID)!], cost: 1, effects: [], rules: [], notes: [], lines: [], text: 'Where every path begins.', engine: 'live', excludes: [],
  };
  const nodes = drafts.map((d): AtlasNode => {
    const spec = d.spec;
    const lines = nodeLines(spec);
    return {
      id: spec.id, name: spec.name, kind: spec.kind, group: d.group, pos: d.pos, links: [...links.get(spec.id)!],
      cost: spec.kind === 'keystone' ? ATLAS_KEYSTONE_COST : 1,
      effects: spec.effects ?? [], rules: spec.rules ?? [], ...(spec.units ? { units: spec.units } : {}), notes: spec.notes ?? [],
      lines, text: lines.join(' '), engine: spec.engine ?? 'live', excludes: spec.excludes ?? [],
      ...(spec.base ? { base: spec.base } : {}), ...(spec.flavor ? { flavor: spec.flavor } : {}),
    };
  });
  return [origin, ...nodes];
}

const ALL_NODES: readonly AtlasNode[] = build();
export const MAP_TREE_ORIGIN: AtlasNode = ALL_NODES[0];
/** Every allocatable node (the origin is free and implicit). */
export const MAP_TREE: readonly AtlasNode[] = ALL_NODES.slice(1);
export const MAP_TREE_NODE_IDS: readonly string[] = MAP_TREE.map(n => n.id);
const BY_ID = new Map<string, AtlasNode>(ALL_NODES.map(n => [n.id, n]));

// ---------------------------------------------------------------------------------------------
// Legacy tree (expeditions frozen before the redraw keep their old numbers)
// ---------------------------------------------------------------------------------------------

export const LEGACY_PREFIX = 'legacy:';
interface LegacyDef { id: string; name: string; text: string; effects?: readonly MapEffectDef[]; eventChance?: number; chestUpgradeChance?: number; bossUniqueMore?: number; bossLifeMore?: number }
const LEGACY: readonly LegacyDef[] = [
  { id: 'trailblazer', name: 'Trailblazer', text: '20% increased ordinary map drop chance.', effects: [{ stat: 'mapDropChance', mode: 'increased', value: 20 }] },
  { id: 'chartKeeper', name: 'Chart Keeper', text: '30% increased ordinary map drop chance.', effects: [{ stat: 'mapDropChance', mode: 'increased', value: 30 }] },
  { id: 'farHorizon', name: 'Far Horizon', text: 'Completion chests upgrade the map 15 percentage points more often.', chestUpgradeChance: 0.15 },
  { id: 'essenceSeeker', name: 'Essence Seeker', text: '25% increased Essence weight.', effects: [{ stat: 'essenceDropChance', mode: 'increased', value: 25 }] },
  { id: 'soundFoundations', name: 'Sound Foundations', text: 'Non-unique armour bases drop with +1 maximum Stability.', effects: [{ stat: 'armourStability', mode: 'flat', value: 1 }] },
  { id: 'deepSeams', name: 'Deep Seams', text: '50% more Essence weight. Monsters have 10% more Life.', effects: [{ stat: 'essenceDropChance', mode: 'more', value: 50 }, { stat: 'monsterLife', mode: 'more', value: 10 }] },
  { id: 'markedPrey', name: 'Marked Prey', text: '20% increased magic and rare pack chance.', effects: [{ stat: 'packRarity', mode: 'increased', value: 20 }] },
  { id: 'crowdedGrounds', name: 'Crowded Grounds', text: '10% increased monster count and 5% increased Item Quantity.', effects: [{ stat: 'monsterCount', mode: 'increased', value: 10 }, { stat: 'itemQuantity', mode: 'increased', value: 5 }] },
  { id: 'apexHunt', name: 'Apex Hunt', text: '40% increased pack chance and 15% increased Item Rarity. Monsters deal 5% more damage.', effects: [{ stat: 'packRarity', mode: 'increased', value: 40 }, { stat: 'itemRarity', mode: 'increased', value: 15 }, { stat: 'monsterDamage', mode: 'more', value: 5 }] },
  { id: 'scavenger', name: 'Scavenger', text: '5% increased Item Quantity.', effects: [{ stat: 'itemQuantity', mode: 'increased', value: 5 }] },
  { id: 'discerningEye', name: 'Discerning Eye', text: '15% increased Item Rarity.', effects: [{ stat: 'itemRarity', mode: 'increased', value: 15 }] },
  { id: 'crownedChallenge', name: 'Crowned Challenge', text: 'Final bosses have 25% more Life and 50% higher unique chances.', bossUniqueMore: 50, bossLifeMore: 25 },
  { id: 'strangeSigns', name: 'Strange Signs', text: '+5 percentage points to random encounter chance.', eventChance: 0.05 },
  { id: 'echoCompass', name: 'Echo Compass', text: '+5 percentage points to random encounter chance.', eventChance: 0.05 },
  { id: 'beyondTheVeil', name: 'Beyond the Veil', text: '+10 percentage points encounter chance, 5% increased Item Quantity. Monsters have 10% more Life.', eventChance: 0.10, effects: [{ stat: 'itemQuantity', mode: 'increased', value: 5 }, { stat: 'monsterLife', mode: 'more', value: 10 }] },
];
export const LEGACY_MAP_TREE_IDS: readonly string[] = LEGACY.map(l => l.id);
for (const l of LEGACY) {
  const effects: AtlasEffect[] = [...(l.effects ?? [])];
  if (l.eventChance) effects.push(flat('eventChance', l.eventChance * 100));
  if (l.chestUpgradeChance) effects.push(flat('chestUpgradeChance', l.chestUpgradeChance * 100));
  if (l.bossUniqueMore) effects.push(more('bossUnique', l.bossUniqueMore));
  if (l.bossLifeMore) effects.push(more('bossLife', l.bossLifeMore));
  BY_ID.set(LEGACY_PREFIX + l.id, {
    id: LEGACY_PREFIX + l.id, name: l.name, kind: 'small', group: 'origin', pos: { x: 0, y: 0 }, links: [], cost: 1, effects, rules: [], notes: [], lines: [l.text],
    text: l.text, engine: 'live', excludes: [],
  });
}

// ---------------------------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------------------------

export function findAtlasNode(id: unknown): AtlasNode | undefined {
  return typeof id === 'string' ? BY_ID.get(id) : undefined;
}
export function isAtlasNodeId(id: unknown): id is string { return typeof id === 'string' && id !== ATLAS_ORIGIN_ID && BY_ID.has(id) && !id.startsWith(LEGACY_PREFIX); }
export function isLegacyNodeId(id: string): boolean { return LEGACY_MAP_TREE_IDS.includes(id); }
export function legacyNodeId(id: string): string { return LEGACY_PREFIX + id; }

/** Nodes for a list of ids, in the given order; unknown ids are skipped. */
export function mapTreeNodes(ids: readonly string[] = []): readonly AtlasNode[] {
  return ids.map(id => BY_ID.get(id)).filter((n): n is AtlasNode => !!n && n.id !== ATLAS_ORIGIN_ID);
}

/** Only nodes whose effects the engine already implements can be allocated. */
export const ATLAS_LIVE_ENGINES: ReadonlySet<AtlasEngine> = new Set<AtlasEngine>(['live', 'events']);
/**
 * The encounters the Event Director has today (ATLAS_EVENT_TO_KIND in game/progression/map-event-rules.ts must list exactly these;
 * a test keeps them in step). An event-engine node whose lens belongs to an encounter that is not built yet stays locked.
 * Still gated after this: 'sim' (Warded Hunts, Stragglers' Cull), 'device' (Lantern-Bearer, Fifth Socket, Twinned Sockets,
 * Single-Minded Furnace), 'items' (Wagered Charts), and Voidtouched Atlas (needs the Void Breach event).
 */
export const ATLAS_BUILT_EVENTS: ReadonlySet<string> = new Set(['stalker', 'echoing', 'caravan', 'rivalCrowns', 'fault', 'emberRelay', 'pactAltar', 'orchard', 'ring', 'host', 'anvil', 'bellwatch']);
export function atlasNodeAllocatable(node: AtlasNode): boolean {
  if (!ATLAS_LIVE_ENGINES.has(node.engine)) return false;
  if (node.engine !== 'events') return true;
  return node.rules.every(r => r.id === 'eventLens' ? ATLAS_BUILT_EVENTS.has(r.event) : r.id !== 'voidBreach');
}
export const ENGINE_LABEL: Record<AtlasEngine, string> = {
  live: 'Active', events: 'Awaits its encounter', sim: 'Awaits the monster update', device: 'Awaits the Map Device update', items: 'Awaits the map crafting update',
};

export function atlasRespecClass(node: AtlasNode): keyof typeof ATLAS_RESPEC_COST {
  return node.kind === 'keystone' ? 'keystone' : node.kind === 'small' ? 'small' : 'notable';
}
export function atlasRespecCost(node: AtlasNode): number { return ATLAS_RESPEC_COST[atlasRespecClass(node)]; }

// ---------------------------------------------------------------------------------------------
// Points (pure function of account progress: a restart or failed save can never lose or double one)
// ---------------------------------------------------------------------------------------------

export function atlasPointBreakdown(progress: Pick<AtlasProgress, 'completed' | 'tiersCleared' | 'eventsSeen' | 'bossesSeen'> | undefined, areaTotal: number, bossKinds: readonly string[], eventKinds: readonly string[]) {
  const areas = new Set(progress?.completed ?? []).size;
  const tiers = new Set((progress?.tiersCleared ?? []).filter(t => ATLAS_POINT_TIERS.includes(t))).size;
  const events = new Set((progress?.eventsSeen ?? []).filter(e => eventKinds.includes(e))).size;
  const bosses = new Set((progress?.bossesSeen ?? []).filter(b => bossKinds.includes(b))).size;
  const milestones = ATLAS_MILESTONE_FRACTIONS.filter(f => areas >= Math.ceil(areaTotal * f)).length;
  return { areas, tiers, events, bosses, milestones, total: areas + tiers + events + bosses + milestones };
}

// ---------------------------------------------------------------------------------------------
// Compatibility aggregate for callers that only need the non-stat totals
// ---------------------------------------------------------------------------------------------

export function mapTreeBonuses(ids: readonly string[] = []) {
  const effects = mapTreeNodes(ids).flatMap(n => n.effects);
  const sum = (stat: string) => effects.filter(e => e.stat === stat && e.mode === 'flat').reduce((n, e) => n + e.value, 0);
  const mult = (stat: string) => effects.filter(e => e.stat === stat && e.mode === 'more').reduce((n, e) => n * (1 + e.value / 100), 1);
  return {
    eventChance: Math.min(ATLAS_CAPS.eventChancePoints, sum('eventChance')) / 100,
    chestUpgradeChance: Math.min(ATLAS_CAPS.chestUpgradePoints, sum('chestUpgradeChance')) / 100,
    bossUniqueMultiplier: mult('bossUnique'),
    bossLifeMultiplier: mult('bossLife'),
  };
}

