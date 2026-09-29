// The Hollow Warden (Rimed Ossuary boss, GAME_SPEC §14): three phases; Frost Nova rings, shard volleys and
// Rimeshade summons throughout; Glacial Spikes and the Ice Prison from phase 2; drifting Blizzards in phase 3.
import { describe, expect, it } from 'vitest';
import { PROJECTILE_KINDS, SIM_DT, type SimEvent } from '../../src/contracts/sim';
import { areaAngle } from '../../src/sim/area-geometry';
import { damageMonster } from '../../src/sim/combat';
import { PLAYER_RADIUS } from '../../src/sim/constants';
import { DAMAGE_INDEX } from '../../src/sim/math';
import { WARDEN } from '../../src/sim/rosters/ossuary/tuning';
import type { WardenState } from '../../src/sim/rosters/ossuary/warden';
import { MFLAG, MSTATE } from '../../src/sim/stores';
import type { Area } from '../../src/sim/world';
import { idleIntent } from '../sim/fixtures';
import { joinArena, makeArena, placeMonster, walkIntent, type Arena } from '../sim/helpers';
import { areasOf, attacks, debuffEvents, stepFor, stepUntil, ticks, tough } from './helpers';

const SHARD = PROJECTILE_KINDS.indexOf('frostShard');
const TAU = Math.PI * 2;

/** A Warden 140 units east of an idle player, with `life` (phase thresholds at 66% / 33% of it). */
function warden(life = 10000) {
  const a = makeArena({ stats: tough() });
  const i = placeMonster(a.world, 'hollowWarden', 140, 0, { life, still: false });
  a.world.monsters.attackCd[i] = 0;
  return { a, i, id: a.world.monsters.id[i] };
}

const state = (a: Arena) => a.world.boss.state as WardenState;

/** Drop her to `fraction` of her life and let the roar(s) play out. */
function enterPhase(a: Arena, i: number, fraction: number): SimEvent[] {
  const m = a.world.monsters;
  stepFor(a, SIM_DT); // her script state exists from her first tick
  m.life[i] = m.maxLife[i] * fraction;
  const roars = fraction <= 0.33 ? 2 : 1;
  return stepFor(a, roars * WARDEN.roar + 0.1).events;
}

/** Record every area she makes (first sight) and every event for `seconds`. */
function watch(a: Arena, seconds: number, intent: () => ReturnType<typeof idleIntent> = () => idleIntent()) {
  const seen = new Map<number, { area: Area; t: number }>();
  const events: SimEvent[] = [];
  for (let k = 0; k < ticks(seconds); k++) {
    events.push(...stepFor(a, SIM_DT, intent()).events);
    for (const ar of a.world.areas) if (!seen.has(ar.id)) seen.set(ar.id, { area: ar, t: a.world.time });
  }
  return { areas: [...seen.values()], events };
}

describe('The Hollow Warden: phases', () => {
  it('changes phase at 66% and 33%: each change roars (immune), cancels her telegraphs and is announced', () => {
    const { a, i, id } = warden();
    const m = a.world.monsters;
    // Wait for a telegraph of hers (the first nova), then cross 66%.
    expect(stepUntil(a, 6, () => areasOf(a.world, 'frostNovaWarning', id)[0])).toBeDefined();
    m.life[i] = m.maxLife[i] * 0.6;
    const r = stepFor(a, SIM_DT);
    expect(r.events).toContainEqual({ t: 'bossPhase', phase: 2 });
    expect(m.flags[i] & MFLAG.immune).toBeTruthy();
    expect(areasOf(a.world, 'frostNovaWarning', id)).toEqual([]);
    stepFor(a, WARDEN.roar + 0.05);
    expect(m.flags[i] & MFLAG.immune).toBe(0);
    m.life[i] = m.maxLife[i] * 0.3;
    const r3 = stepFor(a, SIM_DT);
    expect(r3.events).toContainEqual({ t: 'bossPhase', phase: 3 });
    expect(a.world.boss.phase).toBe(3);
  });
});

