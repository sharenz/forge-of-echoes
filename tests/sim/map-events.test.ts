import { describe, expect, it } from 'vitest';
import type { MapEventKind } from '../../src/contracts/map-events';
import { killMonster, DT_FIRE } from '../../src/sim/combat';
import { updateMapEvent } from '../../src/sim/map-events';
import { driveEventMonster } from '../../src/sim/map-events';
import { startBoss, bossRuntime, driveBoss } from '../../src/sim/bosses';
import { monsterDef } from '../../src/sim/rosters';
import { spawnMonster } from '../../src/sim/spawn';
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

describe('expanded map encounters', () => {
  it('keeps all three required rifts available after the boss falls and clears only after the final rift', () => {
    const { world: w, event, log } = encounter('echoRift');
    event.plan.required = true;
    event.plan.next = { kind: 'echoRift', wave: 3, angle: 1, required: true,
      next: { kind: 'echoRift', wave: 4, angle: 2, required: true } };
    w.director.wave = 6; w.director.bossDefeated = true;
    for (let rift = 0; rift < 3; rift++) {
      updateMapEvent(w);
      expect(event.view?.phase).toBe('available');
      updateDirector(w); expect(w.director.cleared).toBe(false);
      w.players[0].x = event.view!.x; w.players[0].y = event.view!.y;
      tick(w);
      for (let pulse = 0; pulse < 3; pulse++) { slay(w); if (pulse < 2) tick(w, 121); }
      expect(event.view?.phase).toBe('complete');
      updateDirector(w);
      expect(w.director.cleared).toBe(rift === 2);
      if (rift < 2) tick(w, 301);
    }
    expect(log.killRolls.filter(r => r.ctx.eventReward === 'echoRift')).toHaveLength(3);
    expect(log.killRolls).toHaveLength(27);
  });

  it('does not award the first boss while a Bounty hunter precedes its required twin', () => {
    const { world: w, event, run } = encounter('hunted');
    event.plan.required = true;
    event.plan.next = { kind: 'secondCrown', wave: 6, angle: 1, required: true };
    w.director.wave = 6;
    const original = spawnMonster(w, 'cinderMatriarch', 180, 0, { boss: true, animate: false });
    w.director.bossId = w.monsters.id[original];
    killMonster(w, original, DT_FIRE, true, 1);
    expect(w.director.bossDefeated).toBe(false);
    expect(run.drainOutcomes().filter(o => o.t === 'bossDefeated')).toHaveLength(0);
    tick(w); slay(w); tick(w, 301); tick(w);
    expect(event.plan.kind).toBe('secondCrown');
    expect(event.members.size).toBe(1);
    slay(w);
    expect(w.director.bossDefeated).toBe(true);
    expect(run.drainOutcomes().filter(o => o.t === 'bossDefeated')).toHaveLength(1);
  });

  it('empowers only boss monsters and completes a bossless final wave normally', () => {
    const { world: normal } = encounter('hunted'), { world: harder } = encounter('hunted');
    harder.config.bossLifeMultiplier = 1.5; harder.config.bossDamageMultiplier = 1.25;
    for (const boss of [false, true]) {
      const a = spawnMonster(normal, 'varkus', 180, 0, { boss, wave: 6 });
      const b = spawnMonster(harder, 'varkus', 180, 0, { boss, wave: 6 });
      expect(harder.monsters.maxLife[b]).toBeCloseTo(normal.monsters.maxLife[a] * (boss ? 1.5 : 1));
      expect(harder.monsters.damage[b]).toBeCloseTo(normal.monsters.damage[a] * (boss ? 1.25 : 1));
    }
    const { run, world: w } = createRunInternal(makeConfig({ waves: { count: 6, bossWave: 0 } }));
    run.addPlayer(makeJoin(1));
    w.director.intro = 0; w.director.wave = 6;
    updateDirector(w);
    expect(w.director.cleared).toBe(true);
    expect(run.drainOutcomes().filter(o => o.t === 'cleared')).toHaveLength(1);
    expect(w.props.some(p => p.kind === 'chest')).toBe(true);
  });

  it('Blackout moves between three guarded beacons and pays only after the last guard', () => {
    const { world: w, event, log } = encounter('blackout');
    updateMapEvent(w);
    const sites = new Set<string>();
    for (let wave = 0; wave < 3; wave++) {
      expect(event.view?.phase).toBe('available');
      sites.add(`${event.view!.x},${event.view!.y}`);
      w.players[0].x = event.view!.x; w.players[0].y = event.view!.y;
      tick(w);
      expect(event.members.size).toBe(3);
      slay(w);
      expect(log.killRolls.filter(r => r.ctx.eventReward)).toHaveLength(wave === 2 ? 1 : 0);
    }
    expect(sites.size).toBe(3);
    expect(log.killRolls.at(-1)?.ctx.eventReward).toBe('blackout');
    expect(event.view).toMatchObject({ phase: 'complete', remaining: 0 });
  });

  it('Wound is optional, warns before eruptions, and makes its last pack harder', () => {
    const { world: w, event, log } = encounter('wound');
    updateMapEvent(w);
    expect(event.view?.phase).toBe('available');
    expect(w.areas).toHaveLength(0);
    w.players[0].x = event.view!.x; w.players[0].y = event.view!.y;
    tick(w);
    for (let pulse = 0; pulse < 3; pulse++) {
      const rare = [...event.members].filter(id => w.monsters.rarity[w.monsters.slotOf(id)] === 2);
      expect(rare.length).toBe(pulse === 2 ? 1 : 0);
      expect(w.areas.filter(a => a.kind === 'eruptionWarning')).toHaveLength((pulse + 1) * 2);
      expect(w.areas.every(a => a.duration >= 1.5)).toBe(true);
      slay(w);
      if (pulse < 2) tick(w, 121);
    }
    expect(log.killRolls.filter(r => r.ctx.eventReward === 'wound')).toHaveLength(1);
  });

  it('Vaultbreakers flee, pay once per kill, and escape without XP or loot when time expires', () => {
    const { world: w, event, log, run } = encounter('vaultbreakers');
    tick(w);
    expect(event.members.size).toBe(3);
    const first = w.monsters.slotOf([...event.members][0]);
    const dx = w.monsters.x[first] - w.players[0].x, dy = w.monsters.y[first] - w.players[0].y;
    expect(driveEventMonster(w, first, w.players[0])).toBe(true);
    expect(w.monsters.vx[first] * dx + w.monsters.vy[first] * dy).toBeGreaterThan(0);
    killMonster(w, first, DT_FIRE, true, 1);
    killMonster(w, first, DT_FIRE, true, 1);
    expect(log.killRolls.filter(r => r.ctx.eventReward === 'vaultbreakers')).toHaveLength(1);
    expect(event.view?.remaining).toBe(2);
    const before = event.deadline, living = w.living;
    w.living = []; tick(w, 120); expect(event.deadline).toBe(before); w.living = living;
    run.drainOutcomes();
    tick(w, 2401);
    expect(event.view).toMatchObject({ phase: 'failed', remaining: 2, seconds: 0 });
    expect(event.members.size).toBe(0); expect(w.monsters.count).toBe(0);
    expect(log.killRolls).toHaveLength(1);
    expect(run.drainOutcomes()).toEqual([]);
    expect(w.packs.every(p => !p.active)).toBe(true);
  });

  it('Second Crown keeps all three scripted bosses independent and grants one completion after both deaths', () => {
    for (const kind of ['cinderMatriarch', 'hollowWarden', 'varkus'] as const) {
      const { world: w, event, log, run } = encounter('secondCrown');
      const original = spawnMonster(w, kind, 180, 0, { boss: true, animate: false });
      startBoss(w, original, monsterDef(kind));
      w.director.bossId = w.monsters.id[original];
      // Match the area's roster to the hand-placed primary for this probe.
      Object.assign(w, { roster: { ...w.roster, boss: kind } });
      tick(w);
      expect(event.members.size).toBe(2);
      const twin = w.monsters.slotOf([...event.members].find(id => id !== w.monsters.id[original])!);
      expect(bossRuntime(w, original)).not.toBe(bossRuntime(w, twin));
      expect(bossRuntime(w, original).state).not.toBe(bossRuntime(w, twin).state);
      w.monsters.life[original] = w.monsters.maxLife[original] * 0.5;
      driveBoss(w, original, monsterDef(kind), w.players[0], -180, 0, 180, true);
      expect(bossRuntime(w, original).phase).toBe(2);
      expect(bossRuntime(w, twin).phase).toBe(1);
      killMonster(w, original, DT_FIRE, true, 1);
      expect(w.director.bossDefeated).toBe(false);
      expect(w.director.bossId).toBe(w.monsters.id[twin]);
      expect(run.drainOutcomes().filter(o => o.t === 'bossDefeated')).toHaveLength(0);
      killMonster(w, twin, DT_FIRE, true, 1);
      expect(w.director.bossDefeated).toBe(true);
      expect(w.bossStates.size).toBe(0);
      expect(run.drainOutcomes().filter(o => o.t === 'bossDefeated')).toHaveLength(1);
      expect(log.killRolls.filter(r => r.ctx.eventReward === 'secondCrown')).toHaveLength(1);
    }
  });

  it('killing the first boss before its twin is revealed never skips the encounter', () => {
    const { world: w, event, log, run } = encounter('secondCrown');
    const original = spawnMonster(w, 'cinderMatriarch', 180, 0, { boss: true, animate: false });
    w.director.bossId = w.monsters.id[original];
    killMonster(w, original, DT_FIRE, true, 1);
    expect(w.director.bossDefeated).toBe(false);
    expect(run.drainOutcomes().filter(o => o.t === 'bossDefeated')).toHaveLength(0);
    tick(w);
    expect(event.members.size).toBe(1);
    expect(event.view?.remaining).toBe(1);
    slay(w);
    expect(w.director.bossDefeated).toBe(true);
    expect(log.killRolls.filter(r => r.ctx.eventReward === 'secondCrown')).toHaveLength(1);
  });
});
