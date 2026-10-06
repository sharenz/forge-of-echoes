// Roster batch 1 (power rework SK2): each new skill in isolation, driven by the runtime def the rules resolve (so the numbers the
// tooltip prints are the numbers the sim uses), plus the behaviour primitives they brought (ground, decay, bounce, stride, restore).
import { describe, expect, it } from 'vitest';
import type { SkillId } from '../../src/contracts/content';
import type { CharacterSave } from '../../src/contracts/items';
import { AILMENT_BIT, PROJECTILE_KINDS, type AugmentRuntime, type SkillRuntimeDef } from '../../src/contracts/sim';
import { DECAY, SKILL_TIMING } from '../../src/data/progression';
import { rules } from '../../src/game';
import { damageRange } from '../../src/game/progression/skills';
import { DT } from '../../src/sim/constants';
import { releaseSkill } from '../../src/sim/skills';
import { bareCharacter } from '../game-progression/fixtures';
import { makeStats } from './fixtures';
import { makeArena, ofType, placeMonster, stepN, walkIntent, type Arena } from './helpers';
// After the sim's entry points (the debuff module is part of an import cycle that must start from them).
import { applyDebuff, isActive } from '../../src/sim/debuffs';

// Float32 life: big enough to survive every test, small enough that a 0.5-damage tick is not lost to rounding.
const BIG = 1e5;

function armed(skill: SkillId, augments: string[] = [], rank = 10, stats = makeStats()) {
  const ch: CharacterSave = bareCharacter({ level: 40, augments: { [skill]: augments }, skillRanks: { emberLance: 1, [skill]: rank } });
  const sheet = rules.skillSheet(ch, skill, rank);
  const def = sheet.runtime;
  const arena = makeArena({ stats, skills: [def] });
  return { ...arena, def, lines: sheet.lines };
}

function aug<P extends AugmentRuntime['p']>(def: SkillRuntimeDef, p: P): Extract<AugmentRuntime, { p: P }> {
  const a = def.augments?.find((x) => x.p === p);
  if (!a) throw new Error(`${def.id} has no ${p} primitive`);
  return a as Extract<AugmentRuntime, { p: P }>;
}

/** A tough, passive target with no resistances (so the sim's numbers can be compared exactly). */
function target(a: Arena, x: number, y: number, kind: 'ashling' | 'ironhideBrute' = 'ashling'): number {
  const i = placeMonster(a.world, kind, x, y, { life: BIG });
  for (let k = 0; k < 5; k++) a.world.monsters.res[i * 5 + k] = 0;
  return i;
}

function liveOfKind(a: Arena, kind: (typeof PROJECTILE_KINDS)[number]): number[] {
  const p = a.world.projectiles;
  const code = PROJECTILE_KINDS.indexOf(kind);
  return Array.from({ length: p.hwm }, (_, i) => i).filter((i) => p.alive[i] && p.kind[i] === code);
}

function step(a: Arena, n: number) {
  return stepN(a.run, n);
}

describe('Phase Stride', () => {
  it('runs 35% faster for its duration, through crowds and allies; the tooltip says the same numbers', () => {
    const walk = (strided: boolean): number => {
      const a = armed('phaseStride');
      if (strided) releaseSkill(a.world, a.player, a.def, 100, 0);
      stepN(a.run, 30, walkIntent(0, 0, 1000, 0));
      return a.player.x;
    };
    const plain = walk(false);
    const fast = walk(true);
    expect(fast / plain).toBeCloseTo(1.35, 2);

    const a = armed('phaseStride');
    const s = aug(a.def, 'stride');
    expect(s.speed).toBe(0.35);
    expect(a.def.duration).toBeCloseTo(4, 10);
    releaseSkill(a.world, a.player, a.def, 100, 0);
    const buff = ofType(a.run.drainEvents(), 'buff');
    expect(buff).toEqual([expect.objectContaining({ skill: 'phaseStride', duration: a.def.duration })]);
    expect(a.lines).toContain('For 4.0 s: 35% more movement speed, no slow from crowding, and you pass through allies');
    step(a, Math.round(a.def.duration / DT) + 1);
    expect(a.player.stride.time).toBe(0);
  });

  it('Slipstream adds evade chance while it lasts; Cleansing Stride removes chill and root; Long Stride lasts 2 s longer', () => {
    const a = armed('phaseStride', ['longStride', 'slipstream', 'cleansingStride'], 10);
    expect(a.def.duration).toBeCloseTo(6, 10);
    expect(aug(a.def, 'stride').evasion).toBeCloseTo(0.15, 10);
    applyDebuff(a.world, a.player, 'chilled');
    applyDebuff(a.world, a.player, 'rooted');
    releaseSkill(a.world, a.player, a.def, 100, 0);
    expect(isActive(a.player, 'chilled')).toBe(false);
    expect(isActive(a.player, 'rooted')).toBe(false);
    expect(a.player.stride.evasion).toBeCloseTo(0.15, 10);
    expect(a.lines).toContain('+15% chance to evade hits while it lasts');
  });
});