describe('The Hollow Warden: phase 1', () => {
  it('novas, volleys and summons Rimeshades — no spikes, prisons or storms yet', () => {
    const { a, id } = warden(1e7);
    const pr = a.world.projectiles;
    const novaShards: number[] = [];
    const seen = new Map<number, { area: Area; t: number }>();
    const events: SimEvent[] = [];
    for (let k = 0; k < ticks(16); k++) {
      const ev = stepFor(a, SIM_DT).events;
      events.push(...ev);
      for (const ar of a.world.areas) if (!seen.has(ar.id)) seen.set(ar.id, { area: ar, t: a.world.time });
      if (attacks(ev, 'hollowWarden', 'nova').length > 0) {
        let fresh = 0;
        for (let s = 0; s < pr.hwm; s++) if (pr.alive[s] && pr.kind[s] === SHARD && pr.age[s] <= SIM_DT * 1.5) fresh++;
        novaShards.push(fresh);
      }
    }
    const areas = [...seen.values()];
    const novas = areas.filter((x) => x.area.kind === 'frostNovaWarning' && x.area.owner === id);
    expect(novas.length).toBeGreaterThanOrEqual(2);
    for (const n of novas) {
      expect(n.area.duration).toBeCloseTo(WARDEN.nova.telegraph, 6);
      expect(n.area.radius).toBe(WARDEN.nova.radius[0]);
    }
    // Every burst is the end of a telegraph shown for its whole 1.2 s, and throws a ring of shards.
    expect(novaShards.length).toBeGreaterThanOrEqual(2);
    for (const n of novaShards) expect(n).toBeGreaterThanOrEqual(WARDEN.nova.shards[0]);
    expect(attacks(events, 'hollowWarden', 'orb').length).toBeGreaterThanOrEqual(3);
    expect(attacks(events, 'hollowWarden', 'summon').length).toBeGreaterThanOrEqual(1);
    expect(events.filter((e) => e.t === 'monsterSpawn' && e.kind === 'rimeshade').length).toBeGreaterThanOrEqual(WARDEN.summon.count[0]);
    for (const k of ['glacialSpike', 'icePrison', 'blizzard'] as const) expect(areas.some((x) => x.area.kind === k), k).toBe(false);
    // Frost everywhere: the player was chilled by something of hers, never frozen or rooted.
    expect(debuffEvents(events, 'chilled').length).toBeGreaterThan(0);
    expect(events.some((e) => e.t === 'debuff' && (e.debuff === 'frozen' || e.debuff === 'rooted'))).toBe(false);
  });

  it('the shard ring leaves from her body: a player who stepped out of the disc sees it coming', () => {
    const { a, i, id } = warden(1e7);
    const m = a.world.monsters;
    const pr = a.world.projectiles;
    stepFor(a, SIM_DT); // her script state exists from her first tick
    state(a).volleyCd = 1e9; // just the novas
    state(a).summonCd = 1e9;
    let firstHits = 0;
    for (let n = 0; n < 6; n++) {
      const nova = stepUntil(a, 9, () => areasOf(a.world, 'frostNovaWarning', id)[0]);
      expect(nova, `nova ${n}`).toBeDefined();
      // Out of the disc, 10 units past its edge, somewhere new round her each time; then stand still.
      const ang = n * 1.1;
      a.player.x = nova!.x + Math.cos(ang) * (nova!.radius + 10);
      a.player.y = nova!.y + Math.sin(ang) * (nova!.radius + 10);
      a.player.invulnTime = 0;
      let burst = false;
      let since = 0;
      let hitAt = -1;
      for (let k = 0; k < ticks(WARDEN.nova.telegraph + 1.6) && hitAt < 0; k++) {
        const ev = stepFor(a, SIM_DT).events;
        if (!burst && attacks(ev, 'hollowWarden', 'nova').length > 0) {
          burst = true;
          // Every shard of the ring starts just outside her body, well inside the disc.
          for (let q = 0; q < pr.hwm; q++) {
            if (!pr.alive[q] || pr.kind[q] !== SHARD || pr.age[q] > SIM_DT * 1.5) continue;
            const r = Math.hypot(pr.x[q] - nova!.x, pr.y[q] - nova!.y);
            expect(r).toBeGreaterThan(m.radius[i]);
            expect(r).toBeLessThan(nova!.radius * WARDEN.nova.shardStart + WARDEN.nova.shardSpeed * SIM_DT * 2);
          }
        } else if (burst) since += SIM_DT;
        if (burst && ev.some((e) => e.t === 'hit' && e.target === 'player')) hitAt = since;
      }
      expect(burst).toBe(true);
      // No shard reaches her before she's had over half a second to react.
      if (hitAt >= 0) {
        firstHits++;
        expect(hitAt, `nova ${n}: hit ${hitAt.toFixed(2)} s after the burst`).toBeGreaterThan(0.5);
      }
      state(a).novaCd = 0.5;
    }
    // The ring still threatens whoever stays put (some shards find her; the gaps spare her other times).
    expect(firstHits).toBeGreaterThan(0);
  });

  it('the nova bursts only when its telegraph ends: then it hits and chills everyone inside', () => {
    const { a, id } = warden(1e7);
    a.world.players[0].x = 90; // well inside her nova (she floats about 50 away)
    const nova = stepUntil(a, 8, () => areasOf(a.world, 'frostNovaWarning', id)[0], () => walkIntent(a.player.x, a.player.y, 90, 0));
    expect(nova).toBeDefined();
    // Keep her player inside the disc (out of her lantern's reach).
    const inside = () => walkIntent(a.player.x, a.player.y, nova!.x - 60, nova!.y);
    let burstAt = -1;
    let chillAt = -1;
    const t0 = a.world.time;
    for (let k = 0; k < ticks(WARDEN.nova.telegraph + 0.3); k++) {
      const ev = stepFor(a, SIM_DT, inside()).events;
      if (burstAt < 0 && ev.some((e) => e.t === 'areaResolve' && e.kind === 'frostNovaWarning')) {
        burstAt = a.world.time;
        expect(ev.some((e) => e.t === 'hit' && e.target === 'player' && e.damageType === 'cold')).toBe(true);
      }
      if (chillAt < 0 && debuffEvents(ev, 'chilled').length > 0) chillAt = a.world.time;
    }
    expect(burstAt - t0).toBeGreaterThanOrEqual(WARDEN.nova.telegraph - 2 * SIM_DT);
    expect(chillAt).toBeGreaterThan(0);
  });
});

