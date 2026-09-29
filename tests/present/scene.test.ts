// Scene-level presenter checks against the recording renderer: light culling by reach, elite presence, the charge
// lane, off-screen marker visibility, party colours, readability (actor vs floor brightness from the art's albedo)
// and danger convergence (meteor showers bunched on one spot never sum into a white blob over the player).
import { beforeAll, describe, expect, it } from 'vitest';
import type { ArtBundle, SpriteDef } from '../../src/contracts/art';
import { MONSTER_KINDS } from '../../src/contracts/content';
import type { PresentInput } from '../../src/contracts/present';
import { RARITY_CODE, type AreaView, type PropView, type SimEvent, type WorldView } from '../../src/contracts/sim';
import { generateSprites } from '../../src/art';
import { createPresenter, PARTY_COLORS, partyColorSlots, THEME_LOOKS } from '../../src/present';
import { TONE_COLOR } from '../../src/present/colors';
import { meanFloorShade } from '../../src/present/themes';
import { addMonster, emptyWorld, player, RecordingAudio, RecordingRenderer } from './helpers';

let sprites: SpriteDef[];
beforeAll(() => {
  sprites = generateSprites();
});

function art(): ArtBundle {
  return { sprites, icon: () => '', portrait: () => '', palette: {} };
}

function input(world: WorldView, localPlayerId = 1): PresentInput {
  return {
    world, localPlayerId, alpha: 1, dt: 1 / 60, events: [], cursorWorld: { x: 0, y: 0 }, hoverPropId: -1, hoverDropId: -1,
    settings: { screenShake: 1 }, paused: false,
  };
}

/** Render `frames` frames of `world` and return the renderer (its frame* lists hold the last frame). */
function render(world: WorldView, frames = 2, localPlayerId = 1): RecordingRenderer {
  const r = new RecordingRenderer();
  const p = createPresenter(r, art(), new RecordingAudio());
  for (let i = 0; i < frames; i++) p.frame(input(world, localPlayerId));
  return r;
}

const kind = (k: (typeof MONSTER_KINDS)[number]) => MONSTER_KINDS.indexOf(k);
const prop = (id: number, k: PropView['kind'], x: number, y: number): PropView => ({ id, kind: k, x, y, radius: 8, state: 0, variant: 0, interactive: false });

describe('light culling by reach', () => {
  it('a brazier just above the screen still lights the visible floor', () => {
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    // View ≈ y −186…174 around the player; the brazier's sprite is culled, its light (y − 26, radius 124) is not.
    w.props = [prop(1, 'brazier', 0, -250)];
    const r = render(w);
    expect(r.frameSprites.some((s) => s.id === 'prop/brazier')).toBe(false);
    expect(r.frameLights.some((l) => l.radius === 124 && Math.abs(l.y - -276) < 1)).toBe(true);
  });

  it('a prop whose light cannot reach the screen emits nothing', () => {
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    w.props = [prop(1, 'brazier', 0, -600)];
    const r = render(w);
    expect(r.frameLights.some((l) => l.radius === 124)).toBe(false);
  });

  it("the Matriarch's glow stays on while she is just off screen", () => {
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    addMonster(w, 0, kind('cinderMatriarch'), RARITY_CODE.boss, 0, 340, 24);
    const r = render(w);
    expect(r.frameSprites.some((s) => s.id.startsWith('monster/cinderMatriarch/'))).toBe(false);
    expect(r.frameLights.some((l) => l.radius === 190)).toBe(true);
  });
});

