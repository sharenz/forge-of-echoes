import { describe, expect, it } from 'vitest';
import type { SkillId, UniqueId } from '../../src/contracts/content';
import { rules } from '../../src/game';
import { getBase, UNIQUES } from '../../src/data/items';
import { generateUnique } from '../../src/game/items';
import { createRng } from '../../src/core/rng';
import { bareCharacter } from '../game-progression/fixtures';
import { makeArena, placeMonster, stepN } from './helpers';
import { releaseSkill, tickPendingNovas, tickWard } from '../../src/sim/skills';
import { damageMonster, hitPlayer } from '../../src/sim/combat';
import { applyDebuff, isActive } from '../../src/sim/debuffs';
import { DAMAGE_INDEX } from '../../src/sim/math';

function armed(id: UniqueId | UniqueId[], skill: SkillId) {
  const equipment = Object.fromEntries((Array.isArray(id) ? id : [id]).map(id => {
    const item = generateUnique(id, createRng(4), { itemLevel: 88 });
    return [getBase(item.baseId).slots[0], item];
  }));
  const ch = bareCharacter({ level: 60, equipment });
  const def = rules.skillSheet(ch, skill, 10).runtime;
  const arena = makeArena({ stats: rules.deriveStats(ch).combat, skills: [def] });
  return { ...arena, def, ch };
}
function angles(a: ReturnType<typeof armed>) {
  const p = a.world.projectiles;
  return Array.from({ length: p.hwm }, (_, i) => i).filter(i => p.alive[i]).map(i => Math.atan2(p.vy[i], p.vx[i]));
}