describe('Arcane Reprieve', () => {
  it('restores 30% of maximum Focus over 3 s and removes chill and Withered', () => {
    const a = armed('arcaneReprieve', [], 10, makeStats({ focusRegen: 0, maxFocus: 200 }));
    a.player.focus = 0;
    applyDebuff(a.world, a.player, 'chilled');
    applyDebuff(a.world, a.player, 'withered');
    releaseSkill(a.world, a.player, a.def, 0, 0);
    expect(isActive(a.player, 'chilled')).toBe(false);
    expect(isActive(a.player, 'withered')).toBe(false);
    step(a, 60);
    expect(a.player.focus).toBeCloseTo(20, 3);
    step(a, 150);
    expect(a.player.focus).toBeCloseTo(60, 3);
    expect(aug(a.def, 'restore')).toEqual({ p: 'restore', focus: 0.3, life: 0 });
    expect(a.lines).toContain('Restores 30% of your maximum Focus over 3.0 s');
  });

  it('Deep Well restores 45% (cooldown +8 s); Second Wind also restores 15% of life', () => {
    const plain = armed('arcaneReprieve').def;
    const a = armed('arcaneReprieve', ['deepWell', 'secondWind'], 10, makeStats({ focusRegen: 0, lifeRegen: 0, maxFocus: 100, maxLife: 400 }));
    expect(a.def.cooldown).toBeCloseTo(plain.cooldown + 8, 10);
    a.player.focus = 0;
    a.player.life = 100;
    releaseSkill(a.world, a.player, a.def, 0, 0);
    step(a, 200);
    expect(a.player.focus).toBeCloseTo(45, 3);
    expect(a.player.life).toBeCloseTo(160, 3);
  });
});

describe('Glacial Nova', () => {
  it('hits every enemy within its radius once, chills them, and leaves those outside alone', () => {
    const a = armed('glacialNova');
    expect(a.def.radius).toBeCloseTo(120, 10);
    const near = target(a, 100, 0);
    const far = target(a, 0, 150);
    step(a, 1); // the spatial grid is rebuilt at the start of a tick
    releaseSkill(a.world, a.player, a.def, 100, 0);
    const m = a.world.monsters;
    expect(m.life[near]).toBeLessThan(BIG);
    expect(m.chillTime[near]).toBeGreaterThan(0);
    expect(m.life[far]).toBe(BIG);
    const dealt = BIG - m.life[near];
    expect(dealt).toBeGreaterThanOrEqual(a.def.damage * 0.8 - 1e-6);
    expect(dealt).toBeLessThanOrEqual(a.def.damage * 1.2 * a.def.critMultiplier + 1e-6);
    expect(a.lines).toContain(`Deals ${damageRange(a.def.damage)} Cold damage to every enemy within 120 units of you`);
    const nova = ofType(a.run.drainEvents(), 'nova');
    expect(nova).toEqual([expect.objectContaining({ skill: 'glacialNova', radius: a.def.radius })]);
  });

  it('Wide Chill: 40% larger, 10% less damage', () => {
    const plain = armed('glacialNova').def;
    const wide = armed('glacialNova', ['wideChill']).def;
    expect(wide.radius).toBeCloseTo(plain.radius * 1.4, 10);
    expect(wide.damage).toBeCloseTo(plain.damage * 0.9, 10);
  });
});

