// Player debuffs (GAME_SPEC §13): each rule, its counterplay, the Ashen Forge sources, and that client
// prediction (the shared movePlayer with the documented slow) matches the sim bit for bit.
import { describe, expect, it } from 'vitest';
import { SIM_DT, type PlayerIntent } from '../../src/contracts/sim';
import { spawnArea } from '../../src/sim/areas';
import { damagePlayer } from '../../src/sim/combat';
import {
  BLEED_FRACTION, BURN_FRACTION, FREEZE_DURATION, FREEZE_IMMUNITY, PLAYER_CHILL_DURATION, PLAYER_CHILL_SLOW, PLAYER_SHOCK_BONUS,
  PULL_MAX_DISTANCE, PULL_TIME, ROOT_DURATION, ROOT_GRACE, WITHER_RES_PER_STACK,
} from '../../src/sim/constants';
import { applyDebuff } from '../../src/sim/debuffs';
import { applyDebuff as rosterApplyDebuff, pullPlayer as rosterPullPlayer } from '../../src/sim/rosters/api';
import { hitPlayer, killMonster } from '../../src/sim/combat';
import { RARITY_CODE } from '../../src/contracts/sim';
import type { SimPlayerJoin } from '../../src/sim';
import { makeJoin, makeSolo } from './fixtures';
import { DAMAGE_INDEX } from '../../src/sim/math';
import { CAST_SLOW, areaSlowAt, castRateOf, debuffSlowOf, movePlayer, playerSlow, predictionSlow } from '../../src/sim/movement';
import { fireHostile } from '../../src/sim/behaviour';
import { PROJ, setProjectilePull } from '../../src/sim/projectiles';
import { addProp } from '../../src/sim/props';
import { idleIntent, makeSkill, makeStats } from './fixtures';
import { hold, makeArena, ofType, placeMonster, pv, stepN, stepWith } from './helpers';

const walk = (moveX = 1, moveY = 0): PlayerIntent => ({ ...idleIntent(), moveX, moveY });
const tough = (o: Parameters<typeof makeStats>[0] = {}) => makeStats({ maxLife: 1e6, evasion: 0, ...o });
const debuffOf = (run: ReturnType<typeof makeArena>['run'], id: string) => pv(run).debuffs.find((d) => d.id === id);

describe('chilled', () => {
  it('slows movement and casting by 30%, refreshes without stacking, and cold resistance shortens it', () => {
    const a = makeArena({ stats: tough() });
    stepN(a.run, 30, walk());
    const x0 = a.player.x;
    stepN(a.run, 60, walk());
    const free = a.player.x - x0;
    applyDebuff(a.world, a.player, 'chilled');
    applyDebuff(a.world, a.player, 'chilled');
    const x1 = a.player.x;
    stepN(a.run, 60, walk());
    expect((a.player.x - x1) / free).toBeCloseTo(1 - PLAYER_CHILL_SLOW, 3);
    const d = debuffOf(a.run, 'chilled')!;
    expect(d.stacks).toBe(1);
    expect(d.duration).toBeCloseTo(PLAYER_CHILL_DURATION, 6);

    // 50% cold resistance: 2 s × (1 − 0.25).
    const r = makeArena({ stats: tough({ resist: { physical: 0, fire: 0, cold: 0.5, lightning: 0, void: 0 } }) });
    applyDebuff(r.world, r.player, 'chilled');
    stepWith(r.run, idleIntent());
    expect(debuffOf(r.run, 'chilled')!.duration).toBeCloseTo(PLAYER_CHILL_DURATION * 0.75, 6);
  });

  it('casts take 1/0.7 as long while chilled', () => {
    const lance = makeSkill('emberLance', 1);
    const castTicks = (chill: boolean) => {
      const a = makeArena({ stats: tough(), skills: [lance] });
      if (chill) applyDebuff(a.world, a.player, 'chilled', 0, undefined, 60);
      const r = stepN(a.run, 240, hold(0, 100, 0));
      return ofType(r.events, 'cast').length;
    };
    const normal = castTicks(false);
    const chilled = castTicks(true);
    expect(chilled / normal).toBeCloseTo(1 - PLAYER_CHILL_SLOW, 1);
  });
});

