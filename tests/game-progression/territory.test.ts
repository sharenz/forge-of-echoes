// Slice B1: beacons and sigils (brief D 6, 9, 12 item 10). Slots, reach, the sigil menu into the map modifiers, stacking, uses, the
// frozen expedition, the hideout commands, persistence (old saves), Rook's sigils, drops and the tree re-roles.
import { describe, expect, it } from 'vitest';
import type { AtlasAreaId, AtlasProgress } from '../../src/contracts/atlas';
import { ATLAS_AREA_IDS } from '../../src/contracts/atlas';
import type { CharacterSave } from '../../src/contracts/items';
import { CURRENCY_IDS, SIGIL_IDS, type SigilId } from '../../src/contracts/content';
import { createRng } from '../../src/core/rng';
import { ATLAS_AREAS, findAtlasArea } from '../../src/data/progression/atlas';
import { CURRENCIES } from '../../src/data/items';
import { findAtlasNode } from '../../src/data/progression/map-tree';
import { ROOK_SIGIL_PRICE, SIGILS, SIGIL_USES, findSigil } from '../../src/data/progression/territory';
import { rules } from '../../src/game';
import { discoverAfterBoss, newAtlas, normalizeAtlas } from '../../src/game/progression/atlas';
import { currencyWeightsFor, rollSigil } from '../../src/game/progression/loot';
import { mapEventOdds } from '../../src/game/progression/map-events';
import { mapModifiers } from '../../src/game/progression/maps';
import { buyOffer, merchantOffers, rookSigilStock } from '../../src/game/progression/merchant';
import { restoreRunSetup } from '../../src/game/progression/runs';
import { surgeStatus } from '../../src/game/progression/surge';
import {
  beaconCoverage, beaconRadius, beaconSlotCount, coveringSigils, normalizeBeacons, normalizeRunTerritory, refundTerritoryUses, slotSigil,
  spendTerritoryUses, territoryClassWeights, territoryEventChance, territoryFor, territoryRevealChance, unslotSigil,
} from '../../src/game/progression/territory';
import { setMapTreeNode } from '../../src/game/progression/map-tree';
import { bareCharacter, currency, expectOk, map, withBackpack } from './fixtures';

const NOON = Date.UTC(2026, 9, 6, 12);
const all = [...ATLAS_AREA_IDS];
const atlasWith = (extra: Partial<AtlasProgress> = {}): AtlasProgress => ({ ...newAtlas(), discovered: all, completed: all, ...extra });
const slot = (sigilId: SigilId, uses = 12, max = 12) => ({ sigilId, uses, max });
const lightkeeperPath = (): string[] => {
  // allocate along the links from the origin to Lightkeeper (BFS over the tree data)
  const prev = new Map<string, string>([['origin', '']]);
  const queue = ['origin'];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === 'lightkeeper') break;
    for (const l of findAtlasNode(id)!.links) if (!prev.has(l)) { prev.set(l, id); queue.push(l); }
  }
  const out: string[] = [];
  for (let id = 'lightkeeper'; id && id !== 'origin'; id = prev.get(id)!) out.unshift(id);
  return out;
};

