import { describe, expect, it } from 'vitest';
import { makeArena, stepN } from './helpers';
import { createRng } from '../../src/core/rng';
import { ELITE, ELITE_PROOF_RESIST, PROOF_MASK, STRIKE_MASK, rollRareMods } from '../../src/sim/archetypes';
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

  it('gives proof rares very high resistance to exactly one element and leaves the rest alone', () => {
    const { world } = makeArena();
    const m = world.monsters;
    const plain = spawnMonster(world, 'ashling', 100, 0, { wave: 1, rarity: 'rare', mods: ELITE.juggernaut });
    const cold = spawnMonster(world, 'ashling', 100, 0, { wave: 1, rarity: 'rare', mods: ELITE.coldProof | ELITE.warded });
    for (let t = 0; t < 5; t++) {
      expect(m.res[cold * 5 + t]).toBeCloseTo(t === 2 ? Math.max(m.res[plain * 5 + t], ELITE_PROOF_RESIST) : m.res[plain * 5 + t], 5);
    }
    expect(m.res[cold * 5 + 2]).toBeGreaterThanOrEqual(0.85);
  });

  it('keeps Tier 1 free of proofs and strike mods, and brings them in with depth (never two proofs)', () => {
    const roll = (tier: number) => {
      const rng = createRng(7);
      return Array.from({ length: 400 }, () => rollRareMods(rng, tier * 6 - 2));
    };
    for (const mods of roll(1)) expect(mods & (PROOF_MASK | STRIKE_MASK)).toBe(0);
    const deep = roll(12);
    expect(deep.some((mods) => mods & PROOF_MASK)).toBe(true);
    expect(deep.some((mods) => mods & STRIKE_MASK)).toBe(true);
    for (const mods of deep) {
      const proofs = [ELITE.fireProof, ELITE.coldProof, ELITE.lightningProof].filter((b) => mods & b).length;
      expect(proofs).toBeLessThanOrEqual(1);
    }
    const early = roll(2).filter((mods) => mods & PROOF_MASK).length;
    expect(early).toBe(0);
  });

  it('makes stormcalled and rending rares mark their target with a telegraphed shocking / bleeding strike', () => {
    for (const [mod, kind, debuff] of [[ELITE.stormcalled, 'stormStrike', 'shocked'], [ELITE.rending, 'rendStrike', 'bleeding']] as const) {
      const { world, run } = makeArena();
      spawnMonster(world, 'ashling', 150, 0, { wave: 1, rarity: 'rare', mods: mod, animate: false });
      stepN(run, 60 * 7);
      const strike = world.areas.find((a) => a.kind === kind);
      expect(strike, kind).toBeDefined();
      expect(strike!.hurts).toBe('player');
      expect(strike!.debuff).toBe(debuff);
      expect(strike!.duration).toBeGreaterThan(0.5);
    }
  });
});