describe('elite presence', () => {
  it('a rare leader glows gold: its own light and a ground glow under it', () => {
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    addMonster(w, 0, kind('ashling'), RARITY_CODE.rare, 80, 40, 6);
    const r = render(w);
    expect(r.frameLights.some((l) => l.radius === 40 + 6 * 2 && Math.abs(l.x - 80) < 1)).toBe(true);
    expect(r.frameSprites.some((s) => s.id === 'fx/glow' && s.layer === 'decal' && Math.abs(s.x - 80) < 1)).toBe(true);
  });

  it('keeps a rare name plate on screen when its leader stands at the edge', () => {
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    addMonster(w, 0, kind('ashling'), RARITY_CODE.rare, 318, 40, 6);
    w.monsters.mods[0] = 8 | 16;
    const r = render(w);
    const name = r.frameTexts.find((t) => t.text.includes('Ashling'));
    expect(name).toBeDefined();
    const half = (name!.text.length * 6) / 2;
    expect(name!.x + half).toBeLessThanOrEqual(320);
  });
});

describe('charge lane', () => {
  it('draws the Matriarch charge segments as one lane, and ordinary slams as circles', () => {
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    const areas: AreaView[] = [];
    for (let s = 0; s < 6; s++) {
      areas.push({ id: 10 + s, kind: 'slamWarning', x: -120 + 17 + s * 34, y: 20, radius: 26, age: 0.4, duration: 0.9 + (17 + s * 34) / 480 });
    }
    areas.push({ id: 99, kind: 'slamWarning', x: 60, y: -80, radius: 42, age: 0.3, duration: 0.9 });
    w.areas = areas;
    const r = render(w);
    expect(r.frameShapes.some((s) => s.kind === 'ring' && s.radius === 26)).toBe(false);
    expect(r.frameShapes.some((s) => s.kind === 'line' && s.thickness === 52)).toBe(true);
    expect(r.frameShapes.some((s) => s.kind === 'ring' && s.radius === 42)).toBe(true);
  });
});

describe('off-screen markers', () => {
  it('no Herald marker while its name plate is on screen, one when it is out of sight', () => {
    const near = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    addMonster(near, 0, kind('ashboundHerald'), RARITY_CODE.lieutenant, 0, 200, 14);
    expect(render(near).frameTexts.some((t) => t.text === 'Herald')).toBe(false);
    const far = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    addMonster(far, 0, kind('ashboundHerald'), RARITY_CODE.lieutenant, 0, 420, 14);
    expect(render(far).frameTexts.some((t) => t.text === 'Herald')).toBe(true);
  });
});

describe('party colours', () => {
  it('depend only on the set of names, never on join order', () => {
    const names = ['Ysolde', 'Maren', 'Ashka', 'Veyla'];
    const a = partyColorSlots(names);
    const b = partyColorSlots([...names].reverse()).reverse();
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(4);
    for (const s of a) expect(s).toBeGreaterThanOrEqual(0);
    for (const s of a) expect(s).toBeLessThan(PARTY_COLORS.length);
  });

  it('a name keeps its colour when the others in the zone change', () => {
    // Alone, every name gets its preferred colour; with company it keeps it unless an earlier name took it.
    const solo = partyColorSlots(['Maren'])[0];
    const duo = partyColorSlots(['Maren', 'Zed']);
    const other = partyColorSlots(['Zed'])[0];
    if (other !== solo) expect(duo[0]).toBe(solo);
    expect(duo[0]).not.toBe(duo[1]);
  });

  it('allies wear the same plate colour on every client', () => {
    // Two friends' clients: different local players, different join order in the view.
    const w1 = emptyWorld([player(1, 0, 0, { name: 'Ysolde' }), player(2, 40, 0, { name: 'Maren' }), player(3, -40, 0, { name: 'Ashka' })]);
    const w2 = emptyWorld([player(3, -40, 0, { name: 'Ashka' }), player(2, 40, 0, { name: 'Maren' }), player(1, 0, 0, { name: 'Ysolde' })]);
    const r1 = render(w1, 2, 1);
    const r2 = render(w2, 2, 2);
    const plate = (r: RecordingRenderer, name: string) => r.frameTexts.find((t) => t.text === name)?.color;
    expect(plate(r1, 'Ashka')).toBeDefined();
    expect(plate(r1, 'Ashka')).toEqual(plate(r2, 'Ashka'));
    const slots = partyColorSlots(['Ysolde', 'Maren', 'Ashka']);
    expect(plate(r1, 'Ashka')).toEqual([...PARTY_COLORS[slots[2]]]);
    expect(plate(r2, 'Ysolde')).toEqual([...PARTY_COLORS[slots[0]]]);
  });
});

