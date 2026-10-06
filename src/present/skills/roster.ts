// Visuals of the power rework's roster batch 1 (SK2): Phase Stride, Glacial Nova, Spark, Cinder Mortar, Arcane Reprieve, Umbral
// Bolt, Kinetic Lance, Frost Orb, Storm Call, Glacial Spikes. Their projectiles are drawn by projectiles.ts (looks there), their
// muzzle flashes, bursts, impacts and buff auras here. Storm Call's and Glacial Spikes' telegraphs are the PLAYER's own: drawn
// in her element's palette with a thin rim and no danger red, so they never read as something to dodge.
//   cast(...)           per-skill muzzle (returns false for skills that are not in this batch)
//   nova(...)           Glacial Nova's instant frost ring
//   buff(...) / draw()  the timed auras of Phase Stride and Arcane Reprieve, drawn on the caster every frame
//   projectileEnd(...)  the mortar's landing blast and the bolts' element puffs
//   areaResolve(...)    a Storm Call bolt falling from the sky, a Glacial Spike erupting
//   drawRosterArea(...) the friendly telegraphs (called by AreaPainter)
import type { RGB } from '../../contracts/render';
import type { SkillId } from '../../contracts/content';
import type { AreaView, SimEvent } from '../../contracts/sim';
import { C } from '../colors';
import type { FrameCtx } from '../context';
import { sparks, type Effects } from '../fx';
import { clamp01, TAU } from '../math';
import type { Pen } from '../pen';

const FROST_WHITE: RGB = [0.85, 0.95, 1];
const STORM_FRIENDLY: RGB = [0.62, 0.78, 1];
const STRIDE: RGB = [0.78, 0.66, 1];
const REPRIEVE: RGB = [0.45, 0.7, 1];
const KINETIC: RGB = [0.95, 0.85, 0.58];
const KINETIC_END: RGB = [0.45, 0.4, 0.34];

/** The roster batch's skills (cast visuals live here). */
export const ROSTER_SKILLS: ReadonlySet<SkillId> = new Set<SkillId>([
  'phaseStride', 'glacialNova', 'spark', 'cinderMortar', 'arcaneReprieve', 'umbralBolt', 'kineticLance', 'frostOrb', 'stormCall',
  'glacialSpikes',
]);

interface Aura {
  playerId: number;
  skill: SkillId;
  /** Seconds left and total. */
  left: number;
  total: number;
}

const AURA_CAP = 16;

export interface RosterKit {
  pen: Pen;
  fx: Effects;
  /** Interpolated feet and wand tip of each player drawn this frame. */
  pos: ReadonlyMap<number, { x: number; y: number; tipX: number; tipY: number }>;
}

export class RosterFx {
  private readonly auras: Aura[] = [];

  constructor(private readonly k: RosterKit) {}

  reset(): void {
    this.auras.length = 0;
  }

