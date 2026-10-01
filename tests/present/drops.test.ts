// Ground drops: Presenter.dropAt hit-testing against the stacked label layout and the drop sprites, public-drop
// visibility and label styling (bone border + "ground" pip), the hover highlight, and pickup feedback by picker.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ArtBundle, SpriteDef } from '../../src/contracts/art';
import type { PresentInput } from '../../src/contracts/present';
import type { DropSpec, DropTone, DropView, SimEvent, WorldView } from '../../src/contracts/sim';
import { generateSprites } from '../../src/art';
import { createPresenter } from '../../src/present';
import { TONE_COLOR } from '../../src/present/colors';
import { dropLabelLook, isDropVisible, isPublicDrop, PUBLIC_BORDER, PUBLIC_PIP } from '../../src/present/drops';
import { emptyWorld, player, RecordingAudio, RecordingRenderer, type TextCall } from './helpers';

let sprites: SpriteDef[];
beforeAll(() => {
  sprites = generateSprites();
});

function art(): ArtBundle {
  return { sprites, icon: () => '', portrait: () => '', palette: {} };
}

const LOCAL = 1;

function spec(owner: number, label: string, tone: DropTone = 'rare'): DropSpec {
  const sprite = tone === 'currency' ? 'currency' : tone === 'map' ? 'map' : tone === 'flask' ? 'flask' : 'equipment';
  return { token: 0, owner, autoPickup: sprite !== 'equipment' && owner !== 0, label, tone, sprite, iconId: 'icon/base/emberRing' };
}

function drop(id: number, owner: number, x: number, y: number, label: string, tone: DropTone = 'rare'): DropView {
  return { id, spec: spec(owner, label, tone), x, y, prevX: x, prevY: y, z: 0, age: 1, blocked: false };
}

function world(drops: DropView[]): WorldView {
  const w = emptyWorld([player(LOCAL, 0, 0, { vx: 0, prevX: 0, anim: 'idle' })]);
  w.drops = drops;
  return w;
}

function input(w: WorldView, hoverDropId = -1, events: SimEvent[] = []): PresentInput {
  return {
    world: w, localPlayerId: LOCAL, alpha: 1, dt: 1 / 60, events, cursorWorld: { x: 0, y: 0 }, hoverPropId: -1, hoverDropId,
    settings: { screenShake: 0 }, paused: false,
  };
}

function setup(drops: DropView[]) {
  const r = new RecordingRenderer();
  const audio = new RecordingAudio();
  const p = createPresenter(r, art(), audio);
  const w = world(drops);
  p.frame(input(w));
  p.frame(input(w));
  /** CSS point of a world position under the presenter's camera. */
  const css = (x: number, y: number) => r.worldToScreen(x, y, p.camera);
  /** Click at a world position. */
  const at = (x: number, y: number) => {
    const c = css(x, y);
    return p.dropAt(c.x, c.y);
  };
  const label = (text: string): TextCall => {
    const t = r.frameTexts.find((c) => c.text === text);
    if (!t) throw new Error(`no label "${text}"`);
    return t;
  };
  return { r, p, w, audio, at, css, label };
}

