// The flagship augment primitives (power rework SK5, src/sim/skills/primitives): each in isolation, driven by the runtime def the
// rules resolve for the picked augment, so the numbers the tooltip prints are the numbers the sim uses. Hit rolls are pinned to
// their average (combatRng.range → 1) and crits are off, so damages compare exactly against the augment text.
import { describe, expect, it } from 'vitest';
import type { SkillId } from '../../src/contracts/content';
import type { CharacterSave } from '../../src/contracts/items';
import { AILMENT_BIT, PROJECTILE_KINDS, type AugmentRuntime, type SkillRuntimeDef, type SimEvent } from '../../src/contracts/sim';
import { EXPOSURE, SKILLS } from '../../src/data/progression';
import { rules } from '../../src/game';
import { buildPlayerModel } from '../../src/game/progression/model';
import { resolveSkill } from '../../src/game/progression/skills';
import { DT, SHOCK_BONUS } from '../../src/sim/constants';
import { releaseSkill, tickWard } from '../../src/sim/skills';
import { castCost, lodgesOf, markTakenMult, noteCast, ON_KILL_CAP, wardCapOf } from '../../src/sim/skills/primitives';
import { lodgeIn } from '../../src/sim/skills/primitives/lodge';
import { markShock } from '../../src/sim/skills/primitives/mark';
import { bareCharacter } from '../game-progression/fixtures';
import { makeStats } from './fixtures';
import { makeArena, ofType, placeMonster, stepN, type Arena } from './helpers';
// After the sim's entry points (combat is part of an import cycle that must start from them).
import { killMonster } from '../../src/sim/combat';

const BIG = 1e5;

interface Armed extends Arena {
  def: SkillRuntimeDef;
  lines: string[];
}

/** A rank-10 skill with `augments`, resolved by the rules, in a bare arena; rolls pinned, no crits. */
function armed(skill: SkillId, augments: string[] = [], over: Partial<SkillRuntimeDef> = {}): Armed {
  const ch: CharacterSave = bareCharacter({ level: 40, augments: { [skill]: augments }, skillRanks: { emberLance: 1, [skill]: 10 } });
  const sheet = rules.skillSheet(ch, skill, 10);
  const def: SkillRuntimeDef = { ...sheet.runtime, critChance: 0, ...over };
  const arena = makeArena({ stats: makeStats({ maxFocus: 500 }), skills: [def] });
  (arena.world.combatRng as { range: (lo: number, hi: number) => number }).range = () => 1;
  return { ...arena, def, lines: sheet.lines };
}

function aug<P extends AugmentRuntime['p']>(def: SkillRuntimeDef, p: P): Extract<AugmentRuntime, { p: P }> {
  const a = def.augments?.find((x) => x.p === p);
  if (!a) throw new Error(`${def.id} has no ${p} primitive`);
  return a as Extract<AugmentRuntime, { p: P }>;
}

/** The text of a skill's augment. */
function text(skill: SkillId, id: string): string {
  const a = SKILLS[skill].augmentDefs.find((x) => x.id === id);
  if (!a) throw new Error(`${skill}.${id}`);
  return a.text;
}

/** A tough, passive target without resistances. */
function target(a: Arena, x: number, y: number, life = BIG): number {
  const i = placeMonster(a.world, 'ashling', x, y, { life });
  for (let k = 0; k < 5; k++) a.world.monsters.res[i * 5 + k] = 0;
  return i;
}

function lost(a: Arena, i: number, life = BIG): number {
  return life - a.world.monsters.life[i];
}

function close(actual: number, expected: number, rel = 2e-3): void {
  expect(Math.abs(actual - expected), `${actual} ≈ ${expected}`).toBeLessThanOrEqual(Math.abs(expected) * rel + 1e-6);
}

function live(a: Arena, kind: (typeof PROJECTILE_KINDS)[number]): number[] {
  const p = a.world.projectiles;
  const code = PROJECTILE_KINDS.indexOf(kind);
  return Array.from({ length: p.hwm }, (_, i) => i).filter((i) => p.alive[i] && p.kind[i] === code);
}

function step(a: Arena, n: number): SimEvent[] {
  return stepN(a.run, n).events;
}

function augmentEvents(events: SimEvent[], fx?: string) {
  return ofType(events, 'augment').filter((e) => fx === undefined || e.fx === fx);
}

const ticks = (s: number) => Math.round(s / DT);

/** Let the arena's spatial grid pick up freshly placed monsters, then release the skill toward (x, y). */
function cast(a: Armed, def: SkillRuntimeDef, x: number, y: number): void {
  step(a, 1);
  releaseSkill(a.world, a.player, def, x, y);
}

