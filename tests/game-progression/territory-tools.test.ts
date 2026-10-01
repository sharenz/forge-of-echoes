// Targeting tools of the territory brief (D 5, slice P1): pins, Re-chart, Recycle and Rook's maps.
import { describe, expect, it } from 'vitest';
import type { AtlasAreaId, AtlasProgress } from '../../src/contracts/atlas';
import type { CharacterSave, MapItem } from '../../src/contracts/items';
import { LOCKED_ITEM_ERROR, rules, withItemLocks } from '../../src/game';
import { RECYCLE } from '../../src/data/items/bench';
import { ATLAS_AREAS, atlasTierCeiling, findAtlasArea } from '../../src/data/progression/atlas';
import { ROUTING_PIN } from '../../src/data/progression/routing';
import { normalizeAtlas, newAtlas, pinSlotCount, setPin } from '../../src/game/progression/atlas';
import { buildRouting, routingBiasFor, routingReadout } from '../../src/game/progression/map-routing';
import { chartNeighbours, rechartCost, rechartTargets, recycleCost, recycleQuality } from '../../src/game/progression/map-services';
import { bareCharacter, currency, expectErr, expectOk, map, withBackpack } from './fixtures';

const atlasOf = (discovered: AtlasAreaId[], completed: AtlasAreaId[] = [], extra: Partial<AtlasProgress> = {}): AtlasProgress =>
  ({ ...newAtlas(), discovered, completed, ...extra });
const scrapFor = (ch: CharacterSave, n: number, at: [number, number] = [11, 4]): CharacterSave => withBackpack(ch, [[currency('scrap', n, `scrap${n}`), at[0], at[1]]]);
const scrapOf = (ch: CharacterSave): number => ch.backpack.entries.reduce((s, e) => s + (e.item.kind === 'currency' && e.item.currencyId === 'scrap' ? e.item.count : 0), 0);

describe('pins (D 5.1)', () => {
  const chart = atlasOf(['cinderCrossing', 'emberRoad', 'boneApproach', 'furnaceYard', 'sealedReliquary', 'pitOfEchoes']);
  const ch = bareCharacter({ atlas: chart });

  it('gives three slots by default and never more than five', () => {
    expect(pinSlotCount(undefined)).toBe(3);
    expect(pinSlotCount([])).toBe(3);
    expect(pinSlotCount(['chartKeeper'])).toBe(3);
  });

  it('pins and unpins a discovered area for free, idempotently', () => {
    const a = expectOk(setPin(ch, 'emberRoad', true));
    expect(a.atlas!.pins).toEqual(['emberRoad']);
    expect(setPin(a, 'emberRoad', true)).toEqual({ ok: true, value: a });
    const b = expectOk(setPin(a, 'emberRoad', false));
    expect(b.atlas!.pins).toBeUndefined();
    expect(setPin(b, 'emberRoad', false)).toEqual({ ok: true, value: b });
  });

  it('refuses a fogged area, a sealed area, the Pit and a fourth pin', () => {
    expect(expectErr(setPin(ch, 'shatteredForge', true))).toMatch(/reveal/);
    expect(expectErr(setPin(ch, 'sealedReliquary', true))).toMatch(/key or a Bounty/);
    expect(expectErr(setPin(ch, 'pitOfEchoes', true))).toMatch(/key or a Bounty/);
    let c = ch;
    for (const id of ['cinderCrossing', 'emberRoad', 'boneApproach'] as const) c = expectOk(setPin(c, id, true));
    expect(expectErr(setPin(c, 'furnaceYard', true))).toMatch(/All 3 pins are in use/);
    // an unpin always works, and frees the slot
    c = expectOk(setPin(c, 'emberRoad', false));
    expect(expectOk(setPin(c, 'furnaceYard', true)).atlas!.pins).toEqual(['cinderCrossing', 'boneApproach', 'furnaceYard']);
  });

  it('is validated when the account loads: unknown, fogged, sealed, duplicate and surplus pins are dropped', () => {
    const raw = { ...chart, pins: ['emberRoad', 'emberRoad', 'nonsense', 'shatteredForge', 'sealedReliquary', 'boneApproach', 'furnaceYard', 'cinderCrossing'] };
    expect(normalizeAtlas(raw).pins).toEqual(['emberRoad', 'boneApproach', 'furnaceYard']);
    expect(normalizeAtlas({ ...chart, pins: 'x' }).pins).toBeUndefined();
    expect(normalizeAtlas({ ...chart, pins: [] }).pins).toBeUndefined();
  });

  it('feeds the routing bias: the pins and x3 (x4 with Chart Keeper), nothing without pins', () => {
    expect(routingBiasFor(chart).pins).toBeUndefined();
    const pinned = { ...chart, pins: ['boneApproach' as const] };
    expect(routingBiasFor(pinned)).toMatchObject({ pins: ['boneApproach'], pinMultiplier: ROUTING_PIN.multiplier });
    expect(routingBiasFor({ ...pinned, nodes: ['chartKeeper'] }).pinMultiplier).toBe(ROUTING_PIN.chartKeeperMultiplier);
  });

  it('reaches the frozen table: a pinned neighbour takes at least 40% of ordinary drops, a pin never charts a fogged area', () => {
    const atlas = atlasOf(['cinderCrossing', 'emberRoad', 'boneApproach', 'furnaceYard', 'emberVault'], ['cinderCrossing', 'emberRoad'], { pins: ['furnaceYard'] });
    const routing = buildRouting({ from: 'emberRoad', atlas, tier: 2, bias: routingBiasFor(atlas) })!;
    const row = routingReadout(routing, 2).rows.find((r) => r.areaId === 'furnaceYard')!;
    expect(row.pinned).toBe(true);
    expect(row.share).toBeGreaterThanOrEqual(0.4);
    // a pin on a fogged area (a stale save) is ignored by the bias
    const stale = { ...atlas, pins: ['shatteredForge' as const] };
    expect(routingBiasFor(stale).pins).toBeUndefined();
    expect(buildRouting({ from: 'emberRoad', atlas: stale, tier: 2, bias: routingBiasFor(stale) })!.candidates.some((c) => c.areaId === 'shatteredForge')).toBe(false);
  });
});

