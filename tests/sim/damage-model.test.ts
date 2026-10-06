// The damage model of docs/power-rework/power-curve.md sections 3, 4 and 11 as unit tests of damageMonster:
// layer order (cap -> penetration -> exposure -> taken), the proof-rare matrix (4.3), penetration cap and floor,
// exposure (floor, no stacking, half on bosses, expiry), the DoT resistance factor, conversion and the player's
// overcap buffer. Two arenas with the same seed roll the same hit, so a ratio of damage dealt is exactly `1 - r`.
import { describe, expect, it } from 'vitest';
import { DOT_RESIST_FACTOR, EXPOSURE, PEN_CAP } from '../../src/data/progression/combat';
import { damageMonster, exposeMonster, monsterResist } from '../../src/sim/combat';
import { applyDebuff, effectiveResist } from '../../src/sim/debuffs';
import { DAMAGE_INDEX } from '../../src/sim/math';
import { MFLAG } from '../../src/sim/stores';
import { PROJ, projSpec, spawnProjectile } from '../../src/sim/projectiles';
import { digestWorld } from '../../src/sim/digest';
import { idleIntent, makeStats } from './fixtures';
import { makeArena, placeMonster, stepN } from './helpers';

const { physical: PHYS, fire: FIRE, cold: COLD, lightning: LIGHT, void: VOID } = DAMAGE_INDEX;
const ZERO = { physical: 0, fire: 0, cold: 0, lightning: 0, void: 0 };

interface Setup {
  res?: Partial<Record<'physical' | 'fire' | 'cold' | 'lightning' | 'void', number>>;
  pen?: Partial<typeof ZERO>;
  expose?: { type: number; points: number }[];
  flags?: number;
}

/** One 1000-damage hit on a fresh monster of a fresh arena (same seed: the same roll). */
function strike(setup: Setup, dtype = FIRE, o: { ailment?: number; convTo?: number; convShare?: number } = {}) {
  const { world } = makeArena({ seed: 7, stats: makeStats({ pen: { ...ZERO, ...setup.pen } }) });
  const i = placeMonster(world, 'ashling', 60, 0, { life: 1e5 });
  const m = world.monsters;
  m.hitReduction[i] = 0;
  const r = { ...ZERO, ...setup.res };
  [r.physical, r.fire, r.cold, r.lightning, r.void].forEach((v, k) => { m.res[i * 5 + k] = v; });
  if (setup.flags) m.flags[i] |= setup.flags;
  for (const e of setup.expose ?? []) exposeMonster(world, i, e.type, e.points);
  const before = m.life[i];
  damageMonster(world, i, 1000, dtype, 0, 1.5, o.ailment ?? 0, 1, 0, 0, true, 1, o.convTo ?? -1, o.convShare ?? 0);
  return { dealt: before - m.life[i], igniteDps: m.igniteDps[i], world, i };
}

/** The unresisted hit (re-measured each time: the arena's first roll differs from later ones by construction of the seed). */
const clean = () => strike({}).dealt;
/** Damage taken as a fraction of a clean hit. */
const taken = (setup: Setup, dtype = FIRE, o = {}) => { const d = strike(setup, dtype, o).dealt; return d / clean(); };

describe('proof-rare matrix (power-curve.md 4.3): a fire-proof rare, r1 = 0.90', () => {
  const proof = { fire: 0.9 };
  const rows: [string, Setup, number, number][] = [
    ['no answer', { res: proof }, 0.1, 1],
    ['penetration 15', { res: proof, pen: { fire: 15 } }, 0.25, 2.5],
    ['penetration 30', { res: proof, pen: { fire: 30 } }, 0.4, 4],
    ['penetration 40 (cap)', { res: proof, pen: { fire: 40 } }, 0.5, 5],
    ['pen 30 + Hex exposure 15', { res: proof, pen: { fire: 30 }, expose: [{ type: FIRE, points: 15 }] }, 0.55, 5.5],
    ['pen 40 + exposure 25', { res: proof, pen: { fire: 40 }, expose: [{ type: FIRE, points: 25 }] }, 0.75, 7.5],
  ];
  for (const [name, setup, share, times] of rows) {
    it(`${name}: takes ${share} of a clean hit (${times}x)`, () => {
      const t = taken(setup);
      expect(t).toBeCloseTo(share, 3);
      expect(t / 0.1).toBeCloseTo(times, 3);
    });
  }

  it('50% conversion to cold (fire 0.90, cold 0): 0.55, 5.5x', () => {
    const t = taken({ res: proof }, FIRE, { convTo: COLD, convShare: 0.5 });
    expect(t).toBeCloseTo(0.55, 3);
  });

  it('an alternate element or type is not proof: 1.0 (10x)', () => {
    expect(taken({ res: proof }, COLD)).toBeCloseTo(1, 3);
    expect(taken({ res: proof }, LIGHT)).toBeCloseTo(1, 3);
    expect(taken({ res: proof }, VOID)).toBeCloseTo(1, 3);
    expect(taken({ res: proof }, PHYS)).toBeCloseTo(1, 3);
  });

  it('ignite takes DOT_RESIST_FACTOR of the resistance: 0.55 of the burn, not 0.10', () => {
    expect(DOT_RESIST_FACTOR).toBe(0.5);
    const base = strike({}, FIRE, { ailment: 1 }).igniteDps;
    expect(base).toBeGreaterThan(0);
    expect(strike({ res: proof }, FIRE, { ailment: 1 }).igniteDps / base).toBeCloseTo(0.55, 3);
    // penetration reaches the burn too: pen 30 -> r3 = 0.6 -> 1 - 0.3
    expect(strike({ res: proof, pen: { fire: 30 } }, FIRE, { ailment: 1 }).igniteDps / base).toBeCloseTo(0.7, 3);
  });
});

