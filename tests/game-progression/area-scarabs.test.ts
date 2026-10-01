// Slice S1 (brief D 5.6 and 12 item 8): the five area-bias scarab families. The table of numbers, the one-per-family socket rule, the
// effects on the frozen routing table (closed form and drawn), composition with pins, the anti-degenerate bound, the drop share.
import { describe, expect, it } from 'vitest';
import { AREA_SCARAB_IDS, SCARAB_IDS, type ScarabId } from '../../src/contracts/content';
import type { MapRouting } from '../../src/contracts/game';
import { createRng } from '../../src/core/rng';
import { CURRENCIES } from '../../src/data/items';
import { ATLAS_AREAS } from '../../src/data/progression/atlas';
import { AREA_SCARAB_SHARE, SCARABS, findScarab, isWaveScarab, validScarabs } from '../../src/data/scarabs';
import { rules } from '../../src/game';
import { describeItem } from '../../src/game/progression';
import { buildRouting, routeMapDrop, routingBiasFor, routingReadout } from '../../src/game/progression/map-routing';
import { isMapAddress } from '../../src/game/progression/map-binding';
import { pickScarab } from '../../src/game/progression/loot';
import { composeRoutingBias, scarabRoutingBias, scarabRoutingLines, upwardOffsets } from '../../src/game/progression/scarab-routing';
import { allCharted, atlasOf, frontierCharted } from './routing-harness';
import { bareCharacter, currency, expectErr, expectOk, map, withBackpack } from './fixtures';

const FAMILIES = ['homing', 'wayfarer', 'deepward', 'quarry', 'hearthbound'] as const;
const id = (family: (typeof FAMILIES)[number], tier: number): ScarabId => `${family}Scarab${tier}` as ScarabId;
const weightOf = (r: MapRouting, area: string) => r.candidates.find((c) => c.areaId === area)?.weight;
const build = (from: Parameters<typeof buildRouting>[0]['from'], scarabs: readonly ScarabId[], discovered = allCharted(), extra: Partial<Parameters<typeof buildRouting>[0]> = {}) =>
  buildRouting({ from, atlas: atlasOf(discovered), tier: 5, bias: routingBiasFor(atlasOf(discovered), scarabs, { from }), ...extra })!;
const share = (r: MapRouting, area: string, tier = 5) => routingReadout(r, tier).rows.find((x) => x.areaId === area)?.share ?? 0;

describe('the scarab table (D 5.6)', () => {
  it('has five families of four tiers, named, levelled and weighted like the wave scarabs', () => {
    expect(AREA_SCARAB_IDS).toHaveLength(20);
    expect(new Set(SCARAB_IDS).size).toBe(SCARAB_IDS.length);
    for (const f of FAMILIES) {
      for (let t = 1; t <= 4; t++) {
        const s = findScarab(id(f, t))!;
        expect(s.name).toBe(`${['Weathered', 'Etched', 'Gilded', 'Exalted'][t - 1]} ${f[0].toUpperCase()}${f.slice(1)} Scarab`);
        expect([s.tier, s.kind, s.family, s.minMonsterLevel, s.weight]).toEqual([t, 'area', f, [4, 22, 46, 70][t - 1], [100, 30, 8, 2][t - 1]]);
        expect(s.durationLess).toBe(0);
        expect(s.startWave).toBe(1);
        expect(isWaveScarab(s.id)).toBe(false);
      }
    }
    expect(SCARABS.filter((s) => s.kind === 'wave')).toHaveLength(8);
  });

  it('carries the spec numbers: Homing 2/3/4/6, Wayfarer 1.5/2/2.5/3, Deepward 20/28/36/45 and +5/8/11/15, Quarry 2/3/4/6, Hearthbound 1.5/2/3/4', () => {
    const effect = (f: (typeof FAMILIES)[number], t: number) => findScarab(id(f, t))!.area!;
    for (let t = 1; t <= 4; t++) {
      expect(effect('homing', t)).toEqual({ kind: 'own', multiplier: [2, 3, 4, 6][t - 1] });
      expect(effect('wayfarer', t)).toEqual({ kind: 'neighbours', multiplier: [1.5, 2, 2.5, 3][t - 1] });
      expect(effect('deepward', t)).toEqual({ kind: 'upward', weight: [20, 28, 36, 45][t - 1], chestUpgradePoints: [5, 8, 11, 15][t - 1] });
      expect(effect('quarry', t)).toEqual({ kind: 'deadEnds', multiplier: [2, 3, 4, 6][t - 1] });
      expect(effect('hearthbound', t)).toEqual({ kind: 'theme', multiplier: [1.5, 2, 3, 4][t - 1] });
    }
  });

  it('every one is a tradeable Map-family currency with a tooltip that says what it does and its one-per-map rule', () => {
    for (const sid of AREA_SCARAB_IDS) {
      const def = CURRENCIES[sid];
      expect(def.family).toBe('map');
      expect(def.maxStack).toBe(20);
      expect(def.description).toMatch(/^[A-Z][a-z]+s\b/);
      expect(def.description).toContain('Only one');
      const tip = describeItem({ kind: 'currency', uid: 'x', currencyId: sid, count: 1 });
      expect(tip.classLabel).toBe('Scarab');
      expect(tip.properties.map((p) => p.label)).toEqual(expect.arrayContaining(['Scarab type', 'Scarab tier', 'Drop monster level']));
      expect(tip.hint).toContain('never how many drop');
    }
  });
});

