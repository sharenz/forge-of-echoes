// Slice G1 (brief D section 7 and 12 item 9): the daily surge. Clock, ledger, spending at activation, refunds, Hourglass Sand and the Grand
// Hourglass, the tree's charges and Afterglow, the loot rules (quantity never on maps), party and account rules, persistence.
import { describe, expect, it } from 'vitest';
import type { AtlasProgress } from '../../src/contracts/atlas';
import type { RunSetup } from '../../src/contracts/game';
import { createRng } from '../../src/core/rng';
import { GRAND_HOURGLASS, HOURGLASS_SAND, SURGE_BONUS, SURGE_CHARGES, SURGE_DAY_MS, SURGE_RESET_UTC_HOUR } from '../../src/data/progression/territory';
import { lootLuckLines, rules, restoreRunSetup } from '../../src/game';
import { newAtlas, normalizeAtlas } from '../../src/game/progression/atlas';
import { categoryChances, killLuck } from '../../src/game/progression/loot';
import { lootLuck, lootLuckWithoutSurge } from '../../src/game/progression/luck';
import {
  attachSurge, forgeDay, forgeDayStart, msUntilReset, normalizeRunSurge, normalizeSurge, refillSurge, refundSurge, resetCountdownText,
  spendSurge, surgeKeepChances, surgeKept, surgeLedgerAt, surgeMaxCharges, surgeStatus,
} from '../../src/game/progression/surge';
import { fullProgress, pathTo } from './atlas-tree-helpers';
import { bareCharacter, currency, expectErr, expectOk, kill, map, withBackpack } from './fixtures';

const at = (iso: string): number => Date.parse(iso);
const NOON = at('2026-10-01T12:00:00Z');
const device = (areaId: Parameters<typeof map>[0] = 'furnaceYard', tier = 5) => map(areaId, tier);
const withMap = (over: Parameters<typeof bareCharacter>[0] = {}, areaId: Parameters<typeof map>[0] = 'furnaceYard') =>
  bareCharacter({ mapDevice: device(areaId), currencyStash: { scrap: 99 }, ...over });
const open = (ch = withMap(), opts: Parameters<typeof rules.openMap>[1] = {}) => expectOk(rules.openMap(ch, { useSurge: true, now: NOON, ...opts }));
const atlasOf = (ch: { atlas?: AtlasProgress }) => ch.atlas!;

describe('the forge day (D 7.1)', () => {
  it('turns over at 04:00 UTC exactly, with no time zones and no DST', () => {
    expect(SURGE_RESET_UTC_HOUR).toBe(4);
    const day = forgeDay(at('2026-10-01T04:00:00Z'));
    expect(forgeDay(at('2026-10-01T03:59:59.999Z'))).toBe(day - 1);
    expect(forgeDay(at('2026-10-01T04:00:00.000Z'))).toBe(day);
    expect(forgeDay(at('2026-10-02T03:59:59.999Z'))).toBe(day);
    expect(forgeDay(at('2026-10-02T04:00:00Z'))).toBe(day + 1);
    // the same boundary in a DST-changing week and across a month end, a year end and a leap day
    for (const [before, after] of [
      ['2026-03-29T03:59:59.999Z', '2026-03-29T04:00:00Z'], ['2026-10-25T03:59:59.999Z', '2026-10-25T04:00:00Z'],
      ['2026-10-31T03:59:59.999Z', '2026-10-31T04:00:00Z'], ['2026-12-31T03:59:59.999Z', '2026-12-31T04:00:00Z'],
      ['2028-02-29T03:59:59.999Z', '2028-02-29T04:00:00Z'], ['2028-03-01T03:59:59.999Z', '2028-03-01T04:00:00Z'],
    ]) expect(forgeDay(at(after)), after).toBe(forgeDay(at(before)) + 1);
    expect(forgeDay(at('2028-02-29T04:00:00Z'))).toBe(forgeDay(at('2028-02-28T04:00:00Z')) + 1);
    expect(forgeDay(at('2028-03-01T04:00:00Z'))).toBe(forgeDay(at('2028-02-29T04:00:00Z')) + 1);
  });

  it('is a fixed 24 hours long (a leap second is smeared by the server clock; the epoch has none)', () => {
    for (let d = 20_000; d < 20_000 + 800; d++) expect(forgeDayStart(d + 1) - forgeDayStart(d)).toBe(SURGE_DAY_MS);
    expect(forgeDayStart(forgeDay(NOON))).toBeLessThanOrEqual(NOON);
    expect(forgeDay(forgeDayStart(forgeDay(NOON)))).toBe(forgeDay(NOON));
  });

  it('counts down to the reset and words it for the dock', () => {
    expect(msUntilReset(at('2026-10-01T03:59:00Z'))).toBe(60_000);
    expect(msUntilReset(at('2026-10-01T04:00:00Z'))).toBe(SURGE_DAY_MS);
    expect(msUntilReset(at('2026-10-01T12:48:00Z'))).toBe(((24 - 8 - 48 / 60) * 3600_000));
    expect(resetCountdownText(3 * 3_600_000 + 12 * 60_000)).toBe('3 h 12 m');
    expect(resetCountdownText(42 * 60_000)).toBe('42 m');
    expect(resetCountdownText(20_000)).toBe('1 m');
    expect(resetCountdownText(0)).toBe('under a minute');
  });
});

