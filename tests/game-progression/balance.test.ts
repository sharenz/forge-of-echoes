// Balance playthroughs (GAME_SPEC: "tune them with the headless balance bot"): the real rules, the real
// multiplayer sim and the scripted bots from tests/sim/bot.ts play whole maps the way the server wires
// them (see playthrough.ts). They guard the core loop: a new character must be able to finish the first
// map alone, the first tiers must keep pushing back (no flat curve), dying and re-entering through the
// map's portals must work, and a party of fresh characters must clear it together (party scaling,
// shared XP, instanced loot).
//
// Always on (a few seconds): one solo Tier 1 clear with the starting kit, and the death / portal
// re-entry paths. The full three-seed, chain and party runs take about half a minute, on demand:
//
//   BALANCE=1 npx vitest run tests/game-progression/balance.test.ts
//
// The runs are deterministic (seeded rules + seeded sim), so a failure here is a real balance change —
// in the rules (skills, class, tier easing), the sim (monsters, waves, bosses) or the bot.
import { describe, expect, it } from 'vitest';
import { PORTALS_PER_MAP } from '../../src/contracts/net';
import { rules } from '../../src/game';
import type { PlayResult } from './playthrough';
import { describePlay, mapInBag, playChain, playMap, playParty } from './playthrough';

const SEEDS = [1, 2, 3] as const;
const MINUTES = 60;
const enabled = !!process.env.BALANCE;

/** A fresh character plays its starting Ashen Forge (Tier 1). */
function freshTier1(seed: number, opts: Parameters<typeof playMap>[2] = {}): PlayResult {
  const ch = rules.createCharacter('Balance', seed);
  const map = mapInBag(ch, (m) => m.baseId === 'ashenForge');
  if (!map) throw new Error('the starting kit has no Ashen Forge');
  return playMap(ch, map, { maxMinutes: 20, ...opts });
}

/** A cleared Tier 1 for a new character: in time, under real pressure, and it levels her up. */
function expectHealthyTier1(r: PlayResult): void {
  expect(r.result, describePlay(r)).toBe('cleared');
  expect(r.seconds).toBeLessThanOrEqual(12 * MINUTES);
  // Not a stroll: the horde gets to her and she needs her flasks.
  expect(r.minLife, 'lowest life on a cleared Tier 1').toBeLessThan(0.9);
  expect(r.flasksDrunk, 'flasks drunk on a cleared Tier 1').toBeGreaterThan(0);
  // The first map levels a new character well past level 1.
  expect(r.levelEnd).toBeGreaterThanOrEqual(4);
}

/** The map pushed back: she got hurt or needed several flasks. */
const pushedBack = (r: PlayResult) => r.minLife < 0.8 || r.flasksDrunk >= 3;

describe('balance smoke (always on)', () => {
  it('a new character clears a Tier 1 map with the starting kit', () => {
    expectHealthyTier1(freshTier1(SEEDS[0]));
  }, 60_000);

  it('a player who dies walks back in through a portal and keeps looting', () => {
    // Triple monster damage: she dies several times but the map is still winnable.
    const r = freshTier1(SEEDS[0], { reenterAfter: 12, tweakConfig: (c) => { c.monsters.damageMultiplier *= 3; } });
    expect(r.deaths, describePlay(r)).toBeGreaterThan(0);
    expect(r.reentries).toBe(r.deaths);
    expect(r.portalsUsed).toBe(1 + r.reentries);
    expect(r.portalsUsed).toBeLessThanOrEqual(PORTALS_PER_MAP);
    // Instanced loot keeps flowing to the re-joined player (a fresh sim player id slot, same owner id).
    expect(r.pickupsAfterReentry).toBeGreaterThan(0);
    expect(r.result).toBe('cleared');
    // XP and items survive every death (GAME_SPEC §0: no XP penalty).
    expect(r.levelEnd).toBeGreaterThanOrEqual(4);
  }, 60_000);

  it('the map is lost once all 8 portals are spent and everyone inside is down', () => {
    const r = freshTier1(SEEDS[0], { reenterAfter: 12, tweakConfig: (c) => { c.monsters.damageMultiplier *= 6; } });
    expect(r.result, describePlay(r)).toBe('failed');
    expect(r.portalsUsed).toBe(PORTALS_PER_MAP);
    expect(r.reentries).toBe(PORTALS_PER_MAP - 1);
    expect(r.deaths).toBe(PORTALS_PER_MAP);
  }, 60_000);
});

