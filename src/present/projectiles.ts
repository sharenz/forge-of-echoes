// Projectiles: rotated sprites on the additive fx layer, a short streak trail, budgeted trail particles and
// lights. Lobs (Cinder Spitter spit, Tar Slinger tar: ProjectileStoreView.life > 0) fly on an arc (height
// 4h·u(1−u), u = age/life) with a shadow on the ground track and a landing marker where they will land, so
// artillery is dodgeable at a glance. The marker shows everything the landing does: fire is a red ring of its
// splash; tar is a dark disc with an amber rim the size of the POOL it leaves (TAR_POOL_RADIUS — the pool roots
// whoever it touches, so that is the zone to leave), with the smaller splash as the progress ring filling inside.
// A chain hook drags its chain behind it: repeated 'fx/chain' links from its thrower's fist to the hook. The store
// has no thrower, so the first sight of a hook claims the nearest Chain Thrall / Chainmaster to its launch point
// (x − vx·age, y − vy·age) and keeps the fist's offset from its feet: the chain stays on him if he is shoved
// during the flight (no thrower in view: the launch point). A hook that ends without a pull reels back to him
// (a pull draws its own taut chain: chain.ts Tethers). The crossbow bolt is fast and carries a long pale motion
// streak; the tumbling bone shard is not rotated (its frames already turn).
// Friend or foe at a glance: hostile shots carry a dark-red outline, a red corona and (the Matriarch's orbs) a
// deeper ember tint, so they never read as the party's own orange-white fire; they also get a light budget of
// their own. Lights are culled by their own reach, sprites by their overhang.
import { PROJECTILE_KINDS } from '../contracts/sim';
import type { RGB } from '../contracts/render';
import { MONSTER_KINDS } from '../contracts/content';
import { isLobKind, lobHeight, SPIT_SPLASH_RADIUS, TAR_POOL_RADIUS, TAR_SPLASH_RADIUS } from './bestiary';
import { drawChain, type Tethers } from './chain';
import { C } from './colors';
import { LIGHT_CAPS, lightInView, type FrameCtx } from './context';
import { ImpactHeat } from './heat';
import { clamp01 } from './math';
import type { Pen } from './pen';
import type { SpriteMeta, SpriteTable } from './sprites';

interface ProjLook {
  light: RGB;
  lightRadius: number;
  intensity: number;
  /** Streak colour (null = no streak) and length in seconds of travel. */
  streak: RGB | null;
  streakTime: number;
  /** Trail particle sprite and colours (null = none) and rate per second at low counts. */
  trail: string | null;
  trailC0: RGB;
  trailC1: RGB;
  trailRate: number;
}