describe('layer order: monster cap -> penetration -> exposure -> damage taken', () => {
  it('applies penetration AFTER the 90% monster cap (a resistance above it is capped first)', () => {
    const { world } = makeArena();
    const i = placeMonster(world, 'ashling', 60, 0);
    world.monsters.res[i * 5 + FIRE] = 1.3;
    expect(monsterResist(world, i, FIRE, 0)).toBeCloseTo(0.9, 6);
    expect(monsterResist(world, i, FIRE, 30)).toBeCloseTo(0.6, 6); // not 1.3 - 0.3 = 1.0 -> capped
  });

  it('exposure comes after penetration and before taken multipliers (shock still multiplies the result)', () => {
    const base = strike({ res: { fire: 0.9 }, pen: { fire: 30 }, expose: [{ type: FIRE, points: 15 }] });
    const { world, i } = base;
    expect(monsterResist(world, i, FIRE, 30)).toBeCloseTo(0.45, 6);
    const shocked = makeArena({ seed: 7, stats: makeStats({ pen: { ...ZERO, fire: 30 } }) });
    const j = placeMonster(shocked.world, 'ashling', 60, 0, { life: 1e5 });
    shocked.world.monsters.res[j * 5 + FIRE] = 0.9;
    shocked.world.monsters.shockTime[j] = 5;
    exposeMonster(shocked.world, j, FIRE, 15);
    damageMonster(shocked.world, j, 1000, FIRE, 0, 1.5, 0, 1, 0, 0, true, 1);
    expect((1e5 - shocked.world.monsters.life[j]) / clean()).toBeCloseTo(0.55 * 1.2, 3);
  });

  it('reads the source player\'s penetration, and no penetration without a source', () => {
    const { world } = makeArena({ stats: makeStats({ pen: { ...ZERO, fire: 20 } }) });
    const i = placeMonster(world, 'ashling', 60, 0, { life: 1e5 });
    world.monsters.res[i * 5 + FIRE] = 0.5;
    world.monsters.hitReduction[i] = 0;
    const hit = (source: number) => {
      const before = world.monsters.life[i];
      world.combatRng.range(0, 1);
      damageMonster(world, i, 1000, FIRE, 0, 1.5, 0, 1, 0, 0, false, source);
      return before - world.monsters.life[i];
    };
    // 0.5 -> 0.3 with the source's pen: well above 0.5 / 0.7 of the rolled damage, so compare to the unpenetrated hit's band
    expect(hit(1)).toBeGreaterThan(1000 * 0.8 * 0.7 - 1e-6);
    expect(hit(0)).toBeLessThan(1000 * 1.2 * 0.5 + 1e-6);
  });
});

