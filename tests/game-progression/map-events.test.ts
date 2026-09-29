import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { rules, redactSetupForClient } from '../../src/game';
import { mapEventOdds, rollMapEvent } from '../../src/game/progression/map-events';
import { restoreRunSetup } from '../../src/game/progression/runs';
import { bareCharacter, expectOk, kill, map, setupFor } from './fixtures';

describe('map event creation and rewards', () => {
  it('uses one hidden, deterministic roll with 25% base odds, independently of gear', () => {
    const item = map();
    expect(mapEventOdds(item)).toEqual({ hunted: 0.125, echoRift: 0.125 });
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
