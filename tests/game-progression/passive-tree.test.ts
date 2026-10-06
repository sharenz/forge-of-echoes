// The Orrery's static audit (docs/power-rework/passive-tree.md 8.1): census, graph, costs, exclusions, ledger bands, caps, point
// sources and layout. The data is built from the table in src/data/progression/passives/nodes.ts.
import { describe, expect, it } from 'vitest';
import { STAT_IDS } from '../../src/contracts/items';
import { MASTERY_CHOICES, PASSIVE_SECTORS } from '../../src/contracts/passives';
import { MAP_TREE } from '../../src/data/progression/map-tree';
import {
  BOSS_MARK_KINDS, LEDGER_RATES, ORRERY_CAPS, ORRERY_DAMAGE_STATS, ORRERY_SIZE, PASSIVE_NODES, PASSIVE_NODE_IDS, PASSIVE_POINTS,
  PASSIVE_RULES, PASSIVE_START_ID, findPassiveNode, ledgerUnits, nextPassivePointLevel, passivePointsEarned,
} from '../../src/data/progression/passives';
import { resolvePassives } from '../../src/game/progression/passives';
import { LEVEL_CAP } from '../../src/data/progression';
import { cheapestPaths } from './passive-tree-harness';

const byKind = (kind: string) => PASSIVE_NODES.filter((n) => n.kind === kind);
const KEYSTONES = byKind('keystone');

describe('census (2.2)', () => {
  it('has exactly 252 nodes: 152 small, 77 notable (60 sector notables, 7 gates, 7 bridges, 3 cross-hub), 7 masteries, 15 keystones, Spark', () => {
    expect(PASSIVE_NODES).toHaveLength(252);
    expect(byKind('small')).toHaveLength(152);
    expect(byKind('notable').length + byKind('gate').length + byKind('bridge').length).toBe(77);
    expect(byKind('gate')).toHaveLength(7);
    expect(byKind('bridge')).toHaveLength(7);
    expect(byKind('notable').filter((n) => n.region === 'hub')).toHaveLength(3);
    expect(byKind('mastery')).toHaveLength(7);
    expect(KEYSTONES).toHaveLength(15);
    expect(byKind('start').map((n) => n.id)).toEqual([PASSIVE_START_ID]);
    expect(PASSIVE_NODES.length - byKind('small').length).toBe(100); // the 100 named nodes
  });

  it('matches the region table: hub 23, sectors 29 / 29 / 29 / 30 / 35 / 33 / 36', () => {
    const inSector = (s: string) => PASSIVE_NODES.filter((n) => n.region === s && n.kind !== 'gate' && n.kind !== 'bridge');
    const hub = PASSIVE_NODES.filter((n) => (n.region === 'hub' && n.kind !== 'start') || n.kind === 'gate');
    expect(hub).toHaveLength(23);
    expect(Object.fromEntries(PASSIVE_SECTORS.map((s) => [s, inSector(s).length]))).toEqual({
      fire: 29, lightning: 29, cold: 29, void: 30, arcana: 35, vitality: 33, bulwark: 36,
    });
    const keystones = Object.fromEntries(['hub', ...PASSIVE_SECTORS].map((r) => [r, KEYSTONES.filter((k) => k.region === r).length]));
    expect(keystones).toEqual({ hub: 2, fire: 1, lightning: 1, cold: 1, void: 2, arcana: 3, vitality: 2, bulwark: 3 });
  });

  it('names every keystone of the design (3.9)', () => {
    expect(KEYSTONES.map((k) => k.name).sort()).toEqual([
      'Absolute Zero', 'Echo Cascade', 'Eternal Bastion', "Gambler's Edge", 'Glass Orrery', 'Hollow Pact', 'Iron Mind', 'Perfect Tempo',
      'Phantom Weave', 'Pyre Doctrine', 'Razor Doctrine', 'Stormbound', 'Unending Vigil', 'Warded Throne', "Wanderer's Stride",
    ].sort());
  });
});