describe('Re-chart (D 5.2)', () => {
  const atlas = atlasOf(['cinderCrossing', 'emberRoad', 'boneApproach', 'emberVault', 'furnaceYard', 'glassSepulchre']);
  const base = () => bareCharacter({ atlas });

  it('costs ceil(1 + tier / 2) Scrap, 1.5x after one hop and 2x after two', () => {
    expect([1, 5, 9, 15].map((tier) => rechartCost({ tier }))).toEqual([2, 4, 6, 9]);
    expect(rechartCost({ tier: 5, rechart: 1 })).toBe(6);
    expect(rechartCost({ tier: 5, rechart: 2 })).toBe(8);
  });

  it('targets discovered, bindable chart neighbours that accept the tier', () => {
    const m = map('emberRoad', 3);
    expect(m.areaId).toBe('emberRoad');
    // Cinder Crossing (ceiling 1) cannot take a Tier 3 map; Ember Vault (a dead end, ceiling 3) and Furnace Yard can
    expect(rechartTargets(atlas, m).map((a) => a.id)).toEqual(['emberVault', 'furnaceYard']);
    expect(rechartTargets(atlas, map('emberRoad', 1)).map((a) => a.id)).toEqual(['cinderCrossing', 'emberVault', 'furnaceYard']);
    // a neighbour you have not charted is not a target
    expect(rechartTargets(atlasOf(['cinderCrossing', 'emberRoad']), m)).toEqual([]);
    // Tier 5: every target accepts it
    for (const a of rechartTargets(atlas, map('furnaceYard', 5))) expect(atlasTierCeiling(a)).toBeGreaterThanOrEqual(5);
    expect(chartNeighbours('emberRoad').map((a) => a.id)).toContain('cinderCrossing');
    // an edge listed on one side counts from both sides
    expect(chartNeighbours('boneApproach').map((a) => a.id)).toContain('cinderCrossing');
  });

  it('moves the map to the neighbour, keeping tier, quality, mods and commissions, and bumps the counter', () => {
    const m = { ...map('emberRoad', 3, { quality: 7 }), bounty: true as const, charted: true as const, rechart: 0 };
    const ch = scrapFor(withBackpack(base(), [[m, 0, 0]]), 20);
    const services = rules.benchServices(ch, m.uid).filter((s) => s.id.startsWith('bench:rechart:'));
    expect(services.map((s) => s.id)).toEqual(['bench:rechart:emberVault', 'bench:rechart:furnaceYard']);
    const target = findAtlasArea('furnaceYard')!;
    const svc = services.find((s) => s.id === 'bench:rechart:furnaceYard')!;
    expect(svc.cost).toEqual([{ currencyId: 'scrap', count: 3 }]);
    const out = expectOk(rules.applyBenchRecipe(ch, m.uid, svc.id));
    const moved = rules.findItem(out.character, m.uid)!.item as MapItem;
    expect(moved).toMatchObject({ areaId: 'furnaceYard', baseId: target.baseId, tier: 3, quality: 7, bounty: true, charted: true, rechart: 1, rarity: m.rarity });
    expect(moved.mods).toEqual(m.mods);
    expect(scrapOf(out.character)).toBe(17);
    expect(out.message).toMatch(/Re-charted to Furnace Yard from Ember Road/);
    // the next hop costs 1.5x
    const again = rules.benchServices(out.character, m.uid).find((s) => s.id.startsWith('bench:rechart:') && s.available)!;
    expect(again.cost[0].count).toBe(5);
    expect(rules.describeItem(moved).headerLines).toContain('Re-charted ×1');
  });

  it('refuses corrupted maps, missing Scrap and anything that is not a legal neighbour, changing nothing', () => {
    const m = map('emberRoad', 3);
    const poor = withBackpack(base(), [[m, 0, 0]]);
    expect(expectErr(rules.applyBenchRecipe(poor, m.uid, 'bench:rechart:furnaceYard'))).toMatch(/Not enough currency/);
    const rich = scrapFor(poor, 10);
    for (const id of ['heartOfForge', 'emberRoad', 'cinderCrossing', 'boneApproach', 'nonsense', '']) {
      expect(expectErr(rules.applyBenchRecipe(rich, m.uid, `bench:rechart:${id}`))).toMatch(/does not fit/);
    }
    const corrupt = withBackpack(base(), [[{ ...map('emberRoad', 3), corrupted: true }, 0, 0]]);
    const cm = corrupt.backpack.entries[0].item as MapItem;
    const withScrap = scrapFor(corrupt, 10);
    expect(rules.benchServices(withScrap, cm.uid).filter((s) => s.id.startsWith('bench:rechart:')).every((s) => !s.available)).toBe(true);
    expect(expectErr(rules.applyBenchRecipe(withScrap, cm.uid, 'bench:rechart:furnaceYard'))).toMatch(/Corrupted/);
    // a map with no charted neighbour shows one disabled row that says why
    const stranded = scrapFor(withBackpack(bareCharacter({ atlas: atlasOf(['cinderCrossing', 'emberRoad']) }), [[m, 0, 0]]), 10);
    const none = rules.benchServices(stranded, m.uid).filter((s) => s.id.startsWith('bench:rechart:'));
    expect(none).toHaveLength(1);
    expect(none[0]).toMatchObject({ available: false });
    expect(none[0].reason).toMatch(/No charted neighbour/);
  });

  it('rescues a map bound to an undiscovered area by moving it to a discovered neighbour', () => {
    const m = map('furnaceYard', 2);
    expect(m.areaId).toBe('furnaceYard');
    const ch = scrapFor(withBackpack(bareCharacter({ atlas: atlasOf(['cinderCrossing', 'emberRoad']) }), [[m, 0, 0]]), 10);
    const out = expectOk(rules.applyBenchRecipe(ch, m.uid, 'bench:rechart:emberRoad'));
    expect((rules.findItem(out.character, m.uid)!.item as MapItem).areaId).toBe('emberRoad');
  });

  it('is refused for a map in an open trade offer', () => {
    const m = map('emberRoad', 3, { uid: 'offered-map' });
    const ch = scrapFor(withBackpack(base(), [[m, 0, 0]]), 10);
    const locked = withItemLocks(rules, () => new Set(['offered-map']));
    expect(expectErr(locked.applyBenchRecipe(ch, m.uid, 'bench:rechart:furnaceYard'))).toBe(LOCKED_ITEM_ERROR);
    expect(locked.benchServices(ch, m.uid).every((s) => !s.available)).toBe(true);
  });

  it('is paid out of Scrap that is not in the offer', () => {
    const m = map('emberRoad', 3);
    const ch = withBackpack(base(), [[m, 0, 0], [currency('scrap', 3, 'offered-scrap'), 1, 0]]);
    const locked = withItemLocks(rules, () => new Set(['offered-scrap']));
    expect(expectErr(locked.applyBenchRecipe(ch, m.uid, 'bench:rechart:furnaceYard'))).toMatch(/Not enough currency/);
  });
});