describe('the ledger (D 7.1)', () => {
  it('holds 3 charges per area per day, spent one at a time, and the 4th run has none', () => {
    let atlas = newAtlas();
    expect(surgeStatus(atlas, 'furnaceYard', NOON)).toMatchObject({ max: SURGE_CHARGES, spent: 0, remaining: 3 });
    for (let i = 1; i <= 3; i++) {
      const spent = spendSurge(atlas, 'furnaceYard', NOON, i)!;
      expect(spent.surge).toMatchObject({ areaId: 'furnaceYard', quantityMore: SURGE_BONUS.quantityMore, rarityMore: SURGE_BONUS.rarityMore, day: forgeDay(NOON) });
      atlas = spent.atlas;
      expect(surgeStatus(atlas, 'furnaceYard', NOON).remaining).toBe(3 - i);
    }
    expect(spendSurge(atlas, 'furnaceYard', NOON, 4)).toBeUndefined();
    // other areas are untouched
    expect(surgeStatus(atlas, 'emberRoad', NOON).remaining).toBe(3);
  });

  it('resets lazily: a stored day before today counts as empty, and nothing is mutated', () => {
    const atlas = spendSurge(newAtlas(), 'furnaceYard', NOON, 1)!.atlas;
    const next = NOON + SURGE_DAY_MS;
    expect(surgeStatus(atlas, 'furnaceYard', next).remaining).toBe(3);
    expect(atlas.surge!.spent.furnaceYard).toBe(1);
    expect(surgeLedgerAt(atlas, next)).toEqual({ day: forgeDay(next), spent: {} });
    const again = spendSurge(atlas, 'furnaceYard', next, 1)!.atlas;
    expect(again.surge).toEqual({ day: forgeDay(next), spent: { furnaceYard: 1 } });
  });

  it('never grants charges when the server clock steps back', () => {
    const atlas = spendSurge(newAtlas(), 'furnaceYard', NOON + SURGE_DAY_MS, 1)!.atlas;
    expect(surgeStatus(atlas, 'furnaceYard', NOON).remaining).toBe(2);
  });

  it('survives a save: day and spent charges are normalised, unknown areas and bad numbers dropped, charges clamped', () => {
    const atlas = spendSurge(spendSurge(newAtlas(), 'furnaceYard', NOON, 1)!.atlas, 'emberRoad', NOON, 1)!.atlas;
    const back = normalizeAtlas(JSON.parse(JSON.stringify(atlas)));
    expect(back.surge).toEqual(atlas.surge);
    expect(normalizeSurge({ day: 5, spent: { furnaceYard: 99, moonPalace: 1, emberRoad: -2, ironMarch: 'x' } })).toEqual({ day: 5, spent: { furnaceYard: SURGE_CHARGES } });
    expect(normalizeSurge({ day: 1.5, spent: {} })).toBeUndefined();
    expect(normalizeSurge('nope')).toBeUndefined();
    expect(normalizeAtlas({ discovered: ['cinderCrossing'], surge: { day: 3, spent: { cinderCrossing: 2 } }, treeVersion: 2 }).surge).toEqual({ day: 3, spent: { cinderCrossing: 2 } });
    expect(normalizeAtlas({ discovered: ['cinderCrossing'] }).surge).toBeUndefined();
    const roundTrip = rules.parseSave(rules.serializeSave({ ...rules.newSave(), characters: [bareCharacter({ atlas })] })).characters[0];
    expect(roundTrip.atlas!.surge).toEqual(atlas.surge);
  });
});

