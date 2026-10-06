// The Orrery's structural rules in play (PT4, docs/power-rework/passive-tree.md 3 and 6): one test per rule id. Each takes the
// numbers the rules resolve for a character holding the node (PlayerCombatStats.passives, the skill runtime, the sheet) and checks
// the sim (or the rules, for rules that live there) against the node's own text. Hit rolls are pinned to their average and crits
// are off, so damage compares exactly. A character without passives carries no `passives` field at all (goldens untouched).
import { describe, expect, it } from 'vitest';
import type { CharacterSave } from '../../src/contracts/items';
import type { PassiveRuntime, PlayerCombatStats } from '../../src/contracts/sim';
import { AILMENT_BASE, DECAY, EXPOSURE, PEN_CAP, WITHER } from '../../src/data/progression';
import { PASSIVE_RULES, isPassiveNodeLive, isPassiveRuleLive, PASSIVE_NODES, type PassiveRuleId } from '../../src/data/progression/passives';
import { rules } from '../../src/game';
import { buildPlayerModel } from '../../src/game/progression/model';
import { passiveTotalsOf } from '../../src/game/progression/passive-rules';
import { FIRE_BURST, SHATTER_NOVA, passiveEffDamage } from '../../src/game/progression/passive-runtime';
import { flaskRuntimes } from '../../src/game/progression/character';
import { killsPerCharge } from '../../src/game/progression/flasks';
import { playerRuntime } from '../../src/game/progression/runs';
import { augmentSlotsFor, canPickAugment, resolveSkill, trimAugments } from '../../src/game/progression/skills';
import {
  BURN_DURATION, CHILL_SLOW, DT, EVASION_CAP, IGNITE_DURATION, IGNITE_FRACTION, SHOCK_BONUS, SHOCK_DURATION, WARD_REDUCTION_CAP,
} from '../../src/sim/constants';
import { releaseSkill } from '../../src/sim/skills';
import { wardCapOf } from '../../src/sim/skills/primitives';
import { bareCharacter } from '../game-progression/fixtures';
import { makeStats } from './fixtures';
import { P1, makeArena, placeMonster, stepN, type Arena } from './helpers';
// After the sim's entry points (combat is part of an import cycle that must start from them).
import { applyAilment, applyDecay, damageMonster, exposeMonster, hitPlayer, killMonster, monsterResist } from '../../src/sim/combat';
import { applyDebuff } from '../../src/sim/debuffs';
import { empowerMult } from '../../src/sim/behaviour';
import { chillSlowOf, chillWeakenOf } from '../../src/sim/passives-state';

const FIRE = 1, COLD = 2, LIGHTNING = 3, VOID = 4, PHYSICAL = 0;
/** Monster life lives in a Float32Array: a target this tough keeps a 100-damage hit exact to about 5e-6. */
const BIG = 4096;

/** A level-40 character holding `nodes` (ids without the `pas.` prefix), with mastery riders and any overrides. */
function holder(nodes: string[], masteries: Record<string, number> = {}, over: Partial<CharacterSave> = {}): CharacterSave {
  return bareCharacter({
    level: 40,
    passives: nodes.map((n) => `pas.${n}` as `pas.${string}`),
    masteries: Object.fromEntries(Object.entries(masteries).map(([k, v]) => [`pas.${k}`, v])),
    ...over,
  });
}

/** The sim numbers of a holder. */
function pr(nodes: string[], masteries: Record<string, number> = {}, over: Partial<CharacterSave> = {}): PassiveRuntime {
  const p = playerRuntime(holder(nodes, masteries, over), null).stats.passives;
  if (!p) throw new Error(`no passive runtime for ${nodes.join(', ')}`);
  return p;
}

/** An arena whose player carries `passives`; rolls pinned to their average. */
function arena(passives: PassiveRuntime | undefined, stats: Partial<PlayerCombatStats> = {}): Arena {
  const a = makeArena({ stats: makeStats({ evasion: 0, maxLife: 1000, maxFocus: 200, ...stats, ...(passives ? { passives } : {}) }) });
  (a.world.combatRng as { range: (lo: number, hi: number) => number }).range = () => 1;
  a.player.life = a.player.stats.maxLife;
  a.player.focus = 0;
  return a;
}

/** A still target without resistances (or with the given ones, DAMAGE_TYPES order). */
function target(a: Arena, x = 60, y = 0, res: number[] = [0, 0, 0, 0, 0], life = BIG): number {
  const i = placeMonster(a.world, 'ashling', x, y, { life });
  for (let k = 0; k < 5; k++) a.world.monsters.res[i * 5 + k] = res[k];
  a.world.grid.build(a.world.monsters);
  return i;
}

/** Damage one hit of `amount` deals (no crit, no ailment). */
function hit(a: Arena, i: number, amount: number, dtype: number, crit = 0): number {
  const m = a.world.monsters;
  const before = m.life[i];
  damageMonster(a.world, i, amount, dtype, crit, 2, 0, 0, 0, 0, true, P1);
  return before - m.life[i];
}

function close(actual: number, expected: number, rel = 2e-5): void {
  expect(Math.abs(actual - expected), `${actual} ≈ ${expected}`).toBeLessThanOrEqual(Math.abs(expected) * rel + 1e-9);
}

const covered = new Set<PassiveRuleId>();
/** `it` for one rule id (the last test checks that every id has one). */
function rule(id: PassiveRuleId, name: string, fn: () => void): void {
  covered.add(id);
  it(`${id}: ${name}`, fn);
}