describe('expose', () => {
  it('Searing Brand: hits expose fire −15 pp for EXPOSURE.duration, +25 ignite chance, 12% less damage (as its text says)', () => {
    expect(text('emberLance', 'searingBrand')).toContain('Fire −15 pp for 4 seconds');
    expect(EXPOSURE.duration).toBe(4);
    const plain = armed('emberLance');
    const a = armed('emberLance', ['searingBrand']);
    expect(aug(a.def, 'expose').points).toEqual([0, 15, 0, 0, 0]);
    expect(a.def.damage).toBeCloseTo(plain.def.damage * 0.88, 8);
    expect(a.def.ailmentChance).toBeCloseTo(plain.def.ailmentChance + 0.25, 8);
    const t = target(a, 80, 0);
    cast(a, a.def, 80, 0);
    step(a, 20);
    expect(a.world.monsters.expose[t * 5 + 1]).toBeCloseTo(0.15, 6);
    expect(a.world.monsters.exposeTime[t]).toBeGreaterThan(3.5);
  });

  it('Brittle Shards exposes cold −12 pp; Void Exposure void −20 and the three elements −8', () => {
    const b = armed('rimeShards', ['brittleShards'], { projectiles: 1 });
    expect(text('rimeShards', 'brittleShards')).toContain('Cold −12 pp');
    const t = target(b, 60, 0);
    cast(b, b.def, 60, 0);
    step(b, 15);
    expect(b.world.monsters.expose[t * 5 + 2]).toBeCloseTo(0.12, 6);
    const v = armed('umbralBolt', ['voidExposure']);
    expect(aug(v.def, 'expose').points).toEqual([0, 8, 8, 8, 20]);
    const u = target(v, 60, 0);
    cast(v, v.def, 60, 0);
    step(v, 25);
    const m = v.world.monsters;
    expect([0, 1, 2, 3, 4].map((k) => Math.round(m.expose[u * 5 + k] * 100))).toEqual([0, 8, 8, 8, 20]);
  });
});

describe('convert', () => {
  it('Frostfire Core: 50% of the hit becomes cold and the hit always chills, even without a chill chance', () => {
    const a = armed('emberLance', ['frostfireCore'], { ailmentChance: 0 });
    expect(aug(a.def, 'convert')).toMatchObject({ to: 'cold', share: 0.5, ailment: 'always' });
    const t = target(a, 80, 0);
    cast(a, a.def, 80, 0);
    const [slot] = live(a, 'emberLance');
    expect(a.world.projectiles.convShare[slot]).toBeCloseTo(0.5, 6);
    expect(a.world.projectiles.convTo[slot]).toBe(2);
    step(a, 20);
    expect(a.world.monsters.chillTime[t]).toBeGreaterThan(0);
    close(lost(a, t), a.def.damage);
  });

  it('Inverted Heat: hits ignite instead of chilling (the tooltip says Ignite)', () => {
    const a = armed('rimeShards', ['invertedHeat'], { projectiles: 1, ailmentChance: 1 });
    expect(a.lines.some((l) => l.includes('chance to Ignite'))).toBe(true);
    const t = target(a, 60, 0);
    cast(a, a.def, 60, 0);
    step(a, 15);
    expect(a.world.monsters.igniteTime[t]).toBeGreaterThan(0);
    expect(a.world.monsters.chillTime[t]).toBe(0);
  });

  it('Void Convert: half the hit becomes void and hits apply Decay at 40%', () => {
    const a = armed('kineticLance', ['voidConvert']);
    expect(aug(a.def, 'convert')).toMatchObject({ to: 'void', share: 0.5, ailment: 'decay', decay: 0.4 });
    expect(text('kineticLance', 'voidConvert')).toContain('40% of the hit');
    const t = target(a, 80, 0);
    cast(a, a.def, 80, 0);
    step(a, 15);
    expect(a.world.monsters.decayStacks[t]).toBe(1);
  });
});

describe('lodge', () => {
  it('Lodge Ember: sticks in the first enemy, then detonates after 1.2 s for 240% in a radius of 46', () => {
    const a = armed('emberLance', ['lodgeEmber']);
    const k = aug(a.def, 'lodge');
    expect(k).toMatchObject({ share: 2.4, radius: 46, fuse: 1.2, max: 8 });
    expect(text('emberLance', 'lodgeEmber')).toContain('after 1.2 seconds or on its death for 240% of the hit as fire in a radius of 46');
    const host = target(a, 80, 0);
    const near = target(a, 80, 35);
    const far = target(a, 80, 80);
    cast(a, a.def, 80, 0);
    let events = step(a, 15);
    expect(live(a, 'emberLance')).toHaveLength(0);
    expect(lodgesOf(a.world, a.player.id)).toBe(1);
    expect(augmentEvents(events, 'lodge')).toHaveLength(1);
    expect(a.world.monsters.ailments[host] & AILMENT_BIT.lodged).toBeTruthy();
    expect(lost(a, near)).toBe(0);
    events = step(a, ticks(1.2) + 1);
    expect(augmentEvents(events, 'detonate')).toEqual([expect.objectContaining({ radius: 46, damageType: 'fire' })]);
    close(lost(a, near), a.def.damage * 2.4);
    close(lost(a, host), a.def.damage * 3.4);
    expect(lost(a, far)).toBe(0);
    expect(lodgesOf(a.world, a.player.id)).toBe(0);
  });

  it('a lodge goes off at once when its host dies, where the host stood', () => {
    const a = armed('emberLance', ['lodgeEmber']);
    const host = target(a, 80, 0);
    const near = target(a, 80, 35);
    cast(a, a.def, 80, 0);
    step(a, 15);
    expect(lodgesOf(a.world, a.player.id)).toBe(1);
    killMonster(a.world, host, 1, true, a.player.id);
    const events = step(a, 1);
    expect(augmentEvents(events, 'detonate')).toHaveLength(1);
    close(lost(a, near), a.def.damage * 2.4);
  });

  it('Lodged Ice: three shards in one enemy detonate together for 150% each; a player holds at most 8 lodges', () => {
    const a = armed('rimeShards', ['lodgedIce'], { projectiles: 3, spread: 0.02 });
    expect(aug(a.def, 'lodge')).toMatchObject({ share: 1.5, radius: 40, fuse: 1, burst: 3, max: 8 });
    target(a, 60, 0);
    cast(a, a.def, 60, 0);
    const events = step(a, 12);
    expect(augmentEvents(events, 'detonate')).toHaveLength(3);
    expect(lodgesOf(a.world, a.player.id)).toBe(0);

    const b = armed('emberLance', ['lodgeEmber']);
    const k = aug(b.def, 'lodge');
    const hosts = Array.from({ length: 9 }, (_, n) => target(b, -200 + n * 50, 200));
    const shot = { owner: b.player.id, skill: 'emberLance' as SkillId, damage: 10, dtype: 1, critChance: 0, critMult: 1.5, ailmentChance: 0 };
    const placed = hosts.map((h) => lodgeIn(b.world, h, shot, k));
    expect(placed).toEqual([true, true, true, true, true, true, true, true, false]);
  });

  it('Soulbind Lodge waits 2 s and detonates for 300% in a radius of 70', () => {
    const a = armed('umbralBolt', ['soulbindLodge']);
    expect(aug(a.def, 'lodge')).toMatchObject({ share: 3, radius: 70, fuse: 2 });
    target(a, 60, 0);
    const near = target(a, 60, 60);
    cast(a, a.def, 60, 0);
    step(a, 20);
    expect(lost(a, near)).toBe(0);
    step(a, ticks(2));
    close(lost(a, near), a.def.damage * 3);
  });
});

