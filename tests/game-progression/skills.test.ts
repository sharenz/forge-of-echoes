// Skills (GAME_SPEC §4, docs/power-rework/skills.md): rank curves (1 to 10), unlocks by level, the loadout and the skill sheet.
// Augments, respec and presets: augments.test.ts; the save migration: migrate-skills.test.ts.
import { describe, expect, it } from 'vitest';
import type { CharacterSave } from '../../src/contracts/items';
import type { SkillId } from '../../src/contracts/content';
import { rules } from '../../src/game';
import { damageRange } from '../../src/game/progression/skills';
import { normalizeCharacter } from '../../src/game/progression/save';
import { SORCERESS } from '../../src/data/progression';
import { bareCharacter, expectErr, expectOk, unique } from './fixtures';

function withRanks(ranks: Partial<Record<SkillId, number>>, extra: Partial<CharacterSave> = {}): CharacterSave {
  const base = bareCharacter(extra);
  return { ...base, skillRanks: { ...base.skillRanks, ...ranks } };
}

const at = (id: SkillId, rank: number, ch = bareCharacter()) => rules.skillSheet(ch, id, rank).runtime;

/** Level 1 spell power (tuned; GAME_SPEC's starting target was 5) × 6% increased from 30 Intelligence. */
const L1 = SORCERESS.spellPower.base * 1.06;

describe('rank curves', () => {
  it('Ember Lance: effectiveness 1.0 to 2.3, no rank pierce (it moved to Piercing Flame)', () => {
    expect(at('emberLance', 1).damage).toBeCloseTo(L1 * 1.0, 10);
    expect(at('emberLance', 10).damage).toBeCloseTo(L1 * 2.3, 10);
    expect([1, 5, 10].map((r) => at('emberLance', r).pierce)).toEqual([0, 0, 0]);
    expect(at('emberLance', 1)).toMatchObject({ focusCost: 0, castTime: 0.42, cooldown: 0, projectileSpeed: 420, range: 320, critChance: 0.06, ailmentChance: 0.1 });
  });

  it('Ember Nova: 12 to 20 flames (+1 per rank from rank 3), pierce 1 (+1 at ranks 5 and 10)', () => {
    expect([1, 2, 3, 5, 9, 10].map((r) => at('emberNova', r).projectiles)).toEqual([12, 12, 13, 15, 19, 20]);
    expect([1, 4, 5, 9, 10].map((r) => at('emberNova', r).pierce)).toEqual([1, 1, 2, 2, 3]);
    expect(at('emberNova', 10).damage).toBeCloseTo(L1 * 1.8, 10);
    expect(at('emberNova', 1)).toMatchObject({ focusCost: 12, castTime: 0.55, cooldown: 3, range: 170, critChance: 0.05, ailmentChance: 0.15 });
  });

  it('Flame Wave: 5 to 9 waves, wide and slow', () => {
    expect(at('flameWave', 1).projectiles).toBe(5);
    expect(at('flameWave', 10).projectiles).toBe(9);
    expect(at('flameWave', 1)).toMatchObject({ spread: 0.9, projectileSpeed: 180, range: 170, radius: 14, ailmentChance: 0.25, cooldown: 4 });
  });

  it('Rime Shards: 3 to 7 shards (+1 at ranks 3, 5, 7, 9), pierce 2, chill 30%', () => {
    expect([1, 2, 3, 5, 7, 9, 10].map((r) => at('rimeShards', r).projectiles)).toEqual([3, 3, 4, 5, 6, 7, 7]);
    expect(at('rimeShards', 1)).toMatchObject({ damageType: 'cold', pierce: 2, spread: 0.35, projectileSpeed: 360, range: 260, ailmentChance: 0.3, critChance: 0.08 });
  });

  it('Arc Chain: 3 to 8 chains, jump range 90', () => {
    expect(at('arcChain', 1).chains).toBe(3);
    expect(at('arcChain', 10).chains).toBe(8);
    expect(at('arcChain', 1)).toMatchObject({ damageType: 'lightning', radius: 90, range: 240, cooldown: 1, ailmentChance: 0.25, critChance: 0.1 });
  });

  it('Rift Step: 90 to 120 distance, 2 charges (+1 at 5 and 10), no damage', () => {
    expect(at('riftStep', 1)).toMatchObject({ distance: 90, charges: 2, damage: 0, castTime: 0, cooldown: 3.5, critChance: 0, focusCost: 8 });
    expect(at('riftStep', 5).charges).toBe(3);
    expect(at('riftStep', 10)).toMatchObject({ distance: 120, charges: 4 });
    expect(rules.skillSheet(bareCharacter(), 'riftStep', 1).dps).toBeNull();
  });

  it('Cinder Ward: 35% to 55% reduction for 4 to 7 s, cooldown 14 to 9 s, embers at 0.25 effectiveness', () => {
    expect(at('cinderWard', 1)).toMatchObject({ damageReduction: 0.35, duration: 4, cooldown: 14, radius: 40 });
    const r20 = at('cinderWard', 10);
    expect(r20.damageReduction).toBeCloseTo(0.55, 10);
    expect(r20.duration).toBeCloseTo(7, 10);
    expect(r20.cooldown).toBeCloseTo(9, 10);
    expect(at('cinderWard', 1).damage).toBeCloseTo(L1 * 0.25, 10);
  });
});