describe('The Hollow Warden: phase 2', () => {
  it('lines of glacial spikes erupt in sequence toward her player, and an Ice Prison closes around them', () => {
    const { a, i, id } = warden();
    enterPhase(a, i, 0.6);
    expect(a.world.boss.phase).toBe(2);
    const { areas, events } = watch(a, 6);
    const prisons = areas.filter((x) => x.area.kind === 'icePrison');
    expect(prisons.length).toBeGreaterThanOrEqual(1);
    expect(prisons[0].area.target).toBe(1);
    expect(prisons[0].area.duration).toBe(WARDEN.prison.close);
    expect(attacks(events, 'hollowWarden', 'prison').length).toBeGreaterThanOrEqual(1);
    const spikes = areas.filter((x) => x.area.kind === 'glacialSpike' && x.area.owner === id);
    expect(spikes.length).toBeGreaterThanOrEqual(WARDEN.spikes.minCount);
    expect(attacks(events, 'hollowWarden', 'spikes').length).toBeGreaterThanOrEqual(1);
    // One line: the same heading toward where the player stood, erupting outward one after another.
    const line = spikes.filter((x) => x.t === spikes[0].t);
    const ang = areaAngle(line[0].area);
    const m = a.world.monsters;
    for (let k = 1; k < line.length; k++) {
      expect(areaAngle(line[k].area)).toBeCloseTo(ang, 6);
      expect(line[k].area.duration).toBeGreaterThan(line[k - 1].area.duration);
      expect(line[k].area.duration - line[k - 1].area.duration).toBeGreaterThanOrEqual(0.05); // audible one by one
    }
    expect(line[0].area.duration).toBeGreaterThanOrEqual(WARDEN.spikes.first);
    // It reaches past the player.
    const far = line[line.length - 1].area;
    expect(Math.hypot(far.x - m.x[i], far.y - m.y[i])).toBeGreaterThan(Math.hypot(a.player.x - m.x[i], a.player.y - m.y[i]));
  });

  it('the Ice Prison freezes a player still inside when it closes — only then', () => {
    const { a, i } = warden();
    enterPhase(a, i, 0.6);
    const prison = stepUntil(a, 4, () => areasOf(a.world, 'icePrison')[0]);
    expect(prison).toBeDefined();
    const shown = a.world.time;
    state(a).spikesCd = 1e9; // just the prison
    let frozenAt = -1;
    for (let k = 0; k < ticks(WARDEN.prison.close + 0.3) && frozenAt < 0; k++) {
      if (debuffEvents(stepFor(a, SIM_DT).events, 'frozen').length > 0) frozenAt = a.world.time;
    }
    expect(frozenAt, 'never frozen').toBeGreaterThan(0);
    expect(frozenAt - shown).toBeGreaterThanOrEqual(WARDEN.prison.close - 2 * SIM_DT);
  });

  it('walking out of the Ice Prison before it closes breaks it', () => {
    const { a, i } = warden();
    enterPhase(a, i, 0.6);
    const prison = stepUntil(a, 4, () => areasOf(a.world, 'icePrison')[0]);
    expect(prison).toBeDefined();
    state(a).spikesCd = 1e9;
    const r = stepFor(a, WARDEN.prison.close + 0.3, () => walkIntent(a.player.x, a.player.y, a.player.x - 500, a.player.y));
    expect(debuffEvents(r.events, 'frozen')).toEqual([]);
    expect(r.events.some((e) => e.t === 'areaResolve' && e.kind === 'icePrison')).toBe(true);
    expect(areasOf(a.world, 'icePrison')).toEqual([]);
  });

  it('spikes hit hard and chill a player on the line; one who steps off it is untouched', () => {
    const run = (dodge: boolean) => {
      const { a, i } = warden();
      enterPhase(a, i, 0.6);
      state(a).prisonCd = 1e9; // just the spikes (and the volleys)
      state(a).novaCd = 1e9;
      state(a).summonCd = 1e9;
      const line = stepUntil(a, 6, () => areasOf(a.world, 'glacialSpike')[0]);
      expect(line).toBeDefined();
      const ang = areaAngle(line!);
      // Sidestep perpendicular to the line.
      const side = () => walkIntent(a.player.x, a.player.y, a.player.x - Math.sin(ang) * 500, a.player.y + Math.cos(ang) * 500);
      const r = stepFor(a, 2, dodge ? side : () => idleIntent());
      const hits = r.events.filter((e) => e.t === 'hit' && e.target === 'player' && e.damageType === 'cold');
      return { hits, chills: debuffEvents(r.events, 'chilled'), dmg: a.world.monsters.damage[i] };
    };
    const stay = run(false);
    expect(stay.hits.length).toBeGreaterThan(0);
    const biggest = Math.max(...stay.hits.map((e) => (e.t === 'hit' ? e.amount : 0)));
    expect(biggest).toBeGreaterThan(stay.dmg * WARDEN.spikes.mult * 0.75); // heavy: the roll's low end
    expect(stay.chills.length).toBeGreaterThan(0);
    const dodged = run(true);
    // The volleys may still clip her; the spikes may not.
    expect(dodged.hits.filter((e) => e.t === 'hit' && e.amount > dodged.dmg * WARDEN.spikes.mult * 0.75)).toEqual([]);
  });
});

