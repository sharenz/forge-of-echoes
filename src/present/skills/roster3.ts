// Visuals of the power rework's roster batch 3 (SK4): Meteor Rain, Storm Step, Tempest Surge, Blizzard, Event Horizon. Tempest Surge's
// pulses and Forking Step's forks are the 'chain' events Arc Chain already draws; Storm Step's blink is the shared 'dash'. The meteor
// telegraphs, the storm and the horizon are the PLAYER's own ground: drawn in her element palette with soft rims and no danger red, so
// they never read as something to dodge.
//   cast(...)            per-skill muzzle (false for skills outside this batch)
//   nova(...)            Storm Step's strikes, Event Horizon's detonation
//   buff(...) / draw()   Tempest Surge's crackling aura on the caster
//   areaResolve(...)     a meteor landing, the storm and the horizon fading
//   drawRoster3Area(...) the friendly telegraphs and zones (called by AreaPainter)
import type { RGB } from '../../contracts/render';
import type { SkillId } from '../../contracts/content';
import type { AreaView, SimEvent } from '../../contracts/sim';
import { C } from '../colors';
import type { FrameCtx } from '../context';
import { sparks } from '../fx';
import { clamp01, TAU } from '../math';
import type { Pen } from '../pen';
import type { RosterKit } from './roster';

const METEOR: RGB = [1, 0.7, 0.32];
const STORM_FRIENDLY: RGB = [0.62, 0.78, 1];
const SURGE: RGB = [0.8, 0.86, 1];
const SNOW: RGB = [0.88, 0.96, 1];
const SNOW_DIM: RGB = [0.5, 0.7, 0.85];
const HORIZON: RGB = [0.5, 0.26, 0.82];

/** The batch's skills (their cast visuals live here). */
export const ROSTER3_SKILLS: ReadonlySet<SkillId> = new Set<SkillId>(['meteorRain', 'stormStep', 'tempestSurge', 'blizzard', 'eventHorizon']);

const AREA_KINDS = new Set<AreaView['kind']>(['meteorRain', 'blizzardStorm', 'eventHorizon']);

interface Aura {
  playerId: number;
  left: number;
  total: number;
}

const AURA_CAP = 16;

export class Roster3Fx {
  private readonly auras: Aura[] = [];

  constructor(private readonly k: RosterKit) {}

  reset(): void {
    this.auras.length = 0;
  }

  /** Muzzle of a cast at the wand tip (x, y) toward `ang`; `pk` scales the light pulse. False when not in this batch. */
  cast(skill: SkillId, x: number, y: number, ang: number, pk: number): boolean {
    if (!ROSTER3_SKILLS.has(skill)) return false;
    const { pen, fx } = this.k;
    switch (skill) {
      case 'meteorRain': {
        // Embers thrown up toward the sky the meteors will fall from.
        const b = pen.burst(x, y, 12, C.hot, C.ember);
        pen.speed(20, 60);
        pen.upward(80, 160);
        pen.life(0.3, 0.6);
        pen.size(0.5, 0.9);
        b.gravity = -40;
        pen.emit();
        if (pk > 0) fx.pulses.spawn(x, y, 54, 0.22, C.flame, 0.5 * pk);
        return true;
      }
      case 'tempestSurge':
        sparks(pen, x, y, 12, C.lightning, C.storm, 30, 90, 0.2);
        if (pk > 0) fx.pulses.spawn(x, y, 60, 0.2, C.lightning, 0.55 * pk);
        return true;
      case 'blizzard': {
        const b = pen.burst(x, y, 10, C.ice, C.mana);
        b.sprite = 'fx/frost';
        pen.speed(20, 60);
        pen.life(0.25, 0.5);
        pen.size(0.4, 0.8);
        b.angle = ang;
        b.spread = 1.2;
        b.drag = 0.88;
        pen.emit();
        if (pk > 0) fx.pulses.spawn(x, y, 48, 0.2, C.frost, 0.45 * pk);
        return true;
      }
      case 'eventHorizon': {
        const b = pen.burst(x, y, 14, C.voidHi, C.void);
        b.sprite = 'fx/mote';
        pen.speed(10, 40);
        pen.life(0.3, 0.6);
        pen.size(0.6, 1);
        b.drag = 0.85;
        pen.emit();
        if (pk > 0) fx.pulses.spawn(x, y, 64, 0.3, C.voidGlow, 0.6 * pk);
        return true;
      }
      default:
        // Storm Step blinks (its 'dash' event and strikes show it).
        return true;
    }
  }

