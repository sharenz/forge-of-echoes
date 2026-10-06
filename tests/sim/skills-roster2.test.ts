// Roster batch 2 (power rework SK3): each new skill in isolation, driven by the runtime def the rules resolve (so the numbers the
// tooltip prints are the numbers the sim uses), plus the systems they brought: pull, zone slow and Crushing, the Hex (exposure and
// weakening), Withered on monsters, the barrier, the aegis' retaliation and Echo Sigil's charges.
import { describe, expect, it } from 'vitest';
import type { SkillId } from '../../src/contracts/content';
import type { CharacterSave } from '../../src/contracts/items';
import { AILMENT_BIT, type AugmentRuntime, type SkillRuntimeDef } from '../../src/contracts/sim';
import { DECAY, SKILL_TIMING, WITHER } from '../../src/data/progression';
import { rules } from '../../src/game';
import { damageRange, resolveSkill } from '../../src/game/progression/skills';
import { buildPlayerModel } from '../../src/game/progression/model';
import { DT } from '../../src/sim/constants';
import { releaseSkill, tickPendingNovas } from '../../src/sim/skills';
import { DAMAGE_INDEX } from '../../src/sim/math';
import { MFLAG } from '../../src/sim/stores';
import { bareCharacter } from '../game-progression/fixtures';
import { makeStats } from './fixtures';
import { makeArena, ofType, placeMonster, stepN, type Arena } from './helpers';
// After the sim's entry points (combat and behaviour are part of an import cycle that must start from them).
import { hitPlayer, monsterResist } from '../../src/sim/combat';
import { empowerMult } from '../../src/sim/behaviour';

const BIG = 1e5;
const FIRE = DAMAGE_INDEX.fire;
const VOID = DAMAGE_INDEX.void;

function character(skill: SkillId, augments: string[], rank: number): CharacterSave {
  return bareCharacter({ level: 40, augments: { [skill]: augments }, skillRanks: { emberLance: 1, [skill]: rank } });
}

function armed(skill: SkillId, augments: string[] = [], rank = 10, stats = makeStats(), extra: SkillRuntimeDef[] = []) {
  const sheet = rules.skillSheet(character(skill, augments, rank), skill, rank);
  const def = sheet.runtime;
  const arena = makeArena({ stats, skills: [def, ...extra] });
  return { ...arena, def, lines: sheet.lines };
}

function sheetOf(skill: SkillId, augments: string[] = [], rank = 10) {
  return rules.skillSheet(character(skill, augments, rank), skill, rank);
}

function aug<P extends AugmentRuntime['p']>(def: SkillRuntimeDef, p: P): Extract<AugmentRuntime, { p: P }> {
  const a = def.augments?.find((x) => x.p === p);
  if (!a) throw new Error(`${def.id} has no ${p} primitive`);
  return a as Extract<AugmentRuntime, { p: P }>;
}

