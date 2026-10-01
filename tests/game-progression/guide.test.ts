// The first-run guide's account state (src/game/progression/guide.ts): normalising garbage, the veteran rule, the command's operations
// (idempotent, monotonic), and that old saves without a guide load unchanged (no SAVE_VERSION bump).
import { describe, expect, it } from 'vitest';
import { GUIDE_HINT_IDS, GUIDE_STEP_IDS, type GuideState } from '../../src/contracts/guide';
import { rules } from '../../src/game';
import { refillBelt } from '../../src/game/progression/flasks';
import {
  applyGuideOp, decideGuide, isVeteran, markWarmed, newGuide, normalizeGuide, recheckGuide, skippedGuide, wantsWarmup,
} from '../../src/game/progression/guide';
import { SAVE_VERSION } from '../../src/data/progression';

const stats = (over: Partial<ReturnType<typeof rules.createCharacter>['stats']> = {}) => ({ ...rules.createCharacter('Tester', 1).stats, ...over });
const fresh = { characters: [{ level: 1, stats: stats() }], atlas: { clears: 0, completed: [] as string[] } };

describe('normalizeGuide', () => {
  it('returns undefined for anything that is not a guide (so the server decides one)', () => {
    for (const raw of [undefined, null, 3, 'x', [], {}, { mode: 'sleeping' }]) expect(normalizeGuide(raw)).toBeUndefined();
  });
  it('drops unknown ids, de-duplicates and keeps the whitelist order', () => {
    const g = normalizeGuide({ v: 1, mode: 'active', done: ['map', 'device', 'device', 'bogus', 7], hints: ['firstLoot', 'lowLife', 'nope'], used: ['anvil', 'door'] })!;
    expect(g.done).toEqual(['device', 'map']);
    expect(g.hints).toEqual(['lowLife', 'firstLoot']);
    expect(g.used).toEqual(['anvil']);
  });
  it('coerces bad timestamps, counters and flags to safe defaults', () => {
    const g = normalizeGuide({ mode: 'done', done: 'no', hints: {}, t: { device: -4, map: 'x', open: 12.9 }, startedAt: 'now', finishedAt: -1, replays: 1e9, warmed: 'yes' })!;
    expect(g).toEqual({ v: 1, mode: 'done', done: [], hints: [], t: { open: 12 }, replays: 99 });
  });
  it('keeps skippedBy only on a skipped guide', () => {
    expect(normalizeGuide({ mode: 'skipped', skippedBy: 'veteran', done: [], hints: [] })!.skippedBy).toBe('veteran');
    expect(normalizeGuide({ mode: 'skipped', skippedBy: 'who', done: [], hints: [] })!.skippedBy).toBe('player');
    expect(normalizeGuide({ mode: 'active', skippedBy: 'player', done: [], hints: [] })).not.toHaveProperty('skippedBy');
  });
  it('round-trips a good guide unchanged', () => {
    const g: GuideState = { v: 1, mode: 'active', done: ['device', 'area'], hints: ['levelUp'], used: ['mapDevice'], t: { device: 5, area: 9 }, startedAt: 3, replays: 1, warmed: true };
    expect(normalizeGuide(JSON.parse(JSON.stringify(g)))).toEqual(g);
  });
});

describe('save integration', () => {
  it('an old save without a guide loads unchanged: no guide field, same version', () => {
    const ch = rules.createCharacter('Elder', 7);
    expect(ch.guide).toBeUndefined();
    const saved = JSON.stringify({ version: SAVE_VERSION, characters: [ch], lastCharacterId: ch.id, settings: null });
    const back = rules.parseSave(saved);
    expect(back.version).toBe(SAVE_VERSION);
    expect(back.characters[0].guide).toBeUndefined();
  });
  it('a stored guide survives a save round trip, repaired', () => {
    const ch = { ...rules.createCharacter('Elder', 7), guide: { v: 1, mode: 'active', done: ['device', 'ghost'], hints: [] } };
    const back = rules.parseSave(JSON.stringify({ version: SAVE_VERSION, characters: [ch], lastCharacterId: ch.id, settings: null })).characters[0];
    expect(back.guide).toEqual({ v: 1, mode: 'active', done: ['device'], hints: [] });
  });
  it('the tips setting is optional and survives', () => {
    const save = rules.parseSave(JSON.stringify({ version: SAVE_VERSION, characters: [], settings: { hints: false } }));
    expect(save.settings.hints).toBe(false);
    expect(rules.parseSave(JSON.stringify({ version: SAVE_VERSION, characters: [], settings: {} })).settings.hints).toBeUndefined();
  });
});