  /** Storm Step's strikes, Event Horizon's detonation. False for other skills. */
  nova(e: Extract<SimEvent, { t: 'nova' }>, own: boolean): boolean {
    const { pen, fx } = this.k;
    switch (e.skill) {
      case 'stormStep': {
        // A short jagged bolt onto the spot and a flash ring of the strike's radius.
        const pts: number[] = [];
        let x = e.x + (Math.random() - 0.5) * 14;
        for (let k = 0; k <= 4; k++) {
          const y = e.y - 110 + k * 26;
          pts.push(k === 4 ? e.x : x, k === 4 ? e.y - 6 : y);
          x += (Math.random() - 0.5) * 14;
        }
        fx.chains.spawn(pts, 'lightning');
        fx.rings.spawn(e.x, e.y, e.radius * 0.25, e.radius, 0.25, STORM_FRIENDLY, 1, 0.85, 0.6);
        sparks(pen, e.x, e.y - 6, 12, C.lightning, C.storm, 50, 150, 0.22);
        fx.pulses.spawn(e.x, e.y - 10, e.radius * 2, 0.2, C.lightning, own ? 0.6 : 0.35);
        fx.decals.spawn(e.x, e.y, e.radius / 60, 4, 0.3);
        return true;
      }
      case 'eventHorizon': {
        // The point folds in, then bursts outward in a violet shock ring.
        fx.rings.spawn(e.x, e.y - 4, e.radius * 1.4, 6, 0.16, C.voidGlow, 2, 0.9, 0.6);
        fx.rings.spawn(e.x, e.y - 4, 10, e.radius, 0.35, HORIZON, 3, 0.9, 0.8);
        const b = pen.burst(e.x, e.y - 6, 40, C.voidHi, C.void);
        b.sprite = 'fx/mote';
        pen.speed(e.radius * 1.4, e.radius * 2.6);
        pen.life(0.3, 0.6);
        pen.size(0.7, 1.2);
        b.drag = 0.88;
        pen.emit();
        fx.pulses.spawn(e.x, e.y - 8, e.radius * 2.2, 0.4, C.voidGlow, own ? 0.9 : 0.5);
        fx.decals.spawn(e.x, e.y, e.radius / 40, 6, 0.6);
        return true;
      }
      default:
        return false;
    }
  }

  /** Tempest Surge began (its aura). False for buffs of other skills. */
  buff(e: Extract<SimEvent, { t: 'buff' }>): boolean {
    if (e.skill !== 'tempestSurge') return false;
    const same = this.auras.findIndex((a) => a.playerId === e.playerId);
    if (e.duration <= 0) {
      if (same >= 0) this.auras.splice(same, 1);
      return true;
    }
    if (same >= 0) {
      this.auras[same].left = e.duration;
      this.auras[same].total = e.duration;
    } else {
      if (this.auras.length >= AURA_CAP) this.auras.shift();
      this.auras.push({ playerId: e.playerId, left: e.duration, total: e.duration });
    }
    this.k.fx.rings.spawn(e.x, e.y - 4, 6, 44, 0.3, SURGE, 1, 0.85, 0.5);
    return true;
  }