describe('The Hollow Warden: phase 3', () => {
  it('three blizzards drift across the fight and chill whoever they touch — none starts on a player', () => {
    const { a, i, id } = warden();
    const ev = enterPhase(a, i, 0.3);
    expect(a.world.boss.phase).toBe(3);
    const storms = stepUntil(a, 2, () => {
      const b = areasOf(a.world, 'blizzard', id);
      return b.length >= WARDEN.blizzard.count ? b : undefined;
    }, idleIntent(), ev);
    expect(storms, 'no storms').toBeDefined();
    expect(storms).toHaveLength(WARDEN.blizzard.count);
    expect(attacks(ev, 'hollowWarden', 'blizzard').length).toBe(1);
    for (const s of storms!) {
      expect(Math.hypot(s.x - a.player.x, s.y - a.player.y)).toBeGreaterThanOrEqual(s.radius + WARDEN.blizzard.clear - 1);
    }
    const start = storms!.map((s) => ({ x: s.x, y: s.y }));
    stepFor(a, 2);
    storms!.forEach((s, k) => {
      const moved = Math.hypot(s.x - start[k].x, s.y - start[k].y);
      expect(moved).toBeGreaterThan(WARDEN.blizzard.speedMin * 2 * 0.8);
      expect(moved).toBeLessThan(WARDEN.blizzard.speedMax * 2 * 1.05);
    });
    // Step into one: chilled (and nipped) within a tick interval.
    const s0 = storms![0];
    a.player.x = s0.x;
    a.player.y = s0.y;
    a.player.invulnTime = 0;
    const inside = stepFor(a, WARDEN.blizzard.tick + 0.1, () => walkIntent(a.player.x, a.player.y, s0.x, s0.y));
    expect(debuffEvents(inside.events, 'chilled').length + (a.run.view.players[0].debuffs.some((d) => d.id === 'chilled') ? 1 : 0))
      .toBeGreaterThan(0);
    expect(inside.events.some((e) => e.t === 'hit' && e.target === 'player' && e.damageType === 'cold')).toBe(true);
  });

  it('keeps her whole kit: spikes fan out in threes, prisons and novas keep coming', () => {
    const { a, i, id } = warden();
    enterPhase(a, i, 0.3);
    const { areas } = watch(a, 12);
    const spikes = areas.filter((x) => x.area.kind === 'glacialSpike' && x.area.owner === id);
    const casts = [...new Set(spikes.map((x) => x.t))];
    expect(casts.length).toBeGreaterThanOrEqual(1);
    const headings = new Set(spikes.filter((x) => x.t === casts[0]).map((x) => Math.round(areaAngle(x.area) * 100)));
    expect(headings.size).toBe(3);
    expect(areas.some((x) => x.area.kind === 'icePrison')).toBe(true);
    expect(areas.some((x) => x.area.kind === 'frostNovaWarning' && x.area.radius === WARDEN.nova.radius[2])).toBe(true);
    // The fan's lines are WARDEN.spikes.fan apart.
    const hs = [...headings].map((h) => h / 100);
    let gap = Infinity;
    for (const p of hs) {
      for (const q of hs) {
        if (p === q) continue;
        let d = Math.abs(p - q) % TAU;
        if (d > Math.PI) d = TAU - d;
        gap = Math.min(gap, d);
      }
    }
    expect(gap).toBeCloseTo(WARDEN.spikes.fan, 1);
  });
});

