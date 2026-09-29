// Telegraph honesty and debuff readability (the review fixes): what is drawn is exactly what hits, and when.
//  - the sim tuning the presenter mirrors is pinned to its sources (tar pool, splash, charge tail, mark lock, leap)
//  - the tar landing marker covers the pool it leaves; Varkus's lane fills by the launch; the mark locks on time
//  - the chain hangs from its thrower and reels back on a miss; a frozen pose never turns
//  - debuff lights share one budget, stacked glows dim, pops only on news, burn / bleed ticks read as ticks
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ArtBundle, SpriteDef } from '../../src/contracts/art';
import type { PlayerDebuff } from '../../src/contracts/bestiary';
import { MONSTER_KINDS, type MonsterKind } from '../../src/contracts/content';
import type { PresentInput } from '../../src/contracts/present';
import {
  MONSTER_ANIM, PROJECTILE_KINDS, RARITY_CODE, type PlayerDebuffView, type PlayerView, type SimEvent, type WorldView,
} from '../../src/contracts/sim';
import { generateSprites } from '../../src/art';
import { createPresenter } from '../../src/present';
import {
  CHARGE_LANE_DASH_TAIL, chargeLaneLaunched, chargeLaneProgress, LEAP_ARC, MARK_LOCKED_TAIL, markLocked, markLockProgress,
  PRESENCE_VARKUS, SPIT_SPLASH_RADIUS, TAR_POOL_RADIUS, TAR_SPLASH_RADIUS,
} from '../../src/present/bestiary';
import type { FrameCtx } from '../../src/present/context';
import {
  DEBUFF_LIGHT_BUDGET, DebuffPainter, debuffLightScale, debuffLightWant, debuffMask, DOT_TICK_MAX_FRACTION, glowStackFactor, isDotTick,
  STACKED_GLOW_ALPHA, WITHER_UNDER_BURN,
} from '../../src/present/debuffs';
import { Effects } from '../../src/present/fx';
import type { Pen } from '../../src/present/pen';
import { lobMarkerRadius } from '../../src/present/projectiles';
import { DOT_TICK_VOLUME, SoundDirector } from '../../src/present/sound';
import { CHARGE_LINE_HALF_WIDTH, encodeAreaId } from '../../src/sim/area-geometry';
import * as SIM from '../../src/sim/constants';
import { TAR, VARKUS } from '../../src/sim/rosters/coliseum/tuning';
import { addMonster, emptyWorld, player, RecordingAudio, RecordingRenderer } from './helpers';

let sprites: SpriteDef[];
beforeAll(() => {
  sprites = generateSprites();
});

function art(): ArtBundle {
  return { sprites, icon: () => '', portrait: () => '', palette: {} };
}

const kind = (k: MonsterKind) => MONSTER_KINDS.indexOf(k);
const debuff = (id: PlayerDebuffView['id'], over: Partial<PlayerDebuffView> = {}): PlayerDebuffView => ({
  id, remaining: 1.5, duration: 2, stacks: 1, source: id === 'rooted' ? 'bone' : null, ...over,
});

function input(world: WorldView, events: SimEvent[] = [], dt = 1 / 60): PresentInput {
  return {
    world, localPlayerId: 1, alpha: 1, dt, events, cursorWorld: { x: 0, y: 0 }, hoverPropId: -1, hoverDropId: -1,
    settings: { screenShake: 1 }, paused: false,
  };
}

const near = (a: readonly number[], b: readonly number[], eps = 1e-3): boolean => a.every((v, i) => Math.abs(v - b[i]) < eps);

// ---------------------------------------------------------------------------------------------------------------

describe('sim tuning mirrors', () => {
  it('are pinned to their sources', () => {
    expect(TAR_POOL_RADIUS).toBe(SIM.TAR_POOL_RADIUS);
    expect(SPIT_SPLASH_RADIUS).toBe(SIM.SPIT_SPLASH_RADIUS);
    expect(TAR_SPLASH_RADIUS).toBe(TAR.splash);
    expect(CHARGE_LANE_DASH_TAIL).toBeCloseTo(VARKUS.chargeDash + 0.1, 9);
    expect(MARK_LOCKED_TAIL).toBeCloseTo(VARKUS.markTime - VARKUS.markLock, 9);
    expect(LEAP_ARC.varkus!.flight).toBeCloseTo(VARKUS.leapFlight, 9);
  });

  it('size each lob marker by what its landing does', () => {
    expect(lobMarkerRadius('tarGlob')).toBe(SIM.TAR_POOL_RADIUS);
    expect(lobMarkerRadius('cinderSpit')).toBe(SIM.SPIT_SPLASH_RADIUS);
    expect(lobMarkerRadius('crossbowBolt')).toBe(0);
  });
});

