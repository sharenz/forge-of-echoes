// Visuals of the power rework's roster batch 2 (SK3): Gravity Well, Rime Bulwark, Immolation Sigil, Static Aegis, Voltaic Pulse,
// Entropy Hex, Concussive Blast, Static Lash, Echo Sigil, Wither Field. Static Lash's beam and Static Aegis' retaliation arcs are
// the 'chain' events Arc Chain already draws. The zones and the sigil's telegraph are the PLAYER's own ground: drawn in her
// element palette with soft rims and no danger red, so they never read as something to dodge.
//   cast(...)            per-skill muzzle (false for skills outside this batch); Concussive Blast's cone of force
//   nova(...)            Voltaic Pulse's ring, Singularity's collapse, Brittle Retort's ice nova
//   buff(...) / draw()   the barrier, aegis and echo auras on the caster (a zero-length buff ends one: the barrier broke)
//   areaResolve(...)     the sigil's fire pillar, a zone fading
//   drawRoster2Area(...) the friendly zones and telegraph (called by AreaPainter)
import type { RGB } from '../../contracts/render';
import type { SkillId } from '../../contracts/content';
import type { AreaView, SimEvent } from '../../contracts/sim';
import { C } from '../colors';
import type { FrameCtx } from '../context';
import { sparks } from '../fx';
import { clamp01, TAU } from '../math';
import type { Pen } from '../pen';
import type { RosterKit } from './roster';

const WELL: RGB = [0.55, 0.3, 0.85];
const HEX: RGB = [0.62, 0.28, 0.72];
const WITHER: RGB = [0.55, 0.62, 0.3];
const WITHER_END: RGB = [0.25, 0.18, 0.28];
const SIGIL: RGB = [1, 0.62, 0.22];
const BARRIER: RGB = [0.7, 0.9, 1];
const AEGIS: RGB = [0.85, 0.82, 1];
const ECHO: RGB = [0.75, 0.85, 1];
const FORCE: RGB = [0.95, 0.88, 0.7];
const FORCE_END: RGB = [0.5, 0.45, 0.38];

/** The batch's skills (their cast visuals live here). */
export const ROSTER2_SKILLS: ReadonlySet<SkillId> = new Set<SkillId>([
  'gravityWell', 'rimeBulwark', 'immolationSigil', 'staticAegis', 'voltaicPulse', 'entropyHex', 'concussiveBlast', 'staticLash',
  'echoSigil', 'witherField',
]);

/** Skills whose 'buff' event this module draws. */
const AURA_SKILLS: ReadonlySet<SkillId> = new Set<SkillId>(['rimeBulwark', 'staticAegis', 'echoSigil']);

const AREA_KINDS = new Set<AreaView['kind']>(['gravityWell', 'entropyHex', 'witherField', 'immolationSigil']);

interface Aura {
  playerId: number;
  skill: SkillId;
  left: number;
  total: number;
}

const AURA_CAP = 16;

export class Roster2Fx {
  private readonly auras: Aura[] = [];

  constructor(private readonly k: RosterKit) {}

  reset(): void {
    this.auras.length = 0;
  }

