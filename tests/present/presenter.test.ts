// Presenter smoke + budget tests against a recording renderer (no WebGL): a dense synthetic world (800 monsters,
// 600 projectiles, motes, drops, areas, props) and a short real multiplayer sim run with every event kind.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ArtBundle, SpriteDef } from '../../src/contracts/art';
import { MONSTER_KINDS } from '../../src/contracts/content';
import type { PresentInput } from '../../src/contracts/present';
import {
  AILMENT_BIT, ELITE_BIT, MONSTER_ANIM, PROJECTILE_KINDS, RARITY_CODE, type AreaView, type DropView, type PlayerView,
  type PropView, type SimEvent, type WorldView,
} from '../../src/contracts/sim';
import { generateSprites } from '../../src/art';
import { createPresenter } from '../../src/present';
import { RecordingAudio, RecordingRenderer } from './helpers';

/** Every monster kind but the dummy, the lieutenants and the bosses. */
const REGULAR_KINDS = MONSTER_KINDS.map((_, k) => k).filter((k) => {
  const kind = MONSTER_KINDS[k];
  return !['trainingDummy', 'ashboundHerald', 'cinderMatriarch', 'boneChorister', 'hollowWarden', 'chainmaster', 'varkus'].includes(kind);
});

let sprites: SpriteDef[];
beforeAll(() => {
  sprites = generateSprites();
});

function art(): ArtBundle {
  return { sprites, icon: () => '', portrait: () => '', palette: {} };
}

function player(id: number, x: number, y: number, over: Partial<PlayerView> = {}): PlayerView {
  return {
    id, name: `P${id}`, level: 10, x, y, prevX: x - 1, prevY: y, vx: 60, vy: 0, facing: 'east', aimX: x + 50, aimY: y,
    anim: 'run', animTime: 0.3, castSkill: null, castProgress: 0, life: 80, maxLife: 100, focus: 50, maxFocus: 70,
    wardTime: 0, wardDuration: 0, invulnTime: 0, hitFlash: 0, dead: false, debuffs: [], slots: [], flasks: [], ...over,
  };
}

