// Tier 1–3 across the three map types (GAME_SPEC §7, §13, §14), on demand:
//
//   BALANCE=1 npx vitest run tests/game-progression/balance-ladder.test.ts      (about ten minutes)
//
// Reference characters are "normal players": a fresh character plays maps up to level + 3 (playProgression), and at
// each rung the character whose level matches that tier (level >= monster level - 3) plays that tier of EVERY map
// type. Tier 1 is played by a new character. So each map type is measured against identical characters, "on level"
// for the tier by construction, and the ramp per tier can be compared across map types:
//   • every map is cleared (through the portals), and on-level maps cost at most two deaths;
//   • clear times per tier within ±30% of that tier's mean over the three map types;
//   • lowest-life margins comparable (mean lowest life per map type within 0.2 of each other, every type below 0.85);
//   • boss fights (from the boss's arrival to its fall, the final wave's horde included) take 30–240 s at the median
//     per map type, and none drags past seven minutes (the first map's Matriarch is the slowest for the bot);
//   • nothing holds a player in place longer than a root and a freeze back to back (GAME_SPEC §13);
//   • a pair of reference characters clears Tiers 2 and 3 of every map type.
// The results table prints with the test (run with --silent=false).
import { beforeAll, describe, expect, it } from 'vitest';
import { MAP_BASE_IDS, type MapBaseId } from '../../src/contracts/content';
import type { CharacterSave } from '../../src/contracts/items';
import { SIM_DT, type SimEvent, type WorldView } from '../../src/contracts/sim';
import { rules } from '../../src/game';
import { createMapItem, monsterLevelForTier } from '../../src/game/progression';
import { FREEZE_DURATION, ROOT_DURATION } from '../../src/sim/constants';
import { describePlay, playParty, playProgression, type PlayResult } from './playthrough';

const enabled = !!process.env.BALANCE;
const SEEDS = [1, 2, 3] as const;
const TIERS = [1, 2, 3] as const;

interface Played {
  theme: MapBaseId;
  tier: number;
  seed: number;
  results: PlayResult[];
  /** Seconds from the boss's arrival to its fall (−1: it never fell). */
  bossSeconds: number;
  /** Longest unbroken stretch any player was rooted or frozen (s). */
  longestHeld: number;
}

/** The reference character on level for `tier`: a new character for Tier 1, else the first with level >= monster level - 3. */
function onLevel(characters: CharacterSave[], tier: number): CharacterSave {
  if (tier === 1) return characters[0];
  const level = monsterLevelForTier(tier) - 3;
  return characters.find((c) => c.level >= level) ?? characters[characters.length - 1];
}