describe('Spark', () => {
  it('releases the resolved number of slow sparks that pierce and hit one enemy at most every 0.4 s', () => {
    const a = armed('spark');
    expect(a.def.projectiles).toBe(7);
    releaseSkill(a.world, a.player, a.def, 100, 0);
    const sparks = liveOfKind(a, 'spark');
    expect(sparks).toHaveLength(a.def.projectiles);
    const pr = a.world.projectiles;
    expect(Math.hypot(pr.vx[sparks[0]], pr.vy[sparks[0]])).toBeCloseTo(a.def.projectileSpeed, 3);
    expect(pr.pierce[sparks[0]]).toBe(-1);
    expect(pr.bounce[sparks[0]]).toBe(2);
    expect(pr.rehit[sparks[0]]).toBeCloseTo(SKILL_TIMING.sparkRehit, 6);
    expect(a.lines).toContain(`Releases 7 sparks in a 46° fan; each hits an enemy at most every 0.4 s`);
    expect(a.lines).toContain('Rebounds off walls up to 2 times');
  });

  it('a spark inside one big body for 1 s hits it 3 times (0, 0.4, 0.8 s), never more often', () => {
    const def = { ...armed('spark').def, projectiles: 1, spread: 0, critChance: 0 };
    const a = armed('spark');
    const i = target(a, 60, 0);
    a.world.monsters.radius[i] = 80;
    releaseSkill(a.world, a.player, def, 100, 0);
    let hits = 0;
    let life = a.world.monsters.life[i];
    for (let k = 0; k < 60; k++) {
      step(a, 1);
      if (a.world.monsters.life[i] < life) hits++;
      life = a.world.monsters.life[i];
    }
    expect(hits).toBe(3);
  });

  it('rebounds off the arena edge (its bounce count runs down), then fades at its range', () => {
    const a = armed('spark');
    const def = { ...a.def, projectiles: 1, spread: 0 };
    a.player.x = a.world.arenaRadius - 40;
    a.player.prevX = a.player.x;
    releaseSkill(a.world, a.player, def, a.world.arenaRadius + 100, 0);
    const [s] = liveOfKind(a, 'spark');
    step(a, 40);
    expect(a.world.projectiles.vx[s]).toBeLessThan(0);
    expect(a.world.projectiles.bounce[s]).toBe(1);
  });

  it('More Sparks: +3 sparks 20% weaker; Ricochet Storm: 2 more bounces; Charged: always shocks, 15% less', () => {
    const plain = armed('spark').def;
    const more = armed('spark', ['moreSparks', 'ricochetStorm', 'charged']).def;
    expect(more.projectiles).toBe(plain.projectiles + 3);
    expect(more.damage).toBeCloseTo(plain.damage * 0.8 * 0.85, 8);
    expect(aug(more, 'bounce').count).toBe(4);
    expect(more.ailmentChance).toBe(1);
  });
});