describe('split', () => {
  it('Cinder Fragments: a kill releases 3 fragments at 55% aimed at the nearest enemies within 140', () => {
    const a = armed('emberLance', ['cinderFragments']);
    expect(aug(a.def, 'split')).toMatchObject({ on: 'kill', count: 3, share: 0.55, seek: 140 });
    const victim = target(a, 80, 0, 1);
    target(a, 180, 0);
    target(a, 80, 100);
    target(a, 80, -100);
    cast(a, a.def, 80, 0);
    for (let k = 0; k < 30 && a.world.monsters.alive[victim]; k++) step(a, 1);
    const kids = live(a, 'emberLance');
    expect(kids).toHaveLength(3);
    for (const s of kids) expect(a.world.projectiles.damage[s]).toBeCloseTo(a.def.damage * 0.55, 3);
    const angles = kids.map((s) => Math.round((Math.atan2(a.world.projectiles.vy[s], a.world.projectiles.vx[s]) * 180) / Math.PI)).sort((x, y) => x - y);
    expect(angles).toEqual([-90, 0, 90]);
  });

  it('Splintering: at the end of its flight a shard bursts into 3 splinters at 40% (range 90); children never split again', () => {
    const a = armed('rimeShards', ['splintering'], { projectiles: 1 });
    cast(a, a.def, 100, 0);
    let n = 0;
    for (let k = 0; k < 120 && n !== 3; k++) {
      step(a, 1);
      n = live(a, 'rimeShard').length;
    }
    const kids = live(a, 'rimeShard');
    expect(kids).toHaveLength(3);
    for (const s of kids) {
      expect(a.world.projectiles.damage[s]).toBeCloseTo(a.def.damage * 0.4, 3);
      expect(a.world.projectiles.range[s]).toBeLessThanOrEqual(90);
    }
    step(a, 60);
    expect(live(a, 'rimeShard')).toHaveLength(0);
  });

  it('Entropic Split: on its first hit the bolt splits into 2 bolts at ±25°, 60% each', () => {
    const a = armed('umbralBolt', ['entropicSplit']);
    target(a, 60, 0);
    cast(a, a.def, 60, 0);
    let bolts: number[] = [];
    for (let k = 0; k < 30 && bolts.length < 3; k++) {
      step(a, 1);
      bolts = live(a, 'umbralBolt');
    }
    const kids = bolts.filter((s) => Math.abs(a.world.projectiles.damage[s] - a.def.damage * 0.6) < 1e-3 * a.def.damage);
    expect(kids).toHaveLength(2);
    const deg = kids.map((s) => Math.round((Math.atan2(a.world.projectiles.vy[s], a.world.projectiles.vx[s]) * 180) / Math.PI)).sort((x, y) => x - y);
    expect(deg).toEqual([-25, 25]);
  });
});