describe('Presenter.dropAt', () => {
  it('returns −1 before the first frame and over empty floor', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    expect(p.dropAt(640, 360)).toBe(-1);
    const s = setup([drop(7, LOCAL, 40, 20, 'Grave Coil')]);
    expect(s.at(-150, -100)).toBe(-1);
    expect(s.p.dropAt(Number.NaN, 10)).toBe(-1);
  });

  it('hits a drop by its label plate and by its sprite', () => {
    const s = setup([drop(7, LOCAL, 40, 20, 'Grave Coil')]);
    const t = s.label('Grave Coil');
    expect(s.at(t.x, t.y)).toBe(7);
    // The plate's left and right ends (measureText: 6 px per glyph; padding 2).
    const half = ('Grave Coil'.length * 6) / 2;
    expect(s.at(t.x - half - 1, t.y)).toBe(7);
    expect(s.at(t.x + half + 1, t.y)).toBe(7);
    expect(s.at(t.x + half + 6, t.y)).toBe(-1);
    // The sprite (bottom-centre anchored at the drop's feet).
    expect(s.at(40, 16)).toBe(7);
  });

  it('follows the stacked label layout: each plate of a pile picks its own drop', () => {
    const names = ['Ember Bite', 'Grave Coil', 'Ashen Robe', 'Forge Scrap', 'Rime Essence'];
    const pile = names.map((n, i) => drop(10 + i, i === 3 ? 0 : LOCAL, 30 + (i % 2), 40, n, i === 3 ? 'normal' : 'magic'));
    const s = setup(pile);
    const texts = names.map((n) => s.label(n));
    // Stacked: every label at its own height.
    expect(new Set(texts.map((t) => Math.round(t.y))).size).toBe(names.length);
    texts.forEach((t, i) => expect(s.at(t.x, t.y)).toBe(10 + i));
    // Between two stacked plates there is no gap wide enough to fall through to the floor.
    const ys = texts.map((t) => t.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(s.at(31, (ys[i - 1] + ys[i]) / 2)).toBeGreaterThanOrEqual(10);
  });

  it('prefers a label plate over another drop\'s sprite under it', () => {
    // B's sprite pokes into A's label plate from the right (A's label: 16 px above A plus the 13 px plate,
    // ±32 px wide for "Ember Bite").
    const a = drop(1, LOCAL, 0, 60, 'Ember Bite');
    const b = drop(2, LOCAL, 30, 40, 'Grave Coil');
    const s = setup([a, b]);
    const t = s.label('Ember Bite');
    expect(t.y).toBeCloseTo(36.5, 5);
    // On both A's plate and B's sprite: the plate (an overlay) wins.
    expect(s.at(28, 36)).toBe(1);
    // Right of the plate, still on B's sprite: B.
    expect(s.at(35, 36)).toBe(2);
  });

  it('never hits other players\' instanced loot, but does hit public drops', () => {
    const s = setup([drop(3, 2, 60, 0, 'Their Ring'), drop(4, 0, -60, 0, 'Dropped Ring')]);
    expect(s.r.frameTexts.some((t) => t.text === 'Their Ring')).toBe(false);
    expect(s.at(60, -3)).toBe(-1);
    const t = s.label('Dropped Ring');
    expect(s.at(t.x, t.y)).toBe(4);
    expect(s.at(-60, -3)).toBe(4);
  });

  it('hover is stable when fed back frame to frame: along a plate\'s bottom edge and on the seam of a stack', () => {
    // The client loop: dropAt under the cursor → next frame's hoverDropId → the hovered plate lifts a pixel.
    const s = setup([drop(1, LOCAL, 0, 60, 'Ember Bite'), drop(2, LOCAL, 0, 60, 'Grave Coil')]);
    const lower = s.label('Ember Bite');
    const upper = s.label('Grave Coil');
    // Plate top = text y − (padding 2 + 3.5); plates are 13 px tall and stacked 2 px apart.
    const lowerTop = lower.y - 5.5;
    const upperTop = upper.y - 5.5;
    expect(lowerTop - (upperTop + 13)).toBeCloseTo(2, 5);
    const run = (x: number, y: number, frames = 8): number[] => {
      let hover = -1;
      const ids: number[] = [];
      for (let i = 0; i < frames; i++) {
        s.p.frame(input(s.w, hover));
        hover = s.at(x, y);
        ids.push(hover);
      }
      return ids;
    };
    // Just below the lower plate, inside the 1 px click slack.
    const edge = run(3, lowerTop + 13 + 0.6);
    expect(edge[0]).toBe(1);
    expect(new Set(edge).size).toBe(1);
    // The pixel row both plates' slack covers: whichever wins first keeps it.
    const seam = run(-3, upperTop + 13 + 1);
    expect(seam[0]).toBeGreaterThan(0);
    expect(new Set(seam).size).toBe(1);
    // Right at the lifted top of the hovered lower plate (the pixel it lifted into) it stays hovered too.
    const top = run(3, lowerTop - 1.5);
    expect(new Set(top.slice(1)).size).toBe(1);
  });

  it('a hovered plate grows by its lift instead of moving: the resting box still picks it', () => {
    const s = setup([drop(9, LOCAL, 10, 30, 'Plain Wraps', 'normal')]);
    const t = s.label('Plain Wraps');
    const bottom = t.y - 5.5 + 13;
    s.p.frame(input(s.w, 9));
    // One world pixel under the resting plate (the slack row) and its lifted top row both pick the hovered drop.
    expect(s.at(t.x, bottom + 0.9)).toBe(9);
    expect(s.at(t.x, t.y - 5.5 - 1.9)).toBe(9);
    expect(s.at(t.x, bottom + 1.5)).not.toBe(9);
  });

  it('forgets the layout on a zone reset', () => {
    const s = setup([drop(7, LOCAL, 40, 20, 'Grave Coil')]);
    const t = s.label('Grave Coil');
    s.p.reset(world([]), LOCAL);
    expect(s.at(t.x, t.y)).toBe(-1);
  });
});

