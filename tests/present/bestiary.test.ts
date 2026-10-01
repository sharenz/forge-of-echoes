// The Rimed Ossuary / Iron Coliseum presentation (GAME_SPEC §13–§14): pure geometry and look helpers, the sound
// cue map (src/audio/index.ts header) and the presenter drawing every new monster, action set, projectile, area,
// event and player debuff against the recording renderer.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ArtBundle, SpriteDef } from '../../src/contracts/art';
import { SFX_IDS, type SfxId } from '../../src/contracts/audio';
import { NEW_AREA_KINDS, NEW_MONSTER_KINDS, NEW_PROJECTILE_KINDS, PLAYER_DEBUFFS } from '../../src/contracts/bestiary';
import { MONSTER_KINDS, type MonsterKind } from '../../src/contracts/content';
import type { PresentInput } from '../../src/contracts/present';
import {
  MONSTER_ANIM, PROJECTILE_KINDS, RARITY_CODE, type AreaKind, type AreaView, type PlayerDebuffView, type SimEvent, type WorldView,
} from '../../src/contracts/sim';
import { DEBUFF_PLAYER_TINT, generateSprites } from '../../src/art';
import { createPresenter } from '../../src/present';
import {
  ACTION_SPRITES, choirArcs, isLobKind, laneDistance, laneOf, lobHeight, MONSTER_LOOKS, prisonEndRadius, prisonStartRadius, type Lane,
} from '../../src/present/bestiary';
import { DEBUFF_DRAW_ORDER, debuffMask, debuffTint, overlayAlpha } from '../../src/present/debuffs';
import { MARKER_NAMES, MONSTER_NAMES } from '../../src/present/names';
import {
  BLIZZARD_GUST, CHAIN_SPIN, DEBUFF_SFX, SFX_LIMITS, SoundDirector, SPIKE_GAP, VARKUS_SPIN,
} from '../../src/present/sound';
import { hotspot } from '../../src/present/sprites';
import { chargeLineEnd, encodeAreaId, inChoirGap, ICE_PRISON_END_FRACTION } from '../../src/sim/area-geometry';
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

function area(id: number, k: AreaKind, x: number, y: number, radius: number, age: number, duration: number): AreaView {
  return { id, kind: k, x, y, radius, age, duration };
}

// ---------------------------------------------------------------------------------------------------------------

