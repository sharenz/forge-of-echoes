// The per-frame event budget: after a stall, the presenter gets a bounded frame's worth of events, never losing the
// local player's own feedback or run-state events.
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/contracts/sim';
import { capEvents } from '../../src/client/event-budget';

const hit = (playerId: number, amount: number): SimEvent => ({
  t: 'hit', playerId, x: 0, y: 0, amount, damageType: 'fire', crit: false, target: 'monster', killed: false,
});

describe('capEvents', () => {
  it('leaves a normal frame untouched', () => {
    const events = [hit(2, 1), hit(2, 2)];
    expect(capEvents(events, 400, 1)).toEqual([hit(2, 1), hit(2, 2)]);
  });

  it('keeps the newest cosmetic events and every pinned one, in order', () => {
    const events: SimEvent[] = [
      hit(2, 1),
      { t: 'cast', playerId: 1, skill: 'emberLance', x: 0, y: 0, dirX: 1, dirY: 0 }, // local player: pinned
      hit(2, 2),
      { t: 'waveStart', wave: 3 }, // run state: pinned
      hit(2, 3),
      hit(2, 4),
    ];
    capEvents(events, 4, 1);
    expect(events.map((e) => (e.t === 'hit' ? `hit${e.amount}` : e.t))).toEqual(['cast', 'waveStart', 'hit3', 'hit4']);
  });

  it('keeps pinned events even when they alone exceed the budget', () => {
    const events: SimEvent[] = [hit(2, 1), { t: 'waveStart', wave: 1 }, { t: 'waveStart', wave: 2 }];
    capEvents(events, 1, 1);
    expect(events.map((e) => e.t)).toEqual(['waveStart', 'waveStart']);
  });
});