  /** Muzzle of a cast at the wand tip (x, y) toward `ang`; `pk` scales the light pulse (0 = none). False when not a roster skill. */
  cast(skill: SkillId, x: number, y: number, ang: number, pk: number): boolean {
    if (!ROSTER_SKILLS.has(skill)) return false;
    const { pen, fx } = this.k;
    switch (skill) {
      case 'spark':
        sparks(pen, x, y, 8, C.lightning, C.storm, 30, 90, 0.18);
        if (pk > 0) fx.pulses.spawn(x, y, 44, 0.14, C.lightning, 0.45 * pk);
        return true;
      case 'cinderMortar': {
        const b = pen.burst(x, y, 10, C.hot, C.ember);
        pen.speed(30, 80);
        pen.life(0.15, 0.35);
        pen.size(0.8, 1.3);
        b.angle = ang;
        b.spread = 0.8;
        pen.emit();
        const sm = pen.burst(x, y, 5, C.smoke, C.smokeEnd);
        sm.sprite = 'fx/smoke';
        pen.speed(6, 20);
        pen.life(0.4, 0.8);
        pen.size(0.6, 1);
        sm.gravity = -20;
        sm.additive = false;
        pen.emit();
        if (pk > 0) fx.pulses.spawn(x, y, 52, 0.18, C.flame, 0.5 * pk);
        return true;
      }
      case 'umbralBolt': {
        const b = pen.burst(x, y, 8, C.voidHi, C.void);
        pen.speed(10, 40);
        pen.life(0.2, 0.45);
        pen.size(0.6, 1);
        b.angle = ang + Math.PI;
        b.spread = 1.6;
        b.drag = 0.85;
        pen.emit();
        if (pk > 0) fx.pulses.spawn(x, y, 50, 0.2, C.voidGlow, 0.5 * pk);
        return true;
      }
      case 'kineticLance': {
        const b = pen.burst(x, y, 5, KINETIC, KINETIC_END);
        b.sprite = 'fx/spark';
        pen.speed(40, 110);
        pen.life(0.08, 0.16);
        pen.size(0.4, 0.7);
        b.angle = ang;
        b.spread = 0.5;
        pen.emit();
        fx.rings.spawn(x, y, 2, 10, 0.12, KINETIC, 1, 0.7);
        return true;
      }
      case 'frostOrb':
      case 'glacialSpikes':
      case 'glacialNova': {
        const b = pen.burst(x, y, 7, C.ice, C.mana);
        b.sprite = 'fx/frost';
        b.emissive = 0.6;
        pen.speed(20, 70);
        pen.life(0.15, 0.3);
        pen.size(0.45, 0.7);
        pen.emit();
        if (pk > 0) fx.pulses.spawn(x, y, 48, 0.18, C.frost, 0.45 * pk);
        return true;
      }
      case 'stormCall':
        // The wand points up: sparks rise toward the sky the strikes will come from.
        {
          const b = pen.burst(x, y - 4, 8, C.lightning, C.storm);
          b.sprite = 'fx/spark';
          pen.speed(40, 90);
          pen.life(0.15, 0.3);
          pen.size(0.4, 0.7);
          b.angle = -Math.PI / 2;
          b.spread = 0.7;
          pen.emit();
          if (pk > 0) fx.pulses.spawn(x, y, 50, 0.2, C.storm, 0.5 * pk);
        }
        return true;
      default:
        // Phase Stride and Arcane Reprieve show through their 'buff' aura.
        return true;
    }
  }

  /** Glacial Nova: a cyan-white shock ring and ice flung outward along the floor. */
  nova(e: Extract<SimEvent, { t: 'nova' }>, own: boolean): void {
    const { pen, fx } = this.k;
    const y = e.y - 4;
    fx.rings.spawn(e.x, y, 8, e.radius, 0.35, C.ice, 2, 0.85, 0.6);
    fx.rings.spawn(e.x, y, 4, e.radius * 0.6, 0.25, FROST_WHITE, 1, 0.6);
    const b = pen.burst(e.x, y, 22, C.ice, C.mana);
    b.sprite = 'fx/frost';
    b.emissive = 0.6;
    pen.speed(e.radius * 1.4, e.radius * 2.4);
    pen.life(0.2, 0.4);
    pen.size(0.5, 0.9);
    b.drag = 0.9;
    pen.emit();
    fx.decals.spawn(e.x, e.y, e.radius / 30, 4, 0, 'rime');
    fx.pulses.spawn(e.x, y - 4, e.radius * 1.6, 0.3, FROST_WHITE, own ? 0.45 : 0.3);
  }

  /** A timed self-buff began: keep its aura on the player for its duration (a recast refreshes it). */
  buff(e: Extract<SimEvent, { t: 'buff' }>): void {
    const { fx } = this.k;
    const total = Math.max(0.1, e.duration);
    const same = this.auras.find((a) => a.playerId === e.playerId && a.skill === e.skill);
    if (same) {
      same.left = total;
      same.total = total;
    } else {
      if (this.auras.length >= AURA_CAP) this.auras.shift();
      this.auras.push({ playerId: e.playerId, skill: e.skill, left: total, total });
    }
    const col = e.skill === 'arcaneReprieve' ? REPRIEVE : STRIDE;
    fx.rings.spawn(e.x, e.y - 4, 4, 30, 0.3, col, 1, 0.8, 0.4);
  }

