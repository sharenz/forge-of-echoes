import { describe, expect, it } from 'vitest';
import { ANVIL_CHARGE } from '../../src/data/progression/events/anvil';
import { eventRun, revealed, slay, step, until } from './helpers';
import { ITEM_CLASSES } from '../../src/contracts/content';
import { anvilGrade, anvilNeed, boonOfStone } from '../../src/sim/events/anvil';
import { rollChestLoot } from '../../src/sim/hooks';
import { spawnMonster } from '../../src/sim/spawn';
import type { MonsterRarity } from '../../src/contracts/sim';
import type { World } from '../../src/sim/world';
import type { EventInstance } from '../../src/sim/events/types';

type AnvilS = { site: { x: number; y: number }; charge: number; need: number; t: number; stage: string; stones: { x: number; y: number; n: number; state: number }[]; offered: string[]; taken: string[]; grade: number };
const S = (e: EventInstance) => e.s as AnvilS;

function killAt(w: World, x: number, y: number, rarity: MonsterRarity = 'normal'): void {
  const i = spawnMonster(w, w.roster.family[0], x, y, { rarity, animate: false });
  slay(w, w.monsters.id[i]);
}

/** Reveal the anvil and run the warning out. */
function active(o: Parameters<typeof eventRun>[1] = {}) {
  const r = eventRun('anvil', { vulnerable: true, ...o });
  const e = revealed(r.w, 'anvil');
  step(r.w, 3.1);
  expect(e.phase).toBe('active');
  return { ...r, e };
}

function charge(w: World, e: EventInstance): void {
  const s = S(e);
  while (s.stage === 'charge') killAt(w, s.site.x + 20, s.site.y);
}

function standOn(w: World, stone: { x: number; y: number }, playerIndex = 0): void {
  w.players[playerIndex].x = stone.x; w.players[playerIndex].y = stone.y;
}