describe('keystone unique combat effects', () => {
  it('combines fan/echo and pierce/echo, cancels echoes on death, and gives Focus Ward precedence over cold damage', () => {
    const a = armed(['sunkenSun', 'echoOfTheMatriarch'], 'emberNova');
    releaseSkill(a.world, a.player, a.def, 100, 0);
    a.player.aimX = 100; a.player.aimY = 0;
    a.world.time += 0.4; tickPendingNovas(a.world, a.player);
    expect(angles(a)).toHaveLength(a.def.projectiles * 2);
    for (const angle of angles(a)) expect(Math.abs(angle)).toBeLessThanOrEqual(Math.PI * 5 / 12 + 0.00001);
    const b = armed(['secondVerse', 'choirOfGlass'], 'rimeShards');
    releaseSkill(b.world, b.player, b.def, 100, 0);
    b.world.time += 0.4; tickPendingNovas(b.world, b.player);
    expect(b.world.projectiles.count).toBe(b.def.projectiles * 2);
    for (let i = 0; i < b.world.projectiles.hwm; i++) if (b.world.projectiles.alive[i]) expect(b.world.projectiles.pierce[i]).toBe(-1);
    releaseSkill(b.world, b.player, b.def, 100, 0);
    const count = b.world.projectiles.count;
    b.player.dead = true; b.world.time += 0.4; tickPendingNovas(b.world, b.player);
    expect(b.world.projectiles.count).toBe(count); expect(b.player.pendingNovas).toHaveLength(0);
    const c = armed(['stillwinter', 'vigilOfAsh'], 'cinderWard');
    const enemy = placeMonster(c.world, 'ashling', 20, 0, { life: 10000 });
    c.world.grid.build(c.world.monsters); c.player.focus = 0;
    releaseSkill(c.world, c.player, c.def, 100, 0); c.player.ward.pulse = 0; tickWard(c.world, c.player);
    expect(c.player.focus).toBe(2); expect(c.world.monsters.life[enemy]).toBe(10000);
    expect(c.world.monsters.chillTime[enemy]).toBe(0);
  });
  it('Everburn always ignites, while The Sunken Sun aims every Nova projectile forward', () => {
    const a = armed('everburn', 'emberLance');
    expect(a.def.ailmentChance).toBe(1);
    const i = placeMonster(a.world, 'ashling', 60, 0, { life: 10000 });
    releaseSkill(a.world, a.player, a.def, 100, 0); stepN(a.run, 15);
    expect(a.world.monsters.igniteTime[i]).toBeGreaterThan(0);
    const b = armed('sunkenSun', 'emberNova');
    releaseSkill(b.world, b.player, b.def, 100, 0);
    expect(angles(b)).toHaveLength(b.def.projectiles);
    for (const angle of angles(b)) expect(Math.abs(angle)).toBeLessThanOrEqual(Math.PI * 5 / 12 + 0.00001);
    expect(rules.skillSheet(b.ch, 'emberNova', 10).lines.join(' ')).toContain('150° fan');
  });

  it('Winterstride chills only nearby landing targets and Stillwinter pulses cold damage', () => {
    const a = armed('winterstride', 'riftStep');
    const near = placeMonster(a.world, 'ashling', 160, 0), far = placeMonster(a.world, 'ashling', 290, 0);
    a.world.grid.build(a.world.monsters);
    releaseSkill(a.world, a.player, a.def, 100, 0);
    expect(a.world.monsters.chillTime[near]).toBe(2);
    expect(a.world.monsters.chillTime[far]).toBe(0);
    const b = armed('stillwinter', 'cinderWard');
    const i = placeMonster(b.world, 'ashling', 25, 0, { life: 10000 });
    b.world.grid.build(b.world.monsters);
    releaseSkill(b.world, b.player, b.def, 100, 0);
    b.player.ward.pulse = 0; tickWard(b.world, b.player);
    expect(b.def.damageType).toBe('cold');
    expect(b.world.monsters.life[i]).toBeLessThan(10000);
    expect(b.world.monsters.chillTime[i]).toBeGreaterThan(0);
    expect(b.world.monsters.igniteTime[i]).toBe(0);
  });

  it('Vigil restores Focus with a cap and no damage; The Last Rite surrounds the caster', () => {
    const a = armed('vigilOfAsh', 'cinderWard');
    const enemies = Array.from({ length: 5 }, (_, n) => placeMonster(a.world, 'ashling', 10 + n * 4, 0, { life: 10000 }));
    a.world.grid.build(a.world.monsters); a.player.focus = 0;
    releaseSkill(a.world, a.player, a.def, 100, 0);
    a.player.ward.pulse = 0; tickWard(a.world, a.player);
    expect(a.player.focus).toBe(6); expect(a.def.damage).toBe(0);
    for (const i of enemies) expect(a.world.monsters.life[i]).toBe(10000);
    a.player.focus = a.player.stats.maxFocus - 1; a.player.ward.pulse = 0; tickWard(a.world, a.player);
    expect(a.player.focus).toBe(a.player.stats.maxFocus);
    const b = armed('lastRite', 'flameWave');
    releaseSkill(b.world, b.player, b.def, 100, 0);
    expect(angles(b).some(n => Math.cos(n) < -0.5)).toBe(true);
    expect(angles(b).some(n => Math.cos(n) > 0.5)).toBe(true);
    expect(new Set(angles(b).map(n => n.toFixed(4))).size).toBe(b.def.projectiles);
  });

  it('the Choir pierces without limit and the Second Verse repeats exactly once, without spending Focus', () => {
    const a = armed('choirOfGlass', 'rimeShards');
    releaseSkill(a.world, a.player, a.def, 100, 0);
    const p = a.world.projectiles;
    for (let i = 0; i < p.hwm; i++) if (p.alive[i]) expect(p.pierce[i]).toBe(-1);
    const b = armed('secondVerse', 'rimeShards');
    releaseSkill(b.world, b.player, b.def, 100, 0);
    const before = b.world.projectiles.count, focus = b.player.focus;
    b.world.time += 0.39; tickPendingNovas(b.world, b.player);
    expect(b.world.projectiles.count).toBe(before);
    b.world.time += 0.01; tickPendingNovas(b.world, b.player);
    expect(b.world.projectiles.count).toBe(before * 2);
    expect(b.player.focus).toBe(focus); expect(b.player.pendingNovas).toHaveLength(0);
    b.world.time += 1; tickPendingNovas(b.world, b.player);
    expect(b.world.projectiles.count).toBe(before * 2);
  });

  it('the Broken Link removes harmful effects and Iron Refrain revisits targets without self-bouncing', () => {
    const a = armed('brokenLink', 'riftStep');
    for (const id of ['burning', 'bleeding', 'withered', 'chilled'] as const) applyDebuff(a.world, a.player, id, 20);
    releaseSkill(a.world, a.player, a.def, 100, 0);
    for (const id of ['burning', 'bleeding', 'withered', 'chilled'] as const) expect(isActive(a.player, id)).toBe(false);
    const b = armed('ironRefrain', 'arcChain');
    const first = placeMonster(b.world, 'ashling', 100, 0, { life: 1e6 });
    b.world.grid.build(b.world.monsters);
    releaseSkill(b.world, b.player, b.def, 100, 0);
    const soloDamage = 1e6 - b.world.monsters.life[first];
    b.world.monsters.life[first] = 1e6;
    placeMonster(b.world, 'ashling', 130, 0, { life: 1e6 }); b.world.grid.build(b.world.monsters);
    releaseSkill(b.world, b.player, b.def, 100, 0);
    expect(1e6 - b.world.monsters.life[first]).toBeGreaterThan(soloDamage * 1.5);
  });

  it('the Crown renews an active Ward only on real Physical hits, capped at its original duration', () => {
    const a = armed('unbowedCrown', 'cinderWard');
    a.player.stats.evasion = 0;
    releaseSkill(a.world, a.player, a.def, 100, 0);
    a.player.ward.time = 1;
    hitPlayer(a.world, a.player, 1, DAMAGE_INDEX.physical, 'projectile'); expect(a.player.ward.time).toBe(1.5);
    hitPlayer(a.world, a.player, 1, DAMAGE_INDEX.physical, 'dot'); expect(a.player.ward.time).toBe(1.5);
    hitPlayer(a.world, a.player, 1, DAMAGE_INDEX.fire, 'projectile'); expect(a.player.ward.time).toBe(1.5);
    a.player.ward.time = a.player.ward.duration - 0.1;
    hitPlayer(a.world, a.player, 1, DAMAGE_INDEX.physical, 'projectile'); expect(a.player.ward.time).toBe(a.player.ward.duration);
    a.player.ward.time = 0;
    hitPlayer(a.world, a.player, 1, DAMAGE_INDEX.physical, 'projectile'); expect(a.player.ward.time).toBe(0);
  });

  it('Victor’s Debt changes hits by distance and leaves damage over time alone', () => {
    const damage = (distance: number, hit: boolean) => {
      const a = armed('victorsDebt', 'emberLance');
      const i = placeMonster(a.world, 'ashling', distance, 0, { life: 10000 });
      damageMonster(a.world, i, 100, DAMAGE_INDEX.fire, 0, 1, 0, 0, 0, 0, hit, a.player.id);
      return 10000 - a.world.monsters.life[i];
    };
    const base = damage(100, true);
    expect(damage(80, true)).toBeCloseTo(base * 1.25, 2);
    expect(damage(201, true)).toBeCloseTo(base * 0.75, 2);
    expect(damage(200, true)).toBeCloseTo(base, 2);
    expect(damage(20, false)).toBeCloseTo(damage(250, false), 2);
  });
});