describe('graph', () => {
  it('uses its own id namespace, never an Atlas tree id', () => {
    const atlas = new Set(MAP_TREE.map((n) => n.id));
    for (const id of PASSIVE_NODE_IDS) {
      expect(id).toMatch(/^pas\.(hub|bridge|fire|lightning|cold|void|arcana|vitality|bulwark)\.[A-Za-z0-9]+$/);
      expect(atlas.has(id)).toBe(false);
    }
    expect(new Set(PASSIVE_NODE_IDS).size).toBe(PASSIVE_NODE_IDS.length);
  });

  it('links are reciprocal, known and never to itself', () => {
    for (const n of PASSIVE_NODES) {
      expect(n.links.length).toBeGreaterThan(0);
      for (const l of n.links) {
        expect(l).not.toBe(n.id);
        expect(findPassiveNode(l)?.links).toContain(n.id);
      }
    }
  });

  it('every node is reachable from Spark, and Spark touches all seven gates', () => {
    const seen = new Set([PASSIVE_START_ID]);
    const stack = [PASSIVE_START_ID as string];
    while (stack.length) for (const l of findPassiveNode(stack.pop())!.links) if (!seen.has(l)) { seen.add(l); stack.push(l); }
    expect(seen.size).toBe(PASSIVE_NODES.length);
    const spark = findPassiveNode(PASSIVE_START_ID)!;
    for (const g of byKind('gate')) expect(spark.links).toContain(g.id);
  });

  it('costs: Spark 0, keystones 2, everything else 1; a rim keystone is 12 points from Spark, a hub keystone 4', () => {
    for (const n of PASSIVE_NODES) expect(n.cost).toBe(n.kind === 'start' ? 0 : n.kind === 'keystone' ? 2 : 1);
    const { cost } = cheapestPaths(new Set());
    for (const s of PASSIVE_SECTORS) {
      const spineKeystone = KEYSTONES.find((k) => k.region === s && findPassiveNode(k.links[0])?.kind === 'mastery');
      expect(spineKeystone, s).toBeDefined();
      expect(cost.get(spineKeystone!.id)).toBe(12);
    }
    expect(cost.get('pas.hub.perfectTempo')).toBe(4);
    expect(cost.get('pas.hub.ironMind')).toBe(4);
    for (const k of KEYSTONES) expect(cost.get(k.id)!).toBeLessThanOrEqual(14);
    // A cross-hub notable is two or three steps from Spark.
    for (const n of byKind('notable').filter((x) => x.region === 'hub')) expect(cost.get(n.id)).toBe(3);
  });

  it('keystones and masteries are leaves or rim nodes: no path runs through a keystone', () => {
    for (const k of KEYSTONES) expect(k.links).toHaveLength(1);
  });

  it('bridges join adjacent sectors, cross-hub notables the named pairs', () => {
    for (const b of byKind('bridge')) {
      const [a, c] = b.sectors!;
      const ia = PASSIVE_SECTORS.indexOf(a), ic = PASSIVE_SECTORS.indexOf(c);
      expect((ia + 1) % PASSIVE_SECTORS.length).toBe(ic);
      expect(b.links.map((l) => findPassiveNode(l)!.region).sort()).toEqual([a, c].sort());
    }
    expect(Object.fromEntries(byKind('notable').filter((n) => n.region === 'hub').map((n) => [n.name, n.sectors]))).toEqual({
      'Frostfire Gate': ['fire', 'cold'], 'Rift Spark': ['lightning', 'void'], 'Mind and Blood': ['arcana', 'vitality'],
    });
  });

  it('exclusions are symmetric and exactly the pairs of 3.9', () => {
    const pairs = new Set<string>();
    for (const n of PASSIVE_NODES) {
      for (const x of n.excludes) {
        expect(findPassiveNode(x)!.excludes).toContain(n.id);
        pairs.add([n.name, findPassiveNode(x)!.name].sort().join(' / '));
      }
      if (n.excludes.length) expect(n.kind).toBe('keystone');
    }
    expect([...pairs].sort()).toEqual([
      'Absolute Zero / Pyre Doctrine', 'Absolute Zero / Stormbound', 'Eternal Bastion / Phantom Weave', "Gambler's Edge / Perfect Tempo",
      'Glass Orrery / Iron Mind', 'Glass Orrery / Warded Throne', 'Pyre Doctrine / Stormbound',
    ]);
  });

  it('every mastery offers three riders, and only masteries offer riders', () => {
    for (const n of PASSIVE_NODES) {
      if (n.kind === 'mastery') expect(n.choices).toHaveLength(MASTERY_CHOICES);
      else expect(n.choices).toBeUndefined();
    }
  });
});

