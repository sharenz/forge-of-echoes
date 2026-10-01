// Slice R1 (brief D section 4 and 12): chart-driven map-drop routing. Closed-form weights, the draw distribution, fog and
// pending reveals, the chest advance target, persistence, the pins/scarab hook, the rng stream, the supply invariant (I1) and
// the ladder ("a player always has a path to a deeper area", risk 15.1).
import { describe, expect, it } from 'vitest';
import type { AtlasAreaId } from '../../src/contracts/atlas';
import type { MapItem } from '../../src/contracts/items';
import type { MapRouting } from '../../src/contracts/game';
import { createRng } from '../../src/core/rng';
import { ATLAS_AREAS, atlasTierCeiling, findAtlasArea } from '../../src/data/progression/atlas';
import { ROUTING_NO_ADVANCE_QUALITY, ROUTING_PIN, ROUTING_WEIGHTS } from '../../src/data/progression/routing';
import { rules } from '../../src/game';
import { discoverAfterBoss } from '../../src/game/progression/atlas';
import {
  advanceTarget, buildRouting, isMapAddress, normalizeRouting, pendingReveals, restoreRunSetup, routeMapDrop, routingBiasFor, routingReadout,
} from '../../src/game/progression';
import { ADDRESSES, allCharted, atlasOf, frontierCharted, ladder, routeRun, routeStats } from './routing-harness';
import { bareCharacter, expectOk, exploredAtlas, kill, map, openAt } from './fixtures';

const ids = (r: MapRouting) => r.candidates.map((c) => c.areaId);
const weightOf = (r: MapRouting, id: AtlasAreaId) => r.candidates.find((c) => c.areaId === id)?.weight;
const total = (r: MapRouting) => r.candidates.reduce((s, c) => s + c.weight, 0);
const ceil = (id: AtlasAreaId) => atlasTierCeiling(findAtlasArea(id)!);

/** Within `k` standard deviations of a binomial rate. */
function expectRate(count: number, n: number, p: number, label: string, k = 4) {
  const sigma = Math.sqrt((p * (1 - p)) / n);
  expect(Math.abs(count / n - p), `${label}: observed ${(count / n).toFixed(4)} vs ${p.toFixed(4)}`).toBeLessThan(k * sigma + 1e-9);
}

const build = (from: AtlasAreaId, discovered: readonly AtlasAreaId[], extra: Partial<Parameters<typeof buildRouting>[0]> = {}) =>
  buildRouting({ from, atlas: atlasOf(discovered), tier: 5, ...extra })!;