// ---------------------------------------------------------------------------------------------
describe('plumbing', () => {
  it('a character without passives carries no passive runtime (the sim skips every hook)', () => {
    const rt = playerRuntime(bareCharacter({ level: 40 }), null);
    expect('passives' in rt.stats).toBe(false);
    expect(rules.deriveStats(bareCharacter({ level: 40 })).sections.some((s) => s.title === 'Orrery Effects')).toBe(false);
  });

  it('every rule is live and the UI query agrees; every node is live', () => {
    for (const id of Object.keys(PASSIVE_RULES) as PassiveRuleId[]) expect(isPassiveRuleLive(id), id).toBe(true);
    expect(isPassiveRuleLive('notARule')).toBe(false);
    for (const n of PASSIVE_NODES) expect(isPassiveNodeLive(n), n.id).toBe(true);
  });

  it('the rules mirror the sim constants they build on', () => {
    expect(AILMENT_BASE.shockEffect).toBe(SHOCK_BONUS);
    expect(AILMENT_BASE.chillSlow).toBe(CHILL_SLOW);
    expect(AILMENT_BASE.wardCap).toBe(WARD_REDUCTION_CAP);
    expect(AILMENT_BASE.evadeCap).toBe(EVASION_CAP);
  });

  it('the sheet shows one Orrery line per rule with its source', () => {
    const d = rules.deriveStats(holder(['fire.slowBurn', 'lightning.overload']));
    const sec = d.sections.find((s) => s.title === 'Orrery Effects');
    expect(sec?.lines.map((l) => l.label)).toEqual(['Ignites you cause last 50% longer', 'Shocks you cause last 2 seconds longer']);
    expect(sec?.lines[0].breakdown).toEqual(['From Orrery: Slow Burn']);
  });
});

// ---------------------------------------------------------------------------------------------
describe('ailments and exposure you inflict', () => {
  rule('igniteDuration', 'Slow Burn: ignites last 50% longer (4.5 s)', () => {
    const a = arena(pr(['fire.slowBurn']));
    const i = target(a);
    applyAilment(a.world, i, 100, FIRE, 1, P1);
    close(a.world.monsters.igniteTime[i], IGNITE_DURATION * 1.5);
    close(IGNITE_DURATION * 1.5, 4.5);
  });

  rule('igniteEffect', 'Cinder Attunement (a): ignites deal 25% more', () => {
    const a = arena(pr(['fire.mastery'], { 'fire.mastery': 0 }));
    const i = target(a);
    applyAilment(a.world, i, 100, FIRE, 1, P1);
    close(a.world.monsters.igniteDps[i], ((100 * IGNITE_FRACTION) / IGNITE_DURATION) * 1.25);
  });

  rule('shockEffect', 'Static Charge: shocks 4 points stronger (24% more damage taken)', () => {
    const a = arena(pr(['lightning.staticCharge']));
    const i = target(a);
    applyAilment(a.world, i, 100, LIGHTNING, 1, P1);
    close(hit(a, i, 100, PHYSICAL), 124);
  });

  rule('shockEffectPct', 'Stormbound: shocks 50% stronger (shocked enemies take 30% more)', () => {
    const a = arena(pr(['lightning.stormbound']));
    const i = target(a);
    applyAilment(a.world, i, 100, LIGHTNING, 1, P1);
    close(hit(a, i, 100, PHYSICAL), 130);
  });

  rule('shockDuration', 'Overload: shocks last 2 seconds longer (5 s)', () => {
    const a = arena(pr(['lightning.overload']));
    const i = target(a);
    applyAilment(a.world, i, 100, LIGHTNING, 1, P1);
    close(a.world.monsters.shockTime[i], SHOCK_DURATION + 2);
  });

  rule('chillEffect', 'Frostbound: chill slows 10 points more (40%)', () => {
    const a = arena(pr(['cold.frostbound']));
    const i = target(a);
    applyAilment(a.world, i, 100, COLD, 1, P1);
    close(chillSlowOf(a.world, i, CHILL_SLOW), 0.4);
  });

  rule('chillEffectSet', 'Absolute Zero: your chill slows by 40%', () => {
    const a = arena(pr(['cold.absoluteZero']));
    const i = target(a);
    applyAilment(a.world, i, 100, COLD, 1, P1);
    close(chillSlowOf(a.world, i, CHILL_SLOW), 0.4);
  });

  rule('exposureEffect', 'Sundering Mark (+4 every type), Brittle Bones (+4 cold only), at most 25', () => {
    const a = arena(pr(['void.sunderingMark', 'cold.brittleBones']));
    const i = target(a);
    exposeMonster(a.world, i, FIRE, 10, P1);
    exposeMonster(a.world, i, COLD, 10, P1);
    const m = a.world.monsters;
    close(m.expose[i * 5 + FIRE], 0.14);
    close(m.expose[i * 5 + COLD], 0.18);
    exposeMonster(a.world, i, COLD, 24, P1);
    close(m.expose[i * 5 + COLD], EXPOSURE.max / 100);
  });

  rule('exposureDuration', 'Rime Attunement (b): exposures last 2 seconds longer', () => {
    const a = arena(pr(['cold.mastery'], { 'cold.mastery': 1 }));
    const i = target(a);
    exposeMonster(a.world, i, FIRE, 10, P1);
    close(a.world.monsters.exposeTime[i], EXPOSURE.duration + 2);
  });

  rule('decayDuration', 'Rotting Touch: Decay lasts 2 seconds longer', () => {
    const a = arena(pr(['void.rottingTouch']));
    const i = target(a);
    applyDecay(a.world, i, 100, 1, P1);
    close(a.world.monsters.decayTime[i], DECAY.duration + 2);
  });

  rule('decayEffect', 'Rotting Touch: Decay deals 20% more', () => {
    const a = arena(pr(['void.rottingTouch']));
    const i = target(a);
    applyDecay(a.world, i, 100, 1, P1);
    close(a.world.monsters.decayDps[i], (100 / DECAY.duration) * 1.2);
  });

  rule('decayStacks', 'Hollow Attunement (a): Decay stacks 2 more times', () => {
    const a = arena(pr(['void.mastery'], { 'void.mastery': 0 }));
    const i = target(a);
    for (let k = 0; k < 12; k++) applyDecay(a.world, i, 100, 1, P1);
    expect(a.world.monsters.decayStacks[i]).toBe(DECAY.maxStacks + 2);
  });

  rule('witherStacks', 'Withering Gaze: one more Withered stack, bounded by the 25-point exposure cap', () => {
    const ch = holder(['void.witheringGaze'], {}, { skillRanks: { emberLance: 1, witherField: 10 }, loadout: ['witherField', null, null, null, null, null] });
    const rt = playerRuntime(ch, null);
    const def = rt.skills.find((s) => s.id === 'witherField')!;
    const a = arena(rt.stats.passives, {});
    a.player.skills.set(def.id, def);
    const i = target(a, 80, 0, [0, 0, 0, 0, 0]);
    releaseSkill(a.world, a.player, def, 80, 0);
    stepN(a.run, 60 * 4);
    const m = a.world.monsters;
    expect(m.witherStacks[i]).toBe(WITHER.maxStacks + 1);
    // 4 × 8 = 32 points, but the exposure cap holds Withered at 25.
    close(monsterResist(a.world, i, FIRE), -EXPOSURE.max / 100);
  });
});

