import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtlasAreaId, AtlasProgress } from '../../src/contracts/atlas';
import type { CharacterSave, MapItem } from '../../src/contracts/items';
import { findAtlasArea } from '../../src/data/progression/atlas';
import {
  currentSetup, fittingUids, keyForArea, mapFit, openAreaBlock, passageNeed, planIsEmpty, readSetups, rememberSetup, setupPlan, whereToFind,
} from '../../src/ui/atlas/area-modal';

const area = (id: string) => findAtlasArea(id)!;
const map = (areaId: string, over: Partial<MapItem> = {}): MapItem => ({ kind: 'map', uid: `m-${areaId}`, areaId: areaId as AtlasAreaId, baseId: 'ashenForge', tier: 2, rarity: 'normal', quality: 0, corrupted: false, mods: [], ...over }) as MapItem;
const scarab = (id: string, uid = id, count = 1) => ({ kind: 'currency' as const, uid, currencyId: id, count });
const pack = (...items: unknown[]) => ({ entries: items.map((item, i) => ({ item, x: i, y: 0 })) }) as never;
const char = (items: unknown[] = [], scarabs: unknown[] = [null, null, null, null], over: Partial<CharacterSave> = {}) =>
  ({ backpack: pack(...items), mapScarabs: scarabs, mapDevice: null, stash: [], mapStash: [], equipment: {}, craftSlot: null, ...over }) as unknown as CharacterSave;

describe('A map belongs in its own area\'s slot (mapFit)', () => {
  it('accepts a map of this area and refuses another with "This map opens <home>" and a way there', () => {
    expect(mapFit(map('emberRoad'), area('emberRoad'))).toEqual({ ok: true, via: 'home' });
    const bad = mapFit(map('furnaceYard'), area('emberRoad'));
    expect(bad).toEqual({ ok: false, reason: 'This map opens Furnace Yard.', goto: 'furnaceYard' });
  });
  it('refuses a map above the area\'s ceiling with the reason and no detour', () => {
    const r = mapFit(map('cinderCrossing', { tier: 5 }), area('cinderCrossing'));
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toMatch(/ceiling of Tier 1/); expect(r.goto).toBeNull(); }
  });
  it('lets any map up to a sealed area\'s ceiling through its key passage, and refuses one above it', () => {
    expect(mapFit(map('emberRoad', { tier: 3 }), area('sealedReliquary'))).toEqual({ ok: true, via: 'key' });
    const r = mapFit(map('emberRoad', { tier: 9 }), area('sealedReliquary'));
    expect(r.ok).toBe(false);
  });
  it('opens the Pit only for a Bounty map bound beside it', () => {
    expect(mapFit(map('ironMarch', { bounty: true, tier: 3 }), area('pitOfEchoes'))).toEqual({ ok: true, via: 'pit' });
    const plain = mapFit(map('ironMarch', { tier: 3 }), area('pitOfEchoes'));
    expect(plain.ok).toBe(false);
    if (!plain.ok) expect(plain.reason).toMatch(/Bounty map of Iron March/);
    expect(mapFit(map('emberRoad', { bounty: true }), area('pitOfEchoes')).ok).toBe(false);
  });
});

describe('The reason under the Open area button is always in words', () => {
  const base = { passageChosen: true, previewError: null as string | null };
  it('asks for a map first, then names a wrong area, then the passage, then the rules\' own error', () => {
    expect(openAreaBlock({ area: area('emberRoad'), map: null, ...base })).toBe('Load a map for Ember Road: drag one from your inventory into the map slot.');
    expect(openAreaBlock({ area: area('emberRoad'), map: map('furnaceYard'), ...base })).toBe('This map opens Furnace Yard.');
    expect(openAreaBlock({ area: area('sealedReliquary'), map: map('emberRoad', { tier: 3 }), passageChosen: false, previewError: null })).toMatch(/key is missing: drag the Reliquary Key/);
    expect(openAreaBlock({ area: area('pitOfEchoes'), map: map('ironMarch', { bounty: true, tier: 3 }), passageChosen: false, previewError: null })).toMatch(/Bounty map/);
    expect(openAreaBlock({ area: area('emberRoad'), map: map('emberRoad'), ...base, previewError: 'You need 2 Forge Scrap.' })).toBe('You need 2 Forge Scrap.');
    expect(openAreaBlock({ area: area('emberRoad'), map: map('emberRoad'), ...base })).toBeNull();
  });
  it('knows which areas need a passage', () => {
    expect(keyForArea(area('sealedReliquary'))).toBe('reliquaryKey');
    expect(passageNeed(area('sealedReliquary'))).toMatchObject({ kind: 'key', keyId: 'reliquaryKey' });
    expect(passageNeed(area('pitOfEchoes'))?.kind).toBe('pit');
    expect(passageNeed(area('emberRoad'))).toBeNull();
  });
});