describe('beacons: slots and reach (D 6.1, 6.2)', () => {
  it('gives every area its slot count by depth, sealed areas and dead ends, and Lightkeeper a second slot to the one-slot beacons', () => {
    expect(beaconSlotCount('cinderCrossing')).toBe(1);
    expect(beaconSlotCount('crownFoundry')).toBe(1); // depth 4
    expect(beaconSlotCount('emberCitadel')).toBe(2); // depth 5
    expect(beaconSlotCount('blackPit')).toBe(2); // sealed
    expect(beaconSlotCount('shrineField')).toBe(1); // dead end at depth 8
    expect(beaconSlotCount('emberVault')).toBe(1);
    expect(beaconSlotCount('moon' as AtlasAreaId)).toBe(0);
    for (const a of ATLAS_AREAS) expect(beaconSlotCount(a.id, ['lightkeeper']), a.id).toBe(2);
  });

  it('measures the reach in chart pixels: the coverage table of all 25 beacons (reviewed once against the brief)', () => {
    const table = Object.fromEntries(ATLAS_AREAS.map((a) => [a.id, `${beaconRadius(a.id)}: ${beaconCoverage(a.id).slice(1).join(' ')}`]));
    expect(table).toEqual({
      cinderCrossing: '120: emberRoad boneApproach',
      emberRoad: '120: cinderCrossing emberVault furnaceYard',
      boneApproach: '120: cinderCrossing glassSepulchre ironMarch pitOfEchoes',
      emberVault: '150: cinderCrossing emberRoad furnaceYard',
      furnaceYard: '120: emberRoad glassSepulchre shatteredForge',
      glassSepulchre: '120: boneApproach furnaceYard ironMarch hollowOssuary',
      ironMarch: '120: boneApproach glassSepulchre championsApproach hollowOssuary pitOfEchoes',
      shatteredForge: '120: furnaceYard crownFoundry',
      championsApproach: '120: ironMarch winterThrone hollowOssuary',
      crownFoundry: '140: shatteredForge sealedReliquary emberCitadel lastKiln gildedVault',
      winterThrone: '140: championsApproach sealedReliquary frozenPassage echoBastion hollowOssuary gildedVault',
      sealedReliquary: '100: winterThrone hollowOssuary gildedVault',
      emberCitadel: '140: crownFoundry sealedReliquary lastKiln gildedVault blackPit',
      frozenPassage: '140: winterThrone sealedReliquary echoBastion gildedVault blackPit',
      lastKiln: '140: crownFoundry emberCitadel heartOfForge shrineField gildedVault blackPit huntingGround',
      echoBastion: '140: winterThrone frozenPassage eternalArena gildedVault blackPit huntingGround',
      heartOfForge: '160: emberCitadel lastKiln shrineField blackPit huntingGround riftNexus',
      eternalArena: '160: frozenPassage echoBastion blackPit huntingGround riftNexus',
      hollowOssuary: '150: boneApproach glassSepulchre ironMarch championsApproach winterThrone sealedReliquary',
      pitOfEchoes: '150: boneApproach ironMarch',
      shrineField: '190: lastKiln heartOfForge blackPit huntingGround riftNexus',
      gildedVault: '100: sealedReliquary frozenPassage blackPit',
      blackPit: '100: echoBastion gildedVault huntingGround',
      huntingGround: '100: blackPit riftNexus',
      riftNexus: '100: huntingGround',
    });
    // the brief's samples
    expect(beaconCoverage('cinderCrossing').length - 1).toBe(2);
    expect(beaconCoverage('lastKiln').length - 1).toBe(7);
    // Survey Stake: +20 px everywhere
    expect(beaconRadius('cinderCrossing', ['surveyStake'])).toBe(140);
    expect(beaconCoverage('shatteredForge')).not.toContain('sealedReliquary');
    expect(beaconCoverage('shatteredForge', ['surveyStake'])).toContain('sealedReliquary');
  });

  it('lists only sigils of completed beacons that reach the area', () => {
    const atlas = atlasWith({ completed: ['cinderCrossing', 'emberRoad'], beacons: { emberRoad: [slot('fortuneSigil2')], furnaceYard: [slot('omenSigil1')] } });
    expect(coveringSigils(atlas, 'furnaceYard').map((c) => [c.beacon, c.def.id])).toEqual([['emberRoad', 'fortuneSigil2']]);
    expect(coveringSigils(atlas, 'glassSepulchre')).toEqual([]);
  });
});