describe('the table (D 4.2): weights from data, worked examples', () => {
  it('example 1: T5 at Furnace Yard, everything charted, no pins', () => {
    const r = build('furnaceYard', allCharted());
    expect(weightOf(r, 'furnaceYard')).toBe(ROUTING_WEIGHTS.own);
    for (const n of ['emberRoad', 'shatteredForge', 'glassSepulchre'] as const) expect(weightOf(r, n)).toBe(ROUTING_WEIGHTS.neighbour);
    for (const w of ['cinderCrossing', 'emberVault', 'boneApproach', 'hollowOssuary', 'crownFoundry', 'winterThrone'] as const) expect(weightOf(r, w)).toBe(ROUTING_WEIGHTS.wander);
    expect(r.candidates).toHaveLength(10);
    expect(total(r)).toBeCloseTo(6.4, 9);
    const read = routingReadout(r, 5);
    expect(read.rows.find((x) => x.areaId === 'furnaceYard')!.share).toBeCloseTo(1 / 6.4, 9);
    expect(read.rows.find((x) => x.areaId === 'emberRoad')!.share).toBeCloseTo(1.5 / 6.4, 9);
    // The 15% upward roll (T6) filters to ceiling >= 6: Shattered Forge 1.5, Crown Foundry 0.15, Winter Throne 0.15 -> 83%.
    expect(read.rows.find((x) => x.areaId === 'shatteredForge')!.upwardShare).toBeCloseTo(1.5 / 1.8, 9);
    expect(read.advance).toBe('shatteredForge');
  });

  it('example 2: pin Shattered Forge (x3)', () => {
    const r = build('furnaceYard', allCharted(), { bias: { pins: ['shatteredForge'] } });
    expect(weightOf(r, 'shatteredForge')).toBe(4.5);
    expect(total(r)).toBeCloseTo(9.4, 9);
    expect(r.candidates.find((c) => c.areaId === 'shatteredForge')).toMatchObject({ pinned: true });
  });

  it('example 3: pin a 2-hop dead end plus a x3 own-area scarab', () => {
    const r = build('furnaceYard', allCharted(), {
      bias: { pins: ['hollowOssuary'], weightMultiplier: (a) => (a.id === 'furnaceYard' ? 3 : 1) },
    });
    expect(weightOf(r, 'hollowOssuary')).toBe(Math.max(ROUTING_WEIGHTS.wander, ROUTING_PIN.floor) * ROUTING_PIN.multiplier);
    expect(weightOf(r, 'furnaceYard')).toBe(3);
    expect(total(r)).toBeCloseTo(3.0 + 4.5 + 1.5 + 0.75, 9);
    // Chart Keeper: x4 pins; far pins work at any distance.
    const far = build('cinderCrossing', allCharted(), { bias: { pins: ['heartOfForge'], pinMultiplier: ROUTING_PIN.chartKeeperMultiplier } });
    expect(weightOf(far, 'heartOfForge')).toBe(0.5 * 4);
  });

  it('a dead-end neighbour weighs less than a route; sealed areas and the Pit never appear', () => {
    const r = build('emberRoad', allCharted());
    expect(weightOf(r, 'emberVault')).toBe(ROUTING_WEIGHTS.deadEndNeighbour);
    expect(weightOf(r, 'furnaceYard')).toBe(ROUTING_WEIGHTS.neighbour);
    for (const a of ATLAS_AREAS) if (!isMapAddress(a)) expect(ids(build('ironMarch', allCharted()))).not.toContain(a.id);
    expect(ids(build('ironMarch', allCharted()))).not.toContain('pitOfEchoes');
    // Pinning a sealed area changes nothing.
    expect(ids(build('ironMarch', allCharted(), { bias: { pins: ['gildedVault', 'pitOfEchoes'] } }))).not.toContain('gildedVault');
    expect(buildRouting({ from: 'gildedVault', atlas: atlasOf(allCharted()) })).toBeUndefined();
  });

  it('undiscovered areas are not candidates unless pending; the neutral hook changes nothing', () => {
    const r = build('cinderCrossing', ['cinderCrossing']);
    expect(r.candidates.filter((c) => !c.pending).map((c) => c.areaId)).toEqual(['cinderCrossing']);
    expect(r.candidates.filter((c) => c.pending).map((c) => c.areaId)).toEqual(['emberRoad', 'boneApproach']);
    expect(weightOf(r, 'emberRoad')).toBe(ROUTING_WEIGHTS.pending);
    expect(buildRouting({ from: 'furnaceYard', atlas: atlasOf(allCharted()), tier: 5, bias: routingBiasFor(atlasOf(allCharted()), []) }))
      .toEqual(build('furnaceYard', allCharted()));
  });
});