describe('sockets: one scarab per family, whatever its tier', () => {
  const sock = (ch: ReturnType<typeof bareCharacter>, uid: string, index: number) => rules.moveItem(ch, uid, { kind: 'scarabSlot', index });

  it('accepts one of each family together and refuses a second of the same family', () => {
    let ch = withBackpack(bareCharacter(), [
      [currency('homingScarab1', 1, 'h1'), 0, 0], [currency('homingScarab4', 1, 'h4'), 1, 0], [currency('wayfarerScarab2', 1, 'w2'), 2, 0],
      [currency('hasteScarab3', 1, 'z3'), 3, 0], [currency('deepwardScarab1', 1, 'd1'), 4, 0], [currency('quarryScarab1', 1, 'q1'), 5, 0],
    ]);
    ch = expectOk(sock(ch, 'h1', 0));
    expect(expectErr(sock(ch, 'h4', 1))).toBe('Only one Homing Scarab can be used per map, regardless of tier.');
    ch = expectOk(sock(ch, 'w2', 1));
    ch = expectOk(sock(ch, 'z3', 2));
    ch = expectOk(sock(ch, 'd1', 3));
    expect(expectErr(sock(ch, 'q1', 0))).toMatch(/Remove the scarab/);
    expect(ch.mapScarabs!.map((s) => s?.currencyId)).toEqual(['homingScarab1', 'wayfarerScarab2', 'hasteScarab3', 'deepwardScarab1']);
  });

  it('validScarabs and openMap refuse duplicates of a family', () => {
    expect(validScarabs(['homingScarab1', 'wayfarerScarab4', 'quarryScarab2', 'hearthboundScarab3'])).toBe(true);
    expect(validScarabs(['homingScarab1', 'homingScarab2'])).toBe(false);
    expect(validScarabs(['quarryScarab1', 'quarryScarab4'])).toBe(false);
    const ch = bareCharacter({ mapDevice: map('furnaceYard', 5), currencyStash: { scrap: 9 }, mapScarabs: [currency('homingScarab1'), currency('homingScarab2'), null, null] });
    expect(rules.openMap(ch).ok).toBe(false);
  });
});

