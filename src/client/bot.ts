// Client-side autopilot (window.__foe.bot): plays the local character from the replicated WorldView, used by the
// end-to-end test and screenshot runs. In a hideout it walks into the open map portal; in a map it kites the
// horde while shooting the nearest monster (bosses first when close), dodges telegraphs and hostile projectiles,
// drinks flasks, collects its own drops when it is safe (walking over currency, flasks and maps; clicking
// equipment once in reach, like a player), and after the clear opens the chest, loots and takes the return
// portal. Public drops (other players' items on the floor) are left alone. Scripted modes for the e2e run: `hold`
// (stand on a spot while fighting, collecting nothing) and `charge` (walk into the horde: a scripted death). Pure
// apart from its own steering memory; one step per 60 Hz input tick. Dev builds only (see app.ts DEBUG_HOOKS).
import type { HeldMask } from '../contracts/net';
import { RARITY_CODE } from '../contracts/sim';
import type { DropView, PlayerView, PropView, WorldView } from '../contracts/sim';
import { PICKUP_APPROACH } from './autowalk';

export interface BotOptions {
  /** Hideout: walk into an open map portal. Default true. */
  enterPortal: boolean;
  /** Map: take the return portal once the map is cleared and looted. Default true. */
  returnPortal: boolean;
  /** Walk to own drops when safe. Default true. */
  collect: boolean;
  /** Use the non-basic loadout slots. Default true. */
  skills: boolean;
  /**
   * Map: walk to this point and stay on it (still fighting and drinking flasks), collecting nothing. Scripted
   * checks such as "standing on equipment does not pick it up". Default null.
   */
  hold: { x: number; y: number } | null;
  /** Map: walk into the nearest monster without attacking or drinking (a scripted death). Default false. */
  charge: boolean;
}

export const DEFAULT_BOT_OPTIONS: Readonly<BotOptions> = Object.freeze({
  enterPortal: true,
  returnPortal: true,
  collect: true,
  skills: true,
  hold: null,
  charge: false,
});

export interface BotOutput {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  held: HeldMask;
  flask: number;
  /** A click-to-pick-up item in reach to click this tick (−1 = none); the session rate-limits the clicks. */
  pickup: number;
}

const HURTFUL_AREAS = new Set(['slamWarning', 'leapWarning', 'eruptionWarning', 'meteorWarning', 'firePool']);
/** Standing this close to a portal counts as "in it". */
const PORTAL_REACH = 10;
/** Ticks inside an open portal without being taken → step out and back in (it was open under our feet). */
const PORTAL_STALL_TICKS = 150;

export class Autopilot {
  opts: BotOptions;
  private orbit = 1;
  private lastX = 0;
  private lastY = 0;
  private stuck = 0;
  private inPortalTicks = 0;
  private stepOutTicks = 0;

  constructor(opts: Partial<BotOptions> = {}) {
    this.opts = { ...DEFAULT_BOT_OPTIONS, ...opts };
  }

  /** Forget steering memory (zone change). */
  reset(): void {
    this.stuck = 0;
    this.inPortalTicks = 0;
    this.stepOutTicks = 0;
  }

  step(view: WorldView, localId: number, zone: 'hideout' | 'map'): BotOutput {
    const p = view.players.find((q) => q.id === localId);
    const out: BotOutput = { moveX: 0, moveY: 0, aimX: p ? p.x + 40 : 0, aimY: p ? p.y + 30 : 0, held: 0, flask: -1, pickup: -1 };
    if (!p || p.dead) return out;

    const moved = Math.hypot(p.x - this.lastX, p.y - this.lastY);
    this.stuck = moved < 0.3 ? this.stuck + 1 : Math.max(0, this.stuck - 2);
    if (this.stuck > 90) {
      this.orbit = -this.orbit;
      this.stuck = 0;
    }
    this.lastX = p.x;
    this.lastY = p.y;

    const avoid = this.avoidance(view, p, localId);
    const moveToward = (tx: number, ty: number, arrive = 2): boolean => {
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d < arrive) return true;
      let mx = dx / d + avoid.x * 0.6;
      let my = dy / d + avoid.y * 0.6;
      if (this.stuck > 30) {
        mx += (-dy / d) * this.orbit;
        my += (dx / d) * this.orbit;
      }
      const l = Math.hypot(mx, my) || 1;
      out.moveX = mx / l;
      out.moveY = my / l;
      return false;
    };

    if (zone === 'hideout') {
      const portal = view.props.find((pr) => pr.kind === 'portal' && pr.state > 0);
      if (portal && this.opts.enterPortal) this.walkIntoPortal(p, portal, out, moveToward);
      return out;
    }

