// Hint triggers (src/ui/guide/hints.ts): each fires from its snapshot, once per account, with the courtesy rules.
import { describe, expect, it } from 'vitest';
import { GUIDE_HINT_IDS, type GuideHintId } from '../../src/contracts/guide';
import { HINT_GAP_MS, HINT_ORDER, HINT_POINTS, POST_ENTRY_QUIET_MS, dropSignal, hintCandidates, pickHint, type HintContext, type HintSnapshot } from '../../src/ui/guide/hints';

const calm: HintSnapshot = {
  zone: 'map', dead: false, life: 100, maxLife: 100, focus: 100, maxFocus: 100, needsFocus: false,
  flasks: [{ resource: 'life', count: 3 }, { resource: 'life', count: 3 }, { resource: 'focus', count: 3 }, null],
  leveledUp: false, unspent: { attribute: 0, skill: 0, atlas: 0 }, deaths: 0, debuffs: 0, events: 0,
  panels: { bench: false, merchant: false, stash: false }, itemsCrafted: 0, mapsCompleted: 0,
  seen: { gear: false, rare: false, noFocus: false, bossPhase: false },
};
const snap = (o: Partial<HintSnapshot>): HintSnapshot => ({ ...calm, ...o });
const ctx = (o: Partial<HintContext> = {}): HintContext => ({
  now: 100_000, mode: 'active', tipsOn: true, shown: [], lastShownAt: -Infinity, enteredMapAt: 0, blocked: false, ...o,
});

describe('hintCandidates', () => {
  it('a calm snapshot asks for nothing', () => {
    expect(hintCandidates(calm).size).toBe(0);
  });
  it('low life with a Life flask available', () => {
    expect(hintCandidates(snap({ life: 30 })).has('lowLife')).toBe(true);
    expect(hintCandidates(snap({ life: 30, flasks: [{ resource: 'life', count: 0 }, null, null, null] })).has('lowLife')).toBe(false);
    expect(hintCandidates(snap({ life: 0 })).has('lowLife')).toBe(false);
    expect(hintCandidates(snap({ life: 30, zone: 'hideout' })).has('lowLife')).toBe(false);
  });
  it('an empty Life flask in a map', () => {
    expect(hintCandidates(snap({ flasks: [{ resource: 'life', count: 0 }, null, null, null] })).has('flasksEmpty')).toBe(true);
    expect(hintCandidates(snap({ flasks: [{ resource: 'focus', count: 0 }, null, null, null] })).has('flasksEmpty')).toBe(false);
  });
  it('empty Focus: a failed cast, or a drained globe with a Focus skill on the bar', () => {
    expect(hintCandidates(snap({ seen: { ...calm.seen, noFocus: true } })).has('focusEmpty')).toBe(true);
    expect(hintCandidates(snap({ focus: 0, needsFocus: true })).has('focusEmpty')).toBe(true);
    expect(hintCandidates(snap({ focus: 0, needsFocus: false })).has('focusEmpty')).toBe(false);
  });
  it('level up needs points to spend', () => {
    expect(hintCandidates(snap({ leveledUp: true, unspent: { attribute: 3, skill: 1, atlas: 0 } })).has('levelUp')).toBe(true);
    expect(hintCandidates(snap({ leveledUp: true })).has('levelUp')).toBe(false);
  });
  it('first loot and first rare come from the latched drop signals', () => {
    expect(dropSignal('magic')).toEqual({ gear: true, rare: false });
    expect(dropSignal('rare')).toEqual({ gear: true, rare: true });
    expect(dropSignal('currency')).toEqual({ gear: false, rare: false });
    const c = hintCandidates(snap({ seen: { ...calm.seen, gear: true, rare: true } }));
    expect(c.has('firstLoot') && c.has('firstRare')).toBe(true);
  });
  it('death hints wait until you are home and alive', () => {
    expect(hintCandidates(snap({ deaths: 1, dead: true, zone: 'map' })).size).toBe(0);
    expect(hintCandidates(snap({ deaths: 1, zone: 'hideout' })).has('firstDeath')).toBe(true);
    const two = hintCandidates(snap({ deaths: 2, zone: 'hideout' }));
    expect(two.has('secondDeath')).toBe(true);
  });
  it('debuff, event, boss phase, panels, craft, atlas point, first clear', () => {
    expect(hintCandidates(snap({ debuffs: 1 })).has('firstDebuff')).toBe(true);
    expect(hintCandidates(snap({ events: 1 })).has('firstEvent')).toBe(true);
    expect(hintCandidates(snap({ seen: { ...calm.seen, bossPhase: true } })).has('firstBossPhase')).toBe(true);
    const panels = hintCandidates(snap({ zone: 'hideout', panels: { bench: true, merchant: true, stash: true } }));
    expect(['firstBench', 'firstMerchant', 'firstStash'].every((id) => panels.has(id as GuideHintId))).toBe(true);
    expect(hintCandidates(snap({ itemsCrafted: 1 })).has('firstCraft')).toBe(true);
    expect(hintCandidates(snap({ zone: 'hideout', unspent: { attribute: 0, skill: 0, atlas: 1 } })).has('firstAtlasPoint')).toBe(true);
    expect(hintCandidates(snap({ zone: 'hideout', mapsCompleted: 1 })).has('firstMapClear')).toBe(true);
  });
});

describe('pickHint', () => {
  const all = new Set<GuideHintId>(GUIDE_HINT_IDS);
  it('orders by priority and fires each hint once', () => {
    expect(pickHint(all, ctx())).toBe('lowLife');
    expect(pickHint(all, ctx({ shown: ['lowLife'] }))).toBe('flasksEmpty');
    expect(pickHint(all, ctx({ shown: [...GUIDE_HINT_IDS] }))).toBeNull();
  });
  it('every hint id has a priority and a pointer entry', () => {
    expect([...HINT_ORDER].sort()).toEqual([...GUIDE_HINT_IDS].sort());
    for (const id of GUIDE_HINT_IDS) expect(id in HINT_POINTS).toBe(true);
  });
  it('keeps a gap between cards', () => {
    expect(pickHint(all, ctx({ lastShownAt: 100_000 - HINT_GAP_MS + 1 }))).toBeNull();
    expect(pickHint(all, ctx({ lastShownAt: 100_000 - HINT_GAP_MS }))).not.toBeNull();
  });
  it('is quiet right after entering a map', () => {
    expect(pickHint(all, ctx({ enteredMapAt: 100_000 - POST_ENTRY_QUIET_MS + 1 }))).toBeNull();
    expect(pickHint(all, ctx({ enteredMapAt: 100_000 - POST_ENTRY_QUIET_MS }))).not.toBeNull();
  });
  it('never while a modal, the death overlay or the summary is up', () => {
    expect(pickHint(all, ctx({ blocked: true }))).toBeNull();
  });
  it('never for a skipped guide (a veteran, or a player who said no), nor with tips off; a finished tutorial still gets them', () => {
    expect(pickHint(all, ctx({ mode: 'skipped' }))).toBeNull();
    expect(pickHint(all, ctx({ mode: 'done' }))).not.toBeNull();
    expect(pickHint(all, ctx({ tipsOn: false }))).toBeNull();
  });
});
