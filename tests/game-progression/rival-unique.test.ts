// Rival Crowns: the rival boss rolls its own theme's exclusive unique (KillLootContext.rival multiplies the chance).
import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { rules } from '../../src/game';
import { getUnique } from '../../src/data/items';
import { bareCharacter, kill, map, setupFor } from './fixtures';

describe('rival exclusive unique', () => {
  const setup = setupFor(map('ashenForge', 9));
  const fromRival = (rival: number | undefined, seed: number) => rules.rollKillLoot(setup, kill({ isBoss: true, kind: 'hollowWarden', ...(rival !== undefined ? { rival } : {}) }), createRng(seed), bareCharacter())
    .filter(i => i.kind === 'equipment' && i.uniqueId && getUnique(i.uniqueId).bossSource === 'hollowWarden').length;

  it('a certain roll drops a unique of the rival\'s own boss; a plain boss kill here does so far less often', () => {
    let sure = 0, plain = 0;
    for (let seed = 0; seed < 60; seed++) { if (fromRival(1000, seed) > 0) sure++; if (fromRival(undefined, seed) > 0) plain++; }
    expect(sure).toBe(60);
    expect(plain).toBeLessThan(30);
  });

  it('at the base multiplier it is the 12% exclusive chance, and Crown Rivalry (1.5) raises it', () => {
    let base = 0, rivalry = 0;
    const n = 1500;
    for (let seed = 0; seed < n; seed++) { if (fromRival(1, seed) > 0) base++; if (fromRival(1.5, seed) > 0) rivalry++; }
    expect(base / n).toBeGreaterThan(0.08);
    expect(base / n).toBeLessThan(0.3);
    expect(rivalry).toBeGreaterThan(base);
  });
});
