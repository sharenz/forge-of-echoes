import { beforeAll, describe, expect, it } from 'vitest';
import type { ArtBundle, SpriteDef } from '../../src/contracts/art';
import type { PresentInput } from '../../src/contracts/present';
import type { PropView, WorldView } from '../../src/contracts/sim';
import { generateSprites } from '../../src/art';
import { createPresenter, pickInteractiveProp } from '../../src/present';
import { emptyWorld, player, RecordingAudio, RecordingRenderer } from './helpers';

const prop = (id: number, kind: PropView['kind'], x: number, y: number, interactive = true, state = 0): PropView => ({
  id, kind, x, y, radius: 12, state, variant: 0, interactive,
});

describe('pickInteractiveProp', () => {
  const props = [
    prop(1, 'mapDevice', 0, -150),
    prop(2, 'stash', -180, 0),
    prop(3, 'merchant', 180, 0),
    prop(4, 'brazier', 0, 0, false),
    // The Crafting Bench: picked whether or not the sim flags it interactive.
    prop(5, 'anvil', -120, 90, false),
    // A portal flagged interactive counts only while open.
    prop(6, 'portal', 120, -60, true, 0),
  ];

  it('picks a prop when the cursor is over its art (bottom-centre anchored)', () => {
    expect(pickInteractiveProp(props, 0, -170)).toBe(1); // on the dais
    expect(pickInteractiveProp(props, -180, -10)).toBe(2);
    expect(pickInteractiveProp(props, 185, -30)).toBe(3); // Rook's head
    expect(pickInteractiveProp(props, -118, 82)).toBe(5); // the anvil's face
  });

  it('ignores empty floor, points below the base, non-interactive decor and closed portals', () => {
    expect(pickInteractiveProp(props, 0, -60)).toBe(-1);
    expect(pickInteractiveProp(props, -180, 20)).toBe(-1);
    expect(pickInteractiveProp(props, 0, -5)).toBe(-1); // the brazier is decor
    expect(pickInteractiveProp(props, -120, 100)).toBe(-1); // below the anvil's base
    expect(pickInteractiveProp(props, 120, -80)).toBe(-1); // closed portal
    const open = props.map((p) => (p.id === 6 ? { ...p, state: 3 } : p));
    expect(pickInteractiveProp(open, 120, -80)).toBe(6);
  });
});

describe('prop hover highlight', () => {
  let sprites: SpriteDef[];
  beforeAll(() => {
    sprites = generateSprites();
  });
  const art = (): ArtBundle => ({ sprites, icon: () => '', portrait: () => '', palette: {} });

  function hideout(props: PropView[]): WorldView {
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0, anim: 'idle' })]);
    w.theme = 'hideout';
    w.arenaRadius = 320;
    w.run = { ...w.run, phase: 'hideout', wave: 0 };
    w.props = props;
    return w;
  }

  function render(w: WorldView, hoverPropId: number): RecordingRenderer {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const input = (): PresentInput => ({
      world: w, localPlayerId: 1, alpha: 1, dt: 1 / 60, events: [], cursorWorld: { x: 0, y: 0 }, hoverPropId, hoverDropId: -1,
      settings: { screenShake: 0 }, paused: false,
    });
    p.frame(input());
    p.frame(input());
    return r;
  }

  const props = [
    prop(1, 'anvil', -60, 40, false),
    prop(2, 'portal', 60, -20, false, 8),
    prop(3, 'brazier', 0, 60, false),
    prop(4, 'stash', -100, -40, true),
  ];

  it('outlines and names the Crafting Bench', () => {
    const r = render(hideout(props), 1);
    expect(r.frameSprites.find((s) => s.id === 'prop/anvil')?.outline).toBeDefined();
    expect(r.frameTexts.some((t) => t.text === 'Crafting Bench')).toBe(true);
  });

  it('outlines an open portal and names it', () => {
    const r = render(hideout(props), 2);
    expect(r.frameSprites.find((s) => s.id === 'prop/portal')?.outline).toBeDefined();
    expect(r.frameTexts.some((t) => t.text === 'Enter Map')).toBe(true);
    expect(r.frameTexts.some((t) => t.text === '8 portals')).toBe(true);
  });

  it('never highlights decor, and nothing when no prop is hovered', () => {
    const decor = render(hideout(props), 3);
    expect(decor.frameSprites.filter((s) => s.id.startsWith('prop/') && s.outline)).toHaveLength(0);
    const none = render(hideout(props), -1);
    expect(none.frameSprites.filter((s) => s.id.startsWith('prop/') && s.outline)).toHaveLength(0);
    expect(none.frameTexts.some((t) => t.text === 'Crafting Bench' || t.text === 'Stash')).toBe(false);
  });

  it('the bench reads as a workstation even when not hovered: a hot glow and its own light', () => {
    const r = render(hideout([prop(1, 'anvil', -60, 40, false)]), -1);
    const glows = r.frameSprites.filter((s) => s.id === 'fx/glow' && Math.abs(s.x - -60) < 1 && s.y < 40);
    expect(glows.length).toBeGreaterThanOrEqual(1);
    expect(r.frameLights.some((l) => Math.abs(l.x - -60) < 1 && l.radius >= 40)).toBe(true);
  });
});
