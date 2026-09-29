// Ground drops: the local player's own (instanced) loot plus public drops (spec.owner 0: items players dropped on
// the floor, visible to and clickable by everyone in the area). Other players' own loot is never drawn (a dev
// sandbox may hand us everyone's).
//
// Own loot bounces out of corpses on an arc (DropView.z), then sits with a rarity treatment scaled to how much the
// drop matters — magic: short blue beam; rare: tall pulsing gold beam after a short anticipation glint (timed to
// land with the rare chime); unique: tall orange beam and sparks; valuable currency: gold beam; maps: silver beam;
// plain currency: a gold sparkle. Click-to-pick-up equipment (autoPickup false) keeps exactly the same beam.
// Public drops are quiet: no beam or fanfare (they are not a luck event), just their rarity outline, a faint
// bone-white ground glow so they can be found in the dark, and a label with a neutral bone border and a small
// "ground" pip in front of the name, so they never read as your own loot.
//
// Labels (pixel font on dark plates, tone-coloured) appear once the drop lands and are stacked so they never
// overlap; a drop the inventory refused carries a red "Inventory full" line (own loot only). The hovered drop
// (PresentInput.hoverDropId) gets a brighter plate with a border in its tone colour, lifted by a pixel, and its
// sprite an outline and a ground ring. The last frame's plate and sprite boxes are kept for dropAt() (click and
// hover picking: labels first, then sprites, top-most first).
//
// Hover is a feedback loop (dropAt → next frame's hoverDropId → the plate lifts), so picking must not depend on the
// lift: a hovered plate's box grows by the lift upwards instead of moving (it keeps its resting bottom edge), and
// the hovered plate keeps the cursor on the pixel row it shares with a stacked neighbour. Otherwise the highlight,
// the hand cursor and what a click does would flip every frame along a plate's bottom edge.
import type { SfxId } from '../contracts/audio';
import type { RGB } from '../contracts/render';
import type { DropSpec, DropTone, DropView } from '../contracts/sim';
import { C, TONE_COLOR } from './colors';
import { LIGHT_CAPS, type FrameCtx } from './context';
import { LabelStacker } from './labels';
import { clamp01, hash1 } from './math';
import type { Pen } from './pen';
import type { SpriteMeta, SpriteTable } from './sprites';

/** Label plate geometry (the renderer's 5x7 font: plate height = 9 × scale + 2 × padding). */
const PAD = 2;
const PLATE_H = 9 + PAD * 2;
const BLOCKED_H = 11;
/** Public drops: a 5 px "ground" pip (a filled diamond) in front of the name, then a 2 px gap. */
const PIP = 5;
const PIP_W = PIP + 2;
/** Vertical gap (px) between stacked plates; leaves room for the hover lift. */
const LABEL_GAP = 2;
const HOVER_LIFT = 1;
/** Click slack (px) around plates, so the 1 px border and a pixel of wobble still count. */
const HIT_SLACK = 1;
/** Minimum clickable half extent (world units) of a drop sprite: the art is tiny. */
const SPRITE_HIT_MIN = 6;
const LABEL_CAP = 80;
const FULL: RGB = [1, 0.36, 0.3];
const FULL_EDGE: RGB = [0.5, 0.12, 0.1];

/** Public drop label border and pip: neutral bone, never a rarity colour. */
export const PUBLIC_BORDER: RGB = [0.58, 0.53, 0.45];
export const PUBLIC_PIP: RGB = C.bone;
/** Plate fills: own loot, public drops (a hair warmer and lighter), hovered. */
const PLATE_PUBLIC: RGB = [0.06, 0.052, 0.048];
const PLATE_HOVER: RGB = [0.17, 0.14, 0.135];
/** The shadow a hovered (lifted) plate casts on the row it left. */
const LIFT_SHADOW: RGB = [0.01, 0.008, 0.01];
const PUBLIC_GLOW: RGB = [0.8, 0.74, 0.62];

/** Currencies valuable enough to earn a beam (the rest just sparkle). */
const BEAM_CURRENCIES = new Set([
  'icon/currency/reforge', 'icon/currency/catalyst', 'icon/currency/fractureCore', 'icon/currency/voidNeedle',
  'icon/currency/seal', 'icon/currency/rewardInk', 'icon/currency/essenceEmber', 'icon/currency/essenceRime',
  'icon/currency/essenceStorm', 'icon/currency/essenceVital', 'icon/currency/essenceSwift',
]);

