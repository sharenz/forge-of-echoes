// Roster batch 3 (power rework SK4): Meteor Rain, Storm Step, Tempest Surge, Blizzard and Event Horizon, each in isolation, driven by
// the runtime def the rules resolve (so the numbers the tooltip prints are the numbers the sim uses), with their augments.
import { describe, expect, it } from 'vitest';
import type { SkillId } from '../../src/contracts/content';
import type { CharacterSave } from '../../src/contracts/items';
import type { AugmentRuntime, SkillRuntimeDef } from '../../src/contracts/sim';
import { SKILL_TIMING } from '../../src/data/progression';
import { rules } from '../../src/game';
import { damageRange } from '../../src/game/progression/skills';
import { DT } from '../../src/sim/constants';
import { releaseSkill } from '../../src/sim/skills';
import { DAMAGE_INDEX } from '../../src/sim/math';
import { MFLAG } from '../../src/sim/stores';
import { roster3Taken, surgeCastRate } from '../../src/sim/skills/roster3-state';
import { bareCharacter } from '../game-progression/fixtures';
import { makeStats } from './fixtures';
import { hold, makeArena, ofType, placeMonster, stepN, type Arena } from './helpers';
// After the sim's entry points (combat and behaviour are part of an import cycle that must start from them).
import { damageMonster, hitPlayer } from '../../src/sim/combat';

const BIG = 1e5;
const COLD = DAMAGE_INDEX.cold;
const LIGHTNING = DAMAGE_INDEX.lightning;

function character(skill: SkillId, augments: string[], rank: number): CharacterSave {
  return bareCharacter({ level: 62, augments: { [skill]: augments }, skillRanks: { emberLance: 1, [skill]: rank } });
}

function armed(skill: SkillId, augments: string[] = [], rank = 10, stats = makeStats(), extra: SkillRuntimeDef[] = [], loadout?: (SkillId | null)[]) {
  const sheet = rules.skillSheet(character(skill, augments, rank), skill, rank);
  const def = sheet.runtime;
  const arena = makeArena({ stats, skills: [def, ...extra], loadout });
  return { ...arena, def, lines: sheet.lines };
}

function aug<P extends AugmentRuntime['p']>(def: SkillRuntimeDef, p: P): Extract<AugmentRuntime, { p: P }> {
  const a = def.augments?.find((x) => x.p === p);
  if (!a) throw new Error(`${def.id} has no ${p} primitive`);
  return a as Extract<AugmentRuntime, { p: P }>;
}

/** A tough, passive target with no resistances. */
function target(a: Arena, x: number, y: number, life = BIG): number {
  const i = placeMonster(a.world, 'ashling', x, y, { life });
  for (let k = 0; k < 5; k++) a.world.monsters.res[i * 5 + k] = 0;
  return i;
}

function step(a: Arena, n: number) {
  return stepN(a.run, n);
}

/** Ticks on which monster `i` lost life over the next `n` ticks. */
function damagedTicks(a: Arena, i: number, n: number): number {
  let hits = 0;
  let life = a.world.monsters.life[i];
  for (let k = 0; k < n; k++) {
    step(a, 1);
    if (a.world.monsters.life[i] < life - 1e-6) hits++;
    life = a.world.monsters.life[i];
  }
  return hits;
}

/** A def that never crits (so one hit's size is bounded by the damage roll). */
function noCrit(def: SkillRuntimeDef): SkillRuntimeDef {
  return { ...def, critChance: 0, ailmentChance: 0 };
}