describe('chain: fork, return, ramp, mark, on-kill', () => {
  it('Forking Arc: at the last link the bolt forks into 2 branches at 50%', () => {
    const a = armed('arcChain', ['forkingArc'], { chains: 1, ailmentChance: 0 });
    expect(aug(a.def, 'fork')).toMatchObject({ branches: 2, links: 3, share: 0.5 });
    const A = target(a, 100, 0);
    const B = target(a, 160, 0);
    const C = target(a, 160, 60);
    const D = target(a, 160, -60);
    cast(a, a.def, 100, 0);
    const events = step(a, 1);
    close(lost(a, A), a.def.damage);
    close(lost(a, B), a.def.damage);
    close(lost(a, C), a.def.damage * 0.5);
    close(lost(a, D), a.def.damage * 0.5);
    expect(ofType(events, 'chain').length).toBeGreaterThanOrEqual(3);
  });

  it('Storm Return: the final link returns to the first target for a second hit at 80%', () => {
    const a = armed('arcChain', ['stormReturn'], { chains: 1, ailmentChance: 0 });
    const A = target(a, 100, 0);
    const B = target(a, 160, 0);
    cast(a, a.def, 100, 0);
    step(a, 1);
    close(lost(a, A), a.def.damage * 1.8);
    close(lost(a, B), a.def.damage);
  });

  it('Overcharge: each jump deals 12% more than the last, starting 20% lower', () => {
    const a = armed('arcChain', ['overcharge'], { chains: 2, ailmentChance: 0 });
    const ids = [target(a, 100, 0), target(a, 160, 0), target(a, 220, 0)];
    cast(a, a.def, 100, 0);
    step(a, 1);
    [0.8, 0.92, 1.04].forEach((f, k) => close(lost(a, ids[k]), a.def.damage * f));
  });

  it('Conductive Mark: the first target is marked 3 s: 15% more damage taken, +30% shock chance for Arc Chain', () => {
    const a = armed('arcChain', ['conductiveMark'], { chains: 1, ailmentChance: 0 });
    expect(aug(a.def, 'mark')).toMatchObject({ seconds: 3, taken: 0.15, shock: 0.3, first: true });
    const A = target(a, 100, 0);
    const B = target(a, 160, 0);
    cast(a, a.def, 100, 0);
    step(a, 1);
    expect(markTakenMult(a.world, A)).toBeCloseTo(1.15, 8);
    expect(markTakenMult(a.world, B)).toBe(1);
    expect(markShock(a.world, A, a.player.id, 'arcChain')).toBeCloseTo(0.3, 8);
    expect(a.world.monsters.ailments[A] & AILMENT_BIT.marked).toBeTruthy();
    const before = lost(a, A);
    cast(a, a.def, 100, 0);
    // The mark's +30% shock chance may shock it on this hit (shock lands before the damage: +20%).
    close(lost(a, A) - before, a.def.damage * 1.15 * (a.world.monsters.shockTime[A] > 0 ? 1 + SHOCK_BONUS : 1));
    step(a, ticks(3) + 2);
    expect(markTakenMult(a.world, A)).toBe(1);
  });

  it('Static Discharge: an enemy killed while shocked explodes for 150% of the hit in a radius of 60', () => {
    const a = armed('arcChain', ['staticDischarge'], { chains: 0, ailmentChance: 0 });
    const A = target(a, 100, 0, 1);
    a.world.monsters.shockTime[A] = 1;
    const E = target(a, 100, 50);
    cast(a, a.def, 100, 0);
    // The kill hit is the shocked hit (×1.2 shock bonus); the explosion is 150% of the skill's hit.
    close(lost(a, E), a.def.damage * 1.5);
    // Without a shock, no explosion.
    const b = armed('arcChain', ['staticDischarge'], { chains: 0, ailmentChance: 0 });
    target(b, 100, 0, 1);
    const F = target(b, 100, 50);
    cast(b, b.def, 100, 0);
    expect(lost(b, F)).toBe(0);
  });
});

describe('on kill', () => {
  it('Shatter Rounds: a kill explodes for 12% of the dead enemy’s maximum life, at most 3 deep', () => {
    const a = armed('kineticLance', ['shatterRounds']);
    expect(aug(a.def, 'onKill')).toMatchObject({ of: 'life', share: 0.12, radius: 40, needs: 'any', depth: 3 });
    // A row of weak, heavy monsters 30 apart: each explosion kills the next.
    const row = [0, 1, 2, 3, 4].map((n) => {
      const i = target(a, 80 + n * 30, 0, 1000);
      a.world.monsters.life[i] = 1;
      return i;
    });
    cast(a, a.def, 80, 0);
    let events: SimEvent[] = [];
    for (let k = 0; k < 20 && a.world.monsters.alive[row[0]]; k++) events = events.concat(step(a, 1));
    expect(augmentEvents(events, 'explode')).toHaveLength(3);
    expect(a.world.monsters.alive[row[4]]).toBe(1);
  });

  it(`a player triggers at most ${ON_KILL_CAP} on-kill effects per tick`, () => {
    const a = armed('kineticLance', ['shatterRounds']);
    const first = target(a, 80, 0, 1000);
    a.world.monsters.life[first] = 1;
    for (let n = 0; n < 12; n++) {
      const i = target(a, 80 + Math.cos(n) * 20, Math.sin(n) * 20, 1000);
      a.world.monsters.life[i] = 1;
    }
    cast(a, a.def, 80, 0);
    let events: SimEvent[] = [];
    for (let k = 0; k < 20 && a.world.monsters.alive[first]; k++) events = events.concat(step(a, 1));
    expect(augmentEvents(events, 'explode').length).toBeLessThanOrEqual(ON_KILL_CAP);
  });

  it('Glacial Nova Shatter: a chilled enemy it kills explodes for 10% of its life as cold; Freezing Core: +60% within 40', () => {
    const a = armed('glacialNova', ['shatter'], { ailmentChance: 0 });
    const v = target(a, 60, 0, 2000);
    a.world.monsters.life[v] = 1;
    a.world.monsters.chillTime[v] = 1;
    const n = target(a, 200, 0);
    const n2 = target(a, 60, 35);
    cast(a, a.def, 100, 0);
    expect(lost(a, n)).toBe(0);
    // n2 takes the nova and the explosion (10% of 2000).
    close(lost(a, n2), a.def.damage + 200);

    const c = armed('glacialNova', ['freezingCore'], { ailmentChance: 0 });
    expect(aug(c.def, 'core')).toEqual({ p: 'core', radius: 40, more: 0.6 });
    const inner = target(c, 25, 0);
    const outer = target(c, 100, 0);
    cast(c, c.def, 100, 0);
    close(lost(c, inner), c.def.damage * 1.6);
    close(lost(c, outer), c.def.damage);
  });
});

