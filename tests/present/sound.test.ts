import { describe, expect, it } from 'vitest';
import type { SfxId } from '../../src/contracts/audio';
import { SFX_IDS } from '../../src/contracts/audio';
import type { SimEvent } from '../../src/contracts/sim';
import { RARITY_CODE } from '../../src/contracts/sim';
import { ALLY_VOLUME, CAST_SFX, DROP_SFX, HIT_SFX, SFX_LIMITS, SoundDirector } from '../../src/present/sound';

interface Call { id: SfxId; x?: number; y?: number; volume: number; pitch: number }

function director(): { d: SoundDirector; calls: Call[] } {
  const calls: Call[] = [];
  const d = new SoundDirector((id, x, y, volume, pitch) => calls.push({ id, x, y, volume, pitch }), () => 0.5);
  d.beginFrame(0);
  return { d, calls };
}

const LOCAL = 1;
const ALLY = 2;

describe('SoundDirector event mapping', () => {
  it('maps every table entry to a real sfx id', () => {
    const ids = new Set<string>(SFX_IDS);
    for (const v of Object.values(CAST_SFX)) if (v) expect(ids.has(v)).toBe(true);
    for (const v of Object.values(HIT_SFX)) expect(ids.has(v)).toBe(true);
    for (const v of Object.values(DROP_SFX)) expect(ids.has(v)).toBe(true);
    for (const k of Object.keys(SFX_LIMITS)) expect(ids.has(k)).toBe(true);
  });

  it('plays the local player\'s casts centred and loud, allies\' positional and quieter', () => {
    const { d, calls } = director();
    d.handle({ t: 'cast', playerId: LOCAL, skill: 'flameWave', x: 10, y: 20, dirX: 1, dirY: 0 }, LOCAL);
    d.handle({ t: 'cast', playerId: ALLY, skill: 'rimeShards', x: 50, y: 60, dirX: 1, dirY: 0 }, LOCAL);
    expect(calls[0]).toMatchObject({ id: 'castWave', x: undefined, y: undefined, volume: 1 });
    expect(calls[1]).toMatchObject({ id: 'castFrost', x: 50, y: 60, volume: ALLY_VOLUME });
  });

  it('voices Ember Nova once per nova (echoes included), never on the cast', () => {
    const { d, calls } = director();
    d.handle({ t: 'cast', playerId: LOCAL, skill: 'emberNova', x: 0, y: 0, dirX: 1, dirY: 0 }, LOCAL);
    d.handle({ t: 'nova', playerId: LOCAL, skill: 'emberNova', x: 0, y: 0, radius: 170 }, LOCAL);
    d.beginFrame(0.4);
    d.handle({ t: 'nova', playerId: LOCAL, skill: 'emberNova', x: 0, y: 0, radius: 170 }, LOCAL); // the echo
    expect(calls.map((c) => c.id)).toEqual(['castNova', 'castNova']);
  });

  it('voices Rift Step through its dash event, not the cast', () => {
    const { d, calls } = director();
    d.handle({ t: 'cast', playerId: LOCAL, skill: 'riftStep', x: 0, y: 0, dirX: 1, dirY: 0 }, LOCAL);
    expect(calls).toHaveLength(0);
    d.handle({ t: 'dash', playerId: LOCAL, fromX: 0, fromY: 0, toX: 90, toY: 0 }, LOCAL);
    expect(calls.map((c) => c.id)).toEqual(['dash']);
  });

  it('plays damage-type hit sounds, crits only for your own hits, and hurt sounds for players', () => {
    const { d, calls } = director();
    const hit = (playerId: number, crit: boolean, damageType: 'fire' | 'cold' | 'lightning' | 'void' | 'physical'): SimEvent => ({
      t: 'hit', playerId, x: 5, y: 5, amount: 10, damageType, crit, target: 'monster', killed: false,
    });
    d.handle(hit(LOCAL, true, 'fire'), LOCAL);
    d.handle(hit(ALLY, true, 'cold'), LOCAL);
    d.handle({ t: 'hit', playerId: LOCAL, x: 0, y: 0, amount: 30, damageType: 'physical', crit: false, target: 'player', killed: false }, LOCAL);
    expect(calls.map((c) => c.id)).toEqual(['hitFire', 'crit', 'hitCold', 'playerHurt']);
    expect(calls[3].x).toBeUndefined();
  });

  it('only the owner hears their drops and pickups (instanced loot)', () => {
    const { d, calls } = director();
    d.handle({ t: 'dropSpawn', owner: ALLY, tone: 'unique', x: 0, y: 0, label: 'x' }, LOCAL);
    d.handle({ t: 'pickup', owner: ALLY, playerId: ALLY, tone: 'rare', x: 0, y: 0, label: 'x' }, LOCAL);
    expect(calls).toHaveLength(0);
    d.handle({ t: 'dropSpawn', owner: LOCAL, tone: 'unique', x: 3, y: 4, label: 'x' }, LOCAL);
    d.handle({ t: 'pickup', owner: LOCAL, playerId: LOCAL, tone: 'currency', x: 3, y: 4, label: 'x' }, LOCAL);
    expect(calls.map((c) => c.id)).toEqual(['dropUnique', 'pickupCurrency']);
  });

  it('public drops: a soft thud for everyone, pickup sounds only for the one who picked it up', () => {
    const { d, calls } = director();
    d.handle({ t: 'dropSpawn', owner: 0, tone: 'unique', x: 30, y: 40, label: 'x' }, LOCAL);
    expect(calls).toHaveLength(1);
    // Never the rarity fanfare: a quiet, positional thud.
    expect(calls[0].id).toBe('dropNormal');
    expect(calls[0].x).toBe(30);
    expect(calls[0].volume).toBeLessThan(1);
    calls.length = 0;
    // An ally lifts it: silence here (the presenter shows a poof).
    d.handle({ t: 'pickup', owner: 0, playerId: ALLY, tone: 'rare', x: 0, y: 0, label: 'x' }, LOCAL);
    expect(calls).toHaveLength(0);
    // We lift one: our pickup sound, centred.
    d.handle({ t: 'pickup', owner: 0, playerId: LOCAL, tone: 'rare', x: 3, y: 4, label: 'x' }, LOCAL);
    expect(calls.map((c) => c.id)).toEqual(['pickupItem']);
    expect(calls[0].x).toBeUndefined();
  });

  it('distinguishes big and small deaths, boss slams and monster attacks', () => {
    const { d, calls } = director();
    d.handle({ t: 'death', kind: 'ashling', rarity: RARITY_CODE.normal, x: 0, y: 0, facing: 1, damageType: 'fire' }, LOCAL);
    d.handle({ t: 'death', kind: 'ashling', rarity: RARITY_CODE.rare, x: 0, y: 0, facing: 1, damageType: 'fire' }, LOCAL);
    d.handle({ t: 'areaResolve', kind: 'slamWarning', x: 0, y: 0, radius: 70 }, LOCAL);
    d.handle({ t: 'areaResolve', kind: 'slamWarning', x: 0, y: 0, radius: 42 }, LOCAL);
    d.handle({ t: 'monsterAttack', kind: 'cinderSpitter', x: 0, y: 0, attack: 'spit' }, LOCAL);
    expect(calls.map((c) => c.id)).toEqual(['monsterDeath', 'monsterDeathBig', 'bossSlam', 'monsterSlam', 'monsterSpit']);
  });

  it('gives ailments a soft positional cue', () => {
    const { d, calls } = director();
    d.handle({ t: 'ailment', ailment: 'chilled', x: 7, y: 8 }, LOCAL);
    expect(calls[0]).toMatchObject({ id: 'hitCold', x: 7, y: 8 });
    expect(calls[0].volume).toBeLessThan(0.5);
  });

  it('keeps run-flow sounds un-positioned and ignores visual-only events', () => {
    const { d, calls } = director();
    d.handle({ t: 'waveTell', wave: 2, families: ['ashling'], lieutenant: false, boss: false }, LOCAL);
    d.handle({ t: 'bossSpawn', x: 100, y: 100 }, LOCAL);
    d.handle({ t: 'chain', playerId: LOCAL, points: [0, 0, 10, 10], damageType: 'lightning' }, LOCAL);
    d.handle({ t: 'ward', playerId: LOCAL, x: 0, y: 0, duration: 4 }, LOCAL);
    expect(calls.map((c) => c.id)).toEqual(['waveTell', 'bossSpawn']);
    expect(calls.every((c) => c.x === undefined)).toBe(true);
  });

  it('greets allies joining but not yourself', () => {
    const { d, calls } = director();
    d.handle({ t: 'playerJoin', playerId: LOCAL, x: 0, y: 0 }, LOCAL);
    d.handle({ t: 'playerJoin', playerId: ALLY, x: 0, y: 0 }, LOCAL);
    expect(calls.map((c) => c.id)).toEqual(['allyJoin']);
  });
});