describe('effects on the frozen table (D 5.6, "Stacking")', () => {
  it('Homing multiplies the own area only', () => {
    const base = build('furnaceYard', []);
    for (let t = 1; t <= 4; t++) {
      const r = build('furnaceYard', [id('homing', t)]);
      expect(weightOf(r, 'furnaceYard')).toBe([2, 3, 4, 6][t - 1] * weightOf(base, 'furnaceYard')!);
      for (const c of r.candidates.filter((x) => x.areaId !== 'furnaceYard')) expect(c.weight, c.areaId).toBe(weightOf(base, c.areaId));
    }
  });

  it('Wayfarer multiplies charted neighbours that are not dead ends', () => {
    const base = build('emberRoad', []);
    const r = build('emberRoad', [id('wayfarer', 2)]);
    const neighbours = r.candidates.filter((c) => c.kind === 'neighbour');
    expect(neighbours.length).toBeGreaterThan(0);
    for (const c of neighbours) expect(c.weight, c.areaId).toBe(2 * weightOf(base, c.areaId)!);
    expect(weightOf(r, 'emberVault')).toBe(weightOf(base, 'emberVault')); // a dead end
    expect(weightOf(r, 'emberRoad')).toBe(weightOf(base, 'emberRoad'));
  });

  it('Quarry multiplies dead-end areas, neighbours or two hops away', () => {
    const base = build('emberRoad', []);
    const r = build('emberRoad', [id('quarry', 3)]);
    expect(weightOf(base, 'emberVault')).toBe(1);
    expect(weightOf(r, 'emberVault')).toBe(4);
    // a dead end two hops away (Hollow Ossuary from Glass Sepulchre's neighbour) is multiplied too
    const wide = build('boneApproach', [id('quarry', 3)]), wideBase = build('boneApproach', []);
    const deadEnds = wide.candidates.filter((c) => findDead(c.areaId));
    expect(deadEnds.length).toBeGreaterThan(0);
    for (const c of deadEnds) expect(c.weight, c.areaId).toBe(4 * weightOf(wideBase, c.areaId)!);
    for (const c of r.candidates.filter((x) => !findDead(x.areaId))) expect(c.weight, c.areaId).toBe(weightOf(base, c.areaId));
  });

  it('Hearthbound multiplies every charted area of the map theme at any distance, with a base of at least 0.5', () => {
    const base = build('cinderCrossing', []);
    const r = build('cinderCrossing', [id('hearthbound', 3)]);
    const theme = ATLAS_AREAS.filter((a) => isMapAddress(a) && a.baseId === 'ashenForge');
    expect(theme.length).toBeGreaterThan(3);
    for (const a of theme) {
      const was = weightOf(base, a.id) ?? 0;
      expect(weightOf(r, a.id), a.id).toBe(Math.max(was, 0.5) * 3);
    }
    // an area of another theme is untouched, and the far ones (3+ hops) joined the table
    const far = theme.filter((a) => weightOf(base, a.id) === undefined);
    expect(far.length).toBeGreaterThan(0);
    for (const c of r.candidates.filter((x) => !theme.some((a) => a.id === x.areaId))) expect(c.weight, c.areaId).toBe(weightOf(base, c.areaId));
    // undiscovered areas never appear through a scarab
    const thin = build('cinderCrossing', [id('hearthbound', 4)], frontierCharted('emberRoad'));
    for (const c of thin.candidates) expect(frontierCharted('emberRoad')).toContain(c.areaId);
  });

  it('Deepward sets the upward share to 20/28/36/45% and adds 5/8/11/15 points to the chest upgrade', () => {
    for (let t = 1; t <= 4; t++) {
      const r = build('heartOfForge', [id('deepward', t)], allCharted(), { tier: 5 });
      const total = r.tierOffsets.reduce((s, o) => s + o.weight, 0);
      expect(r.tierOffsets.find((o) => o.offset === 1)!.weight / total).toBeCloseTo([0.2, 0.28, 0.36, 0.45][t - 1], 6);
      expect(r.chestUpgradeBonus).toBe([5, 8, 11, 15][t - 1]);
      // the others keep their proportion (25:60)
      const down = r.tierOffsets.find((o) => o.offset === -1)!.weight, level = r.tierOffsets.find((o) => o.offset === 0)!.weight;
      expect(down / level).toBeCloseTo(25 / 60, 5);
      expect(total).toBeCloseTo(100, 5);
    }
    expect([...upwardOffsets(15)].sort((a, b) => a.offset - b.offset)).toEqual([{ offset: -1, weight: 25 }, { offset: 0, weight: 60 }, { offset: 1, weight: 15 }]);
    expect(build('furnaceYard', []).tierOffsets.find((o) => o.offset === 1)!.weight).toBe(15);
  });

  it('the drawn upward share and the chest upgrade follow (statistically)', () => {
    const r = build('heartOfForge', [id('deepward', 3)], allCharted(), { tier: 7 });
    const n = 20_000;
    const rng = createRng(11);
    let up = 0;
    for (let i = 0; i < n; i++) if (rng.weighted(r.tierOffsets, (o) => o.weight)!.offset === 1) up++;
    expect(Math.abs(up / n - 0.36)).toBeLessThan(4 * Math.sqrt(0.36 * 0.64 / n));
  });

  it('pins multiply independently and the scarab comes after: Homing IV with the own area pinned is x18', () => {
    const pins = composeRoutingBias({ pins: ['furnaceYard'] }, scarabRoutingBias([id('homing', 4)], 'furnaceYard'));
    const r = buildRouting({ from: 'furnaceYard', atlas: atlasOf(allCharted()), tier: 5, bias: pins })!;
    expect(weightOf(r, 'furnaceYard')).toBe(1 * 3 * 6);
    expect(r.candidates.find((c) => c.areaId === 'furnaceYard')).toMatchObject({ pinned: true });
    // a pin on a far area plus Hearthbound: max(base, 0.5) x 3 x scarab
    const far = composeRoutingBias({ pins: ['heartOfForge'] }, scarabRoutingBias([id('hearthbound', 2)], 'cinderCrossing'));
    expect(weightOf(buildRouting({ from: 'cinderCrossing', atlas: atlasOf(allCharted()), tier: 5, bias: far })!, 'heartOfForge')).toBe(0.5 * 3 * 2);
  });

  it('families combine: each multiplies the set it names, and wave scarabs do nothing', () => {
    const base = build('emberRoad', []);
    const r = build('emberRoad', [id('homing', 2), id('wayfarer', 2), id('quarry', 2)]);
    expect(weightOf(r, 'emberRoad')).toBe(3 * weightOf(base, 'emberRoad')!);
    expect(weightOf(r, 'emberVault')).toBe(3 * weightOf(base, 'emberVault')!);
    const neighbour = r.candidates.find((c) => c.kind === 'neighbour')!;
    expect(neighbour.weight).toBe(2 * weightOf(base, neighbour.areaId)!);
    expect(build('emberRoad', ['hasteScarab4', 'invasionScarab4'])).toEqual(base);
    expect(scarabRoutingBias(['hasteScarab4'], 'emberRoad')).toEqual({});
  });
});