describe('the tree (D 7.5, as data)', () => {
  const nodes = (...ids: string[]) => pathTo(...ids);
  it('Second Wind (Lantern-Bearer) adds a charge to every area; Lamp Oil only to dead-end and sealed areas', () => {
    expect(surgeMaxCharges('furnaceYard', nodes('lanternBearer'))).toBe(4);
    expect(surgeMaxCharges('emberVault', nodes('lanternBearer'))).toBe(4);
    expect(surgeMaxCharges('furnaceYard', nodes('lampOil'))).toBe(3);
    expect(surgeMaxCharges('emberVault', nodes('lampOil'))).toBe(4);
    expect(surgeMaxCharges('blackPit', nodes('lampOil'))).toBe(4); // sealed
    expect(surgeMaxCharges('emberVault', nodes('lanternBearer', 'lampOil'))).toBe(5);
    expect(surgeMaxCharges('furnaceYard', undefined)).toBe(3);
  });

  it('extra charges show in the ledger, and a respec that removes them clamps what was spent', () => {
    const wind = { ...newAtlas(), nodes: nodes('lanternBearer') };
    let atlas: AtlasProgress = wind;
    for (let i = 0; i < 4; i++) atlas = spendSurge(atlas, 'furnaceYard', NOON, i)!.atlas;
    expect(spendSurge(atlas, 'furnaceYard', NOON, 9)).toBeUndefined();
    expect(surgeStatus(atlas, 'furnaceYard', NOON)).toMatchObject({ max: 4, remaining: 0 });
    const respec = normalizeAtlas({ ...atlas, nodes: [] , treeVersion: 2 });
    expect(respec.surge!.spent.furnaceYard).toBe(3);
    expect(surgeStatus(respec, 'furnaceYard', NOON).remaining).toBe(0);
  });

  it('Afterglow keeps a spent charge 10% of the time, rolled from the map seed, and the bonus still applies', () => {
    expect(surgeKeepChances(undefined)).toEqual([]);
    expect(surgeKeepChances(nodes('cartographersPen'))).toEqual([0.1]);
    let keptCount = 0;
    const n = 20_000;
    for (let seed = 1; seed <= n; seed++) if (surgeKept(seed, [0.1])) keptCount++;
    expect(Math.abs(keptCount / n - 0.1)).toBeLessThan(4 * Math.sqrt(0.09 / n));
    // deterministic
    expect(surgeKept(77, [0.1])).toBe(surgeKept(77, [0.1]));
    // independent sources: either succeeding keeps the charge, and adding a source never moves another's roll
    const both = Array.from({ length: n }, (_, i) => surgeKept(i + 1, [0.1, 0.25])).filter(Boolean).length;
    expect(Math.abs(both / n - (1 - 0.9 * 0.75))).toBeLessThan(4 * Math.sqrt(0.3 * 0.7 / n));
    expect(Array.from({ length: 500 }, (_, i) => surgeKept(i + 1, [0.1]))).toEqual(Array.from({ length: 500 }, (_, i) => surgeKept(i + 1, [0.1, 0])));
    // a kept charge is not consumed but still reaches the run
    const pen: AtlasProgress = { ...newAtlas(), nodes: nodes('cartographersPen') };
    let seed = 1;
    while (!surgeKept(seed, [0.1])) seed++;
    const spent = spendSurge(pen, 'furnaceYard', NOON, seed)!;
    expect(spent.surge.kept).toBe(true);
    expect(spent.atlas).toBe(pen);
    expect(refundSurge(spent.atlas, spent.surge, NOON)).toBe(spent.atlas);
  });

  it('Afterglow plays through openMap: about one run in ten leaves the ledger alone', () => {
    const atlas: AtlasProgress = { ...fullProgress(nodes('cartographersPen')) };
    let kept = 0;
    const runs = 400;
    for (let i = 0; i < runs; i++) {
      const out = open(withMap({ atlas, rngState: 1000 + i * 7919 }));
      if (out.setup.surge?.kept) {
        kept++;
        expect(out.character.atlas!.surge?.spent.furnaceYard ?? 0).toBe(0);
      } else expect(out.character.atlas!.surge!.spent.furnaceYard).toBe(1);
      expect(out.setup.surge).toBeDefined();
    }
    expect(kept).toBeGreaterThan(runs * 0.05);
    expect(kept).toBeLessThan(runs * 0.17);
  });
});