interface BeamLook {
  height: number; // beam scaleY (the beam sprite is 72 px tall at 1)
  alpha: number;
  width: number;
  pulse: boolean;
}

const BEAMS: Record<DropTone, BeamLook | null> = {
  normal: null,
  magic: { height: 0.5, alpha: 0.42, width: 0.8, pulse: false },
  rare: { height: 1.55, alpha: 0.62, width: 1, pulse: true },
  unique: { height: 2.1, alpha: 0.78, width: 1.2, pulse: true },
  currency: null,
  map: { height: 1.15, alpha: 0.5, width: 0.9, pulse: false },
  flask: null,
};
const CURRENCY_BEAM: BeamLook = { height: 0.9, alpha: 0.45, width: 0.8, pulse: false };

const SPRITE_IDS = { equipment: 'drop/equipment', currency: 'drop/currency', map: 'drop/map', flask: 'drop/flask' } as const;
type DropSpriteKey = keyof typeof SPRITE_IDS;

/** A public drop: dropped on the floor by a player; anyone in the area sees it and may click it. */
export function isPublicDrop(spec: DropSpec): boolean {
  return spec.owner === 0;
}

/** Drawn (and clickable) for the local player: their own loot and public drops. */
export function isDropVisible(spec: DropSpec, localId: number): boolean {
  return spec.owner === 0 || spec.owner === localId;
}

/** How a drop's label plate looks (see dropLabelLook). Colours are views into reused buffers. */
export interface DropLabelLook {
  text: RGB;
  plate: RGB;
  plateAlpha: number;
  /** 1 px plate border, or undefined for none. */
  border: RGB | undefined;
  /** Colour of the public "ground" pip in front of the name, or undefined (own loot). */
  pip: RGB | undefined;
  /** Pixels the plate is lifted (hover). */
  lift: number;
}

interface LookBuffers extends DropLabelLook {
  readonly textBuf: [number, number, number];
  readonly edgeBuf: [number, number, number];
}

export function createDropLabelLook(): DropLabelLook {
  const textBuf: [number, number, number] = [1, 1, 1];
  const edgeBuf: [number, number, number] = [1, 1, 1];
  const look: LookBuffers = { text: textBuf, plate: C.plate, plateAlpha: 0.84, border: undefined, pip: undefined, lift: 0, textBuf, edgeBuf };
  return look;
}

/**
 * Label style for a drop of `tone`. Own loot: tone-coloured text on a dark plate, a dimmed tone border for
 * everything but plain items and currency. Public drops: the same tone-coloured text (rarity stays readable) on a slightly lighter neutral plate
 * with a bone border and a bone pip. Hovered: brighter plate, a full tone-colour border, text pushed towards
 * white, lifted a pixel. Writes into `out` (no allocation) and returns it.
 */
export function dropLabelLook(tone: DropTone, isPublic: boolean, hovered: boolean, out: DropLabelLook = createDropLabelLook()): DropLabelLook {
  const buf = out as LookBuffers;
  const textBuf = buf.textBuf ?? [1, 1, 1];
  const edgeBuf = buf.edgeBuf ?? [1, 1, 1];
  const col = TONE_COLOR[tone];
  if (hovered) {
    textBuf[0] = col[0] + (1 - col[0]) * 0.4;
    textBuf[1] = col[1] + (1 - col[1]) * 0.4;
    textBuf[2] = col[2] + (1 - col[2]) * 0.4;
    out.text = textBuf;
    out.plate = PLATE_HOVER;
    out.plateAlpha = 0.95;
    out.border = col;
    out.lift = HOVER_LIFT;
  } else {
    out.text = col;
    out.plate = isPublic ? PLATE_PUBLIC : C.plate;
    out.plateAlpha = isPublic ? 0.88 : 0.84;
    out.lift = 0;
    if (isPublic) out.border = PUBLIC_BORDER;
    else if (tone === 'normal' || tone === 'currency') out.border = undefined;
    else {
      edgeBuf[0] = col[0] * 0.45;
      edgeBuf[1] = col[1] * 0.45;
      edgeBuf[2] = col[2] * 0.45;
      out.border = edgeBuf;
    }
  }
  out.pip = isPublic ? PUBLIC_PIP : undefined;
  return out;
}

