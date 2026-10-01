// Wayside Anvil and Bellwatch on the ground: every zone and marker draws finite shapes on the decal/fx layers, in all three rosters,
// with the boon names, the Cantor labels and the bell.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ArtBundle, SpriteDef } from '../../src/contracts/art';
import type { MapEventView } from '../../src/contracts/map-events';
import type { PresentInput } from '../../src/contracts/present';
import type { SimEvent, WorldView } from '../../src/contracts/sim';
import { generateSprites } from '../../src/art';
import { createPresenter } from '../../src/present';
import { emptyWorld, player, RecordingAudio, RecordingRenderer } from './helpers';

let sprites: SpriteDef[];
beforeAll(() => { sprites = generateSprites(); });
const art = (): ArtBundle => ({ sprites, icon: () => '', portrait: () => '', palette: {} });
const input = (world: WorldView, events: SimEvent[] = []): PresentInput => ({
  world, localPlayerId: 1, alpha: 1, dt: 1 / 60, events, cursorWorld: { x: 0, y: 0 }, hoverPropId: -1, hoverDropId: -1,
  settings: { screenShake: 1 }, paused: false,
});
const view = (kind: MapEventView['kind'], over: Partial<MapEventView>): MapEventView =>
  ({ uid: 1, kind, phase: 'active', x: 0, y: 0, grade: 2, hint: 0, objectives: [], timers: [], zones: [], markers: [], ...over });

describe.each(['ashenForge', 'rimedOssuary', 'ironColiseum'] as const)('anvil and bellwatch art on %s', (theme) => {
  it('draws finite decal/fx shapes with labels', () => {
    const r = new RecordingRenderer();
    r.registerSprites(sprites);
    const p = createPresenter(r, art(), new RecordingAudio());
    const world = emptyWorld([player(1, 0, 0)]);
    (world as { theme: string }).theme = theme;
    world.run.events = [
      view('anvil', {
        zones: [{ kind: 'altar', x: 0, y: 0, r: 260, a: 0, v: 100, n: 1 },
          { kind: 'stone', x: 60, y: 0, r: 24, a: 0, v: 40, n: 0 }, { kind: 'stone', x: -60, y: 0, r: 24, a: 0, v: 0, n: 1 * 16 },
          { kind: 'stone', x: 0, y: 60, r: 24, a: 0, v: 255, n: 2 * 16 + 9 }, { kind: 'stone', x: 0, y: -60, r: 24, a: 0, v: 254, n: 3 * 16 }],
        markers: [{ icon: 'anvil', x: 0, y: 0, v: 100, w: 1 }],
      }),
      view('bellwatch', {
        x: 200, y: 100,
        markers: [{ icon: 'bell', x: 200, y: 100, v: 3, w: 90 }, { icon: 'cantor', x: 260, y: 120, v: 1, w: 80 }, { icon: 'cantor', x: 120, y: 60, v: 0, w: 50 }],
      }),
    ];
    expect(() => { p.frame(input(world)); p.frame(input(world, [{ t: 'mapEvent', kind: 'bellwatch', beat: 'toll', x: 200, y: 100, n: 3 }])); }).not.toThrow();
    expect(r.frameShapes.length).toBeGreaterThan(60);
    expect(r.frameShapes.every(s => Number.isFinite(s.alpha))).toBe(true);
    const texts = r.frameTexts.map(t => t.text);
    expect(texts).toEqual(expect.arrayContaining(['Charged', 'Tempered', 'Keen', 'Bell', 'Cantor', 'Cantor (shielded)']));
    expect(texts.some(t => t.startsWith('Attuned: '))).toBe(true);
  });
});