describe('sigils at activation (D 6.3)', () => {
  // Tier 3: no territory fee, so the fixture needs no Scrap
  const opener = (beacons: AtlasProgress['beacons'], areaId: AtlasAreaId = 'furnaceYard', tier = 3, extra: Partial<AtlasProgress> = {}): CharacterSave =>
    bareCharacter({ atlas: atlasWith({ beacons, ...extra }), mapDevice: map(areaId, tier, { uid: 'dev' }) });

  it('plumbs Fortune into the map modifiers with a Territory source, the luck and the readout, and spends one use', () => {
    const plain = expectOk(rules.openMap(opener(undefined)));
    const lit = expectOk(rules.openMap(opener({ furnaceYard: [slot('fortuneSigil3')] })));
    expect(lit.setup.territory).toEqual([{ sigilId: 'fortuneSigil3', fromAreaId: 'furnaceYard', slot: 0, share: 1 }]);
    const mods = mapModifiers(lit.setup.map, lit.setup.mapTree, { areaId: 'furnaceYard', territory: lit.setup.territory });
    expect(mods).toContainEqual({ stat: 'itemRarity', mode: 'increased', value: 18, source: 'Territory: Blazing Fortune Sigil (Furnace Yard)' });
    expect(lit.setup.itemRarity).toBeGreaterThan(plain.setup.itemRarity);
    expect(lit.setup.itemQuantity).toBe(plain.setup.itemQuantity);
    expect(lit.setup.summary.find((l) => l.label === 'Territory')?.breakdown[0]).toContain('Territory: Blazing Fortune Sigil (Furnace Yard): 18% increased item rarity');
    expect(lit.character.atlas!.beacons!.furnaceYard![0]).toEqual(slot('fortuneSigil3', 11));
    // the same rng draws: only the effects differ
    expect(lit.setup.seed).toBe(plain.setup.seed);
  });

  it('stacks the strongest sigil of a kind at 100% and every other at 50%; different kinds add', () => {
    // Glass Sepulchre (boss ingredients from Tier 3) is covered by its own beacon, Furnace Yard's and Bone Approach's
    const beacons = { glassSepulchre: [slot('fortuneSigil1')], furnaceYard: [slot('fortuneSigil3')], boneApproach: [slot('ingredientSigil1')] };
    const t = territoryFor(atlasWith({ beacons }), { area: findAtlasArea('glassSepulchre')!, map: { baseId: 'choralCrypt', tier: 4 }, surge: false });
    expect(t).toEqual([
      { sigilId: 'ingredientSigil1', fromAreaId: 'boneApproach', slot: 0, share: 1 },
      { sigilId: 'fortuneSigil3', fromAreaId: 'furnaceYard', slot: 0, share: 1 },
      { sigilId: 'fortuneSigil1', fromAreaId: 'glassSepulchre', slot: 0, share: 0.5 },
    ]);
    // Ingredient does nothing where no boss ingredient drops (no use spent there)
    expect(territoryFor(atlasWith({ beacons }), { area: findAtlasArea('furnaceYard')!, map: { baseId: 'ashenForge', tier: 4 }, surge: false }).map((e) => e.sigilId)).toEqual(['fortuneSigil3', 'fortuneSigil1']);
    const mods = mapModifiers(map('glassSepulchre', 4), [], { areaId: 'glassSepulchre', territory: t });
    expect(mods.filter((m) => m.stat === 'itemRarity' && m.source.startsWith('Territory')).map((m) => m.value).sort()).toEqual([18, 4]);
    expect(mods.find((m) => m.stat === 'bossIngredientChance')).toMatchObject({ mode: 'more', value: 20 });
  });

  it('spends a use only from sigils whose effect applied, and empties a slot at 0 with a notice', () => {
    // Hoard does nothing in a through-route area: no use spent; Fortune at 1 use burns out
    const ch = opener({ furnaceYard: [slot('fortuneSigil1', 1)], emberRoad: [slot('hoardSigil1', 4)] });
    const r = expectOk(rules.openMap(ch));
    expect(r.setup.territory!.map((t) => t.sigilId)).toEqual(['fortuneSigil1']);
    expect(r.character.atlas!.beacons).toEqual({ emberRoad: [slot('hoardSigil1', 4)] });
    expect(r.notices).toEqual(['Faint Fortune Sigil in the Furnace Yard beacon burned out: the slot is empty.']);
    // Hoard works in a dead end
    const dead = expectOk(rules.openMap(opener({ emberRoad: [slot('hoardSigil2', 4)] }, 'emberVault', 3)));
    expect(dead.setup.territory!.map((t) => t.sigilId)).toEqual(['hoardSigil2']);
    expect(dead.character.atlas!.beacons!.emberRoad![0]!.uses).toBe(3);
    // a theme sigil works only on its theme's maps
    const theme = { area: findAtlasArea('furnaceYard')!, surge: false };
    expect(territoryFor(atlasWith({ beacons: { furnaceYard: [slot('ashenSigil1')] } }), { ...theme, map: { baseId: 'ashenForge', tier: 4 } })).toHaveLength(1);
    expect(territoryFor(atlasWith({ beacons: { glassSepulchre: [slot('cryptSigil1')] } }), { ...theme, map: { baseId: 'ashenForge', tier: 4 } })).toHaveLength(0);
    // Tide needs a spent charge
    expect(territoryFor(atlasWith({ beacons: { furnaceYard: [slot('tideSigil1')] } }), { ...theme, map: { baseId: 'ashenForge', tier: 4 } })).toHaveLength(0);
    expect(territoryFor(atlasWith({ beacons: { furnaceYard: [slot('tideSigil1')] } }), { ...theme, map: { baseId: 'ashenForge', tier: 4 }, surge: true })).toHaveLength(1);
  });

  it('keeps the frozen sigils through a restart, whatever the beacons hold later', () => {
    const r = expectOk(rules.openMap(opener({ furnaceYard: [slot('fortuneSigil2')] })));
    const back = restoreRunSetup(JSON.parse(JSON.stringify(r.setup)), r.setup.seed)!;
    expect(back.territory).toEqual(r.setup.territory);
    expect(back.itemRarity).toBe(r.setup.itemRarity);
    expect(back.summary.some((l) => l.label === 'Territory')).toBe(true);
    // a run saved before beacons existed restores without territory
    const { territory: _t, ...old } = r.setup;
    expect(restoreRunSetup(JSON.parse(JSON.stringify(old)), r.setup.seed)!.territory).toBeUndefined();
    expect(normalizeRunTerritory([{ sigilId: 'nope', fromAreaId: 'furnaceYard', slot: 0, share: 1 }, { sigilId: 'omenSigil1', fromAreaId: 'moon', slot: 0 }, 7])).toBeUndefined();
    expect(normalizeRunTerritory([{ sigilId: 'omenSigil1', fromAreaId: 'furnaceYard', slot: 1, share: 0.5 }])).toEqual([{ sigilId: 'omenSigil1', fromAreaId: 'furnaceYard', slot: 1, share: 0.5 }]);
  });

  it('Omen raises the encounter chance after the area odds, never past the 65% cap', () => {
    const m = map('furnaceYard', 8);
    const base = Object.values(mapEventOdds(m, 'furnaceYard')).reduce((a, b) => a + b, 0);
    const omen = territoryEventChance([{ sigilId: 'omenSigil3', fromAreaId: 'furnaceYard', slot: 0, share: 1 }]);
    expect(omen).toBeCloseTo(0.09);
    const lifted = Object.values(mapEventOdds(m, 'furnaceYard', [], { territoryChance: omen })).reduce((a, b) => a + b, 0);
    expect(lifted).toBeCloseTo(Math.min(0.65, base + 0.09));
    const big = Object.values(mapEventOdds(m, 'furnaceYard', [], { territoryChance: 0.9 })).reduce((a, b) => a + b, 0);
    expect(big).toBeCloseTo(Math.max(base, 0.65));
  });

  it('Survey adds its fraction to the boss reveal (the same roll decides)', () => {
    const bonus = territoryRevealChance([{ sigilId: 'surveySigil2', fromAreaId: 'cinderCrossing', slot: 0, share: 1 }]);
    expect(bonus).toBeCloseTo(0.4);
    const atlas = { ...newAtlas(), discovered: ['cinderCrossing'] as AtlasAreaId[] };
    // Furnace Yard has three unrevealed neighbours: the base reveals 2, a roll under the Survey fraction adds the third
    const without = discoverAfterBoss(atlas, 'furnaceYard', false, { revealRoll: 0.3 }).revealed;
    expect(without).toEqual(['furnaceYard', 'emberRoad', 'shatteredForge']);
    expect(discoverAfterBoss(atlas, 'furnaceYard', false, { revealRoll: 0.3, revealBonus: bonus }).revealed).toEqual([...without, 'glassSepulchre']);
    expect(discoverAfterBoss(atlas, 'furnaceYard', false, { revealRoll: 0.5, revealBonus: bonus }).revealed).toEqual(without);
  });

  it('theme sigils weigh the signature currency and the area classes up on their theme only', () => {
    const t = [{ sigilId: 'ashenSigil3' as SigilId, fromAreaId: 'furnaceYard' as AtlasAreaId, slot: 0, share: 1 }];
    const plain = currencyWeightsFor(map('furnaceYard', 4), [], { areaId: 'furnaceYard' });
    const lit = currencyWeightsFor(map('furnaceYard', 4), [], { areaId: 'furnaceYard', territory: t });
    const w = (list: typeof plain, id: string) => list.find((d) => d.currencyId === id)!.weight;
    expect(w(lit, 'essenceEmber') / w(plain, 'essenceEmber')).toBeCloseTo(1.7);
    expect(w(lit, 'scrap')).toBe(w(plain, 'scrap'));
    const fy = findAtlasArea('emberCitadel')!;
    expect(territoryClassWeights(t, fy, 'cinderChapel')).toEqual(fy.classWeights);
    const forge = findAtlasArea('emberRoad')!;
    expect(territoryClassWeights(t, forge, 'ashenForge')).toEqual(Object.fromEntries(Object.entries(forge.classWeights ?? {}).map(([k, v]) => [k, v + 1])));
  });

  it('Tide: Faint strengthens the bonus, Bright adds a charge to covered areas, Blazing may keep the charge', () => {
    const now = NOON;
    const faint = expectOk(rules.openMap(opener({ furnaceYard: [slot('tideSigil1')] }), { useSurge: true, now }));
    expect(faint.setup.surge).toMatchObject({ quantityMore: 37.5, rarityMore: 18.75 });
    expect(faint.setup.territory!.map((t) => t.sigilId)).toEqual(['tideSigil1']);
    const bright = atlasWith({ beacons: { furnaceYard: [slot('tideSigil2')] } });
    expect(surgeStatus(bright, 'furnaceYard', now).max).toBe(4);
    expect(surgeStatus(bright, 'emberRoad', now).max).toBe(4);
    expect(surgeStatus(bright, 'ironMarch', now).max).toBe(3);
    // a ledger spent past 3 keeps its count on reload while the Tide sigil is slotted
    expect(normalizeAtlas({ ...bright, surge: { day: 1, spent: { furnaceYard: 4 } } }).surge!.spent.furnaceYard).toBe(4);
    // without a surge Tide does nothing and spends nothing
    const none = expectOk(rules.openMap(opener({ furnaceYard: [slot('tideSigil3')] }), { useSurge: false, now }));
    expect(none.setup.territory).toBeUndefined();
    expect(none.character.atlas!.beacons!.furnaceYard![0]!.uses).toBe(12);
    // Blazing: over many seeds about a quarter of the charges are kept
    let kept = 0;
    for (let i = 0; i < 400; i++) {
      const r = expectOk(rules.openMap({ ...opener({ furnaceYard: [slot('tideSigil3')] }), rngState: i * 7919 + 1 }, { useSurge: true, now }));
      if (r.setup.surge?.kept) kept++;
    }
    expect(kept / 400).toBeGreaterThan(0.17);
    expect(kept / 400).toBeLessThan(0.33);
  });

  it('refunds the uses of an unrestorable run exactly (and puts a burnt-out sigil back with one use)', () => {
    const entries = [{ sigilId: 'fortuneSigil1' as SigilId, fromAreaId: 'furnaceYard' as AtlasAreaId, slot: 0, share: 1 }];
    const atlas = atlasWith({ beacons: { furnaceYard: [slot('fortuneSigil1', 2)] } });
    const spent = spendTerritoryUses(atlas, entries).atlas;
    expect(refundTerritoryUses(spent, entries)!.beacons!.furnaceYard![0]!.uses).toBe(2);
    const burnt = spendTerritoryUses(atlasWith({ beacons: { furnaceYard: [slot('fortuneSigil1', 1)] } }), entries);
    expect(burnt.atlas.beacons).toEqual({});
    expect(refundTerritoryUses(burnt.atlas, entries)!.beacons!.furnaceYard![0]).toMatchObject({ sigilId: 'fortuneSigil1', uses: 1 });
    // a slot that now holds another sigil is left alone
    const other = atlasWith({ beacons: { furnaceYard: [slot('omenSigil1', 5)] } });
    expect(refundTerritoryUses(other, entries)).toBe(other);
  });
});

