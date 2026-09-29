// GAME_SPEC.md §3–§9 must tell the truth about the numbers the rules implement. These checks read the
// spec text and compare the few numbers that drifted before (affix counts, unique flavour, the early-tier
// easing, name limits, party scaling). If one fails, fix whichever side is wrong — then both agree again.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AFFIXES, BENCH_BEST_TIER, BENCH_MAX_CRAFTED, BENCH_STABILITY_COST, UNIQUES } from '../../src/data/items';
import { PICKUP_REACH } from '../../src/contracts/sim';
import { CHARACTER_NAME_MAX, CHARACTER_NAME_MIN, EARLY_TIER_EASING, PARTY_SCALING } from '../../src/data/progression';

const SPEC = readFileSync(new URL('../../GAME_SPEC.md', import.meta.url), 'utf8');

/** The text of one "## N. Title" section. */
function section(n: number): string {
  const start = SPEC.indexOf(`\n## ${n}. `);
  if (start < 0) throw new Error(`GAME_SPEC has no section ${n}`);
  const end = SPEC.indexOf('\n## ', start + 1);
  return SPEC.slice(start, end < 0 ? undefined : end);
}

describe('GAME_SPEC matches the implemented numbers', () => {
  it('§5 affix counts', () => {
    const prefixes = AFFIXES.filter((a) => a.kind === 'prefix').length;
    const suffixes = AFFIXES.filter((a) => a.kind === 'suffix').length;
    const single = AFFIXES.filter((a) => a.tiers.length === 1).map((a) => a.name);
    expect(section(5)).toContain(`**Affixes:** ${AFFIXES.length} (${prefixes} prefixes, ${suffixes} suffixes)`);
    expect(single).toEqual(['of Splintering']);
    expect(AFFIXES.filter((a) => a.tiers.length > 1).every((a) => a.tiers.length >= 5 && a.tiers.length <= 8)).toBe(true);
  });

  it('§5 unique table: level requirements and flavour text', () => {
    const s5 = section(5);
    for (const u of Object.values(UNIQUES)) {
      expect(s5, u.name).toContain(`**${u.name}** (level ${u.levelRequirement})`);
      expect(s5, u.name).toContain(`"${u.flavor}"`);
    }
  });

  it('§7 early-tier easing table', () => {
    const s7 = section(7);
    for (const e of EARLY_TIER_EASING) {
      const cell = (v: number) => (v ? `${-v}% less` : '–');
      expect(s7, `Tier ${e.tier}`).toContain(`| ${e.tier} | ${cell(e.monsterLife)} | ${cell(e.monsterDamage)} |`);
    }
  });

  it('§12 Crafting Bench limits and click pickup reach', () => {
    const s12 = section(12);
    expect(s12).toContain(`capped at T${BENCH_BEST_TIER}`);
    expect(s12).toContain(`It costs ${BENCH_STABILITY_COST} Stability, with no scar risk`);
    expect(BENCH_MAX_CRAFTED).toBe(1);
    expect(s12).toContain('at most **one bench-crafted affix per item**');
    expect(s12).toContain(`(\`PICKUP_REACH\` = ${PICKUP_REACH})`);
  });

  it('§7 party scaling line and §3 name limits', () => {
    expect(section(7)).toContain(
      `+${PARTY_SCALING.monsterLife}% monster life, +${PARTY_SCALING.waveBudget}% monsters per wave, +${PARTY_SCALING.packRarity}% magic and rare pack chance`,
    );
    expect(section(3)).toContain(`| Name | ${CHARACTER_NAME_MIN}–${CHARACTER_NAME_MAX} characters`);
  });
});
