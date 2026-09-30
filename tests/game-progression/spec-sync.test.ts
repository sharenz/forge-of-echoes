// GAME_SPEC.md §3–§9 must tell the truth about the numbers the rules implement. These checks read the
// spec text and compare the few numbers that drifted before (affix counts, unique flavour, the early-tier
// easing, name limits, party scaling). If one fails, fix whichever side is wrong — then both agree again.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AFFIXES, BENCH_BEST_TIER, BENCH_MAX_CRAFTED, BENCH_STABILITY_COST, UNIQUES } from '../../src/data/items';
import { PICKUP_REACH } from '../../src/contracts/sim';
import { CHARACTER_NAME_MAX, CHARACTER_NAME_MIN, LEVEL_GAP, MONSTER_LEVEL, MONSTER_LEVEL_SCALING, PARTY_SCALING, SORCERESS, TIER_SCALING } from '../../src/data/progression';
import { THEME_ROSTER } from '../../src/contracts/bestiary';
import { CURRENCY_STASH_MAX, MAP_STASH_CAPACITY } from '../../src/contracts/items';
import {
  BLEED_DURATION, BLEED_FRACTION, BLEED_MAX_STACKS, BURN_DURATION, BURN_FRACTION, FREEZE_DURATION, FREEZE_IMMUNITY, PLAYER_CHILL_DURATION,
  PLAYER_CHILL_SLOW, PLAYER_SHOCK_BONUS, PLAYER_SHOCK_DURATION, PULL_MAX_DISTANCE, ROOT_DURATION, ROOT_GRACE, WITHER_DURATION,
  WITHER_MAX_STACKS, WITHER_RES_PER_STACK,
} from '../../src/sim/constants';
import { monsterDef } from '../../src/sim/rosters';

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
    expect(AFFIXES.filter((a) => a.tiers.length > 1).every((a) => a.tiers.length >= 7 && a.tiers.length <= 10)).toBe(true);
  });

  it('§5 unique table: level requirements and flavour text', () => {
    const s5 = section(5);
    for (const u of Object.values(UNIQUES)) {
      expect(s5, u.name).toContain(`**${u.name}** (level ${u.levelRequirement})`);
      expect(s5, u.name).toContain(`"${u.flavor}"`);
    }
  });

  it('§7 monster level curve and level-based scaling', () => {
    const s7 = section(7);
    expect(s7).toContain(`Monster level = \`min(${MONSTER_LEVEL.cap}, ${MONSTER_LEVEL.perTier}·tier − ${-MONSTER_LEVEL.base})\``);
    expect(s7).toContain(`life ×${MONSTER_LEVEL_SCALING.life} and damage ×${MONSTER_LEVEL_SCALING.damage} per level above the reference level ${MONSTER_LEVEL_SCALING.referenceLevel}`);
    expect(s7).toContain(`monster level ${MONSTER_LEVEL_SCALING.steep.level}, then life ×${MONSTER_LEVEL_SCALING.steep.life} and damage ×${MONSTER_LEVEL_SCALING.steep.damage} per level beyond it with life also gaining a flat +${MONSTER_LEVEL_SCALING.steep.lifeFlat} (of base) per level past ${MONSTER_LEVEL_SCALING.steep.level}`);
    expect(s7).toContain(`life ×${MONSTER_LEVEL_SCALING.belowLife}, damage ×${MONSTER_LEVEL_SCALING.belowDamage} per level`);
    expect(s7).toContain(`more than ${LEVEL_GAP.grace} levels above the character it hits deals +${LEVEL_GAP.perLevel * 100}% damage per further level, up to +${LEVEL_GAP.cap * 100}%`);
    expect(s7).toContain(`Evade chance = \`rating / (rating + ${SORCERESS.evasionPerMonsterLevel} × monster level)\``);
    expect(s7).toContain(`experience (Tier 1 gives ×${TIER_SCALING.tierOneExperience}, then ×${TIER_SCALING.experience} per tier above 1`);
    expect(s7).toContain(`+${TIER_SCALING.itemRarity}% item rarity per tier`);
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

  it('§12 special stash capacities', () => {
    const s12 = section(12);
    expect(s12).toContain(`**Map Stash.** Holds up to ${MAP_STASH_CAPACITY} maps.`);
    expect(s12).toContain(`Each slot holds up to ${CURRENCY_STASH_MAX.toLocaleString('en-US')} of its currency.`);
  });

  it('§13 debuff numbers', () => {
    const s13 = section(13);
    const pct = (f: number) => Math.round(f * 100);
    expect(s13).toContain(`−${pct(PLAYER_CHILL_SLOW)}% move and cast speed, ${PLAYER_CHILL_DURATION} s.`);
    expect(s13).toContain(`${FREEZE_DURATION} s, then **${FREEZE_IMMUNITY} s immunity**`);
    expect(s13).toContain(`can still cast, ${ROOT_DURATION} s.`);
    expect(s13).toContain(`for **${ROOT_GRACE} s** after a root ends`);
    expect(s13).toContain(`Fire damage over ${BURN_DURATION} s (${pct(BURN_FRACTION)}% of the triggering hit)`);
    expect(s13).toContain(`${pct(BLEED_FRACTION)}% of the hit over ${BLEED_DURATION} s; **×2 while moving**; stacks up to ${BLEED_MAX_STACKS}`);
    expect(s13).toContain(`+${pct(PLAYER_SHOCK_BONUS)}% damage taken, ${PLAYER_SHOCK_DURATION} s`);
    expect(s13).toContain(
      `−${pct(WITHER_RES_PER_STACK)}% to all non-physical resistances per stack, ${WITHER_DURATION} s (one shared timer); stacks up to ${WITHER_MAX_STACKS}`,
    );
    expect(s13).toContain(`at most ${PULL_MAX_DISTANCE} units`);
  });

  it('§8 and §14 roster stats: every family member, lieutenant and boss', () => {
    const s8 = section(8);
    const s14 = section(14);
    // §8: the Ashen Forge table, one row per kind: | Name | role | radius | life | speed | damage | xp | …
    for (const kind of [...THEME_ROSTER.ashenForge.family, THEME_ROSTER.ashenForge.lieutenant, THEME_ROSTER.ashenForge.boss]) {
      const d = monsterDef(kind);
      const row = new RegExp(`\\| \\**${d.name}\\** \\| [^|]+ \\| ${d.radius} \\| ${d.life} \\| ${d.speed} \\| ${d.damage} \\| ${d.xp} \\|`);
      expect(s8, kind).toMatch(row);
    }
    // §14: the Ossuary / Coliseum table: | Name | life | speed | damage | xp | (twice per row).
    for (const theme of ['rimedOssuary', 'ironColiseum'] as const) {
      const r = THEME_ROSTER[theme];
      for (const kind of [...r.family, r.lieutenant, r.boss]) {
        const d = monsterDef(kind);
        const cells = `${d.name}${kind === r.lieutenant || kind === r.boss ? '**' : ''} | ${d.life} | ${d.speed} | ${d.damage} | ${d.xp} |`;
        expect(s14, kind).toContain(cells);
      }
    }
  });
});