interface DropState {
  seenAt: number;
  landedAt: number;
  /** Beam anticipation delay (s) — rare/unique drops hold their beam until the chime's hit. */
  delay: number;
  frame: number;
}

export class DropPainter {
  private readonly states = new Map<number, DropState>();
  private readonly stacker = new LabelStacker(LABEL_CAP);
  private readonly labelDrop: (DropView | null)[] = new Array<DropView | null>(LABEL_CAP).fill(null);
  private readonly labelAlpha = new Float32Array(LABEL_CAP);
  private readonly look = createDropLabelLook();
  private readonly metas: Record<DropSpriteKey, SpriteMeta>;
  private frameNo = 0;
  private zoom = 1;
  private hoverId = -1;
  /** Last frame's label plates: x0, y0, x1, y1 (world units) and drop id, in draw order. */
  private readonly hitLabel = new Float32Array(LABEL_CAP * 4);
  private readonly hitLabelId = new Int32Array(LABEL_CAP);
  private hitLabelCount = 0;
  /** Last frame's drop sprites: x0, y0, x1, y1, sortY (world units) and drop id. */
  private hitSprite = new Float32Array(64 * 5);
  private hitSpriteId = new Int32Array(64);
  private hitSpriteCount = 0;

  constructor(private readonly impactDelay: (id: SfxId) => number, table: SpriteTable) {
    this.metas = {
      equipment: table.get(SPRITE_IDS.equipment),
      currency: table.get(SPRITE_IDS.currency),
      map: table.get(SPRITE_IDS.map),
      flask: table.get(SPRITE_IDS.flask),
    };
  }

  reset(): void {
    this.states.clear();
    this.hitLabelCount = 0;
    this.hitSpriteCount = 0;
    this.hoverId = -1;
  }

  /**
   * The drop whose label plate or sprite contains the world point (x, y) in the last drawn frame, or −1. Plates
   * are overlays and win over sprites; among plates the last drawn is on top, among sprites the lowest on screen
   * (the y-sort draws it last).
   */
  dropAt(x: number, y: number): number {
    const L = this.hitLabel;
    const hover = this.hoverId;
    if (hover >= 0) {
      for (let i = 0; i < this.hitLabelCount; i++) {
        if (this.hitLabelId[i] !== hover) continue;
        const o = i * 4;
        if (x >= L[o] && x <= L[o + 2] && y >= L[o + 1] && y <= L[o + 3]) return hover;
        break;
      }
    }
    for (let i = this.hitLabelCount - 1; i >= 0; i--) {
      const o = i * 4;
      if (x >= L[o] && x <= L[o + 2] && y >= L[o + 1] && y <= L[o + 3]) return this.hitLabelId[i];
    }
    const S = this.hitSprite;
    let best = -1;
    let bestY = -Infinity;
    for (let i = 0; i < this.hitSpriteCount; i++) {
      const o = i * 5;
      if (x < S[o] || x > S[o + 2] || y < S[o + 1] || y > S[o + 3]) continue;
      if (S[o + 4] >= bestY) {
        bestY = S[o + 4];
        best = this.hitSpriteId[i];
      }
    }
    return best;
  }