  /** Active auras: streaks and afterimage glints behind a striding player, focus motes rising from one in reprieve. */
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
      if (a.skill === 'arcaneReprieve') {
        const ring = pen.shape(REPRIEVE, 0.25 * fade, 'decal');
        ring.additive = true;
        ring.emissive = 0.8;
        ring.thickness = 1;
        pen.r.ring(p.x, p.y, 13 + 2 * Math.sin(f.time * 4), ring);
        if (Math.random() < f.fxDt * 14) {
          const ang = Math.random() * TAU;
          const b = pen.burst(p.x + Math.cos(ang) * 9, p.y + Math.sin(ang) * 4 - 2, 1, REPRIEVE, C.mana);
          b.sprite = 'fx/mote';
          pen.speed(2, 6);
          pen.life(0.5, 0.9);
          pen.size(0.5, 0.8);
          b.gravity = -40;
          pen.emit();
        }
      } else {
        const glow = pen.shape(STRIDE, 0.18 * fade, 'decal');
        glow.additive = true;
        glow.emissive = 0.7;
        pen.r.circle(p.x, p.y, 11, glow);
        if (Math.random() < f.fxDt * 18) {
          const b = pen.burst(p.x + (Math.random() - 0.5) * 10, p.y - 4 - Math.random() * 16, 1, STRIDE, C.void);
          b.sprite = 'fx/spark';
          pen.speed(4, 14);
          pen.life(0.2, 0.4);
          pen.size(0.4, 0.7);
          pen.emit();
        }
      }
    }
    auras.length = write;
  }

  /** Landings and impacts of the batch's projectiles. False for other kinds. */
  projectileEnd(e: Extract<SimEvent, { t: 'projectileEnd' }>): boolean {
    const { pen, fx } = this.k;
    switch (e.kind) {
      case 'cinderShell': {
        const b = pen.burst(e.x, e.y - 4, 18, C.hot, C.ember);
        pen.speed(40, 120);
        pen.life(0.2, 0.45);
        pen.size(0.9, 1.6);
        b.drag = 0.85;
        pen.emit();
        const sm = pen.burst(e.x, e.y - 4, 8, C.smoke, C.smokeEnd);
        sm.sprite = 'fx/smoke';
        pen.speed(10, 30);
        pen.life(0.6, 1.1);
        pen.size(1, 1.6);
        sm.gravity = -18;
        sm.additive = false;
        pen.emit();
        fx.rings.spawn(e.x, e.y, 6, 44, 0.3, C.flame, 2, 0.85, 0.7);
        fx.pulses.spawn(e.x, e.y - 8, 90, 0.3, C.flame, 0.7);
        fx.decals.spawn(e.x, e.y, 1.6, 8, 0.8);
        return true;
      }
      case 'umbralBolt':
        sparks(pen, e.x, e.y - 8, 8, C.voidHi, C.void, 15, 45, 0.35);
        fx.rings.spawn(e.x, e.y - 6, 10, 2, 0.25, C.voidGlow, 1, 0.6);
        return true;
      case 'kineticLance':
        sparks(pen, e.x, e.y - 8, 6, KINETIC, KINETIC_END, 25, 70, 0.18);
        return true;
      case 'spark':
        sparks(pen, e.x, e.y - 8, 5, C.lightning, C.storm, 20, 60, 0.15);
        return true;
      case 'frostOrb': {
        const b = pen.burst(e.x, e.y - 8, 10, C.ice, C.mana);
        b.sprite = 'fx/frost';
        pen.speed(15, 45);
        pen.life(0.3, 0.5);
        pen.size(0.5, 0.8);
        pen.emit();
        return true;
      }
      default:
        return false;
    }
  }

  /** Storm Call bolts and Glacial Spikes resolving. False for other kinds. `near` 0..1 = how close to the local player. */
  areaResolve(e: Extract<SimEvent, { t: 'areaResolve' }>, iceSpikeFrames: number, iceSpikeLife: number): boolean {
    const { pen, fx } = this.k;
    if (e.kind === 'stormCall') {
      // A jagged bolt from high above down to the strike, a flash ring and sparks.
      const pts: number[] = [];
      let x = e.x + (Math.random() - 0.5) * 20;
      for (let k = 0; k <= 5; k++) {
        const y = e.y - 150 + k * 30;
        pts.push(k === 5 ? e.x : x, k === 5 ? e.y - 6 : y);
        x += (Math.random() - 0.5) * 16;
      }
      fx.chains.spawn(pts, 'lightning');
      fx.rings.spawn(e.x, e.y, e.radius * 0.3, e.radius * 1.2, 0.3, STORM_FRIENDLY, 1, 0.85, 0.6);
      sparks(pen, e.x, e.y - 6, 10, C.lightning, C.storm, 40, 130, 0.22);
      fx.pulses.spawn(e.x, e.y - 10, e.radius * 2.4, 0.22, C.lightning, 0.6);
      fx.decals.spawn(e.x, e.y, 0.5, 4, 0.3);
      return true;
    }
    if (e.kind === 'frostSpike') {
      fx.sprites.spawn('fx/iceSpike', iceSpikeFrames, e.x, e.y, iceSpikeLife, {
        world: true, from: 1, flip: ((e.x * 7 + e.y * 13) | 0) % 2 === 0, emissive: 0.6, scale: Math.max(0.6, e.radius / 20),
      });
      const b = pen.burst(e.x, e.y - 6, 5, C.ice, C.mana);
      b.sprite = 'fx/frost';
      pen.speed(20, 50);
      pen.upward(20, 50);
      b.z = 4;
      b.gravity = 240;
      pen.life(0.3, 0.5);
      pen.size(0.4, 0.7);
      pen.emit();
      fx.pulses.spawn(e.x, e.y - 10, 40, 0.25, FROST_WHITE, 0.4);
      return true;
    }
    return false;
  }
}