describe('the draw (D 4.1): distribution, ceilings, fog', () => {
  const N = 20_000;
  const draw = (r: MapRouting, tier: number, offset: number, pending: boolean, discovered?: Set<string>) => {
    const rng = createRng(offset + 11 + tier);
    const counts = new Map<string, number>();
    const tiers = new Map<number, number>();
    for (let i = 0; i < N; i++) {
      const d = routeMapDrop(r, { tier, offset, pending, ...(discovered ? { discovered } : {}) }, rng)!;
      counts.set(d.areaId, (counts.get(d.areaId) ?? 0) + 1);
      tiers.set(d.tier, (tiers.get(d.tier) ?? 0) + 1);
    }
    return { counts, tiers };
  };

  it('matches the closed-form weights within 4 sigma (level, downward and upward rolls; pins and bias included)', () => {
    const fixtures: [string, MapRouting, number][] = [
      ['plain', build('furnaceYard', allCharted()), 5],
      ['pin', build('furnaceYard', allCharted(), { bias: { pins: ['shatteredForge', 'hollowOssuary'] } }), 5],
      ['frontier', build('shatteredForge', frontierCharted('shatteredForge')), 7],
    ];
    for (const [name, r, tier] of fixtures) {
      for (const offset of [-1, 0, 1]) {
        const { counts, tiers } = draw(r, tier, offset, false);
        let pool = r.candidates.filter((c) => !c.pending);
        let t = tier + offset;
        if (offset > 0) { const up = pool.filter((c) => ceil(c.areaId) >= t); if (up.length) pool = up; else t = tier; }
        const sum = pool.reduce((s, c) => s + c.weight, 0);
        for (const c of pool) expectRate(counts.get(c.areaId) ?? 0, N, c.weight / sum, `${name} offset ${offset} ${c.areaId}`);
        // The tier is the roll clamped to the pick's ceiling.
        for (const [k] of tiers) expect(k).toBeLessThanOrEqual(t);
        for (const c of pool) expect(ceil(c.areaId)).toBeGreaterThanOrEqual(Math.min(t, ceil(c.areaId)));
      }
    }
  });

  it('a T7 run at Shattered Forge can drop a Furnace Yard map, arriving at its ceiling (T5)', () => {
    const r = build('shatteredForge', allCharted());
    const rng = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const d = routeMapDrop(r, { tier: 7, offset: 0, pending: false }, rng)!;
      if (d.areaId === 'furnaceYard') seen.add(d.tier);
      expect(d.tier).toBeLessThanOrEqual(ceil(d.areaId));
    }
    expect([...seen]).toEqual([5]);
  });

  it('an upward roll with nothing deeper in the table becomes a level roll; no candidate -> null and no draw', () => {
    const r = build('hollowOssuary', ['hollowOssuary', 'glassSepulchre', 'boneApproach', 'furnaceYard', 'emberRoad', 'cinderCrossing']);
    const rng = createRng(3);
    const d = routeMapDrop(r, { tier: 5, offset: 1, pending: false }, rng)!;
    expect(d.tier).toBe(5);
    expect(routeMapDrop({ ...r, candidates: [] }, { tier: 5, offset: 0, pending: false }, rng)).toBeNull();
    const a = createRng(9), b = createRng(9);
    routeMapDrop({ ...r, candidates: [] }, { tier: 5, offset: 0, pending: false }, a);
    expect(a.next()).toBe(b.next());
  });

  it('never an undiscovered, sealed or Pit area, for every area and tier (random charts, 3 offsets)', () => {
    const rng = createRng(77);
    for (const a of ADDRESSES) {
      const charted = new Set<AtlasAreaId>([a.id]);
      for (const b of ADDRESSES) if (rng.next() < 0.5) charted.add(b.id);
      const r = build(a.id, [...charted]);
      for (let tier = 1; tier <= ceil(a.id); tier += 2) for (const offset of [-1, 0, 1]) for (let i = 0; i < 40; i++) {
        const d = routeMapDrop(r, { tier, offset, pending: false, discovered: charted }, rng)!;
        expect(charted.has(d.areaId), `${a.id} T${tier}`).toBe(true);
        expect(isMapAddress(findAtlasArea(d.areaId)!)).toBe(true);
        expect(d.tier).toBeGreaterThanOrEqual(1);
        expect(d.tier).toBeLessThanOrEqual(ceil(d.areaId));
      }
    }
  });

  it('pending areas drop only when allowed (boss kill and chest), and only for charts that include the reveal', () => {
    const r = build('cinderCrossing', ['cinderCrossing']);
    const rng = createRng(2);
    let pendingSeen = 0;
    for (let i = 0; i < 3000; i++) {
      expect(routeMapDrop(r, { tier: 1, offset: 0, pending: false }, rng)!.areaId).toBe('cinderCrossing');
      const d = routeMapDrop(r, { tier: 1, offset: 0, pending: true, discovered: new Set(['cinderCrossing']) }, rng)!;
      if (d.areaId !== 'cinderCrossing') pendingSeen++;
    }
    expect(pendingSeen).toBeGreaterThan(1500); // 2 x 1.5 pending vs 1.0 own
  });

  it('the looter\'s own chart decides: a party member who has not charted a neighbour never receives it', () => {
    const r = build('furnaceYard', allCharted());
    const chart = new Set<string>(['furnaceYard', 'emberRoad']);
    const rng = createRng(4);
    for (let i = 0; i < 2000; i++) expect(chart.has(routeMapDrop(r, { tier: 3, offset: 0, pending: false, discovered: chart }, rng)!.areaId)).toBe(true);
  });
});

