// Power rework SK3, roster batch 2: the presenter draws and voices the ten new skills (zones, the sigil's telegraph and pillar,
// Voltaic Pulse's ring, the cone, buff auras and their end, Withered and Hexed monsters) against the recording renderer, with every
// sprite and sound the art and audio provide.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ArtBundle, SpriteDef } from '../../src/contracts/art';
import { SFX_IDS } from '../../src/contracts/audio';
import type { SkillId } from '../../src/contracts/content';
import type { PresentInput } from '../../src/contracts/present';
import { AILMENT_BIT, RARITY_CODE, type AreaView, type SimEvent, type WorldView } from '../../src/contracts/sim';
import { generateSprites } from '../../src/art';
import { SFX } from '../../src/audio/sfx';
import { SFX_TRIM_DB } from '../../src/audio/levels';
import { createPresenter } from '../../src/present';
import { CAST_SFX } from '../../src/present/sound';
import { ROSTER2_SKILLS } from '../../src/present/skills/roster2';
import { addMonster, emptyWorld, player, RecordingAudio, RecordingRenderer } from './helpers';

const SKILLS: readonly SkillId[] = [
  'gravityWell', 'rimeBulwark', 'immolationSigil', 'staticAegis', 'voltaicPulse', 'entropyHex', 'concussiveBlast', 'staticLash',
  'echoSigil', 'witherField',
];
const NEW_SFX = [
  'castGravityWell', 'wellCollapse', 'castHex', 'castWither', 'castSigil', 'sigilPillar', 'barrierUp', 'barrierBreak', 'aegisUp',
  'voltaicPulse', 'concussiveBlast', 'castLash', 'echoSigil',
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
  addMonster(w, 0, 0, RARITY_CODE.normal, 60, -40, 8);
  addMonster(w, 1, 0, RARITY_CODE.normal, -60, -40, 8);
  w.monsters.ailments[0] = AILMENT_BIT.withered;
  w.monsters.ailments[1] = AILMENT_BIT.hexed;
  const areas: AreaView[] = [
    { id: 1, kind: 'gravityWell', x: 120, y: 60, radius: 90, age: 1, duration: 3 },
    { id: 2, kind: 'entropyHex', x: -120, y: 60, radius: 80, age: 1, duration: 6 },
    { id: 3, kind: 'witherField', x: 0, y: 140, radius: 80, age: 1, duration: 6 },
    { id: 4, kind: 'immolationSigil', x: 40, y: -90, radius: 50, age: 0.3, duration: 0.8 },
  ];
  w.areas = areas;
  return w;
}

describe('roster batch 2 presentation', () => {
  it('every new sound has a calibrated recipe, and every skill a cast cue and cast visual', () => {
    for (const id of NEW_SFX) {
      expect(SFX_IDS, id).toContain(id);
      expect(SFX[id], id).toBeDefined();
      expect(SFX_TRIM_DB[id], id).toBeTypeOf('number');
    }
    for (const s of SKILLS) {
      expect(ROSTER2_SKILLS.has(s), s).toBe(true);
      expect(s in CAST_SFX, s).toBe(true);
    }
  });

  it('draws the zones, the telegraph, rings, auras, pillar and statuses without unknown sprites, in the player palette, and voices them', () => {
    const r = new RecordingRenderer();
    const audio = new RecordingAudio();
    const p = createPresenter(r, art(), audio);
    const w = rosterWorld();
    const events: SimEvent[] = [
      ...SKILLS.map((skill): SimEvent => ({ t: 'cast', playerId: 1, skill, x: 0, y: 0, dirX: 1, dirY: 0 })),
      { t: 'nova', playerId: 1, skill: 'voltaicPulse', x: 0, y: 0, radius: 150 },
      { t: 'nova', playerId: 1, skill: 'gravityWell', x: 120, y: 60, radius: 90 },
      { t: 'nova', playerId: 2, skill: 'rimeBulwark', x: 30, y: 0, radius: 90 },
      { t: 'buff', playerId: 1, skill: 'rimeBulwark', x: 0, y: 0, duration: 6 },
      { t: 'buff', playerId: 1, skill: 'staticAegis', x: 0, y: 0, duration: 7 },
      { t: 'buff', playerId: 2, skill: 'echoSigil', x: 30, y: 0, duration: 12 },
      { t: 'chain', playerId: 1, points: [8, 0, 60, -40], damageType: 'lightning' },
      { t: 'areaResolve', kind: 'immolationSigil', x: 40, y: -90, radius: 50 },
      { t: 'areaResolve', kind: 'entropyHex', x: -120, y: 60, radius: 80 },
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
    // Auras stay up (shapes around the players).
    expect(r.frameShapes.some((s) => Math.abs(s.x) < 1e-6 && Math.abs(s.y + 10) < 1e-6)).toBe(true);
    const played = new Set(audio.plays.map((c) => c.id));
    for (const id of ['castGravityWell', 'castHex', 'castWither', 'castSigil', 'sigilPillar', 'barrierUp', 'aegisUp', 'voltaicPulse',
      'wellCollapse', 'concussiveBlast', 'castLash', 'echoSigil'] as const) {
      expect(played.has(id), id).toBe(true);
    }
  });

  it('a zero-length buff ends the barrier aura (it broke) and voices the break', () => {
    const r = new RecordingRenderer();
    const audio = new RecordingAudio();
    const p = createPresenter(r, art(), audio);
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    p.frame(input(w, [{ t: 'buff', playerId: 1, skill: 'rimeBulwark', x: 0, y: 0, duration: 6 }]));
    p.frame(input(w));
    const shell = () => r.frameShapes.some((s) => Math.abs(s.x) < 1e-6 && Math.abs(s.y + 10) < 1e-6);
    expect(shell()).toBe(true);
    p.frame(input(w, [{ t: 'buff', playerId: 1, skill: 'rimeBulwark', x: 0, y: 0, duration: 0 }]));
    p.frame(input(w));
    expect(shell()).toBe(false);
    expect(audio.plays.some((c) => c.id === 'barrierBreak')).toBe(true);
  });
});