describe('Meteor Rain', () => {
  it('12 meteors at rank 10 fall one after another over 2.5 s within 120 of the cursor, each 0.6 s after its circle appears', () => {
    const a = armed('meteorRain');
    expect(a.def.projectiles).toBe(12);
    expect(a.def.range).toBe(120);
    expect(a.def.radius).toBeCloseTo(34, 10);
    expect(a.def.duration).toBeCloseTo(2.5, 10);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 250, 0);
    const spawned: { tick: number; x: number; y: number; radius: number; duration: number }[] = [];
    const seen = new Set<number>();
    const resolved: { tick: number; x: number; y: number }[] = [];
    const total = Math.round((2.5 + 0.6) / DT) + 4;
    for (let t = 0; t <= total; t++) {
      for (const ar of a.world.areas) {
        if (ar.kind !== 'meteorRain' || seen.has(ar.id)) continue;
        seen.add(ar.id);
        spawned.push({ tick: t, x: ar.x, y: ar.y, radius: ar.radius, duration: ar.duration });
      }
      const ev = step(a, 1).events;
      for (const e of ofType(ev, 'areaResolve')) if (e.kind === 'meteorRain') resolved.push({ tick: t, x: e.x, y: e.y });
    }
    expect(spawned).toHaveLength(12);
    expect(resolved).toHaveLength(12);
    const stepTicks = 2.5 / 12 / DT;
    spawned.forEach((s, k) => {
      expect(Math.abs(s.tick - k * stepTicks), `meteor ${k}`).toBeLessThanOrEqual(1.01);
      expect(s.radius).toBeCloseTo(a.def.radius, 6);
      expect(s.duration).toBeCloseTo(SKILL_TIMING.meteorTelegraph, 6);
      expect(Math.hypot(s.x - 250, s.y)).toBeLessThanOrEqual(120 + 1e-6);
    });
    // Each lands one telegraph after its circle appeared.
    // (the circle is seen the tick after it appears, the impact on the tick it lands)
    resolved.forEach((r, k) => expect(Math.abs(r.tick - spawned[k].tick - SKILL_TIMING.meteorTelegraph / DT)).toBeLessThanOrEqual(2.01));
    expect(a.lines).toContain(
      '12 meteors fall one after another over 2.5 s at random points within 120 units of the cursor; each lands 0.6 s after its circle appears',
    );
    expect(a.lines).toContain(`Each meteor deals ${damageRange(a.def.damage)} Fire damage in a radius of 34: ground damage, it ignores cover and shields`);
  });

  it('each meteor strikes its radius once, past cover; enemies outside every circle are untouched', () => {
    const a = armed('meteorRain');
    const def = noCrit(a.def);
    // A carpet of targets over the rain's circle, and one far away.
    const grid: number[] = [];
    for (let x = -120; x <= 120; x += 30) for (let y = -120; y <= 120; y += 30) if (Math.hypot(x, y) <= 150) grid.push(target(a, 250 + x, y));
    const far = target(a, -300, 0);
    step(a, 1);
    releaseSkill(a.world, a.player, def, 250, 0);
    const lifeBefore = grid.map(() => BIG);
    let hits = 0;
    for (let t = 0; t < Math.round(3.2 / DT); t++) {
      step(a, 1);
      grid.forEach((i, k) => {
        const life = a.world.monsters.life[i];
        if (life < lifeBefore[k] - 1e-6) {
          const lost = lifeBefore[k] - life;
          // One or two meteors on the same tick at most; every hit is the def's damage rolled ×0.8–1.2.
          expect(lost).toBeGreaterThanOrEqual(def.damage * 0.8 - 1e-6);
          hits++;
          lifeBefore[k] = life;
        }
      });
    }
    expect(hits).toBeGreaterThan(5);
    expect(a.world.monsters.life[far]).toBe(BIG);
  });

  it('Heavy Rain: 30% fewer meteors at 80% more; Wide Skies: radius +30%; Burning Ground: fire under each meteor for 3 s', () => {
    const plain = armed('meteorRain').def;
    const a = armed('meteorRain', ['heavyRain', 'wideSkies', 'burningGround']);
    expect(a.def.projectiles).toBe(8);
    expect(a.def.damage).toBeCloseTo(plain.damage * 1.8, 6);
    expect(a.def.radius).toBeCloseTo(plain.radius * 1.3, 10);
    const t = aug(a.def, 'trail');
    expect(t).toMatchObject({ area: 'fireTrail', at: 'strike', duration: 3, interval: 0.5 });
    expect(t.damage).toBeCloseTo((a.def.damage / 4.2) * 0.35, 6);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 250, 0);
    step(a, Math.round(3.2 / DT));
    const fires = a.world.areas.filter((x) => x.kind === 'fireTrail');
    expect(fires.length).toBeGreaterThan(0);
    for (const f of fires) expect(f.radius).toBeCloseTo(a.def.radius, 6);
    expect(a.lines).toContain(`Each meteor leaves burning ground for 3.0 s: ${damageRange(t.damage)} Fire damage every 0.5 s`);
  });
});