describe('pending reveals (D 4.3) and the advance target (D 4.4)', () => {
  it('the pending list equals discoverAfterBoss\'s reveal order for every area and many charts', () => {
    const rng = createRng(8);
    for (const a of ADDRESSES) for (let k = 0; k < 8; k++) {
      const charted = ADDRESSES.filter(() => rng.next() < 0.4).map((x) => x.id);
      const atlas = { ...atlasOf([...charted, a.id]), nodes: k % 3 === 0 ? ['masterSurveyor'] : [] };
      const expected = discoverAfterBoss(atlas, a.id, false, { revealRoll: 1 }).revealed.filter((id) => id !== a.id && isMapAddress(findAtlasArea(id)!));
      expect(pendingReveals(atlas, a.id)).toEqual(expected);
      const r = buildRouting({ from: a.id, atlas, tier: 3 })!;
      expect(r.candidates.filter((c) => c.pending).map((c) => c.areaId)).toEqual(expected);
    }
  });

  it('the advance target is the nearest area (own area at 0) accepting tier + 1; ties: pinned, then lower id', () => {
    const all = new Set<string>(allCharted());
    expect(advanceTarget('furnaceYard', all, 3)).toBe('furnaceYard'); // T3 -> T4: Furnace Yard itself (ceiling 5)
    expect(advanceTarget('furnaceYard', all, 5)).toBe('shatteredForge');
    expect(advanceTarget('emberVault', all, 3)).toBe('furnaceYard'); // dead end at its ceiling: two hops
    expect(advanceTarget('emberVault', new Set(['emberVault', 'emberRoad']), 3)).toBeUndefined();
    expect(advanceTarget('heartOfForge', all, 15)).toBeUndefined();
    // Tie: lastKiln and echoBastion are both at distance 1 from emberCitadel? (no: frozenPassage and lastKiln) pick by pin then id.
    expect(advanceTarget('emberCitadel', all, 9)).toBe('emberCitadel');
    expect(advanceTarget('crownFoundry', all, 9)).toBe('emberCitadel');
    expect(advanceTarget('frozenPassage', new Set(['frozenPassage', 'emberCitadel', 'echoBastion', 'winterThrone']), 11)).toBe('echoBastion');
    expect(advanceTarget('frozenPassage', new Set(['frozenPassage', 'emberCitadel', 'echoBastion', 'winterThrone']), 11, new Set(['frozenPassage']))).toBe('echoBastion');
  });

  it('through real loot: ordinary kills never name a fogged area, boss and chest drops can; the chest upgrade is the advance target', () => {
    const looter = bareCharacter({ atlas: atlasOf(['cinderCrossing']), currencyStash: { scrap: 50 } });
    const setup = expectOk(openAt(rules, { ...looter, mapDevice: map('cinderCrossing', 1) }, 'cinderCrossing')).setup;
    expect(setup.routing!.advance).toBe('boneApproach'); // T1 -> T2: both pending reveals are one hop away; the tie goes to the lower id
    const maps = (items: ReturnType<typeof rules.rollKillLoot>) => items.filter((i): i is MapItem => i.kind === 'map');
    const named = (ctx: ReturnType<typeof kill>, n: number) => {
      const out = new Set<string>();
      for (let s = 1; s <= n; s++) for (const m of maps(rules.rollKillLoot(setup, ctx, createRng(s), looter))) out.add(m.areaId);
      return out;
    };
    expect([...named(kill({ rarity: 'rare' }), 6000)]).toEqual(['cinderCrossing']);
    expect([...named(kill({ isLieutenant: true, rarity: 'rare' }), 3000)]).toEqual(['cinderCrossing']);
    const boss = named(kill({ isBoss: true, rarity: 'rare', wave: 6 }), 3000);
    expect(boss.has('emberRoad') && boss.has('boneApproach')).toBe(true);
    let upgraded = 0, chestPending = 0;
    for (let s = 1; s <= 1500; s++) {
      const first = maps(rules.rollChestLoot(setup, createRng(s), looter))[0];
      if (first.tier === 2) { upgraded++; expect(first.areaId).toBe('boneApproach'); }
      else if (first.areaId !== 'cinderCrossing') chestPending++;
    }
    expectRate(upgraded, 1500, 0.25, 'chest upgrade', 5);
    expect(chestPending).toBeGreaterThan(0);
  });

  it('with no deeper area charted, the chest map is not upgraded and gains quality instead', () => {
    const looter = bareCharacter({ atlas: atlasOf(['emberVault', 'emberRoad']), currencyStash: { scrap: 50 } });
    const open = (charted: boolean) => expectOk(openAt(rules, { ...looter, mapDevice: { ...map('emberVault', 3), charted } }, 'emberVault')).setup;
    const forced = open(true); // Compass: the upgrade roll always succeeds
    expect(forced.routing!.advance).toBeUndefined();
    let n = 0;
    for (let s = 1; s <= 200; s++) {
      const items = rules.rollChestLoot(forced, createRng(s), looter);
      const first = items.find((i): i is MapItem => i.kind === 'map')!;
      expect(first.tier).toBeLessThanOrEqual(3);
      expect(first.quality).toBeGreaterThanOrEqual(ROUTING_NO_ADVANCE_QUALITY);
      n++;
    }
    expect(n).toBe(200);
  });

  it('a Compass-charted map always upgrades to the advance target', () => {
    const looter = bareCharacter({ atlas: atlasOf(allCharted()), currencyStash: { scrap: 50 } });
    const setup = expectOk(openAt(rules, { ...looter, mapDevice: { ...map('furnaceYard', 5), charted: true } }, 'furnaceYard')).setup;
    for (let s = 1; s <= 100; s++) {
      const first = rules.rollChestLoot(setup, createRng(s), looter).find((i): i is MapItem => i.kind === 'map')!;
      expect(first).toMatchObject({ areaId: 'shatteredForge', tier: 6 });
    }
  });
});