describe('The Hollow Warden: summons', () => {
  it('calls first, then the Rimeshades rise as her cast ends', () => {
    const { a, i } = warden(1e7);
    const m = a.world.monsters;
    stepFor(a, SIM_DT);
    state(a).novaCd = 1e9;
    state(a).volleyCd = 1e9;
    state(a).summonCd = 0;
    const log: SimEvent[] = [];
    expect(stepUntil(a, 2, (ev) => attacks(ev, 'hollowWarden', 'summon')[0], idleIntent(), log)).toBeDefined();
    const called = a.world.time;
    expect(log.filter((e) => e.t === 'monsterSpawn' && e.kind === 'rimeshade')).toEqual([]);
    expect(m.state[i]).toBe(MSTATE.cast);
    const rise = stepUntil(a, 2, (ev) => {
      const shades = ev.filter((e) => e.t === 'monsterSpawn' && e.kind === 'rimeshade');
      return shades.length > 0 ? shades : undefined;
    });
    expect(rise).toHaveLength(WARDEN.summon.count[0]);
    expect(a.world.time - called).toBeCloseTo(WARDEN.summon.cast, 1);
    for (const e of rise!) {
      if (e.t !== 'monsterSpawn') continue;
      const r = Math.hypot(e.x - m.x[i], e.y - m.y[i]);
      expect(r).toBeGreaterThanOrEqual(WARDEN.summon.rMin - 1);
      expect(r).toBeLessThanOrEqual(WARDEN.summon.rMax + 1);
    }
    // One call per summoning.
    expect(attacks(log, 'hollowWarden', 'summon')).toHaveLength(1);
  });

  it('a roar during the call cancels it: no shades', () => {
    const { a, i } = warden();
    const m = a.world.monsters;
    stepFor(a, SIM_DT);
    state(a).novaCd = 1e9;
    state(a).volleyCd = 1e9;
    state(a).summonCd = 0;
    expect(stepUntil(a, 2, (ev) => attacks(ev, 'hollowWarden', 'summon')[0])).toBeDefined();
    m.life[i] = m.maxLife[i] * 0.6;
    const r = stepFor(a, WARDEN.roar + 0.2);
    expect(r.events.filter((e) => e.t === 'monsterSpawn' && e.kind === 'rimeshade')).toEqual([]);
  });
});

