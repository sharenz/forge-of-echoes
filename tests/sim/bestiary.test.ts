// The core's generic support for the bestiary kinds (GAME_SPEC §14): area geometry and behaviour,
// projectile riders and follow-ups, frontal shields, ghosts, corpses and the effect registry.
import { describe, expect, it } from 'vitest';
import { AREA_KINDS, SIM_DT, type AreaView } from '../../src/contracts/sim';
import {
  AREA_SEQ_LIMIT, CHARGE_LINE_HALF_WIDTH, ICE_PRISON_END_FRACTION, TAR_SLOW, WISP_FREEZE_FRACTION, areaAngle, areaContains, areaVariant,
  chargeLineEnd, choirGapAngles, encodeAreaId, inChoirGap, quantizeAreaAngle,
} from '../../src/sim/area-geometry';
import { spawnArea } from '../../src/sim/areas';
import { fireHostile } from '../../src/sim/behaviour';
import { damageMonster, killMonster, takeCorpses } from '../../src/sim/combat';
import { PLAYER_RADIUS, ROOT_DURATION, TAR_POOL_RADIUS } from '../../src/sim/constants';
import { registerAreaEffect, registerProjectileEffect } from '../../src/sim/effects';
import { DAMAGE_INDEX } from '../../src/sim/math';
import { PROJ, setProjectileEffect } from '../../src/sim/projectiles';
import { MFLAG } from '../../src/sim/stores';
import { idleIntent, makeSkill, makeStats } from './fixtures';
import { hold, makeArena, ofType, placeMonster, pv, stepN, stepWith } from './helpers';

const tough = () => makeStats({ maxLife: 1e6, evasion: 0 });
const has = (run: ReturnType<typeof makeArena>['run'], id: string) => pv(run).debuffs.some((d) => d.id === id);

describe('area ids carry a heading and a variant', () => {
  it('round-trips and stays unique', () => {
    for (const [angle, variant] of [[0, 0], [1.2, 1], [-2.5, 3], [Math.PI * 1.99, 2]] as const) {
      const id = encodeAreaId(12345, angle, variant);
      const view = { id } as AreaView;
      expect(areaAngle(view)).toBeCloseTo(quantizeAreaAngle(angle), 12);
      expect(Math.abs(Math.atan2(Math.sin(areaAngle(view) - angle), Math.cos(areaAngle(view) - angle)))).toBeLessThan(0.013);
      expect(areaVariant(view)).toBe(variant);
    }
    expect(encodeAreaId(AREA_SEQ_LIMIT - 1, 6.2, 3)).toBeLessThan(2 ** 32);
    const a = makeArena();
    const ids = new Set<number>();
    for (let k = 0; k < 300; k++) ids.add(spawnArea(a.world, 'chargeLine', 0, 0, 10, 1, { angle: k * 0.1, variant: k % 4 }).id);
    expect(ids.size).toBe(300);
  });
});

describe('chargeLine', () => {
  it('is a lane of its variant width from (x, y) along its angle; only players in it are hit', () => {
    const a = makeArena({ stats: tough() });
    const lane = spawnArea(a.world, 'chargeLine', -100, 0, 200, 0.5, {
      angle: 0, variant: 1, hurts: 'player', damage: 30, dtype: DAMAGE_INDEX.physical, debuff: 'bleeding',
    });
    expect(chargeLineEnd(lane)).toEqual({ x: 100, y: 0 });
    expect(areaContains(lane, 50, CHARGE_LINE_HALF_WIDTH[1] + 1, 0)).toBe(false);
    expect(areaContains(lane, 50, CHARGE_LINE_HALF_WIDTH[1] - 1, 0)).toBe(true);
    expect(areaContains(lane, 120, 0, 0)).toBe(false);
    const life = a.player.life;
    const r = stepN(a.run, 40);
    expect(ofType(r.events, 'areaResolve')).toHaveLength(0); // a lane resolves silently
    expect(a.world.areas).toHaveLength(0);
    expect(a.player.life).toBeLessThan(life);
    expect(has(a.run, 'bleeding')).toBe(true);

    const b = makeArena({ stats: tough() });
    spawnArea(b.world, 'chargeLine', -100, 40, 200, 0.5, { angle: 0, variant: 1, hurts: 'player', damage: 30, dtype: DAMAGE_INDEX.physical });
    stepN(b.run, 40);
    expect(b.player.life).toBe(1e6);
  });
});