const LOOKS: Record<(typeof PROJECTILE_KINDS)[number], ProjLook> = {
  emberLance: { light: C.flame, lightRadius: 42, intensity: 0.6, streak: C.ember, streakTime: 0.05, trail: 'fx/ember', trailC0: C.flame, trailC1: C.lavaDark, trailRate: 30 },
  novaFlame: { light: C.flame, lightRadius: 32, intensity: 0.35, streak: C.ember, streakTime: 0.035, trail: 'fx/ember', trailC0: C.hot, trailC1: C.ember, trailRate: 10 },
  flameWave: { light: C.flame, lightRadius: 44, intensity: 0.45, streak: null, streakTime: 0, trail: 'fx/ember', trailC0: C.hot, trailC1: C.ember, trailRate: 26 },
  rimeShard: { light: C.frost, lightRadius: 34, intensity: 0.4, streak: C.mana, streakTime: 0.045, trail: 'fx/frost', trailC0: C.ice, trailC1: C.mana, trailRate: 16 },
  cinderSpit: { light: C.ember, lightRadius: 34, intensity: 0.5, streak: null, streakTime: 0, trail: 'fx/smoke', trailC0: [0.3, 0.2, 0.18], trailC1: C.smokeEnd, trailRate: 14 },
  heraldOrb: { light: C.voidGlow, lightRadius: 42, intensity: 0.55, streak: C.void, streakTime: 0.06, trail: 'fx/spark', trailC0: C.voidHi, trailC1: C.void, trailRate: 14 },
  matriarchOrb: { light: [1, 0.24, 0.07], lightRadius: 46, intensity: 0.55, streak: C.ember, streakTime: 0.06, trail: 'fx/ember', trailC0: C.hot, trailC1: C.lavaDark, trailRate: 16 },
  // Rimed Ossuary / Iron Coliseum rosters
  webShot: { light: [0.62, 0.84, 1], lightRadius: 32, intensity: 0.42, streak: null, streakTime: 0, trail: 'fx/frost', trailC0: C.ice, trailC1: C.frost, trailRate: 14 },
  frostShard: { light: C.frost, lightRadius: 34, intensity: 0.42, streak: C.mana, streakTime: 0.05, trail: 'fx/frost', trailC0: C.ice, trailC1: C.mana, trailRate: 12 },
  crossbowBolt: { light: [1, 0.75, 0.55], lightRadius: 22, intensity: 0.22, streak: [0.95, 0.88, 0.76], streakTime: 0.07, trail: null, trailC0: C.white, trailC1: C.white, trailRate: 0 },
  chainHook: { light: [1, 0.42, 0.16], lightRadius: 26, intensity: 0.32, streak: null, streakTime: 0, trail: 'fx/spark', trailC0: C.hot, trailC1: C.ember, trailRate: 10 },
  tarGlob: { light: [1, 0.6, 0.25], lightRadius: 18, intensity: 0.14, streak: null, streakTime: 0, trail: 'fx/spark', trailC0: [0.2, 0.15, 0.1], trailC1: [0.05, 0.04, 0.03], trailRate: 10 },
  boneShard: { light: [0.8, 0.88, 1], lightRadius: 22, intensity: 0.22, streak: C.bone, streakTime: 0.035, trail: 'fx/ash', trailC0: C.bone, trailC1: C.ash, trailRate: 8 },
};

/** Landing marker per lob kind: fill, rim and progress colours, the splash and what it leaves behind. */
interface LobLook {
  fill: RGB;
  fillAlpha: number;
  rim: RGB;
  prog: RGB;
  /** Splash radius of the landing (the progress ring fills to it). */
  splash: number;
  /** Radius of the ground area the landing leaves (0 = none): the marker's disc and rim show it. */
  pool: number;
  apex: number;
}
const LOB_FIRE: LobLook = { fill: C.danger, fillAlpha: 1, rim: C.dangerHot, prog: C.danger, splash: SPIT_SPLASH_RADIUS, pool: 0, apex: 36 };
const LOB_TAR: LobLook = {
  fill: [0.02, 0.015, 0.01], fillAlpha: 3.2, rim: [1, 0.62, 0.24], prog: [1, 0.45, 0.16], splash: TAR_SPLASH_RADIUS, pool: TAR_POOL_RADIUS, apex: 42,
};

/** Radius of the zone a lob's landing marker must cover: the pool it leaves, else its splash. */
export function lobMarkerRadius(kind: (typeof PROJECTILE_KINDS)[number]): number {
  if (!isLobKind(kind)) return 0;
  const l = kind === 'tarGlob' ? LOB_TAR : LOB_FIRE;
  return l.pool > 0 ? l.pool : l.splash;
}

