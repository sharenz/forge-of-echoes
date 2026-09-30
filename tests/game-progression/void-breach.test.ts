// The Voidtouched Atlas keystone seam of the Void Breach: a corrupted map always rolls it (at any tier), other maps never do.
import { describe, expect, it } from 'vitest';
import { MAP_EVENT_KINDS } from '../../src/contracts/map-events';
import type { AtlasRules } from '../../src/game/progression/atlas-rules';
import type { AtlasRule } from '../../src/data/progression/atlas-tree/types';
import { mapEventRules } from '../../src/game/progression/map-event-rules';
import { flattenMapEvents, mapEventOdds, normalizeMapEvent, rollMapEvent } from '../../src/game/progression/map-events';
import { MAP_EVENT_WINDOW } from '../../src/data/progression/map-events';
import { map } from './fixtures';

const atlas = (...list: AtlasRule[]): AtlasRules => ({ nodes: [], modifiers: [], capped: [], bossWave: 0, equipmentNormalOnly: false, currencyWeights: [],
  extraRules: list.map((rule, k) => ({ node: `n${k}`, rule })) });
const keystone: AtlasRule = { id: 'voidBreach', strength: 50, uncorruptedQuantity: -10 };

describe('Void Breach slate', () => {
  it('never joins the ordinary draw: its public odds are zero at every tier', () => {
    for (const tier of [1, 6, 10, 15]) expect(mapEventOdds(map('ashenForge', tier)).voidBreach).toBe(0);
    expect(MAP_EVENT_KINDS).toContain('voidBreach');
  });

  it('a corrupted map with the keystone always rolls a Void Breach, even at tier 1, in its window; an uncorrupted one does not', () => {
    const corrupted = { ...map('ashenForge', 1), corrupted: true };
    const { slate, sim } = mapEventRules(atlas(keystone), corrupted);
    expect(slate.forced).toEqual(['voidBreach']);
    expect(sim.voidStrength).toBe(50);
    for (let seed = 0; seed < 200; seed++) {
      const plan = rollMapEvent(corrupted, seed, undefined, [], slate);
      expect(plan?.kind).toBe('voidBreach');
      expect(plan!.wave).toBeGreaterThanOrEqual(MAP_EVENT_WINDOW.voidBreach[0]);
      expect(plan!.wave).toBeLessThanOrEqual(MAP_EVENT_WINDOW.voidBreach[1]);
      expect(rollMapEvent(corrupted, seed, undefined, [], slate)).toEqual(plan); // deterministic
      expect(normalizeMapEvent(JSON.parse(JSON.stringify(plan)))).toEqual(plan); // survives a restart
    }
    const plain = mapEventRules(atlas(keystone), map('ashenForge', 1));
    expect(plain.slate.forced).toBeUndefined();
    for (let seed = 0; seed < 200; seed++) expect(flattenMapEvents(rollMapEvent(map('ashenForge', 1), seed, undefined, [], plain.slate)).some(p => p.kind === 'voidBreach')).toBe(false);
  });

  it('a forced Void Breach can still draw a second ordinary event on a higher tier', () => {
    const corrupted = { ...map('ashenForge', 8), corrupted: true };
    const { slate } = mapEventRules(atlas(keystone), corrupted);
    let second = 0;
    for (let seed = 0; seed < 400; seed++) {
      const all = flattenMapEvents(rollMapEvent(corrupted, seed, undefined, [], slate));
      expect(all[0].kind).toBe('voidBreach');
      if (all.length > 1) { second++; expect(all[1].kind).not.toBe('voidBreach'); }
    }
    expect(second).toBeGreaterThan(40);
  });
});
