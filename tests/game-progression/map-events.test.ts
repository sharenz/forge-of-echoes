import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { rules, redactSetupForClient } from '../../src/game';
import { mapEventOdds, normalizeMapEvent, rollMapEvent } from '../../src/game/progression/map-events';
import { MAP_EVENT_KINDS } from '../../src/contracts/map-events';
import { MAP_EVENT_MIN_TIER } from '../../src/data/progression/map-events';
import { restoreRunSetup } from '../../src/game/progression/runs';
import { bareCharacter, expectOk, kill, map, setupFor } from './fixtures';

describe('map event creation and rewards', () => {
  it('gates new encounters by tier, reproduces displayed odds and persists their hidden plans', () => {
    for (const tier of [1, 3, 5]) {
      const item = map('ashenForge', tier), odds = mapEventOdds(item);
      const seen: Record<string, number> = {};
      for (let seed = 0; seed < 5000; seed++) {
        const event = rollMapEvent(item, seed);
        if (!event) continue;
        expect(event.wave === 6).toBe(event.kind === 'secondCrown');
        expect(normalizeMapEvent(JSON.parse(JSON.stringify(event)))).toEqual(event);
        expect(tier).toBeGreaterThanOrEqual(MAP_EVENT_MIN_TIER[event.kind]);
        seen[event.kind] = (seen[event.kind] ?? 0) + 1;
      }
      for (const kind of MAP_EVENT_KINDS) expect(Math.abs((seen[kind] ?? 0) / 5000 - odds[kind])).toBeLessThan(0.02);
    }
    expect(normalizeMapEvent({ kind: 'secondCrown', wave: 2, angle: 0 })).toBeNull();
    expect(normalizeMapEvent({ kind: 'wound', wave: 6, angle: 0 })).toBeNull();
  });

  it('gives the new event materials only to their specified encounters and never below their tier gates', () => {
    for (const [kind, currencyId, tier, chance] of [
      ['vaultbreakers', 'twinInk', 3, 0.2], ['wound', 'voidSplinter', 3, 1], ['secondCrown', 'crownFragment', 5, 1],
    ] as const) {
      const rng = createRng(946), setup = setupFor(map('ashenForge', tier)), low = setupFor(map('ashenForge', tier - 1));
      let found = 0;
      for (let i = 0; i < 800; i++) {
        const drops = rules.rollKillLoot(setup, kill({ eventReward: kind }), rng, bareCharacter());
        found += drops.filter(d => d.kind === 'currency' && d.currencyId === currencyId).length;
        if (i < 40) {
          const lowDrops = rules.rollKillLoot(low, kill({ eventReward: kind }), rng, bareCharacter());
          expect(lowDrops.some(d => d.kind === 'currency' && d.currencyId === currencyId)).toBe(false);
        }
      }
      expect(Math.abs(found / 800 - chance)).toBeLessThan(0.055);
    }
    const dark = rules.rollKillLoot(setupFor(map('ashenForge', 3)), kill({ eventReward: 'blackout' }), createRng(9), bareCharacter());
    expect(dark).toEqual(expect.arrayContaining([expect.objectContaining({ currencyId: 'seal', count: 1 }),
      expect.objectContaining({ currencyId: 'scrap', count: expect.any(Number) })]));
  });

  it('uses one hidden, deterministic roll with 25% base odds, independently of gear', () => {
    const item = map();
    expect(mapEventOdds(item)).toEqual({ hunted: 0.125, echoRift: 0.125, blackout: 0, vaultbreakers: 0, secondCrown: 0, wound: 0 });
    let count = 0;
    const kinds = new Set();
    for (let seed = 0; seed < 2000; seed++) {
      const event = rollMapEvent(item, seed);
      expect(event).toEqual(rollMapEvent(item, seed));
      if (event) { count++; kinds.add(event.kind); expect([2, 4]).toContain(event.wave); }
    }
    expect(count).toBeGreaterThan(430); expect(count).toBeLessThan(570);
    expect(kinds.size).toBe(2);
  });

  it('area and map modifiers favour specific events without changing loot luck', () => {
    const item = map('ashenForge', 1, { mods: [{ modId: 'commanded', value: 1 }, { modId: 'echo', value: 1 }] });
    const odds = mapEventOdds(item, 'ironMarch');
    expect(odds.hunted).toBeCloseTo(0.305); expect(odds.echoRift).toBeCloseTo(0.225);
    expect(mapEventOdds(map(), 'boneApproach').echoRift).toBeCloseTo(0.225);
  });

  it('persists the creation decision, redacts even zero-seed plans and leaves old maps alone', () => {
    const ch = bareCharacter({ mapDevice: map() });
    const setup = expectOk(rules.openMap(ch)).setup;
    const event = { kind: 'echoRift' as const, wave: 4, angle: 1.5 };
    const forced = { ...setup, event };
    expect(restoreRunSetup(JSON.stringify(forced), setup.seed)?.event).toEqual(event);
    expect(redactSetupForClient({ ...forced, seed: 0 })).not.toHaveProperty('event');
    expect(redactSetupForClient(forced)).not.toHaveProperty('event');
    const { event: _event, ...legacy } = setup;
    expect(restoreRunSetup(legacy, setup.seed)).not.toHaveProperty('event');
    expect(restoreRunSetup({ ...setup, event: { ...event, wave: 99 } }, setup.seed)?.event).toBeNull();
  });

  it('guarantees a rare for the hunter and crafting materials for the rift, on top of ordinary loot', () => {
    const setup = setupFor(map());
    for (let seed = 0; seed < 30; seed++) {
      const normal = rules.rollKillLoot(setup, kill({ rarity: 'rare' }), createRng(seed), bareCharacter());
      const hunted = rules.rollKillLoot(setup, kill({ rarity: 'rare', eventReward: 'hunted' }), createRng(seed), bareCharacter());
      expect(hunted.slice(0, normal.length)).toEqual(normal);
      expect(hunted.at(-1)).toMatchObject({ kind: 'equipment', rarity: 'rare', itemLevel: 4 });
      const rift = rules.rollKillLoot(setup, kill({ eventReward: 'echoRift' }), createRng(seed), bareCharacter());
      expect(rift.slice(-2)).toMatchObject([{ kind: 'currency', currencyId: 'reforge', count: 1 }, { kind: 'currency', currencyId: 'mapDust', count: 1 }]);
    }
  });
});
