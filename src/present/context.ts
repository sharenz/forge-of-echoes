// Per-frame context shared by the presentation sub-systems (one mutable object, refilled every frame).
import type { Theme } from '../contracts/content';
import type { PlayerView, WorldView } from '../contracts/sim';
import type { ThemeLook } from './themes';
import { THEME_LOOKS } from './themes';

export interface ViewRect {
  /** Visible world rectangle plus a margin for sprites that overhang. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Exact camera centre and half extents (no margin). */
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
}

/** Point lights are cheap but not free: cap each family per frame (the nearest-first order is the scan order). */
export class LightBudget {
  projectile = 0;
  hostile = 0;
  burning = 0;
  mote = 0;
  area = 0;
  drop = 0;
  rare = 0;
  reset(): void {
    this.projectile = 0;
    this.hostile = 0;
    this.burning = 0;
    this.mote = 0;
    this.area = 0;
    this.drop = 0;
    this.rare = 0;
  }
}

/** Slam telegraphs smaller than this are segments of the Matriarch's charge lane (sim: chargeRadius 26; the
 * smallest real slam is the brute's 42). */
export const CHARGE_MAX_RADIUS = 34;

export const LIGHT_CAPS = { projectile: 56, hostile: 40, burning: 22, mote: 20, area: 24, drop: 28, rare: 12 } as const;

/**
 * Does a light of `radius` at (x, y) reach the visible screen? Lights are culled by their own reach, not by the
 * sprite that carries them: a brazier just above the top edge still lights the floor you can see, and switching
 * it off there would pop.
 */
export function lightInView(v: ViewRect, x: number, y: number, radius: number): boolean {
  return x + radius > v.cx - v.halfW && x - radius < v.cx + v.halfW && y + radius > v.cy - v.halfH && y - radius < v.cy + v.halfH;
}

export interface FrameCtx {
  /** Presentation clock (seconds since the presenter was created). */
  time: number;
  /** Real frame delta (seconds, clamped). */
  dt: number;
  /** Delta for cosmetic effects: scaled down during slow-mo moments. */
  fxDt: number;
  alpha: number;
  /** Camera zoom (text is drawn at a fixed pixel size: divide pixel sizes by this to get world units). */
  zoom: number;
  localId: number;
  local: PlayerView | null;
  world: WorldView;
  theme: Theme;
  look: ThemeLook;
  view: ViewRect;
  lights: LightBudget;
  /** Prop under the cursor (hideout objects, portals, the Crafting Bench anvil) for the hover highlight, or −1. */
  hoverPropId: number;
  /** Drop under the cursor (label / sprite highlight), or −1. */
  hoverDropId: number;
}

export function createFrameCtx(world: WorldView): FrameCtx {
  return {
    time: 0,
    dt: 0,
    fxDt: 0,
    alpha: 1,
    zoom: 1,
    localId: 0,
    local: null,
    world,
    theme: world.theme,
    look: THEME_LOOKS[world.theme] ?? THEME_LOOKS.hideout,
    view: { x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, halfW: 320, halfH: 180 },
    lights: new LightBudget(),
    hoverPropId: -1,
    hoverDropId: -1,
  };
}