describe('the veteran rule', () => {
  it('a brand-new account starts active', () => {
    expect(decideGuide(fresh, 10)).toEqual({ v: 1, mode: 'active', done: [], hints: [], startedAt: 10 });
  });
  it.each([
    ['a character at level 5', { characters: [{ level: 5, stats: stats() }], atlas: null }],
    ['a character past level 5', { characters: [{ level: 12, stats: stats() }], atlas: null }],
    ['a completed map on any character', { characters: [{ level: 1, stats: stats() }, { level: 2, stats: stats({ mapsCompleted: 1 }) }], atlas: null }],
    ['Atlas clears', { characters: [{ level: 1, stats: stats() }], atlas: { clears: 2 } }],
    ['a completed Atlas area', { characters: [{ level: 1, stats: stats() }], atlas: { completed: ['cinderCrossing'] } }],
  ])('%s is a veteran: skipped for good, every hint marked seen', (_label, evidence) => {
    const g = decideGuide(evidence, 5);
    expect(isVeteran(evidence)).toBe(true);
    expect(g).toMatchObject({ mode: 'skipped', skippedBy: 'veteran', done: [], hints: [...GUIDE_HINT_IDS] });
  });
  it('level 4 and no completed map is not a veteran', () => {
    expect(isVeteran({ characters: [{ level: 4, stats: stats() }], atlas: { clears: 0, completed: [] } })).toBe(false);
  });
  it('a second character flips an ACTIVE guide to skipped when the account turned into a veteran', () => {
    const active = newGuide();
    expect(recheckGuide(active, fresh)).toBe(active);
    expect(recheckGuide(active, { characters: [{ level: 8, stats: stats() }, { level: 1, stats: stats() }] }).mode).toBe('skipped');
    const done: GuideState = { ...active, mode: 'done' };
    expect(recheckGuide(done, { characters: [{ level: 8, stats: stats() }] })).toBe(done);
  });
  it('a veteran never gets the gentle first map', () => {
    expect(wantsWarmup(newGuide(), fresh)).toBe(true);
    expect(wantsWarmup(newGuide(), { characters: [{ level: 9, stats: stats() }] })).toBe(false);
    expect(wantsWarmup(skippedGuide('player'), fresh)).toBe(false);
    expect(wantsWarmup(markWarmed(newGuide()), fresh)).toBe(false);
    expect(wantsWarmup(undefined, fresh)).toBe(false);
  });
});

describe('applyGuideOp', () => {
  const g = newGuide();
  it('records a step once, with its time, in step order, and is idempotent', () => {
    const a = applyGuideOp(g, { c: 'guide', op: 'done', id: 'map' }, 100)!;
    const b = applyGuideOp(a, { c: 'guide', op: 'done', id: 'device' }, 200)!;
    expect(b.done).toEqual(['device', 'map']);
    expect(b.t).toEqual({ map: 100, device: 200 });
    expect(b.startedAt).toBe(100);
    expect(applyGuideOp(b, { c: 'guide', op: 'done', id: 'map' }, 300)).toBeNull();
  });
  it('refuses unknown ids', () => {
    expect(applyGuideOp(g, { c: 'guide', op: 'done', id: 'teleport' as never }, 1)).toBeNull();
    expect(applyGuideOp(g, { c: 'guide', op: 'hint', id: 'nope' as never }, 1)).toBeNull();
    expect(applyGuideOp(g, { c: 'guide', op: 'used', id: 'door' as never }, 1)).toBeNull();
  });
  it('records hints and used props once', () => {
    const h = applyGuideOp(g, { c: 'guide', op: 'hint', id: 'lowLife' }, 1)!;
    expect(h.hints).toEqual(['lowLife']);
    expect(applyGuideOp(h, { c: 'guide', op: 'hint', id: 'lowLife' }, 2)).toBeNull();
    const u = applyGuideOp(g, { c: 'guide', op: 'used', id: 'anvil' }, 1)!;
    expect(u.used).toEqual(['anvil']);
  });
  it('skip sets skipped by the player, finish sets done, both once', () => {
    const s = applyGuideOp(g, { c: 'guide', op: 'skip' }, 50)!;
    expect(s).toMatchObject({ mode: 'skipped', skippedBy: 'player', finishedAt: 50 });
    expect(applyGuideOp(s, { c: 'guide', op: 'skip' }, 60)).toBeNull();
    expect(applyGuideOp(g, { c: 'guide', op: 'finish' }, 70)).toMatchObject({ mode: 'done', finishedAt: 70 });
    expect(applyGuideOp(s, { c: 'guide', op: 'finish' }, 70)).toBeNull();
  });
  it('replay clears steps and hints, goes active and counts', () => {
    const played = { ...applyGuideOp(applyGuideOp(g, { c: 'guide', op: 'done', id: 'device' }, 1)!, { c: 'guide', op: 'skip' }, 2)!, hints: ['lowLife' as const], warmed: true as const };
    const r = applyGuideOp(played, { c: 'guide', op: 'replay' }, 9)!;
    expect(r).toMatchObject({ mode: 'active', done: [], hints: [], startedAt: 9, replays: 1, warmed: true });
    expect(r).not.toHaveProperty('skippedBy');
    expect(r).not.toHaveProperty('finishedAt');
    expect(applyGuideOp(r, { c: 'guide', op: 'replay' }, 10)!.replays).toBe(2);
  });
  it('knows every step id', () => {
    let cur = g;
    for (const id of GUIDE_STEP_IDS) cur = applyGuideOp(cur, { c: 'guide', op: 'done', id }, 1)!;
    expect(cur.done).toEqual([...GUIDE_STEP_IDS]);
  });
});

describe('refillBelt', () => {
  it('tops every assigned slot up to its capacity and counts the charges added', () => {
    const ch = rules.createCharacter('Flaskie', 3);
    const emptied = { ...ch, belt: ch.belt.map((s) => (s ? { ...s, count: 0 } : s)) };
    const r = refillBelt(emptied)!;
    expect(r.charges).toBeGreaterThan(0);
    for (const slot of r.character.belt) if (slot) expect(slot.count).toBe(5);
    expect(r.character.belt.map((s) => !!s)).toEqual(ch.belt.map((s) => !!s));
  });
  it('is null when nothing is missing', () => {
    const ch = rules.createCharacter('Flaskie', 3);
    const full = { ...ch, belt: ch.belt.map((s) => (s ? { ...s, count: 5 } : s)) };
    expect(refillBelt(full)).toBeNull();
  });
});
