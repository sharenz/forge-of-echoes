// Power rework SK2, roster batch 1: the presenter draws and voices the ten new skills (projectiles, the mortar's lob, the
// player's own telegraphs, Glacial Nova, buff auras, impacts, Decay) against the recording renderer, with every sprite and
// sound the art and audio provide.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ArtBundle, SpriteDef } from '../../src/contracts/art';
import { REQUIRED_SPRITES } from '../../src/contracts/art';
import { SFX_IDS } from '../../src/contracts/audio';
import type { SkillId } from '../../src/contracts/content';
import type { PresentInput } from '../../src/contracts/present';
import { AILMENT_BIT, PROJECTILE_KINDS, RARITY_CODE, type AreaView, type ProjectileKind, type SimEvent, type WorldView } from '../../src/contracts/sim';
import { generateSprites } from '../../src/art';
import { SFX } from '../../src/audio/sfx';
import { SFX_TRIM_DB } from '../../src/audio/levels';
import { createPresenter } from '../../src/present';
import { CAST_SFX } from '../../src/present/sound';
import { ROSTER_SKILLS } from '../../src/present/skills/roster';
import { addMonster, emptyWorld, player, RecordingAudio, RecordingRenderer } from './helpers';

const SKILLS: readonly SkillId[] = [
  'phaseStride', 'glacialNova', 'spark', 'cinderMortar', 'arcaneReprieve', 'umbralBolt', 'kineticLance', 'frostOrb', 'stormCall',
  'glacialSpikes',
];
const KINDS: readonly ProjectileKind[] = ['spark', 'cinderShell', 'umbralBolt', 'kineticLance', 'frostOrb'];
const NEW_SFX = [
  'castSpark', 'castMortar', 'castUmbral', 'castKinetic', 'castOrb', 'castStormCall', 'phaseStride', 'arcaneReprieve',
  'glacialNovaBurst', 'mortarBlast', 'stormCallStrike', 'frostSpike',
] as const;

let sprites: SpriteDef[];
beforeAll(() => {
  sprites = generateSprites();
});

function art(): ArtBundle {
  return { sprites, icon: () => '', portrait: () => '', palette: {} };
}

function input(world: WorldView, events: SimEvent[] = [], dt = 1 / 60): PresentInput {
  return {
    world, localPlayerId: 1, alpha: 1, dt, events, cursorWorld: { x: 0, y: 0 }, hoverPropId: -1, hoverDropId: -1,
    settings: { screenShake: 1 }, paused: false,
  };
}

function rosterWorld(): WorldView {
  const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 }), player(2, 30, 0, { vx: 0, prevX: 30 })]);
  const p = w.projectiles;
  KINDS.forEach((k, i) => {
    p.alive[i] = 1;
    p.kind[i] = PROJECTILE_KINDS.indexOf(k);
    p.hostile[i] = 0;
    p.x[i] = p.prevX[i] = -100 + i * 40;
    p.y[i] = p.prevY[i] = 40;
    p.vx[i] = 150;
    p.vy[i] = 20;
    p.age[i] = 0.3;
    p.life[i] = k === 'cinderShell' ? 0.9 : 0;
    p.count++;
  });
  addMonster(w, 0, 0, RARITY_CODE.normal, 60, -40, 8);
  w.monsters.ailments[0] = AILMENT_BIT.decayed;
  const areas: AreaView[] = [
    { id: 1, kind: 'stormCall', x: 40, y: 60, radius: 28, age: 0.3, duration: 0.7 },
    { id: 2, kind: 'frostSpike', x: -40, y: 60, radius: 20, age: 0.1, duration: 0.25 },
    { id: 3, kind: 'fireTrail', x: 0, y: 90, radius: 54, age: 0.5, duration: 3 },
  ];
  w.areas = areas;
  return w;
}

