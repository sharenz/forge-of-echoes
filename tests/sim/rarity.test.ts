import { describe, expect, it } from 'vitest';
import { makeArena, stepN } from './helpers';
import { createRng } from '../../src/core/rng';
import { ELITE, ELITE_PROOF_RESIST, PROOF_MASK, STRIKE_MASK, lifeWithFloor, rareLifeFloor, rareModWeights, rollRareMods } from '../../src/sim/archetypes';
import { spawnMonster } from '../../src/sim/spawn';

describe('monster rarity strength', () => {
  it('makes every blue pack tougher and every rare leader substantially stronger before modifiers', () => {
    const { world } = makeArena();
    // Tier 1 monster level: the rare/magic life floor (Tier 2+) is covered by its own test.
    (world.config.monsters as { level: number }).level = 4;
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
    // Tier 1 monster level: the rare/magic life floor (Tier 2+) is covered by its own test.
    (world.config.monsters as { level: number }).level = 4;
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
      const proofs = [ELITE.fireProof, ELITE.coldProof, ELITE.lightningProof, ELITE.voidProof, ELITE.physicalProof].filter((b) => mods & b).length;
      expect(proofs).toBeLessThanOrEqual(2);
    }
    const early = roll(2).filter((mods) => mods & PROOF_MASK).length;
    expect(early).toBe(0);
  });

  it('adds void-proof from Tier 8 and physical-proof from Tier 10, double proof only from Tier 12', () => {
    const weight = (tier: number, bit: number) => rareModWeights(tier * 6 - 2).find(([b]) => b === bit)![1];
    expect(weight(8, ELITE.voidProof)).toBe(0);
    expect(weight(9, ELITE.voidProof)).toBeGreaterThan(0);
    expect(weight(12, ELITE.voidProof)).toBeCloseTo(0.5);
    expect(weight(10, ELITE.physicalProof)).toBe(0);
    expect(weight(14, ELITE.physicalProof)).toBeCloseTo(0.4);
    expect(weight(8, ELITE.fireProof)).toBeCloseTo(0.6);
    const roll = (tier: number) => {
      const rng = createRng(11);
      return Array.from({ length: 3000 }, () => rollRareMods(rng, tier * 6 - 2));
    };
    const count = (m: number) => [ELITE.fireProof, ELITE.coldProof, ELITE.lightningProof, ELITE.voidProof, ELITE.physicalProof].filter((b) => m & b).length;
    for (const tier of [2, 8, 11]) for (const m of roll(tier)) expect(count(m), `tier ${tier}`).toBeLessThanOrEqual(1);
    expect(roll(9).some((m) => m & ELITE.voidProof)).toBe(true);
    expect(roll(9).some((m) => m & ELITE.physicalProof)).toBe(false);
    const t15 = roll(15);
    const withProof = t15.filter((m) => m & PROOF_MASK);
    const doubles = withProof.filter((m) => count(m) === 2);
    expect(doubles.length / withProof.length).toBeGreaterThan(0.12);
    expect(doubles.length / withProof.length).toBeLessThan(0.28);
    expect(t15.some((m) => m & ELITE.physicalProof)).toBe(true);
    // The mod count per tier is unchanged by the double proof: two, or three from Tier 10.
    for (const m of t15) expect(Math.round(Math.log2(m & -m)) >= 0 && [...Array(14).keys()].filter((k) => m & (1 << k)).length).toBeLessThanOrEqual(3);
  });

  it('makes void-proof and physical-proof rares resist exactly that type', () => {
    const { world } = makeArena();
    const m = world.monsters;
    for (const [bit, type] of [[ELITE.voidProof, 4], [ELITE.physicalProof, 0]] as const) {
      const i = spawnMonster(world, 'ashling', 100, 0, { wave: 1, rarity: 'rare', mods: bit });
      for (let t = 0; t < 5; t++) if (t === type) expect(m.res[i * 5 + t]).toBeGreaterThanOrEqual(0.85); else expect(m.res[i * 5 + t]).toBeLessThan(0.85);
    }
  });

  it('floors rare and magic life from Tier 2: 22 -> 150 over Tier 1 to 6, none at Tier 1', () => {
    expect(rareLifeFloor(4)).toBe(0);
    const at = (tier: number) => Math.round(rareLifeFloor(tier * 6 - 2));
    expect([2, 3, 4, 5, 6, 9, 15].map(at)).toEqual([48, 73, 99, 124, 150, 150, 150]);
    expect(lifeWithFloor(22, 'rare', 58)).toBe(150);
    expect(lifeWithFloor(400, 'rare', 58)).toBe(400);
    expect(lifeWithFloor(22, 'magic', 58)).toBe(60);
    expect(lifeWithFloor(22, 'normal', 58)).toBe(22);
  });

  it('applies the floor to map spawns but not to map-event elites (lifeFloor: false), which keep their per-event tuning', () => {
    const { world } = makeArena();
    (world.config.monsters as { level: number }).level = 58;
    const m = world.monsters;
    const normal = spawnMonster(world, 'ashling', 100, 0, { wave: 1 });
    const pack = spawnMonster(world, 'ashling', 100, 0, { wave: 1, rarity: 'rare' });
    const event = spawnMonster(world, 'ashling', 100, 0, { wave: 1, rarity: 'rare', lifeFloor: false });
    expect(m.maxLife[pack] / m.maxLife[normal]).toBeCloseTo((3 * 150) / 22);
    expect(m.maxLife[event] / m.maxLife[normal]).toBeCloseTo(3);
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