describe('Storm Step', () => {
  it('blinks 140 toward the cursor and strikes where she left and where she landed (radius 60), each enemy once', () => {
    const a = armed('stormStep');
    expect(a.def.distance).toBe(140);
    expect(a.def.radius).toBeCloseTo(60, 10);
    expect(a.def.charges).toBe(2);
    const def = noCrit(a.def);
    const atOrigin = target(a, -30, 20);
    const atLanding = target(a, 160, 0);
    const between = target(a, 70, 70);
    step(a, 1);
    const ev0 = a.world.events.drain();
    expect(ev0).toBeDefined();
    releaseSkill(a.world, a.player, def, 400, 0);
    const ev = a.world.events.drain();
    expect(a.player.x).toBeCloseTo(140, 6);
    const novas = ofType(ev, 'nova').filter((e) => e.skill === 'stormStep');
    expect(novas.map((e) => [Math.round(e.x), Math.round(e.y), Math.round(e.radius)])).toEqual([[0, 0, 60], [140, 0, 60]]);
    expect(ofType(ev, 'dash')).toHaveLength(1);
    const m = a.world.monsters;
    for (const i of [atOrigin, atLanding]) {
      expect(BIG - m.life[i]).toBeGreaterThanOrEqual(def.damage * 0.8 - 1e-6);
      expect(BIG - m.life[i]).toBeLessThanOrEqual(def.damage * 1.2 + 1e-6);
    }
    expect(m.life[between]).toBe(BIG);
    expect(a.lines).toContain('Blinks up to 140 units toward the cursor; invulnerable for 0.2 s');
    expect(a.lines).toContain(
      `Lightning strikes where you leave and where you land: ${damageRange(a.def.damage)} Lightning damage in a radius of 60; an enemy is struck once per blink`,
    );
  });

  it('a short blink: an enemy inside both strikes is struck once', () => {
    const a = armed('stormStep');
    const def = noCrit(a.def);
    const both = target(a, 20, 10);
    step(a, 1);
    releaseSkill(a.world, a.player, def, 40, 0);
    const lost = BIG - a.world.monsters.life[both];
    expect(lost).toBeGreaterThanOrEqual(def.damage * 0.8 - 1e-6);
    expect(lost).toBeLessThanOrEqual(def.damage * 1.2 + 1e-6);
  });

  it('Third Strike strikes halfway; Forking Step forks from the landing to 2 more enemies at 60%; Static Cloud leaves a shocking cloud', () => {
    const a = armed('stormStep', ['thirdStrike', 'forkingStep', 'staticCloud']);
    const def = noCrit(a.def);
    expect(aug(def, 'fork')).toMatchObject({ branches: 2, links: 1, share: 0.6, jump: 120 });
    const cloud = aug(def, 'trail');
    expect(cloud).toMatchObject({ area: 'staticField', at: 'origin', duration: 2, ailment: true });
    const mid = target(a, 70, 0);
    const f1 = target(a, 140, 100);
    const f2 = target(a, 140, -100);
    const out = target(a, 140, 200);
    step(a, 1);
    releaseSkill(a.world, a.player, def, 400, 0);
    const ev = a.world.events.drain();
    expect(ofType(ev, 'nova').filter((e) => e.skill === 'stormStep')).toHaveLength(3);
    const m = a.world.monsters;
    expect(m.life[mid]).toBeLessThan(BIG);
    for (const i of [f1, f2]) {
      expect(BIG - m.life[i]).toBeGreaterThanOrEqual(def.damage * 0.6 * 0.8 - 1e-6);
      expect(BIG - m.life[i]).toBeLessThanOrEqual(def.damage * 0.6 * 1.2 + 1e-6);
    }
    expect(m.life[out]).toBe(BIG);
    expect(ofType(ev, 'chain')).toHaveLength(2);
    const fields = a.world.areas.filter((x) => x.kind === 'staticField');
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ x: 0, y: 0, duration: 2 });
    expect(fields[0].radius).toBeCloseTo(def.radius, 6);
    expect(a.lines).toContain('Lightning forks from the landing to 2 more enemies within 120 units for 60% damage');
    expect(a.lines).toContain(`Leaves a shocking cloud (radius 60) where you left for 2.0 s: ${damageRange(cloud.damage)} Lightning damage every 0.5 s`);
  });
});