  draw(pen: Pen, f: FrameCtx): void {
    const r = pen.r;
    const drops = f.world.drops;
    const v = f.view;
    const a = f.alpha;
    const time = f.time;
    const local = f.localId;
    const hover = f.hoverDropId;
    const stacker = this.stacker;
    stacker.reset();
    this.frameNo++;
    this.zoom = f.zoom;
    this.hoverId = hover;
    this.hitSpriteCount = 0;
    for (let k = 0; k < drops.length; k++) {
      const d = drops[k];
      if (!isDropVisible(d.spec, local)) continue;
      const pub = d.spec.owner === 0;
      let st = this.states.get(d.id);
      if (!st) {
        const tone = d.spec.tone;
        const delay = pub ? 0 : tone === 'unique' ? this.impactDelay('dropUnique') : tone === 'rare' ? this.impactDelay('dropRare') : 0;
        // Drops already lying there when we arrived (zone entry) show their beam at once.
        st = { seenAt: d.age > 0.3 ? time - 5 : time, landedAt: -1, delay, frame: this.frameNo };
        this.states.set(d.id, st);
      }
      st.frame = this.frameNo;
      const x = d.prevX + (d.x - d.prevX) * a;
      const y = d.prevY + (d.y - d.prevY) * a;
      if (x < v.x0 - 30 || x > v.x1 + 30 || y < v.y0 - 20 || y > v.y1 + 160) continue;
      const tone = d.spec.tone;
      const col = TONE_COLOR[tone];
      const z = d.z;
      const hovered = d.id === hover;
      if (z < 0.5 && st.landedAt < 0) st.landedAt = time;
      const since = time - st.seenAt;

      // Shadow shrinks while airborne.
      const so = pen.sprite('shadow');
      so.scaleX = Math.max(0.3, 0.8 - z / 60);
      so.scaleY = Math.max(0.3, 0.8 - z / 60);
      so.alpha = 0.7;
      r.sprite('fx/shadow', 0, x, y, so);

      // Hovered: a pulsing ground ring in the tone colour marks the click target.
      if (hovered) {
        const ro = pen.shape(col, 0.5 + 0.2 * Math.sin(time * 7), 'decal');
        ro.additive = true;
        ro.emissive = 0.8;
        ro.thickness = 1;
        r.ring(x, y, 8, ro);
      }

      // The item.
      const key: DropSpriteKey = d.spec.sprite in SPRITE_IDS ? d.spec.sprite : 'equipment';
      const o = pen.sprite('world');
      if (hovered) {
        o.outline = col;
        o.flash = 0.16 + 0.08 * Math.sin(time * 7);
        o.flashColor = col;
      } else if (tone === 'magic' || tone === 'rare' || tone === 'unique' || tone === 'map') o.outline = col;
      o.emissive = 0.12;
      o.sortY = y;
      r.sprite(SPRITE_IDS[key], Math.floor(time * 8 + hash1(d.id) * 6) % 6, x, y - z, o);
      this.recordSprite(d.id, key, x, y, z);

      if (pub) {
        // Quiet: a faint bone glow on the floor (and a little light while the budget lasts) so it can be found.
        const go = pen.sprite('decal');
        go.additive = true;
        go.emissive = 1;
        go.tint = PUBLIC_GLOW;
        go.alpha = 0.1 + 0.03 * Math.sin(time * 2.2 + d.id);
        go.scaleX = 0.7;
        go.scaleY = 0.28;
        r.sprite('fx/glow', 0, x, y - 1, go);
        if (f.lights.drop < LIGHT_CAPS.drop) {
          f.lights.drop++;
          pen.light(x, y - 6, 30, PUBLIC_GLOW, 0.28, 0.05);
        }
      } else {
        this.treatment(pen, f, d, st, x, y, z, since, col);
      }

      // Label (once landed).
      if (st.landedAt >= 0 && stacker.count < stacker.capacity) {
        // Plates are a fixed pixel size whatever the zoom: stack them in world units.
        const iz = 1 / f.zoom;
        const w = (r.measureText(d.spec.label, 1) + PAD * 2 + (pub ? PIP_W : 0)) * iz;
        const blocked = d.blocked && !pub;
        const h = (PLATE_H + (blocked ? BLOCKED_H : 0)) * iz;
        const idx = stacker.add(x, y - 16 - PLATE_H * iz, w, h, d.id);
        if (idx >= 0) {
          this.labelDrop[idx] = d;
          this.labelAlpha[idx] = hovered ? 1 : clamp01((time - st.landedAt) / 0.15);
        }
      }
    }

    // Forget drops that are gone.
    if (this.states.size > drops.length + 16) {
      const now = this.frameNo;
      this.states.forEach((s, id) => {
        if (s.frame !== now) this.states.delete(id);
      });
    }
  }