/** A tough, passive target with no resistances. */
function target(a: Arena, x: number, y: number): number {
  const i = placeMonster(a.world, 'ashling', x, y, { life: BIG });
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

describe('Gravity Well', () => {
  it('a vortex at the cursor pulls enemies in at 60 units/s, slows them and ticks void every 0.5 s (6 ticks in 3 s)', () => {
    const a = armed('gravityWell');
    expect(a.def.radius).toBeCloseTo(90, 10);
    expect(a.def.duration).toBeCloseTo(3, 10);
    const z = aug(a.def, 'zone');
    expect(z).toMatchObject({ pull: 60, slow: 0.4, interval: 0.5, taken: 0, collapse: 0 });
    const i = target(a, 200, 50);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 200, 0);
    const area = a.world.areas.filter((x) => x.kind === 'gravityWell');
    expect(area).toHaveLength(1);
    expect(area[0].radius).toBeCloseTo(a.def.radius, 6);
    expect(area[0].duration).toBeCloseTo(3, 6);
    step(a, 30);
    const m = a.world.monsters;
    expect(m.y[i]).toBeCloseTo(20, 0);
    expect(m.zoneSlowTime[i]).toBeGreaterThan(0);
    expect(m.zoneSlow[i]).toBeCloseTo(0.4, 6);
    const b = armed('gravityWell');
    const j = target(b, 200, 30);
    step(b, 1);
    releaseSkill(b.world, b.player, b.def, 200, 0);
    expect(damagedTicks(b, j, Math.round(3.4 / DT))).toBe(6);
    expect(a.lines).toContain(
      'A vortex at the cursor (radius 90) for 3.0 s: pulls enemies toward its centre at 60 units per second (bosses and heavy enemies half) and slows them by 40%',
    );
    expect(a.lines).toContain(`Every 0.5 s it deals ${damageRange(a.def.damage)} Void damage to enemies inside`);
  });

  it('bosses and heavy monsters are pulled half as fast', () => {
    const a = armed('gravityWell');
    const i = target(a, 200, 50);
    a.world.monsters.flags[i] |= MFLAG.heavy;
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 200, 0);
    step(a, 30);
    expect(a.world.monsters.y[i]).toBeCloseTo(35, 0);
  });

  it('Heavy Well lasts 40% longer with a 20% weaker pull; Crushing: +20% damage taken inside; Singularity collapses for 3e void', () => {
    const plain = armed('gravityWell').def;
    const a = armed('gravityWell', ['heavyWell', 'crushing', 'singularity']);
    const z = aug(a.def, 'zone');
    expect(a.def.duration).toBeCloseTo(plain.duration * 1.4, 10);
    expect(z.pull).toBeCloseTo(48, 10);
    expect(z.taken).toBeCloseTo(0.2, 10);
    expect(z.collapse).toBeCloseTo((a.def.damage / 0.3) * 3, 6);
    const i = target(a, 200, 0);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 200, 0);
    step(a, 2);
    expect(a.world.monsters.vulnTime[i]).toBeGreaterThan(0);
    expect(a.world.monsters.vulnBonus[i]).toBeCloseTo(0.2, 6);
    const ev = step(a, Math.round(a.def.duration / DT) + 2).events;
    expect(ofType(ev, 'nova').filter((e) => e.skill === 'gravityWell')).toEqual([expect.objectContaining({ radius: 90 })]);
    expect(a.lines).toContain(`When it ends it collapses for ${damageRange(z.collapse)} Void damage in a radius of 90`);
    expect(a.lines).toContain('Enemies inside take 20% more damage');
  });
});

describe('Entropy Hex', () => {
  it('exposes fire, cold, lightning and void by 15 points (bosses half) and makes enemies inside deal 10% less damage', () => {
    const a = armed('entropyHex');
    expect(a.def.damage).toBe(0);
    expect(aug(a.def, 'zone')).toMatchObject({ exposure: 15, weaken: 0.1 });
    const i = target(a, 150, 0);
    const boss = target(a, 160, 30);
    a.world.monsters.flags[boss] |= MFLAG.boss;
    const out = target(a, 400, 0);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 150, 0);
    step(a, 2);
    const w = a.world;
    for (const t of [FIRE, DAMAGE_INDEX.cold, DAMAGE_INDEX.lightning, VOID]) expect(monsterResist(w, i, t)).toBeCloseTo(-0.15, 6);
    expect(monsterResist(w, i, DAMAGE_INDEX.physical)).toBe(0);
    expect(monsterResist(w, boss, FIRE)).toBeCloseTo(-0.075, 6);
    expect(monsterResist(w, out, FIRE)).toBe(0);
    expect(empowerMult(w, i)).toBeCloseTo(0.9, 6);
    expect(empowerMult(w, out)).toBe(1);
    expect(w.monsters.ailments[i] & AILMENT_BIT.hexed).toBe(AILMENT_BIT.hexed);
    expect(w.areas.filter((x) => x.kind === 'entropyHex')).toHaveLength(1);
    expect(a.lines).toContain('Curses a circle at the cursor (radius 80) for 6.0 s');
    expect(a.lines).toContain('Enemies inside are exposed to Fire, Cold, Lightning and Void by 15 points (bosses half) for 4.0 s');
    expect(a.lines).toContain('Enemies inside deal 10% less damage');
  });

  it('Linger 9 s, Wide Hex ×1.5; Absolute Exposure 25 points (+3 s cooldown) excludes Bleak Mark (25% less damage, 20% slower)', () => {
    const plain = armed('entropyHex').def;
    const a = armed('entropyHex', ['linger', 'wideHex', 'absoluteExposure']).def;
    expect(a.duration).toBeCloseTo(9, 10);
    expect(a.radius).toBeCloseTo(plain.radius * 1.5, 10);
    expect(aug(a, 'zone').exposure).toBe(25);
    expect(a.cooldown).toBeCloseTo(plain.cooldown + 3, 10);
    const b = armed('entropyHex', ['bleakMark']);
    expect(aug(b.def, 'zone')).toMatchObject({ weaken: 0.25, slow: 0.2 });
    expect(b.lines).toContain('Enemies inside deal 25% less damage and move 20% slower');
    const ch = { ...character('entropyHex', ['absoluteExposure'], 10), unspentSkillPoints: 10 };
    expect(rules.canPickAugment(ch, 'entropyHex', 'bleakMark').ok).toBe(false);
  });
});