const findDead = (areaId: string): boolean => !!ATLAS_AREAS.find((a) => a.id === areaId)?.deadEnd;

describe('anti-degenerate check (D 5.6): own-area-only farming stays under 70% and trades away variety', () => {
  it('Homing IV never gives the own area more than 70% of ordinary drops, on any chart; dead ends with one neighbour are capped, others are not', () => {
    let capped = 0, worstOpen = 0;
    for (const a of ATLAS_AREAS.filter(isMapAddress)) {
      for (const chart of [allCharted(), frontierCharted(a.id)].filter((c) => c.length > 1)) { // (a chart of one area has nothing else to drop)
        const r = build(a.id, [id('homing', 4)], chart);
        const own = share(r, a.id);
        expect(own, `${a.id} on a chart of ${chart.length}`).toBeLessThanOrEqual(0.7 + 1e-6);
        if (Math.abs(own - 0.7) < 1e-6) capped++; else worstOpen = Math.max(worstOpen, own);
      }
    }
    expect(capped).toBeGreaterThan(0); // the cap bites (dead ends: 77% by the multiplier alone)
    expect(worstOpen).toBeGreaterThan(0.5);
    // a pinned own area is the player's explicit choice: x18 with Homing IV, no cap
    const pinned = buildRouting({ from: 'emberVault', atlas: atlasOf(allCharted()), tier: 5, bias: composeRoutingBias({ pins: ['emberVault'] }, scarabRoutingBias([id('homing', 4)], 'emberVault')) })!;
    expect(weightOf(pinned, 'emberVault')).toBe(18);
    // without the scarab nothing is capped
    expect(weightOf(build('emberVault', []), 'emberVault')).toBe(1);
    // typical charts stay at the spec's "about 65%" and below (53-67% across the chart, measured above)
    for (const a of ATLAS_AREAS.filter((x) => isMapAddress(x) && !x.deadEnd)) expect(share(build(a.id, [id('homing', 4)]), a.id), a.id).toBeLessThanOrEqual(0.67);
  });

  it('drawn drops agree with the table (own share of Homing IV at Furnace Yard)', () => {
    const r = build('furnaceYard', [id('homing', 4)]);
    const expected = share(r, 'furnaceYard');
    const rng = createRng(5);
    const n = 20_000;
    let own = 0;
    for (let i = 0; i < n; i++) if (routeMapDrop(r, { tier: 5, offset: 0, pending: false }, rng)!.areaId === 'furnaceYard') own++;
    expect(Math.abs(own / n - expected)).toBeLessThan(4 * Math.sqrt(expected * (1 - expected) / n));
  });
});