describe('activation, persistence and the rng stream', () => {
  it('openMap freezes the table on the map\'s own area; a key passage keeps routing from the bound area', () => {
    const ch = bareCharacter({ atlas: exploredAtlas(), currencyStash: { scrap: 50, gildedKey: 1 }, mapDevice: map('furnaceYard', 4) });
    const home = expectOk(openAt(rules, ch, 'furnaceYard')).setup;
    expect(home.routing!.from).toBe('furnaceYard');
    const keyed = expectOk(openAt(rules, ch, 'gildedVault')).setup;
    expect(keyed.atlasAreaId).toBe('gildedVault');
    expect(keyed.routing!.from).toBe(keyed.sourceMap!.areaId);
    expect(ids(keyed.routing!)).not.toContain('gildedVault');
  });

  it('restoreRunSetup carries the frozen table (and drops junk); a bare map or a legacy run has none', () => {
    const ch = bareCharacter({ atlas: atlasOf(['cinderCrossing', 'emberRoad']), currencyStash: { scrap: 50 }, mapDevice: map('emberRoad', 3) });
    const setup = expectOk(openAt(rules, ch, 'emberRoad')).setup;
    expect(restoreRunSetup(JSON.parse(JSON.stringify(setup)), setup.seed)!.routing).toEqual(setup.routing);
    expect(restoreRunSetup(JSON.stringify(setup), setup.seed)).toEqual(setup);
    const { routing: _r, ...legacy } = setup;
    expect(restoreRunSetup(legacy, setup.seed)!.routing).toBeUndefined();
    const junk = { ...JSON.parse(JSON.stringify(setup)), routing: { from: 'emberRoad', candidates: [{ areaId: 'nowhere', weight: 1 }, { areaId: 'gildedVault', weight: 1 }, { areaId: 'emberRoad', weight: -2 }, { areaId: 'emberRoad', weight: 2, kind: 'own' }, { areaId: 'emberRoad', weight: 9 }], advance: 'nowhere', tierOffsets: 'x', chestUpgradeBonus: -5 } };
    const restored = restoreRunSetup(junk, setup.seed)!.routing!;
    expect(restored.candidates).toEqual([{ areaId: 'emberRoad', weight: 2, kind: 'own' }]);
    expect(restored.advance).toBeUndefined();
    expect(restored.chestUpgradeBonus).toBe(0);
    expect(restored.tierOffsets.map((o) => o.offset).sort()).toEqual([-1, 0, 1]);
    expect(normalizeRouting(null)).toBeUndefined();
    expect(normalizeRouting({ from: 'gildedVault', candidates: [{ areaId: 'emberRoad', weight: 1 }] })).toBeUndefined();
  });

  it('routing consumes exactly the rng draws the theme roll did: the stream after a chest or a boss is the same', () => {
    const looter = bareCharacter({ atlas: atlasOf(allCharted()), currencyStash: { scrap: 50 } });
    const routed = expectOk(openAt(rules, { ...looter, mapDevice: map('furnaceYard', 5) }, 'furnaceYard')).setup;
    const { routing: _r, ...old } = routed;
    let compared = 0;
    for (let s = 1; s <= 120; s++) {
      for (const run of [(setup: typeof routed, rng: ReturnType<typeof createRng>) => rules.rollChestLoot(setup, rng, looter),
        (setup: typeof routed, rng: ReturnType<typeof createRng>) => rules.rollKillLoot(setup, kill({ isBoss: true, rarity: 'rare', wave: 6 }), rng, looter)]) {
        const a = createRng(s), b = createRng(s);
        const ra = run(routed, a), rb = run(old, b);
        expect(ra.length).toBe(rb.length);
        expect(a.next()).toBe(b.next());
        compared++;
      }
    }
    expect(compared).toBe(240);
  });
});