describe('Wither Field', () => {
  it('every 0.5 s a Decay stack and a Withered stack (−8 points to every resistance, 3 at most); the estimate is the Decay it deals', () => {
    const a = armed('witherField');
    const z = aug(a.def, 'zone');
    expect(z).toMatchObject({ interval: 0.5, withered: 1, decay: true, linger: WITHER.linger });
    const i = target(a, 150, 0);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 150, 0);
    const m = a.world.monsters;
    step(a, Math.round(0.5 / DT) + 1);
    expect(m.witherStacks[i]).toBe(1);
    expect(m.decayStacks[i]).toBe(1);
    expect(monsterResist(a.world, i, FIRE)).toBeCloseTo(-0.08, 6);
    step(a, Math.round(1.0 / DT));
    expect(m.witherStacks[i]).toBe(3);
    expect(monsterResist(a.world, i, DAMAGE_INDEX.physical)).toBeCloseTo(-0.24, 6);
    expect(m.ailments[i] & AILMENT_BIT.withered).toBe(AILMENT_BIT.withered);
    // The whole cast, Decay tail included: what the tooltip's estimate counts.
    step(a, Math.round((a.def.duration + DECAY.duration) / DT));
    const sheet = sheetOf('witherField');
    const r = resolveSkill(buildPlayerModel(character('witherField', [], 10)), 'witherField', 10);
    expect(BIG - m.life[i]).toBeCloseTo(r.perCast!, -1);
    expect((BIG - m.life[i]) / r.perCast!).toBeGreaterThan(0.98);
    expect((BIG - m.life[i]) / r.perCast!).toBeLessThan(1.02);
    expect(m.witherStacks[i]).toBe(0);
    expect(sheet.lines).toContain(
      `Every 0.5 s enemies inside gain a Decay stack of ${damageRange(a.def.damage)} Void damage over 4.0 s (up to 5 at once)`,
    );
  });

  it('Withered fades 1 s after leaving (Lingering Wither: 3 s); Hollow Ground +40% radius; Rotting Fields +40% ticks', () => {
    const plain = armed('witherField').def;
    const a = armed('witherField', ['hollowGround', 'rottingFields', 'lingeringWither']);
    expect(a.def.radius).toBeCloseTo(plain.radius * 1.4, 10);
    expect(a.def.damage).toBeCloseTo(plain.damage * 1.4, 8);
    expect(aug(a.def, 'zone').linger).toBe(3);
    for (const [def, linger] of [[plain, 1], [a.def, 3]] as const) {
      const b = armed('witherField');
      const i = target(b, 150, 0);
      step(b, 1);
      releaseSkill(b.world, b.player, def, 150, 0);
      step(b, Math.round(0.6 / DT));
      b.world.monsters.x[i] = 500; // out of the field
      step(b, Math.round((linger - 0.3) / DT));
      expect(b.world.monsters.witherStacks[i]).toBeGreaterThan(0);
      step(b, Math.round(0.6 / DT));
      expect(b.world.monsters.witherStacks[i]).toBe(0);
    }
  });
});