describe('telegraph timing', () => {
  const laneLife = VARKUS.chargeCast + VARKUS.chargeDash + 0.1;

  it("Varkus's lane fills over the cast and is full exactly at the launch", () => {
    expect(chargeLaneProgress(0, laneLife)).toBe(0);
    expect(chargeLaneProgress(VARKUS.chargeCast / 2, laneLife)).toBeCloseTo(0.5, 6);
    expect(chargeLaneProgress(VARKUS.chargeCast - 1e-6, laneLife)).toBeLessThan(1);
    expect(chargeLaneProgress(VARKUS.chargeCast, laneLife)).toBeCloseTo(1, 6);
    expect(chargeLaneProgress(laneLife, laneLife)).toBe(1);
    expect(chargeLaneLaunched(VARKUS.chargeCast - 0.02, laneLife)).toBe(false);
    expect(chargeLaneLaunched(VARKUS.chargeCast + 0.02, laneLife)).toBe(true);
    // A lane too short to carry the dash tail fills over its whole life.
    expect(chargeLaneProgress(0.3, 0.6)).toBeCloseTo(0.5, 6);
    expect(chargeLaneLaunched(0.59, 0.6)).toBe(false);
  });

  it('the execution mark locks for the last markTime − markLock seconds', () => {
    const T = VARKUS.markTime;
    expect(markLocked(VARKUS.markLock - 0.05, T)).toBe(false);
    expect(markLocked(VARKUS.markLock + 1e-9, T)).toBe(true);
    expect(markLockProgress(VARKUS.markLock - 0.05, T)).toBe(0);
    expect(markLockProgress(VARKUS.markLock + (T - VARKUS.markLock) / 2, T)).toBeCloseTo(0.5, 6);
    expect(markLockProgress(T, T)).toBe(1);
  });

  it('draws the lane fill two-thirds along mid-cast and full, steady and hot once he dashes', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = emptyWorld([player(1, 0, 300, { vx: 0, prevX: 0 })]);
    const half = CHARGE_LINE_HALF_WIDTH[2];
    const sweepEnd = (): number[] =>
      r.frameShapes.filter((s) => s.kind === 'line' && s.layer === 'decal' && s.thickness === half * 2).map((s) => s.x2);
    w.areas = [{ id: encodeAreaId(1, 0, 2), kind: 'chargeLine', x: 0, y: 0, radius: 200, age: 0.6, duration: laneLife }];
    p.frame(input(w));
    // The fill (whole lane) and the sweep (0.6 / chargeCast of it).
    expect(sweepEnd().sort((a, b) => a - b)).toEqual([expect.closeTo((200 * 0.6) / VARKUS.chargeCast, 3), expect.closeTo(200, 3)]);
    w.areas = [{ id: encodeAreaId(1, 0, 2), kind: 'chargeLine', x: 0, y: 0, radius: 200, age: 1.2, duration: laneLife }];
    p.frame(input(w));
    const ends = sweepEnd();
    expect(ends.length).toBeGreaterThanOrEqual(3); // fill, full sweep, the dash's heat
    expect(ends.every((x) => Math.abs(x - 200) < 1e-3)).toBe(true);
  });

  it('the mark shows as locked (thick rim) exactly once its player can no longer drag it', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = emptyWorld([player(1, 200, 200, { vx: 0, prevX: 200 })]);
    const MARK: readonly number[] = [1, 0.12, 0.1];
    const rimThickness = (): number[] =>
      r.frameShapes.filter((s) => s.kind === 'ring' && s.layer === 'fx' && s.radius === 36 && near(s.color, MARK)).map((s) => s.thickness);
    w.areas = [{ id: encodeAreaId(2, 0, 0), kind: 'executionMark', x: 0, y: 0, radius: 36, age: VARKUS.markLock - 0.05, duration: VARKUS.markTime }];
    p.frame(input(w));
    expect(rimThickness()).toEqual([1]);
    w.areas = [{ id: encodeAreaId(2, 0, 0), kind: 'executionMark', x: 0, y: 0, radius: 36, age: VARKUS.markLock + 0.05, duration: VARKUS.markTime }];
    p.frame(input(w));
    expect(rimThickness()).toEqual([2]);
  });

  it("the mark's brand flash lands where the mark is when it lands, not where it appeared", () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    const mark = { id: encodeAreaId(3, 0, 0), kind: 'executionMark' as const, x: 0, y: 0, radius: 36, age: 0.05, duration: 3 };
    w.areas = [mark];
    const FLASH: readonly number[] = [1, 0.16, 0.1];
    const flashes: number[] = [];
    for (let i = 0; i < 60; i++) {
      p.frame(input(w));
      mark.x = Math.min(60, mark.x + 6); // she runs; the mark follows
      mark.age += 1 / 60;
      for (const s of r.frameShapes) if (s.kind === 'ring' && s.radius > 36 && near(s.color, FLASH)) flashes.push(s.x);
    }
    expect(flashes.length).toBeGreaterThan(0);
    expect(flashes[0]).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('lobs and hooks', () => {
  function lobWorld(): WorldView {
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    const pr = w.projectiles;
    pr.alive[0] = 1;
    pr.id[0] = (1 << 16) | 0;
    pr.kind[0] = PROJECTILE_KINDS.indexOf('tarGlob');
    pr.hostile[0] = 1;
    pr.x[0] = pr.prevX[0] = -60;
    pr.y[0] = pr.prevY[0] = 0;
    pr.vx[0] = 100;
    pr.vy[0] = 0;
    pr.age[0] = 0.6;
    pr.life[0] = 1.2;
    pr.count = 1;
    return w;
  }

  it('the tar landing marker covers the pool it leaves, with the splash filling inside', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    p.frame(input(lobWorld()));
    // Lands at x = −60 + 100·0.6 = 0.
    const at = r.frameShapes.filter((s) => Math.abs(s.x) < 1e-3 && Math.abs(s.y) < 1e-3 && (s.kind === 'ring' || s.kind === 'circle'));
    expect(at.some((s) => s.kind === 'circle' && s.radius === TAR_POOL_RADIUS)).toBe(true);
    expect(at.some((s) => s.kind === 'ring' && s.radius === TAR_POOL_RADIUS)).toBe(true);
    expect(at.some((s) => s.kind === 'ring' && s.radius === TAR_SPLASH_RADIUS)).toBe(true);
    expect(Math.max(...at.map((s) => s.radius))).toBe(TAR_POOL_RADIUS);
  });

  function hookWorld(): WorldView {
    const w = emptyWorld([player(1, -200, 0, { vx: 0, prevX: -200 })]);
    addMonster(w, 0, kind('chainThrall'), RARITY_CODE.normal, 110, 0, 8);
    w.monsters.anim[0] = MONSTER_ANIM.attack;
    const pr = w.projectiles;
    pr.alive[0] = 1;
    pr.id[0] = (3 << 16) | 0;
    pr.kind[0] = PROJECTILE_KINDS.indexOf('chainHook');
    pr.hostile[0] = 1;
    pr.x[0] = pr.prevX[0] = 0;
    pr.y[0] = pr.prevY[0] = 0;
    pr.vx[0] = -320;
    pr.vy[0] = 0;
    pr.age[0] = 0.3; // launched from x = 96, just in front of him
    pr.count = 1;
    return w;
  }

  const chainExtent = (r: RecordingRenderer) => {
    const links = r.frameSprites.filter((s) => s.id === 'fx/chain');
    return { n: links.length, maxX: Math.max(...links.map((l) => l.x)), maxY: Math.max(...links.map((l) => l.y)) };
  };

  it('the chain hangs from its thrower and stays on him when he is shoved', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = hookWorld();
    p.frame(input(w));
    const a = chainExtent(r);
    expect(a.n).toBeGreaterThan(8);
    expect(a.maxX).toBeGreaterThan(90);
    // Shoved 40 units south mid-flight: the chain follows him.
    w.monsters.y[0] = w.monsters.prevY[0] = 40;
    p.frame(input(w));
    expect(chainExtent(r).maxY).toBeGreaterThan(20);
  });

  it('a hook that misses reels back; one that caught someone leaves the chain to the pull', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = hookWorld();
    p.frame(input(w));
    w.projectiles.alive[0] = 0;
    w.projectiles.count = 0;
    p.frame(input(w));
    expect(chainExtent(r).n).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) p.frame(input(w));
    expect(chainExtent(r).n).toBe(0);

    // Caught: the pull's tether is the only chain.
    const r2 = new RecordingRenderer();
    const p2 = createPresenter(r2, art(), new RecordingAudio());
    const w2 = hookWorld();
    w2.players[0] = player(1, -8, 0, { vx: 0, prevX: -8 });
    p2.frame(input(w2));
    w2.projectiles.alive[0] = 0;
    w2.projectiles.count = 0;
    p2.frame(input(w2, [{ t: 'pull', playerId: 1, fromX: -8, fromY: 0, toX: 30, toY: 0 }]));
    const links = r2.frameSprites.filter((s) => s.id === 'fx/chain');
    // One chain from him to her (~110 units of links), not two.
    const span = 118 / 8;
    expect(links.length).toBeLessThan(span * 1.5);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('player debuffs', () => {
  it('a frozen caster never turns inside the ice, whatever the cursor does', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const me = player(1, 0, 0, { anim: 'cast', castSkill: 'flameWave', castProgress: 0.5, vx: 0, prevX: 0, aimX: 80, aimY: 0 });
    const w = emptyWorld([me]);
    p.frame(input(w));
    me.debuffs = [debuff('frozen', { remaining: 1, duration: 1 })];
    const flips = new Set<boolean>();
    const overlayFlips = new Set<boolean>();
    for (let i = 0; i < 20; i++) {
      me.aimX = i % 2 ? -80 : 80;
      me.aimY = i % 3 ? -60 : 60;
      p.frame(input(w));
      flips.add(r.frameSprites.find((s) => s.id.startsWith('sorceress/'))!.flipX);
      for (const s of r.frameSprites) if (s.id === 'fx/debuff/frozen') overlayFlips.add(s.flipX);
    }
    expect(flips.size).toBe(1);
    expect(overlayFlips.size).toBe(1);
  });

  it('share one light budget; withered goes dark under a burn; stacked glows dim', () => {
    const burnWither = debuffMask([debuff('burning'), debuff('withered', { stacks: 3 })]);
    expect(debuffLightWant('withered', 3, burnWither)).toBe(0);
    expect(debuffLightWant('withered', 3, debuffMask([debuff('withered')]))).toBeCloseTo(0.36, 6);
    const all = debuffMask(['burning', 'shocked', 'frozen', 'withered'].map((d) => debuff(d as PlayerDebuff)));
    const want = ['burning', 'shocked', 'frozen'].reduce((s, d) => s + debuffLightWant(d as PlayerDebuff, 1, all), 0);
    expect(want * debuffLightScale(want)).toBeCloseTo(DEBUFF_LIGHT_BUDGET, 6);
    expect(debuffLightScale(0.2)).toBe(1);
    expect(glowStackFactor(debuffMask([debuff('burning')]))).toBe(1);
    expect(glowStackFactor(debuffMask([debuff('burning'), debuff('chilled'), debuff('bleeding')]))).toBe(1);
    expect(glowStackFactor(burnWither)).toBe(STACKED_GLOW_ALPHA);
  });

  it('a burning, withered, shocked sorceress keeps her silhouette: debuff lights within budget, glows dimmed', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const list = [debuff('burning'), debuff('withered', { stacks: 3 }), debuff('shocked')];
    const bare = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0, debuffs: list })]);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.1); // the shock light at full jolt
    try {
      for (let i = 0; i < 3; i++) p.frame(input(bare));
      const base = r.frameLights.reduce((s, l) => s + l.intensity, 0);
      for (let i = 0; i < 20; i++) p.frame(input(w));
      const withDebuffs = r.frameLights.reduce((s, l) => s + l.intensity, 0);
      expect(withDebuffs - base).toBeLessThanOrEqual(DEBUFF_LIGHT_BUDGET + 1e-6);
      expect(withDebuffs - base).toBeGreaterThan(0.2);
    } finally {
      random.mockRestore();
    }
    const burn = r.frameSprites.find((s) => s.id === 'fx/debuff/burning')!;
    expect(burn.alpha).toBeCloseTo(STACKED_GLOW_ALPHA, 3);
    const wither = r.frameSprites.find((s) => s.id === 'fx/debuff/withered')!;
    expect(wither.alpha).toBeCloseTo(STACKED_GLOW_ALPHA * WITHER_UNDER_BURN, 3);
  });

  it('pops only when a debuff is new or its stacks rose; stacks that ran down re-arm it', () => {
    const painter = new DebuffPainter(new Effects(() => 0));
    const pen = {} as Pen;
    const f = { time: 0 } as FrameCtx;
    const me: PlayerView = player(1, 0, 0);
    const frame = (t: number, list: PlayerDebuffView[]): void => {
      f.time = t;
      me.debuffs = list;
      painter.update(pen, f, me, 0, 0);
    };
    expect(painter.shouldPop(1, 'chilled', 1, 0)).toBe(true);
    frame(0.02, [debuff('chilled')]);
    expect(painter.shouldPop(1, 'chilled', 1, 1)).toBe(false); // the sim's once-a-second refresh
    frame(1.02, [debuff('chilled')]);
    frame(1.5, []); // ran out
    expect(painter.shouldPop(1, 'chilled', 1, 2)).toBe(true);
    // Bleeding 1 → 2 → 3 pops each time; a stack runs out (3 → 2), and the next third stack pops again.
    expect(painter.shouldPop(1, 'bleeding', 1, 3)).toBe(true);
    expect(painter.shouldPop(1, 'bleeding', 2, 3.1)).toBe(true);
    expect(painter.shouldPop(1, 'bleeding', 3, 3.2)).toBe(true);
    frame(3.25, [debuff('bleeding', { stacks: 3 })]);
    expect(painter.shouldPop(1, 'bleeding', 3, 3.3)).toBe(false);
    frame(4.5, [debuff('bleeding', { stacks: 2 })]);
    expect(painter.shouldPop(1, 'bleeding', 3, 4.6)).toBe(true);
    // Another player's debuffs are their own; a cleanse re-arms.
    expect(painter.shouldPop(2, 'chilled', 1, 5)).toBe(true);
    painter.cleansed(2, ['chilled']);
    expect(painter.shouldPop(2, 'chilled', 1, 5.1)).toBe(true);
  });

  it('a refresh gets a shimmer, not a second pop ring', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0, debuffs: [debuff('shocked')] })]);
    const ev: SimEvent = { t: 'debuff', playerId: 1, debuff: 'shocked', stacks: 1, x: 0, y: 0 };
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.999); // no ambient sparks
    try {
      p.frame(input(w, [ev]));
      const popped = r.particles;
      p.frame(input(w));
      const idle = r.particles - popped;
      const before = r.particles;
      p.frame(input(w, [ev]));
      const refreshed = r.particles - before;
      expect(popped).toBeGreaterThanOrEqual(6);
      expect(refreshed - idle).toBeLessThanOrEqual(2);
    } finally {
      random.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('burn and bleed ticks', () => {
  const hit = (over: Partial<Extract<SimEvent, { t: 'hit' }>> = {}): Extract<SimEvent, { t: 'hit' }> => ({
    t: 'hit', playerId: 1, x: 0, y: 0, amount: 2, damageType: 'fire', crit: false, target: 'player', killed: false, ...over,
  });

  it('are told apart from blows by type, debuff, size and crit', () => {
    const burning = [debuff('burning')];
    expect(isDotTick(hit(), burning, 0, 100)).toBe(true);
    expect(isDotTick(hit({ amount: DOT_TICK_MAX_FRACTION * 100 + 0.1 }), burning, 0, 100)).toBe(false);
    expect(isDotTick(hit({ crit: true }), burning, 0, 100)).toBe(false);
    expect(isDotTick(hit({ damageType: 'cold' }), burning, 0, 100)).toBe(false);
    expect(isDotTick(hit({ damageType: 'physical' }), burning, 0, 100)).toBe(false);
    expect(isDotTick(hit({ damageType: 'physical' }), [debuff('bleeding')], 0, 100)).toBe(true);
    expect(isDotTick(hit({ target: 'monster' }), burning, 0, 100)).toBe(false);
    // The final tick arrives as the burn leaves the view: last frame's mask still counts.
    expect(isDotTick(hit(), [], debuffMask(burning), 100)).toBe(true);
    expect(isDotTick(hit(), [], 0, 100)).toBe(false);
  });

  it('sound: a soft tick of the damage type for the local player, silence for allies, never a grunt', () => {
    const calls: { id: string; volume: number }[] = [];
    const d = new SoundDirector((id, _x, _y, volume) => calls.push({ id, volume }), () => 0.5);
    d.beginFrame(0);
    d.handle(hit(), 1, true);
    d.handle(hit({ playerId: 2 }), 1, true);
    expect(calls).toEqual([{ id: 'hitFire', volume: DOT_TICK_VOLUME }]);
    d.handle(hit({ amount: 30 }), 1, false);
    expect(calls.map((c) => c.id)).toEqual(['hitFire', 'playerHurt']);
  });

  it('sound: a bleed that ran down from 3 stacks to 2 voices its next third stack', () => {
    const calls: { id: string; pitch: number }[] = [];
    const d = new SoundDirector((id, _x, _y, _v, pitch) => calls.push({ id, pitch }), () => 0.5);
    const bleed = (stacks: number, t: number): void => {
      d.beginFrame(t);
      d.handle({ t: 'debuff', playerId: 1, debuff: 'bleeding', stacks, x: 0, y: 0 }, 1);
      d.syncLocalDebuffs([debuff('bleeding', { stacks })]);
    };
    bleed(1, 0);
    bleed(2, 0.5);
    bleed(3, 1);
    bleed(3, 2); // refreshed at 3: silent
    d.beginFrame(4);
    d.syncLocalDebuffs([debuff('bleeding', { stacks: 2 })]); // the oldest stack ran out
    bleed(3, 4.5);
    expect(calls.map((c) => c.id)).toEqual(['debuffBleed', 'debuffBleed', 'debuffBleed', 'debuffBleed']);
    expect(calls[3].pitch).toBeCloseTo(1.12, 6);
    // A view lagging the event stream never re-arms it early.
    d.beginFrame(4.6);
    d.syncLocalDebuffs([debuff('bleeding', { stacks: 2 })]);
    bleed(3, 4.7);
    expect(calls).toHaveLength(4);
  });

  it('presenter: a burn tick is a small ember-coloured number with no grunt and no hurt flash', () => {
    const r = new RecordingRenderer();
    const audio = new RecordingAudio();
    const p = createPresenter(r, art(), audio);
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0, debuffs: [debuff('burning')] })]);
    p.frame(input(w));
    p.frame(input(w, [hit({ amount: 2 })]));
    expect(audio.plays.some((c) => c.id === 'playerHurt')).toBe(false);
    const n = r.frameTexts.find((t) => t.text === '2')!;
    expect(n).toBeDefined();
    expect(n.color![0]).toBeCloseTo(1, 3);
    expect(n.color![1]).toBeGreaterThan(0.5);
    expect(n.alpha).toBeLessThan(1);
    expect(r.lastPost?.flash?.alpha ?? 0).toBe(0);
    // A real blow still grunts.
    p.frame(input(w, [hit({ amount: 20 })]));
    expect(audio.plays.some((c) => c.id === 'playerHurt')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('boss presence in the air', () => {
  it("Varkus's lights fly with him on his leap", () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    w.theme = 'ironColiseum';
    addMonster(w, 0, kind('varkus'), RARITY_CODE.boss, 60, 40, 20);
    // His presence light and the shield boss's hot light (by their radii).
    const at = (radius: number): number => r.frameLights.find((l) => l.radius === radius)!.y;
    p.frame(input(w));
    const main = at(PRESENCE_VARKUS.radius);
    const hot = at(PRESENCE_VARKUS.hotRadius);
    w.monsters.anim[0] = MONSTER_ANIM.leap;
    w.monsters.animTime[0] = LEAP_ARC.varkus!.flight / 2; // the apex
    p.frame(input(w));
    expect(main - at(PRESENCE_VARKUS.radius)).toBeCloseTo(LEAP_ARC.varkus!.height, 3);
    expect(hot - at(PRESENCE_VARKUS.hotRadius)).toBeGreaterThan(LEAP_ARC.varkus!.height * 0.8);
  });
});