describe('content rules', () => {
  it('no passive writes a map rule or an Atlas stat: stat lines are player stats, rules are known', () => {
    for (const n of PASSIVE_NODES) {
      for (const m of [...n.mods, ...(n.choices ?? []).flatMap((c) => c.mods)]) expect(STAT_IDS).toContain(m.stat);
      for (const r of [...n.rules, ...(n.choices ?? []).flatMap((c) => c.rules)]) expect(PASSIVE_RULES[r.id], r.id).toBeDefined();
      expect(n.text.length).toBeGreaterThan(0);
    }
  });

  it('only keystones and Volley carry a `more` penalty, and at most one positive `more` damage per sector (rule 5)', () => {
    for (const n of PASSIVE_NODES) {
      const less = n.mods.filter((m) => m.mode === 'more' && m.value < 0);
      if (less.length) expect(n.kind === 'keystone' || n.name === 'Volley', n.name).toBe(true);
    }
    for (const region of ['hub', ...PASSIVE_SECTORS]) {
      const more = PASSIVE_NODES.filter((n) => n.region === region && n.mods.some((m) => m.mode === 'more' && m.value > 0 && ORRERY_DAMAGE_STATS.includes(m.stat)));
      expect(more.length, region).toBeLessThanOrEqual(1);
    }
  });
});

describe('ledger (1.1, 1.2)', () => {
  const bands: Record<string, [number, number]> = { small: [0.7, 1.3], notable: [4, 8], gate: [4, 5], bridge: [4, 6], keystone: [22, 45] };

  it('every node sits in its gross band, with the price of its class', () => {
    for (const n of PASSIVE_NODES) {
      if (n.kind === 'start' || n.kind === 'mastery') continue;
      const [lo, hi] = bands[n.kind];
      expect(n.audit.gross, n.id).toBeGreaterThanOrEqual(lo);
      expect(n.audit.gross, n.id).toBeLessThanOrEqual(hi);
      if (n.kind === 'small') expect(n.audit.price).toBeLessThanOrEqual(0.3);
      else if (n.kind === 'keystone') {
        expect(n.audit.price, n.id).toBeGreaterThanOrEqual(10);
        expect(n.audit.price, n.id).toBeLessThanOrEqual(25);
        // Net +10 to +20 for the intended build (the first pass allows Wanderer's Stride its 10).
        expect(n.audit.gross - n.audit.price, n.id).toBeGreaterThanOrEqual(10);
        expect(n.audit.gross - n.audit.price, n.id).toBeLessThanOrEqual(20);
      } else expect(n.audit.price, n.id).toBeLessThanOrEqual(2);
    }
    for (const m of byKind('mastery')) for (const c of m.choices!) {
      expect(c.audit.gross, c.text).toBeGreaterThanOrEqual(3);
      expect(c.audit.gross, c.text).toBeLessThanOrEqual(6);
    }
  });

  it("small nodes are worth what the exchange rate says (every small's text is on the ledger)", () => {
    for (const n of byKind('small')) {
      const u = ledgerUnits(n.mods);
      expect(u, n.id).not.toBeNull();
      expect(u!, n.id).toBeGreaterThanOrEqual(0.7);
      expect(u!, n.id).toBeLessThanOrEqual(1.3);
      expect(n.audit.gross).toBeCloseTo(u!, 2);
    }
  });

  it('a named node made only of stat lines is audited within a factor 1.5 of its ledger value', () => {
    for (const n of PASSIVE_NODES) {
      if (n.kind === 'small' || n.kind === 'start' || n.rules.length || n.mods.some((m) => m.value < 0) || !n.mods.length) continue;
      const u = ledgerUnits(n.mods)!;
      expect(u / n.audit.gross, n.name).toBeGreaterThanOrEqual(1 / 1.5);
      expect(u / n.audit.gross, n.name).toBeLessThanOrEqual(1.5);
    }
    for (const m of byKind('mastery')) for (const c of m.choices!) {
      if (c.rules.length) continue;
      const u = ledgerUnits(c.mods)!;
      expect(u / c.audit.gross, c.text).toBeGreaterThanOrEqual(1 / 1.5);
      expect(u / c.audit.gross, c.text).toBeLessThanOrEqual(1.5);
    }
  });

  it('every stat a passive uses has an exchange rate', () => {
    for (const n of PASSIVE_NODES) for (const m of [...n.mods, ...(n.choices ?? []).flatMap((c) => c.mods)]) {
      expect(LEDGER_RATES[m.stat]?.[m.mode], `${n.id} ${m.stat} ${m.mode}`).toBeDefined();
    }
  });

  it('ledger totals: a full 70-point build is worth about 200u (34 smalls, 24 notables, 3 masteries, 2 keystones)', () => {
    const avg = (kind: string) => byKind(kind).reduce((s, n) => s + n.audit.gross - n.audit.price, 0) / byKind(kind).length;
    const notable = PASSIVE_NODES.filter((n) => n.kind === 'notable' || n.kind === 'gate' || n.kind === 'bridge');
    const notableAvg = notable.reduce((s, n) => s + n.audit.gross - n.audit.price, 0) / notable.length;
    expect(avg('small')).toBeGreaterThan(0.85);
    expect(avg('small')).toBeLessThan(1.15);
    expect(notableAvg).toBeGreaterThan(4.5);
    expect(notableAvg).toBeLessThan(6);
    expect(avg('keystone')).toBeGreaterThanOrEqual(12);
    expect(avg('keystone')).toBeLessThanOrEqual(20);
    const full = 34 * avg('small') + 24 * notableAvg + 3 * 5 + 2 * avg('keystone');
    expect(full).toBeGreaterThan(170);
    expect(full).toBeLessThan(230);
    // Every keystone has a price.
    for (const k of KEYSTONES) expect(k.audit.price, k.name).toBeGreaterThan(0);
  });
});