describe('learning and ranking', () => {
  it('needs a skill point', () => {
    const ch = bareCharacter();
    expect(rules.canRankUpSkill(ch, 'emberNova')).toEqual({ ok: false, reason: 'No skill points left. You gain two every level.' });
  });

  it('unlocks skills by character level, with no prerequisite chains', () => {
    const ch = bareCharacter({ unspentSkillPoints: 3, level: 5 });
    expect(rules.canRankUpSkill(ch, 'rimeShards').ok).toBe(true);
    expect(rules.canRankUpSkill(ch, 'arcChain')).toEqual({ ok: false, reason: 'Arc Chain unlocks at level 6.' });
    expect(rules.canRankUpSkill(ch, 'flameWave')).toEqual({ ok: false, reason: 'Flame Wave unlocks at level 12.' });
    expect(rules.canRankUpSkill({ ...ch, level: 12 }, 'flameWave').ok).toBe(true);
    // A skill learned before its unlock level (an old character) keeps ranking.
    expect(rules.canRankUpSkill(withRanks({ flameWave: 2 }, { unspentSkillPoints: 1, level: 5 }), 'flameWave').ok).toBe(true);
    for (const info of Object.values(rules.content.skills)) expect(info.prerequisite).toBeNull();
  });

  it('refuses roster skills whose behaviour has not shipped', () => {
    const ch = bareCharacter({ unspentSkillPoints: 5, level: 80 });
    expect(rules.content.skills.meteorRain.available).toBe(false);
    expect(rules.canRankUpSkill(ch, 'meteorRain')).toEqual({ ok: false, reason: 'Meteor Rain arrives in a later update.' });
    expect(expectErr(rules.rankUpSkill(ch, 'eventHorizon'))).toMatch(/later update/);
  });

  it('stops at the maximum rank', () => {
    const ch = withRanks({ emberLance: 10 }, { unspentSkillPoints: 5 });
    expect(rules.canRankUpSkill(ch, 'emberLance').reason).toMatch(/maximum rank \(10\)/);
    expect(expectErr(rules.rankUpSkill(ch, 'emberLance'))).toMatch(/maximum rank/);
  });

  it('spends one point and binds a newly learned skill to the first free key', () => {
    const ch = bareCharacter({ unspentSkillPoints: 2 });
    const a = expectOk(rules.rankUpSkill(ch, 'emberNova'));
    expect(a.skillRanks.emberNova).toBe(1);
    expect(a.unspentSkillPoints).toBe(1);
    expect(a.loadout).toEqual(['emberLance', 'emberNova', null, null, null, null, null, null]);
    const b = expectOk(rules.rankUpSkill(a, 'emberNova'));
    expect(b.loadout).toEqual(a.loadout);
    expect(b.skillRanks.emberNova).toBe(2);
  });
});

