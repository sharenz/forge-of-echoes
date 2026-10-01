// The layout art kit and layout ground art in the presenter: every one of the 14 new props draws (no missing sprite), kit
// props follow their solid radius, and an area with a layout gets its decals, landmarks and light pools from `areaId`.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ArtBundle, SpriteDef } from '../../src/contracts/art';
import type { PresentInput } from '../../src/contracts/present';
import type { PropKind, PropView, WorldView } from '../../src/contracts/sim';
import { generateSprites } from '../../src/art';
import { overrideLayout } from '../../src/data/layouts';
import { SLAG_YARD } from '../../src/data/layouts/fixtures';
import { LAYOUT_PROP_RADIUS } from '../../src/data/layouts/schema';
import { createPresenter } from '../../src/present';
import { emptyWorld, player, RecordingAudio, RecordingRenderer } from './helpers';

const KIT: PropKind[] = ['vat', 'bellows', 'altar', 'sarcophagus', 'choirStall', 'ribArch', 'iceColumn', 'crate', 'chainPost', 'hoist', 'gate', 'weaponRack', 'obelisk', 'statue'];

let sprites: SpriteDef[];
beforeAll(() => {
  sprites = generateSprites();
});
const art = (): ArtBundle => ({ sprites, icon: () => '', portrait: () => '', palette: {} });

function map(props: PropView[], over: Partial<WorldView> = {}): WorldView {
  const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0, anim: 'idle' })]);
  w.theme = 'ashenForge';
  w.arenaRadius = 990;
  w.props = props;
  return { ...w, ...over };
}

function render(w: WorldView, frames = 2): RecordingRenderer {
  const r = new RecordingRenderer();
  const p = createPresenter(r, art(), new RecordingAudio());
  const input = (): PresentInput => ({
    world: w, localPlayerId: 1, alpha: 1, dt: 1 / 60, events: [], cursorWorld: { x: 0, y: 0 }, hoverPropId: -1, hoverDropId: -1,
    settings: { screenShake: 0 }, paused: false,
  });
  for (let k = 0; k < frames; k++) p.frame(input());
  return r;
}

describe('layout art kit', () => {
  it('ships a bottom-centre anchored sprite of frame pairs (0 lit / 1 cold, 2-3 an alternate figure) for every new kind', () => {
    for (const k of KIT) {
      const s = sprites.find((d) => d.id === `prop/${k}`);
      expect(s, k).toBeDefined();
      expect(s!.frames.length % 2).toBe(0);
      expect(s!.frames.length).toBeGreaterThanOrEqual(2);
      expect(s!.anchorX).toBe(Math.floor(s!.width / 2));
      expect(s!.anchorY).toBe(s!.height - 1);
    }
  });

  it('draws every kind with no missing sprite, honouring the variant and the solid radius', () => {
    const props: PropView[] = KIT.map((kind, i) => ({
      id: i + 1, kind, x: (i % 7) * 60 - 180, y: Math.floor(i / 7) * 70 - 30, radius: LAYOUT_PROP_RADIUS[kind], state: 0, variant: i % 2, interactive: false,
    }));
    const r = render(map(props));
    expect(r.missing.size).toBe(0);
    for (const kind of KIT) expect(r.frameSprites.some((s) => s.id === `prop/${kind}`), kind).toBe(true);
    // a resized prop scales its sprite
    const big = render(map([{ id: 1, kind: 'vat', x: 0, y: 0, radius: 60, state: 0, variant: 0, interactive: false }]));
    expect(big.frameSprites.find((s) => s.id === 'prop/vat')?.scale).toBeCloseTo(2, 1);
  });

  it('lights molten vats and glowing obelisks', () => {
    const r = render(map([
      { id: 1, kind: 'vat', x: 0, y: 0, radius: 30, state: 0, variant: 0, interactive: false },
      { id: 2, kind: 'obelisk', x: 80, y: 0, radius: 10, state: 0, variant: 0, interactive: false },
    ]));
    expect(r.frameLights.length).toBeGreaterThanOrEqual(2);
  });
});

describe('layout ground art', () => {
  it('draws nothing extra for an area whose layout is switched off', () => {
    const restore = overrideLayout(null, 'furnaceYard');
    try {
      const plain = render(map([]));
      const withId = render(map([], { areaId: 'furnaceYard' }));
      expect(withId.frameShapes.length).toBe(plain.frameShapes.length);
    } finally {
      restore();
    }
  });

  it('draws the layout decals, landmarks and light pools of the area in view', () => {
    const restore = overrideLayout(SLAG_YARD);
    try {
      const plain = render(map([]));
      const lay = render(map([], { areaId: 'furnaceYard' }));
      expect(lay.missing.size).toBe(0);
      // the crucible landmark sits at the origin: discs and rings the plain arena does not have
      expect(lay.frameShapes.length).toBeGreaterThan(plain.frameShapes.length);
      expect(lay.frameLights.length).toBeGreaterThan(plain.frameLights.length);
    } finally {
      restore();
    }
  });
});