describe('caps (1.3)', () => {
  it('the whole tree resolved at once stays inside every cap', () => {
    const all = resolvePassives(PASSIVE_NODE_IDS, {});
    const sum = (f: (m: { stat: string; mode: string }) => boolean) => all.mods.filter((m) => f(m) && m.value > 0).reduce((s, m) => s + m.value, 0);
    const eps = 1e-6;
    expect(sum((m) => m.mode === 'increased' && ORRERY_DAMAGE_STATS.includes(m.stat as never))).toBeLessThanOrEqual(ORRERY_CAPS.increasedDamage + eps);
    const more = all.mods.filter((m) => m.mode === 'more' && m.value > 0 && ORRERY_DAMAGE_STATS.includes(m.stat)).reduce((p, m) => p * (1 + m.value / 100), 1);
    expect(more).toBeLessThanOrEqual(ORRERY_CAPS.moreDamage + eps);
    expect(sum((m) => m.stat === 'castSpeed')).toBeLessThanOrEqual(ORRERY_CAPS.castSpeed + ORRERY_CAPS.castSpeedPerfectTempo + eps);
    expect(sum((m) => m.stat === 'critChance')).toBeLessThanOrEqual(ORRERY_CAPS.critChance + eps);
    expect(sum((m) => m.stat === 'critMultiplier')).toBeLessThanOrEqual(ORRERY_CAPS.critMultiplier + eps);
    for (const pen of ['firePen', 'coldPen', 'lightningPen', 'voidPen', 'physicalPen']) expect(sum((m) => m.stat === pen)).toBeLessThanOrEqual(ORRERY_CAPS.penetration + eps);
    expect(sum((m) => m.stat === 'area' && m.mode === 'increased')).toBeLessThanOrEqual(ORRERY_CAPS.area + eps);
    expect(sum((m) => m.stat === 'extraProjectiles')).toBeLessThanOrEqual(ORRERY_CAPS.extraProjectiles + eps);
    expect(sum((m) => m.stat === 'moveSpeed')).toBeLessThanOrEqual(ORRERY_CAPS.moveSpeed + eps);
    expect(sum((m) => m.stat === 'maxLife' && m.mode === 'increased')).toBeLessThanOrEqual(ORRERY_CAPS.maxLife + eps);
    expect(sum((m) => m.stat === 'armor' && m.mode === 'increased')).toBeLessThanOrEqual(ORRERY_CAPS.armor + eps);
    expect(sum((m) => m.stat === 'evasion' && m.mode === 'increased')).toBeLessThanOrEqual(ORRERY_CAPS.evasion + eps);
    const allRes = sum((m) => m.stat === 'allRes');
    for (const res of ['fireRes', 'coldRes', 'lightningRes', 'voidRes']) expect(allRes + sum((m) => m.stat === res)).toBeLessThanOrEqual(ORRERY_CAPS.resistance + eps);
    expect(sum((m) => m.stat === 'maxResistance')).toBeLessThanOrEqual(ORRERY_CAPS.maxResistance + eps);
    expect(sum((m) => m.stat === 'maxFocus')).toBeLessThanOrEqual(ORRERY_CAPS.maxFocus + eps);
    expect(sum((m) => m.stat === 'focusRegen' && m.mode === 'increased')).toBeLessThanOrEqual(ORRERY_CAPS.focusRegen + eps);
    expect(sum((m) => m.stat === 'flaskEffect')).toBeLessThanOrEqual(ORRERY_CAPS.flaskEffect + eps);
    expect(all.rules.filter((r) => r.id === 'augmentSlot').reduce((s, r) => s + r.value, 0)).toBeLessThanOrEqual(ORRERY_CAPS.augmentSlots);
    // The caps are real: the whole tree is far over several of them, and says so.
    expect(all.caps.filter((c) => c.capped).map((c) => c.id)).toEqual(expect.arrayContaining(['increasedDamage', 'moreDamage', 'area', 'armor']));
  });
});

