// Static audit of the Atlas tree data (brief B section 10.2): shape, graph, ledger bands, caps and the "no character stats" rule.
import { describe, expect, it } from 'vitest';
import { ATLAS_EVENT_KIND_IDS } from '../../src/contracts/atlas';
import {
  ATLAS_CAPS, atlasNodeAllocatable, ATLAS_ORIGIN_ID, MAP_TREE, MAP_TREE_ORIGIN, nodeUnits, findAtlasNode, type AtlasNode,
} from '../../src/data/progression/map-tree';
import { MAP_BASE_IDS } from '../../src/contracts/content';
import { resolveAtlasRules } from '../../src/game/progression/atlas-rules';
import { pathTo } from './atlas-tree-helpers';

const ALL = [MAP_TREE_ORIGIN, ...MAP_TREE];
const byKind = (kind: AtlasNode['kind']) => MAP_TREE.filter(n => n.kind === kind);
const REAL_MAP_STATS = new Set([
  'monsterCount', 'monsterLife', 'monsterDamage', 'monsterSpeed', 'packRarity', 'monsterResist', 'playerFocusRegen', 'playerResist', 'itemQuantity', 'itemRarity',
  'mapDropChance', 'essenceDropChance', 'emberEssenceChance', 'rimeEssenceChance', 'armourStability', 'magicPackChance', 'rarePackChance', 'eventChance',
  'chestUpgradeChance', 'chestQuality', 'droppedMapQuality', 'scarabDropChance', 'rareQuantity', 'normalQuantity', 'equipmentStability',
  'equipmentDropChance', 'bossIngredientChance', 'bossLife', 'bossUnique', 'bossLoot', 'chestLoot', 'chestRareChance', 'chestCurrency', 'waveDuration',
  'territoryFee', 'revealChance', 'dangerModStrength', 'corruptedModStrength',
]);

describe('atlas tree shape', () => {
  it('has about 148 nodes in the promised classes', () => {
    expect(ALL.length).toBe(145);
    expect(Math.abs(ALL.length - 148)).toBeLessThanOrEqual(6);
    expect(byKind('keystone')).toHaveLength(14);
    expect(byKind('tier')).toHaveLength(5);
    expect(byKind('theme')).toHaveLength(6);
    expect(byKind('event')).toHaveLength(12);
    expect(new Set(ALL.map(n => n.id)).size).toBe(ALL.length);
    for (const branch of ['cartography', 'foundry', 'bounty', 'fortune', 'echoes', 'peril']) expect(MAP_TREE.filter(n => n.group === branch).length).toBeGreaterThanOrEqual(16);
  });

  it('is a connected, reciprocal graph reachable from the origin with legal costs', () => {
    for (const n of ALL) {
      expect(n.links.length, n.id).toBeGreaterThan(0);
      expect(n.links, `${n.id} self link`).not.toContain(n.id);
      for (const l of n.links) expect(findAtlasNode(l)!.links, `${l} <-> ${n.id}`).toContain(n.id);
      expect(n.cost).toBe(n.kind === 'keystone' ? 2 : 1);
    }
    const seen = new Set([ATLAS_ORIGIN_ID]);
    const queue = [ATLAS_ORIGIN_ID];
    while (queue.length) for (const l of findAtlasNode(queue.shift()!)!.links) if (!seen.has(l)) { seen.add(l); queue.push(l); }
    expect(seen.size).toBe(ALL.length);
  });

  it('lays nodes out inside the 512 x 512 Codex world without overlap', () => {
    for (const n of ALL) {
      expect(n.pos.x, n.id).toBeGreaterThan(10); expect(n.pos.x, n.id).toBeLessThan(502);
      expect(n.pos.y, n.id).toBeGreaterThan(10); expect(n.pos.y, n.id).toBeLessThan(502);
    }
    let closest = Infinity;
    for (let i = 0; i < ALL.length; i++) for (let j = i + 1; j < ALL.length; j++) {
      closest = Math.min(closest, Math.hypot(ALL[i].pos.x - ALL[j].pos.x, ALL[i].pos.y - ALL[j].pos.y));
    }
    expect(closest).toBeGreaterThanOrEqual(9);
  });

  it('keeps a keystone about eleven points from the origin, so a build ends with two or three', () => {
    for (const k of byKind('keystone')) {
      const cost = pathTo(k.id).reduce((n, id) => n + findAtlasNode(id)!.cost, 0);
      expect(cost, k.id).toBeGreaterThanOrEqual(8); expect(cost, k.id).toBeLessThanOrEqual(15);
    }
  });
});

describe('exclusions', () => {
  it('are exactly four symmetric pairs among keystones', () => {
    const pairs = new Set<string>();
    for (const n of MAP_TREE) for (const e of n.excludes) {
      expect(findAtlasNode(e)!.excludes, `${n.id} <-> ${e}`).toContain(n.id);
      expect(n.kind).toBe('keystone'); expect(findAtlasNode(e)!.kind).toBe('keystone');
      pairs.add([n.id, e].sort().join('|'));
    }
    expect([...pairs].sort()).toEqual([
      'blankSlate|kingslayersTithe', 'deadEndDevotee|wageredCharts', 'emptyHalls|overrunDoctrine', 'swornToTheVeil|twinOmens',
    ]);
  });
});

