// Wave-5 bestiary art (GAME_SPEC §13–§14): the Rimed Ossuary and Iron Coliseum rosters, their projectiles, the
// player debuff overlays, the area visuals and the debuff HUD icons — coverage of src/contracts/bestiary.ts, sprite
// conventions shared with the Ashen Forge roster, determinism, and the cohesion rules that keep three rosters looking
// like one game.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PixelImage, SpriteDef } from '../../src/contracts/art';
import {
  COLISEUM_MONSTERS,
  DEBUFF_ICON_IDS,
  NEW_MONSTER_KINDS,
  NEW_PROJECTILE_KINDS,
  NEW_REQUIRED_SPRITES,
  OSSUARY_MONSTERS,
  PLAYER_DEBUFFS,
  THEME_ROSTER,
} from '../../src/contracts/bestiary';
import { ALL_ICON_IDS } from '../../src/contracts/content';
import { ICON_IDS, debuffOverlayFrame, generateArt, generateSprites, iconFootprint, iconPixels, ROOTED_VARIANTS } from '../../src/art';
import { bestiarySprites } from '../../src/art/bestiary';
import { DEBUFF_LOOP, DEBUFF_STACK_LOOPS } from '../../src/art/bestiary/fx';

let sprites: SpriteDef[];
let byId: Map<string, SpriteDef>;

beforeAll(() => {
  sprites = generateArt().sprites;
  byId = new Map(sprites.map((s) => [s.id, s]));
});

const get = (id: string): SpriteDef => {
  const s = byId.get(id);
  if (!s) throw new Error(`missing sprite ${id}`);
  return s;
};

const alphaAt = (f: PixelImage, x: number, y: number): number => f.data[(y * f.width + x) * 4 + 3];

const opaqueCount = (img: PixelImage): number => {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0) n++;
  return n;
};

const luma = (d: Uint8ClampedArray, i: number): number => (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;

/** Mean premultiplied luminance of the visible pixels (how bright the figure reads over black; faint ghosts count faint). */
function albedo(f: PixelImage): number {
  let l = 0;
  let n = 0;
  for (let i = 0; i < f.data.length; i += 4) {
    if (f.data[i + 3] === 0) continue;
    l += (luma(f.data, i) * f.data[i + 3]) / 255;
    n++;
  }
  return n ? l / n : 0;
}

/** Total premultiplied luminance: how much light the figure puts on screen. */
function light(f: PixelImage): number {
  let l = 0;
  for (let i = 0; i < f.data.length; i += 4) l += (luma(f.data, i) * f.data[i + 3]) / 255;
  return l;
}

/** Monsters whose corpse fades away instead of lying on the floor (the Rimeshade leaves a frost stain). */
const FADING_GHOSTS = new Set(['rimeshade']);

/** Rows between the topmost visible pixel and the anchor row. */
function heightAboveAnchor(s: SpriteDef, f: PixelImage): number {
  for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) if (alphaAt(f, x, y) > 0) return s.anchorY - y;
  return 0;
}

