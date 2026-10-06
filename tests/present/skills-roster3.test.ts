// Power rework SK4, roster batch 3: the presenter draws and voices the five new skills (meteor telegraphs and impacts, Storm Step's
// strikes, the surge aura, the storm, the horizon and its detonation) against the recording renderer, with every sprite and sound the
// art and audio provide.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ArtBundle, SpriteDef } from '../../src/contracts/art';
import { SFX_IDS } from '../../src/contracts/audio';
import type { SkillId } from '../../src/contracts/content';
import type { PresentInput } from '../../src/contracts/present';
import { RARITY_CODE, type AreaView, type SimEvent, type WorldView } from '../../src/contracts/sim';
import { generateSprites } from '../../src/art';
import { SFX } from '../../src/audio/sfx';
import { SFX_TRIM_DB } from '../../src/audio/levels';
import { createPresenter } from '../../src/present';
import { CAST_SFX } from '../../src/present/sound';
import { ROSTER3_SKILLS } from '../../src/present/skills/roster3';
import { addMonster, emptyWorld, player, RecordingAudio, RecordingRenderer } from './helpers';

const SKILLS: readonly SkillId[] = ['meteorRain', 'stormStep', 'tempestSurge', 'blizzard', 'eventHorizon'];
const NEW_SFX = ['castMeteor', 'meteorImpact', 'stormStepStrike', 'tempestSurge', 'castBlizzard', 'castHorizon', 'horizonCollapse'] as const;

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
  addMonster(w, 0, 0, RARITY_CODE.normal, 60, -40, 8);
  const areas: AreaView[] = [
    { id: 1, kind: 'meteorRain', x: 120, y: 60, radius: 34, age: 0.3, duration: 0.6 },
    { id: 2, kind: 'blizzardStorm', x: -120, y: 60, radius: 90, age: 1, duration: 6 },
    { id: 3, kind: 'eventHorizon', x: 0, y: 160, radius: 200, age: 1, duration: 2.5 },
  ];
  w.areas = areas;
  return w;
}

describe('roster batch 3 presentation', () => {
  it('every new sound has a calibrated recipe, and every skill a cast cue and cast visual', () => {
    for (const id of NEW_SFX) {
      expect(SFX_IDS, id).toContain(id);
      expect(SFX[id], id).toBeDefined();
      expect(SFX_TRIM_DB[id], id).toBeTypeOf('number');
    }
    for (const s of SKILLS) {
      expect(ROSTER3_SKILLS.has(s), s).toBe(true);
      expect(s in CAST_SFX, s).toBe(true);
    }
  });

  it('draws the telegraphs, storm, horizon, strikes, detonation and aura without unknown sprites, in the player palette, and voices them', () => {
    const r = new RecordingRenderer();
    const audio = new RecordingAudio();
    const p = createPresenter(r, art(), audio);
    const w = rosterWorld();
    const events: SimEvent[] = [
      ...SKILLS.filter((s) => s !== 'stormStep').map((skill): SimEvent => ({ t: 'cast', playerId: 1, skill, x: 0, y: 0, dirX: 1, dirY: 0 })),
      { t: 'dash', playerId: 1, fromX: -140, fromY: 0, toX: 0, toY: 0 },
      { t: 'nova', playerId: 1, skill: 'stormStep', x: -140, y: 0, radius: 60 },
      { t: 'nova', playerId: 1, skill: 'stormStep', x: 0, y: 0, radius: 60 },
      { t: 'nova', playerId: 2, skill: 'eventHorizon', x: 0, y: 160, radius: 120 },
      { t: 'buff', playerId: 1, skill: 'tempestSurge', x: 0, y: 0, duration: 6 },
      { t: 'chain', playerId: 1, points: [8, -10, 60, -40], damageType: 'lightning' },
      { t: 'areaResolve', kind: 'meteorRain', x: 120, y: 60, radius: 34 },
      { t: 'areaResolve', kind: 'blizzardStorm', x: -120, y: 60, radius: 90 },
    ];
    expect(() => p.frame(input(w, events))).not.toThrow();
    for (let i = 0; i < 30; i++) p.frame(input(w));
    expect([...r.missing]).toEqual([]);
    // The player's own ground is drawn, never in the danger red of hostile telegraphs.
    for (const a of w.areas) {
      const here = r.frameShapes.filter((s) => Math.abs(s.x - a.x) < 1 && Math.abs(s.y - a.y) < 1);
      expect(here.length, a.kind).toBeGreaterThan(0);
      expect(here.filter((s) => s.color[0] > 0.9 && s.color[1] < 0.3), a.kind).toEqual([]);
    }
    // The surge aura stays up (rings around the caster).
    expect(r.frameShapes.some((s) => Math.abs(s.x) < 1e-6 && Math.abs(s.y + 6) < 1e-6)).toBe(true);
    const played = new Set(audio.plays.map((c) => c.id));
    for (const id of ['castMeteor', 'meteorImpact', 'stormStepStrike', 'tempestSurge', 'castBlizzard', 'castHorizon', 'horizonCollapse'] as const) {
      expect(played.has(id), id).toBe(true);
    }
  });
});