// ---------------------------------------------------------------------------------------------
describe('conditional hit damage', () => {
  rule('moreNearBurning', 'Pyroclasm: 6% more fire damage with 3 Burning enemies within 120', () => {
    const a = arena(pr(['fire.pyroclasm']));
    const i = target(a, 60, 0);
    close(hit(a, i, 100, FIRE), 100);
    for (const y of [-40, 0, 40]) {
      const j = target(a, 90, y);
      a.world.monsters.igniteTime[j] = 3;
    }
    a.world.tick++;
    close(hit(a, i, 100, FIRE), 106);
    close(hit(a, i, 100, COLD), 100);
  });

  rule('damageVsBurning', 'Cinder Attunement (b): +12% fire damage against Burning enemies (into the increased pool)', () => {
    const ch = holder(['fire.mastery'], { 'fire.mastery': 1 });
    const p = pr(['fire.mastery'], { 'fire.mastery': 1 });
    const model = buildPlayerModel(ch);
    const inc = model.of('spellDamage', 'fireDamage', 'elementalDamage').filter((m) => m.mode === 'increased').reduce((s, m) => s + m.value, 0);
    close(p.vsBurning[FIRE], 12 / (100 + inc));
    const a = arena(p);
    const i = target(a);
    close(hit(a, i, 100, FIRE), 100);
    a.world.monsters.igniteTime[i] = 3;
    close(hit(a, i, 100, FIRE), 100 * (1 + 12 / (100 + inc)));
  });

  rule('damageVsChilled', 'Brittle Bones: +15% damage against Chilled enemies (every type)', () => {
    const p = pr(['cold.brittleBones']);
    const a = arena(p);
    const i = target(a);
    a.world.monsters.chillTime[i] = 2;
    close(hit(a, i, 100, VOID), 100 * (1 + p.vsChilled[VOID]));
    const model = buildPlayerModel(holder(['cold.brittleBones']));
    const inc = model.of('spellDamage', 'voidDamage').filter((m) => m.mode === 'increased').reduce((t, m) => t + m.value, 0);
    close(p.vsChilled[VOID], 15 / (100 + inc));
  });

  rule('moreVsChilled', 'Absolute Zero: 25% more damage against Chilled enemies', () => {
    const a = arena(pr(['cold.absoluteZero']));
    const i = target(a);
    a.world.monsters.chillTime[i] = 2;
    close(hit(a, i, 100, FIRE), 125);
  });

  rule('lessVsUnchilled', 'Absolute Zero: 20% less damage against enemies that are not Chilled', () => {
    const a = arena(pr(['cold.absoluteZero']));
    const i = target(a);
    close(hit(a, i, 100, FIRE), 80);
  });

  rule('nonCritLess', "Gambler's Edge: non-critical hits deal 25% less", () => {
    const a = arena(pr(['arcana.gamblersEdge']));
    const i = target(a);
    close(hit(a, i, 100, FIRE), 75);
    close(hit(a, i, 100, FIRE, 1), 200);
  });

  rule('otherSkillsLess', 'Primary Practice: skills other than the first loadout skill deal 5% less', () => {
    const ranks = { emberLance: 1, rimeShards: 5 };
    const second = buildPlayerModel(holder(['arcana.primaryPractice'], {}, { skillRanks: ranks, loadout: ['emberLance', 'rimeShards', null, null, null, null] }));
    const first = buildPlayerModel(holder(['arcana.primaryPractice'], {}, { skillRanks: ranks, loadout: ['rimeShards', 'emberLance', null, null, null, null] }));
    close(resolveSkill(second, 'rimeShards', 5).runtime.damage, resolveSkill(first, 'rimeShards', 5).runtime.damage * 0.95);
    close(resolveSkill(first, 'emberLance', 1).runtime.damage, resolveSkill(second, 'emberLance', 1).runtime.damage * 0.95);
  });

  rule('critMultiplierTyped', 'Storm Attunement (c): +30 crit multiplier with lightning skills', () => {
    const base = buildPlayerModel(bareCharacter({ level: 40 }));
    const with_ = buildPlayerModel(holder(['lightning.mastery'], { 'lightning.mastery': 2 }));
    close(resolveSkill(with_, 'arcChain', 5).runtime.critMultiplier, resolveSkill(base, 'arcChain', 5).runtime.critMultiplier + 0.3);
    close(resolveSkill(with_, 'emberLance', 5).runtime.critMultiplier, resolveSkill(base, 'emberLance', 5).runtime.critMultiplier);
  });

  rule('areaTyped', 'Tempest Reach: +10% area for lightning skills', () => {
    const base = buildPlayerModel(bareCharacter({ level: 40 }));
    const with_ = buildPlayerModel(holder(['lightning.tempestReach']));
    const r0 = resolveSkill(base, 'voltaicPulse', 5).runtime.radius;
    close(resolveSkill(with_, 'voltaicPulse', 5).runtime.radius, r0 * Math.sqrt(1.1));
    close(resolveSkill(with_, 'glacialNova', 5).runtime.radius, resolveSkill(base, 'glacialNova', 5).runtime.radius);
  });
});

