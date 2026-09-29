// Balance playthroughs (GAME_SPEC §7 "Balance intent"): the real rules, the real multiplayer sim and the scripted
// bots from tests/sim/bot.ts play whole maps the way the server wires them (see playthrough.ts). They guard the
// intended shape of the early game:
//   • a brand-new character with the starting kit is NOT guaranteed to clear Tier 1 first try: she takes serious damage, levels up
//     on the way and can come back through the map's portals if she dies (dying is part of the loop, GAME_SPEC §0 / §11);
//   • a normally geared character comfortably clears maps whose monster level is up to about their level + 3, and
//     those maps still push back (nobody strolls);
//   • maps far above that (modded / high tiers) need real gear: an under-levelled character struggles or dies;
//   • dying and re-entering through the map's portals, the portal budget, and party play keep working.
//
// Always on (a few seconds): the first-map struggle and the death / portal paths. The progression, the party and the
// "too far ahead" runs take a few minutes, on demand:
//
//   BALANCE=1 npx vitest run tests/game-progression/balance.test.ts
//
// The runs are deterministic (seeded rules + seeded sim), so a failure here is a real balance change — in the rules
// (monster level curve, drop rates, defences), the sim (monsters, waves, bosses) or the bot.
import { describe, expect, it } from 'vitest';
import { PORTALS_PER_MAP } from '../../src/contracts/net';
import { rules } from '../../src/game';
import { createMapItem } from '../../src/game/progression';
import type { PlayResult } from './playthrough';
import { describePlay, mapInBag, playMap, playParty, playProgression, tierForLevel } from './playthrough';

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

/** How a player comes back: a dead character walks in again through one of the map's portals after this many seconds. */
const REENTER = 12;

/** A brand-new character's first map: she can clear it and level up, with portals available after death. */
function expectFirstMap(r: PlayResult): void {
  expect(r.result, describePlay(r)).toBe('cleared');
  expect(r.seconds, describePlay(r)).toBeLessThanOrEqual(25 * MINUTES);
  expect(r.portalsUsed, describePlay(r)).toBeLessThanOrEqual(PORTALS_PER_MAP);
  // She levels well past level 1 on the way (deaths lose no XP).
  expect(r.levelEnd, describePlay(r)).toBeGreaterThanOrEqual(4);
}

/** The map pushed back: she got hurt or needed several flasks. */
const pushedBack = (r: PlayResult) => r.minLife < 0.8 || r.flasksDrunk >= 3;

describe('balance smoke (always on)', () => {
  it('a new character has a hard first map: she is pushed to the brink, levels up and clears it (through the portals if she dies)', () => {
    const r = freshTier1(SEEDS[0], { reenterAfter: REENTER, maxMinutes: 25 });
    console.log(`[balance] new character, ${describePlay(r)}`);
    expectFirstMap(r);
    // It hurts: she is at death's door (and on some seeds dies) even though she clears it.
    expect(r.minLife, describePlay(r)).toBeLessThan(0.5);
  }, 90_000);

  it('the bot reaches the distant boss across the seed-2 pillar cluster instead of kiting static props forever', () => {
    const r = freshTier1(2, { reenterAfter: REENTER, maxMinutes: 15 });
    expectFirstMap(r);
    expect(r.bossLife, describePlay(r)).toBe(0);
  }, 90_000);

  it('a player who dies walks back in through a portal and keeps looting', () => {
    // Force the death/re-entry path at 1.8× damage after removing the wave-3 boss.
    // This is a portal regression probe, separate from the unmodified first-map balance check.
    const r = freshTier1(SEEDS[0], { reenterAfter: REENTER, maxMinutes: 25, tweakConfig: (c) => { c.monsters.damageMultiplier *= 1.8; } });
    expect(r.deaths, describePlay(r)).toBeGreaterThan(0);
    expect(r.reentries).toBe(r.deaths);
    expect(r.portalsUsed).toBe(1 + r.reentries);
    expect(r.portalsUsed).toBeLessThanOrEqual(PORTALS_PER_MAP);
    // Instanced loot keeps flowing to the re-joined player (a fresh sim player id slot, same owner id).
    expect(r.pickupsAfterReentry).toBeGreaterThan(0);
    // XP and items survive every death (GAME_SPEC §0: no XP penalty).
    expect(r.levelEnd).toBeGreaterThanOrEqual(4);
  }, 90_000);

  it('the map is lost once all 8 portals are spent and everyone inside is down', () => {
    // Monsters with 6× damage and 10× life: she can't win, and falls again after every re-entry until the portals
    // are gone.
    const r = freshTier1(SEEDS[0], {
      reenterAfter: REENTER, tweakConfig: (c) => { c.monsters.damageMultiplier *= 6; c.monsters.lifeMultiplier *= 10; },
    });
    expect(r.result, describePlay(r)).toBe('failed');
    expect(r.portalsUsed).toBe(PORTALS_PER_MAP);
    expect(r.reentries).toBe(PORTALS_PER_MAP - 1);
    expect(r.deaths).toBe(PORTALS_PER_MAP);
  }, 90_000);
});