describe('The Hollow Warden: in reach', () => {
  it('swings her lantern at a player who closes in: a chilling melee hit', () => {
    const { a, i } = warden(1e7);
    const m = a.world.monsters;
    const close = () => walkIntent(a.player.x, a.player.y, m.x[i], m.y[i]);
    const r = stepFor(a, 5, close);
    const melee = attacks(r.events, 'hollowWarden', 'melee');
    expect(melee.length).toBeGreaterThan(0);
    expect(Math.hypot(a.player.x - m.x[i], a.player.y - m.y[i])).toBeLessThan(m.radius[i] + PLAYER_RADIUS + WARDEN.meleeReach + 4);
  });
});

describe('The Hollow Warden: in a party', () => {
  it('closes her Ice Prisons on any player in reach and sends a spike line at each of them', () => {
    const { a, i, id } = warden();
    const second = joinArena(a, 2, -40, 90, tough());
    enterPhase(a, i, 0.6);
    const targets = new Set<number>();
    const seen = new Set<number>();
    for (let n = 0; n < 12; n++) {
      state(a).prisonCd = 0;
      state(a).gap = 0;
      const p = stepUntil(a, 3, () => a.world.areas.find((x) => x.kind === 'icePrison' && !seen.has(x.id)));
      if (!p) continue;
      seen.add(p.id);
      targets.add(p.target);
      // Walk both out of it so nobody stays frozen between rounds.
      stepFor(a, 1.2, () => walkIntent(a.player.x, a.player.y, 0, 0));
    }
    expect([...targets].sort()).toEqual([1, 2]);
    // Spikes: one line toward each of them.
    state(a).prisonCd = 1e9;
    state(a).spikesCd = 0;
    state(a).gap = 0;
    const log: SimEvent[] = [];
    stepUntil(a, 3, (ev) => attacks(ev, 'hollowWarden', 'spikes')[0], idleIntent(), log);
    const m = a.world.monsters;
    const heads = new Set(areasOf(a.world, 'glacialSpike', id).map((x) => Math.round(areaAngle(x) * 20)));
    expect(heads.size).toBe(2);
    for (const p of [a.player, second]) {
      const want = Math.atan2(p.y - m.y[i], p.x - m.x[i]);
      const match = [...heads].some((h) => {
        let diff = h / 20 - want;
        diff -= Math.round(diff / TAU) * TAU;
        return Math.abs(diff) < 0.15;
      });
      expect(match, `no line toward player ${p.id}`).toBe(true);
    }
  });
});