describe('trail', () => {
  it('Burning Wake: waves leave fire trails (radius 14, 2 s) burning 0.35× effectiveness every 0.5 s', () => {
    const a = armed('flameWave', ['burningWake'], { projectiles: 1 });
    const t = aug(a.def, 'trail');
    const r = resolveSkill(buildPlayerModel(bareCharacter({ level: 40 })), 'flameWave', 10, ['burningWake']);
    expect(t.damage).toBeCloseTo((r.runtime.damage * 0.35) / r.effectiveness, 6);
    cast(a, a.def, 100, 0);
    step(a, 40);
    const trails = a.world.areas.filter((x) => x.kind === 'fireTrail');
    expect(trails.length).toBeGreaterThanOrEqual(3);
    for (const x of trails) {
      expect(x.radius).toBe(14);
      expect(x.duration).toBe(2);
      expect(x.damage).toBeCloseTo(t.damage, 6);
      expect(x.tickInterval).toBe(0.5);
    }
  });

  it('Kiln Ring: every flame leaves burning ground (radius 16) where it ends', () => {
    const a = armed('emberNova', ['kilnRing']);
    cast(a, a.def, 100, 0);
    step(a, 60);
    const ground = a.world.areas.filter((x) => x.kind === 'fireTrail' && x.radius === 16);
    expect(ground).toHaveLength(a.def.projectiles);
  });

  it('Frost Comb chills enemies on the spikes’ ground; Thunder Mark’s field damages and shocks', () => {
    const a = armed('glacialSpikes', ['frostComb'], { ailmentChance: 0 });
    const t = target(a, 60, 0);
    cast(a, a.def, 200, 0);
    step(a, 30);
    expect(a.world.areas.filter((x) => x.kind === 'frostGround').length).toBe(a.def.projectiles);
    a.world.monsters.chillTime[t] = 0;
    step(a, 2);
    expect(a.world.monsters.chillTime[t]).toBeGreaterThan(0);

    const s = armed('stormCall', ['thunderMark'], { ailmentChance: 0, projectiles: 1, range: 1 });
    const tm = aug(s.def, 'trail');
    expect(tm).toMatchObject({ area: 'staticField', duration: 3, interval: 0.5, ailment: true });
    const u = target(s, 150, 0);
    cast(s, s.def, 150, 0);
    step(s, ticks(0.7) + 2);
    const hit = lost(s, u);
    step(s, ticks(1.1));
    expect(s.world.monsters.shockTime[u]).toBeGreaterThan(0);
    expect(lost(s, u) - hit).toBeGreaterThan(tm.damage * 1.5);
  });

  it('Magma Core: the shell leaves a molten pool (radius 40, 4 s) that chills and exposes fire −10 pp', () => {
    const a = armed('cinderMortar', ['magmaCore'], { ailmentChance: 0 });
    const t = target(a, 150, 0);
    cast(a, a.def, 150, 0);
    step(a, ticks(0.9) + 3);
    const pool = a.world.areas.find((x) => x.kind === 'fireTrail' && x.radius === 40);
    expect(pool?.duration).toBe(4);
    expect(a.world.monsters.expose[t * 5 + 1]).toBeCloseTo(0.1, 6);
    expect(a.world.monsters.chillTime[t]).toBeGreaterThan(0);
  });
});

describe('blast', () => {
  it('Afterimage: 1.5 s after the blink its origin explodes for 1.2× effectiveness as void in a radius of 50', () => {
    const a = armed('riftStep', ['afterimage']);
    const b = aug(a.def, 'blast');
    expect(b).toMatchObject({ at: 'origin', delay: 1.5, radius: 50, damageType: 'void' });
    expect(b.damage).toBeGreaterThan(0);
    const t = target(a, 0, 30);
    cast(a, a.def, 300, 0);
    step(a, ticks(1.4));
    expect(lost(a, t)).toBe(0);
    const events = step(a, ticks(0.2));
    expect(augmentEvents(events, 'blast')).toHaveLength(1);
    close(lost(a, t), b.damage);
  });

  it('Static Arrival: a lightning nova at the landing (2× effectiveness, radius 80) that shocks', () => {
    const a = armed('riftStep', ['staticArrival']);
    const b = aug(a.def, 'blast');
    expect(b).toMatchObject({ at: 'landing', radius: 80, damageType: 'lightning', ailment: 1 });
    const t = target(a, 140, 0);
    cast(a, a.def, 100, 0);
    // It always shocks, and the shock lands before its own damage (+20%).
    expect(a.world.monsters.shockTime[t]).toBeGreaterThan(0);
    close(lost(a, t), b.damage * (1 + SHOCK_BONUS));
  });

  it('Pyre Burst: the ward bursts for 5× effectiveness as fire in a radius of 90 when it ends', () => {
    const a = armed('cinderWard', ['pyreBurst'], { damage: 0 });
    const b = aug(a.def, 'blast');
    expect(b).toMatchObject({ at: 'wardEnd', radius: 90, damageType: 'fire' });
    const t = target(a, 75, 0);
    cast(a, a.def, 100, 0);
    step(a, ticks(a.def.duration) - 5);
    expect(lost(a, t)).toBe(0);
    step(a, 10);
    close(lost(a, t), b.damage);
  });

  it('Frost Orb Shatter: the orb bursts for 4× effectiveness in a radius of 70 where it fades', () => {
    const a = armed('frostOrb', ['shatter']);
    cast(a, a.def, 300, 0);
    const events = step(a, ticks(a.def.duration) + 3);
    expect(augmentEvents(events, 'blast')).toEqual([expect.objectContaining({ radius: 70, damageType: 'cold' })]);
  });

  it('Eye of the Storm: 1 s after the last strike a final strike lands at the cursor (3× effectiveness, radius 60)', () => {
    const a = armed('stormCall', ['eyeOfTheStorm'], { ailmentChance: 0 });
    const b = aug(a.def, 'blast');
    expect(b).toMatchObject({ at: 'final', delay: 1, radius: 60 });
    cast(a, a.def, 150, 0);
    const t = target(a, 150, 0);
    a.world.monsters.life[t] = BIG;
    let events = step(a, ticks(0.7) + 1);
    const before = lost(a, t);
    events = step(a, ticks(1));
    const res = ofType(events, 'areaResolve').filter((e) => e.kind === 'stormCall');
    expect(res).toEqual([expect.objectContaining({ radius: 60, x: 150, y: 0 })]);
    close(lost(a, t) - before, b.damage);
  });

  it('Shattering Rows: the last spike of a row explodes for 2× effectiveness in a radius of 40', () => {
    const a = armed('glacialSpikes', ['shatteringRows']);
    expect(aug(a.def, 'blast')).toMatchObject({ at: 'rowEnd', radius: 40 });
    cast(a, a.def, 300, 0);
    const events = step(a, 60);
    const spikes = ofType(events, 'areaResolve').filter((e) => e.kind === 'frostSpike');
    expect(spikes).toHaveLength(a.def.projectiles + 1);
    expect(spikes[spikes.length - 1].radius).toBe(40);
  });
});