describe('SoundDirector throttling', () => {
  it('caps calls per id per frame and resets on the next frame', () => {
    const { d, calls } = director();
    const e: SimEvent = { t: 'hit', playerId: LOCAL, x: 0, y: 0, amount: 5, damageType: 'fire', crit: false, target: 'monster', killed: false };
    for (let i = 0; i < 100; i++) d.handle(e, LOCAL);
    const cap = SFX_LIMITS.hitFire!.perFrame;
    expect(calls.filter((c) => c.id === 'hitFire')).toHaveLength(cap);
    d.beginFrame(1 / 60);
    d.handle(e, LOCAL);
    expect(calls.filter((c) => c.id === 'hitFire')).toHaveLength(cap + 1);
  });

  it('enforces the minimum interval across frames', () => {
    const { d, calls } = director();
    const e: SimEvent = { t: 'monsterAttack', kind: 'ashling', x: 0, y: 0, attack: 'melee' };
    const interval = SFX_LIMITS.monsterAttack!.interval;
    let t = 0;
    for (let frame = 0; frame < 60; frame++) {
      d.beginFrame(t);
      d.handle(e, LOCAL);
      t += 1 / 60;
    }
    const n = calls.length;
    // One second of attacks every frame → at most ~1/interval plays.
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThanOrEqual(Math.ceil(1 / interval) + 1);
  });

  it('play() reports whether the sink was called', () => {
    const { d } = director();
    expect(d.play('notEnoughFocus')).toBe(true);
    expect(d.play('notEnoughFocus')).toBe(false);
  });
});