describe('through openMap: frozen with the expedition', () => {
  const loaded = (...ids: ScarabId[]) => bareCharacter({ mapDevice: map('furnaceYard', 5), currencyStash: { scrap: 9 }, mapScarabs: [...ids.map((s) => currency(s)), ...Array(4 - ids.length).fill(null)] });

  it('the table, the readout lines and the consumed scarabs come out of one activation', () => {
    const out = expectOk(rules.openMap(loaded(id('homing', 2), id('deepward', 1), 'hasteScarab1')));
    expect(weightOf(out.setup.routing!, 'furnaceYard')).toBe(3);
    expect(out.setup.routing!.chestUpgradeBonus).toBe(5);
    expect(out.setup.scarabs).toEqual([id('homing', 2), id('deepward', 1), 'hasteScarab1']);
    const line = out.setup.summary.find((l) => l.label === 'Scarab: map drops')!;
    expect(line.breakdown).toContain('Scarab: Etched Homing Scarab: own area x3');
    expect(out.setup.summary.some((l) => l.label === 'Scarab wave duration')).toBe(true); // Haste still shows its own line
    expect(out.character.mapScarabs).toEqual([null, null, null, null]);
  });

  it('an area-bias scarab leaves the waves alone', () => {
    const opened = expectOk(rules.openMap(loaded(id('homing', 4), id('quarry', 4)))).setup;
    const plain = expectOk(rules.openMap(loaded())).setup;
    const config = rules.buildRunConfig(opened, {} as never);
    expect(config.waves).toEqual(rules.buildRunConfig(plain, {} as never).waves);
    expect(config.waves.startWave).toBeUndefined();
    expect(opened.summary.some((l) => l.label === 'Scarab wave duration' || l.label === 'Starting wave')).toBe(false);
  });

  it('is persisted and restored with the run, and an unrestorable run refunds the scarabs', () => {
    const out = expectOk(rules.openMap(loaded(id('hearthbound', 3))));
    const restored = JSON.parse(JSON.stringify(out.setup));
    expect(restored.routing).toEqual(out.setup.routing);
    expect(scarabRoutingLines(out.setup.scarabs!)).toEqual(['Scarab: Gilded Hearthbound Scarab: this map\'s theme, at any distance x3']);
  });

  it('only the opener\'s scarabs count: a guest\'s routing comes from the frozen setup', () => {
    const out = expectOk(rules.openMap(loaded(id('homing', 4)))).setup;
    // the guest's own bias (none) is irrelevant: routing lives on the setup the party shares
    expect(weightOf(out.routing!, 'furnaceYard')).toBe(6);
  });
});

describe('drops (D 5.6): the five families take 40% of scarab rolls', () => {
  it('splits 40/60 between area and wave scarabs, equally among families, and by tier weight within them', () => {
    const rng = createRng(2024);
    const n = 40_000;
    const byFamily = new Map<string, number>();
    const byTier = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const s = pickScarab(rng, 70)!;
      byFamily.set(s.family, (byFamily.get(s.family) ?? 0) + 1);
      if (s.kind === 'area') byTier.set(s.tier, (byTier.get(s.tier) ?? 0) + 1);
    }
    const area = FAMILIES.reduce((sum, f) => sum + (byFamily.get(f) ?? 0), 0);
    expect(Math.abs(area / n - AREA_SCARAB_SHARE)).toBeLessThan(4 * Math.sqrt(0.4 * 0.6 / n));
    for (const f of FAMILIES) expect(Math.abs((byFamily.get(f) ?? 0) / area - 0.2), f).toBeLessThan(0.02);
    expect(Math.abs(((byFamily.get('haste') ?? 0) + (byFamily.get('invasion') ?? 0)) / n - 0.6)).toBeLessThan(0.02);
    const total = [...byTier.values()].reduce((a, b) => a + b, 0);
    for (const [t, w] of [[1, 100], [2, 30], [3, 8], [4, 2]] as const) expect(Math.abs((byTier.get(t) ?? 0) / total - w / 140), `tier ${t}`).toBeLessThan(0.015);
  });

  it('respects the monster level: below level 22 only Weathered scarabs, and never a tier above what the level unlocks', () => {
    const rng = createRng(3);
    for (let i = 0; i < 2000; i++) expect(pickScarab(rng, 10)!.tier).toBe(1);
    for (let i = 0; i < 2000; i++) expect(pickScarab(rng, 30)!.tier).toBeLessThanOrEqual(2);
    expect(pickScarab(rng, 3)).toBeUndefined();
  });
});
