// Power rework SK5: the presenter draws and voices the flagship augments' cues (lodges, detonations, splits, marks, explosions,
// bursts, returns, refunds), the lodged / marked monster statuses and the player's chilling ground and static fields, against the
// recording renderer, with every sprite the art provides.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ArtBundle, SpriteDef } from '../../src/contracts/art';
import type { DamageType } from '../../src/contracts/content';
import type { PresentInput } from '../../src/contracts/present';
import { AILMENT_BIT, AUGMENT_FX, RARITY_CODE, type AreaView, type SimEvent, type WorldView } from '../../src/contracts/sim';
import { generateSprites } from '../../src/art';
import { createPresenter } from '../../src/present';
import { addMonster, emptyWorld, player, RecordingAudio, RecordingRenderer } from './helpers';

let sprites: SpriteDef[];
beforeAll(() => {
  sprites = generateSprites();
});

function art(): ArtBundle {
  return { sprites, icon: () => '', portrait: () => '', palette: {} };
}

function input(world: WorldView, events: SimEvent[] = []): PresentInput {
  return {
    world, localPlayerId: 1, alpha: 1, dt: 1 / 60, events, cursorWorld: { x: 0, y: 0 }, hoverPropId: -1, hoverDropId: -1,
    settings: { screenShake: 1 }, paused: false,
  };
}

describe('flagship augment presentation', () => {
  it('draws every cue in every element, the statuses and the ground without unknown sprites, and voices the detonations', () => {
    const r = new RecordingRenderer();
    const audio = new RecordingAudio();
    const p = createPresenter(r, art(), audio);
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    addMonster(w, 0, 0, RARITY_CODE.normal, 60, -40, 8);
    addMonster(w, 1, 0, RARITY_CODE.normal, -60, -40, 8);
    w.monsters.ailments[0] = AILMENT_BIT.lodged;
    w.monsters.ailments[1] = AILMENT_BIT.marked;
    const areas: AreaView[] = [
      { id: 1, kind: 'frostGround', x: 120, y: 60, radius: 20, age: 1, duration: 3 },
      { id: 2, kind: 'staticField', x: -120, y: 60, radius: 28, age: 1, duration: 3 },
    ];
    w.areas = areas;
    const types: DamageType[] = ['fire', 'cold', 'lightning', 'void', 'physical'];
    const events: SimEvent[] = AUGMENT_FX.flatMap((fx) => types.map((damageType): SimEvent => ({
      t: 'augment', playerId: 1, fx, x: 30, y: 20, radius: 46, damageType,
    })));
    expect(() => p.frame(input(w, events))).not.toThrow();
    for (let i = 0; i < 20; i++) p.frame(input(w));
    expect([...r.missing]).toEqual([]);
    for (const a of w.areas) {
      const here = r.frameShapes.filter((s) => Math.abs(s.x - a.x) < 1 && Math.abs(s.y - a.y) < 1);
      expect(here.length, a.kind).toBeGreaterThan(0);
      // The player's own ground, never in the danger red of hostile telegraphs.
      expect(here.filter((s) => s.color[0] > 0.9 && s.color[1] < 0.3), a.kind).toEqual([]);
    }
    const played = new Set(audio.plays.map((c) => c.id));
    for (const id of ['mortarBlast', 'glacialNovaBurst', 'stormCallStrike', 'wellCollapse'] as const) expect(played.has(id), id).toBe(true);
  });
});