  /** Muzzle of a cast at the wand tip (x, y) toward `ang`; `pk` scales the light pulse. False when not in this batch. */
  cast(skill: SkillId, x: number, y: number, ang: number, pk: number): boolean {
    if (!ROSTER2_SKILLS.has(skill)) return false;
    const { pen, fx } = this.k;
    switch (skill) {
      case 'gravityWell':
      case 'entropyHex':
      case 'witherField': {
        const c0 = skill === 'witherField' ? WITHER : C.voidHi;
        const c1 = skill === 'witherField' ? WITHER_END : C.void;
        const b = pen.burst(x, y, 8, c0, c1);
        b.sprite = 'fx/mote';
        pen.speed(10, 35);
        pen.life(0.25, 0.5);
        pen.size(0.5, 0.9);
        b.drag = 0.85;
        pen.emit();
        if (pk > 0) fx.pulses.spawn(x, y, 50, 0.2, skill === 'witherField' ? WITHER : C.voidGlow, 0.45 * pk);
        return true;
      }
      case 'immolationSigil':
        sparks(pen, x, y, 7, C.hot, C.ember, 20, 60, 0.25);
        if (pk > 0) fx.pulses.spawn(x, y, 46, 0.18, C.flame, 0.45 * pk);
        return true;
      case 'voltaicPulse':
      case 'staticLash':
        sparks(pen, x, y, skill === 'staticLash' ? 3 : 8, C.lightning, C.storm, 20, 70, 0.15);
        if (pk > 0 && skill === 'voltaicPulse') fx.pulses.spawn(x, y, 50, 0.16, C.lightning, 0.5 * pk);
        return true;
      case 'concussiveBlast': {
        // A cone of force: dust and pale streaks thrown along the aim across the 100° front.
        const b = pen.burst(x, y, 26, FORCE, FORCE_END);
        b.sprite = 'fx/smoke';
        pen.speed(220, 420);
        pen.life(0.18, 0.35);
        pen.size(0.6, 1.1);
        b.angle = ang;
        b.spread = 1.75;
        b.drag = 0.85;
        b.additive = false;
        pen.emit();
        const s = pen.burst(x, y, 12, C.white, FORCE);
        s.sprite = 'fx/spark';
        pen.speed(260, 480);
        pen.life(0.1, 0.22);
        pen.size(0.4, 0.7);
        s.angle = ang;
        s.spread = 1.6;
        pen.emit();
        fx.rings.spawn(x + Math.cos(ang) * 30, y + Math.sin(ang) * 30, 8, 60, 0.2, FORCE, 1, 0.7);
        return true;
      }
      default:
        // The buffs show through their aura.
        return true;
    }
  }

  /** Voltaic Pulse's ring, Singularity's collapse, Brittle Retort's nova. False for other skills. */
  nova(e: Extract<SimEvent, { t: 'nova' }>, own: boolean): boolean {
    const { pen, fx } = this.k;
    const y = e.y - 4;
    switch (e.skill) {
      case 'voltaicPulse': {
        const life = e.radius / 500;
        fx.rings.spawn(e.x, y, 8, e.radius, life, C.lightning, 2, 0.9, 0.7);
        fx.rings.spawn(e.x, y, 4, e.radius * 0.92, life * 1.1, C.storm, 1, 0.6);
        sparks(pen, e.x, y, 18, C.lightning, C.storm, e.radius * 1.2, e.radius * 2, 0.3);
        fx.pulses.spawn(e.x, y - 4, e.radius * 1.4, 0.25, C.lightning, own ? 0.5 : 0.3);
        return true;
      }
      case 'gravityWell': {
        // The vortex folds in on itself, then bursts.
        fx.rings.spawn(e.x, y, e.radius, 6, 0.18, C.voidGlow, 2, 0.9, 0.6);
        const b = pen.burst(e.x, y, 24, C.voidHi, C.void);
        b.sprite = 'fx/mote';
        pen.speed(e.radius * 1.2, e.radius * 2.2);
        pen.life(0.25, 0.45);
        pen.size(0.6, 1);
        b.drag = 0.88;
        pen.emit();
        fx.pulses.spawn(e.x, y - 6, e.radius * 1.8, 0.3, C.voidGlow, own ? 0.6 : 0.4);
        return true;
      }
      case 'rimeBulwark': {
        fx.rings.spawn(e.x, y, 8, e.radius, 0.3, C.ice, 2, 0.85, 0.6);
        const b = pen.burst(e.x, y - 8, 20, C.ice, C.mana);
        b.sprite = 'fx/frost';
        b.emissive = 0.6;
        pen.speed(e.radius * 1.2, e.radius * 2);
        pen.life(0.2, 0.4);
        pen.size(0.5, 0.9);
        b.drag = 0.9;
        pen.emit();
        fx.decals.spawn(e.x, e.y, e.radius / 30, 4, 0, 'rime');
        return true;
      }
      default:
        return false;
    }
  }

  /** A batch buff began or ended (duration 0). False for buffs of other skills. */
  buff(e: Extract<SimEvent, { t: 'buff' }>): boolean {
    if (!AURA_SKILLS.has(e.skill)) return false;
    const { pen, fx } = this.k;
    const same = this.auras.findIndex((a) => a.playerId === e.playerId && a.skill === e.skill);
    if (e.duration <= 0) {
      if (same >= 0) this.auras.splice(same, 1);
      if (e.skill === 'rimeBulwark') {
        // The barrier shatters.
        const b = pen.burst(e.x, e.y - 12, 16, C.ice, C.mana);
        b.sprite = 'fx/frost';
        pen.speed(40, 110);
        pen.upward(20, 60);
        b.gravity = 200;
        pen.life(0.3, 0.6);
        pen.size(0.5, 0.9);
        pen.emit();
        fx.rings.spawn(e.x, e.y - 8, 14, 30, 0.2, BARRIER, 1, 0.8);
      }
      return true;
    }
    if (same >= 0) {
      this.auras[same].left = e.duration;
      this.auras[same].total = e.duration;
    } else {
      if (this.auras.length >= AURA_CAP) this.auras.shift();
      this.auras.push({ playerId: e.playerId, skill: e.skill, left: e.duration, total: e.duration });
    }
    fx.rings.spawn(e.x, e.y - 4, 4, 32, 0.3, auraColor(e.skill), 1, 0.8, 0.4);
    return true;
  }