function play(chars: CharacterSave[], theme: MapBaseId, tier: number, seed: number): Played {
  let bossAt = -1;
  let fellAt = -1;
  const held = new Map<number, number>();
  let longestHeld = 0;
  const onStep = (events: readonly SimEvent[], view: WorldView, t: number) => {
    if (view.run.boss && bossAt < 0) bossAt = t;
    if (fellAt < 0 && events.some((e) => e.t === 'cleared')) fellAt = t;
    for (const p of view.players) {
      const h = !p.dead && p.debuffs.some((d) => (d.id === 'rooted' || d.id === 'frozen') && d.remaining > 0);
      const run = h ? (held.get(p.id) ?? 0) + 1 : 0;
      held.set(p.id, run);
      longestHeld = Math.max(longestHeld, run * SIM_DT);
    }
  };
  const map = createMapItem(theme, tier, `balance-${theme}-${tier}-${seed}-${chars.length}`);
  const results = playParty(chars, map, { maxMinutes: 25, reenterAfter: 12, onStep });
  return { theme, tier, seed, results, bossSeconds: bossAt >= 0 && fellAt >= 0 ? (fellAt - bossAt) * SIM_DT : -1, longestHeld };
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

describe.runIf(enabled)('Tier 1–3 across map types (BALANCE=1)', () => {
  const solo: Played[] = [];
  const pairs: Played[] = [];
  const pick = (theme: MapBaseId, tier?: number) => solo.filter((p) => p.theme === theme && (tier === undefined || p.tier === tier));

  beforeAll(() => {
    const snaps = new Map<number, CharacterSave[]>();
    for (const seed of [...SEEDS, 501]) snaps.set(seed, playProgression(seed, 10).characters);
    for (const seed of SEEDS) {
      for (const tier of TIERS) for (const theme of MAP_BASE_IDS) solo.push(play([onLevel(snaps.get(seed)!, tier)], theme, tier, seed));
    }
    for (const tier of [2, 3]) {
      for (const theme of MAP_BASE_IDS) pairs.push(play([onLevel(snaps.get(1)!, tier), onLevel(snaps.get(501)!, tier)], theme, tier, 1));
    }
    // The results table.
    const lines = ['tier  map type       clear (s)  lowest life  boss (s)  flasks  level'];
    for (const tier of TIERS) {
      for (const theme of MAP_BASE_IDS) {
        const ps = pick(theme, tier);
        const rs = ps.map((p) => p.results[0]);
        lines.push(`T${tier}    ${theme.padEnd(13)}  ${Math.round(mean(rs.map((r) => r.seconds))).toString().padStart(8)}  `
          + `${mean(rs.map((r) => r.minLife)).toFixed(2).padStart(11)}  ${Math.round(median(ps.map((p) => p.bossSeconds))).toString().padStart(8)}  `
          + `${mean(rs.map((r) => r.flasksDrunk)).toFixed(1).padStart(6)}  ${rs.map((r) => r.levelEnd).join('/')}`);
      }
    }
    console.log(`[balance] Tier 1–3, seeds ${SEEDS.join(', ')} (means; boss = median)\n${lines.join('\n')}`);
    for (const p of pairs) p.results.forEach((r, k) => console.log(`[balance] pair, member ${k + 1}: ${describePlay(r)}`));
  }, 1_500_000);

  it('every map of every tier is cleared through the portals, and on-level maps cost at most two deaths', () => {
    for (const p of solo) {
      const r = p.results[0];
      expect(r.result, `seed ${p.seed}: ${describePlay(r)}`).toBe('cleared');
      if (p.tier > 1) expect(r.deaths, `seed ${p.seed}: ${describePlay(r)}`).toBeLessThanOrEqual(2);
    }
  });

  it('clear times ramp alike: per tier, every map type within ±30% of the tier mean', () => {
    for (const tier of TIERS) {
      const byTheme = MAP_BASE_IDS.map((theme) => mean(pick(theme, tier).map((p) => p.results[0].seconds)));
      const tierMean = mean(byTheme);
      MAP_BASE_IDS.forEach((theme, k) => {
        expect(Math.abs(byTheme[k] / tierMean - 1), `T${tier} ${theme}: ${Math.round(byTheme[k])} s vs a mean of ${Math.round(tierMean)} s`)
          .toBeLessThanOrEqual(0.3);
      });
    }
  });

  it('lowest-life margins are comparable across map types, and every map type pushes back', () => {
    const margins = MAP_BASE_IDS.map((theme) => mean(pick(theme).map((p) => p.results[0].minLife)));
    const label = MAP_BASE_IDS.map((t, k) => `${t} ${margins[k].toFixed(2)}`).join(', ');
    expect(Math.max(...margins) - Math.min(...margins), label).toBeLessThanOrEqual(0.2);
    for (const m of margins) expect(m, label).toBeLessThan(0.85);
  });

  it('boss fights take 30–240 s at the median for each map type (the final wave included), none drags past 7 minutes', () => {
    for (const theme of MAP_BASE_IDS) {
      const secs = pick(theme).map((p) => p.bossSeconds);
      expect(Math.min(...secs), `${theme}: a boss never fell`).toBeGreaterThan(0);
      const m = median(secs);
      expect(m, `${theme} boss fights: ${secs.map(Math.round).join(', ')}`).toBeGreaterThanOrEqual(30);
      expect(m, `${theme} boss fights: ${secs.map(Math.round).join(', ')}`).toBeLessThanOrEqual(240);
      expect(Math.max(...secs), `${theme} boss fights: ${secs.map(Math.round).join(', ')}`).toBeLessThan(420);
    }
  });

  it('nothing holds a player longer than a root and a freeze back to back', () => {
    for (const p of [...solo, ...pairs]) {
      expect(p.longestHeld, `${p.theme} T${p.tier} seed ${p.seed}`).toBeLessThanOrEqual(ROOT_DURATION + FREEZE_DURATION + SIM_DT);
    }
  });

  it('a pair of reference characters clears Tiers 2 and 3 of every map type', () => {
    for (const p of pairs) for (const r of p.results) {
      expect(r.result, describePlay(r)).toBe('cleared');
      expect(r.deaths, describePlay(r)).toBeLessThanOrEqual(2);
    }
  });
});