describe('the hideout commands (inventory first)', () => {
  const holder = (atlas: AtlasProgress, items: [SigilId, number, string][] = [['omenSigil1', 3, 'sg']]): CharacterSave =>
    withBackpack(bareCharacter({ atlas }), items.map(([id, n, u], i) => [currency(id, n, u), i, 0]));

  it('slots one sigil from a backpack stack into a cleared area, with full uses (Lamp Oil +3)', () => {
    const r = expectOk(slotSigil(holder(atlasWith()), 'furnaceYard', 0, 'sg'));
    expect(r.character.atlas!.beacons!.furnaceYard).toEqual([slot('omenSigil1', 12)]);
    expect(r.character.backpack.entries.find((e) => e.item.uid === 'sg')!.item).toMatchObject({ count: 2 });
    expect(r.message).toContain('Faint Omen Sigil lights the Furnace Yard beacon');
    const oil = expectOk(slotSigil(holder(atlasWith({ nodes: ['lampOil'] })), 'furnaceYard', 0, 'sg'));
    expect(oil.character.atlas!.beacons!.furnaceYard![0]).toEqual(slot('omenSigil1', SIGIL_USES[1] + 3, SIGIL_USES[1] + 3));
  });

  it('refuses areas that are not beacons, bad slots, non-sigils and items outside the backpack', () => {
    expect(slotSigil(holder(atlasWith({ completed: [] })), 'furnaceYard', 0, 'sg')).toMatchObject({ ok: false, error: expect.stringContaining('Clear Furnace Yard first') });
    expect(slotSigil(holder(atlasWith()), 'furnaceYard', 1, 'sg')).toMatchObject({ ok: false, error: 'Furnace Yard has 1 sigil slot.' });
    const scrap = withBackpack(bareCharacter({ atlas: atlasWith() }), [[currency('scrap', 3, 'sc'), 0, 0]]);
    expect(slotSigil(scrap, 'furnaceYard', 0, 'sc')).toMatchObject({ ok: false, error: 'Only a sigil fits a beacon slot.' });
    const stashed = bareCharacter({ atlas: atlasWith(), currencyStash: { omenSigil1: 2 } });
    expect(slotSigil(stashed, 'furnaceYard', 0, 'cstash:omenSigil1')).toMatchObject({ ok: false });
  });

  it('takes an unused sigil back to the backpack and consumes a used one; a swap does the same with the old sigil', () => {
    const used = holder(atlasWith({ beacons: { furnaceYard: [slot('fortuneSigil2', 5)] } }));
    const gone = expectOk(unslotSigil(used, 'furnaceYard', 0));
    expect(gone.character.atlas!.beacons).toBeUndefined();
    expect(gone.message).toContain('consumed');
    const fresh = holder(atlasWith({ beacons: { furnaceYard: [slot('fortuneSigil2', 12)] } }));
    const back = expectOk(unslotSigil(fresh, 'furnaceYard', 0));
    expect(back.character.backpack.entries.some((e) => e.item.kind === 'currency' && e.item.currencyId === 'fortuneSigil2')).toBe(true);
    const swap = expectOk(slotSigil(fresh, 'furnaceYard', 0, 'sg'));
    expect(swap.character.atlas!.beacons!.furnaceYard).toEqual([slot('omenSigil1')]);
    expect(swap.character.backpack.entries.some((e) => e.item.kind === 'currency' && e.item.currencyId === 'fortuneSigil2')).toBe(true);
    expect(unslotSigil(holder(atlasWith()), 'furnaceYard', 0)).toMatchObject({ ok: false, error: 'That beacon slot is empty.' });
  });
});