  /** Active auras: an icy shell, a crackling ring, orbiting echo glints. */
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
      const col = auraColor(a.skill);
      if (a.skill === 'rimeBulwark') {
        const shell = pen.shape(col, 0.16 * fade, 'decal');
        shell.additive = true;
        shell.emissive = 0.7;
        pen.r.circle(p.x, p.y - 10, 16, shell);
        const rim = pen.shape(col, 0.4 * fade, 'decal');
        rim.additive = true;
        rim.thickness = 1;
        pen.r.ring(p.x, p.y - 10, 16 + Math.sin(f.time * 3), rim);
      } else if (a.skill === 'staticAegis') {
        const rim = pen.shape(col, (0.25 + 0.15 * Math.sin(f.time * 17)) * fade, 'decal');
        rim.additive = true;
        rim.emissive = 0.8;
        rim.thickness = 1;
        pen.r.ring(p.x, p.y, 15, rim);
        if (Math.random() < f.fxDt * 12) {
          const ang = Math.random() * TAU;
          sparks(pen, p.x + Math.cos(ang) * 14, p.y + Math.sin(ang) * 7 - 8, 1, C.lightning, C.storm, 5, 20, 0.12);
        }
      } else {
        for (let k = 0; k < 3; k++) {
          const ang = f.time * 2.4 + (k * TAU) / 3;
          const glint = pen.shape(col, 0.5 * fade, 'decal');
          glint.additive = true;
          glint.emissive = 0.9;
          pen.r.circle(p.x + Math.cos(ang) * 13, p.y - 14 + Math.sin(ang) * 5, 1.6, glint);
        }
      }
    }
    auras.length = write;
  }

  /** The sigil's pillar erupting; a zone fading. False for other kinds. */
  areaResolve(e: Extract<SimEvent, { t: 'areaResolve' }>): boolean {
    if (!AREA_KINDS.has(e.kind)) return false;
    const { pen, fx } = this.k;
    if (e.kind === 'immolationSigil') {
      const b = pen.burst(e.x, e.y - 4, 30, C.hot, C.ember);
      pen.speed(10, 40);
      pen.upward(120, 240);
      pen.life(0.35, 0.7);
      pen.size(0.9, 1.6);
      b.gravity = -60;
      b.drag = 0.9;
      pen.emit();
      const sm = pen.burst(e.x, e.y - 30, 10, C.smoke, C.smokeEnd);
      sm.sprite = 'fx/smoke';
      pen.speed(10, 30);
      pen.life(0.7, 1.2);
      pen.size(1, 1.8);
      sm.gravity = -30;
      sm.additive = false;
      pen.emit();
      fx.rings.spawn(e.x, e.y, 6, e.radius * 1.1, 0.3, C.flame, 2, 0.85, 0.7);
      fx.pulses.spawn(e.x, e.y - 20, e.radius * 2.6, 0.35, C.flame, 0.7);
      fx.decals.spawn(e.x, e.y, e.radius / 28, 8, 0.8);
      return true;
    }
    const col = e.kind === 'witherField' ? WITHER : e.kind === 'entropyHex' ? HEX : WELL;
    fx.rings.spawn(e.x, e.y, e.radius, e.radius * 0.6, 0.35, col, 1, 0.5);
    return true;
  }
}

function auraColor(skill: SkillId): RGB {
  return skill === 'rimeBulwark' ? BARRIER : skill === 'staticAegis' ? AEGIS : ECHO;
}