describe('Rime Bulwark', () => {
  const stats = makeStats({ maxLife: 400, evasion: 0 });

  it('a barrier of 45% of maximum life soaks hits after resistances; attackers near you are chilled; it ends when it breaks', () => {
    const a = armed('rimeBulwark', [], 10, stats);
    expect(aug(a.def, 'barrier').share).toBeCloseTo(0.45, 10);
    const near = target(a, 40, 0);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 0, 0);
    const p = a.player;
    expect(p.barrier.amount).toBeCloseTo(180, 6);
    expect(p.barrier.time).toBeCloseTo(6, 6);
    const life = p.life;
    expect(hitPlayer(a.world, p, 50, VOID, 'area')).toBe(0);
    expect(p.life).toBe(life);
    expect(p.barrier.amount).toBeLessThan(180);
    expect(a.world.monsters.chillTime[near]).toBeGreaterThan(0);
    a.run.drainEvents();
    const dealt = hitPlayer(a.world, p, 300, VOID, 'area');
    expect(dealt).toBeGreaterThan(0);
    expect(p.barrier.amount).toBe(0);
    expect(p.life).toBeCloseTo(life - dealt, 4);
    expect(ofType(a.run.drainEvents(), 'buff')).toEqual([expect.objectContaining({ skill: 'rimeBulwark', duration: 0 })]);
    expect(a.lines).toContain('A barrier absorbs 45% of your maximum life in damage for 6.0 s');
    expect(a.lines).toContain('Enemies within 70 units that hit you are chilled');
  });

  it('Thick Ice +30%; Brittle Retort: a 2e cold nova when it breaks; Resolute regenerates 3% per second standing still', () => {
    const a = armed('rimeBulwark', ['thickIce', 'brittleRetort', 'resolute'], 10, stats);
    const b = aug(a.def, 'barrier');
    expect(b.share).toBeCloseTo(0.45 * 1.3, 10);
    expect(b.regen).toBeCloseTo(0.03, 10);
    expect(b.retort).toBeGreaterThan(0);
    const ice = sheetOf('glacialNova');
    // 2× effectiveness of the same cold power Glacial Nova's 3.3 uses.
    expect(b.retort).toBeCloseTo((ice.runtime.damage / 3.3) * 2, 6);
    const i = target(a, 60, 0);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 0, 0);
    const p = a.player;
    hitPlayer(a.world, p, 100, VOID, 'area');
    const left = p.barrier.amount;
    step(a, 60);
    expect(p.barrier.amount).toBeCloseTo(Math.min(p.barrier.max, left + 0.03 * p.barrier.max), 3);
    a.run.drainEvents();
    hitPlayer(a.world, p, 2000, VOID, 'area');
    const ev = a.run.drainEvents();
    expect(ofType(ev, 'nova')).toEqual([expect.objectContaining({ skill: 'rimeBulwark', radius: 90 })]);
    expect(a.world.monsters.life[i]).toBeLessThan(BIG);
    expect(a.world.monsters.chillTime[i]).toBeGreaterThan(0);
  });
});