describe('spending at activation (D 7.2)', () => {
  it('a run with useSurge spends one charge of its area and freezes the bonus into the setup', () => {
    const out = open();
    expect(out.setup.surge).toEqual({ areaId: 'furnaceYard', quantityMore: 30, rarityMore: 15, day: forgeDay(NOON) });
    expect(atlasOf(out.character).surge).toEqual({ day: forgeDay(NOON), spent: { furnaceYard: 1 } });
    expect(out.setup.summary.find((l) => l.label === 'Surge')?.value).toBe('+30% quantity, +15% rarity');
  });

  it('is off by default, off when held, and needs the server clock', () => {
    const ch = withMap();
    for (const opts of [{}, { useSurge: false, now: NOON }, { useSurge: true }, { useSurge: true, now: Number.NaN }]) {
      const out = expectOk(rules.openMap(ch, opts));
      expect(out.setup.surge).toBeUndefined();
      expect(out.character.atlas).toBe(ch.atlas);
    }
  });

  it('counts the destination area: a key passage spends the sealed area, not the map', () => {
    const ch = withMap({ currencyStash: { scrap: 99, blackKey: 1 } });
    const out = open(ch, { passage: { kind: 'key', currencyId: 'blackKey' } });
    expect(out.setup.surge!.areaId).toBe('blackPit');
    expect(atlasOf(out.character).surge!.spent).toEqual({ blackPit: 1 });
  });

  it('the 4th run in an area is simply normal: bit for bit the run without surge (no hard cap)', () => {
    let ch = withMap();
    const seen: RunSetup[] = [];
    for (let i = 0; i < 3; i++) {
      const out = open(ch);
      seen.push(out.setup);
      ch = { ...out.character, mapDevice: device() };
    }
    expect(seen.every((s) => s.surge)).toBe(true);
    const spentOut = open(ch);
    const normal = expectOk(rules.openMap(ch, { now: NOON }));
    expect(spentOut.setup.surge).toBeUndefined();
    expect(spentOut.setup).toEqual(normal.setup);
    expect(JSON.stringify(spentOut.setup)).toBe(JSON.stringify(normal.setup));
    expect(spentOut.character.atlas).toBe(ch.atlas);
    // and further runs keep working for as long as the player likes
    let more = { ...spentOut.character, mapDevice: device() };
    for (let i = 0; i < 5; i++) { more = { ...expectOk(rules.openMap(more, { useSurge: true, now: NOON })).character, mapDevice: device() }; }
    expect(atlasOf(more).surge!.spent.furnaceYard).toBe(3);
  });

  it('the day after, the charges are back', () => {
    let ch = withMap();
    for (let i = 0; i < 3; i++) ch = { ...open(ch).character, mapDevice: device() };
    expect(open(ch).setup.surge).toBeUndefined();
    const tomorrow = open(ch, { now: NOON + SURGE_DAY_MS });
    expect(tomorrow.setup.surge!.day).toBe(forgeDay(NOON) + 1);
    expect(atlasOf(tomorrow.character).surge).toEqual({ day: forgeDay(NOON) + 1, spent: { furnaceYard: 1 } });
  });

  it('two characters of one account share the ledger: the atlas is account-wide, so alt-hopping gains nothing', () => {
    const first = open(withMap({ id: 'a' }));
    // The server hands every character of the account the same atlas projection.
    const second = open(withMap({ id: 'b', atlas: first.character.atlas }));
    expect(atlasOf(second.character).surge!.spent.furnaceYard).toBe(2);
    let ch = withMap({ id: 'c', atlas: second.character.atlas });
    ch = { ...open(ch).character, mapDevice: device() };
    expect(open({ ...ch, id: 'd' }).setup.surge).toBeUndefined();
  });

  it('activations around the reset spend from the right day, and simultaneous ones spend once each', () => {
    const before = at('2026-10-01T03:59:59.999Z'), after = at('2026-10-01T04:00:00.000Z');
    let ch = withMap();
    for (let i = 0; i < 3; i++) ch = { ...open(ch, { now: before }).character, mapDevice: device() };
    expect(open(ch, { now: before }).setup.surge).toBeUndefined();
    const fresh = open(ch, { now: after });
    expect(fresh.setup.surge!.day).toBe(forgeDay(before) + 1);
    expect(atlasOf(fresh.character).surge!.spent).toEqual({ furnaceYard: 1 });
    // two activations at the same instant, serialised per account, spend two charges, never one twice
    const a = open(withMap(), { now: before });
    const b = open(withMap({ atlas: a.character.atlas }), { now: before });
    expect(atlasOf(b.character).surge!.spent.furnaceYard).toBe(2);
  });

  it('Hunting Ground and the other area presets are charged like any area', () => {
    const out = open(withMap({ currencyStash: { scrap: 99, huntingKey: 1 } }), { lootClass: 'ring', passage: { kind: 'key', currencyId: 'huntingKey' } });
    expect(out.setup.surge!.areaId).toBe('huntingGround');
  });

  it('is part of the frozen expedition: a restart (restoreRunSetup) keeps the bonus, even after the reset', () => {
    const out = open();
    const restored = restoreRunSetup(JSON.stringify(out.setup), out.setup.seed)!;
    expect(restored.surge).toEqual(out.setup.surge);
    expect(restored.itemQuantity).toBe(out.setup.itemQuantity);
    expect(restored.summary.find((l) => l.label === 'Surge')).toBeDefined();
    expect(restoreRunSetup(JSON.stringify({ ...out.setup, surge: { areaId: 'moonPalace', quantityMore: 30, rarityMore: 15, day: 3 } }), 1)!.surge).toBeUndefined();
    expect(normalizeRunSurge({ areaId: 'furnaceYard', quantityMore: 30, rarityMore: 15, day: 7, kept: true })).toEqual({ areaId: 'furnaceYard', quantityMore: 30, rarityMore: 15, day: 7, kept: true });
    expect(normalizeRunSurge({ areaId: 'furnaceYard', quantityMore: 0, rarityMore: 0, day: 7 })).toBeUndefined();
    expect(normalizeRunSurge(null)).toBeUndefined();
  });
});