describe('persistence (old saves load unchanged)', () => {
  it('an Atlas saved before beacons existed normalises to the same Atlas', () => {
    const old = { discovered: ['cinderCrossing', 'emberRoad'], completed: ['cinderCrossing'], clears: 1, treeVersion: 2, nodes: [] };
    const atlas = normalizeAtlas(old);
    expect(atlas.beacons).toBeUndefined();
    expect(atlas).toEqual(normalizeAtlas(JSON.parse(JSON.stringify(atlas))));
  });

  it('cleans junk: unknown sigils and areas, uncompleted beacons, slots past the count, uses clamped', () => {
    const atlas = { completed: ['cinderCrossing', 'emberCitadel'] as AtlasAreaId[], nodes: [] };
    expect(normalizeBeacons({
      cinderCrossing: [slot('omenSigil1', 5), slot('fortuneSigil1')],
      emberCitadel: [null, { sigilId: 'tideSigil3', uses: 999, max: 10 }],
      emberRoad: [slot('omenSigil1')],
      moon: [slot('omenSigil1')],
      frozenPassage: 'x',
    }, atlas)).toEqual({ cinderCrossing: [slot('omenSigil1', 5)], emberCitadel: [null, { sigilId: 'tideSigil3', uses: 40, max: 40 }] });
    expect(normalizeBeacons({ cinderCrossing: [{ sigilId: 'nope', uses: 3 }] }, atlas)).toBeUndefined();
    expect(normalizeBeacons('x', atlas)).toBeUndefined();
    const round = normalizeAtlas({ ...atlasWith({ beacons: { furnaceYard: [slot('omenSigil1', 3)] } }), treeVersion: 2 });
    expect(round.beacons).toEqual({ furnaceYard: [slot('omenSigil1', 3)] });
  });
});