describe('points (4)', () => {
  it('earns one per level 2 to 50, one per even level 52 to 80, one per Boss Mark: 70 in all', () => {
    expect(passivePointsEarned(1, 0)).toBe(0);
    expect(passivePointsEarned(17, 0)).toBe(16);
    expect(passivePointsEarned(20, 0)).toBe(19);
    expect(passivePointsEarned(40, 0)).toBe(39);
    expect(passivePointsEarned(50, 0)).toBe(49);
    expect(passivePointsEarned(51, 0)).toBe(49);
    expect(passivePointsEarned(52, 0)).toBe(50);
    expect(passivePointsEarned(53, 0)).toBe(50);
    expect(passivePointsEarned(80, 0)).toBe(64);
    expect(passivePointsEarned(LEVEL_CAP, 6)).toBe(PASSIVE_POINTS.total);
    expect(passivePointsEarned(99, 9)).toBe(70);
    expect(nextPassivePointLevel(17)).toBe(18);
    expect(nextPassivePointLevel(50)).toBe(52);
    expect(nextPassivePointLevel(52)).toBe(54);
    expect(nextPassivePointLevel(53)).toBe(54);
    expect(nextPassivePointLevel(80)).toBeNull();
    expect(BOSS_MARK_KINDS).toHaveLength(PASSIVE_POINTS.bossMarks);
    expect([...BOSS_MARK_KINDS].sort()).toEqual(['ashboundHerald', 'boneChorister', 'chainmaster', 'cinderMatriarch', 'hollowWarden', 'varkus']);
  });

  it('70 of 252 nodes: choice is forced (28% of the tree)', () => {
    const total = PASSIVE_NODES.reduce((s, n) => s + n.cost, 0);
    expect(PASSIVE_POINTS.total / total).toBeLessThan(0.3);
  });
});

describe('layout (2.1)', () => {
  it('fits the 768 × 768 world with Spark in the centre, no two plates closer than 20 px', () => {
    const spark = findPassiveNode(PASSIVE_START_ID)!;
    expect(spark.pos).toEqual({ x: ORRERY_SIZE / 2, y: ORRERY_SIZE / 2 });
    for (const n of PASSIVE_NODES) {
      expect(n.pos.x).toBeGreaterThanOrEqual(24);
      expect(n.pos.x).toBeLessThanOrEqual(ORRERY_SIZE - 24);
      expect(n.pos.y).toBeGreaterThanOrEqual(24);
      expect(n.pos.y).toBeLessThanOrEqual(ORRERY_SIZE - 24);
    }
    let min = Infinity;
    for (let i = 0; i < PASSIVE_NODES.length; i++) for (let j = i + 1; j < PASSIVE_NODES.length; j++) {
      const a = PASSIVE_NODES[i].pos, b = PASSIVE_NODES[j].pos;
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
    }
    expect(min).toBeGreaterThanOrEqual(20);
  });

  it('Fire is at the top and the sectors run clockwise', () => {
    const angle = (s: string) => {
      const g = findPassiveNode(`pas.${s}.gate`)!.pos;
      return (Math.atan2(g.y - ORRERY_SIZE / 2, g.x - ORRERY_SIZE / 2) * 180) / Math.PI;
    };
    expect(angle('fire')).toBeCloseTo(-90, 5);
    const order = PASSIVE_SECTORS.map((s) => (angle(s) + 450) % 360);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });
});