describe('shape', () => {
  it('Triple Ring: three concentric rings of 8 flames without pierce, 0.15 s apart, out to a third, two thirds and all of the range', () => {
    const a = armed('emberNova', ['tripleRing']);
    expect(a.def.projectiles).toBe(8);
    expect(a.def.pierce).toBe(0);
    cast(a, a.def, 100, 0);
    let events: SimEvent[] = [];
    events = events.concat(a.run.drainEvents());
    events = events.concat(step(a, ticks(0.35)));
    const novas = ofType(events, 'nova');
    expect(novas.map((e) => Math.round(e.radius))).toEqual([1, 2, 3].map((k) => Math.round((a.def.range * k) / 3)));
  });

  it('Spiral Arms: two arms release 130% flames over 0.5 s (each 15% less)', () => {
    const plain = armed('emberNova');
    const a = armed('emberNova', ['spiralArms']);
    expect(a.def.projectiles).toBe(Math.round(plain.def.projectiles * 1.3));
    expect(a.def.damage).toBeCloseTo(plain.def.damage * 0.85, 8);
    cast(a, a.def, 100, 0);
    expect(live(a, 'novaFlame')).toHaveLength(2);
    let spawned = 2;
    for (let k = 0; k < ticks(0.55); k++) {
      const before = new Set(live(a, 'novaFlame').map((s) => a.world.projectiles.id[s]));
      step(a, 1);
      spawned += live(a, 'novaFlame').filter((s) => !before.has(a.world.projectiles.id[s])).length;
    }
    expect(spawned).toBe(a.def.projectiles);
  });

  it('Rain of Shells: 3 shells land at random points within 70 of the cursor, each 25% less', () => {
    const plain = armed('cinderMortar');
    const a = armed('cinderMortar', ['rainOfShells']);
    expect(a.def.damage).toBeCloseTo(plain.def.damage * 0.75, 8);
    expect(a.def.cooldown).toBeCloseTo(plain.def.cooldown + 1.5, 8);
    cast(a, a.def, 200, 0);
    const shells = live(a, 'cinderShell');
    expect(shells).toHaveLength(3);
    for (const s of shells) {
      const p = a.world.projectiles;
      const land = { x: p.x[s] + p.vx[s] * 0.9, y: p.y[s] + p.vy[s] * 0.9 };
      expect(Math.hypot(land.x - 200, land.y)).toBeLessThanOrEqual(70 + 1);
    }
  });

  it('Frozen Heart: the orb hovers at the cursor for 7 s and fires twice as fast, 20% less damage', () => {
    const plain = armed('frostOrb');
    const a = armed('frostOrb', ['frozenHeart']);
    expect(a.def.duration).toBeCloseTo(7, 8);
    expect(a.def.damage).toBeCloseTo(plain.def.damage * 0.8, 8);
    target(a, 200, 60);
    cast(a, a.def, 200, 0);
    const [orb] = live(a, 'frostOrb');
    expect(a.world.projectiles.x[orb]).toBeCloseTo(200, 3);
    step(a, ticks(6.5));
    expect(live(a, 'frostOrb')).toHaveLength(1);
    expect(a.world.projectiles.x[orb]).toBeCloseTo(200, 3);
    step(a, ticks(0.6));
    expect(live(a, 'frostOrb')).toHaveLength(0);
  });

  it('Frozen Heart fires a shard every 0.125 s', () => {
    const a = armed('frostOrb', ['frozenHeart']);
    target(a, 200, 60);
    cast(a, a.def, 200, 0);
    const ids = new Set<number>();
    for (let k = 0; k < ticks(1); k++) {
      step(a, 1);
      for (const s of live(a, 'rimeShard')) ids.add(a.world.projectiles.id[s]);
    }
    expect(ids.size).toBe(8);
  });
});