describe('The Hollow Warden: in a full party', () => {
  it('her own player gets the whole phase-3 fan, however late they joined; the fourth line goes to another', () => {
    const { a, i, id } = warden();
    const m = a.world.monsters;
    // Three players 220 away round her, then the one she hunts — nearest, and last to join.
    a.player.x = 140;
    a.player.y = -220;
    joinArena(a, 2, 360, 0, tough());
    joinArena(a, 3, 140, 220, tough());
    const target = joinArena(a, 4, 80, 0, tough());
    enterPhase(a, i, 0.3);
    expect(a.world.boss.phase).toBe(3);
    state(a).blizzardCd = 1e9;
    state(a).prisonCd = 1e9;
    state(a).novaCd = 1e9;
    state(a).summonCd = 1e9;
    state(a).spikesCd = 0;
    state(a).gap = 0;
    expect(stepUntil(a, 3, (ev) => attacks(ev, 'hollowWarden', 'spikes')[0])).toBeDefined();
    expect(m.target[i]).toBe(target.id);
    const heads = [...new Set(areasOf(a.world, 'glacialSpike', id).map((x) => Math.round(areaAngle(x) * 1000) / 1000))];
    expect(heads).toHaveLength(WARDEN.spikes.maxLines);
    const toward = (p: { x: number; y: number }, off = 0) => {
      const want = Math.atan2(p.y - m.y[i], p.x - m.x[i]) + off;
      return heads.some((h) => {
        let diff = h - want;
        diff -= Math.round(diff / TAU) * TAU;
        return Math.abs(diff) < 0.05;
      });
    };
    for (const off of [0, -WARDEN.spikes.fan, WARDEN.spikes.fan]) expect(toward(target, off), `fan line ${off}`).toBe(true);
    expect([a.player, a.world.playerById[2]!, a.world.playerById[3]!].filter((p) => toward(p))).toHaveLength(1);
  });
});

describe('The Hollow Warden: blizzards at the edge', () => {
  it('never starts a storm on a player, even when the arena wall crowds the spots round her', () => {
    const { a, i, id } = warden();
    const m = a.world.monsters;
    enterPhase(a, i, 0.3);
    const keep = WARDEN.blizzard.radius + WARDEN.blizzard.clear;
    const seen = new Set<number>();
    let storms = 0;
    const clearStorms = () => a.world.areas.forEach((x) => {
      if (x.kind === 'blizzard') x.dead = true;
    });
    for (let n = 0; n < 8; n++) {
      // Between casts (her pose played out), the old storms gone.
      expect(stepUntil(a, 3, () => (m.state[i] === MSTATE.chase ? true : undefined))).toBe(true);
      clearStorms();
      // Her player pressed against the wall, somewhere new each time; she floats close by.
      const ang = n * 0.8;
      const edge = a.world.arenaRadius - 30;
      a.player.x = Math.cos(ang) * edge;
      a.player.y = Math.sin(ang) * edge;
      m.x[i] = Math.cos(ang) * (edge - 120);
      m.y[i] = Math.sin(ang) * (edge - 120);
      Object.assign(state(a), { blizzardCd: 0, gap: 0, prisonCd: 1e9, spikesCd: 1e9, novaCd: 1e9, summonCd: 1e9, volleyCd: 1e9 });
      expect(stepUntil(a, 1, (ev) => attacks(ev, 'hollowWarden', 'blizzard')[0]), `cast ${n}`).toBeDefined();
      for (const s of areasOf(a.world, 'blizzard', id)) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        storms++;
        expect(Math.hypot(s.x - a.player.x, s.y - a.player.y), `cast ${n}`).toBeGreaterThanOrEqual(keep - 1);
      }
    }
    expect(storms).toBeGreaterThan(8);
  });
});

describe('The Hollow Warden: her fall', () => {
  it('takes her storms, prisons and spikes with her', () => {
    const { a, i, id } = warden();
    enterPhase(a, i, 0.3);
    expect(stepUntil(a, 2, () => (areasOf(a.world, 'blizzard', id).length > 0 ? true : undefined))).toBe(true);
    damageMonster(a.world, i, 1e9, DAMAGE_INDEX.fire, 0, 1.5, 0, 0, 0, 0, true, 1);
    const r = stepFor(a, SIM_DT);
    expect(r.events.some((e) => e.t === 'death' && e.kind === 'hollowWarden')).toBe(true);
    for (const k of ['blizzard', 'icePrison', 'glacialSpike', 'frostNovaWarning'] as const) expect(areasOf(a.world, k, id), k).toEqual([]);
  });
});
