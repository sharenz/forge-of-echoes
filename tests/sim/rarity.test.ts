import { describe, expect, it } from 'vitest';
import { makeArena } from './helpers';
import { ELITE } from '../../src/sim/archetypes';
import { spawnMonster } from '../../src/sim/spawn';

describe('monster rarity strength', () => {
  it('makes every blue pack tougher and every rare leader substantially stronger before modifiers', () => {
    const { world } = makeArena();
    const m = world.monsters;
    const normal = spawnMonster(world, 'ashling', 100, 0, { wave: 1 });
    const magic = spawnMonster(world, 'ashling', 100, 0, { wave: 1, rarity: 'magic', mods: ELITE.swift });
    const rare = spawnMonster(world, 'ashling', 100, 0, { wave: 1, rarity: 'rare', mods: ELITE.frenzied | ELITE.emberTouched });
    expect(m.maxLife[magic] / m.maxLife[normal]).toBeCloseTo(1.5);
    expect(m.damage[magic] / m.damage[normal]).toBeCloseTo(1.2);
    expect(m.maxLife[rare] / m.maxLife[normal]).toBeCloseTo(3);
    expect(m.damage[rare] / m.damage[normal]).toBeCloseTo(1.5);
    expect(m.xp[magic] / m.xp[normal]).toBe(2);
    expect(m.xp[rare] / m.xp[normal]).toBe(6);
  });

  it('stacks pack modifiers with rarity while leaving named encounters on their own tuning', () => {
    const { world } = makeArena();
    const m = world.monsters;
    const normal = spawnMonster(world, 'ashling', 100, 0, { wave: 1 });
    const stout = spawnMonster(world, 'ashling', 100, 0, { wave: 1, rarity: 'magic', mods: ELITE.stout });
    const fierce = spawnMonster(world, 'ashling', 100, 0, { wave: 1, rarity: 'magic', mods: ELITE.fierce });
    const juggernaut = spawnMonster(world, 'ashling', 100, 0, { wave: 1, rarity: 'rare', mods: ELITE.juggernaut });
    expect(m.maxLife[stout] / m.maxLife[normal]).toBeCloseTo(1.5 * 1.7);
    expect(m.damage[fierce] / m.damage[normal]).toBeCloseTo(1.2 * 1.4);
    expect(m.maxLife[juggernaut] / m.maxLife[normal]).toBeCloseTo(9);
    for (const encounter of ['boss', 'lieutenant'] as const) {
      const base = spawnMonster(world, 'ashling', 100, 0, { wave: 1, [encounter]: true });
      const marked = spawnMonster(world, 'ashling', 100, 0, { wave: 1, [encounter]: true, rarity: 'rare' });
      expect(m.maxLife[marked]).toBe(m.maxLife[base]);
      expect(m.damage[marked]).toBe(m.damage[base]);
    }
  });
});
