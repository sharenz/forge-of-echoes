// The skill-rework save migration (save version 2 → 3; game/progression/migrate-skills.ts). Owner decision 2026-10-06: every
// skill point is refunded (no rank mapping); Ember Lance, the innate basic attack, keeps its free rank 1 on LMB.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SKILL_IDS } from '../../src/contracts/content';
import type { SkillId } from '../../src/contracts/content';
import { LOADOUT_SLOTS } from '../../src/contracts/items';
import { createRng } from '../../src/core/rng';
import { SAVE_VERSION } from '../../src/data/progression';
import { rules } from '../../src/game';
import { migrateSkillsV3 } from '../../src/game/progression/migrate-skills';
import { buildPlayerModel } from '../../src/game/progression/model';
import { skillPointsSpent } from '../../src/game/progression/skills';

const LEGACY = readFileSync(new URL('./fixtures/legacy-skills-v2.json', import.meta.url), 'utf8');
const OLD_SKILLS: readonly SkillId[] = ['emberLance', 'emberNova', 'flameWave', 'rimeShards', 'arcChain', 'riftStep', 'cinderWard'];

/** A consistent old (save version 2) character: 1 point per level, ranks 1 to 20, a six-slot loadout. */
function oldCharacter(seed: number): Record<string, unknown> {
  const rng = createRng(seed);
  const level = 1 + Math.floor(rng.next() * 60);
  const skillRanks: Record<string, number> = { emberLance: 1 };
  let points = level; // the starting point plus one per level after the first
  const order = [...OLD_SKILLS].sort(() => rng.next() - 0.5);
  for (const id of order) {
    if (points <= 0) break;
    const add = Math.min(points, Math.floor(rng.next() * 12), 20 - (skillRanks[id] ?? 0));
    skillRanks[id] = (skillRanks[id] ?? 0) + add;
    points -= add;
  }
  const learned = OLD_SKILLS.filter((id) => (skillRanks[id] ?? 0) > 0);
  return {
    ...rules.createCharacter(`Old ${seed}`, seed),
    level, skillRanks, unspentSkillPoints: points,
    loadout: learned.slice(0, 6),
    augments: undefined, loadoutPresets: undefined, respecTokens: undefined, respecFreeUsed: undefined,
  };
}

function loadV2(characters: unknown[]) {
  return rules.parseSave(JSON.stringify({ version: 2, characters, lastCharacterId: null, settings: null })).characters;
}

describe('skill migration (save version 2 → 3)', () => {
  it('bumped the save version', () => {
    expect(SAVE_VERSION).toBe(3);
  });

  it('refunds every point of the legacy fixture and keeps Ember Lance on LMB', () => {
    const ch = rules.parseSave(LEGACY).characters[0];
    expect(ch.level).toBe(17);
    expect(Object.entries(ch.skillRanks).filter(([, r]) => r)).toEqual([['emberLance', 1]]);
    expect(ch.unspentSkillPoints).toBe(rules.skillPointsTotal(17));
    expect(ch.unspentSkillPoints).toBe(33);
    expect(ch.augments).toEqual({});
    expect(ch.loadout).toEqual(['emberLance', ...Array(LOADOUT_SLOTS - 1).fill(null)]);
    expect(ch.legacySkillRanks).toEqual({ emberLance: 6, emberNova: 4, flameWave: 1, rimeShards: 3, arcChain: 2, riftStep: 1 });
    expect(ch.respecTokens).toBe(0);
    // Everything else is untouched: level, XP, attributes, items, Scrap, the log.
    expect(ch).toMatchObject({ xp: 1200, unspentAttributePoints: 2, allocated: { str: 10, dex: 8, int: 28 }, currencyStash: { scrap: 40 } });
    expect(ch.equipment.amulet?.uniqueId).toBe('echoOfTheMatriarch');
    expect(ch.stats.kills).toBe(4000);
  });

  it('keeps item-granted (unique) skill flags valid: the echo still works once Nova is learned again', () => {
    const ch = rules.parseSave(LEGACY).characters[0];
    expect(buildPlayerModel(ch).flags).toContain('novaEcho');
    const learned = rules.rankUpSkill(ch, 'emberNova');
    expect(learned.ok).toBe(true);
    if (!learned.ok) return;
    expect(rules.skillSheet(learned.value, 'emberNova').runtime.flags).toContain('echo');
  });

  it('migrates the old server fixture too (version 1, level 7)', () => {
    const old = JSON.parse(readFileSync(new URL('../server/fixtures/old-character-v1.json', import.meta.url), 'utf8')) as unknown;
    const ch = rules.parseSave(JSON.stringify({ version: 1, characters: [old], lastCharacterId: null, settings: null })).characters[0];
    expect(ch.unspentSkillPoints).toBe(rules.skillPointsTotal(7));
    expect(ch.loadout[0]).toBe('emberLance');
  });

  it('is idempotent: a migrated character passes through unchanged, and a saved one never migrates again', () => {
    const raw = JSON.parse(LEGACY).characters[0] as Record<string, unknown>;
    const once = migrateSkillsV3(raw);
    expect(migrateSkillsV3(once)).toBe(once);
    const ch = rules.parseSave(LEGACY).characters[0];
    const learned = rules.rankUpSkill(ch, 'emberNova');
    if (!learned.ok) throw new Error(learned.error);
    // Saved at the current version (as the server writes rows back), reloaded: the learned rank stays.
    const again = rules.parseSave(rules.serializeSave({ ...rules.newSave(), characters: [learned.value] })).characters[0];
    expect(again.skillRanks.emberNova).toBe(1);
    expect(again.unspentSkillPoints).toBe(learned.value.unspentSkillPoints);
    // Even an old version tag cannot run it twice: legacySkillRanks marks the character as migrated.
    const tagged = loadV2([learned.value]);
    expect(tagged[0].skillRanks.emberNova).toBe(1);
  });

  it('property: new unspent = the full total (≥ the old unspent), only the basic attack learned, no augments', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const old = oldCharacter(seed);
      const [ch] = loadV2([old]);
      const level = old.level as number;
      expect(ch.unspentSkillPoints, `seed ${seed}`).toBe(rules.skillPointsTotal(level));
      expect(ch.unspentSkillPoints).toBeGreaterThanOrEqual(old.unspentSkillPoints as number);
      // Nothing is lost: every old point (and the doubled per-level grant) is back to spend.
      const oldSpent = Object.values(old.skillRanks as Record<string, number>).reduce((s, r) => s + r, 0) - 1;
      expect(ch.unspentSkillPoints).toBeGreaterThanOrEqual(oldSpent + (old.unspentSkillPoints as number));
      expect(skillPointsSpent(ch)).toBe(0);
      for (const id of SKILL_IDS) expect(ch.skillRanks[id] ?? 0).toBe(id === 'emberLance' ? 1 : 0);
      expect(ch.augments).toEqual({});
      expect(ch.loadout).toEqual(['emberLance', ...Array(LOADOUT_SLOTS - 1).fill(null)]);
      expect(ch.loadoutPresets).toHaveLength(3);
      for (const [id, r] of Object.entries(old.skillRanks as Record<string, number>)) if (r > 0) expect(ch.legacySkillRanks?.[id as SkillId]).toBe(r);
    }
  });

  it('leaves non-characters alone', () => {
    expect(migrateSkillsV3(null)).toBeNull();
    expect(migrateSkillsV3([1])).toEqual([1]);
    expect(loadV2(['nope', 5])).toEqual([]);
  });
});