  /** Active surges: a crackling double ring and sparks jumping off her. */
  draw(pen: Pen, f: FrameCtx): void {
    const auras = this.auras;
    let write = 0;
    for (let i = 0; i < auras.length; i++) {
      const a = auras[i];
      a.left -= f.dt;
      if (a.left <= 0) continue;
      auras[write++] = a;
      const p = this.k.pos.get(a.playerId);
      if (!p) continue;
      const fade = clamp01(a.left / 0.4) * clamp01((a.total - a.left) / 0.15 + 0.3);
      const rim = pen.shape(SURGE, (0.3 + 0.2 * Math.sin(f.time * 23)) * fade, 'decal');
      rim.additive = true;
      rim.emissive = 0.9;
      rim.thickness = 1;
      pen.r.ring(p.x, p.y - 6, 18, rim);
      pen.r.ring(p.x, p.y - 6, 12 + 2 * Math.sin(f.time * 9), rim);
      if (Math.random() < f.fxDt * 16) {
        const ang = Math.random() * TAU;
        sparks(pen, p.x + Math.cos(ang) * 16, p.y - 10 + Math.sin(ang) * 8, 1, C.lightning, C.storm, 10, 30, 0.12);
      }
    }
    auras.length = write;
  }

  /** A meteor landing; the storm and the horizon fading. False for other kinds. */
  areaResolve(e: Extract<SimEvent, { t: 'areaResolve' }>): boolean {
    if (!AREA_KINDS.has(e.kind)) return false;
    const { pen, fx } = this.k;
    if (e.kind === 'meteorRain') {
      const b = pen.burst(e.x, e.y - 6, 26, C.hot, C.ember);
      pen.speed(e.radius * 1.5, e.radius * 3.5);
      pen.upward(40, 120);
      pen.life(0.3, 0.6);
      pen.size(0.7, 1.3);
      b.gravity = 260;
      b.drag = 0.9;
      pen.emit();
      const sm = pen.burst(e.x, e.y - 14, 8, C.smoke, C.smokeEnd);
      sm.sprite = 'fx/smoke';
      pen.speed(10, 30);
      pen.life(0.6, 1.1);
      pen.size(1, 1.7);
      sm.gravity = -30;
      sm.additive = false;
      pen.emit();
      fx.rings.spawn(e.x, e.y, 6, e.radius * 1.2, 0.28, METEOR, 2, 0.85, 0.7);
      fx.pulses.spawn(e.x, e.y - 12, e.radius * 2.6, 0.3, C.flame, 0.7);
      fx.decals.spawn(e.x, e.y, e.radius / 26, 8, 0.8);
      return true;
    }
    const col = e.kind === 'blizzardStorm' ? SNOW_DIM : HORIZON;
    fx.rings.spawn(e.x, e.y, e.radius, e.radius * 0.6, 0.35, col, 1, 0.5);
    return true;
  }
}