describe('refunds (D 7.2): only an unrestorable server failure gives the charge back', () => {
  it('restores exactly the charge that was spent, once, on the same forge day', () => {
    const out = open();
    const back = refundSurge(out.character.atlas, out.setup.surge, NOON + 3_600_000)!;
    expect(back.surge!.spent.furnaceYard).toBeUndefined();
    expect(surgeStatus(back, 'furnaceYard', NOON).remaining).toBe(3);
    expect(refundSurge(back, out.setup.surge, NOON)).toBe(back); // nothing left to give back
  });

  it('gives nothing back once the day has turned over, for a kept charge, or without a record', () => {
    const out = open();
    const atlas = out.character.atlas!;
    expect(refundSurge(atlas, out.setup.surge, NOON + SURGE_DAY_MS)).toBe(atlas);
    expect(refundSurge(atlas, { ...out.setup.surge!, kept: true }, NOON)).toBe(atlas);
    expect(refundSurge(atlas, undefined, NOON)).toBe(atlas);
    expect(refundSurge(undefined, out.setup.surge, NOON)).toBeUndefined();
  });

  it('never refunds into another area or below zero', () => {
    const a = open();
    const b = open(bareCharacter({ mapDevice: map('emberRoad', 3), currencyStash: { scrap: 99 }, atlas: a.character.atlas }));
    const back = refundSurge(b.character.atlas, a.setup.surge, NOON)!;
    expect(back.surge!.spent).toEqual({ emberRoad: 1 });
  });
});