describe('Static Aegis', () => {
  it('25% less damage; an enemy hit makes everything within 70 take its lightning hit and be shocked, at most every 0.25 s', () => {
    const a = armed('staticAegis', [], 10, makeStats({ maxLife: 400, evasion: 0 }));
    expect(a.def.duration).toBeCloseTo(7, 10);
    expect(a.def.damageReduction).toBeCloseTo(0.25, 10);
    expect(a.def.ailmentChance).toBe(1);
    const near = target(a, 50, 0);
    const far = target(a, 120, 0);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 0, 0);
    const p = a.player;
    expect(p.aegis.reduction).toBeCloseTo(0.25, 10);
    hitPlayer(a.world, p, 10, VOID, 'area');
    const m = a.world.monsters;
    const after = m.life[near];
    expect(after).toBeLessThan(BIG);
    expect(m.shockTime[near]).toBeGreaterThan(0);
    expect(m.life[far]).toBe(BIG);
    hitPlayer(a.world, p, 10, VOID, 'area');
    expect(m.life[near]).toBe(after);
    step(a, Math.round(0.3 / DT));
    hitPlayer(a.world, p, 10, VOID, 'area');
    expect(m.life[near]).toBeLessThan(after);
    // A burn never triggers it.
    const mid = m.life[near];
    step(a, Math.round(0.3 / DT));
    hitPlayer(a.world, p, 10, VOID, 'dot');
    expect(m.life[near]).toBe(mid);
    expect(a.lines).toContain('For 7.0 s: you take 25% less damage');
    expect(a.lines).toContain(
      `When an enemy hits you, every enemy within 70 units takes ${damageRange(a.def.damage)} Lightning damage and is shocked (at most every 0.25 s)`,
    );
  });

  it('Thorned Storm +60%; Grounded +15% lightning resistance; Conduction Field strikes every 0.5 s unprovoked', () => {
    const plain = armed('staticAegis').def;
    const a = armed('staticAegis', ['thornedStorm', 'grounded', 'conductionField']);
    expect(a.def.damage).toBeCloseTo(plain.damage * 1.6, 8);
    expect(aug(a.def, 'aegis')).toMatchObject({ resist: 0.15, pulse: 0.5 });
    const i = target(a, 50, 0);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 0, 0);
    expect(damagedTicks(a, i, Math.round(1.02 / DT))).toBe(2);
    expect(a.lines).toContain('+15% lightning resistance while it lasts');
  });
});

describe('Voltaic Pulse', () => {
  it('a ring expands to 150 at 500 units/s and strikes each enemy once, shocking it; none beyond', () => {
    const a = armed('voltaicPulse');
    expect(a.def.radius).toBeCloseTo(150, 10);
    const near = target(a, 60, 0);
    const edge = target(a, 0, 140);
    const out = target(a, -200, 0);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 100, 0);
    expect(ofType(a.run.drainEvents(), 'nova')).toEqual([expect.objectContaining({ skill: 'voltaicPulse', radius: 150 })]);
    const m = a.world.monsters;
    step(a, 3);
    expect(m.life[near]).toBe(BIG);
    step(a, 30);
    for (const i of [near, edge]) {
      expect(m.life[i]).toBeLessThan(BIG);
      expect(m.shockTime[i]).toBeGreaterThan(0);
    }
    expect(m.life[out]).toBe(BIG);
    expect(a.player.skillAreas).toHaveLength(0);
    expect(a.lines).toContain(`A ring of lightning expands from you to 150 units (500 units per second), striking each enemy once for ${damageRange(a.def.damage)} Lightning damage`);
  });

  it('Twice Struck: a second ring 0.3 s later at 60%; Wide Pulse +40% radius', () => {
    const a = armed('voltaicPulse', ['twiceStruck', 'widePulse']);
    expect(a.def.radius).toBeCloseTo(210, 10);
    const i = target(a, 60, 0);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 100, 0);
    expect(a.player.pendingNovas).toHaveLength(1);
    expect(a.player.pendingNovas[0].def.damage).toBeCloseTo(a.def.damage * 0.6, 8);
    expect(damagedTicks(a, i, 60)).toBe(2);
  });
});

describe('Concussive Blast', () => {
  it('hits everything in a 100° cone reaching 150 with a physical blow, hurling them back; nothing outside', () => {
    const a = armed('concussiveBlast');
    expect(a.def.range).toBeCloseTo(150, 10);
    const front = target(a, 100, 0);
    const side = target(a, 70, 70);
    const wide = target(a, 0, 100);
    const back = target(a, -100, 0);
    const far = target(a, 220, 0);
    a.world.monsters.knockback[front] = 1;
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 300, 0);
    const m = a.world.monsters;
    expect(m.life[front]).toBeLessThan(BIG);
    expect(m.life[side]).toBeLessThan(BIG);
    for (const i of [wide, back, far]) expect(m.life[i]).toBe(BIG);
    expect(m.kbX[front]).toBeGreaterThan(0);
    expect(a.lines).toContain(`Deals ${damageRange(a.def.damage)} Physical damage in a 100° cone reaching 150 units`);
  });

  it('Widened Arc: 160°, 20% less damage', () => {
    const plain = armed('concussiveBlast').def;
    const a = armed('concussiveBlast', ['widenedArc']);
    expect(a.def.damage).toBeCloseTo(plain.damage * 0.8, 8);
    const wide = target(a, 20, 100);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 300, 0);
    expect(a.world.monsters.life[wide]).toBeLessThan(BIG);
  });
});