describe('the value ledger', () => {
  it('keeps every node inside its net-value band', () => {
    const bad: string[] = [];
    for (const n of MAP_TREE) {
      const at9 = nodeUnits(n, 9), at3 = nodeUnits(n, 3), at15 = nodeUnits(n, 15);
      const fail = (why: string) => bad.push(`${n.id} (${n.kind}) ${why}: +${at9.reward.toFixed(2)} -${at9.danger.toFixed(2)} = ${at9.net.toFixed(2)}`);
      switch (n.kind) {
        case 'small': if (at9.net < 0.4 || at9.net > 1.5 || at9.danger > 1) fail('small band'); break;
        case 'notable': case 'event': if (at9.net < 2.4 || at9.net > 4.6) fail('notable band'); break;
        case 'keystone': if (at9.net < 3 || at9.net > 9 || at9.reward < 8 || at9.reward > 16 || at9.danger < 4) fail('keystone band'); break;
        case 'theme': if (at9.net < 2.4 || at9.net > 4 || at9.danger < 1) fail('theme band'); break;
        case 'tier':
          if (at3.reward < 0.4 || at3.reward > 2.4 || at15.reward < 1.5 || at15.reward > 6.5 || at15.net < 0) fail('tier band');
          if (at15.reward <= at3.reward) fail('tier bonus must grow with the tier');
          break;
        default: break;
      }
    }
    expect(bad).toEqual([]);
  });

  it('gives every keystone a real downside and every notable a clear one-idea text', () => {
    for (const k of byKind('keystone')) {
      expect(nodeUnits(k).danger, k.id).toBeGreaterThanOrEqual(4);
      expect(k.notes.length + k.effects.filter(e => nodeUnits({ effects: [e], rules: [] }).danger > 0).length, `${k.id} states its downside`).toBeGreaterThan(0);
    }
    for (const n of MAP_TREE) {
      expect(n.lines.length, n.id).toBeGreaterThan(0);
      expect(n.text, n.id).not.toMatch(/NaN|undefined|\[object/);
    }
  });

  it('averages the target 1.8 units per point on a finished 60-point build', () => {
    // 34 smalls + 16 notables + 2 keystones + 3 tier or theme nodes (brief 4.1): about 110u.
    const avg = (kind: AtlasNode['kind']) => byKind(kind).filter(n => n.engine === 'live').reduce((s, n) => s + nodeUnits(n, 9).net, 0) / byKind(kind).filter(n => n.engine === 'live').length;
    const build = 34 * avg('small') + 16 * avg('notable') + 2 * avg('keystone') + 3 * avg('theme');
    expect(build).toBeGreaterThan(80); expect(build).toBeLessThan(130);
  });
});

describe('rules and caps', () => {
  it('writes only map stats: no node touches character stats, tier or monster level', () => {
    for (const n of MAP_TREE) for (const e of n.effects) {
      expect(REAL_MAP_STATS.has(e.stat), `${n.id}: ${e.stat}`).toBe(true);
      expect(e.stat).not.toMatch(/^(tier|level|monsterLevel|life|mana|focus|allRes|spellDamage)/);
    }
  });

  it('confines live nodes to rules the engine implements and marks every other node with its engine', () => {
    for (const n of MAP_TREE) {
      if (n.engine === 'live') for (const r of n.rules) expect(['currencyWeight', 'bossWave', 'equipmentNormalOnly'], `${n.id}: ${r.id}`).toContain(r.id);
      else expect(n.rules.length, `${n.id} waits for ${n.engine} and says what for`).toBeGreaterThan(0);
    }
    expect(MAP_TREE.filter(n => n.engine === 'events').map(n => n.id).sort()).toEqual([
      'anvilBlessing', 'bellringer', 'crownRivalry', 'echoDust', 'faultWalker', 'greenThumb', 'hunterPatience', 'keeperOfTheFlame', 'longFuse',
      'pactBroker', 'quickFingers', 'quickStudy', 'resonantRift', 'ringmaster', 'swornToTheVeil', 'thawWarden', 'twinOmens', 'voidtouchedAtlas',
    ].sort());
  });

  it('gives each of the twelve encounters exactly one lens', () => {
    const lensEvents = byKind('event').map(n => (n.rules[0] as { event: string }).event).sort();
    expect(lensEvents).toEqual([...ATLAS_EVENT_KIND_IDS].sort());
  });

  it('makes theme seals active only on their base', () => {
    const seals = byKind('theme');
    expect(seals.map(n => n.base).sort()).toEqual([...MAP_BASE_IDS].sort());
    for (const s of seals) {
      for (const e of s.effects) expect(e.when?.base, `${s.id} effect`).toBe(s.base);
      for (const r of s.rules) if (r.id === 'currencyWeight') expect(r.when?.base).toBe(s.base);
    }
  });

  it('enforces every hard cap on the fullest possible tree', () => {
    const ids = MAP_TREE.filter(n => n.engine === 'live').map(n => n.id);
    for (const baseId of MAP_BASE_IDS) for (const tier of [3, 15]) {
      const rules = resolveAtlasRules(ids, { tier, baseId, corrupted: baseId === 'chainworks', areaId: 'heartOfForge', event: true });
      const sum = (stat: string, mode: string) => rules.modifiers.filter(m => m.stat === stat && m.mode === mode && m.value > 0).reduce((n, m) => n + m.value, 0);
      expect(sum('itemQuantity', 'increased')).toBeLessThanOrEqual(ATLAS_CAPS.itemQuantityIncreased + 1e-9);
      expect(sum('itemRarity', 'increased')).toBeLessThanOrEqual(ATLAS_CAPS.itemRarityIncreased + 1e-9);
      expect(sum('packRarity', 'increased')).toBeLessThanOrEqual(ATLAS_CAPS.packRarityIncreased + 1e-9);
      expect(sum('mapDropChance', 'increased')).toBeLessThanOrEqual(ATLAS_CAPS.mapDropChanceIncreased + 1e-9);
      expect(sum('essenceDropChance', 'increased')).toBeLessThanOrEqual(ATLAS_CAPS.essenceIncreased + 1e-9);
      expect(sum('eventChance', 'flat')).toBeLessThanOrEqual(ATLAS_CAPS.eventChancePoints + 1e-9);
      expect(sum('chestUpgradeChance', 'flat')).toBeLessThanOrEqual(ATLAS_CAPS.chestUpgradePoints + 1e-9);
      const life = rules.modifiers.filter(m => m.stat === 'monsterLife' && m.mode === 'more').reduce((p, m) => p * (1 + m.value / 100), 1);
      expect(life).toBeLessThanOrEqual(ATLAS_CAPS.monsterLifeMoreMultiplier + 1e-9);
      expect(rules.modifiers.filter(m => m.stat === 'essenceDropChance' && m.mode === 'more' && m.value > 0)).toHaveLength(1); // one "more" essence source
    }
    // and the tooltip says so
    const capped = resolveAtlasRules(ids, { tier: 15, baseId: 'ashenForge', corrupted: false, areaId: 'heartOfForge' });
    expect(capped.capped.length).toBeGreaterThan(0);
    expect(capped.modifiers.some(m => m.source.endsWith('(capped)'))).toBe(true);
  });

  it('is deterministic and cached per context', () => {
    const ids = pathTo('farHorizon');
    const a = resolveAtlasRules(ids, { tier: 5, baseId: 'ashenForge', corrupted: false });
    expect(resolveAtlasRules(ids, { tier: 5, baseId: 'ashenForge', corrupted: false })).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
  });
});

describe('the encounter interface (stream C)', () => {
  it('hands typed encounter rules to the Event Director for the encounters that exist, and refuses the rest', () => {
    const ctx = { tier: 9, baseId: 'ashenForge', corrupted: false } as const;
    const live = resolveAtlasRules(['strangeSigns', 'omenReader', 'hunterPatience', 'resonantRift'], ctx);
    expect(live.extraRules.map(r => r.node)).toEqual(['hunterPatience', 'resonantRift']);
    expect(live.extraRules[0].rule).toMatchObject({ id: 'eventLens', event: 'stalker' });
    const keystone = resolveAtlasRules(pathTo('twinOmens'), ctx).extraRules.find(r => r.node === 'twinOmens')!.rule;
    expect(keystone).toEqual({ id: 'eventSlots', extra: 1, rewardMore: -25, backlash: true });
    expect(resolveAtlasRules(pathTo('swornToTheVeil'), ctx).extraRules.find(r => r.node === 'swornToTheVeil')!.rule)
      .toEqual({ id: 'eventsAlways', rewardMore: 30, mandatory: true, timeoutSeconds: 90 });
    // Every lens of the thirteen-event director is live now; only the Void Breach keystone and the other engines stay locked.
    expect(resolveAtlasRules(['strangeSigns', 'omenReader', 'pactBroker'], ctx).extraRules.map(r => r.node)).toEqual(['pactBroker']);
    for (const id of ['voidtouchedAtlas']) expect(atlasNodeAllocatable(findAtlasNode(id)!), id).toBe(false);
    for (const id of ['pactBroker', 'greenThumb', 'ringmaster', 'thawWarden', 'anvilBlessing', 'bellringer', 'hunterPatience', 'resonantRift', 'quickFingers', 'crownRivalry', 'faultWalker', 'keeperOfTheFlame', 'twinOmens', 'swornToTheVeil', 'echoDust', 'longFuse', 'quickStudy']) expect(atlasNodeAllocatable(findAtlasNode(id)!), id).toBe(true);
    // The remaining engines are still gated.
    for (const n of MAP_TREE.filter(n => ['sim', 'device', 'items'].includes(n.engine))) expect(atlasNodeAllocatable(n), n.id).toBe(false);
  });
});