describe('icePrison', () => {
  it('closes on its player and freezes them if they stay', () => {
    const a = makeArena({ stats: tough() });
    const prison = spawnArea(a.world, 'icePrison', 0, 0, 46, 1.8, { target: 1, hurts: 'player', damage: 10, dtype: DAMAGE_INDEX.cold });
    stepN(a.run, Math.round(0.9 / SIM_DT));
    expect(prison.radius).toBeCloseTo(46 * (1 - (1 - ICE_PRISON_END_FRACTION) * 0.5), 0);
    const r = stepN(a.run, Math.round(1 / SIM_DT));
    expect(ofType(r.events, 'areaResolve').map((e) => e.kind)).toEqual(['icePrison']);
    expect(has(a.run, 'frozen')).toBe(true);
  });

  it('breaks when its player walks out before it closes', () => {
    const a = makeArena({ stats: tough() });
    spawnArea(a.world, 'icePrison', 0, 0, 46, 1.8, { target: 1, hurts: 'player', damage: 10, dtype: DAMAGE_INDEX.cold });
    const r = stepN(a.run, Math.round(2 / SIM_DT), () => ({ ...idleIntent(), moveX: 1 }));
    expect(ofType(r.events, 'areaResolve')).toHaveLength(1);
    expect(a.world.areas.some((x) => x.kind === 'icePrison')).toBe(false);
    expect(has(a.run, 'frozen')).toBe(false);
    expect(a.player.life).toBe(1e6);
  });
});

describe('choirWave', () => {
  it('expands, hits each player once where its band passes them, and spares a player in a gap', () => {
    const hitBy = (gapAtPlayer: boolean) => {
      const a = makeArena({ stats: tough() });
      // The player stands 100 east of the ring's centre; the gaps are at 0 rad (east) or π/2.
      const ring = spawnArea(a.world, 'choirWave', -100, 0, 10, 2, {
        endRadius: 250, angle: gapAtPlayer ? 0 : Math.PI / 2, variant: 1, hurts: 'player', damage: 20, dtype: DAMAGE_INDEX.cold,
      });
      expect(choirGapAngles(ring)).toHaveLength(2);
      expect(inChoirGap(ring, 0)).toBe(gapAtPlayer);
      const r = stepN(a.run, Math.round(2.2 / SIM_DT));
      return { hits: ofType(r.events, 'hit').filter((e) => e.target === 'player').length, chilled: ofType(r.events, 'debuff').length };
    };
    expect(hitBy(false)).toEqual({ hits: 1, chilled: 1 });
    expect(hitBy(true)).toEqual({ hits: 0, chilled: 0 });
  });
});

describe('wispBurst', () => {
  it('chills everyone inside and freezes at point blank', () => {
    for (const [dist, want] of [[10, 'frozen'], [30, 'chilled'], [60, null]] as const) {
      const a = makeArena({ stats: tough() });
      expect(10).toBeLessThan(40 * WISP_FREEZE_FRACTION);
      spawnArea(a.world, 'wispBurst', dist, 0, 40, 0.7, { hurts: 'player', damage: 5, dtype: DAMAGE_INDEX.cold });
      stepN(a.run, 50);
      const ids = pv(a.run).debuffs.map((d) => d.id);
      if (want) expect(ids).toContain(want);
      else expect(ids).toHaveLength(0);
      if (want === 'frozen') expect(ids).not.toContain('chilled');
    }
  });
});

describe('blizzard', () => {
  it('drifts, bounces off the arena edge and chills whoever it passes over', () => {
    const a = makeArena({ stats: tough() });
    const storm = spawnArea(a.world, 'blizzard', -150, 0, 50, 30, {
      vx: 60, vy: 0, tickInterval: 0.5, firstTick: 0.5, hurts: 'player', damage: 1, dtype: DAMAGE_INDEX.cold,
    });
    const r = stepN(a.run, Math.round(4 / SIM_DT));
    expect(storm.x).toBeGreaterThan(80);
    expect(ofType(r.events, 'debuff').some((e) => e.debuff === 'chilled')).toBe(true);
    stepN(a.run, Math.round(12 / SIM_DT));
    expect(Math.hypot(storm.x, storm.y)).toBeLessThanOrEqual(600 - 50 + 1e-6);
    expect(storm.vx).toBeLessThan(0); // bounced back
  });
});