describe.runIf(enabled)('balance playthroughs (BALANCE=1)', () => {
  it('a new character clears a Tier 1 map with the starting kit on every seed', () => {
    const results = SEEDS.map((seed) => freshTier1(seed));
    for (const r of results) console.log(`[balance] new character, ${describePlay(r)}`);
    for (const r of results) expectHealthyTier1(r);
  }, 300_000);

  it('after three maps (Tier 1, Tier 1, Tier 2) a character clears Tier 3, and Tiers 2 and 3 push back', () => {
    const chains = SEEDS.map((seed) => playChain(seed, [1, 1, 2, 3], { maxMinutes: 20 }));
    chains.forEach((chain, i) => chain.forEach((r) => console.log(`[balance] seed ${SEEDS[i]}, ${describePlay(r)}`)));
    const tier2 = chains.map((chain) => chain[2]);
    const tier3 = chains.map((chain) => chain[3]);
    expect(tier2.every((r) => r.setup.map.tier === 2)).toBe(true);
    expect(tier3.every((r) => r.setup.map.tier === 3)).toBe(true);
    const cleared = tier3.filter((r) => r.result === 'cleared' && r.seconds <= 12 * MINUTES);
    expect(cleared.length, 'Tier 3 clears within 12 minutes (of 3 seeds)').toBeGreaterThanOrEqual(2);
    // Upper bound: the early-tier easing must not outpace the first levels and drops, or the curve goes
    // flat (Tier 1 the hardest map of the first four). Guarded on at least 2 of 3 seeds per tier.
    expect(tier2.filter(pushedBack).length, 'Tier 2 pushes back (of 3 seeds)').toBeGreaterThanOrEqual(2);
    expect(tier3.filter(pushedBack).length, 'Tier 3 pushes back (of 3 seeds)').toBeGreaterThanOrEqual(2);
  }, 600_000);

  it('a party of fresh characters clears Tier 1 together: shared XP, instanced loot', () => {
    for (const size of [2, 4]) {
      const party = Array.from({ length: size }, (_, i) => rules.createCharacter(`Member${i + 1}`, 100 * size + i));
      const map = mapInBag(party[0], (m) => m.baseId === 'ashenForge')!;
      const results = playParty(party, map, { maxMinutes: 20, reenterAfter: 12 });
      results.forEach((r, i) => console.log(`[balance] party of ${size}, member ${i + 1}: ${describePlay(r)}`));
      for (const r of results) {
        expect(r.result, `party of ${size}`).toBe('cleared');
        expect(r.seconds).toBeLessThanOrEqual(12 * MINUTES);
        // Everyone levels from the shared echo motes and loots their own drops.
        expect(r.levelEnd).toBeGreaterThanOrEqual(4);
        expect(r.pickups).toBeGreaterThan(0);
      }
      // Party scaling keeps the pressure on: someone gets hurt.
      expect(Math.min(...results.map((r) => r.minLife))).toBeLessThan(0.9);
      expect(results[0].portalsUsed).toBeLessThanOrEqual(PORTALS_PER_MAP);
      // Only the owner's map was consumed.
      expect(results[0].character.backpack.entries.some((e) => e.item.uid === map.uid)).toBe(false);
      expect(results[1].character.mapDevice).toBeNull();
    }
  }, 600_000);
});
