import { describe, expect, it } from 'vitest';
import type { MapEventKind } from '../../src/contracts/map-events';
import { killMonster, DT_FIRE } from '../../src/sim/combat';
import { updateMapEvent } from '../../src/sim/map-events';
import { createRunInternal } from '../../src/sim/run';
import { updateDirector } from '../../src/sim/waves';
import { makeConfig, makeHooks, makeJoin } from './fixtures';

function encounter(kind: MapEventKind) {
  const { hooks, log } = makeHooks();
  const { run, world } = createRunInternal({ ...makeConfig({ hooks }), event: { kind, wave: 2, angle: 0 } });
  run.addPlayer(makeJoin(1)); run.addPlayer(makeJoin(2));
  world.director.intro = 0;
  world.director.wave = 2;
  return { run, world, log, event: world.mapEvent! };
}

function tick(w: ReturnType<typeof encounter>['world'], n = 181) {
  for (let i = 0; i < n; i++) updateMapEvent(w);
}
function slay(w: ReturnType<typeof encounter>['world']) {
  for (const id of [...w.mapEvent!.members]) {
    const slot = w.monsters.slotOf(id);
    killMonster(w, slot, DT_FIRE, true, 1);
    killMonster(w, slot, DT_FIRE, true, 1); // overkill cannot pay twice
  }
}

describe('The Hunted and Echo Rift', () => {
  it('warns before a hunter spawns, holds the next wave and rewards each living party member once', () => {
    const { world: w, event, log } = encounter('hunted');
    expect(event.view).toBeNull();
    updateMapEvent(w);
    expect(event.view?.phase).toBe('warning');
    expect(w.monsters.count).toBe(0);
    w.director.waveTime = 999;
    updateDirector(w);
    expect(w.director.tellWave).toBe(0);
    expect(w.director.waveTime).toBe(999);
    tick(w);
    expect(event.members.size).toBe(1);
    const slot = w.monsters.slotOf([...event.members][0]);
    expect(w.monsters.rarity[slot]).toBe(2);
    expect(w.packs[w.monsters.pack[slot]].aggro).toBe(true);
    slay(w);
    expect(log.killRolls.filter(k => k.ctx.eventReward === 'hunted')).toHaveLength(1);
    expect(log.killRolls.at(-1)?.playerIds).toEqual([1, 2]);
    expect(event.view?.phase).toBe('complete');
    updateDirector(w);
    expect(w.director.tellWave).toBe(3);
    tick(w, 400);
    expect(event.finished).toBe(true); expect(event.view).toBeNull();
  });

  it('lets a rift be ignored; it closes when the boss wave begins', () => {
    const { world: w, event } = encounter('echoRift');
    tick(w, 400);
    expect(event.view?.phase).toBe('available');
    expect(w.monsters.count).toBe(0);
    w.director.waveTime = 999;
    updateDirector(w);
    expect(w.director.tellWave).toBe(3);
    w.director.wave = w.config.waves.bossWave;
    updateMapEvent(w);
    expect(event.view).toBeNull(); expect(event.finished).toBe(true);
  });

  it('releases three finite magic packs only after approach, with one final reward and no respawn', () => {
    const { world: w, event, log } = encounter('echoRift');
    updateMapEvent(w);
    w.players[0].x = event.view!.x; w.players[0].y = event.view!.y;
    tick(w);
    for (let pulse = 0; pulse < 3; pulse++) {
      expect(event.members.size).toBe(3);
      for (const id of event.members) expect(w.monsters.rarity[w.monsters.slotOf(id)]).toBe(1);
      slay(w);
      expect(log.killRolls.filter(k => k.ctx.eventReward)).toHaveLength(pulse === 2 ? 1 : 0);
      if (pulse < 2) tick(w, 121);
    }
    expect(event.view).toMatchObject({ phase: 'complete', remaining: 0 });
    tick(w, 1000);
    expect(w.monsters.count).toBe(0); expect(log.killRolls).toHaveLength(9);
  });

  it('freezes on a party wipe and waits for store capacity instead of losing the encounter', () => {
    const { world: w, event } = encounter('hunted');
    updateMapEvent(w);
    const players = w.living;
    w.living = [];
    const time = event.timer;
    tick(w, 1000); expect(event.timer).toBe(time);
    w.living = players;
    const slots: number[] = [];
    while (w.monsters.count < w.monsters.capacity) slots.push(w.monsters.alloc());
    tick(w); expect(event.pulses).toBe(0);
    w.monsters.release(slots[0]);
    tick(w, 1); expect(event.members.size).toBe(1);
  });

  it('gives a bounded grace period, then resumes wave pressure even if the hunter lives', () => {
    const { world: w, event } = encounter('hunted');
    tick(w, 1210);
    expect(event.view?.phase).toBe('active');
    expect(event.grace).toBe(0);
    w.director.waveTime = 999;
    updateDirector(w);
    expect(w.director.tellWave).toBe(3);
  });

  it('holds a previously queued wave tell only during the grace period', () => {
    const { world: w } = encounter('hunted');
    updateMapEvent(w);
    w.director.tellWave = 3; w.director.tellTimer = 1;
    updateDirector(w);
    expect(w.director.tellTimer).toBe(1);
    tick(w, 1210);
    updateDirector(w);
    expect(w.director.tellTimer).toBeLessThan(1);
  });

  it('replays event spawns and rewards deterministically', () => {
    const a = encounter('echoRift'), b = encounter('echoRift');
    for (const r of [a, b]) {
      updateMapEvent(r.world);
      r.world.players[0].x = r.event.view!.x; r.world.players[0].y = r.event.view!.y;
      tick(r.world);
      slay(r.world); tick(r.world, 121); slay(r.world); tick(r.world, 121); slay(r.world);
    }
    expect(a.run.digest()).toBe(b.run.digest());
    expect(a.log.killRolls).toEqual(b.log.killRolls);
  });

  it('never rewards uncredited map cleanup', () => {
    const { world: w, event, log } = encounter('hunted');
    tick(w);
    killMonster(w, w.monsters.slotOf([...event.members][0]), DT_FIRE, false);
    expect(log.killRolls).toHaveLength(0);
    expect(event.finished).toBe(true);
  });
});