describe('drop label styling', () => {
  it('shows own loot and public drops only', () => {
    expect(isDropVisible(spec(LOCAL, 'a'), LOCAL)).toBe(true);
    expect(isDropVisible(spec(0, 'a'), LOCAL)).toBe(true);
    expect(isDropVisible(spec(2, 'a'), LOCAL)).toBe(false);
    expect(isPublicDrop(spec(0, 'a'))).toBe(true);
    expect(isPublicDrop(spec(LOCAL, 'a'))).toBe(false);
  });

  it('own loot: tone text, dimmed tone border except on plain items and currency, no pip', () => {
    const rare = dropLabelLook('rare', false, false);
    expect(rare.text).toEqual(TONE_COLOR.rare);
    expect(rare.border).toBeDefined();
    rare.border!.forEach((c, i) => expect(c).toBeCloseTo(TONE_COLOR.rare[i] * 0.45, 5));
    expect(rare.pip).toBeUndefined();
    expect(rare.lift).toBe(0);
    expect(dropLabelLook('normal', false, false).border).toBeUndefined();
    expect(dropLabelLook('currency', false, false).border).toBeUndefined();
  });

  it('public drops: rarity-coloured text, neutral bone border and the ground pip, whatever the tone', () => {
    for (const tone of ['normal', 'magic', 'rare', 'unique', 'currency', 'map', 'flask'] as const) {
      const look = dropLabelLook(tone, true, false);
      expect(look.text).toEqual(TONE_COLOR[tone]);
      expect(look.border).toBe(PUBLIC_BORDER);
      expect(look.pip).toBe(PUBLIC_PIP);
    }
    // The public border is neutral: never one of the rarity colours.
    for (const c of Object.values(TONE_COLOR)) expect(PUBLIC_BORDER).not.toEqual(c);
  });

  it('hovered: brighter plate, full tone border, whiter text, lifted — for own and public drops', () => {
    for (const pub of [false, true]) {
      const rest = { ...dropLabelLook('magic', pub, false) };
      const hover = dropLabelLook('magic', pub, true);
      expect(hover.border).toEqual(TONE_COLOR.magic);
      expect(hover.plateAlpha).toBeGreaterThan(rest.plateAlpha);
      expect(hover.plate[0] + hover.plate[1] + hover.plate[2]).toBeGreaterThan(rest.plate[0] + rest.plate[1] + rest.plate[2]);
      expect(hover.text[2]).toBeGreaterThan(TONE_COLOR.magic[2] - 1e-9);
      expect(hover.text[0]).toBeGreaterThan(TONE_COLOR.magic[0]);
      expect(hover.lift).toBeGreaterThan(0);
      expect(hover.pip).toBe(pub ? PUBLIC_PIP : undefined);
    }
  });

  it('draws the pip only on public labels, and shifts their text right of it', () => {
    const s = setup([drop(1, LOCAL, -80, 20, 'Own Ring'), drop(2, 0, 80, 20, 'Floor Ring')]);
    const pips = s.r.frameShapes.filter((c) => c.layer === 'top' && c.kind === 'rect' && c.color[0] === PUBLIC_PIP[0] && c.color[2] === PUBLIC_PIP[2]);
    // A 5 px diamond (5×1 + 3×3 + 1×5), left of the public label's text, inside its plate.
    expect(pips).toHaveLength(3);
    const floor = s.label('Floor Ring');
    const left = floor.x - ('Floor Ring'.length * 6) / 2;
    expect(pips.every((c) => c.x2 <= left - 2 + 1e-9 && c.x >= left - 7 - 1e-9)).toBe(true);
    expect(Math.max(...pips.map((c) => c.x2)) - Math.min(...pips.map((c) => c.x))).toBeCloseTo(5, 5);
    expect(Math.max(...pips.map((c) => c.y2)) - Math.min(...pips.map((c) => c.y))).toBeCloseTo(5, 5);
    expect(s.label('Own Ring').x).toBeCloseTo(-80, 5);
    expect(floor.x).toBeCloseTo(83.5, 5);
    // Public border rects in bone.
    expect(s.r.frameShapes.some((c) => c.layer === 'top' && c.color[0] === PUBLIC_BORDER[0] && c.color[1] === PUBLIC_BORDER[1])).toBe(true);
  });

  it('highlights the hovered drop: tone-colour border, a one-pixel lift and an outlined sprite', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = world([drop(5, LOCAL, 20, 30, 'Plain Wraps', 'normal')]);
    p.frame(input(w));
    p.frame(input(w));
    const restY = r.frameTexts.find((t) => t.text === 'Plain Wraps')!.y;
    expect(r.frameSprites.find((c) => c.id === 'drop/equipment')!.outline).toBeUndefined();
    p.frame(input(w, 5));
    const hoverY = r.frameTexts.find((t) => t.text === 'Plain Wraps')!.y;
    expect(hoverY).toBeCloseTo(restY - 1, 5);
    const col = TONE_COLOR.normal;
    const border = r.frameShapes.filter((c) => c.layer === 'top' && c.color[0] === col[0] && c.color[1] === col[1] && c.color[2] === col[2]);
    expect(border.length).toBe(4);
    expect(r.frameSprites.find((c) => c.id === 'drop/equipment')!.outline).toEqual([...col]);
    // The highlighted plate is still exactly where dropAt looks.
    const t = r.frameTexts.find((c) => c.text === 'Plain Wraps')!;
    const c = r.worldToScreen(t.x, t.y, p.camera);
    expect(p.dropAt(c.x, c.y)).toBe(5);
  });
});