/** The player's own zones and the sigil's telegraph. False for other kinds. */
export function drawRoster2Area(pen: Pen, f: FrameCtx, a: AreaView): boolean {
  if (!AREA_KINDS.has(a.kind)) return false;
  const r = pen.r;
  const p = a.duration > 0 ? clamp01(a.age / a.duration) : 1;
  const fadeIn = clamp01(a.age / 0.2);
  const fadeOut = clamp01((a.duration - a.age) / 0.3);
  const k = fadeIn * fadeOut;
  switch (a.kind) {
    case 'immolationSigil': {
      // A brand burning brighter until the pillar: a disc, a filling ring and a thin rim.
      const fill = pen.shape(SIGIL, 0.06 + 0.1 * p, 'decal');
      fill.additive = true;
      fill.emissive = 0.7;
      r.circle(a.x, a.y, a.radius, fill);
      const grow = pen.shape(SIGIL, 0.35 + 0.35 * p, 'decal');
      grow.additive = true;
      grow.emissive = 0.9;
      grow.thickness = 1;
      r.ring(a.x, a.y, Math.max(1, a.radius * p), grow);
      const rim = pen.shape(SIGIL, 0.35, 'decal');
      rim.additive = true;
      rim.thickness = 1;
      r.ring(a.x, a.y, a.radius, rim);
      if (Math.random() < f.fxDt * 10) sparks(pen, a.x + (Math.random() - 0.5) * a.radius, a.y - 2, 1, C.hot, C.ember, 5, 20, 0.2);
      return true;
    }
    case 'gravityWell': {
      // A dark disc with rings spiralling in and motes sucked toward the centre.
      const fill = pen.shape(C.void, 0.12 * k, 'decal');
      fill.emissive = 0.4;
      r.circle(a.x, a.y, a.radius, fill);
      for (let n = 0; n < 3; n++) {
        const t = (f.time * 0.8 + n / 3) % 1;
        const ring = pen.shape(WELL, 0.3 * k * (1 - t), 'decal');
        ring.additive = true;
        ring.emissive = 0.8;
        ring.thickness = 1;
        r.ring(a.x, a.y, Math.max(2, a.radius * (1 - t)), ring);
      }
      if (Math.random() < f.fxDt * 20 * k) {
        const ang = Math.random() * TAU;
        const b = pen.burst(a.x + Math.cos(ang) * a.radius, a.y + Math.sin(ang) * a.radius * 0.6, 1, C.voidHi, C.void);
        b.sprite = 'fx/mote';
        b.angle = ang + Math.PI * 0.8;
        b.spread = 0.2;
        pen.speed(a.radius * 0.8, a.radius * 1.2);
        pen.life(0.5, 0.8);
        pen.size(0.5, 0.8);
        pen.emit();
      }
      return true;
    }
    case 'entropyHex': {
      // A cursed circle: a dim violet disc, a double rim and slowly turning ticks like a sigil's runes.
      const fill = pen.shape(HEX, 0.08 * k, 'decal');
      fill.emissive = 0.5;
      r.circle(a.x, a.y, a.radius, fill);
      const rim = pen.shape(HEX, 0.4 * k, 'decal');
      rim.additive = true;
      rim.emissive = 0.8;
      rim.thickness = 1;
      r.ring(a.x, a.y, a.radius, rim);
      r.ring(a.x, a.y, a.radius * 0.88, rim);
      for (let n = 0; n < 8; n++) {
        const ang = f.time * 0.4 + (n * TAU) / 8;
        const tick = pen.shape(C.voidHi, 0.5 * k, 'decal');
        tick.additive = true;
        tick.emissive = 0.9;
        r.circle(a.x + Math.cos(ang) * a.radius * 0.94, a.y + Math.sin(ang) * a.radius * 0.94, 1.5, tick);
      }
      return true;
    }
    default: {
      // Wither Field: sickly ground with motes of rot drifting up.
      const fill = pen.shape(WITHER_END, 0.25 * k, 'decal');
      r.circle(a.x, a.y, a.radius, fill);
      const rim = pen.shape(WITHER, 0.3 * k, 'decal');
      rim.additive = true;
      rim.thickness = 1;
      r.ring(a.x, a.y, a.radius, rim);
      if (Math.random() < f.fxDt * 14 * k) {
        const ang = Math.random() * TAU;
        const d = Math.sqrt(Math.random()) * a.radius;
        const b = pen.burst(a.x + Math.cos(ang) * d, a.y + Math.sin(ang) * d * 0.7, 1, WITHER, WITHER_END);
        b.sprite = 'fx/mote';
        pen.speed(2, 6);
        pen.life(0.6, 1.1);
        pen.size(0.5, 0.9);
        b.gravity = -25;
        pen.emit();
      }
      return true;
    }
  }
}