    if (this.opts.charge) {
      let best = -1;
      let bestD = Infinity;
      const ms = view.monsters;
      for (let i = 0; i < ms.capacity; i++) {
        if (!ms.alive[i]) continue;
        const d = Math.hypot(ms.x[i] - p.x, ms.y[i] - p.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) moveToward(ms.x[best], ms.y[best], 0);
      return out;
    }

    this.drinkFlasks(p, out);
    const hold = this.opts.hold;
    const nearestDrop = (maxDist: number): DropView | null => {
      let best: DropView | null = null;
      let bd = maxDist;
      for (const d of view.drops) {
        if (d.spec.owner !== localId || d.blocked || d.z > 0.5) continue;
        const dist = Math.hypot(d.x - p.x, d.y - p.y);
        if (dist < bd) {
          bd = dist;
          best = d;
        }
      }
      return best;
    };
    // Equipment is never collected by walking over it: click it once it is in reach.
    const clickIfInReach = (d: DropView | null): void => {
      if (d && !d.spec.autoPickup && Math.hypot(d.x - p.x, d.y - p.y) <= PICKUP_APPROACH) out.pickup = d.id;
    };

    if (view.run.phase === 'cleared' && !hold) {
      const chest = view.props.find((pr) => pr.kind === 'chest' && pr.state === 0);
      const drop = this.opts.collect ? nearestDrop(1e9) : null;
      const portal = view.props.find((pr) => pr.kind === 'returnPortal' && pr.state > 0);
      if (chest) moveToward(chest.x, chest.y);
      else if (drop) {
        moveToward(drop.x, drop.y);
        clickIfInReach(drop);
      } else if (portal && this.opts.returnPortal) this.walkIntoPortal(p, portal, out, moveToward);
      return out;
    }

    // Threat field: monsters close by, hostile projectiles heading our way, telegraphs, the arena edge.
    const m = view.monsters;
    let fx = 0;
    let fy = 0;
    let nearest = -1;
    let nd = Infinity;
    let boss = -1;
    let bd = Infinity;
    let crowd60 = 0;
    let crowd120 = 0;
    for (let i = 0; i < m.capacity; i++) {
      if (!m.alive[i]) continue;
      const dx = m.x[i] - p.x;
      const dy = m.y[i] - p.y;
      const d = Math.hypot(dx, dy) || 1e-3;
      if (d < nd) {
        nd = d;
        nearest = i;
      }
      if ((m.rarity[i] === RARITY_CODE.boss || m.rarity[i] === RARITY_CODE.lieutenant) && d < bd) {
        bd = d;
        boss = i;
      }
      if (d < 150) {
        const w = ((150 - d) / 150) ** 2 * (1 + m.radius[i] / 10);
        fx -= (dx / d) * w;
        fy -= (dy / d) * w;
      }
      if (d < 60) crowd60++;
      if (d < 120) crowd120++;
    }
    const pj = view.projectiles;
    for (let j = 0; j < pj.capacity; j++) {
      if (!pj.alive[j] || !pj.hostile[j]) continue;
      const rx = p.x - pj.x[j];
      const ry = p.y - pj.y[j];
      const d = Math.hypot(rx, ry);
      if (d > 100) continue;
      const vx = pj.vx[j];
      const vy = pj.vy[j];
      const vl = Math.hypot(vx, vy) || 1;
      if (rx * vx + ry * vy <= 0) continue;
      const side = rx * vy - ry * vx >= 0 ? 1 : -1;
      const w = 1.6 * (1 - d / 100);
      fx += (vy / vl) * side * w;
      fy -= (vx / vl) * side * w;
    }
    let inDanger = false;
    for (const a of view.areas) {
      if (!HURTFUL_AREAS.has(a.kind)) continue;
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      const d = Math.hypot(dx, dy);
      const reach = a.radius + 22;
      if (d >= reach) continue;
      inDanger = true;
      const w = 4 * (1 - d / reach) + 1;
      fx += (d > 1e-3 ? dx / d : 1) * w;
      fy += (d > 1e-3 ? dy / d : 0) * w;
    }
    const R = view.arenaRadius;
    const pr = Math.hypot(p.x, p.y);
    if (pr > R - 110 && pr > 0) {
      const k = ((pr - (R - 110)) / 60) * 2;
      fx -= (p.x / pr) * k;
      fy -= (p.y / pr) * k;
    }
    fx += avoid.x;
    fy += avoid.y;
    const threat = Math.hypot(fx, fy);

    const target = boss >= 0 && bd < 320 ? boss : nearest;
    if (target >= 0) {
      out.aimX = m.x[target];
      out.aimY = m.y[target];
    }

    if (hold) moveToward(hold.x, hold.y, 1.5);
    else if (nearest < 0) {
      const drop = this.opts.collect ? nearestDrop(700) : null;
      if (drop) {
        moveToward(drop.x, drop.y);
        clickIfInReach(drop);
      } else moveToward(0, 0, 60);
    } else {
      const dx = m.x[nearest] - p.x;
      const dy = m.y[nearest] - p.y;
      const drop = this.opts.collect && threat < 0.25 && nd > 200 ? nearestDrop(260) : null;
      if (drop) {
        moveToward(drop.x, drop.y);
        clickIfInReach(drop);
      } else if (nd > 170 && threat < 0.3) moveToward(m.x[nearest], m.y[nearest], 140);
      else {
        // Kite: flee the threat field while circling the nearest monster.
        const tx = (-dy / nd) * this.orbit;
        const ty = (dx / nd) * this.orbit;
        const pull = nd > 140 ? 0.5 : 0;
        let mx = fx * 1.4 + tx * 0.8 + (dx / nd) * pull;
        let my = fy * 1.4 + ty * 0.8 + (dy / nd) * pull;
        const l = Math.hypot(mx, my);
        if (l > 1e-3) {
          mx /= l;
          my /= l;
        }
        out.moveX = mx;
        out.moveY = my;
      }
    }

    // Skills: the basic attack whenever something is in range, the loadout by situation.
    if (nd < 330) out.held |= 1;
    if (!this.opts.skills) return out;
    for (let s = 1; s < p.slots.length; s++) {
      const slot = p.slots[s];
      if (!slot || !slot.skillId || !slot.usable) continue;
      let hold = false;
      switch (slot.skillId) {
        case 'emberNova':
          hold = crowd120 >= 3 || bd < 140;
          break;
        case 'rimeShards':
          hold = nd < 250;
          break;
        case 'arcChain':
          hold = nd < 230;
          break;
        case 'flameWave':
          hold = nd < 170;
          break;
        case 'cinderWard':
          hold = p.wardTime <= 0 && (crowd60 >= 2 || bd < 200);
          break;
        case 'riftStep':
          if ((inDanger || crowd60 >= 5 || p.life < p.maxLife * 0.35) && threat > 0.5) {
            hold = true;
            out.aimX = p.x + (fx / threat) * 120;
            out.aimY = p.y + (fy / threat) * 120;
          }
          break;
        default:
          hold = nd < 200;
      }
      if (hold) out.held |= 1 << s;
    }
    return out;
  }