describe('zone entry', () => {
  it('snaps the camera onto the local player when she first appears after a reset (no pan from the origin)', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const map = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    p.frame(input(map));
    // 'zone' message: the ClientWorld is cleared, no snapshot yet.
    const hideout = emptyWorld([]);
    hideout.theme = 'hideout';
    hideout.arenaRadius = 320;
    p.reset(hideout, 1);
    p.frame(input(hideout));
    // First snapshot: she stands at the hideout entry.
    hideout.players.push(player(1, 180, 90, { vx: 0, prevX: 180 }));
    p.frame({ ...input(hideout), cursorWorld: { x: 180, y: 90 } });
    expect(Math.abs(p.camera.x - 180)).toBeLessThan(2);
    expect(Math.abs(p.camera.y - (90 - 6))).toBeLessThan(2);
  });
});

describe('echo motes', () => {
  it('streak length follows the on-screen motion, not the snapshot gap (network path)', () => {
    const r = new RecordingRenderer();
    const p = createPresenter(r, art(), new RecordingAudio());
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    const m = w.motes;
    m.alive[0] = 1;
    m.count = 1;
    for (let f = 0; f < 4; f++) {
      // Interpolated between two snapshots 60 units apart; it moves 8 units per rendered frame.
      m.prevX[0] = 40 + f * 8 - 60;
      m.x[0] = 40 + f * 8;
      m.prevY[0] = m.y[0] = 30;
      p.frame(input(w));
    }
    const streaks = r.frameShapes.filter((s) => s.kind === 'line' && s.layer === 'fx');
    expect(streaks.length).toBe(1);
    const len = Math.hypot(streaks[0].x2 - streaks[0].x, streaks[0].y2 - streaks[0].y);
    expect(len).toBeLessThanOrEqual(16.01);
  });

  it('a pile of motes on one spot lights the floor once', () => {
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    const m = w.motes;
    for (let i = 0; i < 50; i++) {
      m.alive[i] = 1;
      m.x[i] = m.prevX[i] = 100 + (i % 5);
      m.y[i] = m.prevY[i] = 40 + (i % 3);
      m.size[i] = 2;
    }
    m.count = 50;
    const r = render(w);
    const pileLights = r.frameLights.filter((l) => Math.abs(l.x - 102) < 8 && Math.abs(l.y - 36) < 8 && l.radius === 30);
    expect(pileLights.length).toBeLessThanOrEqual(1);
  });
});