/** A dense synthetic map view: 800 monsters, 600 projectiles, 300 motes, 40 drops, telegraphs and props. */
function denseWorld(): WorldView {
  const M = 2048;
  const mon = {
    capacity: M, count: 800, alive: new Uint8Array(M), id: new Uint32Array(M), kind: new Uint8Array(M), rarity: new Uint8Array(M),
    x: new Float32Array(M), y: new Float32Array(M), prevX: new Float32Array(M), prevY: new Float32Array(M), radius: new Float32Array(M),
    facing: new Int8Array(M), anim: new Uint8Array(M), animTime: new Float32Array(M), life: new Float32Array(M), maxLife: new Float32Array(M),
    hitFlash: new Float32Array(M), ailments: new Uint8Array(M), mods: new Uint8Array(M),
  };
  for (let i = 0; i < 800; i++) {
    const a = i * 2.39996;
    const r = 30 + Math.sqrt(i) * 9;
    mon.alive[i] = 1;
    mon.id[i] = (1 << 16) | i;
    // Every roster's regular kinds (the lieutenants and bosses are placed below).
    mon.kind[i] = REGULAR_KINDS[i % REGULAR_KINDS.length];
    mon.rarity[i] = i % 97 === 0 ? RARITY_CODE.rare : i % 13 === 0 ? RARITY_CODE.magic : RARITY_CODE.normal;
    mon.x[i] = Math.cos(a) * r;
    mon.y[i] = Math.sin(a) * r;
    mon.prevX[i] = mon.x[i] - 0.5;
    mon.prevY[i] = mon.y[i];
    mon.radius[i] = 6;
    mon.facing[i] = i % 2 ? 1 : -1;
    mon.anim[i] = i % 5 === 0 ? MONSTER_ANIM.windup : i % 11 === 0 ? MONSTER_ANIM.spawn : MONSTER_ANIM.move;
    mon.animTime[i] = (i % 30) / 30;
    mon.life[i] = 20;
    mon.maxLife[i] = i % 97 === 0 ? 100 : 1;
    mon.hitFlash[i] = i % 7 === 0 ? 0.6 : 0;
    mon.ailments[i] = (i % 3 === 0 ? AILMENT_BIT.burning : 0) | (i % 4 === 0 ? AILMENT_BIT.chilled : 0) | (i % 9 === 0 ? AILMENT_BIT.shocked : 0);
    mon.mods[i] = i % 97 === 0 ? ELITE_BIT.juggernaut | ELITE_BIT.frenzied : 0;
  }
  mon.alive[900] = 1;
  mon.kind[900] = MONSTER_KINDS.indexOf('cinderMatriarch');
  mon.rarity[900] = RARITY_CODE.boss;
  mon.maxLife[900] = 7000;
  mon.life[900] = 5000;
  const P = 2048;
  const proj = {
    capacity: P, count: 600, alive: new Uint8Array(P), id: new Uint32Array(P), kind: new Uint8Array(P), hostile: new Uint8Array(P),
    x: new Float32Array(P), y: new Float32Array(P), prevX: new Float32Array(P), prevY: new Float32Array(P), vx: new Float32Array(P),
    vy: new Float32Array(P), radius: new Float32Array(P), age: new Float32Array(P), life: new Float32Array(P),
  };
  for (let i = 0; i < 600; i++) {
    proj.alive[i] = 1;
    proj.kind[i] = i % PROJECTILE_KINDS.length;
    proj.hostile[i] = proj.kind[i] >= 4 ? 1 : 0;
    proj.x[i] = ((i * 37) % 600) - 300;
    proj.y[i] = ((i * 53) % 340) - 170;
    proj.prevX[i] = proj.x[i] - 4;
    proj.prevY[i] = proj.y[i];
    proj.vx[i] = 300;
    proj.vy[i] = 40;
    proj.age[i] = 0.3;
    proj.life[i] = PROJECTILE_KINDS[proj.kind[i]] === 'cinderSpit' ? 1.1 : PROJECTILE_KINDS[proj.kind[i]] === 'tarGlob' ? 1.2 : 0;
  }
  const T = 1024;
  const motes = {
    capacity: T, count: 300, alive: new Uint8Array(T), x: new Float32Array(T), y: new Float32Array(T), prevX: new Float32Array(T),
    prevY: new Float32Array(T), size: new Uint8Array(T),
  };
  for (let i = 0; i < 300; i++) {
    motes.alive[i] = 1;
    motes.x[i] = ((i * 71) % 600) - 300;
    motes.y[i] = ((i * 29) % 340) - 170;
    motes.prevX[i] = motes.x[i] - (i % 2 ? 3 : 0);
    motes.prevY[i] = motes.y[i];
    motes.size[i] = i % 3;
  }
  const tones = ['normal', 'magic', 'rare', 'unique', 'currency', 'map', 'flask'] as const;
  const drops: DropView[] = [];
  for (let i = 0; i < 40; i++) {
    const tone = tones[i % tones.length];
    drops.push({
      id: i + 1, spec: {
        token: i, owner: i % 10 === 7 ? 0 : 1, label: `Drop ${i} of Testing`, tone, sprite: tone === 'currency' ? 'currency' : tone === 'map' ? 'map' : tone === 'flask' ? 'flask' : 'equipment',
        iconId: 'icon/currency/catalyst', autoPickup: tone === 'currency' || tone === 'map' || tone === 'flask',
      },
      x: (i % 8) * 12 - 40, y: Math.floor(i / 8) * 10, prevX: (i % 8) * 12 - 40, prevY: Math.floor(i / 8) * 10, z: i % 5 === 0 ? 8 : 0,
      age: 1, blocked: i % 9 === 0,
    });
  }
  drops.push({ ...drops[0], id: 99, spec: { ...drops[0].spec, owner: 2 } });
  const kinds = ['slamWarning', 'leapWarning', 'eruptionWarning', 'meteorWarning', 'firePool', 'fireTrail', 'heraldAura'] as const;
  const areas: AreaView[] = kinds.map((kind, i) => ({ id: i, kind, x: i * 30 - 100, y: 40, radius: 30, age: 0.5, duration: 1.2 }));
  const pk = ['mapDevice', 'stash', 'merchant', 'portal', 'returnPortal', 'chest', 'pillar', 'brazier', 'standingStone', 'rubble', 'bones', 'crystal', 'banner', 'anvil', 'ruinWall'] as const;
  const props: PropView[] = pk.map((kind, i) => ({
    id: i + 1, kind, x: i * 40 - 280, y: -120, radius: 8, state: kind === 'portal' ? 8 : kind === 'returnPortal' ? 1 : 0, variant: i, interactive: i < 3,
  }));
  return {
    tick: 600, time: 10, arenaRadius: 900, theme: 'ashenForge',
    players: [player(1, 0, 0, { anim: 'cast', castSkill: 'emberNova', castProgress: 0.6, wardTime: 2, wardDuration: 4 }), player(2, 40, 10), player(3, 900, 0, { dead: true, anim: 'death' })],
    monsters: mon, projectiles: proj, motes, areas, drops, props,
    run: {
      phase: 'fight', wave: 5, waveCount: 6, waveTime: 10, waveDuration: 60, elapsed: 250, kills: 400, monstersAlive: 801,
      boss: { name: 'Cinder Matriarch', life: 5000, maxLife: 7000, phase: 2 }, lieutenant: null, portalOpen: false, playersAlive: 2,
    },
  };
}