describe('mortar', () => {
  it('Cluster Shell: the shell bursts into 3 bomblets landing within 40, each 45% in 60% of the radius', () => {
    const a = armed('cinderMortar', ['clusterShell']);
    cast(a, a.def, 150, 0);
    step(a, ticks(0.9) + 1);
    const kids = live(a, 'cinderShell');
    expect(kids).toHaveLength(3);
    for (const s of kids) {
      expect(a.world.projectiles.damage[s]).toBeCloseTo(a.def.damage * 0.45, 3);
      expect(a.world.projectiles.splash[s]).toBeCloseTo(a.def.radius * 0.6, 3);
    }
  });

  it('Delayed Fuse: the shell lies 1.2 s, then explodes for 60% more in a 20% larger radius', () => {
    const a = armed('cinderMortar', ['delayedFuse'], { ailmentChance: 0 });
    const t = target(a, 150, 0);
    const edge = target(a, 150 + a.def.radius * 1.1, 0);
    cast(a, a.def, 150, 0);
    step(a, ticks(0.9) + 2);
    expect(lost(a, t)).toBe(0);
    step(a, ticks(1.2));
    close(lost(a, t), a.def.damage * 1.6, 0.01);
    expect(lost(a, edge)).toBeGreaterThan(0);
  });

  it('Skip Shot: two more blasts 60 units apart toward where it flew, each 70%', () => {
    const a = armed('cinderMortar', ['skipShot'], { ailmentChance: 0 });
    const t1 = target(a, 210, 0);
    const t2 = target(a, 270, 0);
    cast(a, a.def, 150, 0);
    step(a, ticks(0.9) + ticks(0.5));
    // t1 sits in the first skip's centre (and outside the shell's own blast), t2 in the second's.
    expect(lost(a, t1)).toBeGreaterThan(0);
    expect(lost(a, t2)).toBeGreaterThan(0);
    close(lost(a, t2), a.def.damage * 0.7, 0.01);
  });
});

describe('refund, free and cheap casts', () => {
  it('Heartfire: hitting 6 enemies refunds 40% of the Focus and 1 s of cooldown (costs 25% more)', () => {
    const plain = armed('emberNova');
    const a = armed('emberNova', ['heartfire']);
    expect(a.def.focusCost).toBeCloseTo(plain.def.focusCost * 1.25, 8);
    for (let k = 0; k < 6; k++) target(a, Math.cos(k) * 50, Math.sin(k) * 50);
    a.player.focus = 100;
    const ch = a.player.charges.get('emberNova')!;
    ch.charges = 0;
    ch.timer = 3;
    cast(a, a.def, 100, 0);
    const events = step(a, 15);
    expect(augmentEvents(events, 'refund')).toHaveLength(1);
    expect(a.player.focus).toBeGreaterThanOrEqual(100 + a.def.focusCost * 0.4 - 1e-6);
    expect(ch.timer).toBeLessThan(3 - 1 + 1e-6);
  });

  it('Rift Echo: a third blink within 4 s costs no Focus; Charged Reprieve: the next 3 casts cost 25% less', () => {
    const a = armed('riftStep', ['riftEcho']);
    expect(aug(a.def, 'freeCast')).toEqual({ p: 'freeCast', nth: 3, window: 4 });
    const p = a.player;
    expect(castCost(p, a.def, 0)).toBe(a.def.focusCost);
    noteCast(p, a.def, a.def.focusCost, 0);
    noteCast(p, a.def, a.def.focusCost, 1);
    expect(castCost(p, a.def, 2)).toBe(0);
    expect(castCost(p, a.def, 5.5)).toBe(a.def.focusCost);
    noteCast(p, a.def, 0, 2);
    expect(castCost(p, a.def, 2.5)).toBe(a.def.focusCost);

    const r = armed('arcaneReprieve', ['chargedReprieve']);
    const lance = { ...r.def, id: 'emberNova' as SkillId, focusCost: 12, augments: [] };
    cast(r, r.def, 0, 0);
    for (let k = 0; k < 3; k++) {
      expect(castCost(r.player, lance, 0)).toBeCloseTo(9, 8);
      noteCast(r.player, lance, 9, 0);
    }
    expect(castCost(r.player, lance, 0)).toBe(12);
  });

  it('a free third blink goes through the real cast path with no Focus spent', () => {
    const a = armed('riftStep', ['riftEcho']);
    const arena = makeArena({ stats: makeStats(), skills: [a.def], loadout: ['riftStep', null, null, null, null, null, null, null] });
    const p = arena.player;
    p.focus = 100;
    const press = (x: number) => {
      const it = { moveX: 0, moveY: 0, aimX: x, aimY: 0, held: [true, false, false, false, false, false, false, false], flask: -1 };
      stepN(arena.run, 1, it);
      stepN(arena.run, 12, { ...it, held: it.held.map(() => false) });
    };
    press(60);
    press(0);
    const before = p.focus;
    press(60);
    expect(p.focus).toBeGreaterThanOrEqual(before - 1e-6);
  });
});