describe('bestiary tables', () => {
  it('names, looks and marker labels cover every new kind', () => {
    for (const k of NEW_MONSTER_KINDS) {
      expect(MONSTER_NAMES[k], k).toBeTruthy();
      expect(MONSTER_LOOKS[k], k).toBeDefined();
    }
    for (const k of ['boneChorister', 'hollowWarden', 'chainmaster', 'varkus'] as const) expect(MARKER_NAMES[k]).toBeTruthy();
    expect(MONSTER_LOOKS.rimeshade.ghost).toBe(true);
    expect(MONSTER_LOOKS.hollowWarden.presence).not.toBeNull();
    expect(MONSTER_LOOKS.varkus.presence).not.toBeNull();
  });

  it('every special action set names a sprite the art provides', () => {
    const ids = new Set(sprites.map((s) => s.id));
    for (const [k, acts] of Object.entries(ACTION_SPRITES)) {
      for (const act of Object.values(acts ?? {})) expect(ids.has(`monster/${k}/${act!.name}`), `${k}/${act!.name}`).toBe(true);
    }
    for (const id of ['monster/varkus/charge', 'monster/varkus/whirl', 'monster/chainmaster/whirl', 'monster/shieldbearer/block']) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("choir arcs leave exactly the sim's gaps open", () => {
    const out = new Float32Array(16);
    for (const variant of [0, 1, 2, 3]) {
      const a = { id: encodeAreaId(5, 1.1, variant) };
      const n = choirArcs(a, out);
      expect(n).toBe(variant + 1);
      // Probe the circle: a direction is inside a drawn arc exactly when it is not in a gap.
      for (let s = 0; s < 360; s++) {
        const ang = (s / 360) * Math.PI * 2;
        let drawn = false;
        for (let k = 0; k < n; k++) {
          let rel = ang - out[k * 2];
          rel -= Math.floor(rel / (Math.PI * 2)) * Math.PI * 2;
          if (rel <= out[k * 2 + 1] - out[k * 2]) drawn = true;
        }
        // Allow the probe to straddle a gap edge.
        const nearEdge = [...Array(n * 2).keys()].some((j) => {
          let d = Math.abs(ang - out[j]) % (Math.PI * 2);
          if (d > Math.PI) d = Math.PI * 2 - d;
          return d < 0.02;
        });
        if (!nearEdge) expect(drawn, `variant ${variant} angle ${s}`).toBe(!inChoirGap(a, ang));
      }
    }
  });

  it("recovers the ice prison's start and snap radii from its current radius", () => {
    const start = 46;
    for (const close of [0, 0.3, 0.75, 1]) {
      const r = start * (1 - (1 - ICE_PRISON_END_FRACTION) * close);
      expect(prisonStartRadius(r, close)).toBeCloseTo(start, 6);
      expect(prisonEndRadius(r, close)).toBeCloseTo(start * ICE_PRISON_END_FRACTION, 6);
    }
  });

  it('reads charge lanes like the sim: start, heading, length, half-width; variant 0 is the aim line', () => {
    const l: Lane = { x0: 0, y0: 0, ux: 1, uy: 0, len: 0, half: 0, aim: false };
    const a = { id: encodeAreaId(9, 0.6, 2), x: 10, y: 20, radius: 200 };
    laneOf(a, l);
    const end = chargeLineEnd(a);
    expect(l.x0 + l.ux * l.len).toBeCloseTo(end.x, 6);
    expect(l.y0 + l.uy * l.len).toBeCloseTo(end.y, 6);
    expect(l.aim).toBe(false);
    expect(l.half).toBe(22);
    expect(laneDistance(l, end.x, end.y).d).toBeCloseTo(0, 6);
    expect(laneOf({ ...a, id: encodeAreaId(9, 0.6, 0) }, l).aim).toBe(true);
  });

  it('lobs: tar and spit arc, everything else flies flat', () => {
    for (const k of PROJECTILE_KINDS) expect(isLobKind(k)).toBe(k === 'cinderSpit' || k === 'tarGlob');
    expect(lobHeight(0, 40)).toBe(0);
    expect(lobHeight(0.5, 40)).toBe(40);
    expect(lobHeight(1, 40)).toBe(0);
  });

  it('finds the densest emissive cluster (the lantern, not a stray eye pixel)', () => {
    const w = 20;
    const h = 20;
    const d = new Uint8ClampedArray(w * h * 4);
    const hot = (x: number, y: number, a = 255) => (d[(y * w + x) * 4 + 3] = a);
    hot(2, 2); // a lone bright pixel
    for (let y = 12; y <= 14; y++) for (let x = 14; x <= 16; x++) hot(x, y);
    const c = hotspot(d, w, h)!;
    expect(c.x).toBeCloseTo(15, 5);
    expect(c.y).toBeCloseTo(13, 5);
    expect(hotspot(new Uint8ClampedArray(w * h * 4), w, h)).toBeNull();
  });
});

describe('player debuff look', () => {
  it('tints her for chilled, harder for frozen, and fades the tint', () => {
    const out: [number, number, number] = [1, 1, 1];
    expect(debuffTint([debuff('burning')], out)).toBeNull();
    expect(debuffTint([debuff('chilled')], out)).toEqual([...DEBUFF_PLAYER_TINT.chilled!]);
    expect(debuffTint([debuff('chilled'), debuff('frozen')], out)).toEqual([...DEBUFF_PLAYER_TINT.frozen!]);
    const half = debuffTint([debuff('frozen')], out, 0.5)!;
    expect(half[0]).toBeCloseTo(1 + (DEBUFF_PLAYER_TINT.frozen![0] - 1) * 0.5, 6);
  });

  it('fades overlays in and out and draws the ice block last', () => {
    expect(overlayAlpha(0, 2)).toBe(0);
    expect(overlayAlpha(1, 2)).toBe(1);
    expect(overlayAlpha(1, 0.1)).toBeLessThan(1);
    expect(DEBUFF_DRAW_ORDER[DEBUFF_DRAW_ORDER.length - 1]).toBe('frozen');
    expect(DEBUFF_DRAW_ORDER[0]).toBe('rooted');
    expect([...DEBUFF_DRAW_ORDER].sort()).toEqual([...PLAYER_DEBUFFS].sort());
    expect(debuffMask([debuff('chilled'), debuff('withered')])).toBe(1 | (1 << PLAYER_DEBUFFS.indexOf('withered')));
  });
});

// ---------------------------------------------------------------------------------------------------------------

interface Call { id: SfxId; x?: number; y?: number; volume: number; pitch: number }
const LOCAL = 1;
const ALLY = 2;

function director(): { d: SoundDirector; calls: Call[] } {
  const calls: Call[] = [];
  const d = new SoundDirector((id, x, y, volume, pitch) => calls.push({ id, x, y, volume, pitch }), () => 0.5);
  d.beginFrame(0);
  return { d, calls };
}

describe('bestiary sound cues', () => {
  it('every new table entry names a real sfx id', () => {
    const ids = new Set<string>(SFX_IDS);
    for (const v of Object.values(DEBUFF_SFX)) expect(ids.has(v)).toBe(true);
    for (const k of Object.keys(SFX_LIMITS)) expect(ids.has(k), k).toBe(true);
  });

  it('voices a debuff once when it takes hold on the local player, never on refreshes, and not for allies', () => {
    const { d, calls } = director();
    const ev = (playerId: number, id: PlayerDebuffView['id'], stacks = 1): SimEvent => ({ t: 'debuff', playerId, debuff: id, stacks, x: 0, y: 0 });
    d.handle(ev(LOCAL, 'chilled'), LOCAL);
    d.handle(ev(ALLY, 'frozen'), LOCAL);
    d.syncLocalDebuffs([debuff('chilled')]);
    d.beginFrame(1);
    d.handle(ev(LOCAL, 'chilled'), LOCAL); // the sim's once-a-second refresh
    d.syncLocalDebuffs([debuff('chilled')]);
    expect(calls.map((c) => c.id)).toEqual(['debuffChill']);
    expect(calls[0].x).toBeUndefined();
    // It ran out; the next chill sounds again.
    d.beginFrame(2);
    d.syncLocalDebuffs([]);
    d.beginFrame(3);
    d.handle(ev(LOCAL, 'chilled'), LOCAL);
    expect(calls.map((c) => c.id)).toEqual(['debuffChill', 'debuffChill']);
  });

  it('plays debuffBleed once per new stack, rising 6% per stack', () => {
    const { d, calls } = director();
    for (const stacks of [1, 2, 2, 3]) {
      d.handle({ t: 'debuff', playerId: LOCAL, debuff: 'bleeding', stacks, x: 0, y: 0 }, LOCAL);
      d.syncLocalDebuffs([debuff('bleeding', { stacks })]);
      d.beginFrame(stacks);
    }
    expect(calls.map((c) => c.id)).toEqual(['debuffBleed', 'debuffBleed', 'debuffBleed']);
    expect(calls.map((c) => c.pitch)).toEqual([1, 1.06, 1.12]);
  });

  it('cleanse chimes for the local player only', () => {
    const { d, calls } = director();
    d.handle({ t: 'cleanse', playerId: ALLY, debuffs: ['burning'], x: 0, y: 0 }, LOCAL);
    d.handle({ t: 'cleanse', playerId: LOCAL, debuffs: ['burning', 'bleeding'], x: 0, y: 0 }, LOCAL);
    expect(calls.map((c) => c.id)).toEqual(['debuffCleanse']);
  });

  it('maps the roster attacks per the cue map', () => {
    const { d, calls } = director();
    const at = (k: MonsterKind, attack: Extract<SimEvent, { t: 'monsterAttack' }>['attack']): void => {
      d.beginFrame(calls.length + 1);
      d.handle({ t: 'monsterAttack', kind: k, x: 5, y: 6, attack }, LOCAL);
    };
    at('boneThrall', 'melee');
    at('rimeshade', 'melee');
    at('frostWeaver', 'web');
    at('glacialWisp', 'pulse');
    at('glacialWisp', 'burst');
    at('ossuaryGolem', 'slam');
    at('boneChorister', 'sing');
    at('hollowWarden', 'nova');
    at('pitHound', 'melee');
    at('chainThrall', 'hook');
    at('ironCrossbowman', 'aim');
    at('ironCrossbowman', 'bolt');
    at('varkus', 'spikes');
    expect(calls.map((c) => c.id)).toEqual([
      'boneRattle', 'ghostWail', 'webShot', 'wispPulse', 'wispBurst', 'golemSlam', 'choirSing', 'wardenNova', 'houndBite', 'chainThrow',
      'crossbowAim', 'crossbowShot', 'crowdRoar',
    ]);
    expect(calls.every((c) => c.x === 5 && c.y === 6)).toBe(true);
    // A shield bash is a shield hit and a strike.
    calls.length = 0;
    d.beginFrame(100);
    d.handle({ t: 'monsterAttack', kind: 'shieldbearer', x: 0, y: 0, attack: 'bash' }, LOCAL);
    expect(calls.map((c) => c.id)).toEqual(['shieldBlock', 'monsterAttack']);
  });

  it('voices landings, blocks and the execution strike', () => {
    const { d, calls } = director();
    d.handle({ t: 'projectileEnd', kind: 'tarGlob', x: 0, y: 0 }, LOCAL);
    d.handle({ t: 'blocked', x: 0, y: 0 }, LOCAL);
    d.handle({ t: 'areaResolve', kind: 'executionMark', x: 0, y: 0, radius: 36 }, LOCAL);
    d.handle({ t: 'areaResolve', kind: 'frostNovaWarning', x: 0, y: 0, radius: 96 }, LOCAL); // voiced by its 'nova'
    expect(calls.map((c) => c.id)).toEqual(['tarSplat', 'shieldBlock', 'bossSlam', 'arenaSpikes']);
  });

  it('keeps glacial spikes at least SPIKE_GAP apart (queued, not dropped)', () => {
    const { d, calls } = director();
    for (let k = 0; k < 4; k++) d.handle({ t: 'areaResolve', kind: 'glacialSpike', x: k * 26, y: 0, radius: 17 }, LOCAL);
    expect(calls).toHaveLength(1);
    const times = [0];
    for (let t = 1 / 60; t < 0.5 && calls.length < 4; t += 1 / 60) {
      const n = calls.length;
      d.beginFrame(t);
      if (calls.length > n) times.push(t);
    }
    expect(calls.map((c) => c.id)).toEqual(['glacialSpikes', 'glacialSpikes', 'glacialSpikes', 'glacialSpikes']);
    for (let k = 1; k < times.length; k++) expect(times[k] - times[k - 1]).toBeGreaterThanOrEqual(SPIKE_GAP - 1e-9);
    expect(calls.map((c) => c.x)).toEqual([0, 26, 52, 78]);
  });

  it('replays a whirl every six revolutions while its blades spin, and voices the ice prison once', () => {
    const { d, calls } = director();
    const w = emptyWorld([player(1, 0, 0)]);
    addMonster(w, 0, kind('varkus'), RARITY_CODE.boss, 100, 0, 20);
    w.areas = [
      { id: encodeAreaId(1, 0, 1), kind: 'whirlwind', x: 100, y: 0, radius: 58, age: 0, duration: 3 },
      { id: encodeAreaId(2, 0, 0), kind: 'icePrison', x: 0, y: 0, radius: 40, age: 0, duration: 1.8 },
    ];
    let t = 0;
    for (let frame = 0; frame < 60 * 3.5; frame++) {
      d.beginFrame(t);
      d.ambient(w, 0, 0);
      t += 1 / 60;
    }
    const whirls = calls.filter((c) => c.id === 'varkusWhirl');
    expect(whirls.length).toBe(Math.floor(3.5 / VARKUS_SPIN) + 1);
    expect(calls.filter((c) => c.id === 'icePrison')).toHaveLength(1);
    expect(CHAIN_SPIN).toBeCloseTo(1.44, 6);
  });

  it('gusts the blizzard nearest the listener, at the listener while inside it', () => {
    const { d, calls } = director();
    const w = emptyWorld([player(1, 0, 0)]);
    w.areas = [
      { id: 11, kind: 'blizzard', x: 20, y: 0, radius: 52, age: 1, duration: 9 },
      { id: 12, kind: 'blizzard', x: 300, y: 0, radius: 52, age: 1, duration: 9 },
    ];
    let t = 0;
    for (let frame = 0; frame < 60 * 5; frame++) {
      d.beginFrame(t);
      d.ambient(w, 0, 0);
      t += 1 / 60;
    }
    const gusts = calls.filter((c) => c.id === 'blizzardLoop');
    expect(gusts.length).toBe(Math.floor(5 / BLIZZARD_GUST) + 1);
    expect(gusts.every((c) => c.x === 0 && c.y === 0)).toBe(true);
  });

  it('gives each boss its own voice (spawn, phase, death)', () => {
    const { d, calls } = director();
    d.setTheme('rimedOssuary');
    d.handle({ t: 'bossSpawn', x: 0, y: 0 }, LOCAL);
    d.beginFrame(10);
    d.handle({ t: 'bossPhase', phase: 2 }, LOCAL);
    d.beginFrame(20);
    d.handle({ t: 'death', kind: 'hollowWarden', rarity: RARITY_CODE.boss, x: 0, y: 0, facing: 1, damageType: 'fire' }, LOCAL);
    expect(calls.map((c) => c.id)).toEqual(['bossSpawn', 'choirSing', 'wardenNova', 'icePrison', 'monsterDeathBig', 'wardenNova']);
    calls.length = 0;
    const c2 = director();
    c2.d.setTheme('ironColiseum');
    c2.d.handle({ t: 'bossSpawn', x: 0, y: 0 }, LOCAL);
    c2.d.handle({ t: 'death', kind: 'boneThrall', rarity: RARITY_CODE.normal, x: 0, y: 0, facing: 1, damageType: 'fire' }, LOCAL);
    expect(c2.calls.map((c) => c.id)).toEqual(['bossSpawn', 'crowdRoar', 'boneRattle']);
    expect(c2.calls[2].pitch).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('presenter: the new rosters', () => {
  /** A world with every new kind in every anim, every new projectile and every new area kind. */
  function bestiaryWorld(): WorldView {
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 }), player(2, 30, 0, { vx: 0, prevX: 30 })], 512);
    let slot = 0;
    NEW_MONSTER_KINDS.forEach((k, n) => {
      for (const anim of [MONSTER_ANIM.idle, MONSTER_ANIM.move, MONSTER_ANIM.windup, MONSTER_ANIM.attack, MONSTER_ANIM.spawn]) {
        const i = slot++;
        const lt = k === 'boneChorister' || k === 'chainmaster';
        const boss = k === 'hollowWarden' || k === 'varkus';
        addMonster(w, i, kind(k), boss ? RARITY_CODE.boss : lt ? RARITY_CODE.lieutenant : n % 3 === 0 ? RARITY_CODE.rare : RARITY_CODE.normal,
          -280 + (n % 7) * 80 + anim * 6, -150 + Math.floor(n / 7) * 140 + anim * 12, 10);
        w.monsters.anim[i] = anim;
        w.monsters.animTime[i] = 0.3;
      }
    });
    const p = w.projectiles;
    NEW_PROJECTILE_KINDS.forEach((k, n) => {
      const i = n;
      p.alive[i] = 1;
      p.kind[i] = PROJECTILE_KINDS.indexOf(k);
      p.hostile[i] = 1;
      p.x[i] = p.prevX[i] = -100 + n * 40;
      p.y[i] = p.prevY[i] = 60;
      p.vx[i] = 200;
      p.vy[i] = 30;
      p.age[i] = 0.4;
      p.life[i] = k === 'tarGlob' ? 1.2 : 0;
      p.count++;
    });
    let seq = 1;
    const areas: AreaView[] = [];
    for (const k of NEW_AREA_KINDS) {
      for (const variant of [0, 1, 2]) {
        areas.push({ id: encodeAreaId(seq++, 0.7, variant), kind: k, x: -200 + areas.length * 13, y: 100, radius: 40, age: 0.5, duration: 1.2 });
      }
    }
    w.areas = areas;
    return w;
  }

  it('draws every new monster, action set, projectile, area and event without unknown sprites', () => {
    const r = new RecordingRenderer();
    const audio = new RecordingAudio();
    const p = createPresenter(r, art(), audio);
    const w = bestiaryWorld();
    w.theme = 'ironColiseum';
    const events: SimEvent[] = [
      ...NEW_MONSTER_KINDS.flatMap((k) =>
        (['melee', 'web', 'hook', 'aim', 'bolt', 'tar', 'nova', 'spikes', 'prison', 'blizzard', 'whirl', 'mark', 'sing', 'pulse', 'burst', 'bash', 'summon', 'slam', 'leap', 'charge', 'orb'] as const)
          .map((attack): SimEvent => ({ t: 'monsterAttack', kind: k, x: 0, y: 0, attack }))),
      ...NEW_MONSTER_KINDS.map((k): SimEvent => ({ t: 'death', kind: k, rarity: RARITY_CODE.normal, x: 10, y: 10, facing: 1, damageType: 'cold' })),
      ...NEW_PROJECTILE_KINDS.map((k): SimEvent => ({ t: 'projectileEnd', kind: k, x: 5, y: 5 })),
      ...NEW_AREA_KINDS.map((k): SimEvent => ({ t: 'areaResolve', kind: k, x: 20, y: 20, radius: 30 })),
      ...PLAYER_DEBUFFS.map((d): SimEvent => ({ t: 'debuff', playerId: 1, debuff: d, stacks: 2, x: 0, y: 0 })),
      { t: 'cleanse', playerId: 1, debuffs: ['burning', 'bleeding'], x: 0, y: 0 },
      { t: 'blocked', x: 5, y: 0 },
      { t: 'pull', playerId: 2, fromX: 30, fromY: 0, toX: 60, toY: 0 },
      { t: 'monsterSpawn', kind: 'chainmaster', rarity: RARITY_CODE.lieutenant, x: 0, y: 0 },
      { t: 'bossSpawn', x: 0, y: 0 },
      { t: 'bossPhase', phase: 3 },
    ];
    p.frame(input(w, events));
    for (let i = 0; i < 20; i++) p.frame(input(w));
    expect([...r.missing]).toEqual([]);
    expect(r.frameSprites.some((s) => s.id === 'fx/icePrisonShard')).toBe(true);
    expect(r.frameSprites.some((s) => s.id === 'fx/blizzard')).toBe(true);
    expect(r.frameSprites.some((s) => s.id === 'fx/chain')).toBe(true);
    expect(r.frameSprites.some((s) => s.id === 'fx/tarPool')).toBe(true);
    expect(r.frameSprites.some((s) => s.id === 'fx/executionMark')).toBe(true);
    expect(r.frameSprites.some((s) => s.id === 'fx/arenaSpike')).toBe(true);
    const ids = new Set(audio.plays.map((c) => c.id));
    for (const id of ['boneRattle', 'webShot', 'wispBurst', 'golemSlam', 'houndBite', 'crossbowShot', 'tarSplat', 'shieldBlock', 'debuffFreeze'] as const) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('keeps lights within budget with every new presence and area on screen', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = bestiaryWorld();
    p.frame(input(w));
    p.frame(input(w));
    expect(r.frameLights.length).toBeLessThan(200);
  });

  it('draws every debuff overlay on players, and her own sprite tinted while frozen', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const list = PLAYER_DEBUFFS.map((d) => debuff(d, { stacks: 3, source: d === 'rooted' ? 'tar' : null }));
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0, debuffs: list })]);
    for (let i = 0; i < 20; i++) p.frame(input(w));
    for (const d of PLAYER_DEBUFFS) expect(r.frameSprites.some((s) => s.id === `fx/debuff/${d}`), d).toBe(true);
    const body = r.frameSprites.find((s) => s.id.startsWith('sorceress/'))!;
    expect(body.tint).toEqual([...DEBUFF_PLAYER_TINT.frozen!].map((v) => expect.closeTo(v, 5)));
    // Rooted in tar shows the tar loop (frames 12–15), bleeding at 3 stacks its third loop (12–17).
    const rooted = r.frameSprites.find((s) => s.id === 'fx/debuff/rooted')!;
    expect(rooted.frame).toBeGreaterThanOrEqual(12);
    const bleed = r.frameSprites.find((s) => s.id === 'fx/debuff/bleeding')!;
    expect(bleed.frame).toBeGreaterThanOrEqual(12);
  });

  it('a frozen player holds her pose', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const me = player(1, 0, 0, { anim: 'run', vx: 80, prevX: -1 });
    const w = emptyWorld([me]);
    for (let i = 0; i < 5; i++) p.frame(input(w));
    me.debuffs = [debuff('frozen', { remaining: 0.8, duration: 0.8 })];
    const frames = new Set<string>();
    for (let i = 0; i < 30; i++) {
      p.frame(input(w));
      const body = r.frameSprites.find((s) => s.id.startsWith('sorceress/'))!;
      frames.add(`${body.id}#${body.frame}`);
    }
    expect(frames.size).toBe(1);
  });

  it('Varkus runs his charge sprite along his lane and whirls inside his blade ring', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    addMonster(w, 0, kind('varkus'), RARITY_CODE.boss, 60, 0, 20);
    w.monsters.anim[0] = MONSTER_ANIM.move;
    w.areas = [{ id: encodeAreaId(3, 0, 2), kind: 'chargeLine', x: 0, y: 0, radius: 200, age: 1, duration: 1.7 }];
    p.frame(input(w));
    expect(r.frameSprites.some((s) => s.id === 'monster/varkus/charge')).toBe(true);
    w.areas = [{ id: encodeAreaId(4, 0, 1), kind: 'whirlwind', x: 60, y: 0, radius: 58, age: 0.5, duration: 3 }];
    p.frame(input(w));
    expect(r.frameSprites.some((s) => s.id === 'monster/varkus/whirl')).toBe(true);
    w.areas = [];
    p.frame(input(w));
    expect(r.frameSprites.some((s) => s.id === 'monster/varkus/move')).toBe(true);
  });

  it('switches bodies to their action sets on cue: the Warden casts, the shield-bearer braces', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    addMonster(w, 0, kind('hollowWarden'), RARITY_CODE.boss, 80, 0, 22);
    addMonster(w, 1, kind('shieldbearer'), RARITY_CODE.normal, -60, 0, 11);
    w.monsters.anim[0] = MONSTER_ANIM.windup;
    // The prison cue is placed at the prison (her target), far from her: she is still the one casting.
    p.frame(input(w, [{ t: 'monsterAttack', kind: 'hollowWarden', x: 0, y: 0, attack: 'prison' }, { t: 'blocked', x: -50, y: 0 }]));
    expect(r.frameSprites.some((s) => s.id === 'monster/hollowWarden/cast')).toBe(true);
    expect(r.frameSprites.some((s) => s.id === 'monster/shieldbearer/block')).toBe(true);
    expect(r.frameSprites.some((s) => s.id === 'fx/shieldArc')).toBe(true);
    // Back to the plain anim once she moves on.
    w.monsters.anim[0] = MONSTER_ANIM.move;
    p.frame(input(w));
    expect(r.frameSprites.some((s) => s.id === 'monster/hollowWarden/move')).toBe(true);
  });

  it('a wisp that bursts leaves its burst, not a corpse', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    p.frame(input(w, [
      { t: 'monsterAttack', kind: 'glacialWisp', x: 40, y: 10, attack: 'burst' },
      { t: 'death', kind: 'glacialWisp', rarity: RARITY_CODE.normal, x: 40, y: 10, facing: 1, damageType: 'cold' },
      { t: 'death', kind: 'boneThrall', rarity: RARITY_CODE.normal, x: -40, y: 10, facing: 1, damageType: 'cold' },
    ]));
    p.frame(input(w));
    expect(r.frameSprites.some((s) => s.id === 'monster/glacialWisp/burst')).toBe(true);
    expect(r.frameSprites.some((s) => s.id === 'monster/glacialWisp/corpse')).toBe(false);
    expect(r.frameSprites.some((s) => s.id === 'monster/boneThrall/corpse')).toBe(true);
  });

  it('a pull snaps a chain from the thrower to the yanked player', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    addMonster(w, 0, kind('chainThrall'), RARITY_CODE.normal, 150, 0, 7);
    p.frame(input(w, [{ t: 'pull', playerId: 1, fromX: -40, fromY: 0, toX: 0, toY: 0 }]));
    const links = r.frameSprites.filter((s) => s.id === 'fx/chain');
    expect(links.length).toBeGreaterThan(10);
    expect(Math.max(...links.map((l) => l.x))).toBeGreaterThan(130);
  });

  it('the Rimeshade is drawn translucent; bosses and lieutenants get their own marker names', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    addMonster(w, 0, kind('rimeshade'), RARITY_CODE.normal, 40, 0, 7);
    addMonster(w, 1, kind('hollowWarden'), RARITY_CODE.boss, 0, 700, 22);
    addMonster(w, 2, kind('chainmaster'), RARITY_CODE.lieutenant, 0, -700, 14);
    p.frame(input(w));
    const ghost = r.frameSprites.find((s) => s.id.startsWith('monster/rimeshade/'))!;
    expect(ghost.alpha).toBeLessThan(0.9);
    expect(r.frameTexts.some((t) => t.text === 'Warden')).toBe(true);
    expect(r.frameTexts.some((t) => t.text === 'Chainmaster')).toBe(true);
  });

  it("the local player is outlined inside a lane or a choir band, not inside the choir ring's hollow", () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    const outlined = (): boolean => !!r.frameSprites.find((s) => s.id.startsWith('sorceress/'))!.outline;
    w.areas = [area(encodeAreaId(1, 0, 1), 'choirWave', 0, 0, 120, 1, 3.6)];
    p.frame(input(w));
    expect(outlined()).toBe(false);
    w.areas = [area(encodeAreaId(2, 0, 1), 'chargeLine', -50, 0, 200, 0.5, 1.7)];
    p.frame(input(w));
    expect(outlined()).toBe(true);
  });
});