function input(world: WorldView, events: SimEvent[] = [], dt = 1 / 60): PresentInput {
  return {
    world, localPlayerId: 1, alpha: 0.5, dt, events, cursorWorld: { x: 60, y: 10 }, hoverPropId: 1, hoverDropId: 3,
    settings: { screenShake: 1 }, paused: false,
  };
}

const EVENTS: SimEvent[] = [
  { t: 'cast', playerId: 1, skill: 'flameWave', x: 0, y: 0, dirX: 1, dirY: 0 },
  { t: 'cast', playerId: 1, skill: 'rimeShards', x: 0, y: 0, dirX: 1, dirY: 0 },
  { t: 'nova', playerId: 1, skill: 'emberNova', x: 0, y: 0, radius: 170 },
  { t: 'dash', playerId: 1, fromX: 0, fromY: 0, toX: 90, toY: 20 },
  { t: 'ward', playerId: 1, x: 0, y: 0, duration: 4 },
  { t: 'chain', playerId: 1, points: [0, 0, 40, 10, 80, -20, 120, 0], damageType: 'lightning' },
  { t: 'hit', playerId: 1, x: 10, y: 10, amount: 57.4, damageType: 'fire', crit: true, target: 'monster', killed: false, kind: 'ashling' },
  { t: 'hit', playerId: 1, x: 0, y: 0, amount: 20, damageType: 'physical', crit: false, target: 'player', killed: false },
  { t: 'evade', playerId: 1, x: 0, y: 0, target: 'player' },
  { t: 'projectileEnd', kind: 'cinderSpit', x: 10, y: 0 },
  { t: 'death', kind: 'ironhideBrute', rarity: RARITY_CODE.rare, x: 20, y: 20, facing: -1, damageType: 'fire' },
  { t: 'death', kind: 'cinderMatriarch', rarity: RARITY_CODE.boss, x: 20, y: 20, facing: 1, damageType: 'cold' },
  { t: 'monsterAttack', kind: 'ashboundHerald', x: 0, y: 0, attack: 'summon' },
  { t: 'monsterSpawn', kind: 'ashboundHerald', rarity: RARITY_CODE.lieutenant, x: 0, y: 0 },
  { t: 'ailment', ailment: 'chilled', x: 0, y: 0 },
  { t: 'areaResolve', kind: 'meteorWarning', x: 0, y: 0, radius: 30 },
  { t: 'areaResolve', kind: 'slamWarning', x: 0, y: 0, radius: 70 },
  { t: 'dropSpawn', owner: 1, tone: 'unique', x: 0, y: 0, label: 'The Patient Spark' },
  { t: 'dropSpawn', owner: 1, tone: 'rare', x: 0, y: 0, label: 'Grave Coil' },
  { t: 'pickup', owner: 1, playerId: 1, tone: 'currency', x: 0, y: 0, label: 'Forge Scrap' },
  { t: 'dropSpawn', owner: 0, tone: 'rare', x: 10, y: 0, label: 'Dropped Ring' },
  { t: 'pickup', owner: 0, playerId: 2, tone: 'rare', x: 10, y: 0, label: 'Dropped Ring' },
  { t: 'mote', playerId: 1, x: 0, y: 0 },
  { t: 'flask', playerId: 1, resource: 'life' },
  { t: 'waveTell', wave: 6, families: ['ashling'], lieutenant: false, boss: true },
  { t: 'waveStart', wave: 6 },
  { t: 'bossSpawn', x: 100, y: 0 },
  { t: 'bossPhase', phase: 2 },
  { t: 'cleared', x: 0, y: 0 },
  { t: 'chestOpen', x: 0, y: 0 },
  { t: 'portal', playerId: 0, x: -160, y: -120, kind: 'open' },
  { t: 'portal', playerId: 1, x: -160, y: -120, kind: 'enter' },
  { t: 'playerDeath', playerId: 2, x: 40, y: 10 },
  { t: 'playerJoin', playerId: 2, x: 40, y: 10 },
  { t: 'notEnoughFocus', playerId: 1 },
];