describe('frozen', () => {
  it('holds the player still, holds a cast and blocks new ones; flasks still work', () => {
    const a = makeArena({ stats: tough({ maxLife: 100 }), skills: [makeSkill('emberLance', 1)] });
    a.player.life = 40;
    stepN(a.run, 5, hold(0, 100, 0)); // a lance cast is under way
    const progress = pv(a.run).castProgress;
    expect(progress).toBeGreaterThan(0);
    applyDebuff(a.world, a.player, 'frozen');
    const x = a.player.x;
    const r = stepN(a.run, 20, () => ({ ...hold(0, 100, 0), moveX: 1 }));
    expect(a.player.x).toBe(x);
    expect(ofType(r.events, 'cast')).toHaveLength(0);
    expect(pv(a.run).castProgress).toBeCloseTo(progress, 6);
    // A flask during the freeze.
    const f = stepN(a.run, 1, { ...idleIntent(), flask: 0 });
    expect(ofType(f.events, 'flask')).toHaveLength(1);
    // It thaws after 0.8 s and she moves and casts again.
    const after = stepN(a.run, Math.round(FREEZE_DURATION / SIM_DT) + 30, () => ({ ...hold(0, 100, 0), moveX: 1 }));
    expect(debuffOf(a.run, 'frozen')).toBeUndefined();
    expect(a.player.x).toBeGreaterThan(x);
    expect(ofType(after.events, 'cast').length).toBeGreaterThan(0);
  });

  it('is followed by 3 s of freeze immunity (a freeze then only chills)', () => {
    const a = makeArena({ stats: tough() });
    expect(applyDebuff(a.world, a.player, 'frozen')).toBe(true);
    stepN(a.run, Math.round((FREEZE_DURATION + 0.2) / SIM_DT));
    expect(debuffOf(a.run, 'frozen')).toBeUndefined();
    applyDebuff(a.world, a.player, 'frozen');
    stepWith(a.run, idleIntent());
    expect(debuffOf(a.run, 'frozen')).toBeUndefined();
    expect(debuffOf(a.run, 'chilled')).toBeDefined();
    stepN(a.run, Math.round(FREEZE_IMMUNITY / SIM_DT));
    applyDebuff(a.world, a.player, 'frozen');
    stepWith(a.run, idleIntent());
    expect(debuffOf(a.run, 'frozen')).toBeDefined();
  });
});

describe('rooted', () => {
  it('stops movement but not casting; Rift Step breaks it; the source is shown', () => {
    const skills = [makeSkill('emberLance', 1), makeSkill('riftStep', 1)];
    const a = makeArena({ stats: tough(), skills, loadout: ['emberLance', 'riftStep', null, null, null, null] });
    applyDebuff(a.world, a.player, 'rooted', 0, 'web');
    expect(debuffOf(a.run, 'rooted')).toBeUndefined(); // the view updates on the next step
    const r = stepN(a.run, 40, () => ({ ...hold(0, 200, 0), moveX: 1 }));
    expect(a.player.x).toBe(0);
    expect(ofType(r.events, 'cast').length).toBeGreaterThan(0);
    const d = debuffOf(a.run, 'rooted')!;
    expect(d.source).toBe('web');
    expect(d.duration).toBeCloseTo(ROOT_DURATION, 6);
    // Rift Step: breaks the root, blinks, and she walks again.
    const blink = stepN(a.run, 1, hold(1, 200, 0));
    expect(ofType(blink.events, 'dash')).toHaveLength(1);
    expect(ofType(blink.events, 'cleanse')[0].debuffs).toEqual(['rooted']);
    const x = a.player.x;
    expect(x).toBeGreaterThan(50);
    stepN(a.run, 20, walk());
    expect(a.player.x).toBeGreaterThan(x + 20);
  });

  it('a chain hook drags its victim 40 units toward the thrower, then holds them; Rift Step breaks the drag', () => {
    const a = makeArena({ stats: tough() });
    const i = placeMonster(a.world, 'chainThrall', 200, 0, { life: 1e6 });
    fireHostile(a.world, i, PROJ.chainHook, Math.PI, 330, 210, 5, 1, DAMAGE_INDEX.physical);
    const r = stepN(a.run, 60); // ~0.6 s of flight, 0.25 s of drag
    const pull = ofType(r.events, 'pull');
    expect(pull).toHaveLength(1);
    expect(pull[0].toX - pull[0].fromX).toBeCloseTo(40, 0);
    expect(a.player.x).toBeCloseTo(40, 0);
    expect(debuffOf(a.run, 'rooted')!.source).toBe('chain');
    stepN(a.run, 20, walk(-1, 0));
    expect(a.player.x).toBeCloseTo(40, 0); // held after the drag

    // A second hook; a Rift Step mid-drag breaks it.
    const b = makeArena({
      stats: tough(), skills: [makeSkill('emberLance', 1), makeSkill('riftStep', 1)], loadout: ['emberLance', 'riftStep', null, null, null, null],
    });
    const j = placeMonster(b.world, 'chainThrall', 200, 0, { life: 1e6 });
    fireHostile(b.world, j, PROJ.chainHook, Math.PI, 330, 210, 5, 1, DAMAGE_INDEX.physical);
    let pulled = -1;
    for (let t = 0; t < 60 && pulled < 0; t++) if (ofType(stepN(b.run, 1).events, 'pull').length) pulled = t;
    expect(pulled).toBeGreaterThan(0);
    stepN(b.run, 3);
    const blink = stepN(b.run, 1, hold(1, -200, 0));
    expect(ofType(blink.events, 'cleanse')[0].debuffs).toEqual(['rooted']);
    const x = b.player.x;
    stepN(b.run, 20);
    expect(b.player.x).toBe(x); // no drag after the blink
    expect(b.player.debuffs.remaining[2]).toBe(0);
  });
});