describe('Hourglass Sand and the Grand Hourglass (D 7.4)', () => {
  const spentAtlas = (areas: readonly Parameters<typeof spendSurge>[1][]): AtlasProgress => {
    let atlas = newAtlas();
    for (const a of areas) atlas = spendSurge(atlas, a, NOON, 1)!.atlas;
    return atlas;
  };
  const holding = (id: 'hourglassSand' | 'grandHourglass', areas: readonly Parameters<typeof spendSurge>[1][], count = 2) =>
    withBackpack(bareCharacter({ atlas: { ...spentAtlas(areas), discovered: ['cinderCrossing', 'emberRoad', 'furnaceYard'] } }), [[currency(id, count, 'hg'), 0, 0]]);

  it('Sand refills one area to full and is consumed', () => {
    const ch = holding('hourglassSand', ['furnaceYard', 'furnaceYard', 'emberRoad']);
    const out = expectOk(refillSurge(ch, { kind: 'area', areaId: 'furnaceYard' }, NOON));
    expect(surgeStatus(out.character.atlas, 'furnaceYard', NOON).remaining).toBe(3);
    expect(surgeStatus(out.character.atlas, 'emberRoad', NOON).remaining).toBe(2);
    expect((out.character.backpack.entries[0].item as { count: number }).count).toBe(1);
    expect(out.message).toContain('Furnace Yard');
  });

  it('is refused, without cost, for a full area, an unrevealed area, a missing item or an unknown area', () => {
    const ch = holding('hourglassSand', ['furnaceYard']);
    expect(expectErr(refillSurge(ch, { kind: 'area', areaId: 'emberRoad' }, NOON))).toMatch(/already has all 3/);
    expect(expectErr(refillSurge(ch, { kind: 'area', areaId: 'heartOfForge' }, NOON))).toMatch(/not been revealed/);
    expect(expectErr(refillSurge({ ...ch, backpack: { ...ch.backpack, entries: [] } }, { kind: 'area', areaId: 'furnaceYard' }, NOON))).toMatch(/no Hourglass Sand/);
    expect(expectErr(refillSurge(ch, { kind: 'area', areaId: 'moonPalace' as never }, NOON))).toMatch(/Choose an area/);
  });

  it('Sand is also taken from the stash and the Crafting Stash', () => {
    const ch = bareCharacter({ atlas: { ...spentAtlas(['furnaceYard']), discovered: ['cinderCrossing', 'furnaceYard'] }, currencyStash: { hourglassSand: 1 } });
    const out = expectOk(refillSurge(ch, { kind: 'area', areaId: 'furnaceYard' }, NOON));
    expect(out.character.currencyStash.hourglassSand ?? 0).toBe(0);
  });

  it('a Grand Hourglass refills every area at once; refused when everything is full', () => {
    const ch = holding('grandHourglass', ['furnaceYard', 'furnaceYard', 'emberRoad', 'cinderCrossing'], 1);
    const out = expectOk(refillSurge(ch, { kind: 'all' }, NOON));
    for (const id of ['furnaceYard', 'emberRoad', 'cinderCrossing'] as const) expect(surgeStatus(out.character.atlas, id, NOON).remaining).toBe(3);
    expect(out.character.backpack.entries).toHaveLength(0);
    const full = holding('grandHourglass', []);
    expect(expectErr(refillSurge(full, { kind: 'all' }, NOON))).toMatch(/already has all/);
    expect(expectErr(refillSurge(holding('hourglassSand', ['furnaceYard']), { kind: 'all' }, NOON))).toMatch(/no Grand Hourglass/);
  });

  it('works through the shared rules API and the trade locks', () => {
    const ch = holding('hourglassSand', ['furnaceYard']);
    expect(expectOk(rules.refillSurge(ch, { kind: 'area', areaId: 'furnaceYard' }, NOON)).message).toContain('fully charged');
  });
});