describe('area riders', () => {
  it('land whenever an area does not hurt monsters: an ice prison or wisp burst at hurts "none" still freezes / chills', () => {
    const a = makeArena({ stats: tough() });
    spawnArea(a.world, 'icePrison', 0, 0, 46, 0.5, { target: 1 });
    stepN(a.run, 40);
    expect(has(a.run, 'frozen')).toBe(true);
    expect(a.player.life).toBe(1e6); // riders, no damage

    const b = makeArena({ stats: tough() });
    spawnArea(b.world, 'wispBurst', 30, 0, 40, 0.5);
    stepN(b.run, 40);
    expect(has(b.run, 'chilled')).toBe(true);
    expect(has(b.run, 'frozen')).toBe(false);
  });

  it('`debuff: null` makes an area cosmetic, and an area that hurts monsters never touches players', () => {
    const a = makeArena({ stats: tough() });
    spawnArea(a.world, 'icePrison', 0, 0, 46, 0.5, { target: 1, debuff: null });
    spawnArea(a.world, 'wispBurst', 0, 0, 40, 0.5, { debuff: null });
    spawnArea(a.world, 'frostNovaWarning', 0, 0, 40, 0.5, { hurts: 'monsters', damage: 5 });
    spawnArea(a.world, 'tarPool', 0, 0, 30, 0.5, { hurts: 'monsters' });
    spawnArea(a.world, 'choirWave', 0, 0, 1, 0.5, { endRadius: 40, hurts: 'monsters' });
    stepN(a.run, 40);
    expect(pv(a.run).debuffs).toEqual([]);
    expect(a.player.life).toBe(1e6);
  });
});

describe('tarPool', () => {
  it('roots on first contact only and slows by half while the feet are in it', () => {
    const a = makeArena({ stats: tough() });
    spawnArea(a.world, 'tarPool', 60, 0, 30, 20);
    const east = () => ({ ...idleIntent(), moveX: 1 });
    const r = stepN(a.run, 40, east);
    const roots = ofType(r.events, 'debuff').filter((e) => e.debuff === 'rooted');
    expect(roots).toHaveLength(1);
    const root = pv(a.run).debuffs.find((d) => d.id === 'rooted')!;
    expect(root.source).toBe('tar');
    expect(root.duration).toBe(ROOT_DURATION); // GAME_SPEC §13: tar roots like every root
    stepN(a.run, Math.round(1.5 / SIM_DT)); // the root wears off, still in the tar
    const x = a.player.x;
    stepWith(a.run, east());
    expect(a.player.x - x).toBeCloseTo(110 * (1 - TAR_SLOW) * SIM_DT, 6);
    const again = stepN(a.run, 30, east);
    expect(ofType(again.events, 'debuff').filter((e) => e.debuff === 'rooted')).toHaveLength(0);
  });

  it('a tar glob lob leaves a tar pool where it lands', () => {
    const a = makeArena({ stats: tough() });
    const i = placeMonster(a.world, 'tarSlinger', 200, 0);
    fireHostile(a.world, i, PROJ.tarGlob, Math.PI, 100, 150, 6, 5, DAMAGE_INDEX.physical, 1.0);
    stepN(a.run, 70);
    const pool = a.world.areas.find((x) => x.kind === 'tarPool');
    expect(pool).toBeDefined();
    expect(pool!.radius).toBe(TAR_POOL_RADIUS);
    expect(pool!.x).toBeCloseTo(200 - (8 + 2) - 100, 0); // from the muzzle (radius + 2), 100 u/s for 1 s
  });
});

