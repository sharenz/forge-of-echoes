// Props: the hideout furniture, themed map decor, the ruined rim, portals and the reward chest.
//
// Frame conventions (src/art/props.ts): animated props (fps > 0) loop by time with a per-prop phase; fps 0 props
// pick frame = state (mapDevice active, chest open) or variant % frames. Portals are hidden at state 0 and swirl
// open with a light, inward-spiralling embers and (in a hideout) a remaining-uses plate. Clickable props — the
// interactive hideout objects, the anvil (the Crafting Bench, clickable in every hideout) and open portals /
// return portals — get a hover outline, a brighter glow and a name plate when PresentInput.hoverPropId names
// them. The anvil also reads as a working station at all times: a hot workpiece glow and sparks jumping off it.
// Braziers, crystals, the device and the chest carry their own lights.
import type { PropKind, PropView } from '../contracts/sim';
import type { RGB } from '../contracts/render';
import { LAYOUT_PROP_RADIUS } from '../data/layouts/schema';
import { PROP_COVER } from '../data/propCover';
import { C } from './colors';
import { lightInView, type FrameCtx } from './context';
import { hash1, TAU } from './math';
import type { Pen } from './pen';
import type { SpriteTable } from './sprites';

const HOVER: RGB = [1, 0.86, 0.52];
const PORTAL_EMBER: RGB = [1, 0.5, 0.18];
const PORTAL_FROST: RGB = [0.45, 0.72, 1];
const BRAZIER: RGB = [1, 0.58, 0.24];
const CANDLE: RGB = [1, 0.7, 0.4];
const CRYSTAL: RGB = [0.45, 0.75, 1];
const CHEST: RGB = [1, 0.8, 0.4];
const BONE_TINT: RGB = [0.7, 0.66, 0.62];
const RETURN_EDGE: RGB = [0.18, 0.3, 0.45];
const PORTAL_EDGE: RGB = [0.5, 0.26, 0.1];
const HOVER_EDGE: RGB = [0.45, 0.36, 0.2];
const ANVIL_HOT: RGB = [1, 0.46, 0.14];
const ANVIL_LIGHT: RGB = [1, 0.64, 0.36];
const PORTAL_HOVER: RGB = [1, 0.8, 0.5];
/** Seconds between the Crafting Bench's spark strikes. */
const ANVIL_BEAT = 2.2;
const RETURN_HOVER: RGB = [0.72, 0.9, 1];

/** Sprite height factor of a prop whose layout cover differs from its kind's default (src/data/propCover.ts). */
const COVER_HEIGHT = { tall: 1.3, low: 0.72, none: 0.72 } as const;

/** Blob shadow size (scaleX, scaleY of the 16x6 fx/shadow) per prop kind; 0 = none. */
const SHADOW: Record<PropKind, readonly [number, number]> = {
  mapDevice: [3.3, 2.2],
  stash: [2.1, 1.5],
  merchant: [1.9, 1.3],
  debugMerchant: [1.9, 1.3],
  portal: [2.2, 1.3],
  returnPortal: [2.2, 1.3],
  chest: [1.9, 1.4],
  pillar: [1.5, 1.3],
  brazier: [1.1, 1],
  standingStone: [1.5, 1.2],
  rubble: [0, 0],
  bones: [0, 0],
  crystal: [1.3, 1.1],
  banner: [0.9, 0.8],
  anvil: [1.6, 1.2],
  ruinWall: [2.5, 1.5],
  vat: [3.4, 1.9],
  bellows: [2, 1.2],
  altar: [2.3, 1.4],
  sarcophagus: [2.6, 1.4],
  choirStall: [1.7, 1.2],
  ribArch: [1.2, 1],
  iceColumn: [1.3, 1.1],
  crate: [1.6, 1.2],
  chainPost: [0.9, 0.8],
  hoist: [2.4, 1.4],
  gate: [2.2, 1.3],
  weaponRack: [1.8, 1.1],
  obelisk: [1.1, 1],
  statue: [1.8, 1.3],
};