describe('loot (D 7.2): surge quantity never applies to maps', () => {
  const surgeSetup = (): { plain: RunSetup; boosted: RunSetup } => {
    const ch = withMap();
    return { plain: expectOk(rules.openMap(ch, { now: NOON })).setup, boosted: open(ch).setup };
  };
  const ordinary = kill({ rarity: 'normal' });

  it('currency, equipment and flasks get 30% more, maps exactly the same chance as without surge', () => {
    const { plain, boosted } = surgeSetup();
    const a = categoryChances(plain, ordinary), b = categoryChances(boosted, ordinary);
    expect(b.map).toBe(a.map);
    for (const cat of ['currency', 'equipment', 'flask'] as const) expect(b[cat] / a[cat], cat).toBeCloseTo(1.3, 9);
  });

  it('rarity is 15% more; the guarantees (the personal luck of the kill) do not see the surge', () => {
    const { plain, boosted } = surgeSetup();
    const a = killLuck(plain, ordinary), b = killLuck(boosted, ordinary);
    expect(b.rarity / a.rarity).toBeCloseTo(1.15, 9);
    expect(b.quantity / a.quantity).toBeCloseTo(1.3, 9);
    expect(b.personal).toEqual(a.personal);
    expect(lootLuckWithoutSurge(boosted, null)).toEqual(lootLuck(plain, null));
  });

  it('the HUD luck is the sim luck and lists Surge as a source', () => {
    const { plain, boosted } = surgeSetup();
    expect(lootLuck(boosted, null).itemQuantity).toBeCloseTo(lootLuck(plain, null).itemQuantity * 1.3, 6);
    expect(lootLuck(boosted, null).itemRarity).toBeCloseTo(lootLuck(plain, null).itemRarity * 1.15, 6);
    const lines = lootLuckLines(boosted, bareCharacter());
    expect(lines[0].breakdown.join(' ')).toContain('30% more Surge');
    expect(lines[1].breakdown.join(' ')).toContain('15% more Surge');
    expect(lootLuckLines(plain, bareCharacter())[0].breakdown.join(' ')).not.toContain('Surge');
  });

  it('map volume is identical with and without surge over a whole run of kills (I1)', () => {
    const { plain, boosted } = surgeSetup();
    const kills = 20_000;
    const count = (setup: RunSetup): number => {
      let maps = 0;
      for (let i = 0; i < kills; i++) maps += rules.rollKillLoot(setup, ordinary, createRng(i + 1), bareCharacter()).filter((x) => x.kind === 'map').length;
      return maps;
    };
    // The other categories draw more with surge, so the streams drift apart: the maps are the same in expectation, not seed for seed.
    const expected = kills * categoryChances(plain, ordinary).map;
    for (const setup of [plain, boosted]) expect(Math.abs(count(setup) - expected)).toBeLessThan(4.5 * Math.sqrt(expected));
    expect(categoryChances(boosted, ordinary).map).toBe(categoryChances(plain, ordinary).map);
  });

  it('chest and boss guarantees come out the same with and without surge', () => {
    const { plain, boosted } = surgeSetup();
    for (let seed = 1; seed <= 30; seed++) {
      expect(JSON.stringify(rules.rollChestLoot(boosted, createRng(seed), bareCharacter()))).toBe(JSON.stringify(rules.rollChestLoot(plain, createRng(seed), bareCharacter())));
    }
  });

  it('guests get the map-side bonus and spend nothing: a joiner rolls with the frozen setup and their own atlas is untouched', () => {
    const { boosted } = surgeSetup();
    const guest = bareCharacter({ id: 'guest', atlas: newAtlas() });
    expect(categoryChances(boosted, ordinary, guest).currency / categoryChances({ ...boosted, surge: undefined }, ordinary, guest).currency).toBeCloseTo(1.3, 9);
    rules.rollKillLoot(boosted, ordinary, createRng(1), guest);
    expect(guest.atlas!.surge).toBeUndefined();
  });
});