function hashBytes(data: Uint8ClampedArray, h = 0x811c9dc5): number {
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function digest(list: SpriteDef[]): number {
  let h = 0x811c9dc5;
  for (const s of list) {
    for (const ch of `${s.id}|${s.width}x${s.height}@${s.anchorX},${s.anchorY}|${s.fps}|${s.loop}`) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    for (const f of [...s.frames, ...(s.emissive ?? [])]) h = hashBytes(f.data, h);
  }
  return h;
}

/** Extra action sets that loop (everything else except idle / move holds its last frame). */
const LOOPING_EXTRAS = new Set([
  'monster/boneChorister/sing',
  'monster/chainmaster/whirl',
  'monster/varkus/whirl',
  'monster/varkus/charge',
  'monster/chainThrall/windup', // the hook whirling overhead runs for as long as the windup lasts
]);

describe('bestiary coverage (src/contracts/bestiary.ts)', () => {
  it('provides every NEW_REQUIRED_SPRITES id through generateArt()', () => {
    expect(NEW_REQUIRED_SPRITES.filter((id) => !byId.has(id))).toEqual([]);
  });

  it('gives every new monster kind the four actions and a corpse, plus the listed extra sets', () => {
    for (const k of NEW_MONSTER_KINDS) for (const a of ['idle', 'move', 'windup', 'attack', 'corpse']) expect(byId.has(`monster/${k}/${a}`), `${k}/${a}`).toBe(true);
    for (const id of ['monster/glacialWisp/burst', 'monster/chainThrall/throw', 'monster/shieldbearer/block', 'monster/varkus/charge', 'monster/varkus/whirl', 'monster/hollowWarden/cast', 'monster/boneChorister/sing', 'monster/chainmaster/whirl']) {
      expect(byId.has(id), id).toBe(true);
    }
    for (const p of NEW_PROJECTILE_KINDS) expect(byId.has(`proj/${p}`), p).toBe(true);
    for (const d of PLAYER_DEBUFFS) expect(byId.has(`fx/debuff/${d}`), d).toBe(true);
  });

  it('covers every roster the themes use', () => {
    for (const [theme, r] of Object.entries(THEME_ROSTER)) {
      for (const k of [...r.family, r.lieutenant, r.boss]) expect(byId.has(`monster/${k}/idle`), `${theme}: ${k}`).toBe(true);
    }
  });

  it('keeps the wired sprites unique and identical to the bestiary module output', () => {
    expect(byId.size).toBe(sprites.length);
    const own = bestiarySprites();
    expect(own.length).toBeGreaterThanOrEqual(NEW_REQUIRED_SPRITES.length);
    for (const s of own) expect(byId.get(s.id), s.id).toBeDefined();
    expect(digest(own)).toBe(digest(own.map((s) => get(s.id))));
  });
});

describe('bestiary sprite conventions', () => {
  const newIds = (): string[] => bestiarySprites().map((s) => s.id);

  it('keeps every frame (and emissive mask) the declared size, with no empty frame', () => {
    for (const id of newIds()) {
      const s = get(id);
      expect(s.frames.length, id).toBeGreaterThan(0);
      s.frames.forEach((f, i) => {
        expect([f.width, f.height], `${id}#${i}`).toEqual([s.width, s.height]);
        expect(f.data.length, `${id}#${i}`).toBe(s.width * s.height * 4);
        expect(opaqueCount(f), `${id}#${i} is empty`).toBeGreaterThan(0);
      });
      if (s.emissive) {
        expect(s.emissive.length, id).toBe(s.frames.length);
        for (const e of s.emissive) expect([e.width, e.height], id).toEqual([s.width, s.height]);
      }
    }
  });

  it('places every anchor inside its frame', () => {
    for (const id of newIds()) {
      const s = get(id);
      expect(s.anchorX, id).toBeGreaterThanOrEqual(0);
      expect(s.anchorX, id).toBeLessThanOrEqual(s.width);
      expect(s.anchorY, id).toBeGreaterThanOrEqual(0);
      expect(s.anchorY, id).toBeLessThanOrEqual(s.height);
    }
  });

  it('shares one frame size and anchor across every action of a new monster', () => {
    for (const k of NEW_MONSTER_KINDS) {
      const set = sprites.filter((s) => s.id.startsWith(`monster/${k}/`));
      const [first] = set;
      for (const s of set) expect([s.width, s.height, s.anchorX, s.anchorY], s.id).toEqual([first.width, first.height, first.anchorX, first.anchorY]);
    }
  });

  it('gives each new monster glowing eyes / cores (emissive on every action)', () => {
    for (const k of NEW_MONSTER_KINDS) {
      for (const a of ['idle', 'move', 'windup', 'attack']) {
        const s = get(`monster/${k}/${a}`);
        expect(s.emissive, s.id).toBeDefined();
        const lit = s.emissive!.some((e) => e.data.some((v, i) => i % 4 === 3 && v > 0));
        expect(lit, `${s.id} has an emissive mask but nothing glows`).toBe(true);
      }
    }
  });

  it('loops idle / move and the continuous actions, and holds the last frame of one-shots', () => {
    for (const k of NEW_MONSTER_KINDS) {
      for (const s of sprites.filter((x) => x.id.startsWith(`monster/${k}/`))) {
        const action = s.id.split('/')[2];
        const loops = action === 'idle' || action === 'move' || LOOPING_EXTRAS.has(s.id);
        expect(s.loop, s.id).toBe(loops);
        expect(s.fps, s.id).toBeGreaterThan(0);
      }
    }
  });

  it('stands walking monsters on their anchor so the mirrored west view does not jump', () => {
    // mean x of the opaque pixels in the lowest four rows, averaged over the idle / move frames (as for the forge)
    const groundX = (f: PixelImage, maxX: number): number => {
      let lowest = -1;
      for (let y = f.height - 1; y >= 0 && lowest < 0; y--) for (let x = 0; x < maxX; x++) if (alphaAt(f, x, y) > 0) lowest = y;
      let sum = 0;
      let n = 0;
      for (let y = lowest; y > lowest - 4; y--) {
        for (let x = 0; x < maxX; x++) {
          if (alphaAt(f, x, y) === 0) continue;
          sum += x + 0.5;
          n++;
        }
      }
      return sum / n;
    };
    const walkers = ['boneThrall', 'frostWeaver', 'ossuaryGolem', ...COLISEUM_MONSTERS];
    for (const k of walkers) {
      for (const a of ['idle', 'move']) {
        const s = get(`monster/${k}/${a}`);
        // Varkus rests his greatsword's tip on the floor well ahead of his feet (like the Herald's staff): feet only
        const maxX = k === 'varkus' ? 60 : s.width;
        const avg = s.frames.reduce((n, f) => n + groundX(f, maxX), 0) / s.frames.length;
        expect(Math.abs(avg - s.anchorX), `${s.id}: ground centre ${avg.toFixed(2)} vs anchor ${s.anchorX}`).toBeLessThanOrEqual(1.25);
      }
    }
  });

  it('centres floating and robed bodies over their ground anchor (staffs excluded)', () => {
    // Rimeshade, Glacial Wisp and Hollow Warden float; the Chorister's hem is its footing. The Warden's crook stands
    // ahead of it (like the Herald's staff), so only x < 40 counts for it.
    const massX = (f: PixelImage, maxX: number): number => {
      let sx = 0;
      let n = 0;
      for (let y = 0; y < f.height; y++) {
        for (let x = 0; x < maxX; x++) {
          const a = alphaAt(f, x, y) / 255;
          sx += (x + 0.5) * a;
          n += a;
        }
      }
      return sx / n;
    };
    for (const [k, maxX] of [['rimeshade', 99], ['glacialWisp', 99], ['boneChorister', 99], ['hollowWarden', 40]] as const) {
      for (const a of ['idle', 'move']) {
        const s = get(`monster/${k}/${a}`);
        const avg = s.frames.reduce((n, f) => n + massX(f, Math.min(maxX, s.width)), 0) / s.frames.length;
        expect(Math.abs(avg - s.anchorX), `${s.id}: body centre ${avg.toFixed(2)} vs anchor ${s.anchorX}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('anchors projectiles at their centre', () => {
    for (const p of NEW_PROJECTILE_KINDS) {
      const s = get(`proj/${p}`);
      expect(Math.abs(s.anchorX - s.width / 2), s.id).toBeLessThanOrEqual(1);
      expect(Math.abs(s.anchorY - s.height / 2), s.id).toBeLessThanOrEqual(1);
    }
  });
});

describe('debuff overlays and HUD icons', () => {
  it('draws every overlay at the player feet pivot, with a frame range for each loop / stack / root source', () => {
    for (const d of PLAYER_DEBUFFS) {
      const s = get(`fx/debuff/${d}`);
      expect([s.width, s.height, s.anchorX, s.anchorY], s.id).toEqual([32, 36, 16, 33]);
      const loops = d === 'rooted' ? Object.keys(ROOTED_VARIANTS).length : DEBUFF_STACK_LOOPS[d] ?? 1;
      expect(s.frames.length, s.id).toBe(DEBUFF_LOOP[d].frames * loops);
      expect(s.emissive, s.id).toBeDefined();
    }
  });

  it('only ever picks overlay frames that exist', () => {
    for (const d of PLAYER_DEBUFFS) {
      const n = get(`fx/debuff/${d}`).frames.length;
      for (let t = -1; t < 6; t += 0.037) {
        for (const stacks of [0, 1, 2, 3, 9]) {
          for (const source of Object.keys(ROOTED_VARIANTS) as (keyof typeof ROOTED_VARIANTS)[]) {
            const f = debuffOverlayFrame(d, t, { stacks, source });
            expect(Number.isInteger(f) && f >= 0 && f < n, `${d} t=${t} stacks=${stacks} source=${source} → ${f}`).toBe(true);
          }
        }
      }
    }
  });

  it('registers a 32 px square icon for every debuff in the icon registry', () => {
    for (const id of DEBUFF_ICON_IDS) {
      expect(ICON_IDS, id).toContain(id);
      const img = iconPixels(id);
      expect(img, id).not.toBeNull();
      expect([img!.width, img!.height], id).toEqual([32, 32]);
      expect(iconFootprint(id), id).toEqual([1, 1]);
      expect(opaqueCount(img!), id).toBeGreaterThan(32 * 32 * 0.8);
    }
  });

  it('draws debuff icons that differ from each other and from every other icon', () => {
    const seen = new Map<number, string>();
    for (const id of [...ALL_ICON_IDS, ...DEBUFF_ICON_IDS]) {
      const key = hashBytes(iconPixels(id)!.data);
      expect(seen.get(key), `${id} duplicates ${seen.get(key)}`).toBeUndefined();
      seen.set(key, id);
    }
  });

  it('serves debuff icons through ArtBundle.icon() (empty in Node, where there is no DOM)', () => {
    const art = generateArt();
    for (const id of DEBUFF_ICON_IDS) expect(art.icon(id, 24)).toBe('');
  });
});

describe('bestiary cohesion with the Ashen Forge roster', () => {
  const rosters = Object.values(THEME_ROSTER);
  const everyKind = rosters.flatMap((r) => [...r.family, r.lieutenant, r.boss]);

  it('keeps roles at comparable sizes across rosters', () => {
    // tallest idle pose above the anchor: families stay below the lieutenants, which stay below the bosses
    const tall = (k: string): number => heightAboveAnchor(get(`monster/${k}/idle`), get(`monster/${k}/idle`).frames[0]);
    const family = Math.max(...rosters.flatMap((r) => r.family.map(tall)));
    const lts = rosters.map((r) => tall(r.lieutenant));
    // Promoted commanders retain their existing silhouettes. The three original champions remain taller.
    const bosses = rosters.filter(r => r.boss !== r.lieutenant).map((r) => tall(r.boss));
    expect(family, 'tallest family member vs shortest lieutenant').toBeLessThan(Math.min(...lts));
    expect(Math.max(...lts), 'tallest lieutenant vs shortest boss').toBeLessThan(Math.min(...bosses));
    // bosses within 15% of each other in height; lieutenants within 30% (the Chorister's halo stands proud)
    expect(Math.max(...bosses) / Math.min(...bosses)).toBeLessThan(1.15);
    expect(Math.max(...lts) / Math.min(...lts)).toBeLessThan(1.3);
  });

  it('lets every corpse settle lower and darker than the living monster, with its glow guttering out', () => {
    for (const k of everyKind) {
      const idle = get(`monster/${k}/idle`);
      const corpse = get(`monster/${k}/corpse`);
      const last = corpse.frames.length - 1;
      const f = corpse.frames[last];
      const alive = idle.frames[0];
      expect(heightAboveAnchor(corpse, f) / heightAboveAnchor(idle, alive), `${k}: corpse height vs idle`).toBeLessThanOrEqual(0.7);
      if (FADING_GHOSTS.has(k)) expect(light(f) / light(alive), `${k}: the ghost fades to a faint stain`).toBeLessThanOrEqual(0.15);
      else expect(albedo(f) / albedo(alive), `${k}: corpse brightness vs idle`).toBeLessThanOrEqual(0.82);
      const glow = (e?: PixelImage): number => (e ? e.data.reduce((n, v, i) => (i % 4 === 3 ? n + v : n), 0) : 0);
      expect(glow(corpse.emissive?.[last]), `${k}: corpse glow vs idle`).toBeLessThanOrEqual(Math.max(1, glow(idle.emissive?.[0])));
    }
  });

  it('keeps the Ossuary corpses in the same value range as ash corpses', () => {
    const lastAlbedo = (k: string): number => {
      const s = get(`monster/${k}/corpse`);
      return albedo(s.frames[s.frames.length - 1]);
    };
    // bone thralls leave their bones (GAME_SPEC §14), so they may stay a little paler than the rest; the Rimeshade
    // leaves only a faint stain (checked above)
    for (const k of OSSUARY_MONSTERS) if (!FADING_GHOSTS.has(k)) expect(lastAlbedo(k), k).toBeLessThanOrEqual(k === 'boneThrall' ? 0.34 : 0.28);
  });
});

describe('bestiary determinism', () => {
  it('generates identical pixels every time', () => {
    expect(digest(bestiarySprites())).toBe(digest(bestiarySprites()));
    const a = digest(generateSprites().filter((s) => NEW_REQUIRED_SPRITES.includes(s.id)));
    const b = digest(generateSprites().filter((s) => NEW_REQUIRED_SPRITES.includes(s.id)));
    expect(a).toBe(b);
    for (const id of DEBUFF_ICON_IDS) expect(hashBytes(iconPixels(id)!.data)).toBe(hashBytes(iconPixels(id)!.data));
  });
});