describe('readability', () => {
  const MAPS = ['ashenForge', 'rimedOssuary', 'ironColiseum'] as const;
  const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  /** src/render: actors ('world' sprites) receive 2.5× the frame ambient in total (the actor lift). */
  const ACTOR_FILL = 2.5;
  /** Mean luminance (0..1) of the opaque pixels of every frame of a sprite. */
  const albedo = (id: string): number => {
    const def = sprites.find((d) => d.id === id);
    if (!def) throw new Error(`no sprite ${id}`);
    let sum = 0;
    let n = 0;
    for (const f of def.frames) {
      for (let i = 0; i < f.data.length; i += 4) {
        if (f.data[i + 3] < 128) continue;
        sum += lum([f.data[i], f.data[i + 1], f.data[i + 2]]) / 255;
        n++;
      }
    }
    return sum / n;
  };
  const floorAlbedo = (t: keyof typeof THEME_LOOKS) => albedo(`tile/${t}/floor`) * meanFloorShade(THEME_LOOKS[t]);

  it('outside the light, every monster stands a clear step above every floor (the brightness pass keeps the gap)', () => {
    const roster = MONSTER_KINDS.filter((k) => k !== 'trainingDummy');
    for (const t of [...MAPS, 'hideout'] as const) {
      // Both sides scale with the ambient and the exposure, so the ratio is the art's albedo and the floor shade.
      const ratios = roster.map((k) => (albedo(`monster/${k}/idle`) * ACTOR_FILL) / floorAlbedo(t)).sort((a, b) => a - b);
      expect(ratios[0], t).toBeGreaterThanOrEqual(1.75);
      expect(ratios[ratios.length >> 1], t).toBeGreaterThanOrEqual(2.1);
    }
  });

  it('the unlit floor between the light pools is never near-black, and the mood stays', () => {
    for (const t of [...MAPS, 'hideout'] as const) {
      const look = THEME_LOOKS[t];
      // Displayed floor (0..255, before grading) lit by the ambient alone.
      const dark = floorAlbedo(t) * lum(look.ambient) * look.exposure * 255;
      expect(dark, t).toBeGreaterThanOrEqual(10);
      // Moody, not flat: the ambient stays well below daylight, the vignette frames the scene, no tile is pushed
      // past its authored brightness.
      expect(lum(look.ambient)).toBeLessThan(0.4);
      expect(look.vignette).toBeGreaterThanOrEqual(0.3);
      expect(look.floor).toBeLessThanOrEqual(1);
      expect(look.detail).toBeLessThanOrEqual(1);
      expect(look.exposure).toBeLessThanOrEqual(1.2);
    }
  });

  it('the monster rim is dim and neutral: never a glow, never a rarity colour', () => {
    for (const t of [...MAPS, 'hideout'] as const) {
      const rim = THEME_LOOKS[t].monsterRim;
      expect(lum(rim)).toBeGreaterThan(0.15);
      expect(lum(rim)).toBeLessThan(0.4);
      for (const c of Object.values(TONE_COLOR)) expect(rim).not.toEqual(c);
    }
  });

  it('normal monsters carry the theme rim; magic ones keep their blue outline', () => {
    for (const t of MAPS) {
      const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
      w.theme = t;
      addMonster(w, 0, kind('ashling'), RARITY_CODE.normal, 40, 20);
      addMonster(w, 1, kind('ashling'), RARITY_CODE.magic, -40, 20);
      const r = render(w);
      const bodies = r.frameSprites.filter((c) => c.id.startsWith('monster/ashling/'));
      expect(bodies).toHaveLength(2);
      const normal = bodies.find((c) => c.x === 40)!;
      const magic = bodies.find((c) => c.x === -40)!;
      expect(normal.outline).toEqual([...THEME_LOOKS[t].monsterRim]);
      expect(magic.outline![2]).toBeGreaterThan(magic.outline![0]);
    }
  });
});