// ---------------------------------------------------------------------------------------------
describe('triggers', () => {
  rule('igniteSpreadOnDeath', 'Wildfire: an ignited enemy that dies ignites the 2 nearest within 100', () => {
    const a = arena(pr(['fire.wildfire']));
    const v = target(a, 60, 0, undefined, 10);
    const near = [target(a, 100, 0), target(a, 60, 50), target(a, 150, 0)];
    const far = target(a, 300, 0);
    applyAilment(a.world, v, 100, FIRE, 1, P1);
    const dps = a.world.monsters.igniteDps[v];
    killMonster(a.world, v, FIRE, true, P1);
    const m = a.world.monsters;
    close(m.igniteDps[near[0]], dps);
    close(m.igniteDps[near[1]], dps);
    expect(m.igniteTime[near[2]]).toBe(0);
    expect(m.igniteTime[far]).toBe(0);
  });

  rule('fireKillBurst', 'Cinder Attunement (c): a fire kill bursts for 1.2× effectiveness in radius 50 (15% chance)', () => {
    const ch = holder(['fire.mastery'], { 'fire.mastery': 2 });
    const p = pr(['fire.mastery'], { 'fire.mastery': 2 });
    close(p.fireBurstChance, 0.15);
    close(p.fireBurstDamage, passiveEffDamage(buildPlayerModel(ch), 'fire', FIRE_BURST.effectiveness));
    const a = arena(p);
    (a.world.combatRng as { next: () => number }).next = () => 0;
    const v = target(a, 60, 0, undefined, 1);
    const n = target(a, 90, 0);
    killMonster(a.world, v, FIRE, true, P1);
    close(BIG - a.world.monsters.life[n], p.fireBurstDamage);
  });

  rule('shatterNova', 'Shatterpoint: killing a Chilled enemy emits a 2× cold nova in radius 70 (15% chance)', () => {
    const ch = holder(['cold.shatterpoint']);
    const p = pr(['cold.shatterpoint']);
    close(p.shatterDamage, passiveEffDamage(buildPlayerModel(ch), 'cold', SHATTER_NOVA.effectiveness));
    const a = arena(p);
    (a.world.combatRng as { next: () => number }).next = () => 0;
    const v = target(a, 60, 0, undefined, 1);
    const n = target(a, 120, 0);
    a.world.monsters.chillTime[v] = 2;
    killMonster(a.world, v, FIRE, true, P1);
    close(BIG - a.world.monsters.life[n], p.shatterDamage);
  });

  rule('decayedExplode', 'Last Whisper: an enemy killed while Decayed explodes for 8% of its life as void', () => {
    const a = arena(pr(['void.lastWhisper']));
    const v = target(a, 60, 0, undefined, 5000);
    const n = target(a, 100, 0);
    applyDecay(a.world, v, 1, 1, P1);
    killMonster(a.world, v, VOID, true, P1);
    close(BIG - a.world.monsters.life[n], 5000 * 0.08);
  });

  rule('lowLifeWard', 'Last Ember: below 30% life Cinder Ward is cast for free, once every 30 seconds', () => {
    const p = pr(['fire.lastEmber']);
    expect(p.lowLifeWardDef?.id).toBe('cinderWard');
    const a = arena(p);
    a.player.focus = 0;
    a.player.life = 290;
    stepN(a.run, 1);
    expect(a.player.ward.time).toBeGreaterThan(0);
    a.player.ward.time = 0;
    stepN(a.run, 60);
    expect(a.player.ward.time).toBe(0);
  });

  rule('pulseEveryKills', 'Pulse of Life: every 12 kills restore 6% of maximum life', () => {
    const a = arena(pr(['vitality.pulseOfLife']));
    a.player.life = 100;
    for (let k = 0; k < 11; k++) killMonster(a.world, target(a, 60 + k, 0, undefined, 1), FIRE, true, P1);
    expect(a.player.life).toBe(100);
    killMonster(a.world, target(a, 80, 0, undefined, 1), FIRE, true, P1);
    close(a.player.life, 100 + 1000 * 0.06);
  });

  rule('focusOnKillTyped', 'Ember Reservoir: a fire kill restores 3 Focus', () => {
    const a = arena(pr(['fire.emberReservoir']));
    killMonster(a.world, target(a), COLD, true, P1);
    expect(a.player.focus).toBe(0);
    killMonster(a.world, target(a), FIRE, true, P1);
    expect(a.player.focus).toBe(3);
  });

  rule('focusOnKillShocked', 'Surge of Static: killing a Shocked enemy restores 4 Focus', () => {
    const a = arena(pr(['lightning.surgeOfStatic']));
    killMonster(a.world, target(a), FIRE, true, P1);
    expect(a.player.focus).toBe(0);
    const i = target(a);
    a.world.monsters.shockTime[i] = 2;
    killMonster(a.world, i, FIRE, true, P1);
    expect(a.player.focus).toBe(4);
  });

  rule('focusLeech', 'Soul Tithe: 3% of void damage dealt comes back as Focus, at most 6 per second', () => {
    const a = arena(pr(['void.soulTithe']));
    const i = target(a);
    hit(a, i, 100, VOID);
    close(a.player.focus, 3);
    hit(a, i, 1000, VOID);
    close(a.player.focus, 6);
    hit(a, i, 100, FIRE);
    close(a.player.focus, 6);
  });

  rule('lifeOnKillMore', 'Second Wind: Life per Kill is doubled', () => {
    const base = playerRuntime(bareCharacter({ level: 40 }), null).stats.lifeOnKill;
    const with_ = playerRuntime(holder(['vitality.secondWind']), null).stats.lifeOnKill;
    expect(with_).toBe((base + 2) * 2);
  });
});