describe('Tempest Surge', () => {
  it('for 6 s: +25% cast speed, and every enemy within 100 takes its lightning hit every 0.5 s (12 pulses)', () => {
    const a = armed('tempestSurge');
    expect(a.def.duration).toBeCloseTo(6, 10);
    expect(a.def.radius).toBeCloseTo(100, 10);
    const near = target(a, 60, 0);
    const far = target(a, 150, 0);
    step(a, 1);
    expect(surgeCastRate(a.player)).toBe(1);
    releaseSkill(a.world, a.player, a.def, 0, 100);
    expect(surgeCastRate(a.player)).toBeCloseTo(1.25, 10);
    expect(damagedTicks(a, near, Math.round(6.5 / DT))).toBe(12);
    expect(a.world.monsters.life[far]).toBe(BIG);
    expect(surgeCastRate(a.player)).toBe(1);
    expect(a.lines).toContain('For 6.0 s: 25% more cast speed');
    expect(a.lines).toContain(`Every 0.5 s every enemy within 100 units of you takes ${damageRange(a.def.damage)} Lightning damage (12 pulses)`);
  });

  it('a timed cast finishes 25% faster while it lasts', () => {
    const pulse = rules.skillSheet(character('voltaicPulse', [], 1), 'voltaicPulse', 1).runtime;
    const ticksToCast = (surge: boolean): number => {
      const a = armed('tempestSurge', [], 10, makeStats({ maxFocus: 500 }), [pulse], ['voltaicPulse', null, null, null, null, null, null, null]);
      step(a, 1);
      if (surge) releaseSkill(a.world, a.player, a.def, 0, 100);
      for (let t = 1; t < 200; t++) {
        const ev = stepN(a.run, 1, hold(0, 0, 100)).events;
        if (ofType(ev, 'nova').some((e) => e.skill === 'voltaicPulse')) return t;
      }
      return -1;
    };
    const plain = ticksToCast(false);
    const fast = ticksToCast(true);
    expect(plain).toBeGreaterThan(0);
    // The cast takes castTime / 1.25: a fifth of its ticks fewer.
    expect(Math.abs(plain - fast - (pulse.castTime / DT) * (1 - 1 / 1.25))).toBeLessThanOrEqual(1.01);
    expect(fast).toBeLessThan(plain);
  });

  it('Long Storm 9 s (18 pulses); Overcharged Tempo 60% cast speed, 30% less; Lightning Skin: +20% lightning resistance, +10% on shocked enemies', () => {
    const plain = armed('tempestSurge').def;
    const a = armed('tempestSurge', ['longStorm', 'overchargedTempo', 'lightningSkin'], 10, makeStats({ maxLife: 1e6, evasion: 0 }));
    expect(a.def.duration).toBeCloseTo(9, 10);
    expect(a.def.damage).toBeCloseTo(plain.damage * 0.7, 6);
    const near = target(a, 60, 0);
    step(a, 1);
    const p = a.player;
    // A lightning hit before and while the surge runs.
    const before = p.life;
    hitPlayer(a.world, p, 100, LIGHTNING, 'dot');
    const plainHit = before - p.life;
    releaseSkill(a.world, a.player, a.def, 0, 100);
    expect(surgeCastRate(p)).toBeCloseTo(1.6, 10);
    const mid = p.life;
    hitPlayer(a.world, p, 100, LIGHTNING, 'dot');
    expect(mid - p.life).toBeCloseTo(plainHit - 100 * SKILL_TIMING.skinResist, 4);
    // Her hits on a shocked enemy deal 10% more; another player's or an unshocked enemy's are unchanged.
    const m = a.world.monsters;
    m.shockTime[near] = 0;
    expect(roster3Taken(a.world, near, LIGHTNING, p.id)).toBe(1);
    m.shockTime[near] = 2;
    expect(roster3Taken(a.world, near, LIGHTNING, p.id)).toBeCloseTo(1.1, 10);
    expect(roster3Taken(a.world, near, LIGHTNING, 0)).toBe(1);
    expect(damagedTicks(a, near, Math.round(9.5 / DT))).toBe(18);
    expect(roster3Taken(a.world, near, LIGHTNING, p.id)).toBe(1);
    expect(a.lines).toContain('For 9.0 s: 60% more cast speed');
    expect(a.lines).toContain('+20% lightning resistance while it lasts; your hits deal 10% more damage to shocked enemies');
  });

  it('ends when she dies', () => {
    const a = armed('tempestSurge', [], 10, makeStats({ maxLife: 50, evasion: 0 }));
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 0, 100);
    hitPlayer(a.world, a.player, 1e6, LIGHTNING, 'area');
    expect(a.player.dead).toBe(true);
    expect(surgeCastRate(a.player)).toBe(1);
  });
});