describe('roots do not chain', () => {
  it('a new root is ignored while rooted and for ROOT_GRACE after, but a hook still drags', () => {
    const a = makeArena({ stats: tough() });
    expect(applyDebuff(a.world, a.player, 'rooted', 0, 'web')).toBe(true);
    expect(applyDebuff(a.world, a.player, 'rooted', 0, 'tar')).toBe(false);
    stepN(a.run, Math.round((ROOT_DURATION + 0.1) / SIM_DT));
    expect(debuffOf(a.run, 'rooted')).toBeUndefined();
    expect(applyDebuff(a.world, a.player, 'rooted', 0, 'bone')).toBe(false); // inside the grace window
    // A chain hook in the grace window still drags her, without a new root.
    const i = placeMonster(a.world, 'chainThrall', 200, 0, { life: 1e6 });
    fireHostile(a.world, i, PROJ.chainHook, Math.PI, 2000, 210, 5, 1, DAMAGE_INDEX.physical);
    const r = stepN(a.run, 20);
    expect(ofType(r.events, 'pull')).toHaveLength(1);
    expect(debuffOf(a.run, 'rooted')).toBeUndefined();
    stepN(a.run, Math.round(ROOT_GRACE / SIM_DT));
    expect(applyDebuff(a.world, a.player, 'rooted', 0, 'bone')).toBe(true);
  });
});

describe('damage over time', () => {
  it('burning deals 40% of the triggering hit over 3 s and keeps the strongest burn', () => {
    const a = makeArena({ stats: tough() });
    applyDebuff(a.world, a.player, 'burning', 100);
    applyDebuff(a.world, a.player, 'burning', 40); // weaker: refresh only
    const life = a.player.life;
    const r = stepN(a.run, Math.round(3.2 / SIM_DT));
    expect(life - a.player.life).toBeCloseTo(BURN_FRACTION * 100, 3);
    const hits = ofType(r.events, 'hit').filter((e) => e.target === 'player' && e.damageType === 'fire');
    expect(hits.length).toBeGreaterThanOrEqual(5); // batched every 0.5 s
    expect(hits.reduce((s, e) => s + e.amount, 0)).toBeCloseTo(BURN_FRACTION * 100, 3);
    expect(debuffOf(a.run, 'burning')).toBeUndefined();
  });

  it('bleeding deals 20% over 4 s, twice as fast while moving, and stacks up to 3', () => {
    const still = makeArena({ stats: tough() });
    applyDebuff(still.world, still.player, 'bleeding', 100);
    const l0 = still.player.life;
    stepN(still.run, Math.round(4.2 / SIM_DT));
    expect(l0 - still.player.life).toBeCloseTo(BLEED_FRACTION * 100, 3);

    const moving = makeArena({ stats: tough() });
    applyDebuff(moving.world, moving.player, 'bleeding', 100);
    const l1 = moving.player.life;
    stepN(moving.run, Math.round(4.2 / SIM_DT), walk(0, 1));
    expect(l1 - moving.player.life).toBeCloseTo(BLEED_FRACTION * 100 * 2, 3);

    const stacked = makeArena({ stats: tough() });
    for (let k = 0; k < 5; k++) applyDebuff(stacked.world, stacked.player, 'bleeding', 50);
    stepWith(stacked.run, idleIntent());
    expect(debuffOf(stacked.run, 'bleeding')!.stacks).toBe(3);
  });

  it('can kill, and death clears every debuff with a cleanse', () => {
    const a = makeArena({ stats: makeStats({ maxLife: 30, evasion: 0 }) });
    applyDebuff(a.world, a.player, 'burning', 200);
    applyDebuff(a.world, a.player, 'withered');
    const r = stepN(a.run, Math.round(3 / SIM_DT));
    expect(pv(a.run).dead).toBe(true);
    expect(pv(a.run).debuffs).toHaveLength(0);
    const c = ofType(r.events, 'cleanse');
    expect(c).toHaveLength(1);
    expect(c[0].debuffs.sort()).toEqual(['burning', 'withered']);
    expect(ofType(r.events, 'playerDeath')).toHaveLength(1);
  });
});