describe('Cinder Mortar', () => {
  it('lobs a shell at the cursor that lands after 0.9 s, bursts in its radius and leaves burning ground', () => {
    const a = armed('cinderMortar');
    const hit = target(a, 150, 0);
    const beside = target(a, 150 + a.def.radius + 30, 0);
    releaseSkill(a.world, a.player, a.def, 150, 0);
    const [shell] = liveOfKind(a, 'cinderShell');
    expect(a.world.projectiles.life[shell]).toBeCloseTo(SKILL_TIMING.mortarFlight, 6);
    step(a, Math.round(SKILL_TIMING.mortarFlight / DT) - 2);
    expect(a.world.monsters.life[hit]).toBe(BIG);
    step(a, 3);
    expect(a.world.monsters.life[hit]).toBeLessThan(BIG);
    expect(a.world.monsters.life[beside]).toBe(BIG);
    const g = aug(a.def, 'ground');
    const ground = a.world.areas.filter((x) => x.kind === 'fireTrail');
    expect(ground).toHaveLength(1);
    expect(ground[0].x).toBeCloseTo(150, 0);
    expect(ground[0].radius).toBeCloseTo(g.radius, 4);
    expect(ground[0].duration).toBeCloseTo(g.duration, 6);
    expect(ground[0].damage).toBeCloseTo(g.damage, 4);
    // 0.35 effectiveness per 0.5 s of the 3.6 effectiveness hit, for 3 s, over the blast radius.
    expect(g.damage).toBeCloseTo((a.def.damage * 0.35) / 3.6, 6);
    expect(g.duration).toBeCloseTo(3, 10);
    expect(g.radius).toBeCloseTo(a.def.radius, 10);
    expect(a.lines).toContain(`Deals ${damageRange(a.def.damage)} Fire damage in a radius of ${Math.round(a.def.radius)}`);
    expect(a.lines).toContain(`Leaves burning ground (radius ${Math.round(g.radius)}) for 3.0 s: ${damageRange(g.damage)} Fire damage every 0.5 s`);
  });

  it('flies over tall cover; clamps the landing to its range', () => {
    const a = armed('cinderMortar');
    releaseSkill(a.world, a.player, a.def, 2000, 0);
    const [shell] = liveOfKind(a, 'cinderShell');
    const pr = a.world.projectiles;
    expect(Math.hypot(pr.vx[shell], pr.vy[shell]) * pr.life[shell]).toBeCloseTo(a.def.range, 0);
  });

  it('Napalm: burning ground 50% wider, 2 s longer, +0.1 effectiveness per tick', () => {
    const plain = armed('cinderMortar').def;
    const nap = armed('cinderMortar', ['napalm']).def;
    expect(aug(nap, 'ground').radius).toBeCloseTo(aug(plain, 'ground').radius * 1.5, 8);
    expect(aug(nap, 'ground').duration).toBeCloseTo(5, 10);
    expect(aug(nap, 'ground').damage).toBeCloseTo((plain.damage * 0.45) / 3.6, 6);
  });
});

describe('Umbral Bolt and Decay', () => {
  it('a hit applies a Decay stack: 40% of the hit as void over 4 s (half the void resistance), up to 5 stacks', () => {
    const a = armed('umbralBolt');
    const d = aug(a.def, 'decay');
    expect(d.share).toBeCloseTo(0.4, 10);
    const i = target(a, 60, 0);
    const def = { ...a.def, critChance: 0 };
    releaseSkill(a.world, a.player, def, 100, 0);
    const first = step(a, 20).events;
    const m = a.world.monsters;
    expect(m.decayStacks[i]).toBe(1);
    expect(m.ailments[i] & AILMENT_BIT.decayed).toBe(AILMENT_BIT.decayed);
    // Over the 4 s it deals exactly share × the average hit (no roll), with the monster's 0 void resistance.
    const bolt = ofType(first, 'hit')[0].amount;
    step(a, Math.round(DECAY.duration / DT) + 2);
    expect(BIG - m.life[i] - bolt).toBeCloseTo(def.damage * d.share, 0);
    expect(m.decayStacks[i]).toBe(0);
    expect(m.ailments[i] & AILMENT_BIT.decayed).toBe(0);
    for (let k = 0; k < 7; k++) {
      // An awakened monster drifts toward her; keep it in the bolt's path.
      m.x[i] = 60;
      m.y[i] = 0;
      step(a, 1);
      releaseSkill(a.world, a.player, def, 100, 0);
      step(a, 20);
    }
    expect(m.decayStacks[i]).toBe(DECAY.maxStacks);
    expect(a.lines).toContain('Decay: 40% of the hit as Void damage over 4.0 s, stacking up to 5 times');
  });

  it('Withering Touch makes Decay 50% stronger; the estimate counts Decay', () => {
    const plain = armed('umbralBolt').def;
    const strong = armed('umbralBolt', ['witheringTouch']).def;
    expect(aug(strong, 'decay').share).toBeCloseTo(0.6, 10);
    expect(strong.damage).toBeCloseTo(plain.damage, 10);
  });
});