// ---------------------------------------------------------------------------------------------
describe('skills and augments', () => {
  rule('convert', 'Frostfire Gate: 15% of fire converts to cold (resisted as cold); with Frostfire Core 50% + 15% = 65%', () => {
    const a = arena(pr(['hub.frostfireGate']));
    const i = target(a, 60, 0, [0, 0.5, 0, 0, 0]);
    close(hit(a, i, 100, FIRE), 85 * 0.5 + 15);
    const ch = holder(['hub.frostfireGate'], {}, { skillRanks: { emberLance: 10 }, augments: { emberLance: ['frostfireCore'] } });
    const conv = rules.skillSheet(ch, 'emberLance', 10).runtime.augments?.find((x) => x.p === 'convert');
    expect(conv?.p === 'convert' && conv.share).toBeCloseTo(0.65, 9);
  });

  rule('convertAll', 'Pyre Doctrine: every skill and every hit is fire, with both types\' modifiers', () => {
    const ch = holder(['fire.pyreDoctrine'], {}, { skillRanks: { emberLance: 1, rimeShards: 5 } });
    expect(rules.skillSheet(ch, 'rimeShards', 5).runtime.damageType).toBe('fire');
    const a = arena(pr(['fire.pyreDoctrine']));
    const i = target(a, 60, 0, [0, 0.5, 0, 0, 0]);
    close(hit(a, i, 100, COLD), 50);
  });

  rule('echoAll', 'Echo Cascade: every damaging skill echoes after 0.4 s at 60%, for no Focus', () => {
    const ch = holder(['arcana.echoCascade'], {}, { skillRanks: { emberLance: 1, arcChain: 5 } });
    const rt = playerRuntime(ch, null);
    const def = rt.skills.find((s) => s.id === 'arcChain')!;
    const a = arena(rt.stats.passives);
    target(a);
    releaseSkill(a.world, a.player, def, 60, 0);
    expect(a.player.pendingNovas.length).toBe(1);
    close(a.player.pendingNovas[0].at - a.world.time, 0.4);
    close(a.player.pendingNovas[0].def.damage, def.damage * 0.6);
  });

  rule('echoDamage', 'Reservoir of Echoes: echoes deal 20% more', () => {
    const ch = holder(['arcana.echoCascade', 'arcana.reservoirOfEchoes'], {}, { skillRanks: { emberLance: 1, arcChain: 5 } });
    const rt = playerRuntime(ch, null);
    const def = rt.skills.find((s) => s.id === 'arcChain')!;
    const a = arena(rt.stats.passives);
    releaseSkill(a.world, a.player, def, 60, 0);
    close(a.player.pendingNovas[0].def.damage, def.damage * 0.6 * 1.2);
  });

  rule('augmentSlot', 'Primary Practice: the first loadout skill gets one more augment slot (given back when it goes)', () => {
    const ids = ['piercingFlame', 'ignitingLance', 'splitLance'];
    void ids;
    const base = bareCharacter({ level: 40, skillRanks: { emberLance: 2 }, unspentSkillPoints: 5, loadout: ['emberLance', null, null, null, null, null] });
    expect(augmentSlotsFor(base, 'emberLance')).toBe(1);
    const pp = { ...base, passives: ['pas.arcana.primaryPractice' as const] };
    expect(augmentSlotsFor(pp, 'emberLance')).toBe(2);
    const t1 = rules.content.skills.emberLance.augments.filter((x) => x.tier === 1 && x.available);
    let ch: CharacterSave = pp;
    for (const aug of t1.slice(0, 2)) {
      expect(canPickAugment(ch, 'emberLance', aug.id).ok, aug.id).toBe(true);
      const r = rules.pickAugment(ch, 'emberLance', aug.id);
      if (!r.ok) throw new Error(r.error);
      ch = r.value;
    }
    expect(ch.augments?.emberLance?.length).toBe(2);
    // Without the node the second augment is over the slots: it is refunded.
    const trimmed = trimAugments({ ...ch, passives: [] });
    expect(trimmed.augments?.emberLance?.length).toBe(1);
    expect(trimmed.unspentSkillPoints).toBe(ch.unspentSkillPoints + 1);
  });

  rule('focusCost', 'Razor Doctrine: skills cost 15% more Focus', () => {
    const base = buildPlayerModel(bareCharacter({ level: 40 }));
    const with_ = buildPlayerModel(holder(['void.razorDoctrine']));
    close(resolveSkill(with_, 'emberNova', 5).runtime.focusCost, resolveSkill(base, 'emberNova', 5).runtime.focusCost * 1.15);
  });

  rule('zoneDuration', "Winter's Patience: cold zones and orbs last 20% longer", () => {
    const base = buildPlayerModel(bareCharacter({ level: 40 }));
    const with_ = buildPlayerModel(holder(['cold.wintersPatience']));
    for (const id of ['frostOrb', 'blizzard'] as const) close(resolveSkill(with_, id, 5).runtime.duration, resolveSkill(base, id, 5).runtime.duration * 1.2);
    close(resolveSkill(with_, 'witherField', 5).runtime.duration, resolveSkill(base, 'witherField', 5).runtime.duration);
  });

  rule('pullEffect', "Gravity's Grip: pull effects are 40% stronger", () => {
    const base = buildPlayerModel(bareCharacter({ level: 40 }));
    const with_ = buildPlayerModel(holder(['void.gravitysGrip']));
    const pull = (m: ReturnType<typeof buildPlayerModel>) => {
      const z = resolveSkill(m, 'gravityWell', 5).runtime.augments?.find((x) => x.p === 'zone');
      return z?.p === 'zone' ? z.pull : 0;
    };
    expect(pull(base)).toBeGreaterThan(0);
    close(pull(with_), pull(base) * 1.4);
    close(pr(['void.gravitysGrip']).pullMore, 1.4);
  });

  rule('knockback', 'Concussion: 25% increased knockback', () => {
    const a = arena(pr(['void.concussion']));
    const i = target(a);
    a.world.monsters.knockback[i] = 1;
    damageMonster(a.world, i, 1, PHYSICAL, 0, 2, 0, 1, 0, 0.5, true, P1);
    close(a.world.monsters.kbX[i], 0.5 * 1.25);
  });

  rule('blinkRecovery', "Wanderer's Stride: Phase Stride and Rift Step recover 25% faster", () => {
    const base = buildPlayerModel(bareCharacter({ level: 40 }));
    const with_ = buildPlayerModel(holder(['vitality.wanderersStride']));
    close(resolveSkill(with_, 'riftStep', 5).runtime.cooldown, resolveSkill(base, 'riftStep', 5).runtime.cooldown / 1.25);
    close(resolveSkill(with_, 'phaseStride', 5).runtime.cooldown, resolveSkill(base, 'phaseStride', 5).runtime.cooldown / 1.25);
  });

  rule('rangeLess', "Wanderer's Stride: 25% less projectile range", () => {
    const base = buildPlayerModel(bareCharacter({ level: 40 }));
    const with_ = buildPlayerModel(holder(['vitality.wanderersStride']));
    close(resolveSkill(with_, 'rimeShards', 5).runtime.range, resolveSkill(base, 'rimeShards', 5).runtime.range * 0.75);
  });

  rule('penCap', 'Razor Doctrine: +15 to the penetration cap (55)', () => {
    const p = pr(['void.razorDoctrine']);
    expect(p.penCap).toBe(PEN_CAP + 15);
    const a = arena(p, { pen: { physical: 0, fire: 55, cold: 0, lightning: 0, void: 0 } });
    const i = target(a, 60, 0, [0, 0.75, 0, 0, 0]);
    close(hit(a, i, 100, FIRE), 80);
    const b = arena(undefined, { pen: { physical: 0, fire: 55, cold: 0, lightning: 0, void: 0 } });
    const j = target(b, 60, 0, [0, 0.75, 0, 0, 0]);
    close(hit(b, j, 100, FIRE), 65);
  });
});

