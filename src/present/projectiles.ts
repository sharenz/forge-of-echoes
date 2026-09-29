// Projectiles: rotated sprites on the additive fx layer, a short streak trail, budgeted trail particles and
// lights. Cinder Spitter spit is a lob: it flies on an arc (height 4h·u(1−u), u = age/life) with a shadow on the
// ground track and a filling landing ring where it will burst, so artillery is dodgeable at a glance.
// Friend or foe at a glance: hostile shots carry a dark-red outline, a red corona and (the Matriarch's orbs) a
// deeper ember tint, so they never read as the party's own orange-white fire; they also get a light budget of
// their own. Lights are culled by their own reach, sprites by their overhang.
import { PROJECTILE_KINDS } from '../contracts/sim';
import type { RGB } from '../contracts/render';
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
};

const LOOK_BY_INDEX: ProjLook[] = PROJECTILE_KINDS.map((k) => LOOKS[k]);
const IDS = PROJECTILE_KINDS.map((k) => `proj/${k}`);
const SPIT = PROJECTILE_KINDS.indexOf('cinderSpit');
const FLAME_WAVE = PROJECTILE_KINDS.indexOf('flameWave');
const LOB_HEIGHT = 36;
const HALO_HOSTILE: RGB = [1, 0.22, 0.1];
const OUTLINE_HOSTILE: RGB = [0.45, 0.04, 0.03];
/** Sprite tint per kind for hostile shots (null = art colours): the Matriarch's white-hot core reads as danger red. */
const HOSTILE_TINT: readonly (RGB | null)[] = PROJECTILE_KINDS.map((k) => (k === 'matriarchOrb' ? ([1, 0.48, 0.32] as RGB) : null));
/** Hostile shots bloom less than the party's own fire: their colour must read, not just their brightness. */
const HOSTILE_EMISSIVE = 0.7;

export class ProjectilePainter {
  private readonly metas: SpriteMeta[];
  /** Visible projectile count of the previous frame (scales trail emission). */
  private lastVisible = 0;
  /** Lights per 32-unit cell this frame: a volley converging on one target lights it once, not twenty times. */
  private readonly lightCells = new ImpactHeat(0);
  private frameNo = 0;

  constructor(table: SpriteTable) {
    this.metas = IDS.map((id) => table.get(id));
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

      if (k === SPIT && life > 0) {
        // Lob: landing marker first (it matters even when the spit itself is off-screen).
        const age = p.age[i];
        const u = clamp01(age / life);
        const rem = Math.max(0, life - age);
        const lx = x + vx * rem;
        const ly = y + vy * rem;
        if (lx > v.x0 - 20 && lx < v.x1 + 20 && ly > v.y0 - 20 && ly < v.y1 + 20) {
          // Quiet while far off, sharpening as it comes down: many spits must not bury the player in rings.
          const fill = pen.shape(C.danger, 0.04 + 0.1 * u * u, 'decal');
          fill.emissive = 0.5;
          r.circle(lx, ly, 12, fill);
          // The rim rises to the fx layer (over bodies) only for the last stretch before impact.
          const ring = pen.shape(C.dangerHot, 0.18 + 0.5 * u * u, u > 0.7 ? 'fx' : 'decal');
          ring.additive = true;
          ring.emissive = 0.8;
          ring.thickness = 1;
          r.ring(lx, ly, 12, ring);
          if (u > 0.35) {
            const prog = pen.shape(C.danger, 0.45 * u, 'decal');
            prog.additive = true;
            prog.thickness = 1;
            r.ring(lx, ly, Math.max(1, 12 * u), prog);
          }
        }
        if (x < v.x0 - 30 || x > v.x1 + 30 || y < v.y0 - 60 || y > v.y1 + 30) continue;
        visible++;
        const hgt = 4 * LOB_HEIGHT * u * (1 - u);
        const dh = (4 * LOB_HEIGHT * (1 - 2 * u)) / life;
        const so = pen.sprite('shadow');
        so.scaleX = 0.7 - hgt / 140;
        so.scaleY = 0.55 - hgt / 200;
        so.alpha = 0.7;
        r.sprite('fx/shadow', 0, x, y, so);
        const o = pen.sprite('fx');
        o.rotation = Math.atan2(vy - dh, vx);
        o.sortY = y;
        o.outline = OUTLINE_HOSTILE;
        r.sprite(IDS[k], Math.floor(time * 8 + i) % 2, x, y - hgt, o);
        if (lights.hostile < LIGHT_CAPS.hostile) {
          lights.hostile++;
          pen.light(x, y - hgt, look.lightRadius, look.light, look.intensity, 0.3);
        }
        if (look.trail && Math.random() < fxDt * look.trailRate) {
          const b = pen.burst(x, y - hgt, 1, look.trailC0, look.trailC1);
          b.sprite = look.trail;
          pen.speed(1, 5);
          pen.life(0.4, 0.7);
          pen.size(0.35, 0.55);
          b.sizeEnd = 1.4;
          b.additive = false;
          b.emissive = 0;
          b.gravity = -12;
          pen.emit();
        }
        continue;
      }

      // Projectiles fly at chest height: the sprite rides 8 units above its ground track.
      const lift = k === FLAME_WAVE ? 6 : 8;
      if (x < v.x0 - 30 || x > v.x1 + 30 || y < v.y0 - 30 || y > v.y1 + 30) {
        // Off screen, but its light may still reach the floor you can see.
        if (lightInView(v, x, y - lift, look.lightRadius) && this.lightSlot(x, y - lift, hostile) && (hostile ? lights.hostile++ < LIGHT_CAPS.hostile : lights.projectile++ < LIGHT_CAPS.projectile)) {
          pen.light(x, y - lift, look.lightRadius, look.light, look.intensity, 0.15);
        }
        continue;
      }
      visible++;
      const ang = Math.atan2(vy, vx);
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
      o.rotation = ang;
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
  }

  /** May a projectile light at (x, y) this frame? Two per cell for the party's shots, three for hostile ones. */
  private lightSlot(x: number, y: number, hostile: boolean): boolean {
    // The frame number is the cache's clock: every frame is its own window.
    return this.lightCells.touch(x, y, this.frameNo) < (hostile ? 3 : 2);
  }
}