describe('hit riders', () => {
  it('Overheat: ignites deal 50% more damage', () => {
    const plain = armed('flameWave', [], { projectiles: 1, ailmentChance: 1 });
    const a = armed('flameWave', ['overheat'], { projectiles: 1 });
    expect(a.def.ailmentChance).toBe(1);
    const t0 = target(plain, 60, 0);
    const t1 = target(a, 60, 0);
    cast(plain, plain.def, 60, 0);
    cast(a, a.def, 60, 0);
    step(plain, 30);
    step(a, 30);
    close(a.world.monsters.igniteDps[t1], plain.world.monsters.igniteDps[t0] * 1.5);
  });

  it('Slow Tide: slower, wider waves that hit each enemy at most 3 times, every 0.3 s', () => {
    const plain = armed('flameWave');
    const a = armed('flameWave', ['slowTide'], { projectiles: 1 });
    expect(aug(a.def, 'rehit')).toEqual({ p: 'rehit', interval: 0.3, max: 3 });
    expect(a.def.projectileSpeed).toBeCloseTo(plain.def.projectileSpeed * 0.6, 6);
    expect(a.def.radius).toBeCloseTo(plain.def.radius * 1.6, 6);
    expect(a.def.damage).toBeCloseTo(plain.def.damage * 1.35, 6);
    // A monster riding along with the wave: kept in front of it so it stays inside for over a second.
    const t = target(a, 30, 0);
    cast(a, a.def, 100, 0);
    const [w] = live(a, 'flameWave');
    for (let k = 0; k < ticks(1.5); k++) {
      if (a.world.projectiles.alive[w]) a.world.monsters.x[t] = a.world.projectiles.x[w];
      step(a, 1);
    }
    close(lost(a, t), a.def.damage * 3);
  });

  it('Hollow Shell: pierces every enemy, hits after the first 25% less', () => {
    const raw = armed('umbralBolt', ['hollowShell']);
    expect(raw.lines).toContain('Pierces every enemy in its path');
    // Without its Decay, so only the hits count.
    const a = { ...raw, def: { ...raw.def, augments: raw.def.augments!.filter((x) => x.p !== 'decay') } };
    const ts = [60, 120, 180].map((x) => target(a, x, 0));
    cast(a, a.def, 300, 0);
    step(a, 60);
    close(lost(a, ts[0]), a.def.damage);
    close(lost(a, ts[1]), a.def.damage * 0.75);
    close(lost(a, ts[2]), a.def.damage * 0.75);
  });

  it('Pinning: hits chill the target 2 s and make it take 10% more damage', () => {
    const a = armed('kineticLance', ['pinning']);
    const t = target(a, 80, 0);
    cast(a, a.def, 80, 0);
    step(a, 15);
    expect(markTakenMult(a.world, t)).toBeCloseTo(1.1, 8);
    expect(a.world.monsters.chillTime[t]).toBeGreaterThan(1.5);
  });

  it('Tide Returns: at their maximum range the waves turn back and hit again at 60%', () => {
    const a = armed('flameWave', ['tideReturns'], { projectiles: 1 });
    const t = target(a, 100, 0);
    cast(a, a.def, 100, 0);
    const events = step(a, ticks(3));
    expect(augmentEvents(events, 'return')).toHaveLength(1);
    close(lost(a, t), a.def.damage * 1.6);
  });

  it('Static Frost: shards convert 40% to lightning and chain once to an enemy within 90', () => {
    const a = armed('frostOrb', ['staticFrost'], { ailmentChance: 0 });
    expect(aug(a.def, 'convert')).toMatchObject({ to: 'lightning', share: 0.4, ailment: 'instead' });
    target(a, 120, 30);
    const other = target(a, 120, 100);
    cast(a, a.def, 300, 0);
    let chains = 0;
    for (let k = 0; k < ticks(1.5); k++) chains += ofType(step(a, 1), 'chain').length;
    expect(chains).toBeGreaterThan(0);
    expect(lost(a, other)).toBeGreaterThan(0);
  });
});

describe('ward cap and weave', () => {
  it('Hardened Ember raises the ward’s damage reduction cap to 70%; Phase Weave strides after a blink', () => {
    const a = armed('cinderWard', ['hardenedEmber'], { damageReduction: 0.68 });
    expect(aug(a.def, 'wardCap').cap).toBe(0.7);
    cast(a, a.def, 0, 0);
    expect(wardCapOf(a.player, 0.6)).toBe(0.7);
    expect(a.player.ward.reduction).toBeCloseTo(0.68, 8);
    const plain = armed('cinderWard', [], { damageReduction: 0.68 });
    cast(plain, plain.def, 0, 0);
    expect(plain.player.ward.reduction).toBeCloseTo(0.6, 8);
    tickWard(plain.world, plain.player);

    const w = armed('riftStep', ['phaseWeave']);
    cast(w, w.def, 100, 0);
    expect(w.player.stride.time).toBeCloseTo(2, 8);
    expect(w.player.stride.speed).toBeCloseTo(0.25, 8);
  });
});

describe('determinism', () => {
  it('two runs with every kind of augment rider end bit-identical', () => {
    const run = () => {
      const lance = armed('emberLance', ['lodgeEmber', 'cinderFragments', 'searingBrand']);
      const extra: SkillRuntimeDef[] = [
        rules.skillSheet(bareCharacter({ level: 40, augments: { kineticLance: ['shatterRounds', 'pinning', 'voidConvert'] }, skillRanks: { kineticLance: 10 } }), 'kineticLance', 10).runtime,
        rules.skillSheet(bareCharacter({ level: 40, augments: { arcChain: ['forkingArc', 'conductiveMark', 'staticDischarge'] }, skillRanks: { arcChain: 10 } }), 'arcChain', 10).runtime,
        rules.skillSheet(bareCharacter({ level: 40, augments: { cinderMortar: ['clusterShell', 'magmaCore'] }, skillRanks: { cinderMortar: 10 } }), 'cinderMortar', 10).runtime,
      ];
      const a = makeArena({ stats: makeStats(), skills: [lance.def, ...extra], seed: 7 });
      const ids: number[] = [];
      for (let k = 0; k < 24; k++) ids.push(target(a, 60 + (k % 6) * 30, -75 + Math.floor(k / 6) * 50, 300));
      const defs = [lance.def, ...extra];
      for (let c = 0; c < 12; c++) {
        releaseSkill(a.world, a.player, defs[c % defs.length], 120, (c % 5) * 20 - 40);
        step(a, 9);
      }
      step(a, 120);
      return Array.from(a.world.monsters.life.slice(0, 64));
    };
    expect(run()).toEqual(run());
  });
});