describe('roster batch 1 presentation', () => {
  it('art provides every new projectile sprite, and every new sound has a calibrated recipe', () => {
    const ids = new Set(sprites.map((s) => s.id));
    for (const k of KINDS) {
      expect(REQUIRED_SPRITES, k).toContain(`proj/${k}`);
      expect(ids.has(`proj/${k}`), k).toBe(true);
    }
    for (const id of NEW_SFX) {
      expect(SFX_IDS, id).toContain(id);
      expect(SFX[id], id).toBeDefined();
      expect(SFX_TRIM_DB[id], id).toBeTypeOf('number');
    }
    for (const s of SKILLS) {
      expect(ROSTER_SKILLS.has(s), s).toBe(true);
      expect(s in CAST_SFX, s).toBe(true);
    }
  });

  it('draws every new projectile, telegraph, aura, burst and Decay without unknown sprites, and voices them', () => {
    const r = new RecordingRenderer();
    const audio = new RecordingAudio();
    const p = createPresenter(r, art(), audio);
    const w = rosterWorld();
    const events: SimEvent[] = [
      ...SKILLS.map((skill): SimEvent => ({ t: 'cast', playerId: 1, skill, x: 0, y: 0, dirX: 1, dirY: 0 })),
      { t: 'nova', playerId: 1, skill: 'glacialNova', x: 0, y: 0, radius: 110 },
      { t: 'buff', playerId: 1, skill: 'phaseStride', x: 0, y: 0, duration: 3 },
      { t: 'buff', playerId: 2, skill: 'arcaneReprieve', x: 30, y: 0, duration: 3 },
      ...KINDS.map((kind, i): SimEvent => ({ t: 'projectileEnd', kind, x: i * 10, y: 20 })),
      { t: 'areaResolve', kind: 'stormCall', x: 40, y: 60, radius: 28 },
      { t: 'areaResolve', kind: 'frostSpike', x: -40, y: 60, radius: 20 },
    ];
    expect(() => p.frame(input(w, events))).not.toThrow();
    const drawnAtCast = r.frameSprites.map((s) => s.id);
    for (let i = 0; i < 30; i++) p.frame(input(w));
    expect([...r.missing]).toEqual([]);
    for (const k of KINDS) expect(drawnAtCast.includes(`proj/${k}`) || r.frameSprites.some((s) => s.id === `proj/${k}`), k).toBe(true);
    // The friendly telegraphs draw in the player's palette (never the danger red of hostile telegraphs).
    const reds = r.frameShapes.filter((s) => Math.abs(s.x - 40) < 1 && Math.abs(s.y - 60) < 1 && s.color[0] > 0.9 && s.color[1] < 0.3);
    expect(reds).toEqual([]);
    expect(r.frameShapes.some((s) => Math.abs(s.x - 40) < 1 && Math.abs(s.y - 60) < 1)).toBe(true);
    // The aura is still up a half-second later (shapes around the striding player).
    expect(r.frameShapes.some((s) => s.x === 0 && s.y === 0 && s.kind === 'circle')).toBe(true);
    const played = new Set(audio.plays.map((c) => c.id));
    for (const id of ['castSpark', 'castMortar', 'castUmbral', 'castKinetic', 'castOrb', 'castStormCall', 'phaseStride', 'arcaneReprieve',
      'glacialNovaBurst', 'mortarBlast', 'stormCallStrike', 'frostSpike', 'castFrost'] as const) {
      expect(played.has(id), id).toBe(true);
    }
    expect(played.has('castNova')).toBe(false);
  });

  it('draws the mortar shell as a friendly lob: a landing marker and no hostile outline', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = rosterWorld();
    p.frame(input(w));
    const shell = r.frameSprites.find((s) => s.id === 'proj/cinderShell');
    expect(shell).toBeDefined();
    expect(shell!.outline).toBeUndefined();
    expect(r.frameShapes.some((s) => s.kind === 'ring' && Math.abs(s.radius - 40) < 1e-6)).toBe(true);
  });
});