  /** Beam, anticipation glint and sparkle of the local player's own loot. */
  private treatment(pen: Pen, f: FrameCtx, d: DropView, st: DropState, x: number, y: number, z: number, since: number, col: RGB): void {
    const r = pen.r;
    const tone = d.spec.tone;
    const time = f.time;
    let beam = BEAMS[tone];
    if (tone === 'currency' && BEAM_CURRENCIES.has(d.spec.iconId)) beam = CURRENCY_BEAM;
    const reveal = clamp01((since - st.delay) / 0.25);
    if (beam && reveal > 0) {
      const pulse = beam.pulse ? 0.72 + 0.28 * Math.sin(time * 4.2 + d.id) : 1;
      const bo = pen.sprite('fx');
      bo.additive = true;
      bo.tint = col;
      bo.alpha = beam.alpha * pulse * reveal;
      bo.scaleX = beam.width;
      bo.scaleY = beam.height * (0.4 + 0.6 * reveal);
      bo.sortY = y;
      r.sprite('fx/beam', 0, x, y - 36 * bo.scaleY, bo);
      const go = pen.sprite('fx');
      go.additive = true;
      go.tint = col;
      go.alpha = 0.16 * pulse * reveal;
      go.scaleX = 0.9;
      go.scaleY = 0.35;
      go.sortY = y;
      r.sprite('fx/glow', 0, x, y - 2, go);
      if (f.lights.drop < LIGHT_CAPS.drop) {
        f.lights.drop++;
        pen.light(x, y - 8, 36 + beam.height * 22, col, (0.45 + beam.height * 0.25) * pulse * reveal, 0.05);
      }
      if ((tone === 'unique' || tone === 'rare') && Math.random() < f.fxDt * (tone === 'unique' ? 10 : 4)) {
        const b = pen.burst(x + (Math.random() - 0.5) * 6, y - Math.random() * 20, 1, C.hot, col);
        b.sprite = 'fx/spark';
        pen.speed(2, 8);
        pen.life(0.5, 1);
        pen.size(0.45, 0.75);
        b.gravity = -30;
        pen.emit();
      }
    } else if (beam && since < st.delay) {
      // Anticipation: a glint gathering on the item before the beam erupts.
      const k = clamp01(since / Math.max(0.01, st.delay));
      const go = pen.sprite('fx');
      go.additive = true;
      go.tint = col;
      go.alpha = 0.2 + 0.6 * k;
      go.scale = 0.2 + 0.35 * k;
      r.sprite('fx/glow', 0, x, y - z - 6, go);
      pen.light(x, y - z - 6, 20 + 40 * k, col, 0.4 + 0.8 * k);
    } else if (tone === 'currency' && Math.random() < f.fxDt * 1.6) {
      const b = pen.burst(x + (Math.random() - 0.5) * 8, y - 4 - Math.random() * 6, 1, C.hot, C.gold);
      b.sprite = 'fx/spark';
      pen.speed(0, 3);
      pen.life(0.3, 0.6);
      pen.size(0.4, 0.7);
      pen.emit();
    }
  }

  private recordSprite(id: number, key: DropSpriteKey, x: number, y: number, z: number): void {
    if (this.hitSpriteCount >= this.hitSpriteId.length) {
      const n = this.hitSpriteId.length * 2;
      const s = new Float32Array(n * 5);
      s.set(this.hitSprite);
      this.hitSprite = s;
      const ids = new Int32Array(n);
      ids.set(this.hitSpriteId);
      this.hitSpriteId = ids;
    }
    const m = this.metas[key];
    const left = x - m.anchorX;
    const top = y - z - m.anchorY;
    const cx = left + m.width / 2;
    const cy = top + m.height / 2;
    const hw = Math.max(SPRITE_HIT_MIN, m.width / 2 + 1);
    const hh = Math.max(SPRITE_HIT_MIN, m.height / 2 + 1);
    const i = this.hitSpriteCount++;
    const o = i * 5;
    this.hitSprite[o] = cx - hw;
    this.hitSprite[o + 1] = cy - hh;
    this.hitSprite[o + 2] = cx + hw;
    this.hitSprite[o + 3] = cy + hh;
    this.hitSprite[o + 4] = y;
    this.hitSpriteId[i] = id;
  }