describe('danger convergence', () => {
  const meteor = (id: number, x: number, y: number, k: number): AreaView => ({
    id, kind: 'meteorWarning', x, y, radius: 28, age: 0.9, duration: 1.1 + k * 0.12,
  });
  /** Total intensity of the meteor telegraph (radius 28 × 1.3 + 12) and falling-rock (54) lights. */
  const meteorLight = (r: RecordingRenderer) =>
    r.frameLights.filter((l) => Math.abs(l.radius - 48.4) < 0.01 || l.radius === 54).reduce((s, l) => s + l.intensity, 0);
  const shower = (n: number, spread: number) => {
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    // Bunched: every rock clamped onto one spot against the rim; spread: each on its own spot.
    w.areas = Array.from({ length: n }, (_, k) => meteor(100 + k, 30 + (k % 4) * spread, 20 + Math.floor(k / 4) * spread, k));
    return meteorLight(render(w));
  };

  it('ten meteors bunched on one spot light it like three, while a spread-out shower lights every spot', () => {
    const one = shower(1, 0);
    const three = shower(3, 0);
    const ten = shower(10, 0);
    expect(one).toBeGreaterThan(0);
    expect(three).toBeLessThan(one * 2);
    expect(ten).toBeCloseTo(three, 5);
    expect(shower(10, 60)).toBeGreaterThan(ten * 2.5);
  });

  it('a pack leaping at one spot shares one fill and one rim, while every distinct circle keeps its full outline', () => {
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
    const leap = (id: number, x: number, radius: number): AreaView => ({ id, kind: 'leapWarning', x, y: 10, radius, age: 0.3, duration: 0.8 });
    w.areas = Array.from({ length: 6 }, (_, k) => leap(10 + k, 40, 30));
    // A different circle on the same spot, and the same circle a little further along.
    w.areas.push(leap(20, 40, 42), leap(21, 50, 30));
    const r = render(w);
    const at = (x: number, radius: number) => (c: { x: number; radius: number }) => c.x === x && c.radius === radius;
    const fills = r.frameShapes.filter((s) => s.kind === 'circle' && s.layer === 'decal' && at(40, 30)(s));
    // One telegraph's fill + sweep ≈ 0.33 alpha at this progress; six share about one and a half, not six.
    expect(fills.reduce((s, c) => s + c.alpha, 0)).toBeLessThan(0.33 * 1.7);
    const rims = r.frameShapes.filter((s) => s.kind === 'ring' && s.layer === 'fx' && s.thickness === 1 && at(40, 30)(s) && s.alpha > 0.1);
    expect(rims[0].alpha).toBeGreaterThanOrEqual(0.75);
    expect(rims.reduce((s, c) => s + c.alpha, 0)).toBeLessThan(1.7);
    // Distinct circles: full danger rims.
    const rimOf = (x: number, radius: number) => r.frameShapes.find((s) => s.kind === 'ring' && s.layer === 'fx' && at(x, radius)(s) && s.alpha >= 0.75);
    expect(rimOf(40, 42)).toBeDefined();
    expect(rimOf(50, 30)).toBeDefined();
  });

  it('the local player wears a warm outline only while she stands in a danger telegraph or fire pool', () => {
    const body = (r: RecordingRenderer, x: number) => r.frameSprites.find((c) => c.id.startsWith('sorceress/') && c.x === x)!;
    const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 }), player(2, 60, 0, { vx: 0, prevX: 60 })]);
    expect(body(render(w), 0).outline).toBeUndefined();
    for (const kind of ['slamWarning', 'meteorWarning', 'firePool'] as const) {
      w.areas = [{ id: 1, kind, x: 20, y: 10, radius: 42, age: 0.2, duration: 0.9 }, { id: 2, kind, x: 60, y: 0, radius: 42, age: 0.2, duration: 0.9 }];
      const r = render(w);
      expect(body(r, 0).outline, kind).toBeDefined();
      // Allies have name plates and rings; the outline is the local player's own cue.
      expect(body(r, 60).outline).toBeUndefined();
    }
    // Her own fire trail and the Herald's aura are not a danger to her.
    for (const kind of ['fireTrail', 'heraldAura'] as const) {
      w.areas = [{ id: 1, kind, x: 0, y: 0, radius: 42, age: 0.2, duration: 3 }];
      expect(body(render(w), 0).outline, kind).toBeUndefined();
    }
  });

  it('rocks landing one after another on one spot blast lighter than the same rain spread out', () => {
    const rain = (spread: number) => {
      const r = new RecordingRenderer();
      const p = createPresenter(r, art(), new RecordingAudio());
      const w = emptyWorld([player(1, 0, 0, { vx: 0, prevX: 0 })]);
      let total = 0;
      for (let k = 0; k < 8; k++) {
        const e: SimEvent = { t: 'areaResolve', kind: 'meteorWarning', x: 40 + k * spread, y: 120, radius: 28 };
        p.frame({ ...input(w), dt: 0.12, events: [e] });
        // The blasts' own lights: rings at the spot, pulses 10 above it.
        total += r.frameLights
          .filter((l) => l.y >= 105 && l.y <= 125 && l.x >= 40 && l.x <= 40 + k * spread && (spread === 0 ? l.x === 40 : (l.x - 40) % spread === 0))
          .reduce((s, l) => s + l.intensity, 0);
      }
      return total;
    };
    expect(rain(0)).toBeLessThan(rain(70) * 0.7);
  });
});