describe('pickup feedback', () => {
  it('sounds only for the local player; an ally lifting a public drop is a silent poof', () => {
    const r = new RecordingRenderer();
    const audio = new RecordingAudio();
    const p = createPresenter(r, art(), audio);
    const w = world([]);
    p.frame(input(w));
    const particles = r.particles;
    p.frame(input(w, -1, [{ t: 'pickup', owner: 0, playerId: 2, tone: 'rare', x: 30, y: 10, label: 'Floor Ring' }]));
    expect(audio.plays.some((c) => c.id === 'pickupItem' || c.id === 'pickupCurrency')).toBe(false);
    expect(r.particles).toBeGreaterThan(particles);
    p.frame(input(w, -1, [{ t: 'pickup', owner: 0, playerId: LOCAL, tone: 'rare', x: 30, y: 10, label: 'Floor Ring' }]));
    expect(audio.plays.filter((c) => c.id === 'pickupItem')).toHaveLength(1);
  });

  it('a public drop lands with a soft thud, never the rarity fanfare', () => {
    const r = new RecordingRenderer();
    const audio = new RecordingAudio();
    const p = createPresenter(r, art(), audio);
    const w = world([]);
    p.frame(input(w, -1, [{ t: 'dropSpawn', owner: 0, tone: 'unique', x: 30, y: 10, label: 'Floor Ring' }]));
    for (let i = 0; i < 40; i++) p.frame(input(w));
    expect(audio.plays.map((c) => c.id)).toEqual(['dropNormal']);
    expect(r.lastPost?.flash).toBeUndefined();
  });
});