describe('loadout', () => {
  const ch = withRanks({ emberNova: 3, rimeShards: 1, riftStep: 1 }, { loadout: ['emberLance', 'emberNova', 'riftStep', null, null, null, null, null] });

  it('allows every learned skill in all eight slots, including either mouse button, Space and Z', () => {
    for (const skill of ['emberLance', 'emberNova', 'rimeShards', 'riftStep'] as const) {
      for (let slot = 0; slot < 8; slot++) {
        const moved = expectOk(rules.setLoadoutSlot(ch, slot, skill));
        expect(moved.loadout[slot]).toBe(skill);
        expect(moved.loadout.filter((s) => s === skill)).toHaveLength(1);
        expect(rules.playerRuntime(moved, null).loadout).toEqual(moved.loadout);
        expect(normalizeCharacter(moved)?.loadout).toEqual(moved.loadout);
      }
    }
    expect(expectOk(rules.setLoadoutSlot(ch, 0, 'emberNova')).loadout).toEqual(['emberNova', 'emberLance', 'riftStep', null, null, null, null, null]);
    expect(expectOk(rules.setLoadoutSlot(ch, 0, null)).loadout[0]).toBeNull();
  });

  it('needs rank 1', () => {
    expect(expectErr(rules.setLoadoutSlot(ch, 3, 'cinderWard'))).toMatch(/Learn Cinder Ward first/);
  });

  it('moves a skill instead of duplicating it, swapping with the displaced one', () => {
    const moved = expectOk(rules.setLoadoutSlot(ch, 2, 'emberNova'));
    expect(moved.loadout).toEqual(['emberLance', 'riftStep', 'emberNova', null, null, null, null, null]);
    const placed = expectOk(rules.setLoadoutSlot(ch, 7, 'rimeShards'));
    expect(placed.loadout).toEqual(['emberLance', 'emberNova', 'riftStep', null, null, null, null, 'rimeShards']);
  });

  it('clears slots and rejects slots that do not exist', () => {
    expect(expectOk(rules.setLoadoutSlot(ch, 1, null)).loadout[1]).toBeNull();
    expect(expectErr(rules.setLoadoutSlot(ch, 8, 'emberNova'))).toMatch(/does not exist/);
    expect(expectErr(rules.setLoadoutSlot(ch, -1, null))).toMatch(/does not exist/);
  });

  it('only passes ranked skills to the sim', () => {
    const rt = rules.playerRuntime(ch, null);
    expect(rt.skills.map((s) => s.id)).toEqual(['emberLance', 'emberNova', 'rimeShards', 'riftStep']);
    expect(rt.loadout).toEqual(ch.loadout);
  });
});