describe('Repeat last setup uses only what is in the inventory', () => {
  const saved = { scarabs: ['hasteScarab1', 'homingScarab1'], key: 'reliquaryKey' };
  it('plans a socket per available scarab and the key, and says what is missing', () => {
    const ch = char([scarab('hasteScarab1', 'u1', 2), scarab('reliquaryKey', 'u3')]);
    const plan = setupPlan(saved, ch, undefined);
    expect(plan.moves).toEqual([{ uid: 'u1', index: 0, currencyId: 'hasteScarab1' }]);
    expect(plan.key).toBe('reliquaryKey');
    expect(plan.missing).toEqual(['Weathered Homing Scarab']);
    expect(planIsEmpty(plan)).toBe(false);
  });
  it('skips what is already socketed or chosen, fills only free sockets, and is empty when nothing is available', () => {
    const socketed = [scarab('hasteScarab1', 'u1'), null, null, null];
    const plan = setupPlan({ scarabs: ['hasteScarab1', 'homingScarab1'] }, char([scarab('homingScarab1', 'u2')], socketed), undefined);
    expect(plan.moves).toEqual([{ uid: 'u2', index: 1, currencyId: 'homingScarab1' }]);
    expect(planIsEmpty(setupPlan(saved, char(), undefined))).toBe(true);
    expect(planIsEmpty(setupPlan(undefined, char([scarab('hasteScarab1')]), undefined))).toBe(true);
    // the key already in the passage slot is not planned again
    expect(setupPlan({ scarabs: [], key: 'reliquaryKey' }, char([scarab('reliquaryKey')]), 'reliquaryKey').key).toBeNull();
  });
  it('never plans two tiers of one family or more than four sockets', () => {
    const plan = setupPlan({ scarabs: ['hasteScarab1', 'hasteScarab4'] }, char([scarab('hasteScarab1'), scarab('hasteScarab4')]), undefined);
    expect(plan.moves).toHaveLength(1);
    const full = setupPlan({ scarabs: ['homingScarab1'] }, char([scarab('homingScarab1')], [scarab('hasteScarab1', 'a'), scarab('invasionScarab1', 'b'), scarab('wayfarerScarab1', 'c'), scarab('quarryScarab1', 'd')]), undefined);
    expect(full.moves).toHaveLength(0);
    expect(full.missing).toHaveLength(1);
  });
});

describe('Remembered setups survive in the browser, per area', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('round-trips one setup per area and ignores rubbish', () => {
    rememberSetup('emberRoad', currentSetup(char([], [scarab('hasteScarab1'), null, scarab('homingScarab2'), null]), undefined));
    rememberSetup('sealedReliquary', { scarabs: [], key: 'reliquaryKey' });
    expect(readSetups()).toEqual({ emberRoad: { scarabs: ['hasteScarab1', 'homingScarab2'] }, sealedReliquary: { scarabs: [], key: 'reliquaryKey' } });
    store.set('foe.atlas.setup.v1', '{"emberRoad":{"scarabs":["nope","hasteScarab1"]},"x":5}');
    expect(readSetups()).toEqual({ emberRoad: { scarabs: ['hasteScarab1'] } });
    store.set('foe.atlas.setup.v1', 'not json');
    expect(readSetups()).toEqual({});
  });
});

describe('The inventory highlight shows what fits, not a list', () => {
  const items = [map('emberRoad', { uid: 'm1' }), map('furnaceYard', { uid: 'm2' }), scarab('hasteScarab1', 's1'), scarab('hasteScarab2', 's2'), scarab('reliquaryKey', 'k1'), scarab('scrap', 'x1')];
  it('lights this area\'s maps and usable scarabs, plus a sealed area\'s key', () => {
    expect([...fittingUids(char(items), area('emberRoad'))].sort()).toEqual(['m1', 's1', 's2']);
    expect([...fittingUids(char(items), area('sealedReliquary'))].sort()).toEqual(['k1', 'm1', 'm2', 's1', 's2']);
  });
  it('drops a scarab whose family is already socketed and every scarab when the sockets are full', () => {
    expect([...fittingUids(char(items, [scarab('hasteScarab3', 'z'), null, null, null]), area('emberRoad'))]).toEqual(['m1']);
    const full = [scarab('hasteScarab3', 'a'), scarab('invasionScarab1', 'b'), scarab('wayfarerScarab1', 'c'), scarab('quarryScarab1', 'd')];
    expect([...fittingUids(char(items, full), area('emberRoad'))]).toEqual(['m1']);
  });
});

describe('Where to find maps for an area with none', () => {
  const atlas = { discovered: ['cinderCrossing', 'emberRoad', 'boneApproach', 'emberVault', 'furnaceYard'], completed: ['cinderCrossing'], clears: 1 } as unknown as AtlasProgress;
  it('lists the charted areas that drop its maps, strongest first, never the area itself', () => {
    const w = whereToFind(area('emberVault'), atlas, char());
    expect(w.sources.length).toBeGreaterThan(0);
    expect(w.sources[0]!.areaId).toBe('emberRoad');
    expect(w.sources.some((s) => s.areaId === 'emberVault')).toBe(false);
    for (let i = 1; i < w.sources.length; i++) expect(w.sources[i - 1]!.share).toBeGreaterThanOrEqual(w.sources[i]!.share);
    expect(w.rook).toBe(true);
    expect(w.passage).toBeNull();
  });
  it('counts maps waiting in the Map Stash and neighbours\' maps that could be re-charted', () => {
    const w = whereToFind(area('emberVault'), atlas, char([map('emberRoad', { tier: 2 })], undefined, { mapStash: [map('emberVault')] }));
    expect(w.inStash).toBe(1);
    expect(w.rechartable).toBe(1);
  });
  it('says a sealed area is reached through its key, with no map sources', () => {
    const w = whereToFind(area('sealedReliquary'), { ...atlas, discovered: [...atlas.discovered, 'sealedReliquary'] }, char());
    expect(w.passage?.kind).toBe('key');
    expect(w.sources).toEqual([]);
    expect(w.rook).toBe(false);
  });
});
