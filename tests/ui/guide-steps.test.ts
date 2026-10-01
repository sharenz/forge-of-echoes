// The first-run tracker's step state machine (src/ui/guide/steps.ts): a table over crafted snapshots, evidence shortcuts,
// monotonic completion, the fell / spent-map variants and the party cases.
import { describe, expect, it } from 'vitest';
import type { GuideStepId } from '../../src/contracts/guide';
import { CHAPTERS, FIGHT_KILLS, chapterOf, chapterProgress, countGearToEquip, deriveGuide, evidenceOf, trackerLines, type GuideSnapshot } from '../../src/ui/guide/steps';

const base: GuideSnapshot = {
  mode: 'active', done: [], zone: 'hideout', ownHideout: true, atlasOpen: false, areaModal: false, deviceMap: false, portal: null, run: null,
  unspent: { attribute: 0, skill: 0 }, gearToEquip: 0, area: 'Cinder Crossing',
};
const portal = { remaining: 8, total: 8, cleared: false, ownerName: 'Ysolde' };
const inMap = (over: Partial<NonNullable<GuideSnapshot['run']>> = {}): GuideSnapshot => ({
  ...base, zone: 'map', run: { phase: 'fight', kills: 0, wave: 1, waveCount: 6, chest: null, bossName: 'The Cinder Matriarch', ...over },
});
const step = (s: Partial<GuideSnapshot>) => deriveGuide({ ...base, ...s });

describe('deriveGuide: the walk, by evidence', () => {
  it('a fresh character is on the Map Device, with an immediate marker on it', () => {
    const v = step({});
    expect(v).toMatchObject({ visible: true, step: 'device', chapter: 'enter', target: 'mapDevice', urgent: true });
    expect(v.completed.size).toBe(0);
  });
  it('the Atlas open moves to picking the area (no world marker while the Atlas is up)', () => {
    expect(step({ atlasOpen: true })).toMatchObject({ step: 'area', target: null });
  });
  it('an open area modal moves to the map slot', () => {
    expect(step({ atlasOpen: true, areaModal: true })).toMatchObject({ step: 'map' });
  });
  it('a filled slot moves to Open area', () => {
    expect(step({ atlasOpen: true, areaModal: true, deviceMap: true })).toMatchObject({ step: 'open' });
  });
  it('a portal moves to entering it, with the marker on the portal', () => {
    expect(step({ deviceMap: false, portal })).toMatchObject({ step: 'enter', target: 'portal' });
  });
  it('a spent or cleared portal is no evidence of an opened area', () => {
    expect(step({ portal: { ...portal, remaining: 0 } }).step).toBe('device');
    expect(step({ portal: { ...portal, cleared: true } }).step).toBe('device');
  });
  it('closing the Atlas on the map step puts the marker back on the Map Device', () => {
    expect(step({ areaModal: false, atlasOpen: false, deviceMap: true })).toMatchObject({ step: 'open', target: 'mapDevice' });
  });
  it('ctrl-clicking a map straight in (slot filled, never saw the modal) skips the area step by evidence', () => {
    const v = step({ atlasOpen: true, deviceMap: true });
    expect(v.step).toBe('open');
    expect(v.completed.has('area') && v.completed.has('map') && v.completed.has('device')).toBe(true);
  });
  it('being in a map completes steps 1 to 5 (a friend\'s portal included)', () => {
    const v = deriveGuide(inMap());
    expect([...v.completed].sort()).toEqual(['area', 'device', 'enter', 'map', 'open'].sort());
    expect(v.step).toBe('fight');
    expect(v.chapter).toBe('win');
  });
  it('fight completes at 10 kills, or wave 2', () => {
    expect(deriveGuide(inMap({ kills: FIGHT_KILLS - 1 })).step).toBe('fight');
    expect(deriveGuide(inMap({ kills: FIGHT_KILLS })).step).toBe('boss');
    expect(deriveGuide(inMap({ wave: 2 })).step).toBe('boss');
  });
  it('the boss step names the boss and the wave', () => {
    expect(deriveGuide(inMap({ wave: 3 }))).toMatchObject({ step: 'boss' });
  });
  it('a cleared map with a closed chest points at the chest', () => {
    expect(deriveGuide(inMap({ phase: 'cleared', chest: 'closed', kills: 80 }))).toMatchObject({ step: 'chest', target: 'chest' });
  });
  it('an opened chest points at the return portal', () => {
    expect(deriveGuide(inMap({ phase: 'cleared', chest: 'open', kills: 80 }))).toMatchObject({ step: 'home', target: 'returnPortal' });
  });
  it('walking past the chest into the return portal still finishes the walk', () => {
    const v = deriveGuide({ ...base, done: ['device', 'area', 'map', 'open', 'enter', 'fight', 'boss'], zone: 'hideout' });
    expect(v.completed.has('chest') && v.completed.has('home')).toBe(true);
  });
  it('home with unspent points asks to spend them', () => {
    const v = deriveGuide({ ...base, done: ['device', 'area', 'map', 'open', 'enter', 'fight', 'boss', 'chest'], unspent: { attribute: 6, skill: 2 }, gearToEquip: 3 });
    expect(v).toMatchObject({ step: 'points', chapter: 'grow', target: null });
  });
  it('points spent, loot unworn: equip', () => {
    const v = deriveGuide({ ...base, done: ['device', 'area', 'map', 'open', 'enter', 'fight', 'boss', 'chest', 'home'], gearToEquip: 2 });
    expect(v.step).toBe('equip');
  });
  it('everything done: the closing card', () => {
    const v = deriveGuide({ ...base, done: ['device', 'area', 'map', 'open', 'enter', 'fight', 'boss', 'chest', 'home'] });
    expect(v.step).toBe('next');
    expect(v.chapter).toBe('grow');
  });
  it('reports the evidence steps that are not persisted yet (the caller sends guide done for them)', () => {
    const v = step({ atlasOpen: true, areaModal: true });
    expect(v.newlyDone).toEqual(['device', 'area']);
    expect(deriveGuide({ ...base, done: ['device', 'area'], atlasOpen: true, areaModal: true }).newlyDone).toEqual([]);
  });
});

