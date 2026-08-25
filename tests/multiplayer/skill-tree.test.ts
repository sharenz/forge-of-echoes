import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE_SKILLS } from "../../app/game/config/skills";
import { createInitialProfile } from "../../app/game/profile";
import { allocateSkillPoint, normalizeSkillLevels } from "../../app/game/progression";
import { resolveSkillDefinition } from "../../app/game/skills";
import { attackCommandSchema, profileCommandRequestSchema } from "../../multiplayer/protocol";

const leveled = (times: number) => {
  let profile = createInitialProfile();
  profile = {
    ...profile,
    character: { ...profile.character, unspentSkillPoints: times + 10 },
  };
  for (let index = 0; index < times; index += 1) {
    const next = allocateSkillPoint(profile, "nova");
    assert.notEqual(next, profile, `nova allocation ${index + 1} should apply`);
    profile = next;
  }
  return profile;
};

test("tree prerequisites gate learning until entry skills reach the required rank", () => {
  const fresh = createInitialProfile();
  const before = allocateSkillPoint(fresh, "frostShards");
  assert.equal(before, fresh, "locked tier-2 skills cannot be learned");

  const prepared = leveled(3);
  assert.equal(prepared.character.skillLevels.nova, 4);
  const unlocked = allocateSkillPoint(prepared, "frostShards");
  assert.equal(unlocked.character.skillLevels.frostShards, 1);
  assert.equal(unlocked.character.unspentSkillPoints, prepared.character.unspentSkillPoints - 1);

  const cometBlocked = allocateSkillPoint(unlocked, "cinderComet");
  assert.equal(cometBlocked, unlocked, "capstones stay locked below their requirement");
});

test("new skill fields resolve with level scaling", () => {
  const bloom = ACTIVE_SKILLS.lifeBloom;
  const rank1 = resolveSkillDefinition(bloom, 1);
  assert.equal(rank1.recoveryAmount, bloom.recoveryAmount);
  assert.ok(rank1.cooldown > 0);
  const rank5 = resolveSkillDefinition(bloom, 5);
  assert.ok(rank5.recoveryAmount > rank1.recoveryAmount, "recovery scales per level");
  assert.ok(rank5.cooldown < rank1.cooldown, "cooldown shrinks per level");

  const phase = resolveSkillDefinition(ACTIVE_SKILLS.phaseStep, 1);
  assert.equal(phase.dashDistance, ACTIVE_SKILLS.phaseStep.dashDistance);
  assert.equal(phase.maxCharges, ACTIVE_SKILLS.phaseStep.maxCharges);

  const comet = resolveSkillDefinition(ACTIVE_SKILLS.cinderComet, 1);
  assert.equal(comet.projectileSpeed, ACTIVE_SKILLS.cinderComet.projectileSpeed);
  assert.equal(comet.projectileRange, ACTIVE_SKILLS.cinderComet.projectileRange);
  assert.ok(comet.damage && comet.damage.effectiveness > 2, "comet stays a heavy single strike");
});

test("legacy profiles migrate to the full skill-level record", () => {
  const migrated = normalizeSkillLevels({ nova: 7 });
  assert.deepEqual(migrated, {
    nova: 7, dash: 1, ward: 1, flameWave: 1,
    frostShards: 0, cinderComet: 0, lifeBloom: 0, phaseStep: 0,
  });
  const clamped = normalizeSkillLevels({ nova: 999, frostShards: 3.9 });
  assert.equal(clamped.nova, ACTIVE_SKILLS.nova.progression.maxLevel);
  assert.equal(clamped.frostShards, 3);
});

test("wire schemas accept every tree skill id", () => {
  for (const skill of ["basic", ...Object.keys(ACTIVE_SKILLS)] as const) {
    const parsed = attackCommandSchema.safeParse({
      sequence: 1,
      skill,
      ...(skill !== "nova" && skill !== "ward" && skill !== "lifeBloom" ? { direction: { x: 1, y: 0 } } : {}),
    });
    assert.equal(parsed.success, true, `${skill} must parse as an attack command`);
  }
  const command = profileCommandRequestSchema.safeParse({ revision: 1, command: { type: "allocate_skill", skill: "phaseStep" } });
  assert.equal(command.success, true, "phaseStep must parse as an allocation command");
});