describe('Blizzard', () => {
  it('a storm at the cursor (r90, 6 s) deals its cold hit every 0.5 s (12 ticks); chilled enemies inside take 15% more cold damage', () => {
    const a = armed('blizzard');
    expect(a.def.radius).toBeCloseTo(90, 10);
    expect(a.def.duration).toBeCloseTo(6, 10);
    expect(aug(a.def, 'zone')).toMatchObject({ interval: 0.5, pull: 0, slow: 0 });
    const i = target(a, 200, 30);
    const out = target(a, 400, 0);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 200, 0);
    const storm = a.world.areas.filter((x) => x.kind === 'blizzardStorm');
    expect(storm).toHaveLength(1);
    expect(storm[0].radius).toBeCloseTo(a.def.radius, 6);
    step(a, 2);
    const m = a.world.monsters;
    const w = a.world;
    m.chillTime[i] = 2;
    m.chillTime[out] = 2;
    expect(roster3Taken(w, i, COLD, 1)).toBeCloseTo(1.15, 10);
    expect(roster3Taken(w, i, DAMAGE_INDEX.fire, 1)).toBe(1);
    expect(roster3Taken(w, out, COLD, 1)).toBe(1);
    m.chillTime[i] = 0;
    expect(roster3Taken(w, i, COLD, 1)).toBe(1);
    const b = armed('blizzard');
    const j = target(b, 200, 30);
    step(b, 1);
    releaseSkill(b.world, b.player, b.def, 200, 0);
    expect(damagedTicks(b, j, Math.round(6.4 / DT))).toBe(12);
    // After the storm (and its short linger) the bonus is gone.
    b.world.monsters.chillTime[j] = 2;
    expect(roster3Taken(b.world, j, COLD, 1)).toBe(1);
    expect(a.lines).toContain(`A storm at the cursor (radius 90) for 6.0 s: every 0.5 s it deals ${damageRange(a.def.damage)} Cold damage to enemies inside`);
    expect(a.lines).toContain('Chilled enemies in the storm take 15% more Cold damage from every source');
  });

  it('the bonus reaches every source of cold damage on a chilled enemy in the storm', () => {
    const a = armed('blizzard');
    const i = target(a, 200, 0);
    const j = target(a, 400, 0);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 200, 0);
    step(a, 1);
    const m = a.world.monsters;
    m.chillTime[i] = 5;
    m.chillTime[j] = 5;
    // Compare two identical rolls: same seed state is not available, so compare the ratio of many small hits.
    let inStorm = 0;
    let outside = 0;
    for (let k = 0; k < 400; k++) {
      const li = m.life[i];
      const lj = m.life[j];
      damageMonster(a.world, i, 10, COLD, 0, 1.5, 0, 0, 0, 0, true, 0);
      damageMonster(a.world, j, 10, COLD, 0, 1.5, 0, 0, 0, 0, true, 0);
      inStorm += li - m.life[i];
      outside += lj - m.life[j];
    }
    expect(inStorm / outside).toBeGreaterThan(1.1);
    expect(inStorm / outside).toBeLessThan(1.2);
  });

  it('Brittle Cold 35% in all; Wide Storm radius +40%; Frozen Ground slows 50%', () => {
    const plain = armed('blizzard').def;
    const a = armed('blizzard', ['brittleCold', 'wideStorm', 'frozenGround']);
    expect(a.def.radius).toBeCloseTo(plain.radius * 1.4, 10);
    expect(aug(a.def, 'zone').slow).toBeCloseTo(0.5, 10);
    const i = target(a, 200, 0);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 200, 0);
    step(a, 2);
    const m = a.world.monsters;
    m.chillTime[i] = 2;
    expect(roster3Taken(a.world, i, COLD, 1)).toBeCloseTo(1.35, 10);
    expect(m.zoneSlow[i]).toBeCloseTo(0.5, 10);
    expect(a.lines).toContain('Chilled enemies in the storm take 35% more Cold damage from every source');
    expect(a.lines).toContain('Enemies in the storm are slowed by 50%');
  });
});