describe('Kinetic Lance', () => {
  it('a fast physical bolt that pierces 3 and knocks back twice as far; Ricochet rebounds twice at 20% less', () => {
    const a = armed('kineticLance');
    expect(a.def.damageType).toBe('physical');
    expect(a.def.pierce).toBe(3);
    const i = target(a, 60, 0);
    releaseSkill(a.world, a.player, a.def, 100, 0);
    const [bolt] = liveOfKind(a, 'kineticLance');
    expect(a.world.projectiles.knock[bolt]).toBe(SKILL_TIMING.kineticKnockback);
    const ev = ofType(step(a, 10).events, 'hit');
    expect(ev.some((e) => e.damageType === 'physical')).toBe(true);
    expect(a.world.monsters.life[i]).toBeLessThan(BIG);
    const ric = armed('kineticLance', ['ricochet']).def;
    expect(aug(ric, 'bounce').count).toBe(2);
    expect(ric.damage).toBeCloseTo(a.def.damage * 0.8, 8);
    expect(a.lines).toContain('Fires a fast bolt toward the cursor that knocks enemies back 2× as far');
  });
});

describe('Frost Orb', () => {
  it('a slow orb that touches nothing and fires a shard every 0.25 s at the nearest enemy: 12 shards over 3 s', () => {
    const a = armed('frostOrb');
    expect(a.def.duration).toBeCloseTo(3, 10);
    // Directly in the orb's path (it must not hit it) and within reach the whole flight.
    const i = target(a, 143, 20);
    const def = { ...a.def, critChance: 0, ailmentChance: 0 };
    releaseSkill(a.world, a.player, def, 300, 0);
    expect(liveOfKind(a, 'frostOrb')).toHaveLength(1);
    let hits = 0;
    let life = a.world.monsters.life[i];
    for (let k = 0; k < Math.round(3.6 / DT); k++) {
      step(a, 1);
      if (a.world.monsters.life[i] < life) hits++;
      life = a.world.monsters.life[i];
    }
    expect(hits).toBe(12);
    expect(liveOfKind(a, 'frostOrb')).toHaveLength(0);
    expect(a.lines).toContain(`Every 0.25 s each orb fires a shard at the nearest enemy within 140 units (12 shards): ${damageRange(a.def.damage)} Cold damage each`);
  });

  it('Twin Orbs: two orbs, 35% less damage per shard', () => {
    const a = armed('frostOrb', ['twinOrbs']);
    expect(a.def.projectiles).toBe(2);
    releaseSkill(a.world, a.player, a.def, 300, 0);
    expect(liveOfKind(a, 'frostOrb')).toHaveLength(2);
    expect(a.def.damage).toBeCloseTo(armed('frostOrb').def.damage * 0.65, 8);
  });
});