describe('penetration caps and floor', () => {
  it('never creates vulnerability: a negative resistance stays, a small one stops at 0', () => {
    const { world } = makeArena();
    const i = placeMonster(world, 'ashling', 60, 0);
    world.monsters.res[i * 5 + COLD] = -0.15;
    expect(monsterResist(world, i, COLD, 40)).toBeCloseTo(-0.15, 6);
    world.monsters.res[i * 5 + COLD] = 0.1;
    expect(monsterResist(world, i, COLD, 40)).toBeCloseTo(0, 6);
  });

  it('is capped at PEN_CAP points however much is supplied', () => {
    expect(PEN_CAP).toBe(40);
    const { world } = makeArena();
    const i = placeMonster(world, 'ashling', 60, 0);
    world.monsters.res[i * 5 + FIRE] = 0.9;
    expect(monsterResist(world, i, FIRE, 75)).toBeCloseTo(0.5, 6);
  });

  it('is per damage type: fire penetration does not touch cold', () => {
    expect(taken({ res: { fire: 0.9, cold: 0.9 }, pen: { fire: 40 } }, COLD)).toBeCloseTo(0.1, 3);
  });
});

describe('exposure', () => {
  it('can push resistance below zero but never below the -25 floor', () => {
    expect(EXPOSURE).toEqual({ max: 25, floor: -25, duration: 4, bossFactor: 0.5 });
    const { world } = makeArena();
    const i = placeMonster(world, 'ashling', 60, 0);
    exposeMonster(world, i, FIRE, 25);
    world.monsters.res[i * 5 + FIRE] = 0.1;
    expect(monsterResist(world, i, FIRE)).toBeCloseTo(-0.15, 6);
    world.monsters.res[i * 5 + FIRE] = 0;
    expect(monsterResist(world, i, FIRE)).toBeCloseTo(-0.25, 6);
    world.monsters.res[i * 5 + FIRE] = -0.2;
    expect(monsterResist(world, i, FIRE)).toBeCloseTo(-0.25, 6);
    world.monsters.res[i * 5 + FIRE] = -0.4; // already below the floor: exposure does not lift it
    expect(monsterResist(world, i, FIRE)).toBeCloseTo(-0.4, 6);
    expect(taken({ res: { fire: 0 }, expose: [{ type: FIRE, points: 25 }] })).toBeCloseTo(1.25, 3);
  });

  it('does not stack: the strongest applies, a weaker one refreshes the timer, and the maximum is 25', () => {
    const { world } = makeArena();
    const i = placeMonster(world, 'ashling', 60, 0);
    const m = world.monsters;
    m.res[i * 5 + FIRE] = 0.9;
    exposeMonster(world, i, FIRE, 15);
    exposeMonster(world, i, FIRE, 10);
    expect(monsterResist(world, i, FIRE)).toBeCloseTo(0.75, 6);
    exposeMonster(world, i, FIRE, 20);
    expect(monsterResist(world, i, FIRE)).toBeCloseTo(0.7, 6);
    exposeMonster(world, i, FIRE, 90);
    expect(monsterResist(world, i, FIRE)).toBeCloseTo(0.65, 6);
    // types are independent
    m.res[i * 5 + COLD] = 0.5;
    exposeMonster(world, i, COLD, 12);
    expect(monsterResist(world, i, COLD)).toBeCloseTo(0.38, 6);
    expect(monsterResist(world, i, FIRE)).toBeCloseTo(0.65, 6);
  });

  it('takes half effect on bosses and lieutenants, with penetration unreduced', () => {
    for (const flag of [MFLAG.boss, MFLAG.lieutenant]) {
      const { world } = makeArena();
      const i = placeMonster(world, 'ashling', 60, 0);
      world.monsters.flags[i] |= flag;
      world.monsters.res[i * 5 + FIRE] = 0.4;
      exposeMonster(world, i, FIRE, 20);
      expect(monsterResist(world, i, FIRE, 0)).toBeCloseTo(0.3, 6);
      expect(monsterResist(world, i, FIRE, 10)).toBeCloseTo(0.2, 6);
    }
    const { world } = makeArena();
    const i = placeMonster(world, 'ashling', 60, 0);
    world.monsters.res[i * 5 + FIRE] = 0.4;
    exposeMonster(world, i, FIRE, 20);
    expect(monsterResist(world, i, FIRE)).toBeCloseTo(0.2, 6);
  });

  it('expires after its duration and clears every row, deterministically', () => {
    const { run, world } = makeArena();
    const i = placeMonster(world, 'ashling', 60, 0);
    world.monsters.res[i * 5 + FIRE] = 0.5;
    exposeMonster(world, i, FIRE, 20);
    exposeMonster(world, i, COLD, 10);
    stepN(run, 200, idleIntent()); // 3.33 s: still exposed
    expect(world.monsters.exposeTime[i]).toBeGreaterThan(0);
    expect(monsterResist(world, i, FIRE)).toBeCloseTo(0.3, 3);
    stepN(run, 60, idleIntent()); // past 4 s
    expect(world.monsters.exposeTime[i]).toBe(0);
    expect(Array.from(world.monsters.expose.subarray(i * 5, i * 5 + 5))).toEqual([0, 0, 0, 0, 0]);
    expect(monsterResist(world, i, FIRE)).toBeCloseTo(0.5, 6);
  });

  it('enters the digest only while exposed, and differs by the exposed value', () => {
    const a = makeArena({ seed: 3 });
    const b = makeArena({ seed: 3 });
    const ia = placeMonster(a.world, 'ashling', 60, 0);
    const ib = placeMonster(b.world, 'ashling', 60, 0);
    expect(digestWorld(a.world)).toBe(digestWorld(b.world));
    exposeMonster(a.world, ia, FIRE, 15);
    expect(digestWorld(a.world)).not.toBe(digestWorld(b.world));
    exposeMonster(b.world, ib, FIRE, 15);
    expect(digestWorld(a.world)).toBe(digestWorld(b.world));
    exposeMonster(b.world, ib, FIRE, 20);
    expect(digestWorld(a.world)).not.toBe(digestWorld(b.world));
  });
});