describe('sigil items, drops and Rook (D 6.4)', () => {
  it('defines 36 sigil currencies (appended after every older id), stack 20', () => {
    expect(SIGIL_IDS).toHaveLength(36);
    expect(CURRENCY_IDS.slice(-36)).toEqual([...SIGIL_IDS]);
    for (const s of SIGILS) {
      expect(CURRENCIES[s.id].name).toBe(s.name);
      expect(CURRENCIES[s.id].maxStack).toBe(20);
      expect(findSigil(s.id)).toBe(s);
    }
    expect(findSigil('omenSigil4')).toBeUndefined();
  });

  it('rolls kinds and strengths by the tier bands', () => {
    const rng = createRng(5);
    const seen = { 1: 0, 2: 0, 3: 0 } as Record<number, number>;
    let theme = 0;
    for (let i = 0; i < 3000; i++) {
      const s = findSigil(rollSigil(rng, 12, 'chainworks'))!;
      seen[s.strength]++;
      if (s.kind === 'chainworks') theme++;
      expect(s.theme === undefined || s.kind === 'chainworks').toBe(true);
    }
    expect(seen[3]).toBeGreaterThan(0);
    expect(theme / 3000).toBeGreaterThan(0.35); expect(theme / 3000).toBeLessThan(0.45);
    for (let i = 0; i < 300; i++) expect(findSigil(rollSigil(rng, 5, 'ashenForge'))!.strength).toBe(1);
    for (let i = 0; i < 300; i++) expect(findSigil(rollSigil(rng, 9, 'ashenForge'))!.strength).toBeLessThan(3);
  });

  it('Rook sells Faint generic sigils always and theme sigils of cleared themes, and buying one pays the price', () => {
    expect(rookSigilStock({ atlas: newAtlas() }).map((d) => d.kind === 'currency' && d.currencyId)).toEqual(
      ['omenSigil1', 'hoardSigil1', 'fortuneSigil1', 'ingredientSigil1', 'surveySigil1', 'tideSigil1']);
    const cleared = rookSigilStock({ atlas: { ...newAtlas(), completed: ['cinderCrossing', 'boneApproach'] } });
    expect(cleared.slice(6).map((d) => [d.kind === 'currency' && d.currencyId, d.price[0].count])).toEqual([['ashenSigil1', ROOK_SIGIL_PRICE.theme], ['ossuarySigil1', ROOK_SIGIL_PRICE.theme]]);
    expect(cleared[0].price).toEqual([{ currencyId: 'scrap', count: ROOK_SIGIL_PRICE.generic }]);
    const rich = withBackpack(bareCharacter({ atlas: newAtlas() }), [[currency('scrap', 20, 'sc'), 0, 0]]);
    const offer = merchantOffers(rich).find((o) => o.id === 'sigil-surveySigil1')!;
    expect(offer.kind).toBe('currency');
    const bought = expectOk(buyOffer(rich, offer.id));
    expect(bought.item).toMatchObject({ kind: 'currency', currencyId: 'surveySigil1', count: 1 });
    expect(bought.character.backpack.entries.find((e) => e.item.uid === 'sc')!.item).toMatchObject({ count: 6 });
    expect(buyOffer(rich, 'sigil-ashenSigil1').ok).toBe(false);
  });
});