// ---------------------------------------------------------------------------------------------
describe('defence and recovery', () => {
  const struck = (a: Arena, amount: number, dtype: number, kind: 'area' | 'dot' = 'area') => {
    const before = a.player.life;
    hitPlayer(a.world, a.player, amount, dtype, kind);
    return before - a.player.life;
  };

  rule('damageTakenTyped', 'Scorch Ward: take 12% less fire damage (hits and burns)', () => {
    const a = arena(pr(['fire.scorchWard']));
    close(struck(a, 100, FIRE), 88);
    close(struck(a, 100, FIRE, 'dot'), 88);
    close(struck(a, 100, COLD), 100);
  });

  rule('damageTakenHits', 'Grounding Rod: take 20% less lightning damage from hits', () => {
    const p = pr(['lightning.groundingRod']);
    const a = arena(p, { resist: { physical: 0, fire: 0, cold: 0, lightning: 0, void: 0 } });
    close(struck(a, 100, LIGHTNING), 80);
    close(struck(a, 100, LIGHTNING, 'dot'), 100);
  });

  rule('burnOnYouDuration', 'Scorch Ward: Burning on you lasts 40% shorter', () => {
    const a = arena(pr(['fire.scorchWard']));
    applyDebuff(a.world, a.player, 'burning', 50);
    const view = a.player.debuffs;
    close(view.remaining[view.remaining.findIndex((r) => r > 0)], BURN_DURATION * 0.6);
  });

  rule('chilledDealLess', 'Permafrost: enemies chilled by you deal 10% less damage', () => {
    const a = arena(pr(['cold.permafrost']));
    const i = target(a);
    close(empowerMult(a.world, i), 1);
    applyAilment(a.world, i, 100, COLD, 1, P1);
    close(chillWeakenOf(a.world, i), 0.9);
    close(empowerMult(a.world, i), 0.9);
  });

  rule('regenPercent', 'Steady Breath: regenerate 1.2% of maximum life per second', () => {
    const base = playerRuntime(bareCharacter({ level: 40 }), null).stats;
    const with_ = playerRuntime(holder(['vitality.steadyBreath']), null).stats;
    close(with_.lifeRegen, base.lifeRegen + with_.maxLife * 0.012);
  });

  rule('regenLowLife', 'Unending Vigil: 3% per second, 6% while below 50% life', () => {
    const p = pr(['vitality.unendingVigil']);
    const a = arena(p, { lifeRegen: 30 });
    a.player.life = 400;
    stepN(a.run, 1);
    close(a.player.life, 400 + (30 + 1000 * 0.03) * DT);
    a.player.life = 600;
    stepN(a.run, 1);
    close(a.player.life, 600 + 30 * DT);
  });

  rule('lifePerStr', 'Hardy: 1% increased maximum life per 20 Strength', () => {
    const ch = holder(['vitality.hardy']);
    const model = buildPlayerModel(ch);
    const hardy = model.mods.find((m) => m.source === 'Orrery: Hardy');
    expect(hardy?.stat).toBe('maxLife');
    expect(hardy?.value).toBe(Math.floor(model.attributes.str / 20));
  });

  rule('flaskChargePerKills', 'Quick Recovery: flasks gain a charge every 30 kills', () => {
    expect(killsPerCharge(bareCharacter())).toBe(40);
    expect(killsPerCharge(holder(['vitality.quickRecovery']))).toBe(30);
  });

  rule('flaskGuard', 'Bloodied Resolve: a Life flask gives 15% less damage taken for 2 seconds', () => {
    const a = arena(pr(['vitality.bloodiedResolve']));
    a.player.life = 500;
    a.player.intent.flask = 0;
    stepN(a.run, 1, { ...a.player.intent, flask: 0 });
    close(struck(a, 100, PHYSICAL), 85);
    stepN(a.run, 130);
    close(struck(a, 100, PHYSICAL), 100);
  });

  rule('focusFlaskLife', 'Rejuvenating Surge: Focus flasks also restore 10% of maximum life', () => {
    const a = arena(pr(['vitality.rejuvenatingSurge']));
    a.player.life = 300;
    stepN(a.run, 1, { ...a.player.intent, flask: 2 });
    close(a.player.life, 300 + 100);
  });

  rule('flaskDuration', 'Rejuvenating Surge: flasks last 20% longer', () => {
    const belt = [{ flaskId: 'lifeFlask' as const, count: 2 }, null, null, null];
    const base = flaskRuntimes(bareCharacter({ level: 40, belt }), 1)[0]!;
    const with_ = flaskRuntimes(holder(['vitality.rejuvenatingSurge'], {}, { belt }), 1)[0]!;
    close(with_.duration, base.duration * 1.2);
    expect(with_.amount).toBe(base.amount);
  });

  rule('noLifeFlasks', 'Unending Vigil: you cannot use Life flasks', () => {
    const a = arena(pr(['vitality.unendingVigil']));
    a.player.life = 500;
    const before = a.player.flasks[0]!.count;
    const out = stepN(a.run, 1, { ...a.player.intent, flask: 0 });
    expect(a.player.flasks[0]!.count).toBe(before);
    expect(out.outcomes.some((o) => o.t === 'flaskUsed')).toBe(false);
    stepN(a.run, 1, { ...a.player.intent, flask: 2 });
    expect(a.player.flasks[2]!.count).toBe(2);
  });

  rule('armourBigHits', 'Brace: armour is 30% more effective against hits above 20% of your life', () => {
    const a = arena(pr(['bulwark.brace']), { armor: 1000 });
    close(struck(a, 100, PHYSICAL), 100 * (1 - 1000 / (1000 + 1000)));
    close(struck(a, 300, PHYSICAL), 300 * (1 - 1300 / (1300 + 3000)));
  });

  rule('armourFormula', 'Heavy Plate: armour counts 8 instead of 10 per point of damage', () => {
    const a = arena(pr(['bulwark.heavyPlate']), { armor: 1000 });
    close(struck(a, 100, PHYSICAL), 100 * (1 - 1000 / (1000 + 800)));
  });

  rule('armourVsElements', 'Eternal Bastion: armour applies to elemental damage at 50% effectiveness', () => {
    const a = arena(pr(['bulwark.eternalBastion']), { armor: 1000 });
    close(struck(a, 100, FIRE), 100 * (1 - 0.5 * (1000 / (1000 + 1000))));
    close(struck(a, 100, VOID), 100);
  });

  rule('evadeChance', 'Slippery: +6 points to the chance to evade (the cap still applies)', () => {
    const base = rules.deriveStats(bareCharacter({ level: 40 })).combat.evasion;
    // Slippery's own +10% evasion rating moves the base chance too: compare against the same rating.
    const ch = holder(['bulwark.slippery']);
    const d = rules.deriveStats(ch);
    const rating = Number(d.sections.find((s) => s.title === 'Defence')!.lines.find((l) => l.label === 'Evasion Rating')!.value);
    expect(d.combat.evasion).toBeGreaterThan(base + 0.059);
    expect(d.combat.evasion).toBeLessThanOrEqual(0.75);
    expect(rating).toBeGreaterThan(0);
  });

  rule('evadeCap', 'Phantom Weave: the evade cap rises 10 points (85%)', () => {
    const p = pr(['bulwark.phantomWeave']);
    close(p.evadeCap, 0.85);
    const a = arena(p, { evasion: 0.84 });
    let evaded = 0;
    for (let k = 0; k < 400; k++) if (hitPlayer(a.world, a.player, 1, PHYSICAL, 'melee') < 0) evaded++;
    expect(evaded / 400).toBeGreaterThan(0.79);
  });

  rule('wardEffect', 'Barrier Study: wards 25% stronger, Cinder Ward cap 60% → 66%', () => {
    const base = buildPlayerModel(bareCharacter({ level: 40 }));
    const with_ = buildPlayerModel(holder(['bulwark.barrierStudy']));
    close(resolveSkill(with_, 'cinderWard', 3).runtime.damageReduction, Math.min(1, resolveSkill(base, 'cinderWard', 3).runtime.damageReduction * 1.25));
    const a = arena(pr(['bulwark.barrierStudy']));
    close(wardCapOf(a.player, WARD_REDUCTION_CAP), 0.66);
  });

  rule('damageFromFocus', 'Iron Mind: 30% of damage taken is drawn from Focus first', () => {
    const a = arena(pr(['hub.ironMind']));
    a.player.focus = 100;
    close(struck(a, 100, PHYSICAL), 70);
    close(a.player.focus, 70);
    a.player.focus = 10;
    close(struck(a, 100, PHYSICAL), 90);
    expect(a.player.focus).toBe(0);
  });

  it('every rule id has its test', () => {
    expect([...covered].sort()).toEqual(Object.keys(PASSIVE_RULES).sort());
  });
});