describe('Wayside Anvil', () => {
  it('rings an omen, stands far from the players and warms for three seconds', () => {
    const { w } = eventRun('anvil');
    const e = revealed(w, 'anvil');
    expect(e.phase).toBe('warning');
    expect(Math.hypot(S(e).site.x - w.players[0].x, S(e).site.y - w.players[0].y)).toBeGreaterThanOrEqual(200);
    expect(e.view.zones[0]).toMatchObject({ kind: 'altar', r: 260 });
    expect(e.view.markers[0].icon).toBe('anvil');
    step(w, 3.1);
    expect(e.phase).toBe('active');
  });

  it('counts kills within 260 u by weight (magic 2, rare 3) and ignores far kills', () => {
    const { w, e } = active();
    const s = S(e);
    killAt(w, s.site.x + 100, s.site.y);
    expect(s.charge).toBe(1);
    killAt(w, s.site.x, s.site.y + 100, 'magic');
    expect(s.charge).toBe(3);
    killAt(w, s.site.x - 100, s.site.y, 'rare');
    expect(s.charge).toBe(6);
    killAt(w, s.site.x + 400, s.site.y + 300);
    expect(s.charge).toBe(6);
    step(w, 0.05);
    expect(e.view.objectives[0]).toMatchObject({ id: 0, cur: 6, max: ANVIL_CHARGE });
    expect(e.view.timers[0]).toMatchObject({ id: 0, total: 54 });
  });

  it('a full charge opens three boon stones; a choice forges it into the boons and grades Bronze when late', () => {
    const { w, e, log } = active();
    const s = S(e);
    step(w, 100);
    charge(w, e);
    expect(s.stage).toBe('pick');
    expect(s.stones).toHaveLength(3);
    expect(new Set(s.offered).size).toBe(3);
    step(w, 0.05);
    expect(e.view.zones.filter(z => z.kind === 'stone')).toHaveLength(3);
    standOn(w, s.stones[0]);
    step(w, 0.5);
    expect(e.phase).toBe('active');
    step(w, 0.7);
    expect(e.phase).toBe('complete');
    expect(e.grade).toBe(1);
    expect(w.mapEvent!.boons).not.toBeNull();
    expect(log.eventRolls[0].ctx).toMatchObject({ kind: 'anvil', grade: 1, choice: 1 });
  });

  it('charged within 54 s is Gold: a second round offers different boons and pays after both', () => {
    const { w, e, log } = active();
    const s = S(e);
    step(w, 10);
    charge(w, e);
    expect(s.grade).toBe(3);
    const first = s.offered[0];
    standOn(w, s.stones[0]);
    step(w, 1.2);
    expect(e.phase).toBe('active');
    expect(s.taken).toEqual([first]);
    expect(s.stage).toBe('pick');
    expect(s.offered).not.toContain(first);
    standOn(w, s.stones[0]);
    step(w, 1.2);
    expect(e.phase).toBe('complete');
    expect(e.grade).toBe(3);
    expect(s.taken).toHaveLength(2);
    expect(log.eventRolls).toHaveLength(1);
    expect(log.eventRolls[0].ctx).toMatchObject({ grade: 3, choice: 2 });
  });

  it('grades by charge time: <= 54 s Gold, <= 90 s Silver, later Bronze (thresholds stretch with timers)', () => {
    expect(anvilGrade(54)).toBe(3);
    expect(anvilGrade(55)).toBe(2);
    expect(anvilGrade(90)).toBe(2);
    expect(anvilGrade(91)).toBe(1);
    expect(anvilGrade(70, 1.4)).toBe(3);
  });

  it('the most-occupied stone wins in a party; ties go to the longest dwell', () => {
    const { w, e } = active({ players: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 20 }] });
    const s = S(e);
    charge(w, e);
    const second = s.offered[1];
    standOn(w, s.stones[0], 0);
    standOn(w, s.stones[1], 1);
    standOn(w, s.stones[1], 2);
    step(w, 1.2);
    expect(s.taken[0]).toBe(second);
  });

  it('merges every boon into the chest: Tempered +1 Stability, Keen, Recast, Attuned class', () => {
    const { w, e } = active();
    const s = S(e);
    step(w, 5);
    charge(w, e);
    const seen: Record<string, number> = {};
    for (let round = 0; round < 2; round++) {
      const boon = s.offered[0];
      const stone = s.stones[0];
      const b = boonOfStone(stone.n);
      expect(b.boon).toBe(boon);
      if (boon === 'attuned') expect(ITEM_CLASSES as readonly string[]).toContain(b.itemClass);
      seen[boon] = 1;
      standOn(w, stone);
      step(w, 1.2);
    }
    const boons = w.mapEvent!.boons!;
    expect(boons.stability + (boons.keen ? 1 : 0) + (boons.recast ? 1 : 0) + (boons.itemClass ? 1 : 0)).toBe(2);
  });

  it('reaches the completion chest: rollChestLoot hands the boons to the hook', () => {
    const { w, e } = active();
    const got: unknown[] = [];
    const orig = w.config.hooks.rollChestLoot;
    w.config.hooks.rollChestLoot = (ids, rng, boons) => { got.push(boons); return orig.call(w.config.hooks, ids, rng, boons); };
    rollChestLoot(w, [1]);
    expect(got[0]).toBeUndefined();
    const s = S(e);
    step(w, 5);
    charge(w, e);
    standOn(w, s.stones[0]);
    step(w, 1.2);
    expect(w.mapEvent!.boons).not.toBeNull();
    rollChestLoot(w, [1]);
    expect(got[1]).toBe(w.mapEvent!.boons);
  });

  it('an uncharged anvil goes cold at the boss wave: no boon, grade failed', () => {
    const { w, e, log } = active();
    w.director.wave = w.config.waves.bossWave;
    step(w, 0.1);
    expect(e.phase).toBe('failed');
    expect(w.mapEvent!.boons).toBeNull();
    expect(log.eventRolls).toHaveLength(0);
  });

  it('Anvil Blessing offers one more stone and charging costs 20% more kills', () => {
    const { w, e } = active({ eventModifiers: { anvilBoons: 1, anvilCost: 1.2 } });
    const s = S(e);
    expect(anvilNeed(w)).toBe(Math.round(ANVIL_CHARGE * 1.2));
    expect(s.need).toBe(Math.round(ANVIL_CHARGE * 1.2));
    charge(w, e);
    expect(s.stones).toHaveLength(4);
  });

  it('is deterministic: the same seed offers the same boons and stones', () => {
    const run = () => {
      const { w, e } = active();
      charge(w, e);
      const s = S(e);
      return JSON.stringify({ o: s.offered, n: s.stones.map(z => [Math.round(z.x), Math.round(z.y), z.n]) });
    };
    expect(run()).toBe(run());
  });

  it('nothing is ever hostile and nothing lingers after the event', () => {
    const { w, e } = active();
    const s = S(e);
    charge(w, e);
    standOn(w, s.stones[0]);
    step(w, 1.2);
    standOn(w, s.stones[0]);
    step(w, 1.2);
    expect(e.phase).toBe('complete');
    expect(w.areas.filter(a => a.hurts !== 'none' && !a.dead)).toHaveLength(0);
    step(w, 6);
    expect(w.mapEvent!.live).toHaveLength(0);
    expect(until(w, () => true)).toBe(true);
  });
});