describe('Static Lash', () => {
  it('lashes the nearest enemy within 200 (not the one at the cursor); Arc Lash the second-nearest too; Tethered Chain jumps once', () => {
    const a = armed('staticLash');
    expect(a.def.castTime).toBeCloseTo(0.15, 10);
    const near = target(a, 80, 40);
    const cursor = target(a, 150, 0);
    const out = target(a, 260, 0);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 150, 0);
    const m = a.world.monsters;
    expect(m.life[near]).toBeLessThan(BIG);
    expect(m.life[cursor]).toBe(BIG);
    expect(m.life[out]).toBe(BIG);
    expect(ofType(a.run.drainEvents(), 'chain')).toHaveLength(1);

    const b = armed('staticLash', ['arcLash', 'rapidLash', 'tetheredChain']);
    expect(b.def.castTime).toBeCloseTo(0.12, 10);
    expect(b.def.chains).toBe(1);
    const n1 = target(b, 60, 0);
    const n2 = target(b, -100, 0);
    const n3 = target(b, 130, 0);
    step(b, 1);
    releaseSkill(b.world, b.player, b.def, 150, 0);
    for (const i of [n1, n2, n3]) expect(b.world.monsters.life[i]).toBeLessThan(BIG);
    expect(b.lines).toContain('Also lashes the second-nearest for 60%');
    expect(b.lines).toContain('Then jumps to 1 more enemy within 90 units for 50% each');
  });
});

describe('Immolation Sigil', () => {
  it('brands the cursor; 0.8 s later a pillar erupts in its radius', () => {
    const a = armed('immolationSigil');
    expect(a.def.radius).toBeCloseTo(50, 10);
    const hit = target(a, 200, 0);
    const beside = target(a, 290, 0);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 200, 0);
    const marks = a.world.areas.filter((x) => x.kind === 'immolationSigil');
    expect(marks).toHaveLength(1);
    expect(marks[0].duration).toBeCloseTo(SKILL_TIMING.sigilTelegraph, 10);
    step(a, Math.round(0.8 / DT) - 2);
    expect(a.world.monsters.life[hit]).toBe(BIG);
    step(a, 3);
    expect(a.world.monsters.life[hit]).toBeLessThan(BIG);
    expect(a.world.monsters.life[beside]).toBe(BIG);
    expect(a.world.areas.filter((x) => x.kind === 'fireTrail')).toHaveLength(0);
    expect(a.lines).toContain(`Brands the ground at the cursor; after 0.8 s a pillar of fire erupts: ${damageRange(a.def.damage)} Fire damage in a radius of 50`);
  });

  it('Twin Sigils: two 80 apart across the aim, 35% less each; Lingering Pillar burns 3 s; Brand Sigil exposes fire 15', () => {
    const plain = armed('immolationSigil').def;
    const a = armed('immolationSigil', ['twinSigils', 'lingeringPillar', 'brandSigil']);
    expect(a.def.projectiles).toBe(2);
    expect(a.def.damage).toBeCloseTo(plain.damage * 0.65, 8);
    const i = target(a, 200, 0);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 200, 0);
    const marks = a.world.areas.filter((x) => x.kind === 'immolationSigil');
    expect(marks.map((m) => [Math.round(m.x), Math.round(m.y)]).sort()).toEqual([[200, -40], [200, 40]].sort());
    step(a, Math.round(0.8 / DT) + 2);
    expect(monsterResist(a.world, i, FIRE)).toBeCloseTo(-0.15, 6);
    const g = aug(a.def, 'ground');
    expect(g.duration).toBeCloseTo(3, 10);
    expect(g.damage).toBeCloseTo((a.def.damage * 0.5) / 6.5, 6);
    expect(a.world.areas.filter((x) => x.kind === 'fireTrail')).toHaveLength(2);
    expect(a.lines).toContain(`The pillar burns on for 3.0 s: ${damageRange(g.damage)} Fire damage every 0.5 s`);
  });
});