describe('shocked and withered', () => {
  it('shocked: +20% damage taken', () => {
    const hit = (shock: boolean) => {
      const a = makeArena({ seed: 3, stats: tough() });
      if (shock) applyDebuff(a.world, a.player, 'shocked');
      return damagePlayer(a.world, a.player, 100, DAMAGE_INDEX.fire, 'dot');
    };
    expect(hit(true) / hit(false)).toBeCloseTo(1 + PLAYER_SHOCK_BONUS, 6);
  });

  it('withered: −12% to every resistance per stack, up to 3 stacks', () => {
    const res = { physical: 0, fire: 0.5, cold: 0.5, lightning: 0.5, void: 0.5 };
    const hit = (stacks: number) => {
      const a = makeArena({ seed: 3, stats: tough({ resist: res }) });
      for (let k = 0; k < stacks; k++) applyDebuff(a.world, a.player, 'withered');
      return damagePlayer(a.world, a.player, 100, DAMAGE_INDEX.void, 'dot');
    };
    expect(hit(0)).toBeCloseTo(50, 6);
    expect(hit(2)).toBeCloseTo(100 * (1 - (0.5 - 2 * WITHER_RES_PER_STACK)), 6);
    expect(hit(5)).toBeCloseTo(100 * (1 - (0.5 - 3 * WITHER_RES_PER_STACK)), 6);
  });
});

describe('counterplay', () => {
  it('the life flask puts out burning and bleeding; the focus flask lifts withered', () => {
    const a = makeArena({ stats: tough() });
    for (const id of ['burning', 'bleeding', 'withered', 'chilled'] as const) applyDebuff(a.world, a.player, id, 50);
    const life = stepN(a.run, 1, { ...idleIntent(), flask: 0 });
    expect(ofType(life.events, 'cleanse')[0].debuffs).toEqual(['burning', 'bleeding']);
    const focus = stepN(a.run, 1, { ...idleIntent(), flask: 2 });
    expect(ofType(focus.events, 'cleanse')[0].debuffs).toEqual(['withered']);
    expect(pv(a.run).debuffs.map((d) => d.id)).toEqual(['chilled']);
  });

  it('Cinder Ward makes every debuff run out twice as fast', () => {
    const ward = makeSkill('cinderWard', 1);
    const a = makeArena({ stats: tough(), skills: [makeSkill('emberLance', 1), ward], loadout: ['emberLance', 'cinderWard', null, null, null, null] });
    stepN(a.run, 30, hold(1, 0, 100));
    expect(pv(a.run).wardTime).toBeGreaterThan(1.5);
    applyDebuff(a.world, a.player, 'rooted');
    applyDebuff(a.world, a.player, 'burning', 100);
    const life = a.player.life;
    stepN(a.run, Math.round((ROOT_DURATION / 2 + 0.05) / SIM_DT));
    expect(debuffOf(a.run, 'rooted')).toBeUndefined();
    stepN(a.run, 120);
    expect(life - a.player.life).toBeCloseTo((BURN_FRACTION * 100) / 2, 1);
  });

  it('an evaded or invulnerable hit carries no debuff', () => {
    const a = makeArena({ stats: makeStats({ maxLife: 1e6, evasion: 0.75 }) });
    let applied = 0;
    for (let k = 0; k < 200; k++) {
      a.player.debuffs.remaining.fill(0);
      damagePlayer(a.world, a.player, 10, DAMAGE_INDEX.physical, 'melee', 'bleeding');
      if (a.player.debuffs.remaining[4] > 0) applied++;
    }
    expect(applied).toBeGreaterThan(20);
    expect(applied).toBeLessThan(90);
    a.player.invulnTime = 1;
    a.player.debuffs.remaining.fill(0);
    damagePlayer(a.world, a.player, 10, DAMAGE_INDEX.physical, 'area', 'rooted', 'bone');
    expect(a.player.debuffs.remaining[2]).toBe(0);
  });
});