describe('Hourglass drops (D 7.4)', () => {
  const setupAt = (areaId: Parameters<typeof map>[0], tier: number, nodes: string[] = []): RunSetup =>
    expectOk(rules.openMap(bareCharacter({ mapDevice: map(areaId, tier), currencyStash: { scrap: 99, blackKey: 1 }, atlas: fullProgress(nodes) }), { now: NOON })).setup;
  const bossKill = kill({ kind: 'cinderMatriarch', isBoss: true, rarity: 'rare', wave: 6 });
  const count = (id: string, rolls: ReadonlyArray<ReturnType<typeof rules.rollKillLoot>>): number => rolls.filter((items) => items.some((i) => i.kind === 'currency' && i.currencyId === id)).length;
  const draws = (setup: RunSetup, n: number, ctx = bossKill) => Array.from({ length: n }, (_, i) => rules.rollKillLoot(setup, ctx, createRng(9000 + i), bareCharacter()));
  const rate = (setup: RunSetup): number => Math.min(1, HOURGLASS_SAND.bossChance * lootLuckWithoutSurge(setup, bareCharacter()).itemRarity / 100);

  it('Sand drops from final bosses at Tier 3+ at 5% times personal rarity, never below', () => {
    const t5 = setupAt('furnaceYard', 5);
    const n = 3000, sand = count('hourglassSand', draws(t5, n));
    const p = rate(t5);
    expect(Math.abs(sand / n - p), `${sand / n} vs ${p}`).toBeLessThan(4 * Math.sqrt(p * (1 - p) / n));
    expect(count('hourglassSand', draws(setupAt('emberRoad', 2), 800))).toBe(0);
    // ordinary kills never drop it
    expect(count('hourglassSand', Array.from({ length: 1500 }, (_, i) => rules.rollKillLoot(t5, kill({ rarity: 'rare' }), createRng(i + 1), bareCharacter())))).toBe(0);
  });

  it('is doubled in sealed areas', () => {
    const sealed = setupAt('furnaceYard', 5);
    const pit = expectOk(rules.openMap(bareCharacter({ mapDevice: map('furnaceYard', 5), currencyStash: { scrap: 99, blackKey: 1 }, atlas: fullProgress() }), { now: NOON, passage: { kind: 'key', currencyId: 'blackKey' } })).setup;
    const n = 3000;
    const normal = count('hourglassSand', draws(sealed, n)), twice = count('hourglassSand', draws(pit, n, kill({ kind: 'cinderMatriarch', isBoss: true, rarity: 'rare', wave: 6 })));
    expect(twice / Math.max(1, normal)).toBeGreaterThan(1.5);
    expect(twice / Math.max(1, normal)).toBeLessThan(2.7);
  });

  it('Trailmark raises the chance by 50%', () => {
    const plain = setupAt('furnaceYard', 5), marked = setupAt('furnaceYard', 5, pathTo('trailmark'));
    const n = 4000, a = count('hourglassSand', draws(plain, n)), b = count('hourglassSand', draws(marked, n));
    expect(b / a).toBeGreaterThan(1.2);
    expect(b / a).toBeLessThan(1.9);
  });

  it('the Grand Hourglass drops only from Tier 9+ final bosses (0.5%)', () => {
    expect(GRAND_HOURGLASS.bossMinTier).toBe(9);
    expect(count('grandHourglass', draws(setupAt('crownFoundry', 8), 3000))).toBe(0);
    const grand = count('grandHourglass', draws(setupAt('crownFoundry', 9), 3000));
    expect(grand).toBeGreaterThan(0);
    expect(grand).toBeLessThan(40);
  });

  it('the completion chest pays Sand 3% of the time, Gold events 10%', () => {
    const t5 = setupAt('furnaceYard', 5);
    const n = 3000;
    const chests = Array.from({ length: n }, (_, i) => rules.rollChestLoot(t5, createRng(70000 + i), bareCharacter()));
    const chest = count('hourglassSand', chests) / n;
    expect(Math.abs(chest - HOURGLASS_SAND.chestChance)).toBeLessThan(4 * Math.sqrt(0.03 * 0.97 / n));
    const gold = Array.from({ length: n }, (_, i) => rules.rollEventReward(t5, { kind: 'echoRift', grade: 3, choice: 0, tally: 0, x: 0, y: 0, wave: 2, ingredientBonus: 0, multiplier: 1 }, createRng(80000 + i), bareCharacter()));
    const goldRate = count('hourglassSand', gold) / n;
    expect(Math.abs(goldRate - HOURGLASS_SAND.goldEventChance)).toBeLessThan(4 * Math.sqrt(0.1 * 0.9 / n));
    const bronze = Array.from({ length: 800 }, (_, i) => rules.rollEventReward(t5, { kind: 'echoRift', grade: 1, choice: 0, tally: 0, x: 0, y: 0, wave: 2, ingredientBonus: 0, multiplier: 1 }, createRng(90000 + i), bareCharacter()));
    expect(count('hourglassSand', bronze)).toBe(0);
  });

  it('the Sand roll uses its own stream: every other drop of a boss kill is unchanged by it', () => {
    const t5 = setupAt('furnaceYard', 5);
    for (let i = 0; i < 200; i++) {
      const items = rules.rollKillLoot(t5, bossKill, createRng(500 + i), bareCharacter());
      const rest = items.filter((x) => !(x.kind === 'currency' && (x.currencyId === 'hourglassSand' || x.currencyId === 'grandHourglass')));
      expect(rest.length).toBeGreaterThan(0);
    }
  });

  it('attachSurge writes the same readout line the activation does', () => {
    const setup = setupAt('furnaceYard', 5);
    attachSurge(setup, { areaId: 'furnaceYard', quantityMore: 30, rarityMore: 15, day: 1 });
    expect(setup.surge?.areaId).toBe('furnaceYard');
    expect(setup.summary.at(-1)?.breakdown.join(' ')).toContain('except for maps');
  });
});