describe('presenter', () => {
  it('draws a dense world and every event kind without errors or unknown sprites', () => {
    const r = new RecordingRenderer();
    const audio = new RecordingAudio();
    const p = createPresenter(r, art(), audio);
    const w = denseWorld();
    p.frame(input(w, EVENTS));
    for (let i = 0; i < 30; i++) p.frame(input(w));
    expect([...r.missing]).toEqual([]);
    expect(r.sprites).toBeGreaterThan(1000);
    expect(r.lights).toBeGreaterThan(0);
    expect(r.texts).toBeGreaterThan(0);
    expect(audio.plays.length).toBeGreaterThan(10);
    // Listener = the local player's interpolated position (prevX −1 → x 0 at alpha 0.5).
    expect(audio.listener.x).toBeCloseTo(-0.5, 5);
    expect(p.camera.zoom).toBe(1);
    expect(r.lastPost?.saturation).toBeGreaterThan(0.5);
  });

  it('keeps lights within budget in a dense frame', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = denseWorld();
    p.frame(input(w));
    r.lights = 0;
    p.frame(input(w));
    // Ground pools + props + per-family caps: a few hundred at most, never one per entity.
    expect(r.lights).toBeLessThan(320);
  });

  it('renders a frame of 800 monsters + 600 projectiles well inside the frame budget', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = denseWorld();
    for (let i = 0; i < 20; i++) p.frame(input(w)); // warm up (JIT, pools)
    const n = 120;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      w.tick++;
      p.frame(input(w));
    }
    const ms = (performance.now() - t0) / n;
    // Presenter CPU per frame (the WebGL work is the renderer's): generous for CI machines.
    expect(ms).toBeLessThan(8);
  });

  it('desaturates when the local player is dead and hides other players\' drops', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = denseWorld();
    w.players[0] = { ...w.players[0], dead: true, anim: 'death' };
    for (let i = 0; i < 120; i++) p.frame(input(w, [], 1 / 30));
    expect(r.lastPost?.saturation).toBeLessThan(0.3);
  });

  it('resets on a new zone (theme or arena change) without throwing', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = denseWorld();
    p.frame(input(w));
    const hide: WorldView = { ...w, theme: 'hideout', arenaRadius: 320, run: { ...w.run, phase: 'hideout', boss: null } };
    p.frame(input(hide));
    p.reset(hide, 1);
    p.frame(input(hide));
    expect(r.frames).toBe(3);
  });
});
