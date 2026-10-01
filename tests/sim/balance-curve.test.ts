// Balance intent of the monster level curve and the character-vs-monster level gap (ROADMAP.md, balance overhaul
// phase 2), on the real curve (monsterLifeScale / monsterDamageScale) and the sim's scripted bot:
//   • a character roughly at the map's level, with gear for it, rushes through (well-built) or clears it under
//     pressure (fair);
//   • a map far above her (monster level ~1.6x+ hers, thin gear) is a wall: the fair bot dies, and even the
//     well-built one dies once the map is ~20% above her level;
//   • being under-levelled costs extra on top: the same well-built bot at the same monster level fares worse
//     with a lower character level (the level gap).
// The gear fixtures are the roster fixtures of tests/sim/fixtures.ts (fair: about a level-17..22 crafted
// sorceress, strong: a level ~24+ one). Four seeds each; deterministic.
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/contracts/sim';
import { monsterDamageScale, monsterLifeScale } from '../../src/data/progression';
import { createRunInternal } from '../../src/sim/run';
import { createBot } from './bot';
import { STRONG_LOADOUT, fairSkills, fairStats, makeConfig, makeJoin, strongSkills, strongStats } from './fixtures';

const SEEDS = [1, 2, 3, 4] as const;

function play(gear: 'fair' | 'strong', monsterLevel: number, characterLevel: number, seed: number): { cleared: boolean; minutes: number } {
  const scaling = {
    level: monsterLevel, lifeMultiplier: monsterLifeScale(monsterLevel), damageMultiplier: monsterDamageScale(monsterLevel),
    magicPackChance: 0.15, rarePackChance: 0.05,
  };
  const { run, world } = createRunInternal(makeConfig({ theme: 'ashenForge', seed, arenaRadius: 900, scaling }));
  const kit = gear === 'fair' ? { stats: fairStats(), skills: fairSkills() } : { stats: strongStats(), skills: strongSkills() };
  run.addPlayer(makeJoin(1, { ...kit, loadout: STRONG_LOADOUT, level: characterLevel }));
  const bot = createBot();
  for (let t = 0; t < Math.round((20 * 60) / SIM_DT); t++) {
    run.setIntent(1, bot.intent(run.view, 1));
    run.step();
    run.drainEvents();
    const out = run.drainOutcomes();
    if (out.some((o) => o.t === 'playerDied')) return { cleared: false, minutes: (world.tick * SIM_DT) / 60 };
    if (out.some((o) => o.t === 'cleared')) return { cleared: true, minutes: (world.tick * SIM_DT) / 60 };
  }
  return { cleared: false, minutes: 20 };
}

function clears(gear: 'fair' | 'strong', monsterLevel: number, characterLevel: number): number {
  const results = SEEDS.map((s) => play(gear, monsterLevel, characterLevel, s));
  console.info(`curve ${gear} ML${monsterLevel} L${characterLevel}: ${results.map((r) => (r.cleared ? r.minutes.toFixed(1) : 'died')).join(' ')}`);
  return results.filter((r) => r.cleared).length;
}

describe('monster level curve and level gap (sim bot)', () => {
  it('on-level maps are clearable: fair gear at map level 16, well-built gear rushes map level 22', () => {
    expect(clears('fair', 16, 16), 'fair gear, ML16 (Tier 3) at level 16').toBeGreaterThanOrEqual(3);
    // Cover (tall props stop the bot's bolts too, and it does not plan for them) costs it a few percent of clear time on this
    // scattered-pillar map: one seed of four can now fall at the boss. Three of four is still "rushes".
    expect(clears('strong', 22, 24), 'strong gear, ML22 (Tier 4) at level 24').toBeGreaterThanOrEqual(SEEDS.length - 1);
  }, 120_000);

  it('a level-22 character with fair gear cannot handle map level 28 (Tier 5), nor level 34', () => {
    expect(clears('fair', 28, 22), 'fair gear, ML28').toBeLessThanOrEqual(1);
    expect(clears('fair', 34, 22), 'fair gear, ML34').toBe(0);
  }, 120_000);

  it('well-built gear at level 28 fights Tier 5 on even terms but has no chance a Tier above it', () => {
    const even = clears('strong', 28, 28);
    expect(even, 'strong gear, ML28 at level 28').toBeGreaterThanOrEqual(1);
    expect(even, 'strong gear, ML28 at level 28').toBeLessThan(SEEDS.length);
    expect(clears('strong', 40, 28), 'strong gear, ML40 at level 28').toBe(0);
  }, 120_000);

  it('the level gap costs: the same gear does worse with a much lower character level', () => {
    const level28 = clears('strong', 28, 28);
    const level14 = clears('strong', 28, 14);
    expect(level14, 'strong gear, ML28 at level 14').toBeLessThan(level28);
  }, 120_000);
});