describe('Ashen Forge sources', () => {
  it('fire pools set players burning; a Rift Stalker landing withers', () => {
    const a = makeArena({ stats: tough() });
    spawnArea(a.world, 'firePool', 0, 0, 30, 1, { damage: 10, dtype: DAMAGE_INDEX.fire, hurts: 'player', tickInterval: 0.5, firstTick: 0 });
    spawnArea(a.world, 'leapWarning', 0, 0, 26, 0.1, { damage: 10, dtype: DAMAGE_INDEX.void, hurts: 'player' });
    const r = stepN(a.run, 10);
    expect(ofType(r.events, 'debuff').map((e) => e.debuff).sort()).toEqual(['burning', 'withered']);
  });

  it('spitter lobs and Matriarch orbs burn, Herald orbs wither', () => {
    for (const [kind, proj, debuff] of [
      ['cinderSpitter', 'cinderSpit', 'burning'], ['cinderMatriarch', 'matriarchOrb', 'burning'], ['ashboundHerald', 'heraldOrb', 'withered'],
    ] as const) {
      const a = makeArena({ stats: tough() });
      const i = placeMonster(a.world, kind, 100, 0, { life: 1e9 });
      a.world.monsters.timerA[i] = a.world.monsters.timerB[i] = 99;
      fireHostile(a.world, i, PROJ[proj], Math.PI, 150, 200, 5, 10, DAMAGE_INDEX.fire, proj === 'cinderSpit' ? 0.5 : 0);
      const r = stepN(a.run, 60);
      expect(ofType(r.events, 'debuff').map((e) => e.debuff), kind).toContain(debuff);
    }
  });
});

describe('prediction parity', () => {
  it('movePlayer with the documented slow reproduces the sim exactly under chill, root, tar and casting', () => {
    const skills = [makeSkill('emberLance', 1), makeSkill('emberNova', 1)];
    const a = makeArena({ stats: tough(), skills, loadout: ['emberLance', 'emberNova', null, null, null, null] });
    spawnArea(a.world, 'tarPool', 120, 30, 30, 60, { debuff: null });
    let checked = 0;
    let slowed = 0;
    for (let t = 0; t < 400; t++) {
      // Debuffs land during a tick (after movement) in real play; here they are applied between ticks, so
      // that one tick is a correction for a client — skip checking it.
      let skip = false;
      if (t === 40) skip = applyDebuff(a.world, a.player, 'chilled', 0, undefined, 1.5);
      if (t === 200) skip = applyDebuff(a.world, a.player, 'rooted', 0, 'bone', 0.5);
      const intent: PlayerIntent = { ...idleIntent(200, 0), moveX: Math.cos(t * 0.02), moveY: 0.3 * Math.sin(t * 0.05) };
      intent.held[1] = t % 90 < 30;
      // What a client knows before predicting this input: the latest snapshot (the view after the last tick).
      const view = pv(a.run);
      const before = { x: view.x, y: view.y };
      const debuffSlow = debuffSlowOf(view.debuffs);
      const ground = areaSlowAt(a.world.areas, before.x, before.y);
      stepWith(a.run, intent);
      // The cast slow: a client models casts per input tick (net's CastModel); here the sim's own cast
      // state for this tick (casting runs before movement, so the view after the tick shows it).
      const after = pv(a.run);
      const castSlow = after.castSkill && after.castSkill !== 'emberLance' ? CAST_SLOW : 0;
      const slow = playerSlow(castSlow, debuffSlow, ground);
      const expected = movePlayer(before, intent, { speed: 110, arenaRadius: 600, props: a.world.props, slow }, SIM_DT);
      if (skip) continue;
      expect(after.x).toBe(expected.x);
      expect(after.y).toBe(expected.y);
      checked++;
      if (slow > 0) slowed++;
    }
    expect(checked).toBe(398);
    expect(slowed).toBeGreaterThan(100);
  });

  it('predictionSlow and castRateOf read the debuffs of a snapshot', () => {
    const view = { castSkill: null, slots: [], debuffs: [{ id: 'chilled' as const, remaining: 1, duration: 2, stacks: 1, source: null }] };
    expect(predictionSlow(view)).toBe(PLAYER_CHILL_SLOW);
    expect(predictionSlow({ ...view, debuffs: [{ id: 'rooted', remaining: 1, duration: 2, stacks: 1, source: 'tar' }] })).toBe(1);
    expect(castRateOf(view.debuffs)).toBeCloseTo(0.7, 9);
    expect(castRateOf([{ id: 'frozen', remaining: 1, duration: 2, stacks: 1, source: null }])).toBe(0);
    expect(predictionSlow({ castSkill: null, slots: [] })).toBe(0);
  });
});

