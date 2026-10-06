// Save version 2 → 3: the skill rework (docs/power-rework/skills.md 9, build-plan.md 5). Runs on the raw JSON of one character
// before it is normalised, once per stored row (rows carry their save version; a migrated row is written back at version 3), and
// is idempotent on its own as well: a character that already has `legacySkillRanks` is returned unchanged.
//
// Owner decision (2026-10-06, overrides the brief's ceil(old rank / 2) mapping): every skill point is refunded.
//   ranks          every skill back to unlearned, except Ember Lance, the innate basic attack, which keeps its free rank 1
//   unspent points = the full new total for the level: 1 + 2 (L − 1) (Lance's innate rank costs nothing, as for a new character)
//   augments       none
//   loadout        reset: Ember Lance on LMB, the other seven slots empty
//   respecTokens   0 (nothing to compensate: every point is already back)
//   unique flags   unchanged ids: the rules map them onto the augment effects they imply, without a slot
//   legacySkillRanks  the old 1-to-20 ranks, kept for one release so a revert can restore them (also the "migrated" marker)
import type { SkillId } from '../../contracts/content';
import { SKILL_IDS } from '../../contracts/content';
import { BASIC_SKILL, skillPointsTotal } from './skills';
import { intIn } from './util';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The highest rank of the old (1 to 20) scale; anything above is clamped as the old normaliser did. */
export const LEGACY_MAX_SKILL_RANK = 20;

/** Migrate one raw character (any JSON value; non-objects are returned as they are). */
export function migrateSkillsV3(raw: unknown): unknown {
  if (!isObj(raw) || isObj(raw.legacySkillRanks)) return raw;
  const rawRanks = isObj(raw.skillRanks) ? raw.skillRanks : {};
  const legacy: Partial<Record<SkillId, number>> = {};
  const skillRanks: Partial<Record<SkillId, number>> = {};
  for (const id of SKILL_IDS) {
    const old = intIn(rawRanks[id], 0, LEGACY_MAX_SKILL_RANK, 0);
    if (old > 0) legacy[id] = old;
    skillRanks[id] = id === BASIC_SKILL ? 1 : 0;
  }
  const level = intIn(raw.level, 1, 1000, 1);
  return {
    ...raw,
    skillRanks,
    augments: {},
    loadout: [BASIC_SKILL],
    unspentSkillPoints: skillPointsTotal(level),
    respecTokens: 0,
    respecFreeUsed: 0,
    legacySkillRanks: legacy,
  };
}