describe('the readout (D 4.5 data block)', () => {
  it('shares are exact, sum to one, and group into own / neighbours / wander / pins', () => {
    const r = build('furnaceYard', allCharted(), { bias: { pins: ['heartOfForge'] } });
    const read = routingReadout(r, 5);
    expect(read.rows.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9);
    expect(read.rows.reduce((s, x) => s + x.upwardShare, 0)).toBeCloseTo(1, 9);
    expect(read.groups.own + read.groups.neighbours + read.groups.wander + read.groups.pinned).toBeCloseTo(1, 9);
    expect(read.groups.pinned).toBeGreaterThan(0.05);
    expect(read.fromName).toBe('Furnace Yard');
    expect(read.lines.length).toBeGreaterThanOrEqual(3);
    expect(read.rows[0].share).toBeGreaterThanOrEqual(read.rows.at(-1)!.share);
  });

  it('pending areas show only in the boss/chest column, with the weight the draw uses', () => {
    const r = build('cinderCrossing', ['cinderCrossing'], { tier: 1 });
    const read = routingReadout(r, 1);
    const ember = read.rows.find((x) => x.areaId === 'emberRoad')!;
    expect(ember).toMatchObject({ pending: true, share: 0 });
    expect(ember.bossShare).toBeCloseTo(1.5 / 4, 9);
    expect(read.lines.join(' ')).toContain('Ember Road');
    expect(read.advanceName).toBe('Bone Approach');
  });
});