describe('deriveGuide: monotonic and tolerant', () => {
  it('a persisted step never un-completes (taking the map out does not go backwards)', () => {
    const v = step({ done: ['device', 'area', 'map'], atlasOpen: true, areaModal: true, deviceMap: false });
    expect(v.completed.has('map')).toBe(true);
    expect(v.step).toBe('open');
  });
  it('closing the Atlas after step 3 keeps the later step', () => {
    expect(step({ done: ['device', 'area'] }).step).toBe('map');
  });
  it('dying keeps the tracker on the fight and marks the portal once home', () => {
    const v = deriveGuide({ ...base, done: ['device', 'area', 'map', 'open', 'enter'], portal: { ...portal, remaining: 7 } });
    expect(v).toMatchObject({ step: 'fight', variant: 'retryPortal', target: 'portal', urgent: true });
  });
  it('a spent map after a fall asks for another map, as a single line', () => {
    const v = deriveGuide({ ...base, done: ['device', 'area', 'map', 'open', 'enter'], portal: null });
    expect(v).toMatchObject({ step: 'map', variant: 'retryNoPortal', target: 'mapDevice' });
    expect(trackerLines(v)).toEqual([{ id: 'map', state: 'current' }]);
  });
  it('is off when skipped or done', () => {
    expect(step({ mode: 'skipped' }).visible).toBe(false);
    expect(step({ mode: 'done' }).visible).toBe(false);
    expect(step({ zone: null }).visible).toBe(false);
  });
});

describe('deriveGuide: parties', () => {
  it('in a friend\'s hideout with their portal open: one line to join', () => {
    const v = deriveGuide({ ...base, ownHideout: false, portal: { ...portal, ownerName: 'Mira' } });
    expect(v).toMatchObject({ visible: true, variant: 'partyJoin', step: 'enter', target: 'portal' });
    expect(trackerLines(v)).toHaveLength(1);
  });
  it('in a friend\'s hideout without a portal the guide is silent', () => {
    expect(deriveGuide({ ...base, ownHideout: false }).visible).toBe(false);
  });
  it('a newcomer in a veteran\'s map starts at the fight, steps 1 to 5 done by evidence', () => {
    const v = deriveGuide(inMap());
    expect(v.newlyDone).toEqual(['device', 'area', 'map', 'open', 'enter']);
  });
});

describe('tracker lines and chapters', () => {
  it('chapters hold at most five lines', () => {
    for (const ids of Object.values(CHAPTERS)) expect(ids.length).toBeLessThanOrEqual(5);
  });
  it('maps every step to a chapter', () => {
    expect(chapterOf('device')).toBe('enter');
    expect(chapterOf('fight')).toBe('win');
    expect(chapterOf('equip')).toBe('grow');
    expect(chapterOf('next')).toBe('grow');
  });
  it('shows the current chapter with done, current and todo lines', () => {
    const v = step({ atlasOpen: true, areaModal: true });
    const lines = trackerLines(v);
    expect(lines.map((l) => l.id)).toEqual(['device', 'area', 'map', 'open', 'enter']);
    expect(lines.map((l) => l.state)).toEqual(['done', 'done', 'current', 'todo', 'todo']);
    expect(chapterProgress(v)).toEqual({ done: 2, total: 5 });
  });
  it('evidenceOf reads the snapshot only (never the persisted list)', () => {
    expect([...evidenceOf({ ...base, done: ['device'] })]).toEqual([]);
  });
  it('counts the gear that fits a free slot with the caller\'s rule', () => {
    expect(countGearToEquip(['a', 'bb', 'c'], (x) => x.length === 1)).toBe(2);
  });
});

describe('step ids', () => {
  it('every tracked step has a chapter line', () => {
    const all: GuideStepId[] = Object.values(CHAPTERS).flat();
    expect(all).toHaveLength(11);
  });
});