describe('Recycle (D 5.3)', () => {
  const atlas = atlasOf(['cinderCrossing', 'emberRoad', 'boneApproach', 'emberVault', 'furnaceYard', 'glassSepulchre']);
  const three = (over: Partial<MapItem>[] = [{}, {}, {}], tier = 3): MapItem[] =>
    over.map((o, i) => ({ ...map(i === 2 ? 'furnaceYard' : 'emberRoad', tier, { uid: `r${i}` }), ...o }));
  const room = (maps: MapItem[], scrap = 20): CharacterSave => scrapFor(withBackpack(bareCharacter({ atlas }), maps.map((m, i) => [m, i, 0] as [MapItem, number, number])), scrap);

  it('prices the tier in Scrap and sets the quality to the mean plus two, capped at 20', () => {
    expect([1, 5, 15].map((t) => recycleCost(t))).toEqual([1, 5, 15]);
    expect(recycleQuality([{ quality: 0 }, { quality: 0 }, { quality: 0 }])).toBe(2);
    expect(recycleQuality([{ quality: 10 }, { quality: 11 }, { quality: 12 }])).toBe(13);
    expect(recycleQuality([{ quality: 20 }, { quality: 20 }, { quality: 20 }])).toBe(20);
    expect(recycleQuality([{ quality: 5 }, { quality: 6 }, { quality: 6 }])).toBe(7); // floor(5.67) + 2
  });

  it('turns three maps into one Normal map of the chosen area, with no mods, atomically', () => {
    const maps = three([{ quality: 4, mods: [] }, { quality: 8 }, { quality: 12 }]);
    const ch = room(maps);
    const quote = rules.recycleQuote(ch, maps.map((m) => m.uid));
    expect(quote).toMatchObject({ error: null, scrap: 3, quality: 10, tier: 3 });
    // the areas of the three maps and their charted neighbours that accept Tier 3 (Cinder Crossing, ceiling 1, does not)
    expect([...quote.targets].sort()).toEqual(['emberRoad', 'emberVault', 'furnaceYard', 'glassSepulchre']);
    const out = expectOk(rules.recycleMaps(ch, maps.map((m) => m.uid), 'glassSepulchre'));
    expect(out.item).toMatchObject({ kind: 'map', areaId: 'glassSepulchre', tier: 3, rarity: 'normal', quality: 10, mods: [], corrupted: false, isNew: true });
    expect(out.item.rechart).toBeUndefined();
    expect(scrapOf(out.character)).toBe(17);
    for (const m of maps) expect(rules.findItem(out.character, m.uid)).toBeNull();
    expect(rules.findItem(out.character, out.item.uid)?.location.kind).toBe('backpack');
    expect(out.character.stats.itemsCrafted).toBe(ch.stats.itemsCrafted + 1);
  });

  it('refuses the wrong count, mixed tiers, paid-value flags, corrupted maps, bad targets and missing Scrap', () => {
    const maps = three();
    const ch = room(maps);
    const ids = maps.map((m) => m.uid);
    expect(rules.recycleQuote(ch, ids.slice(0, 2)).error).toMatch(/three maps/);
    expect(rules.recycleQuote(ch, [ids[0], ids[0], ids[1]]).error).toMatch(/different/);
    expect(rules.recycleQuote(room(three([{}, { tier: 4 }, {}])), ids).error).toMatch(/same tier/);
    for (const flag of [{ bounty: true }, { charted: true }, { corrupted: true }] as Partial<MapItem>[]) {
      expect(rules.recycleQuote(room(three([flag, {}, {}])), ids).error).toMatch(/cannot be recycled/);
    }
    expect(rules.recycleQuote(ch, ids, 'boneApproach').error).toMatch(/areas or their neighbours/);
    expect(expectErr(rules.recycleMaps(ch, ids, 'heartOfForge'))).toMatch(/areas or their neighbours/);
    expect(expectErr(rules.recycleMaps(room(maps, 1), ids, 'emberRoad'))).toMatch(/Not enough currency/);
    // nothing was taken by any refusal
    expect(rules.findItem(ch, ids[0])).not.toBeNull();
    expect(RECYCLE.inputs).toBe(3);
  });

  it('never takes the map in the device, and refuses locked maps', () => {
    const maps = three();
    const ch = { ...room(maps), mapDevice: map('emberRoad', 3, { uid: 'dev' }) };
    expect(rules.recycleQuote(ch, ['r0', 'r1', 'dev']).error).toMatch(/Map Device/);
    const locked = withItemLocks(rules, () => new Set(['r1']));
    expect(expectErr(locked.recycleMaps(ch, ['r0', 'r1', 'r2'], 'emberRoad'))).toBe(LOCKED_ITEM_ERROR);
  });

  it('cannot raise the tier or reach an area that does not accept it', () => {
    const maps = three([{}, {}, {}], 5);
    const ch = room(maps, 30);
    const targets = rules.recycleQuote(ch, maps.map((m) => m.uid)).targets;
    for (const id of targets) expect(atlasTierCeiling(findAtlasArea(id)!)).toBeGreaterThanOrEqual(5);
    expect(targets).not.toContain('cinderCrossing');
    expect(rules.recycleQuote(ch, maps.map((m) => m.uid), 'glassSepulchre').tier).toBe(5);
  });
});