const LOOK_BY_INDEX: ProjLook[] = PROJECTILE_KINDS.map((k) => LOOKS[k]);
const IDS = PROJECTILE_KINDS.map((k) => `proj/${k}`);
const LOB: readonly (LobLook | null)[] = PROJECTILE_KINDS.map((k) => (isLobKind(k) ? (k === 'tarGlob' ? LOB_TAR : LOB_FIRE) : null));
const FLAME_WAVE = PROJECTILE_KINDS.indexOf('flameWave');
const CHAIN_HOOK = PROJECTILE_KINDS.indexOf('chainHook');
const BONE_SHARD = PROJECTILE_KINDS.indexOf('boneShard');
const TAR_GLOB = PROJECTILE_KINDS.indexOf('tarGlob');
const CHAIN_THRALL = MONSTER_KINDS.indexOf('chainThrall');
const CHAINMASTER = MONSTER_KINDS.indexOf('chainmaster');
/** Chain hooks in flight (and reeling back) tracked at once. */
const HOOK_CAP = 16;
/** A hook's thrower stands within this of its launch point (his radius + the sim's 2-unit muzzle offset, and some). */
const HOOK_MATCH = 36;
/** The fist the chain hangs from stays within this of the thrower's feet (a far launch point is not his hand). */
const HOOK_FIST_MAX = 24;
/** A missed hook reels back to its thrower over this long. */
const HOOK_RETRACT = 0.2;
/** Chest height of the chain, like the hook sprite. */
const HOOK_LIFT = 8;
const HALO_HOSTILE: RGB = [1, 0.22, 0.1];
const OUTLINE_HOSTILE: RGB = [0.45, 0.04, 0.03];
/** Sprite tint per kind for hostile shots (null = art colours): the Matriarch's white-hot core reads as danger red. */
const HOSTILE_TINT: readonly (RGB | null)[] = PROJECTILE_KINDS.map((k) =>
  k === 'matriarchOrb' ? ([1, 0.48, 0.32] as RGB) : k === 'frostShard' ? ([0.72, 0.88, 1] as RGB) : null,
);
/** Hostile shots bloom less than the party's own fire: their colour must read, not just their brightness. */
const HOSTILE_EMISSIVE = 0.7;

/** A chain hook's memory (by projectile id: view slots may be reshuffled between snapshots). */
interface Hook {
  /** In use (in flight or reeling back). */
  used: boolean;
  /** Projectile id. */
  id: number;
  /** Thrower's monster id (0 = none found) and his last known view index. */
  owner: number;
  ownerIdx: number;
  /** The fist the chain hangs from, relative to the thrower's feet. */
  offX: number;
  offY: number;
  /** Launch point (the anchor when there is no thrower). */
  lx: number;
  ly: number;
  /** Last drawn hook position (feet) and anchor (feet): where a retract starts. */
  hx: number;
  hy: number;
  ax: number;
  ay: number;
  /** Frame it was last seen in flight; retract age (< 0: in flight). */
  frame: number;
  retract: number;
}

export class ProjectilePainter {
  private readonly metas: SpriteMeta[];
  /** Visible projectile count of the previous frame (scales trail emission). */
  private lastVisible = 0;
  /** Lights per 32-unit cell this frame: a volley converging on one target lights it once, not twenty times. */
  private readonly lightCells = new ImpactHeat(0);
  private frameNo = 0;
  private readonly hooks: Hook[] = [];
  private readonly anchor = { x: 0, y: 0 };

  constructor(table: SpriteTable, private readonly tethers: Tethers | null = null) {
    this.metas = IDS.map((id) => table.get(id));
    for (let k = 0; k < HOOK_CAP; k++) {
      this.hooks.push({ used: false, id: 0, owner: 0, ownerIdx: -1, offX: 0, offY: 0, lx: 0, ly: 0, hx: 0, hy: 0, ax: 0, ay: 0, frame: 0, retract: -1 });
    }
  }

  /** Zone change: forget hooks in flight. */
  reset(): void {
    for (const h of this.hooks) {
      h.used = false;
      h.retract = -1;
    }
  }