describe.runIf(enabled)('balance playthroughs (BALANCE=1)', () => {
  it('new characters take serious damage on Tier 1 but can clear it on every seed', () => {
    const results = SEEDS.map((seed) => freshTier1(seed, { reenterAfter: REENTER, maxMinutes: 25 }));
    for (const r of results) console.log(`[balance] new character, ${describePlay(r)}`);
    for (const r of results) expectFirstMap(r);
    // Immediate XP gives timely level-ups. Owner playtests favour the current boss damage;
    // require pressure on every seed, without requiring deaths from the scripted bot.
    for (const r of results) expect(r.minLife, describePlay(r)).toBeLessThan(0.5);
  }, 300_000);

  it('a normal player (maps up to level + 3) levels steadily, clears what they play, and is still pushed back', () => {
    for (const seed of SEEDS) {
      const { results, characters } = playProgression(seed, 8);
      results.forEach((r, i) => console.log(`[balance] progression seed ${seed}, map ${i + 1}: ${describePlay(r)}`));
      for (const r of results) expect(r.result, describePlay(r)).toBe('cleared');
      const last = characters[characters.length - 1];
      expect(last.level, `seed ${seed}: level after 8 maps`).toBeGreaterThanOrEqual(9);
      // nextMap prefers normal maps but can use a crafted drop when no normal one is available.
      // Preserve the on-level death budget for normal maps; crafted maps have their own danger mods.
      const later = results.slice(1);
      const normal = later.filter((r) => r.setup.map.rarity === 'normal');
      expect(normal.length, `seed ${seed}: normal maps sampled`).toBeGreaterThanOrEqual(3);
      expect(normal.reduce((n, r) => n + r.deaths, 0), `seed ${seed}: normal-map deaths after the first map`).toBeLessThanOrEqual(2);
      for (const r of later) expect(r.portalsUsed, describePlay(r)).toBeLessThan(PORTALS_PER_MAP);
      expect(results.slice(1).filter(pushedBack).length, `seed ${seed}: maps that push back`).toBeGreaterThanOrEqual(3);
    }
  }, 900_000);

  it('maps far above level + 3 are dangerous: an under-levelled character struggles or dies', () => {
    let dangerous = 0;
    for (const seed of SEEDS) {
      const { characters } = playProgression(seed, 5);
      const ch = characters[characters.length - 1];
      // tierForLevel rounds DOWN to a playable tier. Step up so this map really is at least 15 levels ahead.
      const tier = tierForLevel(ch.level, 15) + 1;
      const map = createMapItem('ashenForge', tier, `too-far-${seed}`);
      const r = playMap(ch, map, { maxMinutes: 25 });
      console.log(`[balance] level ${ch.level} on a tier ${tier} map (at least level + 15): ${describePlay(r)}`);
      if (r.result !== 'cleared' || r.deaths > 0 || r.minLife < 0.3) dangerous++;
    }
    expect(dangerous, 'seeds where level + 15 is dangerous').toBeGreaterThanOrEqual(2);
  }, 900_000);

  it('a party of fresh characters clears Tier 1 together: shared XP, instanced loot', () => {
    for (const size of [2, 4]) {
      const party = Array.from({ length: size }, (_, i) => rules.createCharacter(`Member${i + 1}`, 100 * size + i));
      const map = mapInBag(party[0], (m) => m.baseId === 'ashenForge')!;
      const results = playParty(party, map, { maxMinutes: 25, reenterAfter: REENTER });
      results.forEach((r, i) => console.log(`[balance] party of ${size}, member ${i + 1}: ${describePlay(r)}`));
      for (const r of results) {
        expect(r.result, `party of ${size}`).toBe('cleared');
        expect(r.seconds).toBeLessThanOrEqual(25 * MINUTES);
        // Everyone levels from shared kill XP and loots their own drops.
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
  }, 900_000);
});