/** The player's own meteor telegraphs, storm and horizon. False for other kinds. */
export function drawRoster3Area(pen: Pen, f: FrameCtx, a: AreaView): boolean {
  if (!AREA_KINDS.has(a.kind)) return false;
  const r = pen.r;
  const p = a.duration > 0 ? clamp01(a.age / a.duration) : 1;
  const fadeIn = clamp01(a.age / 0.2);
  const fadeOut = clamp01((a.duration - a.age) / 0.3);
  const k = fadeIn * fadeOut;
  switch (a.kind) {
    case 'meteorRain': {
      // A warm circle filling toward the impact, and the meteor itself dropping onto it from high above.
      const fill = pen.shape(METEOR, 0.05 + 0.1 * p, 'decal');
      fill.additive = true;
      fill.emissive = 0.6;
      r.circle(a.x, a.y, a.radius, fill);
      const grow = pen.shape(METEOR, 0.35 + 0.3 * p, 'decal');
      grow.additive = true;
      grow.emissive = 0.8;
      grow.thickness = 1;
      r.ring(a.x, a.y, Math.max(1, a.radius * p), grow);
      const rim = pen.shape(METEOR, 0.3, 'decal');
      rim.additive = true;
      rim.thickness = 1;
      r.ring(a.x, a.y, a.radius, rim);
      const drop = 180 * (1 - p);
      const rock = pen.shape(C.hot, 0.5 + 0.4 * p, 'fx');
      rock.additive = true;
      rock.emissive = 1;
      r.circle(a.x + drop * 0.35, a.y - drop - 6, 3 + 3 * p, rock);
      if (Math.random() < f.fxDt * 30) {
        const b = pen.burst(a.x + drop * 0.35, a.y - drop - 6, 1, C.hot, C.ember);
        pen.speed(4, 12);
        pen.life(0.2, 0.35);
        pen.size(0.5, 0.8);
        b.gravity = -20;
        pen.emit();
      }
      return true;
    }
    case 'blizzardStorm': {
      // A pale, wind-scoured disc with snow driving round it.
      const fill = pen.shape(SNOW_DIM, 0.14 * k, 'decal');
      fill.emissive = 0.4;
      r.circle(a.x, a.y, a.radius, fill);
      const rim = pen.shape(SNOW, 0.35 * k, 'decal');
      rim.additive = true;
      rim.emissive = 0.7;
      rim.thickness = 1;
      r.ring(a.x, a.y, a.radius, rim);
      for (let n = 0; n < 10; n++) {
        const ang = f.time * 1.6 + (n * TAU) / 10;
        const d = a.radius * (0.35 + 0.55 * ((n * 0.37) % 1));
        const flake = pen.shape(SNOW, 0.55 * k, 'decal');
        flake.additive = true;
        flake.emissive = 0.8;
        r.circle(a.x + Math.cos(ang) * d, a.y + Math.sin(ang) * d * 0.7, 1.4, flake);
      }
      if (Math.random() < f.fxDt * 24 * k) {
        const ang = Math.random() * TAU;
        const d = Math.sqrt(Math.random()) * a.radius;
        const b = pen.burst(a.x + Math.cos(ang) * d, a.y + Math.sin(ang) * d * 0.7 - 20, 1, C.ice, C.mana);
        b.sprite = 'fx/frost';
        b.angle = ang + Math.PI / 2;
        b.spread = 0.4;
        pen.speed(30, 60);
        pen.life(0.4, 0.7);
        pen.size(0.3, 0.6);
        b.gravity = 60;
        pen.emit();
      }
      return true;
    }
    default: {
      // Event Horizon: a dark well of the pull's reach, rings drawn inward and a core that brightens toward the detonation.
      const fill = pen.shape(C.void, 0.1 * k, 'decal');
      fill.emissive = 0.4;
      r.circle(a.x, a.y, a.radius, fill);
      const rim = pen.shape(HORIZON, 0.3 * k, 'decal');
      rim.additive = true;
      rim.thickness = 1;
      r.ring(a.x, a.y, a.radius, rim);
      for (let n = 0; n < 4; n++) {
        const t = (f.time * 0.9 + n / 4) % 1;
        const ring = pen.shape(C.voidGlow, 0.3 * k * (1 - t), 'decal');
        ring.additive = true;
        ring.emissive = 0.8;
        ring.thickness = 1;
        r.ring(a.x, a.y, Math.max(2, a.radius * (1 - t)), ring);
      }
      const core = pen.shape(C.voidHi, (0.25 + 0.5 * p) * k, 'decal');
      core.additive = true;
      core.emissive = 1;
      r.circle(a.x, a.y, 6 + 10 * p, core);
      if (Math.random() < f.fxDt * 30 * k) {
        const ang = Math.random() * TAU;
        const b = pen.burst(a.x + Math.cos(ang) * a.radius, a.y + Math.sin(ang) * a.radius * 0.6, 1, C.voidHi, C.void);
        b.sprite = 'fx/mote';
        b.angle = ang + Math.PI;
        b.spread = 0.15;
        pen.speed(a.radius * 0.7, a.radius * 1.1);
        pen.life(0.6, 0.9);
        pen.size(0.5, 0.9);
        pen.emit();
      }
      return true;
    }
  }
}