/** The light each prop kind carries: [y offset of its centre, reach] (reach 0 = none). Used to cull lights by what
 * they illuminate rather than by the sprite (see lightInView). */
const LIGHT_REACH: Record<PropKind, readonly [number, number]> = {
  mapDevice: [-6, 96],
  stash: [-16, 50],
  merchant: [-24, 90],
  debugMerchant: [-24, 90],
  portal: [-24, 110],
  returnPortal: [-24, 110],
  chest: [-12, 78],
  pillar: [0, 0],
  brazier: [-26, 124],
  standingStone: [-20, 30],
  rubble: [0, 0],
  bones: [0, 0],
  crystal: [-12, 70],
  banner: [0, 0],
  anvil: [-18, 50],
  ruinWall: [0, 0],
  vat: [-18, 96],
  bellows: [-6, 44],
  altar: [-26, 70],
  sarcophagus: [0, 0],
  choirStall: [0, 0],
  ribArch: [0, 0],
  iceColumn: [-24, 56],
  crate: [0, 0],
  chainPost: [0, 0],
  hoist: [0, 0],
  gate: [0, 0],
  weaponRack: [0, 0],
  obelisk: [-30, 54],
  statue: [0, 0],
};

/** The layout art kit (D 10.5): solid-circle props a layout can resize with `r` (the sprite scales with the radius). */
const KIT_KINDS: ReadonlySet<PropKind> = new Set<PropKind>([
  'vat', 'bellows', 'altar', 'sarcophagus', 'choirStall', 'ribArch', 'iceColumn', 'crate', 'chainPost', 'hoist', 'gate', 'weaponRack',
  'obelisk', 'statue',
]);
/**
 * Per-theme kit hook (D 10.6): the kit is authored once and each theme nudges it towards its floor (multiplies the sprite tint,
 * so it only ever dims or warms a little; frame 1 of every kit sprite is the layout-selectable recolour). Absent = untouched.
 */
const KIT_THEME_TINT: Partial<Record<string, RGB>> = {
  ashenForge: [1.04, 0.97, 0.94], cinderChapel: [1.03, 0.97, 0.97], rimedOssuary: [0.93, 0.99, 1.06], choralCrypt: [0.97, 0.94, 1.06],
  chainworks: [1.02, 0.98, 0.92], ironColiseum: [1.04, 1, 0.9],
};
const SLAG: RGB = [1, 0.5, 0.16];
const GOLD_GLOW: RGB = [1, 0.8, 0.38];

const NAMES: Partial<Record<PropKind, string>> = {
  mapDevice: 'Map Device', stash: 'Stash', merchant: 'Rook the Merchant', anvil: 'Crafting Bench', portal: 'Enter Map',
  returnPortal: 'Return to Hideout',
  debugMerchant: 'Mira the Provisioner',
};

/** Kinds that take the hover highlight: the interactive hideout objects, the bench and (open) portals. */
const HOVERABLE: ReadonlySet<PropKind> = new Set<PropKind>(['mapDevice', 'stash', 'merchant', 'debugMerchant', 'anvil', 'portal', 'returnPortal']);

/** Does prop `p` take the hover highlight when the client names it in hoverPropId? */
export function isHoverableProp(p: PropView): boolean {
  if (p.kind === 'portal' || p.kind === 'returnPortal') return p.state > 0;
  return p.interactive || HOVERABLE.has(p.kind);
}

const PROP_IDS: Record<PropKind, string> = {
  mapDevice: 'prop/mapDevice', stash: 'prop/stash', merchant: 'prop/merchant', portal: 'prop/portal',
  returnPortal: 'prop/returnPortal', chest: 'prop/chest', pillar: 'prop/pillar', brazier: 'prop/brazier',
  standingStone: 'prop/standingStone', rubble: 'prop/rubble', bones: 'prop/bones', crystal: 'prop/crystal',
  banner: 'prop/banner', anvil: 'prop/anvil', ruinWall: 'prop/ruinWall',
  debugMerchant: 'prop/debugMerchant',
  vat: 'prop/vat', bellows: 'prop/bellows', altar: 'prop/altar', sarcophagus: 'prop/sarcophagus', choirStall: 'prop/choirStall',
  ribArch: 'prop/ribArch', iceColumn: 'prop/iceColumn', crate: 'prop/crate', chainPost: 'prop/chainPost', hoist: 'prop/hoist',
  gate: 'prop/gate', weaponRack: 'prop/weaponRack', obelisk: 'prop/obelisk', statue: 'prop/statue',
};