describe('executionMark and whirlwind', () => {
  it('a mark follows its player until it locks, then strikes where it locked', () => {
    const a = makeArena({ stats: tough() });
    const mark = spawnArea(a.world, 'executionMark', 0, 0, 30, 1.5, {
      followPlayer: 1, lockAt: 0.8, hurts: 'player', damage: 50, dtype: DAMAGE_INDEX.physical,
    });
    stepN(a.run, Math.round(0.6 / SIM_DT), () => ({ ...idleIntent(), moveY: 1 }));
    expect(mark.y).toBeCloseTo(a.player.y, 0);
    stepN(a.run, Math.round(0.3 / SIM_DT), () => ({ ...idleIntent(), moveY: 1 }));
    const locked = mark.y;
    // Keep walking: out of the locked mark before it strikes.
    stepN(a.run, Math.round(0.7 / SIM_DT), () => ({ ...idleIntent(), moveY: 1 }));
    expect(mark.dead).toBe(true);
    expect(mark.y).toBe(locked);
    expect(a.player.life).toBe(1e6);
  });

  it('a whirlwind follows its monster, ticks, and ends with it', () => {
    const a = makeArena({ stats: tough() });
    const i = placeMonster(a.world, 'varkus', 20, 0, { life: 1e6 });
    const m = a.world.monsters;
    const wind = spawnArea(a.world, 'whirlwind', 20, 0, 50, 5, {
      follow: m.id[i], tickInterval: 0.3, hurts: 'player', damage: 2, dtype: DAMAGE_INDEX.physical, debuff: 'bleeding',
    });
    m.x[i] = 40;
    stepN(a.run, 40);
    expect(wind.x).toBe(m.x[i]);
    expect(has(a.run, 'bleeding')).toBe(true);
    killMonster(a.world, i, 0, false);
    stepWith(a.run, idleIntent());
    expect(a.world.areas.includes(wind)).toBe(false);
  });
});

describe('projectile riders', () => {
  it('web shots root (web), frost shards chill, crossbow bolts bleed', () => {
    for (const [proj, debuff] of [['webShot', 'rooted'], ['frostShard', 'chilled'], ['crossbowBolt', 'bleeding']] as const) {
      const a = makeArena({ stats: tough() });
      const i = placeMonster(a.world, 'frostWeaver', 100, 0);
      fireHostile(a.world, i, PROJ[proj], Math.PI, 300, 200, 5, 10, DAMAGE_INDEX.physical);
      stepN(a.run, 30);
      expect(pv(a.run).debuffs.map((d) => d.id), proj).toContain(debuff);
      if (proj === 'webShot') expect(pv(a.run).debuffs[0].source).toBe('web');
    }
  });

  it('a registered projectile effect sees the hit; an area effect sees the resolve', () => {
    const a = makeArena({ stats: tough() });
    let hits = 0;
    let resolved = 0;
    const onHit = registerProjectileEffect({ onHit: () => hits++ });
    const onResolve = registerAreaEffect({ onResolve: () => resolved++ });
    const i = placeMonster(a.world, 'frostWeaver', 100, 0);
    setProjectileEffect(a.world, fireHostile(a.world, i, PROJ.boneShard, Math.PI, 300, 200, 5, 1, 0), onHit);
    spawnArea(a.world, 'arenaSpikes', 300, 300, 10, 0.2, { effect: onResolve });
    stepN(a.run, 30);
    expect(hits).toBe(1);
    expect(resolved).toBe(1);
  });
});