  private drinkFlasks(p: PlayerView, out: BotOutput): void {
    for (let k = 0; k < p.flasks.length; k++) {
      const f = p.flasks[k];
      if (!f || f.count <= 0 || f.active > 0) continue;
      if ((f.resource === 'life' && p.life < p.maxLife * 0.55) || (f.resource === 'focus' && p.focus < p.maxFocus * 0.2)) {
        out.flask = k;
        return;
      }
    }
  }

  /** Solid props push the steering away; allies keep a little personal space so a party spreads out. */
  private avoidance(view: WorldView, p: PlayerView, localId: number): { x: number; y: number } {
    let ox = 0;
    let oy = 0;
    for (const pr of view.props) {
      if (pr.radius <= 0) continue;
      const dx = p.x - pr.x;
      const dy = p.y - pr.y;
      const d = Math.hypot(dx, dy);
      const reach = pr.radius + 26;
      if (d < reach && d > 1e-3) {
        const k = (1 - d / reach) * 1.6;
        ox += (dx / d) * k;
        oy += (dy / d) * k;
      }
    }
    for (const ally of view.players) {
      if (ally.id === localId || ally.dead) continue;
      const dx = p.x - ally.x;
      const dy = p.y - ally.y;
      const d = Math.hypot(dx, dy);
      if (d >= 34) continue;
      const ux = d > 1e-3 ? dx / d : localId < ally.id ? -1 : 1;
      const uy = d > 1e-3 ? dy / d : 0;
      const k = (1 - d / 34) * 1.2;
      ox += ux * k;
      oy += uy * k;
    }
    return { x: ox, y: oy };
  }

  /**
   * Walk onto a portal and wait there (the sim takes a player after a short dwell). If we stand in it for long
   * without being taken — it opened under our feet and latched — step out and come back.
   */
  private walkIntoPortal(p: PlayerView, portal: PropView, out: BotOutput, moveToward: (x: number, y: number, arrive?: number) => boolean): void {
    if (this.stepOutTicks > 0) {
      this.stepOutTicks--;
      moveToward(portal.x + 70, portal.y + 40, 4);
      return;
    }
    const d = Math.hypot(portal.x - p.x, portal.y - p.y);
    if (d <= PORTAL_REACH) {
      this.inPortalTicks++;
      if (this.inPortalTicks > PORTAL_STALL_TICKS) {
        this.inPortalTicks = 0;
        this.stepOutTicks = 45;
      }
      return;
    }
    this.inPortalTicks = 0;
    moveToward(portal.x, portal.y, 3);
  }
}