  draw(pen: Pen, f: FrameCtx): void {
    const p = f.world.projectiles;
    const r = pen.r;
    const v = f.view;
    const a = f.alpha;
    const lights = f.lights;
    const fxDt = f.fxDt;
    const time = f.time;
    this.frameNo++;
    // Keep trail particles roughly constant in total, however many projectiles fly.
    const trailScale = Math.min(1, 45 / Math.max(1, this.lastVisible));
    let visible = 0;
    const cap = p.capacity;
    for (let i = 0; i < cap; i++) {
      if (!p.alive[i]) continue;
      const k = p.kind[i];
      const look = LOOK_BY_INDEX[k];
      if (!look) continue;
      const x = p.prevX[i] + (p.x[i] - p.prevX[i]) * a;
      const y = p.prevY[i] + (p.y[i] - p.prevY[i]) * a;
      const vx = p.vx[i];
      const vy = p.vy[i];
      const hostile = p.hostile[i] === 1;
      const life = p.life[i];

      const lob = LOB[k];
      if (lob && life > 0) {
        // Lob: landing marker first (it matters even when the shot itself is off-screen).
        const age = p.age[i];
        const u = clamp01(age / life);
        const rem = Math.max(0, life - age);
        const lx = x + vx * rem;
        const ly = y + vy * rem;
        // The marker covers everything the landing does: the pool it leaves (tar roots anyone it touches), else
        // the splash. The progress ring fills to the splash.
        const lr = lob.pool > 0 ? lob.pool : lob.splash;
        const pad = lr + 8;
        if (lx > v.x0 - pad && lx < v.x1 + pad && ly > v.y0 - pad && ly < v.y1 + pad) {
          // Quiet while far off, sharpening as it comes down: many lobs must not bury the player in rings.
          const fill = pen.shape(lob.fill, Math.min(0.6, (0.04 + 0.1 * u * u) * lob.fillAlpha), 'decal');
          fill.emissive = k === TAR_GLOB ? 0 : 0.5;
          r.circle(lx, ly, lr, fill);
          // The rim rises to the fx layer (over bodies) only for the last stretch before impact.
          const ring = pen.shape(lob.rim, 0.18 + 0.5 * u * u, u > 0.7 ? 'fx' : 'decal');
          ring.additive = true;
          ring.emissive = 0.8;
          ring.thickness = 1;
          r.ring(lx, ly, lr, ring);
          if (lob.pool > 0) {
            // The splash inside the pool: a faint ring the progress fills to.
            const sp = pen.shape(lob.prog, 0.1 + 0.2 * u, 'decal');
            sp.additive = true;
            sp.emissive = 0.5;
            sp.thickness = 1;
            r.ring(lx, ly, lob.splash, sp);
          }
          if (u > 0.35) {
            const prog = pen.shape(lob.prog, 0.45 * u, 'decal');
            prog.additive = true;
            prog.thickness = 1;
            r.ring(lx, ly, Math.max(1, lob.splash * u), prog);
          }
        }
        if (x < v.x0 - 30 || x > v.x1 + 30 || y < v.y0 - 60 || y > v.y1 + 30) continue;
        visible++;
        const hgt = lobHeight(u, lob.apex);
        const dh = (4 * lob.apex * (1 - 2 * u)) / life;
        const so = pen.sprite('shadow');
        so.scaleX = 0.7 - hgt / 140;
        so.scaleY = 0.55 - hgt / 200;
        so.alpha = 0.7;
        r.sprite('fx/shadow', 0, x, y, so);
        const o = pen.sprite('fx');
        o.rotation = Math.atan2(vy - dh, vx);
        o.sortY = y;
        o.outline = OUTLINE_HOSTILE;
        const lm = this.metas[k];
        r.sprite(IDS[k], lm.frames > 1 ? Math.floor(time * (lm.fps || 8) + i) % lm.frames : 0, x, y - hgt, o);
        if (lights.hostile < LIGHT_CAPS.hostile) {
          lights.hostile++;
          pen.light(x, y - hgt, look.lightRadius, look.light, look.intensity, 0.3);
        }
        if (look.trail && Math.random() < fxDt * look.trailRate) {
          const b = pen.burst(x, y - hgt, 1, look.trailC0, look.trailC1);
          b.sprite = k === TAR_GLOB ? 'fx/spark' : look.trail;
          pen.speed(1, 5);
          pen.life(0.4, 0.7);
          pen.size(0.35, 0.55);
          b.sizeEnd = k === TAR_GLOB ? 0.6 : 1.4;
          b.additive = false;
          b.emissive = 0;
          // Smoke rises; tar drips.
          b.gravity = k === TAR_GLOB ? 90 : -12;
          pen.emit();
        }
        continue;
      }

      // Projectiles fly at chest height: the sprite rides 8 units above its ground track.
      const lift = k === FLAME_WAVE ? 6 : 8;
      if (x < v.x0 - 30 || x > v.x1 + 30 || y < v.y0 - 30 || y > v.y1 + 30) {
        // Off screen, but its chain or its light may still reach the floor you can see.
        if (k === CHAIN_HOOK) {
          const at = this.hookAnchor(f, p.id[i], x, y, x - vx * p.age[i], y - vy * p.age[i]);
          drawChain(pen, at.x, at.y - lift, x, y - lift, 1, Math.max(y, at.y) - 0.5);
        }
        if (lightInView(v, x, y - lift, look.lightRadius) && this.lightSlot(x, y - lift, hostile) && (hostile ? lights.hostile++ < LIGHT_CAPS.hostile : lights.projectile++ < LIGHT_CAPS.projectile)) {
          pen.light(x, y - lift, look.lightRadius, look.light, look.intensity, 0.15);
        }
        continue;
      }
      visible++;
      const ang = Math.atan2(vy, vx);
      if (k === CHAIN_HOOK) {
        // The chain pays out behind the hook, all the way back to the fist that threw it.
        const at = this.hookAnchor(f, p.id[i], x, y, x - vx * p.age[i], y - vy * p.age[i]);
        drawChain(pen, at.x, at.y - lift, x - Math.cos(ang) * 5, y - Math.sin(ang) * 5 - lift, 1, Math.max(y, at.y) - 0.5);
      }
      if (hostile) {
        const g = pen.sprite('fx');
        g.additive = true;
        g.tint = HALO_HOSTILE;
        g.alpha = 0.16;
        g.scale = 0.6;
        g.sortY = y;
        r.sprite('fx/glow', 0, x, y - lift, g);
      }
      if (look.streak) {
        const sx = x - vx * look.streakTime;
        const sy = y - vy * look.streakTime;
        const so = pen.shape(look.streak, hostile ? 0.5 : 0.32, 'fx');
        so.additive = true;
        so.thickness = k === 0 ? 2 : 1;
        r.line(sx, sy - lift, x, y - lift, so);
      }
      const o = pen.sprite('fx');
      if (k !== BONE_SHARD) o.rotation = ang;
      o.sortY = y;
      if (hostile) {
        o.outline = OUTLINE_HOSTILE;
        o.emissive = HOSTILE_EMISSIVE;
        const tint = HOSTILE_TINT[k];
        if (tint) o.tint = tint;
      }
      const meta = this.metas[k];
      r.sprite(IDS[k], meta.frames > 1 ? Math.floor(time * meta.fps + i) % meta.frames : 0, x, y - lift, o);
      // Hostile shots have their own (larger share of the) budget: danger must stay lit.
      if (this.lightSlot(x, y - lift, hostile) && (hostile ? lights.hostile++ < LIGHT_CAPS.hostile : lights.projectile++ < LIGHT_CAPS.projectile)) {
        pen.light(x, y - lift, look.lightRadius, look.light, look.intensity, 0.15);
      }
      if (look.trail && Math.random() < fxDt * look.trailRate * trailScale) {
        const b = pen.burst(x - vx * 0.02, y - lift - vy * 0.02, 1, look.trailC0, look.trailC1);
        b.sprite = look.trail;
        pen.speed(3, 14);
        pen.life(0.18, 0.4);
        pen.size(0.5, 0.9);
        b.sizeEnd = 0.4;
        pen.emit();
      }
    }
    this.lastVisible = visible;
    this.reelHooks(pen, f);
  }