describe('fairness guard rails', () => {
  it('a melee hit never freezes or roots (its rider is dropped); a projectile or an area still can', () => {
    const a = makeArena({ stats: tough() });
    expect(hitPlayer(a.world, a.player, 5, DAMAGE_INDEX.physical, 'melee', 'frozen')).toBeGreaterThan(0);
    expect(hitPlayer(a.world, a.player, 5, DAMAGE_INDEX.physical, 'melee', 'rooted', 'bone')).toBeGreaterThan(0);
    // A zero-damage melee "web" carries nothing at all now: it doesn't connect.
    expect(hitPlayer(a.world, a.player, 0, DAMAGE_INDEX.physical, 'melee', 'rooted')).toBe(-1);
    stepWith(a.run, idleIntent());
    expect(pv(a.run).debuffs).toEqual([]);
    // Other riders ride melee as before.
    hitPlayer(a.world, a.player, 5, DAMAGE_INDEX.physical, 'melee', 'bleeding');
    hitPlayer(a.world, a.player, 0, DAMAGE_INDEX.physical, 'projectile', 'rooted', 'web');
    stepWith(a.run, idleIntent());
    expect(pv(a.run).debuffs.map((d) => d.id).sort()).toEqual(['bleeding', 'rooted']);
  });

  it("the roster API's applyDebuff and pullPlayer skip an invulnerable (blinking) player", () => {
    const a = makeArena({ stats: tough() });
    a.player.invulnTime = 0.2;
    expect(rosterApplyDebuff(a.world, a.player, 'frozen')).toBe(false);
    rosterPullPlayer(a.world, a.player, 100, 0, 40);
    const r = stepN(a.run, 1);
    expect(ofType(r.events, 'pull')).toHaveLength(0);
    expect(pv(a.run).debuffs).toEqual([]);
    a.player.invulnTime = 0;
    expect(rosterApplyDebuff(a.world, a.player, 'chilled')).toBe(true);
  });

  it('a pull never drags farther than PULL_MAX_DISTANCE, over PULL_TIME, and never through a prop', () => {
    const a = makeArena({ stats: tough() });
    const i = placeMonster(a.world, 'chainmaster', 400, 0, { life: 1e6 });
    const slot = fireHostile(a.world, i, PROJ.chainHook, Math.PI, 2000, 500, 6, 1, DAMAGE_INDEX.physical);
    setProjectilePull(a.world, slot, 1000);
    const r = stepN(a.run, 30);
    const pull = ofType(r.events, 'pull');
    expect(pull).toHaveLength(1);
    expect(Math.hypot(pull[0].toX - pull[0].fromX, pull[0].toY - pull[0].fromY)).toBeCloseTo(PULL_MAX_DISTANCE, 3);
    expect(a.player.x).toBeCloseTo(pull[0].toX, 3);

    // A pillar between her and the thrower stops the drag on its near side.
    const b = makeArena({ stats: tough() });
    addProp(b.world, 'pillar', 60, 0, 10);
    const j = placeMonster(b.world, 'chainmaster', 400, 0, { life: 1e6 });
    // Hooked from beyond the pillar: the drag along +x would run straight through it.
    const s2 = fireHostile(b.world, j, PROJ.chainHook, Math.PI, 2000, 500, 6, 1, DAMAGE_INDEX.physical);
    setProjectilePull(b.world, s2, 1000);
    let maxStep = 0;
    let px = b.player.x;
    for (let t = 0; t < 40; t++) {
      stepWith(b.run, idleIntent());
      maxStep = Math.max(maxStep, Math.abs(b.player.x - px));
      px = b.player.x;
    }
    expect(maxStep).toBeLessThanOrEqual(PULL_MAX_DISTANCE / (PULL_TIME / SIM_DT) + 0.5);
    expect(b.player.x).toBeLessThan(60 - 10 - 7 + 0.01);
  });
});