describe("Rook's maps (D 5.4)", () => {
  const cleared = bareCharacter({ atlas: atlasOf(['cinderCrossing', 'emberRoad', 'emberVault', 'boneApproach', 'furnaceYard'], ['cinderCrossing', 'emberRoad', 'emberVault']) });

  it('sells maps of cleared areas only (plus the starting area), never a dead end, a sealed area or the Pit', () => {
    expect(rules.rookMapAreas(cleared)).toEqual(['cinderCrossing', 'emberRoad']); // Ember Vault is a dead end; Bone Approach is only charted
    expect(rules.rookMapAreas(bareCharacter({ atlas: newAtlas() }))).toEqual(['cinderCrossing']);
    const everything = bareCharacter({ atlas: atlasOf(ATLAS_AREAS.map((a) => a.id), ATLAS_AREAS.map((a) => a.id)) });
    for (const id of rules.rookMapAreas(everything)) {
      const a = findAtlasArea(id)!;
      expect(a.sealed || a.deadEnd || a.requiresBounty).toBeFalsy();
    }
    expect(expectErr(rules.buyOffer(cleared, 'map:boneApproach:1:plain'))).toMatch(/does not sell/);
    expect(expectErr(rules.buyOffer(cleared, 'map:emberVault:1:plain'))).toMatch(/does not sell/);
  });

  it('offers T1 and T2 in three quality grades, priced by tier and quality', () => {
    const rows = rules.rookMapOffers(cleared, 'emberRoad');
    expect(rows.map((o) => o.id)).toEqual([
      'map:emberRoad:1:plain', 'map:emberRoad:1:fine', 'map:emberRoad:1:pristine',
      'map:emberRoad:2:plain', 'map:emberRoad:2:fine', 'map:emberRoad:2:pristine',
    ]);
    expect(rows.map((o) => o.price.reduce((n, p) => n + p.count, 0))).toEqual([0, 2, 6, 4, 7, 12]);
    expect(rows.map((o) => (o.item as MapItem).quality)).toEqual([0, 6, 12, 0, 6, 12]);
    // the starting area only takes Tier 1 (its ceiling)
    expect(rules.rookMapOffers(cleared, 'cinderCrossing').map((o) => o.id)).toEqual(['map:cinderCrossing:1:plain', 'map:cinderCrossing:1:fine', 'map:cinderCrossing:1:pristine']);
    expect(rules.rookMapOffers(cleared, 'boneApproach')).toEqual([]);
  });

  it('sells the grade it says: quality, area, theme, Normal, and charges the Scrap', () => {
    const ch = scrapFor(cleared, 12);
    const out = expectOk(rules.buyOffer(ch, 'map:emberRoad:2:pristine'));
    expect(out.item).toMatchObject({ kind: 'map', areaId: 'emberRoad', tier: 2, quality: 12, rarity: 'normal', mods: [], isNew: true });
    expect(scrapOf(out.character)).toBe(0);
    expect(expectErr(rules.buyOffer(scrapFor(cleared, 11), 'map:emberRoad:2:pristine'))).toMatch(/You need 12 Forge Scrap/);
    expect(expectOk(rules.buyOffer(cleared, 'map:cinderCrossing:1:plain')).item).toMatchObject({ areaId: 'cinderCrossing', quality: 0 });
  });

  it('rejects malformed offer ids', () => {
    for (const id of ['map:', 'map:emberRoad', 'map:emberRoad:3:plain', 'map:emberRoad:2:gold', 'map:emberRoad:02:plain', 'map:emberRoad:1:plain:x', 'map:nowhere:1:plain']) {
      expect(expectErr(rules.buyOffer(scrapFor(cleared, 99), id))).toMatch(/does not sell/);
    }
  });
});