  /**
   * Anchor (feet) of the chain of hook `id` at (x, y) launched from (lx, ly): its thrower's fist, claimed on first
   * sight and followed while he lives, else the launch point.
   */
  private hookAnchor(f: FrameCtx, id: number, x: number, y: number, lx: number, ly: number): { x: number; y: number } {
    const hooks = this.hooks;
    let h: Hook | null = null;
    let free: Hook | null = null;
    for (let k = 0; k < HOOK_CAP; k++) {
      const e = hooks[k];
      if (e.used && e.id === id && e.retract < 0) {
        h = e;
        break;
      }
      if (!free && (!e.used || (e.retract < 0 && e.frame < this.frameNo - 1))) free = e;
    }
    const out = this.anchor;
    if (!h) {
      if (!free) {
        out.x = lx;
        out.y = ly;
        return out;
      }
      h = free;
      h.used = true;
      h.id = id;
      h.retract = -1;
      h.lx = lx;
      h.ly = ly;
      h.owner = 0;
      h.ownerIdx = -1;
      const m = f.world.monsters;
      const a = f.alpha;
      let best = HOOK_MATCH * HOOK_MATCH;
      for (let i = 0; i < m.capacity; i++) {
        if (!m.alive[i] || (m.kind[i] !== CHAIN_THRALL && m.kind[i] !== CHAINMASTER)) continue;
        const mx = m.prevX[i] + (m.x[i] - m.prevX[i]) * a;
        const my = m.prevY[i] + (m.y[i] - m.prevY[i]) * a;
        const d = (mx - lx) * (mx - lx) + (my - ly) * (my - ly);
        if (d < best) {
          best = d;
          h.owner = m.id[i];
          h.ownerIdx = i;
          // The fist: towards the launch point, never further out than his reach.
          const dx = lx - mx;
          const dy = ly - my;
          const len = Math.sqrt(d);
          const kk = len > HOOK_FIST_MAX ? HOOK_FIST_MAX / len : 1;
          h.offX = dx * kk;
          h.offY = dy * kk;
        }
      }
    }
    h.frame = this.frameNo;
    h.hx = x;
    h.hy = y;
    this.ownerFist(f, h, out);
    h.ax = out.x;
    h.ay = out.y;
    return out;
  }