// ---------------------------------------------------------------------------------------------
describe('caps over random builds (R1: more cap, pen cap, damage-taken floor)', () => {
  it('2,000 random connected allocations never break the caps', async () => {
    const { PASSIVE_START_ID } = await import('../../src/data/progression/passives');
    const { normalizePassives } = await import('../../src/game/progression/passives');
    const { MORE_CAP, STAT_CAPS } = await import('../../src/data/progression');
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let b = 0; b < 2000; b++) {
      const taken = new Set<string>();
      const frontier = () => PASSIVE_NODES.filter((n) => n.id !== PASSIVE_START_ID && !taken.has(n.id) && n.links.some((l) => l === PASSIVE_START_ID || taken.has(l)));
      let points = 70;
      while (points > 0) {
        const f = frontier();
        if (!f.length) break;
        const n = f[Math.floor(rnd() * f.length)];
        if (n.cost > points) break;
        taken.add(n.id);
        points -= n.cost;
      }
      const passives = normalizePassives([...taken], 70);
      const masteries = Object.fromEntries(passives.filter((id) => id.endsWith('.mastery')).map((id) => [id, Math.floor(rnd() * 3)]));
      const ch = bareCharacter({ level: 60, passives, masteries });
      const stats = playerRuntime(ch, null).stats;
      const p = stats.passives;
      if (!p) continue;
      // Penetration: never past the player's cap, the cap never past 55.
      expect(p.penCap).toBeLessThanOrEqual(PEN_CAP + 15);
      for (const v of Object.values(stats.pen)) expect(v).toBeLessThanOrEqual(p.penCap);
      // The conditional more lines fit the room left under the tree's ×2.0 and MORE_CAP.
      const model = buildPlayerModel(ch);
      const t = passiveTotalsOf(ch)!;
      let tree = 1;
      for (const m of model.mods) if (m.source.startsWith('Orrery') && m.mode === 'more' && m.value > 0 && /Damage$|damageOverTime/.test(m.stat)) tree *= 1 + m.value / 100;
      const cond = Math.min(p.moreRoom, (1 + Math.max(...p.moreNearBurning)) * (1 + p.moreVsChilled));
      expect(tree * cond).toBeLessThanOrEqual(2.0 + 1e-6);
      expect(p.igniteMore * tree).toBeLessThanOrEqual(2.0 + 1e-6);
      for (const id of ['emberLance', 'rimeShards', 'arcChain'] as const) {
        expect(resolveSkill(model, id, 5).moreMultiplier * p.moreRoom).toBeLessThanOrEqual(MORE_CAP + 1e-6);
      }
      // Damage taken: the passive factors never go below the floor; with the tree's lines never below ×0.75, with all ≥ ×0.60.
      for (let k = 0; k < 5; k++) {
        const f = Math.max(p.takenFloor, p.takenHit[k] * (1 - p.flaskGuard));
        expect(f * stats.damageTaken).toBeGreaterThanOrEqual(STAT_CAPS.damageTakenFloor - 1e-9);
      }
      expect(t.rules.length).toBeGreaterThanOrEqual(0);
    }
  });
});