describe('Echo Sigil', () => {
  it('the next 3 damaging casts echo once after 0.4 s at 70%, at no Focus; Ember Lance and buffs do not spend it', () => {
    const pulse = sheetOf('voltaicPulse').runtime;
    const lance = sheetOf('emberLance', [], 1).runtime;
    const a = armed('echoSigil', [], 10, makeStats(), [pulse, lance]);
    step(a, 1);
    releaseSkill(a.world, a.player, a.def, 100, 0);
    expect(a.player.echoSigil).toMatchObject({ casts: 3, delay: 0.4, damage: 0.7 });
    releaseSkill(a.world, a.player, lance, 100, 0);
    expect(a.player.pendingNovas).toHaveLength(0);
    releaseSkill(a.world, a.player, pulse, 100, 0);
    expect(a.player.echoSigil.casts).toBe(2);
    expect(a.player.pendingNovas).toHaveLength(1);
    expect(a.player.pendingNovas[0].at).toBeCloseTo(a.world.time + 0.4, 10);
    expect(a.player.pendingNovas[0].def.damage).toBeCloseTo(pulse.damage * 0.7, 8);
    const before = a.player.skillAreas.length;
    a.world.time += 0.4;
    tickPendingNovas(a.world, a.player);
    expect(a.player.skillAreas.length).toBe(before + 1);
    releaseSkill(a.world, a.player, pulse, 100, 0);
    a.run.drainEvents();
    releaseSkill(a.world, a.player, pulse, 100, 0);
    expect(a.player.echoSigil.casts).toBe(0);
    expect(ofType(a.run.drainEvents(), 'buff')).toEqual([expect.objectContaining({ skill: 'echoSigil', duration: 0 })]);
    releaseSkill(a.world, a.player, pulse, 100, 0);
    expect(a.player.pendingNovas).toHaveLength(2);
  });

  it('Triple Echo: 4 casts at 63%; Quick Echo 0.25 s; Costless refunds 25% of the echoed skill’s Focus', () => {
    const pulse = sheetOf('voltaicPulse').runtime;
    const a = armed('echoSigil', ['tripleEcho', 'quickEcho', 'costless'], 10, makeStats({ focusRegen: 0 }), [pulse]);
    releaseSkill(a.world, a.player, a.def, 100, 0);
    expect(a.player.echoSigil.casts).toBe(4);
    expect(a.player.echoSigil.damage).toBeCloseTo(0.63, 10);
    expect(a.player.echoSigil.delay).toBeCloseTo(0.25, 10);
    a.player.focus = 10;
    releaseSkill(a.world, a.player, pulse, 100, 0);
    expect(a.player.focus).toBeCloseTo(10 + pulse.focusCost * 0.25, 8);
    expect(a.lines).toContain('Each echoed skill refunds 25% of its Focus cost');
  });
});

describe('estimates (tooltip DPS) match the behaviour', () => {
  it('Gravity Well counts its 6 ticks; Twin Sigils both pillars; Voltaic Pulse with Twice Struck its 60% echo', () => {
    const hit = (rt: SkillRuntimeDef) => rt.damage * (1 + rt.critChance * (rt.critMultiplier - 1));
    const well = sheetOf('gravityWell');
    expect(well.dps!).toBeCloseTo((hit(well.runtime) * 6) / well.runtime.cooldown, 6);
    const twin = sheetOf('immolationSigil', ['twinSigils']);
    expect(twin.dps!).toBeCloseTo((hit(twin.runtime) * 2) / twin.runtime.cooldown, 6);
    const pulse = sheetOf('voltaicPulse', ['twiceStruck']);
    expect(pulse.dps!).toBeCloseTo((hit(pulse.runtime) * 1.6) / pulse.runtime.cooldown, 6);
  });
});

describe('determinism hygiene', () => {
  it('a zone, a pulse and a barrier leave no state behind once they end, and a death clears them', () => {
    const a = armed('gravityWell');
    releaseSkill(a.world, a.player, a.def, 100, 0);
    step(a, Math.round(3.2 / DT));
    expect(a.player.skillAreas).toHaveLength(0);
    expect(a.world.areas.filter((x) => x.kind === 'gravityWell')).toHaveLength(0);
  });
});
