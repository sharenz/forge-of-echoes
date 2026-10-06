// The skill executor (src/sim/skills): behaviour data per skill, the emitters, and the augment primitives the rules can emit
// (echo, fan, invulnerable). The seven original skills keep their exact behaviour: the determinism goldens pin that.
import { describe, expect, it } from 'vitest';
import type { SkillId } from '../../src/contracts/content';
import { SKILL_IDS } from '../../src/contracts/content';
import type { CharacterSave } from '../../src/contracts/items';
import { AUGMENT_PRIMITIVES } from '../../src/contracts/sim';
import { SKILLS } from '../../src/data/progression';
import { rules } from '../../src/game';
import { SKILL_BEHAVIOURS, releaseSkill, tickPendingNovas } from '../../src/sim/skills';
import { DASH_INVULN } from '../../src/sim/constants';
import { bareCharacter } from '../game-progression/fixtures';
import { makeArena } from './helpers';
import { makeSkill } from './fixtures';

function armed(skill: SkillId, augments: string[], extra: Partial<CharacterSave> = {}) {
  const ch = bareCharacter({ level: 40, augments: { [skill]: augments }, skillRanks: { emberLance: 1, [skill]: 10 }, ...extra });
  const def = rules.skillSheet(ch, skill, 10).runtime;
  const arena = makeArena({ stats: rules.deriveStats(ch).combat, skills: [def] });
  return { ...arena, def };
}

function liveAngles(a: ReturnType<typeof armed>): number[] {
  const p = a.world.projectiles;
  return Array.from({ length: p.hwm }, (_, i) => i).filter((i) => p.alive[i]).map((i) => Math.atan2(p.vy[i], p.vx[i]));
}

describe('skill executor', () => {
  it('has a behaviour for every playable skill and none for a roster skill that has not shipped', () => {
    for (const id of SKILL_IDS) expect(!!SKILL_BEHAVIOURS[id], id).toBe(SKILLS[id].available);
  });

  it('handles every augment primitive of the contract', () => {
    expect([...AUGMENT_PRIMITIVES].sort()).toEqual(['bounce', 'decay', 'echo', 'fan', 'ground', 'invulnerable', 'restore', 'stride']);
  });

  it('ignores a skill without a behaviour (no cast event, nothing spawned)', () => {
    const a = armed('emberNova', []);
    a.world.events.drain();
    releaseSkill(a.world, a.player, makeSkill('gravityWell'), 100, 0);
    expect(a.world.events.drain()).toEqual([]);
    expect(a.world.projectiles.count).toBe(0);
  });

  it('echo: a picked Echoing Ring repeats the ring once at 70% damage, at the augment delay, and never echoes again', () => {
    const a = armed('emberNova', ['echoingRing']);
    releaseSkill(a.world, a.player, a.def, 100, 0);
    expect(a.player.pendingNovas).toHaveLength(1);
    const echo = a.player.pendingNovas[0];
    expect(echo.at).toBeCloseTo(a.world.time + 0.4, 10);
    expect(echo.def.damage).toBeCloseTo(a.def.damage * 0.7, 10);
    const first = a.world.projectiles.count;
    a.world.time += 0.4;
    tickPendingNovas(a.world, a.player);
    expect(a.world.projectiles.count).toBe(first * 2);
    expect(a.player.pendingNovas).toHaveLength(0);
    // Rime Shards' Glacial Echo works the same way on a projectile fan (60%).
    const b = armed('rimeShards', ['glacialEcho']);
    releaseSkill(b.world, b.player, b.def, 100, 0);
    expect(b.player.pendingNovas[0].def.damage).toBeCloseTo(b.def.damage * 0.6, 10);
  });

  it('echo: the item-granted echo (full damage) wins over a picked one without stacking', () => {
    const def = makeSkill('emberNova', 10);
    const a = armed('emberNova', []);
    a.player.flags.add('novaEcho');
    releaseSkill(a.world, a.player, { ...def, augments: [{ p: 'echo', delay: 0.4, damage: 0.7 }] }, 100, 0);
    expect(a.player.pendingNovas).toHaveLength(1);
    expect(a.player.pendingNovas[0].def.damage).toBe(def.damage);
  });

  it('fan: Ember Fan concentrates the ring into a 120° fan on the aim, and its echo repeats on the aim', () => {
    const a = armed('emberNova', ['emberFan', 'echoingRing']);
    releaseSkill(a.world, a.player, a.def, 100, 0);
    a.player.aimX = 100;
    a.player.aimY = 0;
    a.world.time += 0.4;
    tickPendingNovas(a.world, a.player);
    const angles = liveAngles(a);
    expect(angles).toHaveLength(a.def.projectiles * 2);
    for (const angle of angles) expect(Math.abs(angle)).toBeLessThanOrEqual(Math.PI / 3 + 1e-6); // velocities are Float32
    expect(Math.max(...angles)).toBeCloseTo(Math.PI / 3, 6);
  });

  it('invulnerable: Longer Stride grants 0.3 s after the blink instead of 0.2 s', () => {
    const plain = armed('riftStep', []);
    releaseSkill(plain.world, plain.player, plain.def, plain.player.x + 300, plain.player.y);
    expect(plain.player.invulnTime).toBeCloseTo(DASH_INVULN, 10);
    const long = armed('riftStep', ['longerStride']);
    releaseSkill(long.world, long.player, long.def, long.player.x + 300, long.player.y);
    expect(long.player.invulnTime).toBeCloseTo(0.3, 10);
    expect(long.def.distance).toBeCloseTo(plain.def.distance * 1.3, 10);
  });

  it('flags from augments reach the same executor paths as the unique ones (Ring of Waves, Chilling Landing)', () => {
    const a = armed('flameWave', ['ringOfWaves'], { level: 40 });
    releaseSkill(a.world, a.player, a.def, 100, 0);
    const angles = liveAngles(a);
    expect(angles).toHaveLength(a.def.projectiles);
    // A full circle: the spread between neighbours is even all the way round.
    const sorted = [...angles].sort((x, y) => x - y);
    const step = (Math.PI * 2) / angles.length;
    for (let k = 1; k < sorted.length; k++) expect(sorted[k] - sorted[k - 1]).toBeCloseTo(step, 6);
  });
});