describe('frontal shields', () => {
  const lance = () => makeSkill('emberLance', 12, { level: 20 });

  it('block player projectiles from the front and take them from behind', () => {
    const shoot = (fromBehind: boolean) => {
      const a = makeArena({ stats: tough(), skills: [lance()] });
      const i = placeMonster(a.world, 'shieldbearer', 80, 0, { life: 1e6 });
      const m = a.world.monsters;
      m.aim[i] = fromBehind ? 0 : Math.PI; // shield toward the player (west) or away
      const r = stepN(a.run, 60, hold(0, 200, 0));
      return { blocked: ofType(r.events, 'blocked').length, life: m.life[i], guard: (m.flags[i] & MFLAG.guard) !== 0 };
    };
    const front = shoot(false);
    expect(front.guard).toBe(true);
    expect(front.blocked).toBeGreaterThan(0);
    expect(front.life).toBe(1e6);
    const back = shoot(true);
    expect(back.blocked).toBe(0);
    expect(back.life).toBeLessThan(1e6);
  });

  it('consume even piercing projectiles, and let everything through while the guard is down', () => {
    const a = makeArena({ stats: tough(), skills: [{ ...lance(), pierce: 5 }] });
    const i = placeMonster(a.world, 'shieldbearer', 80, 0, { life: 1e6 });
    const behind = placeMonster(a.world, 'ashling', 130, 0, { life: 1e6 });
    const m = a.world.monsters;
    m.aim[i] = Math.PI;
    stepN(a.run, 60, hold(0, 200, 0));
    expect(m.life[behind]).toBe(1e6);
    m.flags[i] &= ~MFLAG.guard;
    stepN(a.run, 60, hold(0, 200, 0));
    expect(m.life[i]).toBeLessThan(1e6);
    expect(m.life[behind]).toBeLessThan(1e6);
  });

  it('the shield turns toward its target at a limited rate', () => {
    const a = makeArena({ stats: tough() });
    const i = placeMonster(a.world, 'shieldbearer', 100, 0, { life: 1e6 });
    const m = a.world.monsters;
    m.aim[i] = 0; // facing away (east); the player is west
    stepWith(a.run, idleIntent());
    const turned = Math.abs(m.aim[i]);
    expect(turned).toBeGreaterThan(0);
    expect(turned).toBeLessThan(0.1);
    stepN(a.run, Math.round(3 / SIM_DT));
    expect(Math.abs(Math.abs(m.aim[i]) - Math.PI)).toBeLessThan(0.05);
  });
});

describe('ghosts', () => {
  it('drift through other monsters and never slow the player', () => {
    const a = makeArena({ stats: tough() });
    const ghost = placeMonster(a.world, 'rimeshade', 30, 0, { life: 1e6 });
    const body = placeMonster(a.world, 'boneThrall', 30, 0, { life: 1e6 });
    const m = a.world.monsters;
    stepN(a.run, 10);
    // Stacked on the same spot: a ghost doesn't push or get pushed.
    expect(m.x[ghost]).toBe(30);
    expect(m.flags[ghost] & MFLAG.ghost).toBeTruthy();
    m.x[body] = 1000; // out of the way
    m.x[ghost] = 12;
    const x = a.player.x;
    stepN(a.run, 30, () => ({ ...idleIntent(), moveX: 1 }));
    expect(a.player.x - x).toBeGreaterThan(110 * 30 * SIM_DT * 0.99 - 12);
  });
});

describe('corpses', () => {
  it('every death leaves a corpse that can be raised once', () => {
    const a = makeArena({ stats: tough() });
    for (let k = 0; k < 3; k++) {
      const i = placeMonster(a.world, 'boneThrall', 100 + k * 10, 0, { life: 1 });
      stepWith(a.run, idleIntent());
      damageMonster(a.world, i, 100, DAMAGE_INDEX.fire, 0, 1.5, 0, 0, 0, 0, true, 1);
    }
    expect(takeCorpses(a.world, 110, 0, 50, 2, 'boneThrall')).toHaveLength(2);
    expect(takeCorpses(a.world, 110, 0, 50, 5)).toHaveLength(1);
    expect(takeCorpses(a.world, 110, 0, 50, 5)).toHaveLength(0);
  });
});

describe('every area kind', () => {
  it('spawns, lives and ends without errors; telegraphs resolve, persistent ground ends silently', () => {
    const a = makeArena({ stats: tough() });
    for (const kind of AREA_KINDS) spawnArea(a.world, kind, 50, 50, 20, 0.5, { hurts: 'player', damage: 1, dtype: 0, target: 1 });
    const r = stepN(a.run, 40);
    const resolved = new Set(ofType(r.events, 'areaResolve').map((e) => e.kind));
    for (const k of ['slamWarning', 'frostNovaWarning', 'glacialSpike', 'wispBurst', 'executionMark', 'arenaSpikes'] as const) {
      expect(resolved.has(k), k).toBe(true);
    }
    for (const k of ['firePool', 'heraldAura', 'choirWave', 'tarPool', 'blizzard', 'whirlwind', 'chargeLine'] as const) {
      expect(resolved.has(k), k).toBe(false);
    }
    expect(a.world.areas).toHaveLength(0);
    expect(PLAYER_RADIUS).toBeGreaterThan(0);
  });
});