/** The player's own Storm Call / Glacial Spike telegraphs: a soft disc and a thin filling ring in her palette. False otherwise. */
export function drawRosterArea(pen: Pen, f: FrameCtx, a: AreaView): boolean {
  if (a.kind !== 'stormCall' && a.kind !== 'frostSpike') return false;
  const r = pen.r;
  const col = a.kind === 'stormCall' ? STORM_FRIENDLY : C.frost;
  const p = a.duration > 0 ? clamp01(a.age / a.duration) : 1;
  const fill = pen.shape(col, 0.05 + 0.07 * p, 'decal');
  fill.additive = true;
  fill.emissive = 0.6;
  r.circle(a.x, a.y, a.radius, fill);
  const grow = pen.shape(col, 0.35 + 0.3 * p, 'decal');
  grow.additive = true;
  grow.emissive = 0.8;
  grow.thickness = 1;
  r.ring(a.x, a.y, Math.max(1, a.radius * p), grow);
  if (a.kind === 'stormCall') {
    const rim = pen.shape(col, 0.3, 'decal');
    rim.additive = true;
    rim.thickness = 1;
    r.ring(a.x, a.y, a.radius, rim);
    // Static gathering where it will strike.
    if (Math.random() < f.fxDt * 10) sparks(pen, a.x + (Math.random() - 0.5) * a.radius, a.y - 2, 1, C.lightning, C.storm, 5, 20, 0.12);
  } else if (Math.random() < f.fxDt * 6) {
    const b = pen.burst(a.x + (Math.random() - 0.5) * a.radius, a.y, 1, C.ice, C.mana);
    b.sprite = 'fx/frost';
    pen.speed(2, 6);
    pen.life(0.3, 0.5);
    pen.size(0.3, 0.5);
    pen.emit();
  }
  return true;
}
