// Tier 1–6 across the three map types (GAME_SPEC §7, §13, §14), on demand:
//
//   BALANCE=1 npx vitest run tests/game-progression/balance-ladder.test.ts      (about five minutes)
//
// Reference characters climb a ladder the way the fastest player would — Tier 1, Tier 1, Tier 2, Tier 3, Tier 4,
// Tier 5, one map each, rotating the map type, equipping upgrades between maps (playthrough.ts upgradeGear) — and
// at each rung the same character plays that tier of EVERY map type. Tier 1 is played by a new character. So each
// map type is measured against identical characters, "on level" for the tier by construction, and the ramp per tier
// can be compared across map types:
//   • every map is cleared, nobody dies;
//   • clear times per tier within ±20% of that tier's mean over the three map types;
//   • lowest-life margins comparable (mean lowest life per map type within 0.2 of each other, every type below 0.85);
//   • boss fights (from the boss's arrival to its fall, the final wave's horde included) take 30–90 s at the median
//     per map type, and none drags past four minutes;
//   • nothing holds a player in place longer than a root and a freeze back to back (GAME_SPEC §13);
//   • a pair of reference characters clears Tiers 2, 4 and 6 of every map type.
// The results table prints with the test (run with --silent=false).
import { beforeAll, describe, expect, it } from 'vitest';
import { MAP_BASE_IDS, type MapBaseId } from '../../src/contracts/content';
import type { CharacterSave } from '../../src/contracts/items';
import { SIM_DT, type SimEvent, type WorldView } from '../../src/contracts/sim';
import { rules } from '../../src/game';
import { createMapItem } from '../../src/game/progression';
import { FREEZE_DURATION, ROOT_DURATION } from '../../src/sim/constants';
import { describePlay, playParty, upgradeGear, type PlayResult } from './playthrough';

const enabled = !!process.env.BALANCE;
const SEEDS = [1, 2, 3] as const;
const TIERS = [1, 2, 3, 4, 5, 6] as const;
/** The ladder's maps: snapshot k (after k maps) is on level for Tier k (k ≥ 2); a new character plays Tier 1. */
const LADDER_TIERS = [1, 1, 2, 3, 4, 5] as const;

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

/** Reference characters for one seed: index 0 = new, index k = after k ladder maps. */
function ladder(seed: number): CharacterSave[] {
  let ch = rules.createCharacter('Ladder', seed);
  const out = [ch];
  LADDER_TIERS.forEach((tier, k) => {
    const theme = MAP_BASE_IDS[(seed + k) % MAP_BASE_IDS.length];
    const r = playParty([ch], createMapItem(theme, tier, `ladder-${seed}-${k}`), { maxMinutes: 20 })[0];
    ch = upgradeGear(r.character);
    out.push(ch);
  });
  return out;
}

const onLevel = (snaps: CharacterSave[], tier: number): CharacterSave => snaps[tier === 1 ? 0 : tier];

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
  const results = playParty(chars, map, { maxMinutes: 20, onStep });
  return { theme, tier, seed, results, bossSeconds: bossAt >= 0 && fellAt >= 0 ? (fellAt - bossAt) * SIM_DT : -1, longestHeld };
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

describe.runIf(enabled)('Tier 1–6 across map types (BALANCE=1)', () => {
  const solo: Played[] = [];
  const pairs: Played[] = [];
  const pick = (theme: MapBaseId, tier?: number) => solo.filter((p) => p.theme === theme && (tier === undefined || p.tier === tier));

  beforeAll(() => {
    const snaps = new Map<number, CharacterSave[]>();
    for (const seed of [...SEEDS, 501]) snaps.set(seed, ladder(seed));
    for (const seed of SEEDS) {
      for (const tier of TIERS) for (const theme of MAP_BASE_IDS) solo.push(play([onLevel(snaps.get(seed)!, tier)], theme, tier, seed));
    }
    for (const tier of [2, 4, 6]) {
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
    console.log(`[balance] Tier 1–6, seeds ${SEEDS.join(', ')} (means; boss = median)\n${lines.join('\n')}`);
    for (const p of pairs) p.results.forEach((r, k) => console.log(`[balance] pair, member ${k + 1}: ${describePlay(r)}`));
  }, 1_500_000);

  it('every map of every tier is cleared, nobody dies', () => {
    for (const p of solo) {
      const r = p.results[0];
      expect(r.result, `seed ${p.seed}: ${describePlay(r)}`).toBe('cleared');
      expect(r.deaths, `seed ${p.seed}: ${describePlay(r)}`).toBe(0);
    }
  });

  it('clear times ramp alike: per tier, every map type within ±20% of the tier mean', () => {
    for (const tier of TIERS) {
      const byTheme = MAP_BASE_IDS.map((theme) => mean(pick(theme, tier).map((p) => p.results[0].seconds)));
      const tierMean = mean(byTheme);
      MAP_BASE_IDS.forEach((theme, k) => {
        expect(Math.abs(byTheme[k] / tierMean - 1), `T${tier} ${theme}: ${Math.round(byTheme[k])} s vs a mean of ${Math.round(tierMean)} s`)
          .toBeLessThanOrEqual(0.2);
      });
    }
  });

  it('lowest-life margins are comparable across map types, and every map type pushes back', () => {
    const margins = MAP_BASE_IDS.map((theme) => mean(pick(theme).map((p) => p.results[0].minLife)));
    const label = MAP_BASE_IDS.map((t, k) => `${t} ${margins[k].toFixed(2)}`).join(', ');
    expect(Math.max(...margins) - Math.min(...margins), label).toBeLessThanOrEqual(0.2);
    for (const m of margins) expect(m, label).toBeLessThan(0.85);
  });

  it('boss fights take 30–90 s at the median for each map type (the final wave included), none drags past 4 minutes', () => {
    for (const theme of MAP_BASE_IDS) {
      const secs = pick(theme).map((p) => p.bossSeconds);
      expect(Math.min(...secs), `${theme}: a boss never fell`).toBeGreaterThan(0);
      const m = median(secs);
      expect(m, `${theme} boss fights: ${secs.map(Math.round).join(', ')}`).toBeGreaterThanOrEqual(30);
      expect(m, `${theme} boss fights: ${secs.map(Math.round).join(', ')}`).toBeLessThanOrEqual(90);
      expect(Math.max(...secs), `${theme} boss fights: ${secs.map(Math.round).join(', ')}`).toBeLessThan(240);
    }
  });

  it('nothing holds a player longer than a root and a freeze back to back', () => {
    for (const p of [...solo, ...pairs]) {
      expect(p.longestHeld, `${p.theme} T${p.tier} seed ${p.seed}`).toBeLessThanOrEqual(ROOT_DURATION + FREEZE_DURATION + SIM_DT);
    }
  });

  it('a pair of reference characters clears Tiers 2, 4 and 6 of every map type', () => {
    for (const p of pairs) for (const r of p.results) {
      expect(r.result, describePlay(r)).toBe('cleared');
      expect(r.deaths, describePlay(r)).toBe(0);
    }
  });
});
