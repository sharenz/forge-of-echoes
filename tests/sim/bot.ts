// A scripted player that reads only the public WorldView and produces PlayerIntents for one
// player id: it kites around threats, dodges telegraphs and hostile projectiles, hunts idle packs,
// casts its loadout sensibly, drinks flasks, then opens the chest, collects its own (instanced)
// loot and takes the return portal. Several bots can play the same instance as a party.
// Shared by the sim tests and dev/sim.html.
import { RARITY_CODE, type PlayerIntent, type WorldView } from '../../src/contracts/sim';

export interface BotOptions {
  /** Walk to (non-blocked) drops when safe and after the clear. Default true. */
  collectDrops?: boolean;
  /** Take the return portal once everything is collected. Default true. */
  usePortal?: boolean;
}

export interface Bot {
  /** Intent for player `playerId` (default: the first player in the view). */
  intent(view: WorldView, playerId?: number): PlayerIntent;
}

const HURTFUL_AREAS = new Set(['slamWarning', 'leapWarning', 'eruptionWarning', 'meteorWarning', 'firePool']);

export function createBot(opts: BotOptions = {}): Bot {
  const collectDrops = opts.collectDrops ?? true;
  const usePortal = opts.usePortal ?? true;
  let orbit = 1;
  let lastX = 0;
  let lastY = 0;
  let stuck = 0;

  return {
    intent(view: WorldView, playerId = view.players[0]?.id ?? 0): PlayerIntent {
      const p = view.players.find((q) => q.id === playerId);
      const out: PlayerIntent = {
        moveX: 0, moveY: 0, aimX: p ? p.x : 0, aimY: p ? p.y + 50 : 0, held: [false, false, false, false, false, false], flask: -1,
      };
      if (!p || p.dead) return out;
      const R = view.arenaRadius;

      // Flasks.
      for (let k = 0; k < p.flasks.length; k++) {
        const f = p.flasks[k];
        if (!f || f.count <= 0 || f.active > 0) continue;
        if ((f.resource === 'life' && p.life < p.maxLife * 0.55) || (f.resource === 'focus' && p.focus < p.maxFocus * 0.2)) {
          out.flask = k;
          break;
        }
      }

      // Obstacle avoidance: solid props push the steering vector away; living allies keep a little
      // personal space so a party spreads out instead of stacking on one spot.
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
        if (ally.id === playerId || ally.dead) continue;
        const dx = p.x - ally.x;
        const dy = p.y - ally.y;
        const d = Math.hypot(dx, dy);
        const reach = 34;
        if (d >= reach) continue;
        // Stacked exactly: split by id so the two bots pick opposite sides.
        const ux = d > 1e-3 ? dx / d : playerId < ally.id ? -1 : 1;
        const uy = d > 1e-3 ? dy / d : 0;
        const k = (1 - d / reach) * 1.2;
        ox += ux * k;
        oy += uy * k;
      }

      const moveToward = (tx: number, ty: number, arrive = 2) => {
        const dx = tx - p.x;
        const dy = ty - p.y;
        const d = Math.hypot(dx, dy);
        if (d < arrive) return;
        let mx = dx / d + ox * 0.6;
        let my = dy / d + oy * 0.6;
        // Side-step when a prop blocks the straight line.
        if (stuck > 30) {
          mx += (-dy / d) * orbit;
          my += (dx / d) * orbit;
        }
        const l = Math.hypot(mx, my) || 1;
        out.moveX = mx / l;
        out.moveY = my / l;
      };

      const moved = Math.hypot(p.x - lastX, p.y - lastY);
      stuck = moved < 0.4 ? stuck + 1 : Math.max(0, stuck - 2);
      if (stuck > 90) {
        orbit = -orbit;
        stuck = 0;
      }
      lastX = p.x;
      lastY = p.y;

      const nearestDrop = (maxDist: number) => {
        let best = null as (typeof view.drops)[number] | null;
        let bd = maxDist;
        for (const d of view.drops) {
          // Only its own walk-over loot: a bot can't click (equipment, public floor items).
          if (d.spec.owner !== playerId || !d.spec.autoPickup || d.blocked || d.z > 0.5) continue;
          const dist = Math.hypot(d.x - p.x, d.y - p.y);
          if (dist < bd) {
            bd = dist;
            best = d;
          }
        }
        return best;
      };

      if (view.run.phase === 'cleared') {
        const chest = view.props.find((pp) => pp.kind === 'chest' && pp.state === 0);
        const drop = collectDrops ? nearestDrop(1e9) : null;
        const portal = view.props.find((pp) => pp.kind === 'returnPortal' && pp.state === 1);
        if (chest) moveToward(chest.x, chest.y);
        else if (drop) moveToward(drop.x, drop.y);
        else if (portal && usePortal) moveToward(portal.x, portal.y);
        return out;
      }

      // Threat field from monsters, hostile projectiles, telegraphs and the arena edge.
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
          const wgt = ((150 - d) / 150) ** 2 * (1 + m.radius[i] / 10);
          fx -= (dx / d) * wgt;
          fy -= (dy / d) * wgt;
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
        if (rx * vx + ry * vy <= 0) continue; // moving away
        const side = rx * vy - ry * vx >= 0 ? 1 : -1;
        const wgt = 1.6 * (1 - d / 100);
        fx += (-vy / vl) * side * -wgt;
        fy += (vx / vl) * side * -wgt;
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
        const wgt = 4 * (1 - d / reach) + 1;
        const ux = d > 1e-3 ? dx / d : 1;
        const uy = d > 1e-3 ? dy / d : 0;
        fx += ux * wgt;
        fy += uy * wgt;
      }
      const pr = Math.hypot(p.x, p.y);
      if (pr > R - 110) {
        const k = ((pr - (R - 110)) / 60) * 2;
        fx -= (p.x / pr) * k;
        fy -= (p.y / pr) * k;
      }
      fx += ox;
      fy += oy;
      const threat = Math.hypot(fx, fy);

      // Aim: the boss/lieutenant when reasonably close, else the nearest monster.
      const target = boss >= 0 && bd < 320 ? boss : nearest;
      if (target >= 0) {
        out.aimX = m.x[target];
        out.aimY = m.y[target];
      }

      // Movement.
      if (nearest < 0) {
        const drop = collectDrops ? nearestDrop(600) : null;
        if (drop) moveToward(drop.x, drop.y);
        else moveToward(0, 0, 40);
      } else {
        const dx = m.x[nearest] - p.x;
        const dy = m.y[nearest] - p.y;
        const drop = collectDrops && threat < 0.25 && nd > 200 ? nearestDrop(260) : null;
        if (drop) moveToward(drop.x, drop.y);
        else if (nd > 170 && threat < 0.3) moveToward(m.x[nearest], m.y[nearest], 140);
        else {
          // Kite: flee the threat field while orbiting the nearest monster.
          const tx = (-dy / nd) * orbit;
          const ty = (dx / nd) * orbit;
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

      // Skills.
      out.held[0] = nd < 330;
      for (let s = 1; s < p.slots.length; s++) {
        const slot = p.slots[s];
        if (!slot.skillId || !slot.usable) continue;
        switch (slot.skillId) {
          case 'emberNova':
            out.held[s] = crowd120 >= 3 || bd < 140;
            break;
          case 'rimeShards':
            out.held[s] = nd < 250;
            break;
          case 'arcChain':
            out.held[s] = nd < 230;
            break;
          case 'flameWave':
            out.held[s] = nd < 170;
            break;
          case 'cinderWard':
            out.held[s] = p.wardTime <= 0 && (crowd60 >= 2 || bd < 200);
            break;
          case 'riftStep':
            if ((inDanger || crowd60 >= 5 || p.life < p.maxLife * 0.35) && threat > 0.5) {
              out.held[s] = true;
              out.aimX = p.x + (fx / threat) * 120;
              out.aimY = p.y + (fy / threat) * 120;
            }
            break;
          default:
            out.held[s] = nd < 200;
        }
      }
      return out;
    },
  };
}