describe('conversion', () => {
  it('splits a hit across two resistance rows, each share penetrated and ailmented on its final type', () => {
    // 60% fire / 40% cold against fire 0.9, cold 0.5, pen fire 40 cold 10: 0.6 x 0.5 + 0.4 x 0.6
    const t = taken({ res: { fire: 0.9, cold: 0.5 }, pen: { fire: 40, cold: 10 } }, FIRE, { convTo: COLD, convShare: 0.4 });
    expect(t).toBeCloseTo(0.6 * 0.5 + 0.4 * 0.6, 3);
  });

  it('plumbs through ProjectileSpec: a converted bolt hits both rows, and the shared spec does not leak it', () => {
    const run = (conv: boolean) => {
      const { run: r, world } = makeArena({ seed: 11 });
      const i = placeMonster(world, 'ashling', 80, 0, { life: 1e5 });
      world.monsters.hitReduction[i] = 0;
      world.monsters.res[i * 5 + FIRE] = conv ? 0.9 : 0;
      const s = projSpec;
      Object.assign(s, { kind: PROJ.emberLance, hostile: false, x: 0, y: 0, angle: 0, speed: 300, range: 400, radius: 4, damage: 1000, dtype: FIRE, critChance: 0, critMult: 1.5, ailmentChance: 0, pierce: 0, owner: 1 });
      if (conv) { s.convTo = COLD; s.convShare = 0.5; }
      const slot = spawnProjectile(world, s);
      if (conv) {
        expect(world.projectiles.convShare[slot]).toBeCloseTo(0.5, 6);
        expect(world.projectiles.convTo[slot]).toBe(COLD);
      }
      expect(projSpec.convShare).toBe(0);
      stepN(r, 60, idleIntent());
      return 1e5 - world.monsters.life[i];
    };
    run(false); // warm-up
    expect(run(true) / run(false)).toBeCloseTo(0.55, 3);
  });
});

describe('player resistance: the overcap buffer', () => {
  it('Withered applies to the uncapped value: 100% uncapped minus 36% stays above the 75% cap', () => {
    const a = makeArena({ stats: makeStats({ resist: { physical: 0, fire: 1.0, cold: 0.75, lightning: 0.9, void: 0 } }) });
    expect(effectiveResist(a.player, 'fire')).toBeCloseTo(0.75, 6);
    for (let k = 0; k < 3; k++) applyDebuff(a.world, a.player, 'withered');
    expect(effectiveResist(a.player, 'fire')).toBeCloseTo(0.64, 6); // not 0.75 - 0.36 = 0.39
    expect(effectiveResist(a.player, 'cold')).toBeCloseTo(0.39, 6);
    expect(effectiveResist(a.player, 'lightning')).toBeCloseTo(0.54, 6);
  });

  it('the cap is stats.maxResist (up to 85), and physical is unaffected by Withered', () => {
    const a = makeArena({ stats: makeStats({ maxResist: 85, resist: { physical: 0.8, fire: 0.9, cold: 0, lightning: 0, void: 0 } }) });
    expect(effectiveResist(a.player, 'fire')).toBeCloseTo(0.85, 6);
    for (let k = 0; k < 3; k++) applyDebuff(a.world, a.player, 'withered');
    expect(effectiveResist(a.player, 'physical')).toBeCloseTo(0.8, 6);
    expect(effectiveResist(a.player, 'fire')).toBeCloseTo(0.54, 6);
  });
});