describe('Event Horizon', () => {
  it('pulls every enemy within 200 toward the point at 80 units/s for 2.5 s, then detonates for its hit in a radius of 120', () => {
    const a = armed('eventHorizon');
    expect(a.def.range).toBe(200);
    expect(a.def.radius).toBeCloseTo(120, 10);
    expect(a.def.duration).toBeCloseTo(2.5, 10);
    const def = noCrit(a.def);
    const i = target(a, 200, 150);
    const heavy = target(a, 200, -150);
    a.world.monsters.flags[heavy] |= MFLAG.heavy;
    const out = target(a, 200, 260);
    step(a, 1);
    releaseSkill(a.world, a.player, def, 200, 0);
    expect(a.world.areas.filter((x) => x.kind === 'eventHorizon').map((x) => [x.x, x.y, x.radius])).toEqual([[200, 0, 200]]);
    step(a, 30);
    const m = a.world.monsters;
    expect(m.y[i]).toBeCloseTo(150 - 40, 0);
    expect(m.y[heavy]).toBeCloseTo(-150 + 20, 0);
    expect(m.y[out]).toBe(260);
    expect(m.life[i]).toBe(BIG);
    const ev = step(a, Math.round(2 / DT) + 2).events;
    const novas = ofType(ev, 'nova').filter((e) => e.skill === 'eventHorizon');
    expect(novas).toEqual([expect.objectContaining({ x: 200, y: 0, radius: def.radius })]);
    const lost = BIG - m.life[i];
    expect(lost).toBeGreaterThanOrEqual(def.damage * 0.8 - 1e-6);
    expect(lost).toBeLessThanOrEqual(def.damage * 1.2 + 1e-6);
    expect(m.life[out]).toBe(BIG);
    expect(a.lines).toContain(
      'For 2.5 s a point at the cursor pulls every enemy within 200 units toward it at 80 units per second (bosses and heavy enemies half)',
    );
    expect(a.lines).toContain(`Then it detonates for ${damageRange(a.def.damage)} Void damage in a radius of 120`);
  });

  it('Heavy Collapse pulls 50% harder for 30% more; Echo Collapse detonates again 0.6 s later at 50%; Void Feast refunds 3 Focus a kill', () => {
    const plain = armed('eventHorizon').def;
    const a = armed('eventHorizon', ['heavyCollapse', 'echoCollapse', 'voidFeast'], 10, makeStats({ maxFocus: 200 }));
    expect(a.def.damage).toBeCloseTo(plain.damage * 1.3, 6);
    const def = noCrit(a.def);
    const i = target(a, 200, 150);
    const doomed = target(a, 200, 100, 5);
    step(a, 1);
    a.player.focus = 50;
    releaseSkill(a.world, a.player, def, 200, 0);
    step(a, 30);
    const m = a.world.monsters;
    expect(m.y[i]).toBeCloseTo(150 - 60, 0);
    // Something else kills an enemy while the horizon pulls: 3 Focus back.
    const focus = a.player.focus;
    damageMonster(a.world, doomed, 1e4, LIGHTNING, 0, 1.5, 0, 0, 0, 0, true, 0);
    step(a, 1);
    expect(a.player.focus - focus).toBeCloseTo(SKILL_TIMING.voidFeastFocus + a.player.stats.focusRegen * DT, 6);
    const ev = step(a, Math.round(2.1 / DT)).events;
    const first = ofType(ev, 'nova').filter((e) => e.skill === 'eventHorizon');
    expect(first).toHaveLength(1);
    const afterFirst = m.life[i];
    const ev2 = step(a, Math.round(0.7 / DT)).events;
    expect(ofType(ev2, 'nova').filter((e) => e.skill === 'eventHorizon')).toHaveLength(1);
    const second = afterFirst - m.life[i];
    expect(second).toBeGreaterThanOrEqual(def.damage * 0.5 * 0.8 - 1e-6);
    expect(second).toBeLessThanOrEqual(def.damage * 0.5 * 1.2 + 1e-6);
    expect(a.lines).toContain(`0.6 s later it detonates again for ${damageRange(a.def.damage * 0.5)} Void damage`);
    expect(a.lines).toContain('Each enemy that dies while it pulls refunds 3 Focus');
  });
});

describe('roster batch 3 and the echo queue', () => {
  it('Echo Sigil repeats Meteor Rain and Event Horizon (any world emitter) at its share', () => {
    const sigil = rules.skillSheet(character('echoSigil', [], 10), 'echoSigil', 10).runtime;
    for (const id of ['meteorRain', 'eventHorizon'] as const) {
      const a = armed(id, [], 10, makeStats(), [sigil]);
      step(a, 1);
      releaseSkill(a.world, a.player, sigil, 0, 100);
      releaseSkill(a.world, a.player, a.def, 200, 0);
      expect(a.player.pendingNovas).toHaveLength(1);
      expect(a.player.pendingNovas[0].def.damage).toBeCloseTo(a.def.damage * 0.7, 6);
      step(a, Math.round(0.5 / DT));
      expect(a.player.pendingNovas).toHaveLength(0);
      const kind = id === 'meteorRain' ? 'meteorRain' : 'eventHorizon';
      expect(a.world.areas.filter((x) => x.kind === kind).length, id).toBeGreaterThanOrEqual(2);
    }
  });
});