describe('skill sheet', () => {
  it('describes the skill with truthful ranges and costs', () => {
    const sheet = rules.skillSheet(bareCharacter(), 'emberNova', 1);
    expect(sheet.rank).toBe(1);
    const avg = L1 * 1.0;
    expect(sheet.lines[0]).toBe(`Deals ${damageRange(avg)} Fire damage`);
    expect(sheet.lines).toContain('Bursts 12 flames outward in a ring reaching 170 units');
    expect(sheet.lines).toContain('Cooldown 3.0 s');
    expect(sheet.lines).toContain('Costs 12 Focus');
    expect(sheet.lines).toContain('15% chance to Ignite');
  });

  it('lists what the next rank changes, including augment slots and tiers', () => {
    const next = rules.skillSheet(bareCharacter(), 'emberNova', 4).nextRankLines;
    expect(next).toContain('Projectiles 14 to 15');
    expect(next).toContain('Pierce 1 to 2');
    expect(next).toContain('Unlocks tier 2 augments');
    expect(rules.skillSheet(bareCharacter(), 'emberNova', 1).nextRankLines).toContain('Augment slots 0 to 1');
    // The damage line shows once the rounded range changes: at level 1 a rank adds well under one point.
    expect(rules.skillSheet(bareCharacter({ level: 20 }), 'emberNova', 4).nextRankLines.some((l) => l.startsWith('Damage '))).toBe(true);
    expect(rules.skillSheet(bareCharacter(), 'emberNova', 10).nextRankLines).toEqual([]);
  });

  it('shows rank 1 numbers for an unlearned skill', () => {
    const sheet = rules.skillSheet(bareCharacter(), 'cinderWard');
    expect(sheet.rank).toBe(0);
    expect(sheet.runtime.rank).toBe(1);
    expect(sheet.nextRankLines).toEqual(['Spend a skill point to learn Cinder Ward at rank 1.']);
  });

  it('estimates single-target DPS including crits', () => {
    const ch = bareCharacter();
    const lance = rules.skillSheet(ch, 'emberLance');
    const rt = lance.runtime;
    expect(lance.dps).toBeCloseTo((rt.damage * (1 + rt.critChance * (rt.critMultiplier - 1))) / 0.42, 10);
    const nova = rules.skillSheet(ch, 'emberNova', 1);
    expect(nova.dps).toBeCloseTo((nova.runtime.damage * (1 + 0.05 * 0.5)) / 3, 10);
    const ward = rules.skillSheet(ch, 'cinderWard', 1);
    // 2 pulses per second while active, 4 s of every 14 s.
    expect(ward.dps).toBeCloseTo(ward.runtime.damage * 1.025 * 2 * (4 / 14), 10);
  });

  it('totals a multi-hit cast and says so', () => {
    const ch = bareCharacter();
    const nova = rules.skillSheet(ch, 'emberNova', 1);
    const rt = nova.runtime;
    const perCast = rt.damage * (1 + rt.critChance * (rt.critMultiplier - 1)) * 12;
    expect(nova.lines).toContain(`${Math.round(perCast)} damage per cast if all 12 flames hit`);
    const chain = rules.skillSheet(ch, 'arcChain', 1);
    expect(chain.lines.some((l) => /damage per cast if all 4 strikes hit$/.test(l))).toBe(true);
    const ward = rules.skillSheet(ch, 'cinderWard', 1);
    expect(ward.lines.some((l) => /damage to each adjacent enemy per cast \(8 pulses\)$/.test(l))).toBe(true);
    // A single bolt has nothing to total.
    expect(rules.skillSheet(ch, 'emberLance').lines.some((l) => l.includes('per cast'))).toBe(false);
  });

  it('says how much of a Focus-hungry skill your regeneration sustains', () => {
    // Rime Shards: 8 Focus every 0.34 s against 3 + 2% of 70 = 4.4 Focus per second.
    const sheet = rules.skillSheet(bareCharacter(), 'rimeShards', 1);
    const sustain = (4.4 * 0.34) / 8;
    const line = sheet.lines.find((l) => l.startsWith('Your 4.4 Focus per second sustains'))!;
    expect(line).toBe(`Your 4.4 Focus per second sustains ${Math.round(sustain * 100)}% of back-to-back casts: `
      + `${(sheet.dps! * sustain).toFixed(1)} of ${Math.round(sheet.dps!)} DPS`);
    // Nova's 12 Focus every 3 s is covered by the same regeneration: no sustain line.
    expect(rules.skillSheet(bareCharacter(), 'emberNova', 1).lines.some((l) => l.includes('sustains'))).toBe(false);
  });

  it('counts the Nova echo in its damage (Echo of the Matriarch)', () => {
    const amulet = unique('echoOfTheMatriarch');
    const plain = rules.skillSheet(bareCharacter({ level: 10 }), 'emberNova', 1);
    const echo = rules.skillSheet(bareCharacter({ level: 10, equipment: { amulet } }), 'emberNova', 1);
    expect(echo.runtime.flags).toContain('echo');
    // Same hit (the amulet adds no damage), twice per cast.
    expect(echo.runtime.damage).toBeCloseTo(plain.runtime.damage, 10);
    expect(echo.dps).toBeCloseTo(plain.dps! * 2, 10);
    expect(echo.lines).toContain(`${Math.round((plain.dps! * 3 * 12 * 2))} damage per cast if all 24 flames hit`);
  });

  it('resolves the fan of a single bolt that gains projectiles, so the sim and tooltip agree', () => {
    const band = unique('ruinheartBand');
    const ch = bareCharacter({ level: 10, equipment: { ring1: band } });
    const lance = rules.skillSheet(ch, 'emberLance');
    expect(lance.runtime.projectiles).toBe(2);
    expect(lance.runtime.spread).toBeCloseTo(0.12, 10);
    expect(lance.lines).toContain('Fires 2 bolts in a 7° fan');
    // Fans keep their own spread; a Nova ring has none.
    expect(rules.skillSheet(ch, 'rimeShards', 1).runtime.spread).toBe(0.35);
    expect(rules.skillSheet(ch, 'emberNova', 1).runtime.spread).toBe(0);
    expect(rules.skillSheet(bareCharacter(), 'emberLance').runtime.spread).toBe(0);
  });

  it('falls back to the current rank for a rank that is not a number', () => {
    const ch = withRanks({ emberNova: 4 });
    expect(rules.skillSheet(ch, 'emberNova', Number.NaN).rank).toBe(4);
    expect(rules.skillSheet(ch, 'emberNova', Number.POSITIVE_INFINITY).rank).toBe(4);
    expect(rules.skillSheet(ch, 'emberNova', 99).rank).toBe(10);
  });

  it('matches the runtime the sim receives', () => {
    const ch = withRanks({ emberNova: 7 }, { level: 15 });
    const fromSheet = rules.skillSheet(ch, 'emberNova').runtime;
    const fromRun = rules.playerRuntime(ch, null).skills.find((s) => s.id === 'emberNova');
    expect(fromRun).toEqual(fromSheet);
  });
});