/** Clickable extents (half width, height above the base) of the interactive props' art. */
const PICK: Partial<Record<PropKind, readonly [number, number]>> = {
  mapDevice: [26, 46],
  stash: [15, 27],
  merchant: [17, 40],
  debugMerchant: [17, 40],
  anvil: [13, 19],
  portal: [16, 48],
  returnPortal: [16, 48],
};

/**
 * The interactive prop under the world point (x, y) — the cursor — or −1. Uses the art's silhouette box (bottom-
 * centre anchored), nearest base first, so the client can feed PresentInput.hoverPropId and route clicks.
 * Candidates: props the sim marks `interactive` (map device, stash, merchant) and the anvil — the Crafting Bench,
 * which only exists in hideouts and is usable in any of them. A portal marked interactive counts only while open.
 */
export function pickInteractiveProp(props: readonly PropView[], x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k < props.length; k++) {
    const p = props[k];
    if (!p.interactive && p.kind !== 'anvil') continue;
    if ((p.kind === 'portal' || p.kind === 'returnPortal') && p.state <= 0) continue;
    const box = PICK[p.kind] ?? [Math.max(10, p.radius), Math.max(20, p.radius * 2)];
    if (x < p.x - box[0] - 2 || x > p.x + box[0] + 2 || y < p.y - box[1] - 2 || y > p.y + 4) continue;
    const d = Math.abs(x - p.x) + Math.abs(y - (p.y - box[1] / 2));
    if (d < bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}

const PORTAL_LABELS = ['', '1 portal', '2 portals', '3 portals', '4 portals', '5 portals', '6 portals', '7 portals', '8 portals'];

export class PropPainter {
  /** Presentation time a portal prop (by id) was first seen open, for the swirl-open animation. */
  private readonly openedAt = new Map<number, number>();
  /** Last strike index per anvil (by id): sparks fly once per strike. */
  private readonly anvilBeat = new Map<number, number>();
  /** Name plate of the hovered prop this frame ('' = none), drawn by drawHoverLabel(). */
  private hoverName = '';
  private hoverX = 0;
  private hoverY = 0;

  constructor(private readonly table: SpriteTable) {}

  reset(): void {
    this.openedAt.clear();
    this.anvilBeat.clear();
  }

  /** A portal just opened (event): restart its opening animation. */
  portalOpened(x: number, y: number, props: readonly PropView[], time: number): void {
    for (const p of props) {
      if ((p.kind === 'portal' || p.kind === 'returnPortal') && Math.abs(p.x - x) < 2 && Math.abs(p.y - y) < 2) this.openedAt.set(p.id, time);
    }
  }

  /** Is the hideout map portal (or a return portal) open anywhere in this zone? */
  static anyPortalOpen(props: readonly PropView[]): boolean {
    for (const p of props) if ((p.kind === 'portal' || p.kind === 'returnPortal') && p.state > 0) return true;
    return false;
  }

  draw(pen: Pen, f: FrameCtx): void {
    const r = pen.r;
    const v = f.view;
    const props = f.world.props;
    this.hoverName = '';
    const time = f.time;
    const hideout = f.world.run.phase === 'hideout';
    const deviceActive = hideout && (f.world.run.portalOpen || PropPainter.anyPortalOpen(props));
    for (let k = 0; k < props.length; k++) {
      const p = props[k];
      const kind = p.kind;
      const x = p.x;
      const y = p.y;
      const portal = kind === 'portal' || kind === 'returnPortal';
      if (portal && p.state <= 0) {
        this.openedAt.delete(p.id);
        continue;
      }
      // Sprites (and their glows, particles, labels) cull with the art's overhang; lights cull by their own reach.
      const vis = !(x < v.x0 - 70 || x > v.x1 + 70 || y < v.y0 - 20 || y > v.y1 + 80);
      const reach = LIGHT_REACH[kind];
      const lit = reach[1] > 0 && lightInView(v, x, y + reach[0], reach[1]);
      if (!vis && !lit) continue;
      const id = PROP_IDS[kind];
      const meta = this.table.get(id);
      const phase = hash1(p.id) * 10;
      const hovered = f.hoverPropId === p.id && isHoverableProp(p);

      // Portals swirl open: their height (and light) grow over the first half second.
      let scaleY = 1;
      if (portal) {
        let t0 = this.openedAt.get(p.id);
        if (t0 === undefined) {
          t0 = time - 1;
          this.openedAt.set(p.id, t0);
        }
        const open = Math.min(1, (time - t0) / 0.45);
        scaleY = open < 1 ? 0.25 + 0.75 * (1 - (1 - open) * (1 - open)) : 1;
      }

      if (vis) {
        let frame: number;
        if (meta.fps > 0) frame = Math.floor(time * meta.fps + phase * meta.frames);
        else if (kind === 'mapDevice') frame = deviceActive ? 1 : 0;
        else if (kind === 'chest') frame = p.state > 0 ? 1 : 0;
        else frame = p.variant % Math.max(1, meta.frames);

        // Height reads as cover: a layout that overrides a kind's cover draws it taller (a crate STACK, tall) or lower (a rubble
        // run, a rail, a parapet: low) than the kind's art, and its shadow follows. Kinds at their default cover are untouched.
        const heightScale = p.cover !== undefined && p.radius > 0 && p.cover !== PROP_COVER[kind] ? COVER_HEIGHT[p.cover] : 1;
        const sh = SHADOW[kind];
        if (sh[0] > 0) {
          const so = pen.sprite('shadow');
          so.scaleX = sh[0];
          so.scaleY = sh[1] * (heightScale > 1 ? 1.25 : heightScale < 1 ? 0.8 : 1);
          so.alpha = 0.8;
          r.sprite('fx/shadow', 0, x, y - 1, so);
        }

        const o = pen.sprite(kind === 'bones' ? 'decal' : 'world');
        // Pale bone would bleach under the player's light; keep it a step darker than the stonework.
        if (kind === 'bones') o.tint = BONE_TINT;
        if (scaleY !== 1 || heightScale !== 1) o.scaleY = scaleY * heightScale;
        if (KIT_KINDS.has(kind)) {
          // A layout may resize a kit prop (`r`): the art follows its solid radius (walk-through decor keeps its size).
          const base = LAYOUT_PROP_RADIUS[kind];
          if (p.radius > 0 && base > 0 && p.radius !== base) o.scale = Math.max(0.5, Math.min(2.2, p.radius / base));
          const tint = KIT_THEME_TINT[f.theme];
          if (tint) o.tint = tint;
        }
        if (hovered) {
          const hc = kind === 'portal' ? PORTAL_HOVER : kind === 'returnPortal' ? RETURN_HOVER : HOVER;
          o.outline = hc;
          o.flash = 0.1 + 0.06 * Math.sin(time * 6);
          o.flashColor = hc;
        }
        r.sprite(id, frame, x, y, o);
      }

      // Per-kind light (whenever it reaches the screen) and life (only while the prop itself is on screen).
      switch (kind) {
        case 'brazier': {
          // The flame is emissive art; the light sits above it so the bowl and ground catch it without bleaching it.
          pen.light(x, y - 26, 124, BRAZIER, f.theme === 'ironColiseum' ? 0.65 : 0.85, 0.75);
          if (!vis) break;
          const g = pen.sprite('fx');
          g.additive = true;
          g.tint = BRAZIER;
          g.alpha = 0.12;
          g.scale = 0.8;
          r.sprite('fx/glow', 0, x, y - 20, g);
          if (Math.random() < f.fxDt * 5) {
            const b = pen.burst(x + (Math.random() - 0.5) * 8, y - 20, 1, C.hot, C.ember);
            b.sprite = 'fx/ember';
            pen.speed(4, 14);
            pen.life(0.7, 1.4);
            pen.size(0.6, 1);
            b.angle = -Math.PI / 2;
            b.spread = 1.3;
            b.gravity = -26;
            pen.emit();
          }
          break;
        }
        case 'vat': {
          // Frame 0 holds molten slag; the cooled crust (frame 1) only smoulders.
          const molten = p.variant % 2 === 0;
          const pulse = 0.85 + 0.15 * Math.sin(time * 1.3 + phase);
          pen.light(x, y - 16, molten ? 104 : 54, SLAG, (molten ? 0.62 : 0.2) * pulse, 0.45);
          if (!vis || !molten) break;
          const g = pen.sprite('fx');
          g.additive = true;
          g.tint = SLAG;
          g.alpha = 0.1 * pulse;
          g.scaleX = 1.3;
          g.scaleY = 0.7;
          r.sprite('fx/glow', 0, x, y - 22, g);
          if (Math.random() < f.fxDt * 3) {
            const b = pen.burst(x + (Math.random() - 0.5) * 30, y - 24, 1, C.hot, C.ember);
            b.sprite = 'fx/ember';
            pen.speed(4, 14);
            pen.life(0.7, 1.3);
            pen.size(0.5, 0.9);
            b.angle = -Math.PI / 2;
            b.spread = 1.2;
            b.gravity = -24;
            pen.emit();
          }
          break;
        }
        case 'bellows':
          pen.light(x - 16, y - 8, 46, SLAG, p.variant % 2 === 0 ? 0.5 * (0.8 + 0.2 * Math.sin(time * 2.4 + phase)) : 0.08, 0.5);
          break;
        case 'altar':
          pen.light(x, y - 26, 72, CANDLE, p.variant % 2 === 0 ? 0.7 : 0.4, 0.55);
          if (vis && p.variant % 2 === 0) {
            const g = pen.sprite('fx');
            g.additive = true;
            g.tint = CANDLE;
            g.alpha = 0.1;
            g.scale = 0.5;
            r.sprite('fx/glow', 0, x, y - 27, g);
          }
          break;
        case 'iceColumn':
          pen.light(x, y - 22, 56, CRYSTAL, 0.32 * (0.85 + 0.15 * Math.sin(time * 1.5 + phase)), 0.05);
          break;
        case 'obelisk':
          pen.light(x, y - 28, 54, p.variant % 2 === 0 ? PORTAL_EMBER : GOLD_GLOW, 0.34 * (0.85 + 0.15 * Math.sin(time * 1.9 + phase)), 0.2);
          break;
        case 'crystal': {
          const pulse = 0.85 + 0.15 * Math.sin(time * 1.7 + phase);
          pen.light(x, y - 12, 70, CRYSTAL, 0.6 * pulse, 0.05);
          if (!vis) break;
          const g = pen.sprite('fx');
          g.additive = true;
          g.tint = CRYSTAL;
          g.alpha = 0.08 * pulse;
          g.scale = 0.8;
          r.sprite('fx/glow', 0, x, y - 12, g);
          break;
        }
        case 'standingStone':
          pen.light(x, y - 20, 30, (f.theme === 'rimedOssuary' || f.theme === 'choralCrypt') ? CRYSTAL : PORTAL_EMBER, 0.28, 0.2);
          break;
        case 'anvil':
          this.anvil(pen, f, p.id, x, y, vis, hovered, phase);
          break;
        case 'stash':
          pen.light(x, y - 16, 50, CANDLE, 0.5, 0.35);
          break;
        case 'merchant':
        case 'debugMerchant':
          pen.light(x + 6, y - 24, 84, CANDLE, 0.75, 0.3);
          break;
        case 'mapDevice': {
          if (deviceActive) {
            const pulse = 0.8 + 0.2 * Math.sin(time * 3.1);
            pen.light(x, y - 6, 96, PORTAL_EMBER, 0.26 * pulse, 0.15);
            if (!vis) break;
            const g = pen.sprite('fx');
            g.additive = true;
            g.tint = PORTAL_EMBER;
            g.alpha = 0.08 * pulse;
            g.scaleX = 2.2;
            g.scaleY = 1;
            r.sprite('fx/glow', 0, x, y - 14, g);
            if (Math.random() < f.fxDt * 10) {
              const a = Math.random() * TAU;
              const b = pen.burst(x + Math.cos(a) * 16, y - 12 + Math.sin(a) * 6, 1, C.hot, C.ember);
              b.sprite = 'fx/ember';
              pen.speed(4, 12);
              pen.life(0.8, 1.4);
              b.angle = -Math.PI / 2;
              b.spread = 0.6;
              b.gravity = -30;
              pen.emit();
            }
          } else {
            pen.light(x, y - 16, 70, PORTAL_EMBER, 0.35, 0.2);
          }
          break;
        }
        case 'portal':
        case 'returnPortal': {
          const col = kind === 'portal' ? PORTAL_EMBER : PORTAL_FROST;
          const pulse = 0.85 + 0.15 * Math.sin(time * 4 + phase);
          const boost = hovered ? 1.45 : 1;
          pen.light(x, y - 24, 110, col, 0.5 * pulse * scaleY * boost, 0.18);
          if (!vis) break;
          const g = pen.sprite('fx');
          g.additive = true;
          g.tint = col;
          g.alpha = 0.07 * pulse * (hovered ? 2.2 : 1);
          g.scaleX = 1.1;
          g.scaleY = 1.6 * scaleY;
          r.sprite('fx/glow', 0, x, y - 25, g);
          // Motes spiralling into the gate (drawn in faster while hovered: it invites the click).
          if (Math.random() < f.fxDt * (hovered ? 30 : 14)) {
            const a = Math.random() * TAU;
            const rx = Math.cos(a) * 20;
            const ry = Math.sin(a) * 26;
            const b = pen.burst(x + rx, y - 25 + ry, 1, kind === 'portal' ? C.hot : C.ice, col);
            b.sprite = 'fx/spark';
            pen.speed(22, 34);
            pen.life(0.5, 0.75);
            pen.size(0.5, 0.8);
            b.angle = Math.atan2(-ry, -rx) + 0.5;
            b.spread = 0.2;
            b.drag = 0.6;
            pen.emit();
          }
          if (kind === 'returnPortal') {
            const o2 = pen.text(hovered ? RETURN_HOVER : PORTAL_FROST, hovered ? 1 : 0.9, 1);
            pen.plate(o2, C.plate, hovered ? 0.92 : 0.7, hovered ? PORTAL_FROST : RETURN_EDGE, 2);
            r.text('Return', x, y + 9, o2);
          } else if (hideout && p.state > 0) {
            const label = PORTAL_LABELS[Math.min(p.state, PORTAL_LABELS.length - 1)] || `${p.state} portals`;
            const o2 = pen.text(hovered ? C.white : C.hot, 1, 1);
            pen.plate(o2, C.plate, hovered ? 0.92 : 0.78, hovered ? PORTAL_EMBER : PORTAL_EDGE, 2);
            r.text(label, x, y + 9, o2);
          }
          break;
        }
        case 'chest': {
          if (p.state === 0) {
            const pulse = 0.75 + 0.25 * Math.sin(time * 3.4);
            pen.light(x, y - 12, 78, CHEST, 0.9 * pulse, 0.1);
            if (vis && Math.random() < f.fxDt * 6) {
              const b = pen.burst(x + (Math.random() - 0.5) * 22, y - 6 - Math.random() * 14, 1, C.hot, C.gold);
              b.sprite = 'fx/spark';
              pen.speed(0, 4);
              pen.life(0.4, 0.8);
              pen.size(0.5, 0.9);
              b.gravity = -8;
              pen.emit();
            }
          } else {
            pen.light(x, y - 10, 46, CHEST, 0.35, 0.1);
          }
          break;
        }
        default:
          break;
      }

      if (vis && hovered) {
        const name = NAMES[kind];
        if (name) {
          this.hoverName = name;
          this.hoverX = x;
          // Never clipped by the top of the screen (a tall prop at the edge keeps its name inside the view).
          this.hoverY = Math.max(f.view.cy - f.view.halfH + 16, y - meta.anchorY * scaleY - 8);
        }
      }
    }
  }

  /**
   * The hovered prop's name plate. Called after the drop labels (all on 'top', in submission order), so the thing
   * the cursor is on is never hidden under loot lying next to it.
   */
  drawHoverLabel(pen: Pen): void {
    if (!this.hoverName) return;
    const o = pen.text(HOVER, 1, 1);
    pen.plate(o, C.plate, 0.88, HOVER_EDGE, 2);
    pen.r.text(this.hoverName, this.hoverX, this.hoverY, o);
    this.hoverName = '';
  }

  /**
   * The Crafting Bench: a hot workpiece glowing on the anvil face, a warm light, and now and then a few sparks
   * jumping off it as if struck — it reads as a working station, not decor. Hovered, it glows hotter.
   */
  private anvil(pen: Pen, f: FrameCtx, id: number, x: number, y: number, vis: boolean, hovered: boolean, phase: number): void {
    const r = pen.r;
    const time = f.time;
    // A slow forge "breath" with a quick flare after each strike (one strike every ANVIL_BEAT seconds).
    const t = time / ANVIL_BEAT + phase;
    const n = Math.floor(t);
    const beat = t - n;
    const strike = beat < 0.12 ? 1 - beat / 0.12 : 0;
    const last = this.anvilBeat.get(id);
    this.anvilBeat.set(id, n);
    const struck = last !== undefined && last !== n;
    const heat = 0.8 + 0.12 * Math.sin(time * 1.9 + phase) + 0.35 * strike + (hovered ? 0.3 : 0);
    // The light hangs above the face so the wooden block below is warmed, not dyed orange.
    pen.light(x, y - 18, 50, ANVIL_LIGHT, 0.36 * heat, 0.35);
    if (!vis) return;
    const g = pen.sprite('fx');
    g.additive = true;
    g.tint = ANVIL_HOT;
    g.alpha = 0.24 * heat;
    g.scaleX = 0.6;
    g.scaleY = 0.26;
    g.sortY = y + 1;
    r.sprite('fx/glow', 0, x, y - 15, g);
    const core = pen.sprite('fx');
    core.additive = true;
    core.tint = C.hot;
    core.alpha = 0.42 * heat;
    core.scaleX = 0.2;
    core.scaleY = 0.12;
    core.sortY = y + 1;
    r.sprite('fx/glow', 0, x, y - 15, core);
    // Struck sparks: a small spray on each beat, plus a rare stray ember drifting up.
    if (struck) {
      const b = pen.burst(x + (Math.random() - 0.5) * 6, y - 15, 3 + ((Math.random() * 3) | 0), C.hot, C.ember);
      b.sprite = 'fx/spark';
      pen.speed(26, 60);
      pen.life(0.25, 0.5);
      pen.size(0.4, 0.7);
      b.angle = -Math.PI / 2;
      b.spread = 2.4;
      b.gravity = 140;
      b.drag = 0.4;
      pen.emit();
    } else if (Math.random() < f.fxDt * (hovered ? 3 : 1.2)) {
      const b = pen.burst(x + (Math.random() - 0.5) * 10, y - 14, 1, C.hot, C.ember);
      b.sprite = 'fx/ember';
      pen.speed(3, 9);
      pen.life(0.8, 1.4);
      pen.size(0.5, 0.8);
      b.angle = -Math.PI / 2;
      b.spread = 0.9;
      b.gravity = -22;
      pen.emit();
    }
  }
}