describe('Storm Call', () => {
  it('telegraphs its strikes around the cursor; they fall after 0.7 s, past cover, and the tooltip names the same numbers', () => {
    const a = armed('stormCall');
    expect(a.def.projectiles).toBe(7);
    const i = target(a, 200, 0);
    a.world.monsters.radius[i] = 80; // a body covering the whole strike circle: every strike lands on it
    releaseSkill(a.world, a.player, a.def, 200, 0);
    const marks = a.world.areas.filter((x) => x.kind === 'stormCall');
    expect(marks).toHaveLength(a.def.projectiles);
    for (const m of marks) {
      expect(Math.hypot(m.x - 200, m.y)).toBeLessThanOrEqual(a.def.range + 1e-6);
      expect(m.radius).toBeCloseTo(a.def.radius, 10);
      expect(m.duration).toBeCloseTo(SKILL_TIMING.stormTelegraph, 10);
    }
    step(a, Math.round(SKILL_TIMING.stormTelegraph / DT) - 2);
    expect(a.world.monsters.life[i]).toBe(BIG);
    const ev = step(a, 4).events;
    expect(ofType(ev, 'hit').filter((e) => e.damageType === 'lightning')).toHaveLength(a.def.projectiles);
    expect(ofType(ev, 'areaResolve').filter((e) => e.kind === 'stormCall')).toHaveLength(a.def.projectiles);
    expect(a.lines).toContain('7 strikes land within 70 units of the cursor after 0.7 s');
    expect(a.lines).toContain(`Each strike deals ${damageRange(a.def.damage)} Lightning damage in a radius of 28: ground damage, it ignores cover and shields`);
  });

  it('Tethered Strikes land evenly along the line to the cursor; Storm Cell adds 3 strikes and 0.2 s of cast', () => {
    const a = armed('stormCall', ['tetheredStrikes', 'stormCell']);
    const plain = armed('stormCall').def;
    expect(a.def.projectiles).toBe(plain.projectiles + 3);
    expect(a.def.castTime).toBeCloseTo(plain.castTime + 0.2, 10);
    releaseSkill(a.world, a.player, a.def, 200, 0);
    const marks = a.world.areas.filter((x) => x.kind === 'stormCall');
    expect(marks.map((m) => Math.round(m.x))).toEqual(Array.from({ length: 10 }, (_, k) => Math.round((200 * (k + 1)) / 10)));
    expect(marks.every((m) => Math.abs(m.y) < 1e-6)).toBe(true);
  });
});

describe('Glacial Spikes', () => {
  it('erupts its spikes one after another along the line to the cursor; an enemy is struck once per line', () => {
    const a = armed('glacialSpikes');
    expect(a.def.projectiles).toBe(8);
    const i = target(a, 100, 0);
    releaseSkill(a.world, a.player, a.def, 300, 0);
    const spikes = a.world.areas.filter((x) => x.kind === 'frostSpike');
    expect(spikes).toHaveLength(8);
    expect(spikes.map((s) => Math.round(s.x))).toEqual([25, 50, 75, 100, 125, 150, 175, 200]);
    expect(spikes.map((s) => +s.duration.toFixed(3))).toEqual([0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45]);
    const ev = step(a, 40).events;
    // Three spikes (75, 100, 125) reach the target, but one row strikes it once.
    expect(ofType(ev, 'hit').filter((e) => e.damageType === 'cold')).toHaveLength(1);
    expect(a.world.monsters.life[i]).toBeLessThan(BIG);
    expect(a.lines).toContain('8 spikes erupt one after another along 200 units toward the cursor');
  });

  it('Twin Lines: two rows 15° either side of the aim, 30% less damage each', () => {
    const a = armed('glacialSpikes', ['twinLines']);
    releaseSkill(a.world, a.player, a.def, 300, 0);
    const spikes = a.world.areas.filter((x) => x.kind === 'frostSpike');
    expect(spikes).toHaveLength(16);
    const angles = new Set(spikes.map((s) => Math.round((Math.atan2(s.y, s.x) * 180) / Math.PI)));
    expect([...angles].sort((x, y) => x - y)).toEqual([-15, 15]);
    expect(a.def.damage).toBeCloseTo(armed('glacialSpikes').def.damage * 0.7, 8);
  });
});

describe('estimates (tooltip DPS) match the behaviour', () => {
  it('Frost Orb counts every shard on one target; Storm Call the expected share of its scattered strikes', () => {
    const ch = bareCharacter({ level: 40, skillRanks: { emberLance: 1, frostOrb: 10, stormCall: 10, cinderMortar: 10, umbralBolt: 10 } });
    const orb = rules.skillSheet(ch, 'frostOrb', 10);
    const hit = orb.runtime.damage * (1 + orb.runtime.critChance * (orb.runtime.critMultiplier - 1));
    expect(orb.dps!).toBeCloseTo((hit * 12) / orb.runtime.cooldown, 6);
    const storm = rules.skillSheet(ch, 'stormCall', 10);
    const sh = storm.runtime.damage * (1 + storm.runtime.critChance * (storm.runtime.critMultiplier - 1));
    expect(storm.dps!).toBeCloseTo((sh * 7 * ((28 + 12) / 70) ** 2) / storm.runtime.cooldown, 6);
  });
});