  /** Stack and draw the labels collected by draw() (call after everything else on the 'top' layer). */
  drawLabels(pen: Pen): void {
    const r = pen.r;
    const stacker = this.stacker;
    const iz = 1 / this.zoom;
    stacker.solve(LABEL_GAP * iz);
    this.hitLabelCount = 0;
    const look = this.look;
    const slack = HIT_SLACK * iz;
    for (let i = 0; i < stacker.count; i++) {
      const d = this.labelDrop[i];
      if (!d) continue;
      this.labelDrop[i] = null;
      const tone = d.spec.tone;
      const pub = d.spec.owner === 0;
      const hovered = d.id === this.hoverId;
      dropLabelLook(tone, pub, hovered, look);
      const cx = stacker.x(i);
      const w = stacker.w(i);
      const top = stacker.top(i) - look.lift * iz;
      const left = cx - w / 2;
      const alpha = this.labelAlpha[i] * (tone === 'normal' && !hovered ? 0.85 : 1);

      if (look.lift > 0) r.rect(left + iz, top + PLATE_H * iz, w - iz, look.lift * iz, pen.shape(LIFT_SHADOW, 0.75 * alpha, 'top'));
      this.plate(pen, left, top, w, PLATE_H * iz, look.plate, look.plateAlpha * alpha, look.border);
      if (look.pip) this.pip(pen, left + PAD * iz, top, iz, look.pip, alpha);
      const o = pen.text(look.text, alpha, 1);
      r.text(d.spec.label, pub ? cx + (PIP_W / 2) * iz : cx, top + (PAD + 3.5) * iz, o);
      if (d.blocked && !pub) {
        const fo = pen.text(FULL, alpha, 1);
        pen.plate(fo, C.plate, 0.84 * alpha, FULL_EDGE, 1);
        r.text('Inventory full', cx, top + (PLATE_H + 5) * iz, fo);
      }

      // Lifted top, resting bottom: hovering only ever grows the box (see the header).
      const n = this.hitLabelCount++;
      const q = n * 4;
      this.hitLabel[q] = left - slack;
      this.hitLabel[q + 1] = top - slack;
      this.hitLabel[q + 2] = left + w + slack;
      this.hitLabel[q + 3] = stacker.top(i) + stacker.h(i) + slack;
      this.hitLabelId[n] = d.id;
    }
  }

  /**
   * A label plate from rects on 'top': the fill, and a 1 px border ring around it (no overlap, so the border has
   * the plate's own opacity, like the renderer's text boxes). Sizes are whole pixels, so fill, border and the text
   * (whose left edge the renderer rounds the same way) line up exactly.
   */
  private plate(pen: Pen, x: number, y: number, w: number, h: number, fill: RGB, alpha: number, border: RGB | undefined): void {
    const r = pen.r;
    if (!border) {
      r.rect(x, y, w, h, pen.shape(fill, alpha, 'top'));
      return;
    }
    const px = 1 / this.zoom;
    r.rect(x + px, y + px, w - 2 * px, h - 2 * px, pen.shape(fill, alpha, 'top'));
    r.rect(x, y, w, px, pen.shape(border, alpha, 'top'));
    r.rect(x, y + h - px, w, px, pen.shape(border, alpha, 'top'));
    r.rect(x, y + px, px, h - 2 * px, pen.shape(border, alpha, 'top'));
    r.rect(x + w - px, y + px, px, h - 2 * px, pen.shape(border, alpha, 'top'));
  }

  /**
   * The public-drop "ground" pip: a filled 5 px diamond centred on the capitals' middle row (a marker gem, never
   * mistaken for a glyph such as '+'). Drawn as three overlapping rects: 5×1, 3×3 and 1×5.
   */
  private pip(pen: Pen, x: number, top: number, iz: number, color: RGB, alpha: number): void {
    const r = pen.r;
    // Capitals span rows PAD .. PAD + 6 of the plate; their middle row is PAD + 3.
    const mid = top + (PAD + 3) * iz;
    r.rect(x, mid, PIP * iz, iz, pen.shape(color, alpha, 'top'));
    r.rect(x + iz, mid - iz, 3 * iz, 3 * iz, pen.shape(color, alpha, 'top'));
    r.rect(x + 2 * iz, mid - 2 * iz, iz, PIP * iz, pen.shape(color, alpha, 'top'));
  }
}