describe('the map clear', () => {
  it('lifts every debuff the moment the boss falls: a burn at 1 life does not kill after the win', () => {
    const { run, world } = makeSolo({
      seed: 17, stats: tough(), waves: { count: 2, bossWave: 2, lieutenantWave: 0, waveDuration: 8, tellDuration: 1 },
    });
    let boss = -1;
    for (let t = 0; t < Math.round(30 / SIM_DT) && boss < 0; t++) {
      stepWith(run, idleIntent());
      run.drainEvents();
      run.drainOutcomes();
      const m = world.monsters;
      for (let i = 0; i < m.hwm; i++) if (m.alive[i] && m.rarity[i] === RARITY_CODE.boss && m.spawnTime[i] <= 0) boss = i;
    }
    expect(boss).toBeGreaterThanOrEqual(0);
    const p = world.players[0];
    p.invulnTime = 0;
    applyDebuff(world, p, 'burning', 3000);
    applyDebuff(world, p, 'bleeding', 3000);
    applyDebuff(world, p, 'withered');
    p.life = 1;
    killMonster(world, boss, DAMAGE_INDEX.fire, true, 1);
    const r = stepN(run, 120);
    expect(r.outcomes.map((o) => o.t)).toContain('cleared');
    expect(r.outcomes.map((o) => o.t)).not.toContain('playerDied');
    expect(pv(run).dead).toBe(false);
    expect(pv(run).debuffs).toEqual([]);
    const cleansed = ofType(r.events, 'cleanse');
    expect(cleansed).toHaveLength(1);
    expect([...cleansed[0].debuffs].sort()).toEqual(['bleeding', 'burning', 'withered']);
  });
});

describe('re-joining', () => {
  it('resumes the debuffs the player left with (SimPlayerJoin.debuffs): never a free cleanse', () => {
    const a = makeArena({ stats: tough() });
    applyDebuff(a.world, a.player, 'burning', 300);
    for (let k = 0; k < 3; k++) applyDebuff(a.world, a.player, 'bleeding', 100);
    applyDebuff(a.world, a.player, 'frozen');
    applyDebuff(a.world, a.player, 'withered');
    applyDebuff(a.world, a.player, 'withered');
    stepN(a.run, 6);
    const left = pv(a.run).debuffs.map((d) => ({ ...d }));
    expect(left.map((d) => d.id)).toEqual(['frozen', 'burning', 'bleeding', 'withered']);
    a.run.removePlayer(1);
    const rejoin: SimPlayerJoin = { ...makeJoin(1, { stats: tough(), x: 0, y: 0 }), debuffs: left };
    a.run.addPlayer(rejoin);
    const p = a.world.playerById[1]!;
    a.run.drainEvents();
    stepWith(a.run, idleIntent());
    const back = pv(a.run).debuffs;
    expect(back.map((d) => [d.id, d.stacks])).toEqual(left.map((d) => [d.id, d.stacks]));
    for (let k = 0; k < back.length; k++) expect(back[k].remaining).toBeCloseTo(left[k].remaining - SIM_DT, 6);
    // Still frozen (can't move), still immune to a fresh freeze afterwards, and the burn still burns.
    const x = p.x;
    stepN(a.run, 10, walk());
    expect(p.x).toBe(x);
    const life = p.life;
    stepN(a.run, 30);
    expect(p.life).toBeLessThan(life);
    stepN(a.run, Math.round(FREEZE_DURATION / SIM_DT));
    applyDebuff(a.world, p, 'frozen');
    expect(debuffOf(a.run, 'frozen')).toBeUndefined();
    // Malformed carries are ignored.
    a.run.removePlayer(1);
    const malformed: SimPlayerJoin = {
      ...makeJoin(1, { stats: tough() }),
      debuffs: [
        { id: 'nope' as 'chilled', remaining: 1, duration: 1, stacks: 1, source: null },
        { id: 'burning', remaining: 2, duration: 3, stacks: 1, source: null }, // no dps: can't resume a burn
        { id: 'chilled', remaining: Number.NaN, duration: 2, stacks: 1, source: null },
      ],
    };
    a.run.addPlayer(malformed);
    stepWith(a.run, idleIntent());
    expect(pv(a.run).debuffs).toEqual([]);
  });
});