describe('supply and the ladder (invariants I1 and D 12.2)', () => {
  it('maps per run are identical with and without routing (only the addressee moves)', () => {
    for (const [area, tier] of [['emberRoad', 3], ['furnaceYard', 5], ['crownFoundry', 9]] as const) {
      let routed = 0, legacy = 0;
      for (let seed = 1; seed <= 40; seed++) {
        routed += routeRun(area, tier, allCharted(), seed).maps.length;
        legacy += routeRun(area, tier, allCharted(), seed, undefined, [], true).maps.length;
      }
      expect(Math.abs(routed - legacy) / legacy, `${area} T${tier}: ${routed} vs ${legacy}`).toBeLessThan(0.01);
    }
  });

  it('stranded check: from every area at its own ceiling a deeper area is reachable by following drops (<= 4 steps), and a neighbour map always exists', () => {
    for (const a of ADDRESSES) {
      if (ceil(a.id) >= 15) continue;
      // Breadth-first over "run this area, clear its boss, take a drop for a candidate area" with the chart growing as the game does.
      type State = { at: AtlasAreaId; chart: AtlasAreaId[]; steps: number };
      let frontier: State[] = [{ at: a.id, chart: frontierCharted(a.id), steps: 0 }];
      let found = -1;
      const seen = new Set<string>();
      for (let step = 0; step <= 4 && found < 0; step++) {
        const next: State[] = [];
        for (const s of frontier) {
          const r = buildRouting({ from: s.at, atlas: atlasOf(s.chart), tier: ceil(a.id) })!;
          // A map accepting a deeper tier is among the table (discovered, or pending: the boss kill reveals it).
          if (r.candidates.some((c) => ceil(c.areaId) > ceil(a.id))) { found = step; break; }
          for (const c of r.candidates) {
            const key = `${c.areaId}|${s.chart.length}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const chart = discoverAfterBoss(atlasOf(s.chart), c.areaId, false, { revealRoll: 1 }).progress.discovered as AtlasAreaId[];
            next.push({ at: c.areaId, chart, steps: step + 1 });
          }
        }
        frontier = next;
      }
      expect(found, `${a.id}: no path to a deeper area`).toBeGreaterThanOrEqual(0);
      expect(found).toBeLessThanOrEqual(3);
      // Every area always has a neighbour or own map to run next.
      expect(buildRouting({ from: a.id, atlas: atlasOf(frontierCharted(a.id)), tier: 1 })!.candidates.length).toBeGreaterThan(1);
    }
  });

  it('ladder bot (real loot rules): everyone reaches Tier 15, within 12% of the pre-routing ladder, with bounded plateaus', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
    const mean = (legacy: boolean) => {
      const rs = seeds.map((s) => ladder(s, legacy));
      expect(rs.every((r) => r.reached), `legacy=${legacy}`).toBe(true);
      return { runs: rs.reduce((a, r) => a + r.runs, 0) / rs.length, plateau: Math.max(...rs.map((r) => r.longestPlateau)) };
    };
    const old = mean(true), now = mean(false);
    expect(now.runs / old.runs).toBeLessThan(1.12);
    expect(now.runs / old.runs).toBeGreaterThan(0.95);
    expect(now.plateau).toBeLessThanOrEqual(25);
  });

  it('measured shares stay near the spec bands at the frontier of the late areas (own 15-45%, neighbours 45-80%)', () => {
    const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
    for (const [area, tier] of [['furnaceYard', 5], ['crownFoundry', 9], ['emberCitadel', 11]] as const) {
      const s = routeStats(area, tier, allCharted(), seeds);
      expect(s.shares.own, area).toBeGreaterThan(0.05);
      expect(s.shares.own, area).toBeLessThan(0.45);
      expect(s.shares.neighbour, area).toBeGreaterThan(0.45);
      expect(s.mapsPerRun).toBeGreaterThan(4);
    }
  });
});