  /** The fist of a hook's thrower this frame (his interpolated feet + the claimed offset), else the launch point. */
  private ownerFist(f: FrameCtx, h: Hook, out: { x: number; y: number }): void {
    out.x = h.lx;
    out.y = h.ly;
    if (!h.owner) return;
    const m = f.world.monsters;
    let i = h.ownerIdx;
    if (!(i >= 0 && i < m.capacity && m.alive[i] && m.id[i] === h.owner)) {
      // View slots can be reshuffled between snapshots: look him up by id.
      i = -1;
      for (let q = 0; q < m.capacity; q++) {
        if (m.alive[q] && m.id[q] === h.owner) {
          i = q;
          break;
        }
      }
      h.ownerIdx = i;
      if (i < 0) {
        h.owner = 0;
        return;
      }
    }
    const a = f.alpha;
    out.x = m.prevX[i] + (m.x[i] - m.prevX[i]) * a + h.offX;
    out.y = m.prevY[i] + (m.y[i] - m.prevY[i]) * a + h.offY;
  }

  /**
   * Hooks no longer in flight: a hook that connected is drawn by its pull tether from now on; one that missed reels
   * back to the thrower's fist over HOOK_RETRACT.
   */
  private reelHooks(pen: Pen, f: FrameCtx): void {
    const hooks = this.hooks;
    for (let k = 0; k < HOOK_CAP; k++) {
      const h = hooks[k];
      if (!h.used) continue;
      if (h.retract < 0 && h.frame === this.frameNo) continue;
      // It ended. Caught someone: the pull's tether takes over (never two chains on one line; over the network the
      // pull may land a frame or two after the hook left the view, so this is checked while it reels, too).
      if (this.tethers?.pulledNear(h.hx, h.hy, 28)) {
        h.used = false;
        h.retract = -1;
        continue;
      }
      if (h.retract < 0) h.retract = 0;
      h.retract += f.dt;
      if (h.retract >= HOOK_RETRACT) {
        h.used = false;
        h.retract = -1;
        continue;
      }
      const at = this.anchor;
      this.ownerFist(f, h, at);
      const t = h.retract / HOOK_RETRACT;
      const e = t * t;
      const ex = h.hx + (at.x - h.hx) * e;
      const ey = h.hy + (at.y - h.hy) * e;
      // A little slack as it whips back.
      drawChain(pen, at.x, at.y - HOOK_LIFT, ex, ey - HOOK_LIFT, 1 - 0.5 * t, Math.max(ey, at.y) - 0.5, 4 * t);
    }
  }

  /** May a projectile light at (x, y) this frame? Two per cell for the party's shots, three for hostile ones. */
  private lightSlot(x: number, y: number, hostile: boolean): boolean {
    // The frame number is the cache's clock: every frame is its own window.
    return this.lightCells.touch(x, y, this.frameNo) < (hostile ? 3 : 2);
  }
}