describe('tree re-roles (D 9)', () => {
  it('Survey Stake widens beacons, Lamp Oil adds sigil uses, Lightkeeper is the one new notable', () => {
    expect(findAtlasNode('surveyStake')!.effects).toEqual([{ stat: 'beaconRadius', mode: 'flat', value: 20 }]);
    expect(findAtlasNode('lampOil')!.effects.map((e) => e.stat)).toEqual(['surgeCharges', 'sigilUses']);
    const lk = findAtlasNode('lightkeeper')!;
    expect(lk).toMatchObject({ kind: 'notable', group: 'cartography', engine: 'live' });
    expect(lk.links).toContain('fifthSocket');
    expect(lk.text).toContain('one-slot beacon');
  });

  it('refuses to refund Lightkeeper while a second slot holds a sigil', () => {
    const path = lightkeeperPath();
    const base = { ...atlasWith({ nodes: path }), tiersCleared: Array.from({ length: 14 }, (_, i) => i + 2) };
    const filled = bareCharacter({ atlas: { ...base, beacons: { cinderCrossing: [slot('omenSigil1'), slot('fortuneSigil1')] } } });
    expect(setMapTreeNode(filled, 'lightkeeper', false)).toMatchObject({ ok: false, error: expect.stringContaining('second slot of the Cinder Crossing beacon') });
    const emptySecond = bareCharacter({ atlas: { ...base, beacons: { cinderCrossing: [slot('omenSigil1')] } } });
    expect(setMapTreeNode(emptySecond, 'lightkeeper', false).ok).toBe(true);
  });
});
